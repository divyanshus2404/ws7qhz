from datetime import date, datetime, time, timedelta, timezone

import pytest

from app import analytics, config
from app.models import ActualPoint, ForecastPoint, Pair
from app.store import WindDataStore

UTC = timezone.utc


def dt(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


def test_percentile_matches_linear_interpolation():
    assert analytics.percentile([1, 2, 3, 4], 0.5) == 2.5
    assert analytics.percentile([10], 0.9) == 10
    assert analytics.percentile([0, 10], 0.1) == pytest.approx(1.0)


def test_error_metrics_sign_convention():
    # actual above forecast => positive error (wind beat the forecast)
    pairs = [Pair(dt("2026-01-01T00:00"), dt("2026-01-01T12:00"), forecast=100, actual=150)]
    m = analytics.error_metrics(pairs)
    assert m["bias"] == 50 and m["mae"] == 50 and m["rmse"] == 50


def test_decision_cutoff_is_d_minus_1_uk_time():
    # January: UK time == UTC
    assert analytics.decision_cutoff(date(2026, 1, 15), time(11)) == dt("2026-01-14T11:00")
    # Summer: BST is UTC+1, so 11:00 UK is 10:00 UTC
    assert analytics.decision_cutoff(date(2026, 7, 15), time(11)) == dt("2026-07-14T10:00")


def test_delivery_slots_cover_clock_change_days():
    assert len(analytics.delivery_slots(date(2026, 1, 15), 30)) == 48
    assert len(analytics.delivery_slots(date(2026, 3, 29), 30)) == 46  # spring forward
    assert len(analytics.delivery_slots(date(2026, 10, 25), 30)) == 50  # fall back


def test_latest_forecast_never_uses_a_publication_after_as_of():
    target = dt("2026-01-15T12:00")
    store = WindDataStore(
        [
            ForecastPoint(dt("2026-01-14T07:30"), target, 1000),
            ForecastPoint(dt("2026-01-14T09:30"), target, 2000),
            ForecastPoint(dt("2026-01-14T11:30"), target, 3000),
        ],
        [],
    )
    assert store.latest_forecast(target, dt("2026-01-14T11:00")).generation == 2000
    assert store.latest_forecast(target, dt("2026-01-14T09:30")).generation == 2000  # inclusive
    assert store.latest_forecast(target, dt("2026-01-14T07:00")) is None
    assert store.latest_forecast(dt("2026-01-15T13:00"), dt("2026-01-14T11:00")) is None


def _flat_store(days: list[date], forecast: float, actual_for) -> WindDataStore:
    """One publication per day at 09:30 on D-1 covering D, plus half-hourly actuals."""
    forecasts, actuals = [], []
    for d in days:
        pub = analytics.decision_cutoff(d, time(9, 30))
        for t in analytics.delivery_slots(d, 60):
            forecasts.append(ForecastPoint(pub, t, forecast))
        for t in analytics.delivery_slots(d, 30):
            actuals.append(ActualPoint(t, actual_for(d)))
    return WindDataStore(forecasts, actuals)


def test_calibration_uses_only_days_settled_before_the_decision():
    target = date(2026, 1, 20)
    days = [target - timedelta(days=k) for k in range(0, config.CALIBRATION_DAYS + 3)]
    # Forecast is always 1000. History (<= D-2) came in at 800; D-1 and D at 5000.
    store = _flat_store(days, 1000, lambda d: 800 if d <= target - timedelta(days=2) else 5000)

    cal = analytics.calibration(store, target, time(11))
    assert cal["p50_error"] == -200  # D-1 and D did not leak in
    assert cal["window"] == ["2026-01-05", "2026-01-18"]
    assert cal["sample_size"] == 24 * config.CALIBRATION_DAYS


def test_calibration_needs_history():
    store = _flat_store([date(2026, 1, 20)], 1000, lambda d: 1000)
    assert analytics.calibration(store, date(2026, 1, 20), time(11)) is None


def test_day_ahead_view_shape_and_energy():
    target = date(2026, 1, 20)
    days = [target - timedelta(days=k) for k in range(0, config.CALIBRATION_DAYS + 3)]
    store = _flat_store(days, 1000, lambda d: 900)

    view = analytics.day_ahead_view(store, target, time(11))
    assert view["forecast_published"] == "2026-01-19T09:30:00Z"
    assert len(view["series"]) == 48
    assert view["summary"]["forecast_mwh"] == 24 * 1000
    assert view["summary"]["actual_mwh"] == pytest.approx(24 * 900)
    assert view["summary"]["p50_mwh"] == pytest.approx(24 * 900)
    assert view["metrics"]["bias"] == -100
    assert view["calibrated_metrics"]["bias"] == pytest.approx(0)
    # forecast only exists on the hour; half-hours stay empty rather than interpolated
    assert view["series"][1]["forecast"] is None


def test_horizon_view_respects_minimum_lead_time():
    target = dt("2026-01-15T12:00")
    store = WindDataStore(
        [
            ForecastPoint(dt("2026-01-15T02:30"), target, 1000),  # 9.5 h ahead
            ForecastPoint(dt("2026-01-15T09:30"), target, 2000),  # 2.5 h ahead
        ],
        [ActualPoint(target, 1500)],
    )
    four_h = analytics.horizon_view(store, target, target + timedelta(minutes=30), 4)
    assert four_h["series"][0]["forecast"] == 1000
    two_h = analytics.horizon_view(store, target, target + timedelta(minutes=30), 2)
    assert two_h["series"][0]["forecast"] == 2000

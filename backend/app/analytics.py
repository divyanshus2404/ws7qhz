"""Pure functions that turn the store into the views and accuracy numbers the UI shows.

Conventions
- error = actual - forecast (MW). Positive => wind beat the forecast (over-procured).
- "Decision forecast" for delivery day D = latest forecast published at or before the
  day-ahead cutoff on D-1 (default 11:00 UK). That is what the desk really trades on.
- WINDFOR is hourly and FUELHH half-hourly; errors are only measured at timestamps where
  both exist (the top of each hour), never on interpolated values.
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta

from . import config
from .models import UK, Pair, iso
from .store import WindDataStore

# ---- statistics helpers ------------------------------------------------------------


def percentile(values: list[float], q: float) -> float:
    """Linear-interpolated percentile (same as numpy's default), q in [0, 1]."""
    if not values:
        raise ValueError("percentile of empty list")
    s = sorted(values)
    pos = (len(s) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def error_metrics(pairs: list[Pair]) -> dict | None:
    if not pairs:
        return None
    errors = [p.error for p in pairs]
    abs_errors = [abs(e) for e in errors]
    actual_sum = sum(p.actual for p in pairs)
    n = len(errors)
    return {
        "n": n,
        "mae": sum(abs_errors) / n,
        "rmse": math.sqrt(sum(e * e for e in errors) / n),
        "bias": sum(errors) / n,
        # WAPE: total absolute error relative to total actual wind. Robust when wind is low.
        "wape": sum(abs_errors) / actual_sum if actual_sum else None,
        "p50_abs": percentile(abs_errors, 0.5),
        "p90_abs": percentile(abs_errors, 0.9),
        "p99_abs": percentile(abs_errors, 0.99),
        "max_abs": max(abs_errors),
        "error_p10": percentile(errors, 0.1),
        "error_p90": percentile(errors, 0.9),
    }


# ---- time helpers ------------------------------------------------------------------


def uk_midnight(d: date) -> datetime:
    return datetime.combine(d, time(0), tzinfo=UK).astimezone(UTC)


def decision_cutoff(delivery: date, cutoff: time = config.DEFAULT_DECISION_CUTOFF) -> datetime:
    """UTC instant of the day-ahead decision for `delivery` (cutoff UK time on D-1)."""
    return datetime.combine(delivery - timedelta(days=1), cutoff, tzinfo=UK).astimezone(UTC)


def delivery_slots(delivery: date, step_minutes: int) -> list[datetime]:
    """UTC start times covering the UK-local delivery day (handles 23/25h clock-change days)."""
    start, end = uk_midnight(delivery), uk_midnight(delivery + timedelta(days=1))
    out, t = [], start
    while t < end:
        out.append(t)
        t += timedelta(minutes=step_minutes)
    return out


def delivery_days() -> list[date]:
    n = (config.LAST_DELIVERY - config.FIRST_DELIVERY).days + 1
    return [config.FIRST_DELIVERY + timedelta(days=i) for i in range(n)]


# ---- decision forecasts ------------------------------------------------------------


def decision_pairs(store: WindDataStore, delivery: date, cutoff: time) -> list[Pair]:
    """Decision forecast for each hour of `delivery`, matched to its actual."""
    as_of = decision_cutoff(delivery, cutoff)
    out = []
    for target in delivery_slots(delivery, 60):
        f = store.latest_forecast(target, as_of)
        actual = store.actual(target)
        if f is not None and actual is not None:
            out.append(Pair(f.publish_time, target, f.generation, actual))
    return out


def calibration(store: WindDataStore, delivery: date, cutoff: time) -> dict | None:
    """P10/P50/P90 of decision-forecast errors over the trailing calibration window.

    Only delivery days that had fully settled by the decision (D-2 and earlier) are used,
    so the numbers shown for a day never peek at its own (or any later) outturn."""
    window = [delivery - timedelta(days=k) for k in range(2, 2 + config.CALIBRATION_DAYS)]
    errors = [p.error for d in window for p in decision_pairs(store, d, cutoff)]
    if len(errors) < 24 * 3:
        return None
    q10, q50, q90 = (percentile(errors, q) for q in config.QUANTILES)
    return {
        "p10_error": q10,
        "p50_error": q50,
        "p90_error": q90,
        "sample_size": len(errors),
        "window": [window[-1].isoformat(), window[0].isoformat()],
    }


def apply_calibration(forecast: float, cal: dict) -> dict:
    """Turn a raw forecast into a P10/P50/P90 wind range (MW, never below zero)."""
    return {
        "p10": max(forecast + cal["p10_error"], 0.0),
        "p50": max(forecast + cal["p50_error"], 0.0),
        "p90": max(forecast + cal["p90_error"], 0.0),
    }


def day_ahead_view(store: WindDataStore, delivery: date, cutoff: time, demand_mw: float | None = None) -> dict:
    as_of = decision_cutoff(delivery, cutoff)
    publication = store.latest_publication(as_of)
    cal = calibration(store, delivery, cutoff)

    hourly: dict[datetime, float] = {}
    for target in delivery_slots(delivery, 60):
        f = store.latest_forecast(target, as_of)
        if f is not None:
            hourly[target] = f.generation
    ranged = {t: apply_calibration(v, cal) for t, v in hourly.items()} if cal else {}

    series = []
    for t in delivery_slots(delivery, 30):
        row = {"time": iso(t), "actual": store.actual(t), "forecast": hourly.get(t)}
        row.update(ranged.get(t, {"p10": None, "p50": None, "p90": None}))
        series.append(row)

    actuals = [r["actual"] for r in series if r["actual"] is not None]

    def energy(key: str) -> float | None:  # hourly MW x 1 h = MWh
        return sum(r[key] for r in ranged.values()) if ranged else None

    summary = {
        "forecast_mwh": sum(hourly.values()) if hourly else None,
        "p10_mwh": energy("p10"),
        "p50_mwh": energy("p50"),
        "p90_mwh": energy("p90"),
        # half-hourly MW x 0.5 h; only reported once the whole day has settled
        "actual_mwh": sum(actuals) * 0.5 if len(actuals) == len(series) else None,
        "peak_forecast_mw": max(hourly.values()) if hourly else None,
        "min_forecast_mw": min(hourly.values()) if hourly else None,
    }
    pairs = decision_pairs(store, delivery, cutoff)

    return {
        "delivery_date": delivery.isoformat(),
        "decision_cutoff": iso(as_of),
        "forecast_published": iso(publication) if publication else None,
        "horizon_hours": _horizon_range(pairs),
        "calibration": cal,
        "series": series,
        "summary": summary,
        "metrics": error_metrics(pairs),
        "calibrated_metrics": error_metrics(_calibrated(pairs, cal)) if cal else None,
        "vintages": _vintages(store, delivery),
        "procurement": procurement(store, hourly, ranged, demand_mw) if demand_mw is not None else None,
    }


def procurement(
    store: WindDataStore, hourly: dict[datetime, float], ranged: dict[datetime, dict], demand_mw: float
) -> dict:
    """Volume to buy beyond wind for a flat demand, at each confidence level.

    Buying against P50 wind is the expected need; buying against P10 wind covers the
    shortfall in 9 days out of 10. The gap between them is the price of that cover.
    "Hindsight" uses actual wind at the same hourly timestamps."""

    def need(wind: float) -> float:
        return max(demand_mw - wind, 0.0)

    hours = sorted(hourly)
    raw = sum(need(hourly[t]) for t in hours)
    actuals = [store.actual(t) for t in hours]
    hindsight = sum(need(a) for a in actuals) if hours and all(a is not None for a in actuals) else None
    return {
        "demand_mw": demand_mw,
        "hours": len(hours),
        "raw_mwh": raw,
        "p50_mwh": sum(need(ranged[t]["p50"]) for t in hours) if ranged else None,
        "p10_mwh": sum(need(ranged[t]["p10"]) for t in hours) if ranged else None,
        "hindsight_mwh": hindsight,
        # Positive = buying against the raw forecast would have left the desk short.
        "raw_shortfall_mwh": hindsight - raw if hindsight is not None else None,
        "hourly": [
            {
                "time": iso(t),
                "raw": need(hourly[t]),
                "p50": need(ranged[t]["p50"]) if ranged else None,
                "p10": need(ranged[t]["p10"]) if ranged else None,
            }
            for t in hours
        ],
    }


def _calibrated(pairs: list[Pair], cal: dict) -> list[Pair]:
    """Same pairs with the forecast replaced by the calibrated P50."""
    return [Pair(p.publish_time, p.start_time, apply_calibration(p.forecast, cal)["p50"], p.actual) for p in pairs]


def _horizon_range(pairs: list[Pair]) -> list[float] | None:
    if not pairs:
        return None
    hs = [p.horizon_hours for p in pairs]
    return [min(hs), max(hs)]


def _vintages(store: WindDataStore, delivery: date) -> list[dict]:
    """Every publication that covered the delivery day before it began, so the UI can show
    how the forecast for that day evolved."""
    start, end = uk_midnight(delivery), uk_midnight(delivery + timedelta(days=1))
    out = []
    for publish_time in store.publish_times:
        if publish_time >= start:
            break
        points = [f for f in store.publication(publish_time) if start <= f.start_time < end]
        if points:
            out.append(
                {
                    "publish_time": iso(publish_time),
                    "points": [{"time": iso(f.start_time), "forecast": f.generation} for f in points],
                }
            )
    return out


# ---- fixed-horizon explorer --------------------------------------------------------


def horizon_view(store: WindDataStore, start: datetime, end: datetime, horizon_hours: float) -> dict:
    """For each target in [start, end) use the latest forecast published at least
    `horizon_hours` before it — the classic "what did we know H hours ahead" view."""
    lead = timedelta(hours=horizon_hours)
    series, pairs = [], []
    t = start
    while t < end:
        f = store.latest_forecast(t, t - lead) if t.minute == 0 else None
        actual = store.actual(t)
        series.append(
            {
                "time": iso(t),
                "actual": actual,
                "forecast": f.generation if f else None,
                "published": iso(f.publish_time) if f else None,
            }
        )
        if f is not None and actual is not None:
            pairs.append(Pair(f.publish_time, t, f.generation, actual))
        t += timedelta(minutes=30)
    return {"horizon_hours": horizon_hours, "series": series, "metrics": error_metrics(pairs)}


# ---- accuracy report ---------------------------------------------------------------


def accuracy_report(store: WindDataStore, cutoff: time) -> dict:
    raw: list[Pair] = []
    calibrated: list[Pair] = []
    inside_band = banded = 0
    daily = []
    for d in delivery_days():
        day_pairs = decision_pairs(store, d, cutoff)
        if not day_pairs:
            continue
        raw.extend(day_pairs)
        m = error_metrics(day_pairs)
        row = {
            "date": d.isoformat(),
            "mae": m["mae"],
            "bias": m["bias"],
            "calibrated_mae": None,
            "forecast_mwh": sum(p.forecast for p in day_pairs),
            "actual_mwh": sum(p.actual for p in day_pairs),
        }
        cal = calibration(store, d, cutoff)
        if cal:
            day_cal = _calibrated(day_pairs, cal)
            calibrated.extend(day_cal)
            row["calibrated_mae"] = error_metrics(day_cal)["mae"]
            for p in day_pairs:
                r = apply_calibration(p.forecast, cal)
                banded += 1
                inside_band += r["p10"] <= p.actual <= r["p90"]
        daily.append(row)

    by_hour: dict[int, list[Pair]] = defaultdict(list)
    for p in raw:
        by_hour[p.start_time.astimezone(UK).hour].append(p)

    return {
        "decision_cutoff_uk": cutoff.strftime("%H:%M"),
        "delivery_range": [config.FIRST_DELIVERY.isoformat(), config.LAST_DELIVERY.isoformat()],
        "overall": error_metrics(raw),
        "calibrated": error_metrics(calibrated),
        # Share of actuals that landed inside the P10-P90 range; 80% means well calibrated.
        "band_coverage": inside_band / banded if banded else None,
        "by_hour": [{"hour": h, **error_metrics(by_hour[h])} for h in sorted(by_hour)],
        "daily": daily,
        "histogram": _histogram([p.error for p in raw], bin_mw=500),
        "scatter": [{"forecast": p.forecast, "actual": p.actual} for p in raw],
        "by_horizon": horizon_profile(store),
    }


def horizon_profile(store: WindDataStore) -> list[dict]:
    """Accuracy of *every* forecast vintage, grouped by lead time, for target times in scope."""
    start, end = uk_midnight(config.FIRST_DELIVERY), uk_midnight(config.LAST_DELIVERY + timedelta(days=1))
    width = config.HORIZON_BUCKET_HOURS
    buckets: dict[int, list[Pair]] = defaultdict(list)
    for p in store.pairs():
        if start <= p.start_time < end and p.horizon_hours < config.MAX_HORIZON_HOURS:
            buckets[int(p.horizon_hours // width)].append(p)
    return [
        {"horizon_from": b * width, "horizon_to": (b + 1) * width, **error_metrics(buckets[b])} for b in sorted(buckets)
    ]


def _histogram(values: list[float], bin_mw: int) -> list[dict]:
    if not values:
        return []
    counts: dict[int, int] = defaultdict(int)
    for v in values:
        counts[math.floor(v / bin_mw)] += 1
    lo, hi = min(counts), max(counts)
    return [{"from": b * bin_mw, "to": (b + 1) * bin_mw, "count": counts.get(b, 0)} for b in range(lo, hi + 1)]

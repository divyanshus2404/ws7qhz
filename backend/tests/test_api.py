"""Smoke tests against the committed January 2026 snapshot."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_meta_reports_scope():
    body = client.get("/api/meta").json()
    assert body["delivery_range"] == ["2026-01-02", "2026-02-01"]
    assert body["publications"] > 0


def test_day_ahead_uses_forecast_published_before_gate_closure():
    body = client.get("/api/day-ahead", params={"delivery_date": "2026-01-15"}).json()
    assert body["decision_cutoff"] == "2026-01-14T11:00:00Z"
    assert body["forecast_published"] <= body["decision_cutoff"]
    assert len(body["series"]) == 48
    assert body["calibration"] is not None


def test_day_ahead_rejects_out_of_scope_dates_and_bad_cutoffs():
    assert client.get("/api/day-ahead", params={"delivery_date": "2025-06-01"}).status_code == 422
    assert (
        client.get("/api/day-ahead", params={"delivery_date": "2026-01-15", "cutoff": "25:00"}).status_code == 422
    )


def test_forecast_explorer():
    body = client.get(
        "/api/forecast", params={"start": "2026-01-10", "end": "2026-01-11", "horizon_hours": 12}
    ).json()
    assert len(body["series"]) == 96
    assert body["metrics"]["n"] > 0


def test_accuracy_report():
    body = client.get("/api/accuracy").json()
    assert body["overall"]["n"] == 31 * 24
    assert 0 <= body["band_coverage"] <= 1
    assert body["by_horizon"][0]["horizon_from"] == 0

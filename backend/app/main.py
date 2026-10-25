"""HTTP layer. Validates inputs, delegates to `analytics`, and (in Docker) serves the built UI."""

from __future__ import annotations

import os
from datetime import date, time, timedelta
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import analytics, config
from .models import iso
from .store import get_store

app = FastAPI(title="Wind Forecast Desk API", version="1.0.0")
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)

CutoffParam = Query("11:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="Decision time on D-1, UK clock")


def _parse_cutoff(value: str) -> time:
    hh, mm = value.split(":")
    return time(int(hh), int(mm))


def _check_delivery(d: date) -> None:
    if not (config.FIRST_DELIVERY <= d <= config.LAST_DELIVERY):
        raise HTTPException(422, f"delivery_date must be between {config.FIRST_DELIVERY} and {config.LAST_DELIVERY}")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/meta")
def meta() -> dict:
    store = get_store()
    actuals = store.actuals_range
    return {
        "delivery_range": [config.FIRST_DELIVERY.isoformat(), config.LAST_DELIVERY.isoformat()],
        "default_cutoff_uk": config.DEFAULT_DECISION_CUTOFF.strftime("%H:%M"),
        "publications": len(store.publish_times),
        "publish_range": [iso(store.publish_times[0]), iso(store.publish_times[-1])] if store.publish_times else None,
        "actuals_range": [iso(actuals[0]), iso(actuals[1])] if actuals else None,
        "data_source": os.environ.get("DATA_SOURCE", "snapshot"),
    }


@app.get("/api/day-ahead")
def day_ahead(
    delivery_date: date,
    cutoff: str = CutoffParam,
    demand_mw: float | None = Query(None, ge=0, le=100_000, description="Flat demand to cover, MW"),
) -> dict:
    _check_delivery(delivery_date)
    return _day_ahead_cached(delivery_date, cutoff, demand_mw)


@lru_cache(maxsize=256)
def _day_ahead_cached(delivery_date: date, cutoff: str, demand_mw: float | None) -> dict:
    return analytics.day_ahead_view(get_store(), delivery_date, _parse_cutoff(cutoff), demand_mw)


@app.get("/api/forecast")
def forecast(
    start: date,
    end: date,
    horizon_hours: float = Query(4, ge=0, le=72),
) -> dict:
    """Fixed-horizon view for UK-local dates [start, end] inclusive."""
    if end < start:
        raise HTTPException(422, "end must not be before start")
    if (end - start).days > 31:
        raise HTTPException(422, "range is limited to 31 days")
    window_start = analytics.uk_midnight(start)
    window_end = analytics.uk_midnight(end + timedelta(days=1))
    return analytics.horizon_view(get_store(), window_start, window_end, horizon_hours)


@app.get("/api/accuracy")
def accuracy(cutoff: str = CutoffParam) -> dict:
    return _accuracy_cached(cutoff)


@lru_cache(maxsize=32)
def _accuracy_cached(cutoff: str) -> dict:
    return analytics.accuracy_report(get_store(), _parse_cutoff(cutoff))


# ---- static frontend (Docker / single-container deploys) ---------------------------

STATIC_DIR = Path(os.environ.get("STATIC_DIR", Path(__file__).resolve().parent.parent / "static"))

if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        candidate = (STATIC_DIR / path).resolve()
        if path and candidate.is_relative_to(STATIC_DIR.resolve()) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")

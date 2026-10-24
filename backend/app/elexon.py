"""Thin client for the two Elexon BMRS datasets the product uses.

FUELHH  - outturn generation by fuel type, half-hourly (we keep fuelType == WIND)
WINDFOR - national wind generation forecast, hourly, published ~8 times a day

Both are public, unauthenticated "stream" endpoints that return a flat JSON array.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import httpx

from .models import ActualPoint, ForecastPoint, parse_utc

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
# WINDFOR queries are chunked so a single request never asks for a huge window.
WINDFOR_CHUNK = timedelta(days=7)


def _get(client: httpx.Client, path: str, params: dict) -> list[dict]:
    for attempt in range(3):
        try:
            resp = client.get(f"{BASE_URL}/{path}", params=params, timeout=60)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError:
            if attempt == 2:
                raise
    return []


def fetch_wind_actuals(start: date, end: date) -> list[ActualPoint]:
    """Half-hourly wind outturn for settlement dates in [start, end]."""
    with httpx.Client() as client:
        rows = _get(
            client,
            "FUELHH/stream",
            {
                "settlementDateFrom": start.isoformat(),
                "settlementDateTo": end.isoformat(),
                "fuelType": "WIND",
            },
        )
    points = {
        r["startTime"]: ActualPoint(parse_utc(r["startTime"]), float(r["generation"]))
        for r in rows
        if r.get("fuelType") == "WIND" and r.get("generation") is not None
    }
    return sorted(points.values(), key=lambda p: p.start_time)


def fetch_wind_forecasts(publish_from: datetime, publish_to: datetime) -> list[ForecastPoint]:
    """Every wind forecast point whose publishTime is in [publish_from, publish_to)."""
    points: dict[tuple[str, str], ForecastPoint] = {}
    with httpx.Client() as client:
        cursor = publish_from
        while cursor < publish_to:
            chunk_end = min(cursor + WINDFOR_CHUNK, publish_to)
            rows = _get(
                client,
                "WINDFOR/stream",
                {
                    "publishDateTimeFrom": cursor.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "publishDateTimeTo": chunk_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                },
            )
            for r in rows:
                if r.get("generation") is None:
                    continue
                key = (r["publishTime"], r["startTime"])
                points[key] = ForecastPoint(
                    parse_utc(r["publishTime"]), parse_utc(r["startTime"]), float(r["generation"])
                )
            cursor = chunk_end
    return sorted(points.values(), key=lambda p: (p.publish_time, p.start_time))

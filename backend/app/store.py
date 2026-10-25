"""In-memory store of wind actuals and forecast vintages, indexed for "as-of" lookups.

The core question the product answers is: *for target time T, what was the latest
forecast available at decision time D?*  To make that cheap, forecasts are indexed by
target time, each holding its vintages sorted by publish time, so a lookup is a bisect.
"""

from __future__ import annotations

import csv
import os
from bisect import bisect_right
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from pathlib import Path

from .models import ActualPoint, ForecastPoint, Pair, iso, parse_utc

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
FORECASTS_CSV = "wind_forecasts.csv"
ACTUALS_CSV = "wind_actuals.csv"


class WindDataStore:
    def __init__(self, forecasts: list[ForecastPoint], actuals: list[ActualPoint]):
        self.actuals: dict[datetime, float] = {a.start_time: a.generation for a in actuals}

        by_publish: dict[datetime, list[ForecastPoint]] = defaultdict(list)
        by_target: dict[datetime, list[ForecastPoint]] = defaultdict(list)
        for f in forecasts:
            by_publish[f.publish_time].append(f)
            by_target[f.start_time].append(f)

        self.publish_times: list[datetime] = sorted(by_publish)
        self._by_publish = {p: sorted(v, key=lambda f: f.start_time) for p, v in by_publish.items()}
        # target -> (sorted publish times, matching forecasts) for bisect lookups
        self._by_target: dict[datetime, tuple[list[datetime], list[ForecastPoint]]] = {}
        for target, vintages in by_target.items():
            vintages.sort(key=lambda f: f.publish_time)
            self._by_target[target] = ([f.publish_time for f in vintages], vintages)

    # ---- lookups -------------------------------------------------------------------

    def latest_forecast(self, target: datetime, as_of: datetime) -> ForecastPoint | None:
        """Most recent forecast for `target` published at or before `as_of`."""
        entry = self._by_target.get(target)
        if entry is None:
            return None
        publish_times, vintages = entry
        idx = bisect_right(publish_times, as_of)
        return vintages[idx - 1] if idx else None

    def latest_publication(self, as_of: datetime) -> datetime | None:
        idx = bisect_right(self.publish_times, as_of)
        return self.publish_times[idx - 1] if idx else None

    def publication(self, publish_time: datetime) -> list[ForecastPoint]:
        return self._by_publish.get(publish_time, [])

    def actual(self, target: datetime) -> float | None:
        return self.actuals.get(target)

    def pairs(self) -> list[Pair]:
        """Every forecast point (horizon >= 0) that has a matching actual."""
        out = []
        for publish_time in self.publish_times:
            for f in self._by_publish[publish_time]:
                actual = self.actuals.get(f.start_time)
                if actual is not None and f.start_time >= publish_time:
                    out.append(Pair(publish_time, f.start_time, f.generation, actual))
        return out

    @property
    def actuals_range(self) -> tuple[datetime, datetime] | None:
        if not self.actuals:
            return None
        return min(self.actuals), max(self.actuals)


# ---- persistence -------------------------------------------------------------------


def save_snapshot(forecasts: list[ForecastPoint], actuals: list[ActualPoint], data_dir: Path = DATA_DIR) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    with open(data_dir / FORECASTS_CSV, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["publish_time", "start_time", "generation_mw"])
        for f in forecasts:
            w.writerow([iso(f.publish_time), iso(f.start_time), f"{f.generation:g}"])
    with open(data_dir / ACTUALS_CSV, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["start_time", "generation_mw"])
        for a in actuals:
            w.writerow([iso(a.start_time), f"{a.generation:g}"])


def load_snapshot(data_dir: Path = DATA_DIR) -> WindDataStore:
    with open(data_dir / FORECASTS_CSV, newline="") as fh:
        forecasts = [
            ForecastPoint(parse_utc(r["publish_time"]), parse_utc(r["start_time"]), float(r["generation_mw"]))
            for r in csv.DictReader(fh)
        ]
    with open(data_dir / ACTUALS_CSV, newline="") as fh:
        actuals = [ActualPoint(parse_utc(r["start_time"]), float(r["generation_mw"])) for r in csv.DictReader(fh)]
    return WindDataStore(forecasts, actuals)


def load_live(first_delivery: date, last_delivery: date) -> WindDataStore:
    """Pull straight from Elexon. Forecasts start 4 days before the first delivery day so
    every day has its full set of vintages; actuals cover every delivery day."""
    from . import elexon  # imported lazily so tests/snapshot mode never touch the network

    publish_from = datetime.combine(first_delivery - timedelta(days=4), datetime.min.time()).replace(tzinfo=UTC)
    publish_to = datetime.combine(last_delivery + timedelta(days=1), datetime.min.time()).replace(tzinfo=UTC)
    forecasts = elexon.fetch_wind_forecasts(publish_from, publish_to)
    actuals = elexon.fetch_wind_actuals(first_delivery - timedelta(days=1), last_delivery + timedelta(days=1))
    return WindDataStore(forecasts, actuals)


@lru_cache(maxsize=1)
def get_store() -> WindDataStore:
    from .config import HISTORY_START, LAST_DELIVERY

    if os.environ.get("DATA_SOURCE", "snapshot") == "live":
        return load_live(HISTORY_START, LAST_DELIVERY)
    return load_snapshot()

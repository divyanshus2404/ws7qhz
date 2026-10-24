from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

UK = ZoneInfo("Europe/London")


def parse_utc(value: str) -> datetime:
    """Parse an Elexon ISO timestamp ("2026-01-01T23:30:00Z") into an aware UTC datetime."""
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True, slots=True)
class ActualPoint:
    start_time: datetime
    generation: float  # MW, half-hourly average


@dataclass(frozen=True, slots=True)
class ForecastPoint:
    publish_time: datetime
    start_time: datetime
    generation: float  # MW, hourly


@dataclass(frozen=True, slots=True)
class Pair:
    """One forecast value matched to the actual outturn for the same target time."""

    publish_time: datetime
    start_time: datetime
    forecast: float
    actual: float

    @property
    def error(self) -> float:
        # Positive error = wind came in above forecast (forecast too low).
        return self.actual - self.forecast

    @property
    def horizon_hours(self) -> float:
        return (self.start_time - self.publish_time).total_seconds() / 3600

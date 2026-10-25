"""Refresh the committed data snapshot from Elexon.

    python -m scripts.fetch_snapshot        (run from backend/)

The app serves this snapshot by default so the demo is fast and deterministic; set
DATA_SOURCE=live to fetch from Elexon at startup instead.
"""

from app.config import HISTORY_START, LAST_DELIVERY
from app.models import ActualPoint
from app.store import DATA_DIR, load_live, save_snapshot


def main() -> None:
    store = load_live(HISTORY_START, LAST_DELIVERY)
    forecasts = [f for p in store.publish_times for f in store.publication(p)]
    actuals = [ActualPoint(t, g) for t, g in sorted(store.actuals.items())]
    save_snapshot(forecasts, actuals)
    print(
        f"Saved {len(forecasts)} forecast points from {len(store.publish_times)} publications "
        f"and {len(actuals)} actuals to {DATA_DIR}"
    )


if __name__ == "__main__":
    main()

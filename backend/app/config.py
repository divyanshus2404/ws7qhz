"""Business scope and market conventions, kept in one place so they are easy to review."""

from datetime import date, time, timedelta

# Purchase decisions made in January 2026 are for delivery days 2 Jan - 1 Feb 2026
# (the day-ahead auction on day D-1 buys power for day D).
FIRST_DELIVERY = date(2026, 1, 2)
LAST_DELIVERY = date(2026, 2, 1)

# GB day-ahead auctions (EPEX / N2EX) close at 11:00 UK time on D-1. The forecast a
# trader can actually use is the latest one published at or before this cutoff.
DEFAULT_DECISION_CUTOFF = time(11, 0)

# Calibration: the P10/P50/P90 wind range for day D is built from decision-forecast
# errors on the CALIBRATION_DAYS delivery days that had fully settled by the decision
# (D-2 and earlier), so it only uses information the desk had at the time.
CALIBRATION_DAYS = 14
QUANTILES = (0.10, 0.50, 0.90)

# Earliest delivery day whose data we need (for the first day's calibration window).
HISTORY_START = FIRST_DELIVERY - timedelta(days=CALIBRATION_DAYS + 1)

# Width of horizon buckets in the accuracy-vs-lead-time analysis.
HORIZON_BUCKET_HOURS = 3
MAX_HORIZON_HOURS = 72

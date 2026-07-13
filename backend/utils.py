import re
from datetime import datetime


def format_utc_datetime(value):
    return value.isoformat() + "Z" if value else None


def strip_html_tags(value: str) -> str:
    return re.sub(r"<[^>]*>", "", value).strip()


def compute_working_minutes(
    login_time: datetime,
    end_time: datetime,
    logs: list,
) -> tuple[int, int]:
    """Compute (working_minutes, offline_minutes) from pre-fetched activity logs.

    logs must already be filtered to [login_time, end_time] and ordered ascending.
    end_time is caller-supplied: use datetime.utcnow() for live sessions,
    or a specific timestamp (e.g. effective_logout) for closed sessions.
    """
    offline_minutes = 0
    offline_start = None
    for log in logs:
        if log.status == "offline" and offline_start is None:
            offline_start = log.timestamp
        elif log.status != "offline" and offline_start is not None:
            offline_minutes += round((log.timestamp - offline_start).total_seconds() / 60)
            offline_start = None
    if offline_start is not None:
        offline_minutes += round((end_time - offline_start).total_seconds() / 60)
    total_elapsed = int((end_time - login_time).total_seconds() // 60)
    working_minutes = max(0, total_elapsed - offline_minutes)
    return working_minutes, offline_minutes

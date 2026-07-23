import logging
import uuid
from datetime import datetime, timedelta, timezone

import requests
from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Reminder, User
from routers.calendar import get_valid_access_token
from utils import format_utc_datetime, strip_html_tags

logger = logging.getLogger(__name__)
router = APIRouter()

GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
EVENT_DURATION_MINUTES = 15
MAX_OFFSETS = 5
MAX_OFFSET_MINUTES = 10080  # 1 week - Google's own cap is 40320 (4 weeks)


class ReminderCreateBody(BaseModel):
    title: str
    description: str | None = None
    remind_at: datetime
    reminder_offsets: list[int] = []

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, v):
        if not v.strip():
            raise ValueError("Title cannot be empty")
        return v

    @field_validator("reminder_offsets")
    @classmethod
    def offsets_valid(cls, v):
        if len(v) > MAX_OFFSETS:
            raise ValueError(f"At most {MAX_OFFSETS} reminder offsets are allowed")
        for minutes in v:
            if minutes < 0 or minutes > MAX_OFFSET_MINUTES:
                raise ValueError(f"Offset minutes must be between 0 and {MAX_OFFSET_MINUTES}")
        return v


class ReminderEditBody(BaseModel):
    title: str | None = None
    description: str | None = None
    remind_at: datetime | None = None
    reminder_offsets: list[int] | None = None

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, v):
        if v is not None and not v.strip():
            raise ValueError("Title cannot be empty")
        return v

    @field_validator("reminder_offsets")
    @classmethod
    def offsets_valid(cls, v):
        if v is None:
            return v
        if len(v) > MAX_OFFSETS:
            raise ValueError(f"At most {MAX_OFFSETS} reminder offsets are allowed")
        for minutes in v:
            if minutes < 0 or minutes > MAX_OFFSET_MINUTES:
                raise ValueError(f"Offset minutes must be between 0 and {MAX_OFFSET_MINUTES}")
        return v


def _to_naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _build_calendar_event(title: str, description: str | None, remind_at: datetime, reminder_offsets: list[int]) -> dict:
    start_iso = format_utc_datetime(remind_at)
    end_iso = format_utc_datetime(remind_at + timedelta(minutes=EVENT_DURATION_MINUTES))
    return {
        "summary": title,
        "description": description or "",
        "start": {"dateTime": start_iso},
        "end": {"dateTime": end_iso},
        "reminders": {
            "useDefault": False,
            "overrides": [{"method": "popup", "minutes": minutes} for minutes in reminder_offsets],
        },
    }


def _create_google_event(access_token: str, event_body: dict) -> str | None:
    try:
        resp = requests.post(
            GOOGLE_CALENDAR_EVENTS_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            json=event_body,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("id")
    except requests.RequestException as exc:
        logger.error(f"Google Calendar event creation failed: {exc}")
        return None


def _update_google_event(access_token: str, event_id: str, event_body: dict) -> bool:
    try:
        resp = requests.patch(
            f"{GOOGLE_CALENDAR_EVENTS_URL}/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            json=event_body,
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except requests.RequestException as exc:
        logger.warning(f"Google Calendar event update failed for event {event_id}: {exc}")
        return False


def _delete_google_event(access_token: str, event_id: str) -> None:
    try:
        resp = requests.delete(
            f"{GOOGLE_CALENDAR_EVENTS_URL}/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        # 404/410 just means the event is already gone on Google's side - fine.
        if resp.status_code not in (200, 204, 404, 410):
            resp.raise_for_status()
    except requests.RequestException as exc:
        logger.warning(f"Google Calendar event delete failed for event {event_id}: {exc}")


def format_reminder(reminder: Reminder) -> dict:
    return {
        "id": str(reminder.id),
        "title": reminder.title,
        "description": reminder.description,
        "remind_at": format_utc_datetime(reminder.remind_at),
        "reminder_offsets": reminder.reminder_offsets,
        "status": reminder.status,
        "google_connected": reminder.google_event_id is not None,
        "failure_reason": reminder.failure_reason,
        "created_at": format_utc_datetime(reminder.created_at),
        "updated_at": format_utc_datetime(reminder.updated_at),
    }


@router.post("/reminders/")
def create_reminder(
    body: ReminderCreateBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    remind_at = _to_naive_utc(body.remind_at)
    if remind_at <= datetime.utcnow():
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Reminder date and time must be in the future",
        )

    title = strip_html_tags(body.title)
    description = strip_html_tags(body.description) if body.description else None

    reminder = Reminder(
        company_id=current_user.company_id,
        user_id=current_user.id,
        title=title,
        description=description,
        remind_at=remind_at,
        reminder_offsets=body.reminder_offsets,
    )

    access_token = get_valid_access_token(current_user, db)
    if access_token:
        event_body = _build_calendar_event(title, description, remind_at, body.reminder_offsets)
        reminder.google_event_id = _create_google_event(access_token, event_body)

    db.add(reminder)
    db.commit()
    db.refresh(reminder)
    return format_reminder(reminder)


@router.get("/reminders/")
def list_reminders(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reminders = (
        db.query(Reminder)
        .filter(Reminder.user_id == current_user.id)
        .order_by(Reminder.remind_at.desc())
        .all()
    )
    return [format_reminder(r) for r in reminders]


@router.patch("/reminders/{reminder_id}")
def edit_reminder(
    reminder_id: uuid.UUID,
    body: ReminderEditBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reminder = (
        db.query(Reminder)
        .filter(Reminder.id == reminder_id, Reminder.user_id == current_user.id)
        .first()
    )
    if not reminder:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Reminder not found")
    if reminder.status != "pending":
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Only pending reminders can be edited",
        )

    if body.title is not None:
        reminder.title = strip_html_tags(body.title)
    if body.description is not None:
        reminder.description = strip_html_tags(body.description)
    if body.remind_at is not None:
        new_remind_at = _to_naive_utc(body.remind_at)
        if new_remind_at <= datetime.utcnow():
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Reminder date and time must be in the future",
            )
        reminder.remind_at = new_remind_at
    if body.reminder_offsets is not None:
        reminder.reminder_offsets = body.reminder_offsets

    if reminder.google_event_id:
        access_token = get_valid_access_token(current_user, db)
        if access_token:
            event_body = _build_calendar_event(
                reminder.title, reminder.description, reminder.remind_at, reminder.reminder_offsets
            )
            synced = _update_google_event(access_token, reminder.google_event_id, event_body)
            if not synced:
                # Event may have been deleted on Google's side externally, or the
                # update call failed for another reason - clear the link so we
                # stop trying against a stale/missing event id, without failing
                # the local edit (our DB stays the source of truth).
                reminder.google_event_id = None

    db.commit()
    db.refresh(reminder)
    return format_reminder(reminder)


@router.delete("/reminders/{reminder_id}")
def delete_reminder(
    reminder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reminder = (
        db.query(Reminder)
        .filter(Reminder.id == reminder_id, Reminder.user_id == current_user.id)
        .first()
    )
    if not reminder:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Reminder not found")
    if reminder.status != "pending":
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Only pending reminders can be deleted",
        )

    if reminder.google_event_id:
        access_token = get_valid_access_token(current_user, db)
        if access_token:
            _delete_google_event(access_token, reminder.google_event_id)

    db.delete(reminder)
    db.commit()
    return {"ok": True}

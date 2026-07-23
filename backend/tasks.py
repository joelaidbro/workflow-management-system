import asyncio
import logging
import os
import zoneinfo
from datetime import datetime, timedelta, timezone

from database import SessionLocal
from models import ActivityLog, Attendance, Company, CurrentStatus, MachineToken, Reminder, Screenshot, User
from routers.notifications import send_push_to_user
from routers.platform import delete_company_data
from routers.settings import get_config
from utils import compute_working_minutes


async def offline_detection_task():
    logging.info("Offline detection task started")
    while True:
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            offline_cutoff = now - timedelta(minutes=2)
            stale_statuses = (
                db.query(CurrentStatus, User)
                .join(User, User.id == CurrentStatus.user_id)
                .filter(
                    CurrentStatus.updated_at < offline_cutoff,
                    CurrentStatus.status != "offline",
                )
                .all()
            )

            for current_status, user in stale_statuses:
                current_status.status = "offline"
                db.add(
                    ActivityLog(
                        company_id=user.company_id,
                        user_id=user.id,
                        status="offline",
                        timestamp=now,
                        machine_id=current_status.machine_id,
                    )
                )

            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

        await asyncio.sleep(60)


async def reminder_dispatch_task():
    """
    Runs every 60 s. Google Calendar's own notification is the primary delivery
    channel for a reminder and already happened synchronously when the reminder
    was created/edited (routers/reminders.py). This task is the in-app push
    fallback (routers/notifications.send_push_to_user - itself a no-op if the
    user is already visible via WebSocket or has no push subscription, neither
    of which counts as a dispatch failure) and the sweep that flips a reminder
    from "pending" to "sent" once its time has passed. "failed" is reserved for
    a genuine, unexpected error during dispatch - logged here with the reminder
    id and timestamp so it can be looked up without exposing internals to the
    user, who just sees a generic retry message in the UI.
    """
    logging.info("Reminder dispatch task started")
    while True:
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            due_reminders = (
                db.query(Reminder)
                .filter(Reminder.status == "pending", Reminder.remind_at <= now)
                .all()
            )

            for reminder in due_reminders:
                try:
                    await send_push_to_user(
                        str(reminder.user_id),
                        reminder.title,
                        reminder.description or "",
                    )
                    reminder.status = "sent"
                except Exception as exc:
                    reminder.status = "failed"
                    reminder.failure_reason = str(exc)
                    logging.error(
                        "Reminder dispatch failed for reminder %s (user %s) at %s: %s",
                        reminder.id,
                        reminder.user_id,
                        now.isoformat(),
                        exc,
                    )
                db.commit()
        except Exception:
            logging.exception("Error in reminder dispatch task")
            db.rollback()
        finally:
            db.close()

        await asyncio.sleep(60)


async def screenshot_cleanup_task():
    logging.info("Screenshot cleanup task started")
    while True:
        db = SessionLocal()
        try:
            cutoff = datetime.utcnow() - timedelta(hours=48)
            old_screenshots = (
                db.query(Screenshot)
                .filter(
                    Screenshot.captured_at < cutoff,
                    Screenshot.is_deleted == False,
                )
                .all()
            )

            for screenshot in old_screenshots:
                try:
                    full_path = os.path.join(
                        "/home/teams.aidbro.com/screenshots",
                        screenshot.file_path,
                    )
                    if os.path.exists(full_path):
                        os.remove(full_path)
                except Exception:
                    pass
                screenshot.is_deleted = True

            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

        await asyncio.sleep(3600)


async def company_deletion_task():
    logging.info("Company deletion task started")
    while True:
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            companies_to_delete = db.query(Company).filter(
                Company.is_deletion_pending == True,
                Company.deletion_scheduled_at <= now
            ).all()

            for company in companies_to_delete:
                logging.info(f"Auto-deleting company: {company.name}")
                delete_company_data(str(company.id), db)
                db.commit()
        except Exception as e:
            logging.exception(f"Error in company deletion task: {e}")
            db.rollback()
        finally:
            db.close()
        await asyncio.sleep(3600)


async def daily_reset_task():
    """
    Runs every 60 s. At 05:00–05:05 AM in each company's configured timezone,
    closes any open Attendance records left over from prior days (staff who never
    clicked "End My Day") and resets the corresponding session_active flag so the
    agent returns to standby on next poll.

    The session-status endpoint also guards this independently, but this task
    ensures the Attendance row is cleanly closed with accurate timestamps rather
    than left with logout_time=NULL indefinitely.
    """
    logging.info("Daily reset task started")
    # Track which companies have already been reset for the current local date
    # so we only run once per company per day even if the server restarts within
    # the 5-minute window.
    last_reset_dates: dict[str, object] = {}

    while True:
        db = SessionLocal()
        try:
            now_utc = datetime.now(tz=timezone.utc)

            companies = db.query(Company).filter(Company.is_active.is_(True)).all()
            for company in companies:
                company_config = get_config(company)
                tz_name = company_config.get("timezone", "UTC")

                try:
                    tz = zoneinfo.ZoneInfo(tz_name)
                except zoneinfo.ZoneInfoNotFoundError:
                    tz = zoneinfo.ZoneInfo("UTC")

                now_local = now_utc.astimezone(tz)
                local_date = now_local.date()
                local_hour = now_local.hour
                local_minute = now_local.minute

                company_key = str(company.id)
                if last_reset_dates.get(company_key) == local_date:
                    continue  # Already ran for this company today

                if not (local_hour == 5 and local_minute < 5):
                    continue  # Not in the 05:00–05:04 window yet

                last_reset_dates[company_key] = local_date

                # Find every machine token for this company that still claims
                # session_active=True.
                stale_tokens = (
                    db.query(MachineToken)
                    .filter(
                        MachineToken.company_id == company.id,
                        MachineToken.is_active.is_(True),
                        MachineToken.session_active.is_(True),
                    )
                    .all()
                )

                today_utc = now_utc.date()
                reset_count = 0

                for token in stale_tokens:
                    # Skip if the user has a legitimately open session for today
                    open_today = (
                        db.query(Attendance)
                        .filter(
                            Attendance.user_id == token.user_id,
                            Attendance.date == today_utc,
                            Attendance.logged_in.is_(True),
                            Attendance.logout_time.is_(None),
                        )
                        .first()
                    )
                    if open_today:
                        continue

                    # Find the most recent unclosed Attendance (from a prior day)
                    stale_att = (
                        db.query(Attendance)
                        .filter(
                            Attendance.user_id == token.user_id,
                            Attendance.logout_time.is_(None),
                        )
                        .order_by(Attendance.date.desc())
                        .first()
                    )

                    if stale_att:
                        # Use the last non-offline ActivityLog entry as the
                        # effective logout time (closest to when they stopped).
                        last_active = (
                            db.query(ActivityLog)
                            .filter(
                                ActivityLog.user_id == token.user_id,
                                ActivityLog.timestamp >= stale_att.login_time,
                                ActivityLog.status != "offline",
                            )
                            .order_by(ActivityLog.timestamp.desc())
                            .first()
                        )
                        effective_logout = (
                            last_active.timestamp if last_active else stale_att.login_time
                        )

                        # Reconstruct offline intervals between login and effective logout
                        logs = (
                            db.query(ActivityLog)
                            .filter(
                                ActivityLog.user_id == token.user_id,
                                ActivityLog.timestamp >= stale_att.login_time,
                                ActivityLog.timestamp <= effective_logout,
                            )
                            .order_by(ActivityLog.timestamp.asc())
                            .all()
                        )

                        working_minutes, offline_minutes = compute_working_minutes(
                            stale_att.login_time, effective_logout, logs
                        )

                        stale_att.logout_time = effective_logout
                        stale_att.working_minutes = working_minutes
                        stale_att.offline_minutes = offline_minutes
                        # is_present and report_submitted intentionally left as-is;
                        # admin can see this was auto-closed by the missing logout_time
                        # vs login_time discrepancy in the report.

                    # Reset the session flag
                    token.session_active = False

                    # Sync CurrentStatus to offline if it isn't already
                    cs = (
                        db.query(CurrentStatus)
                        .filter(CurrentStatus.user_id == token.user_id)
                        .first()
                    )
                    if cs and cs.status != "offline":
                        cs.status = "offline"
                        db.add(
                            ActivityLog(
                                company_id=company.id,
                                user_id=token.user_id,
                                status="offline",
                                timestamp=now_utc.replace(tzinfo=None),
                                machine_id=cs.machine_id,
                            )
                        )

                    reset_count += 1

                if reset_count:
                    db.commit()
                    logging.info(
                        "Daily reset: closed %d stale session(s) for company '%s' (%s)",
                        reset_count,
                        company.name,
                        tz_name,
                    )

        except Exception:
            logging.exception("Error in daily reset task")
            db.rollback()
        finally:
            db.close()

        await asyncio.sleep(60)

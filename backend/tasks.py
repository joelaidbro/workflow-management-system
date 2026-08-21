import asyncio
import logging
import os
import zoneinfo
from datetime import datetime, timedelta, timezone

from database import SessionLocal
from models import (
    ActivityLog,
    Attendance,
    Company,
    CurrentStatus,
    MachineToken,
    Reminder,
    Screenshot,
    Subscription,
    SubscriptionInvoice,
    User,
)
from routers.notifications import send_push_to_user, push_to_user_sync
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


async def subscription_billing_task():
    """
    Runs every 15 minutes. Drives the three subscription-lifecycle transitions
    that aren't triggered by a user action:
      1. active -> overdue: the current billing cycle's end has passed with no
         renewal payment. Generates the renewal invoice for the new cycle if
         one doesn't already exist, and notifies the super admin(s).
      2. overdue -> locked: PlatformSettings.grace_period_hours has elapsed
         since the cycle ended with still no payment. From this point,
         SubscriptionLockMiddleware (main.py) blocks mutating requests for
         everyone in the company except super_admin's own billing actions.
      3. expiry warning: a one-time push a few days before an active cycle
         ends, so paying on time doesn't come as a surprise. Tracked via
         Subscription.expiry_warning_sent_at so it only fires once per cycle.
    Imports routers.billing lazily (inside the function) to avoid import-order
    issues at module load time, mirroring how this module already imports
    routers.platform.delete_company_data at the top.
    """
    from routers.billing import compute_cycle_amount, get_billable_staff_count, get_or_create_platform_settings

    logging.info("Subscription billing task started")
    EXPIRY_WARNING_DAYS = 3

    while True:
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            settings = get_or_create_platform_settings(db)

            subscriptions = (
                db.query(Subscription)
                .filter(Subscription.status.in_(["active", "overdue"]))
                .all()
            )

            for subscription in subscriptions:
                company = db.query(Company).filter(Company.id == subscription.company_id).first()
                if not company:
                    continue

                # 1. Cycle ended, still marked active -> flip to overdue and
                #    generate the renewal invoice for the new cycle if needed.
                if subscription.status == "active" and now >= subscription.current_period_end:
                    existing_renewal = (
                        db.query(SubscriptionInvoice)
                        .filter(
                            SubscriptionInvoice.subscription_id == subscription.id,
                            SubscriptionInvoice.invoice_type == "renewal",
                            SubscriptionInvoice.status == "pending",
                        )
                        .first()
                    )
                    if not existing_renewal:
                        staff_count = get_billable_staff_count(company.id, db)
                        amount = compute_cycle_amount(settings, subscription.plan_type, staff_count)
                        db.add(
                            SubscriptionInvoice(
                                company_id=company.id,
                                subscription_id=subscription.id,
                                invoice_type="renewal",
                                amount=amount,
                                staff_count=staff_count,
                                period_start=subscription.current_period_end,
                                period_end=subscription.current_period_end,
                                due_at=subscription.current_period_end,
                                status="pending",
                            )
                        )
                    subscription.status = "overdue"
                    db.commit()

                    for super_admin in db.query(User).filter(
                        User.company_id == company.id, User.role == "super_admin", User.is_active.is_(True)
                    ):
                        push_to_user_sync(
                            str(super_admin.id),
                            "Subscription payment due",
                            f"Your plan has renewed and payment is due. Pay within "
                            f"{settings.grace_period_hours} hours to avoid losing access to actions.",
                        )
                    continue

                # 2. Grace period expired while overdue -> lock.
                if subscription.status == "overdue":
                    grace_deadline = subscription.current_period_end + timedelta(hours=settings.grace_period_hours)
                    if now >= grace_deadline:
                        subscription.status = "locked"
                        subscription.locked_at = now
                        db.commit()

                        for super_admin in db.query(User).filter(
                            User.company_id == company.id, User.role == "super_admin", User.is_active.is_(True)
                        ):
                            push_to_user_sync(
                                str(super_admin.id),
                                "Account locked - payment overdue",
                                "Your team can no longer take actions until the outstanding subscription "
                                "payment is made. Pay now from the Subscriptions page to restore access.",
                            )
                    continue

                # 3. One-time expiry warning a few days before an active cycle ends.
                if subscription.status == "active" and not subscription.expiry_warning_sent_at:
                    warn_at = subscription.current_period_end - timedelta(days=EXPIRY_WARNING_DAYS)
                    if now >= warn_at:
                        subscription.expiry_warning_sent_at = now
                        db.commit()

                        for super_admin in db.query(User).filter(
                            User.company_id == company.id, User.role == "super_admin", User.is_active.is_(True)
                        ):
                            push_to_user_sync(
                                str(super_admin.id),
                                "Subscription expiring soon",
                                f"Your plan renews in {days_until(subscription.current_period_end, now)} day(s). "
                                "No action needed if you're on track to pay at renewal.",
                            )

        except Exception:
            logging.exception("Error in subscription billing task")
            db.rollback()
        finally:
            db.close()

        await asyncio.sleep(900)


def days_until(target: datetime, now: datetime) -> int:
    return max(0, (target - now).days)

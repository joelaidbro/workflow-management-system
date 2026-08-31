import math
import uuid
from collections import defaultdict
from io import BytesIO
from datetime import date as date_type
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, require_staff, require_staff_or_admin, require_admin, require_super_admin
from utils import compute_working_minutes, format_utc_datetime, strip_html_tags
from routers.settings import compute_working_days_in_month, get_config, WEEKDAY_NAMES
from connection_manager import manager
from routers.notifications import push_to_user_sync
from database import get_db
from limiter import limiter
from models import ActivityLog, Attendance, Company, CurrentStatus, DailyReport, LeaveRequest, MachineToken, SalaryRecord, User
from team_scope import get_assigned_admin_ids, get_assigned_staff_ids

router = APIRouter()

VALID_WORK_MODES = {"wfh", "office"}


class StartDayRequest(BaseModel):
    work_mode: str


class EndDayRequest(BaseModel):
    report_content: str


class ReportReplyRequest(BaseModel):
    reply: str


class SalaryApprovalRequest(BaseModel):
    final_salary: Decimal
    remark: str | None = None


class BulkSalaryApprovalItem(BaseModel):
    user_id: str
    final_salary: Decimal
    remark: str | None = None


class BulkSalaryApprovalRequest(BaseModel):
    month: int
    year: int
    approvals: list[BulkSalaryApprovalItem]


def assert_month_is_approvable(month: int, year: int):
    """Salary can only be approved for a month that has fully finished —
    approving the current (still in-progress) or a future month would freeze
    a calculation based on incomplete attendance data."""
    today = datetime.utcnow().date()
    if (year, month) >= (today.year, today.month):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Salary can only be approved for a month that has already ended.",
        )


def get_month_range(month: int, year: int):
    if month < 1 or month > 12:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid month",
        )

    start_date = date_type(year, month, 1)
    if month == 12:
        end_date = date_type(year + 1, 1, 1)
    else:
        end_date = date_type(year, month + 1, 1)

    return start_date, end_date


def get_staff_for_attendance(user_id: str, current_user: User, db: Session):
    try:
        user_uuid = uuid.UUID(str(user_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user = (
        db.query(User)
        .filter(
            User.id == user_uuid,
            User.company_id == current_user.company_id,
            User.is_active.is_(True),
            User.role.in_(["staff", "admin"]),
        )
        .first()
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if current_user.role == "staff" and user.id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    if (
        current_user.role == "admin"
        and user.role == "staff"
        and user.id != current_user.id
        and user.id not in get_assigned_staff_ids(current_user.id, db)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user


def build_attendance_summary(user: User, month: int, year: int, db: Session):
    """Both `days_absent`/`days_present` and the per-day `attendance_records`
    calendar used to be built from *existing* Attendance rows only — a
    genuine no-show day never gets a row at all (rows are only created in
    start_day()), so it was silently excluded from every count and the
    calendar fell back to "No record" instead of "Absent". This walks the
    calendar the same way calculate_monthly_salary() does (bounded to
    elapsed days, working-day/holiday/approved-leave aware) and synthesizes
    an explicit absent/leave entry for every day that has no real
    Attendance row, so the two admin/staff views and the salary engine all
    agree on the same numbers."""
    start_date, end_date = get_month_range(month, year)
    records = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == user.id,
            Attendance.date >= start_date,
            Attendance.date < end_date,
        )
        .order_by(Attendance.date.asc())
        .all()
    )
    records_by_date = {record.date: record for record in records}

    company = db.query(Company).filter(Company.id == user.company_id).first()
    company_config = get_config(company) if company else {}
    working_days = company_config.get("working_days", ["monday", "tuesday", "wednesday", "thursday", "friday"])
    public_holidays = company_config.get("public_holidays", [])
    working_days_set = {d.lower() for d in working_days}
    holiday_dates = {h.get("date") for h in public_holidays}

    joining_date = user.joining_date.date() if user.joining_date else None
    period_start = max(start_date, joining_date) if joining_date else start_date
    # Bounded to "today" (inclusive) for a month still in progress, so future
    # days are never counted as absent — mirrors calculate_monthly_salary().
    period_end = min(end_date, datetime.utcnow().date() + timedelta(days=1))

    approved_leaves = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.user_id == user.id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date < period_end,
            LeaveRequest.end_date >= period_start,
        )
        .all()
    ) if period_start < period_end else []
    leave_dates = set()
    for leave in approved_leaves:
        d = max(leave.start_date, period_start)
        last = min(leave.end_date, period_end - timedelta(days=1))
        while d <= last:
            leave_dates.add(d)
            d += timedelta(days=1)

    total_working_days = 0
    days_present = 0
    days_absent = 0
    days_on_leave = 0
    attendance_records = []

    current = period_start
    while current < period_end:
        record = records_by_date.get(current)
        if WEEKDAY_NAMES[current.weekday()] not in working_days_set or current.isoformat() in holiday_dates:
            current += timedelta(days=1)
            continue

        total_working_days += 1

        if record:
            if record.is_present:
                days_present += 1
            elif current in leave_dates:
                days_on_leave += 1
            else:
                days_absent += 1
            attendance_records.append({
                "date": record.date,
                "is_present": record.is_present,
                "work_mode": "leave" if (not record.is_present and current in leave_dates) else record.work_mode,
                "working_minutes": record.working_minutes,
                "break_minutes": record.break_minutes,
                "idle_minutes": record.idle_minutes,
                "productive_minutes": record.productive_minutes,
                "overtime_minutes": record.overtime_minutes,
                "login_time": format_utc_datetime(record.login_time),
                "logout_time": format_utc_datetime(record.logout_time),
            })
        elif current in leave_dates:
            days_on_leave += 1
            attendance_records.append({
                "date": current,
                "is_present": False,
                "work_mode": "leave",
                "working_minutes": 0,
                "break_minutes": 0,
                "idle_minutes": 0,
                "productive_minutes": 0,
                "overtime_minutes": 0,
                "login_time": None,
                "logout_time": None,
            })
        else:
            days_absent += 1
            attendance_records.append({
                "date": current,
                "is_present": False,
                "work_mode": None,
                "working_minutes": 0,
                "break_minutes": 0,
                "idle_minutes": 0,
                "productive_minutes": 0,
                "overtime_minutes": 0,
                "login_time": None,
                "logout_time": None,
            })

        current += timedelta(days=1)

    return {
        "user_id": str(user.id),
        "full_name": user.full_name,
        "employee_id": user.employee_id,
        "email": user.email,
        "phone": user.phone,
        "department": user.department,
        "job_title": user.job_title,
        "work_type": user.work_type,
        "joining_date": format_utc_datetime(user.joining_date),
        "base_salary": float(user.base_salary) if user.base_salary else None,
        "month": month,
        "year": year,
        "total_working_days": total_working_days,
        "days_present": days_present,
        "days_absent": days_absent,
        "days_on_leave": days_on_leave,
        "total_working_minutes": sum(record.working_minutes or 0 for record in records),
        "total_break_minutes": sum(record.break_minutes or 0 for record in records),
        "total_meeting_minutes": sum(record.meeting_minutes or 0 for record in records),
        "total_idle_minutes": sum(record.idle_minutes or 0 for record in records),
        "total_offline_minutes": sum(record.offline_minutes or 0 for record in records),
        "total_productive_minutes": sum(record.productive_minutes or 0 for record in records),
        "total_overtime_minutes": sum(record.overtime_minutes or 0 for record in records),
        "working_days": working_days,
        "public_holidays": public_holidays,
        "attendance_records": attendance_records,
    }


def calculate_monthly_salary(user: User, month: int, year: int, db: Session) -> dict:
    """
    Company-configurable salary engine. Reads from Company.config:
      - salary_calculation_mode: "daily" | "hourly" | "custom"
      - salary_custom_split: "half" | "third" | "quarter" (custom mode only)
      - working_hours_per_day: hours counted as one full (100%) day

    Walks every working day of the month (per the weekly pattern minus public
    holidays), starting from the later of the 1st of the month or the user's
    joining date, and stopping at today for a month still in progress (so a
    mid-month preview doesn't count future days as absent). For each day:
      - a day inside an approved PAID leave earns a full day, no attendance
        needed (that's what "paid" means)
      - a day inside an approved UNPAID leave earns nothing
      - otherwise pay is derived from that day's Attendance.productive_minutes:
          "daily"  -> present ? full day : 0
          "hourly" -> continuous fraction of productive_minutes / full day
          "custom" -> stepped half/third/quarter, rounded UP to the nearest
                      part reached (rounds in the employee's favor)
    Each earned fraction is paid at base_salary / working_days_in_month, where
    working_days_in_month is the *whole* month's count — this is what makes a
    mid-month joiner correctly prorated (they simply can't earn fractions for
    days before they joined, while the denominator stays the full month).
    """
    company = db.query(Company).filter(Company.id == user.company_id).first()
    company_config = get_config(company) if company else {}

    mode = company_config.get("salary_calculation_mode", "daily")
    split = company_config.get("salary_custom_split", "quarter")
    working_hours_per_day = company_config.get("working_hours_per_day", 8) or 8
    full_day_minutes = working_hours_per_day * 60
    split_parts = {"half": 2, "third": 3, "quarter": 4}.get(split, 4)

    working_days_in_month = compute_working_days_in_month(company_config, month, year)
    base_salary = Decimal(user.base_salary or 0)
    per_day_rate = (
        (base_salary / Decimal(working_days_in_month)) if working_days_in_month else Decimal("0")
    )

    start_date, end_date = get_month_range(month, year)
    joining_date = user.joining_date.date() if user.joining_date else None
    period_start = max(start_date, joining_date) if joining_date else start_date
    period_end = min(end_date, datetime.utcnow().date() + timedelta(days=1))

    attendance_records = {
        r.date: r
        for r in db.query(Attendance)
        .filter(
            Attendance.user_id == user.id,
            Attendance.date >= period_start,
            Attendance.date < period_end,
        )
        .all()
    }

    leave_types_by_name = {lt.get("name"): lt for lt in company_config.get("leave_types", [])}
    approved_leaves = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.user_id == user.id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date < period_end,
            LeaveRequest.end_date >= period_start,
        )
        .all()
    )
    paid_leave_dates, unpaid_leave_dates = set(), set()
    for leave in approved_leaves:
        is_paid = leave_types_by_name.get(leave.leave_type, {}).get("is_paid", True)
        d = max(leave.start_date, period_start)
        last = min(leave.end_date, period_end - timedelta(days=1))
        while d <= last:
            (paid_leave_dates if is_paid else unpaid_leave_dates).add(d)
            d += timedelta(days=1)

    working_days_set = {
        d.lower() for d in company_config.get("working_days", ["monday", "tuesday", "wednesday", "thursday", "friday"])
    }
    holiday_dates = {h.get("date") for h in company_config.get("public_holidays", [])}

    day_breakdown = []
    total_fraction = Decimal("0")
    total_overtime_minutes = 0

    current = period_start
    while current < period_end:
        if WEEKDAY_NAMES[current.weekday()] not in working_days_set or current.isoformat() in holiday_dates:
            current += timedelta(days=1)
            continue

        if current in paid_leave_dates:
            fraction, day_status = Decimal("1"), "paid_leave"
        elif current in unpaid_leave_dates:
            fraction, day_status = Decimal("0"), "unpaid_leave"
        else:
            record = attendance_records.get(current)
            if not record or not record.is_present:
                fraction, day_status = Decimal("0"), "absent"
            else:
                productive = record.productive_minutes or 0
                total_overtime_minutes += record.overtime_minutes or 0
                if mode == "hourly":
                    fraction = (
                        min(Decimal("1"), Decimal(productive) / Decimal(full_day_minutes))
                        if full_day_minutes
                        else Decimal("0")
                    )
                elif mode == "custom":
                    part_length = full_day_minutes / split_parts if split_parts else full_day_minutes
                    parts_earned = min(split_parts, math.ceil(productive / part_length)) if part_length else 0
                    fraction = Decimal(parts_earned) / Decimal(split_parts)
                else:  # "daily"
                    fraction = Decimal("1")
                day_status = "present"

        total_fraction += fraction
        day_breakdown.append({"date": current.isoformat(), "status": day_status, "fraction": float(fraction)})
        current += timedelta(days=1)

    calculated_salary = (per_day_rate * total_fraction).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    return {
        "calculated_salary": calculated_salary,
        "base_salary": base_salary,
        "working_days_in_month": working_days_in_month,
        "days_earned": float(total_fraction),
        "per_day_rate": per_day_rate.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        "overtime_minutes": total_overtime_minutes,
        "day_breakdown": day_breakdown,
        "calculation_mode": mode,
        "calculation_snapshot": {
            "mode": mode,
            "custom_split": split if mode == "custom" else None,
            "working_hours_per_day": working_hours_per_day,
            "working_days_in_month": working_days_in_month,
            "days_earned": float(total_fraction),
            "base_salary": float(base_salary),
            "per_day_rate": float(per_day_rate),
            "overtime_minutes": total_overtime_minutes,
            "calculated_salary": float(calculated_salary),
        },
    }


def compute_live_working_minutes(user_id, login_time: datetime, db: Session) -> int:
    """Compute net working minutes from login_time to now, deducting offline intervals."""
    now = datetime.utcnow()
    logs = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.user_id == user_id,
            ActivityLog.timestamp >= login_time,
            ActivityLog.timestamp <= now,
        )
        .order_by(ActivityLog.timestamp.asc())
        .all()
    )
    working_minutes, _ = compute_working_minutes(login_time, now, logs)
    return working_minutes


@router.post("/attendance/start-day")
def start_day(
    start_data: StartDayRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff_or_admin(current_user)

    if start_data.work_mode not in VALID_WORK_MODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid work mode",
        )

    now = datetime.utcnow()
    today = now.date()

    from models import LeaveRequest
    approved_leave = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.user_id == current_user.id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= today,
            LeaveRequest.end_date >= today,
        )
        .first()
    )
    if approved_leave:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Start Day is not allowed while on approved leave.",
        )
    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == current_user.id,
            Attendance.date == today,
        )
        .first()
    )

    if attendance and attendance.logged_in:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Day already started",
        )

    if not attendance:
        attendance = Attendance(
            company_id=current_user.company_id,
            user_id=current_user.id,
            date=today,
            logged_in=True,
            login_time=now,
            work_mode=start_data.work_mode,
        )
        db.add(attendance)
    else:
        attendance.logged_in = True
        attendance.login_time = now
        attendance.work_mode = start_data.work_mode

    machine_token = (
        db.query(MachineToken)
        .filter(
            MachineToken.user_id == current_user.id,
            MachineToken.is_active.is_(True),
        )
        .first()
    )
    if machine_token:
        machine_token.session_active = True

    db.commit()

    return {
        "message": "Day started",
        "date": today.isoformat(),
        "work_mode": start_data.work_mode,
    }


@router.post("/attendance/end-day")
@limiter.limit("5/minute")
def end_day(
    request: Request,
    end_data: EndDayRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff_or_admin(current_user)

    report_content = strip_html_tags(end_data.report_content)
    if not report_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Report content must not be empty",
        )

    current_status = (
        db.query(CurrentStatus)
        .filter(CurrentStatus.user_id == current_user.id)
        .first()
    )
    if current_status and current_status.status == "break":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot end workday while on break. Please end your break first.",
        )

    if current_status and current_status.status == "meeting":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot end workday while in a meeting. Please end your meeting first.",
        )

    now = datetime.utcnow()
    today = now.date()
    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == current_user.id,
            Attendance.date == today,
        )
        .first()
    )

    if not attendance:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Day not started — please use start-day first",
        )

    if attendance.logout_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Day already ended",
        )

    if not attendance.logged_in:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Day not started — please use start-day first",
        )

    # Reconstruct offline periods from the activity log so powered-off gaps are
    # not counted as worked time.
    activity_logs = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.user_id == current_user.id,
            ActivityLog.timestamp >= attendance.login_time,
            ActivityLog.timestamp <= now,
        )
        .order_by(ActivityLog.timestamp.asc())
        .all()
    )

    working_minutes, offline_minutes = compute_working_minutes(attendance.login_time, now, activity_logs)

    # Flush any idle time still accumulating at the moment of end-day — if the
    # user was idle and clicks "End Day" directly (without the agent getting a
    # chance to send one more "active" heartbeat first), that final idle
    # stretch would otherwise never make it into idle_minutes at all.
    if current_status and current_status.status == "idle" and current_status.idle_started_at:
        idle_duration_minutes = round((now - current_status.idle_started_at).total_seconds() / 60)
        if idle_duration_minutes > 0:
            attendance.idle_minutes = (attendance.idle_minutes or 0) + idle_duration_minutes
        current_status.idle_started_at = None

    attendance.logout_time = now
    attendance.report_submitted = True
    attendance.is_present = True
    attendance.working_minutes = working_minutes
    attendance.offline_minutes = offline_minutes

    # productive_minutes = actual working hours, net of break and idle time
    # (meeting time counts as work, so it's not deducted). This is what the
    # salary engine uses — working_minutes above stays the raw shift span for
    # anything that still needs that figure.
    productive_minutes = max(
        0,
        working_minutes - (attendance.break_minutes or 0) - (attendance.idle_minutes or 0),
    )
    attendance.productive_minutes = productive_minutes

    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    company_config = get_config(company) if company else {}
    working_hours_per_day = company_config.get("working_hours_per_day", 8)
    full_day_minutes = working_hours_per_day * 60
    attendance.overtime_minutes = max(0, productive_minutes - full_day_minutes)

    db.add(
        DailyReport(
            company_id=current_user.company_id,
            user_id=current_user.id,
            report_date=today,
            content=report_content,
            submitted_at=now,
        )
    )

    machine_token = (
        db.query(MachineToken)
        .filter(
            MachineToken.user_id == current_user.id,
            MachineToken.is_active.is_(True),
        )
        .first()
    )
    if machine_token:
        machine_token.session_active = False

    db.commit()

    # super_admin always sees every report (unrestricted); a normal admin only
    # needs to know about reports from staff actually assigned to them.
    super_admin_ids = {
        row.id
        for row in db.query(User.id).filter(
            User.company_id == current_user.company_id,
            User.role == "super_admin",
            User.is_active.is_(True),
        ).all()
    }
    notify_ids = super_admin_ids | (
        get_assigned_admin_ids(current_user.id, db) if current_user.role == "staff" else set()
    )
    for admin_id in notify_ids:
        admin_id_str = str(admin_id)
        manager.notify_user_sync(admin_id_str, {"type": "notification", "kind": "new_report"})
        push_to_user_sync(admin_id_str, "New Work Report", f"{current_user.full_name} submitted their daily report")

    return {
        "message": "Day ended successfully",
        "working_minutes": working_minutes,
        "report_submitted": True,
    }


@router.get("/attendance/today")
def get_today_attendance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = datetime.utcnow().date()
    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == current_user.id,
            Attendance.date == today,
        )
        .first()
    )

    # Agent is considered connected if it polled session-status within the last 20 s
    # (session-status poll interval is 15 s; 5 s buffer). Heartbeats are suppressed
    # in standby, so we track presence via last_seen_at on the machine token instead.
    now = datetime.utcnow()
    machine_token_row = (
        db.query(MachineToken)
        .filter(
            MachineToken.user_id == current_user.id,
            MachineToken.is_active.is_(True),
        )
        .first()
    )
    agent_connected = bool(
        machine_token_row
        and machine_token_row.last_seen_at
        and (now - machine_token_row.last_seen_at).total_seconds() < 20
    )

    current_status_row = (
        db.query(CurrentStatus)
        .filter(CurrentStatus.user_id == current_user.id)
        .first()
    )

    if not attendance:
        return {"started": False, "agent_connected": agent_connected, "current_status": None, "break_started_at": None}

    # Live working minutes: subtract offline gaps for an active session; use the
    # stored value once the day is closed.
    if attendance.login_time and not attendance.logout_time:
        working_minutes_so_far = compute_live_working_minutes(
            current_user.id, attendance.login_time, db
        )
    else:
        working_minutes_so_far = attendance.working_minutes or 0

    return {
        "started": True,
        "id": str(attendance.id),
        "company_id": str(attendance.company_id),
        "user_id": str(attendance.user_id),
        "date": attendance.date,
        "logged_in": attendance.logged_in,
        "report_submitted": attendance.report_submitted,
        "is_present": attendance.is_present,
        "work_mode": attendance.work_mode,
        "login_time": format_utc_datetime(attendance.login_time),
        "logout_time": format_utc_datetime(attendance.logout_time),
        "working_minutes": attendance.working_minutes,
        "working_minutes_so_far": working_minutes_so_far,
        "break_minutes": attendance.break_minutes,
        "meeting_minutes": attendance.meeting_minutes,
        "idle_minutes": attendance.idle_minutes,
        "offline_minutes": attendance.offline_minutes,
        "agent_connected": agent_connected,
        "current_status": current_status_row.status if current_status_row else None,
        "break_started_at": format_utc_datetime(current_status_row.break_started_at) if current_status_row else None,
    }


@router.get("/attendance/reports/my-reports")
def get_my_reports(
    month: int | None = None,
    year: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff_or_admin(current_user)

    now = datetime.utcnow()
    report_month = month or now.month
    report_year = year or now.year
    start_date, end_date = get_month_range(report_month, report_year)

    reports = (
        db.query(DailyReport)
        .filter(
            DailyReport.user_id == current_user.id,
            DailyReport.report_date >= start_date,
            DailyReport.report_date < end_date,
        )
        .order_by(DailyReport.report_date.desc())
        .all()
    )

    return [
        {
            "id": str(report.id),
            "report_date": report.report_date,
            "content": report.content,
            "submitted_at": format_utc_datetime(report.submitted_at),
            "admin_reply": report.admin_reply,
            "admin_reply_at": format_utc_datetime(report.admin_reply_at),
            "is_read_by_admin": report.is_read_by_admin,
        }
        for report in reports
    ]


@router.get("/attendance/reports/team")
def get_team_reports(
    date: str | None = None,
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    query = (
        db.query(DailyReport, User)
        .join(User, User.id == DailyReport.user_id)
        .filter(
            DailyReport.company_id == current_user.company_id,
            User.role == "staff",
        )
    )
    if current_user.role == "admin":
        query = query.filter(User.id.in_(get_assigned_staff_ids(current_user.id, db)))

    if date:
        try:
            report_date = date_type.fromisoformat(date)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date",
            )
        query = query.filter(DailyReport.report_date == report_date)

    if unread_only:
        query = query.filter(DailyReport.is_read_by_admin.is_(False))

    report_rows = query.order_by(DailyReport.submitted_at.desc()).all()

    response = [
        {
            "id": str(report.id),
            "report_date": report.report_date,
            "content": report.content,
            "submitted_at": format_utc_datetime(report.submitted_at),
            "admin_reply": report.admin_reply,
            "is_read_by_admin": report.is_read_by_admin,
            "full_name": staff.full_name,
            "employee_id": staff.employee_id,
        }
        for report, staff in report_rows
    ]

    for report, staff in report_rows:
        report.is_read_by_admin = True
    db.commit()

    return response


@router.post("/attendance/reports/{report_id}/reply")
def reply_to_report(
    report_id: str,
    reply_data: ReportReplyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    reply_text = strip_html_tags(reply_data.reply)
    if not reply_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reply must not be empty",
        )

    try:
        report_uuid = uuid.UUID(str(report_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )

    report = (
        db.query(DailyReport)
        .filter(
            DailyReport.id == report_uuid,
            DailyReport.company_id == current_user.company_id,
        )
        .first()
    )
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )

    if current_user.role == "admin" and report.user_id not in get_assigned_staff_ids(current_user.id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )

    if report.admin_reply is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Report already has a reply",
        )

    report.admin_reply = reply_text
    report.admin_reply_at = datetime.utcnow()
    report.replied_by = current_user.id
    db.commit()

    manager.notify_user_sync(str(report.user_id), {"type": "notification", "kind": "report_reply"})
    push_to_user_sync(str(report.user_id), "Report Reply", "Admin replied to your daily report")

    return {"message": "Reply submitted"}


@router.get("/attendance/export/team-excel")
def export_team_attendance_excel(
    month: int,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    require_admin(current_user)
    staff_query = db.query(User).filter(
        User.company_id == current_user.company_id,
        User.role == "staff",
        User.is_active.is_(True),
    )
    if current_user.role == "admin":
        staff_query = staff_query.filter(User.id.in_(get_assigned_staff_ids(current_user.id, db)))
    staff_members = staff_query.order_by(User.full_name.asc()).all()

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = f"Attendance {month}-{year}"

    headers = [
        "Full Name",
        "Employee ID",
        "Department",
        "Days Present",
        "Days Absent",
        "Total Working Hours",
        "Total Break Hours",
        "Base Salary",
        "Calculated Salary",
        "Salary Approved",
    ]
    worksheet.append(headers)

    header_fill = PatternFill("solid", fgColor="1E3A8A")
    header_font = Font(color="FFFFFF", bold=True)
    alternate_fill = PatternFill("solid", fgColor="F3F4F6")

    for cell in worksheet[1]:
        cell.fill = header_fill
        cell.font = header_font

    staff_ids = [s.id for s in staff_members]
    start_date, end_date = get_month_range(month, year)

    all_attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id.in_(staff_ids),
            Attendance.date >= start_date,
            Attendance.date < end_date,
        )
        .all()
    )
    attendance_by_user = defaultdict(list)
    for rec in all_attendance:
        attendance_by_user[rec.user_id].append(rec)

    all_salary_records = (
        db.query(SalaryRecord)
        .filter(
            SalaryRecord.user_id.in_(staff_ids),
            SalaryRecord.month == month,
            SalaryRecord.year == year,
        )
        .all()
    )
    salary_by_user = {str(r.user_id): r for r in all_salary_records}

    for staff in staff_members:
        records = attendance_by_user[staff.id]
        # Same calendar-walk as build_attendance_summary() — counting only
        # existing Attendance rows silently excluded genuine no-show days
        # (they never get a row) from "Days Absent", understating it here
        # the same way the dashboards used to.
        staff_summary = build_attendance_summary(staff, month, year, db)
        days_present = staff_summary["days_present"]
        days_absent = staff_summary["days_absent"]
        total_working_minutes = sum(r.working_minutes or 0 for r in records)
        total_break_minutes = sum(r.break_minutes or 0 for r in records)

        salary_record = salary_by_user.get(str(staff.id))
        # An approved month is history — use the frozen figure rather than
        # recalculating live, so the export always matches what was approved.
        if salary_record and salary_record.is_approved:
            calculated_salary = salary_record.final_salary or salary_record.calculated_salary or Decimal("0")
        else:
            calculated_salary = calculate_monthly_salary(staff, month, year, db)["calculated_salary"]

        worksheet.append(
            [
                staff.full_name,
                staff.employee_id,
                staff.department,
                days_present,
                days_absent,
                round(total_working_minutes / 60, 1),
                round(total_break_minutes / 60, 1),
                float(staff.base_salary or 0),
                float(calculated_salary),
                "Yes" if salary_record and salary_record.is_approved else "No",
            ]
        )

    for row in worksheet.iter_rows(min_row=2):
        if row[0].row % 2 == 0:
            for cell in row:
                cell.fill = alternate_fill

    for column_cells in worksheet.columns:
        max_length = max(
            len(str(cell.value)) if cell.value is not None else 0
            for cell in column_cells
        )
        worksheet.column_dimensions[get_column_letter(column_cells[0].column)].width = (
            max_length + 2
        )

    output = BytesIO()
    workbook.save(output)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": f"attachment; filename=attendance_{month}_{year}.xlsx"
        },
    )


@router.get("/attendance/export/salary-slip/{user_id}")
def export_salary_slip_pdf(
    user_id: str,
    month: int,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    staff = get_staff_for_attendance(user_id, current_user, db)
    salary_record = (
        db.query(SalaryRecord)
        .filter(
            SalaryRecord.user_id == staff.id,
            SalaryRecord.month == month,
            SalaryRecord.year == year,
            SalaryRecord.is_approved.is_(True),
        )
        .first()
    )
    if not salary_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Salary not yet approved for this period",
        )

    company = db.query(Company).filter(Company.id == staff.company_id).first()

    if current_user.role == "staff":
        company_config = get_config(company) if company else {}
        if not company_config.get("salary_visibility_to_staff", False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Salary information is not available to staff",
            )

    summary = build_attendance_summary(staff, month, year, db)

    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4)
    styles = getSampleStyleSheet()
    elements = [
        Paragraph(company.name if company else "Company", styles["Title"]),
        Paragraph("SALARY SLIP", styles["Heading1"]),
        Paragraph(f"Month: {month} / Year: {year}", styles["Normal"]),
        Spacer(1, 16),
        Paragraph(f"Full Name: {staff.full_name}", styles["Normal"]),
        Paragraph(f"Employee ID: {staff.employee_id}", styles["Normal"]),
        Paragraph(f"Department: {staff.department or 'N/A'}", styles["Normal"]),
        Paragraph(f"Job Title: {staff.job_title or 'N/A'}", styles["Normal"]),
        Spacer(1, 16),
    ]

    salary_table = Table(
        [
            ["Basic Salary", f"{salary_record.base_salary}"],
            ["Working Days in Month", summary["total_working_days"]],
            ["Days Present", summary["days_present"]],
            ["Days Absent", summary["days_absent"]],
            ["Calculated Salary", f"{salary_record.calculated_salary}"],
            ["Final Approved Salary", f"{salary_record.final_salary}"],
        ],
        colWidths=[220, 220],
    )
    salary_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, -1), (-1, -1), 13),
                ("BACKGROUND", (0, -1), (-1, -1), colors.whitesmoke),
                ("PADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    elements.extend(
        [
            salary_table,
            Spacer(1, 24),
            Paragraph("This is a computer generated document", styles["Italic"]),
        ]
    )

    document.build(elements)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"attachment; filename=salary_slip_{staff.employee_id}_{month}_{year}.pdf"
            )
        },
    )


@router.get("/attendance/summary/{user_id}")
def get_attendance_summary(
    user_id: str,
    month: int,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = get_staff_for_attendance(user_id, current_user, db)
    summary = build_attendance_summary(user, month, year, db)
    if current_user.role != "super_admin" and current_user.id != user.id:
        summary.pop("base_salary", None)
    return summary


@router.get("/attendance/salary/{user_id}")
def get_salary_calculation(
    user_id: str,
    month: int,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    user = get_staff_for_attendance(user_id, current_user, db)
    summary = build_attendance_summary(user, month, year, db)
    result = calculate_monthly_salary(user, month, year, db)
    salary_record = (
        db.query(SalaryRecord)
        .filter(
            SalaryRecord.user_id == user.id,
            SalaryRecord.month == month,
            SalaryRecord.year == year,
        )
        .first()
    )

    return {
        "user_id": str(user.id),
        "full_name": user.full_name,
        "month": month,
        "year": year,
        "base_salary": result["base_salary"],
        "total_working_days": summary["total_working_days"],
        "days_present": summary["days_present"],
        "working_days_in_month": result["working_days_in_month"],
        "days_earned": result["days_earned"],
        "per_day_rate": result["per_day_rate"],
        "overtime_minutes": result["overtime_minutes"],
        "calculation_mode": result["calculation_mode"],
        "day_breakdown": result["day_breakdown"],
        "calculated_salary": result["calculated_salary"],
        "final_salary": salary_record.final_salary if salary_record else None,
        "remark": salary_record.remark if salary_record else None,
        "is_approved": salary_record.is_approved if salary_record else False,
        "approved_by": str(salary_record.approved_by) if salary_record else None,
        "approved_at": format_utc_datetime(salary_record.approved_at)
        if salary_record
        else None,
        "is_approvable": (year, month) < (datetime.utcnow().year, datetime.utcnow().month),
    }


@router.get("/attendance/reports/unread-dates")
def get_reports_unread_dates(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    query = (
        db.query(DailyReport.report_date)
        .join(User, User.id == DailyReport.user_id)
        .filter(
            DailyReport.company_id == current_user.company_id,
            DailyReport.is_read_by_admin.is_(False),
            User.role == "staff",
        )
    )
    if current_user.role == "admin":
        query = query.filter(User.id.in_(get_assigned_staff_ids(current_user.id, db)))
    rows = query.distinct().all()
    return {"dates": sorted([row.report_date.isoformat() for row in rows], reverse=True)}


@router.get("/attendance/reports/unread-count")
def get_reports_unread_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    query = (
        db.query(DailyReport)
        .join(User, User.id == DailyReport.user_id)
        .filter(
            DailyReport.company_id == current_user.company_id,
            DailyReport.is_read_by_admin.is_(False),
            User.role == "staff",
        )
    )
    if current_user.role == "admin":
        query = query.filter(User.id.in_(get_assigned_staff_ids(current_user.id, db)))
    return {"count": query.count()}


@router.get("/attendance/reports/reply-count")
def get_reports_reply_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff(current_user)
    count = (
        db.query(DailyReport)
        .filter(
            DailyReport.user_id == current_user.id,
            DailyReport.admin_reply.isnot(None),
            DailyReport.is_read_by_staff.is_(False),
        )
        .count()
    )
    return {"count": count}


@router.patch("/attendance/reports/mark-read")
def mark_reports_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff(current_user)
    db.query(DailyReport).filter(
        DailyReport.user_id == current_user.id,
        DailyReport.is_read_by_staff.is_(False),
    ).update({"is_read_by_staff": True})
    db.commit()
    return {"ok": True}


@router.post("/attendance/salary/{user_id}/approve")
def approve_salary(
    user_id: str,
    month: int,
    year: int,
    approval_data: SalaryApprovalRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    assert_month_is_approvable(month, year)
    user = get_staff_for_attendance(user_id, current_user, db)
    result = calculate_monthly_salary(user, month, year, db)
    final_salary = approval_data.final_salary.quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )

    salary_record = (
        db.query(SalaryRecord)
        .filter(
            SalaryRecord.user_id == user.id,
            SalaryRecord.month == month,
            SalaryRecord.year == year,
        )
        .first()
    )

    if not salary_record:
        salary_record = SalaryRecord(
            company_id=user.company_id,
            user_id=user.id,
            month=month,
            year=year,
        )
        db.add(salary_record)

    # Once approved, a salary record is history — it freezes the formula and
    # inputs used, so it stays self-explanatory even if the company later
    # changes its salary settings. Re-approving (editing an already-approved
    # month) recalculates fresh, since that's a deliberate correction.
    salary_record.base_salary = result["base_salary"]
    salary_record.calculated_salary = result["calculated_salary"]
    salary_record.final_salary = final_salary
    salary_record.calculation_mode = result["calculation_mode"]
    salary_record.calculation_snapshot = result["calculation_snapshot"]
    salary_record.remark = approval_data.remark
    salary_record.is_approved = True
    salary_record.approved_by = current_user.id
    salary_record.approved_at = datetime.utcnow()
    salary_record.updated_at = datetime.utcnow()
    db.commit()

    return {
        "message": "Salary approved",
        "final_salary": final_salary,
    }


@router.get("/attendance/salary/team/overview")
def get_team_salary_overview(
    month: int,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One row per staff member for the given month — calculated salary,
    approval status, and (if approved) the final figure and any remark.
    Backs the bulk salary review/approve screen."""
    require_admin(current_user)

    staff_query = db.query(User).filter(
        User.company_id == current_user.company_id,
        User.role == "staff",
        User.is_active.is_(True),
    )
    if current_user.role == "admin":
        staff_query = staff_query.filter(User.id.in_(get_assigned_staff_ids(current_user.id, db)))
    staff_members = staff_query.order_by(User.full_name.asc()).all()

    staff_ids = [s.id for s in staff_members]
    salary_records = (
        db.query(SalaryRecord)
        .filter(
            SalaryRecord.user_id.in_(staff_ids),
            SalaryRecord.month == month,
            SalaryRecord.year == year,
        )
        .all()
    )
    salary_by_user = {str(r.user_id): r for r in salary_records}

    rows = []
    for staff in staff_members:
        record = salary_by_user.get(str(staff.id))
        if record and record.is_approved:
            rows.append({
                "user_id": str(staff.id),
                "full_name": staff.full_name,
                "employee_id": staff.employee_id,
                "base_salary": record.base_salary,
                "calculated_salary": record.calculated_salary,
                "final_salary": record.final_salary,
                "is_approved": True,
                "approved_at": format_utc_datetime(record.approved_at),
                "remark": record.remark,
                "calculation_mode": record.calculation_mode,
            })
        else:
            result = calculate_monthly_salary(staff, month, year, db)
            rows.append({
                "user_id": str(staff.id),
                "full_name": staff.full_name,
                "employee_id": staff.employee_id,
                "base_salary": result["base_salary"],
                "calculated_salary": result["calculated_salary"],
                "final_salary": None,
                "is_approved": False,
                "approved_at": None,
                "remark": None,
                "calculation_mode": result["calculation_mode"],
            })

    return {
        "month": month,
        "year": year,
        "is_approvable": (year, month) < (datetime.utcnow().year, datetime.utcnow().month),
        "staff": rows,
    }


@router.post("/attendance/salary/team/bulk-approve")
def bulk_approve_salary(
    payload: BulkSalaryApprovalRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    assert_month_is_approvable(payload.month, payload.year)

    approved, failed = [], []
    for item in payload.approvals:
        try:
            user = get_staff_for_attendance(item.user_id, current_user, db)
        except HTTPException:
            failed.append({"user_id": item.user_id, "detail": "User not found"})
            continue

        result = calculate_monthly_salary(user, payload.month, payload.year, db)
        final_salary = item.final_salary.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        salary_record = (
            db.query(SalaryRecord)
            .filter(
                SalaryRecord.user_id == user.id,
                SalaryRecord.month == payload.month,
                SalaryRecord.year == payload.year,
            )
            .first()
        )
        if not salary_record:
            salary_record = SalaryRecord(
                company_id=user.company_id,
                user_id=user.id,
                month=payload.month,
                year=payload.year,
            )
            db.add(salary_record)

        salary_record.base_salary = result["base_salary"]
        salary_record.calculated_salary = result["calculated_salary"]
        salary_record.final_salary = final_salary
        salary_record.calculation_mode = result["calculation_mode"]
        salary_record.calculation_snapshot = result["calculation_snapshot"]
        salary_record.remark = item.remark
        salary_record.is_approved = True
        salary_record.approved_by = current_user.id
        salary_record.approved_at = datetime.utcnow()
        salary_record.updated_at = datetime.utcnow()
        approved.append(item.user_id)

    db.commit()
    return {"approved": approved, "failed": failed}

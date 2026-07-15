import uuid
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin, require_staff_or_admin
from utils import compute_working_minutes, format_utc_datetime
from database import get_db
from models import ActivityLog, Attendance, CurrentStatus, User

router = APIRouter()

OFFLINE_GRACE_PERIOD = timedelta(minutes=2)
OFFLINE_EXEMPT_STATUSES = {"break", "meeting"}


def get_user_current_status(user_id, db):
    return db.query(CurrentStatus).filter(CurrentStatus.user_id == user_id).first()


def write_activity_log(user, status_value, timestamp, db):
    db.add(
        ActivityLog(
            company_id=user.company_id,
            user_id=user.id,
            status=status_value,
            timestamp=timestamp,
        )
    )


def calculate_status(current_status):
    if not current_status:
        return "offline"

    status_value = current_status.status
    if (
        current_status.updated_at
        and datetime.utcnow() - current_status.updated_at > OFFLINE_GRACE_PERIOD
        and status_value not in OFFLINE_EXEMPT_STATUSES
    ):
        return "offline"

    return status_value


def _compute_live_working_minutes(user_id, login_time, db=None, prefetched_logs=None) -> int:
    """Compute net working minutes from login_time to now, deducting offline gaps."""
    if not login_time:
        return 0
    now = datetime.utcnow()
    if prefetched_logs is not None:
        logs = prefetched_logs
    else:
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


def format_status_response(user, current_status, attendance=None, db=None, prefetched_logs=None):
    if attendance and attendance.login_time and not attendance.logout_time:
        working_minutes_so_far = _compute_live_working_minutes(
            user.id, attendance.login_time, db=db, prefetched_logs=prefetched_logs
        )
    elif attendance and attendance.logout_time:
        working_minutes_so_far = attendance.working_minutes or 0
    else:
        working_minutes_so_far = 0

    return {
        "user_id": str(user.id),
        "full_name": user.full_name,
        "employee_id": user.employee_id,
        "department": user.department,
        "role": user.role,
        "status": calculate_status(current_status),
        "updated_at": format_utc_datetime(current_status.updated_at)
        if current_status
        else None,
        "today_work_mode": attendance.work_mode if attendance else None,
        "break_started_at": (
            format_utc_datetime(current_status.break_started_at)
            if current_status
            else None
        ),
        "idle_minutes": attendance.idle_minutes if attendance else 0,
        "break_minutes": attendance.break_minutes or 0 if attendance else 0,
        "meeting_minutes": attendance.meeting_minutes or 0 if attendance else 0,
        "login_time": format_utc_datetime(attendance.login_time)
        if attendance and attendance.login_time
        else None,
        "working_minutes_so_far": working_minutes_so_far,
    }



@router.get("/status/team")
def get_team_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    today = datetime.utcnow().date()
    query = (
        db.query(User, CurrentStatus, Attendance)
        .outerjoin(CurrentStatus, CurrentStatus.user_id == User.id)
        .outerjoin(
            Attendance,
            (Attendance.user_id == User.id) & (Attendance.date == today),
        )
        .filter(
            User.company_id == current_user.company_id,
            User.is_active.is_(True),
        )
    )

    if current_user.role == "super_admin":
        query = query.filter(User.role.in_(["staff", "admin"]))
    else:
        query = query.filter(User.role == "staff")

    users_with_status = query.all()

    from collections import defaultdict
    active_rows = [
        (user, attendance)
        for user, current_status, attendance in users_with_status
        if attendance and attendance.login_time and not attendance.logout_time
    ]
    logs_by_user = defaultdict(list)
    if active_rows:
        min_login = min(a.login_time for _, a in active_rows)
        active_ids = [u.id for u, _ in active_rows]
        now = datetime.utcnow()
        batch_logs = (
            db.query(ActivityLog)
            .filter(
                ActivityLog.user_id.in_(active_ids),
                ActivityLog.timestamp >= min_login,
                ActivityLog.timestamp <= now,
            )
            .order_by(ActivityLog.timestamp.asc())
            .all()
        )
        for log in batch_logs:
            logs_by_user[log.user_id].append(log)

    return [
        format_status_response(
            user, current_status, attendance, db,
            prefetched_logs=logs_by_user.get(user.id) if (attendance and attendance.login_time and not attendance.logout_time) else None,
        )
        for user, current_status, attendance in users_with_status
    ]


@router.get("/status/user/{user_id}")
def get_user_status(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    try:
        requested_user_id = uuid.UUID(str(user_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user = db.query(User).filter(User.id == requested_user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if user.company_id != current_user.company_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    current_status = (
        db.query(CurrentStatus)
        .filter(CurrentStatus.user_id == user.id)
        .first()
    )

    today_start = datetime.combine(datetime.utcnow().date(), time.min)
    login_activity = (
        db.query(ActivityLog)
        .filter(
            ActivityLog.user_id == user.id,
            ActivityLog.timestamp >= today_start,
        )
        .order_by(ActivityLog.timestamp.asc())
        .first()
    )

    today = datetime.utcnow().date()
    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == user.id,
            Attendance.date == today,
        )
        .first()
    )

    response_data = format_status_response(user, current_status, attendance, db)
    response_data["login_time_today"] = (
        format_utc_datetime(login_activity.timestamp) if login_activity else None
    )
    return response_data


@router.post("/status/break/start")
def start_break(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff_or_admin(current_user)

    current_status = get_user_current_status(current_user.id, db)
    if not current_status:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please log in through the agent first",
        )

    if current_status.status == "break":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already on break",
        )

    today_attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == current_user.id,
            Attendance.date == datetime.utcnow().date(),
            Attendance.logged_in == True,
            Attendance.logout_time == None,
        )
        .first()
    )
    if not today_attendance:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please start your work day first",
        )

    if current_status.status == "meeting":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot start a break while in a meeting. Please end your meeting first.",
        )

    now = datetime.utcnow()
    current_status.status = "break"
    current_status.break_started_at = now
    current_status.updated_at = now
    write_activity_log(current_user, "break", now, db)
    db.commit()

    return {"status": "break", "break_started_at": format_utc_datetime(now)}


@router.post("/status/break/end")
def end_break(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff_or_admin(current_user)

    current_status = get_user_current_status(current_user.id, db)
    if not current_status or current_status.status != "break":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not currently on break",
        )

    now = datetime.utcnow()
    break_started_at = current_status.break_started_at or now
    break_duration_minutes = round((now - break_started_at).total_seconds() / 60)

    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == current_user.id,
            Attendance.date == now.date(),
        )
        .first()
    )
    if attendance:
        attendance.break_minutes = (attendance.break_minutes or 0) + break_duration_minutes

    current_status.status = "active"
    current_status.break_started_at = None
    current_status.updated_at = now
    write_activity_log(current_user, "active", now, db)
    db.commit()

    return {
        "status": "active",
        "break_duration_minutes": break_duration_minutes,
    }


@router.post("/status/meeting/start")
def start_meeting(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff_or_admin(current_user)

    current_status = get_user_current_status(current_user.id, db)
    if not current_status:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please log in through the agent first",
        )

    if current_status.status == "meeting":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already in a meeting",
        )

    today_attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == current_user.id,
            Attendance.date == datetime.utcnow().date(),
            Attendance.logged_in == True,
            Attendance.logout_time == None,
        )
        .first()
    )
    if not today_attendance:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please start your work day first",
        )

    if current_status.status == "break":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot start a meeting while on a break. Please end your break first.",
        )

    now = datetime.utcnow()
    current_status.status = "meeting"
    current_status.updated_at = now
    write_activity_log(current_user, "meeting", now, db)
    db.commit()

    return {"status": "meeting"}


@router.post("/status/meeting/end")
def end_meeting(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff_or_admin(current_user)

    current_status = get_user_current_status(current_user.id, db)
    if not current_status or current_status.status != "meeting":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not currently in a meeting",
        )

    now = datetime.utcnow()
    meeting_started_at = current_status.updated_at or now
    meeting_duration_minutes = round((now - meeting_started_at).total_seconds() / 60)

    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == current_user.id,
            Attendance.date == now.date(),
        )
        .first()
    )
    if attendance:
        attendance.meeting_minutes = (attendance.meeting_minutes or 0) + meeting_duration_minutes

    current_status.status = "active"
    current_status.updated_at = now
    write_activity_log(current_user, "active", now, db)
    db.commit()

    return {"status": "active", "meeting_duration_minutes": meeting_duration_minutes}


@router.post("/status/meeting/set-team")
def set_team_meeting(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    action = payload.get("action")
    if action not in {"start", "end"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid action",
        )

    user_ids = payload.get("user_ids") or []
    updated = 0
    skipped = 0
    now = datetime.utcnow()
    status_value = "meeting" if action == "start" else "active"

    parsed_ids = []
    for uid in user_ids:
        try:
            parsed_ids.append(uuid.UUID(str(uid)))
        except ValueError:
            skipped += 1

    users = (
        db.query(User)
        .filter(
            User.id.in_(parsed_ids),
            User.company_id == current_user.company_id,
            User.is_active.is_(True),
        )
        .all()
    )
    skipped += len(parsed_ids) - len(users)

    valid_user_ids = [u.id for u in users]
    users_by_id = {u.id: u for u in users}

    statuses = (
        db.query(CurrentStatus)
        .filter(CurrentStatus.user_id.in_(valid_user_ids))
        .all()
    )
    status_by_user = {cs.user_id: cs for cs in statuses}

    for uid in valid_user_ids:
        cs = status_by_user.get(uid)
        if not cs:
            skipped += 1
            continue
        cs.status = status_value
        cs.updated_at = now
        write_activity_log(users_by_id[uid], status_value, now, db)
        updated += 1

    db.commit()
    return {"updated": updated, "skipped": skipped}

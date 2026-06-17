import uuid
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import ActivityLog, Attendance, CurrentStatus, User

router = APIRouter()

ADMIN_ROLES = {"admin", "super_admin"}
OFFLINE_GRACE_PERIOD = timedelta(minutes=2)
OFFLINE_EXEMPT_STATUSES = {"break", "meeting"}
STAFF_ONLY_ROLES = {"staff"}
MEETING_ROLES = {"staff", "admin"}


def require_admin_user(current_user):
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )


def require_staff_user(current_user):
    if current_user.role not in STAFF_ONLY_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )


def require_meeting_user(current_user):
    if current_user.role not in MEETING_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )


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


def format_utc_datetime(value):
    return value.isoformat() + "Z" if value else None


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


def format_status_response(user, current_status):
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
        "today_work_mode": current_status.today_work_mode if current_status else None,
        "break_started_at": (
            format_utc_datetime(current_status.break_started_at)
            if current_status
            else None
        ),
    }


@router.get("/status/team")
def get_team_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin_user(current_user)

    query = (
        db.query(User, CurrentStatus)
        .outerjoin(CurrentStatus, CurrentStatus.user_id == User.id)
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
    return [
        format_status_response(user, current_status)
        for user, current_status in users_with_status
    ]


@router.get("/status/user/{user_id}")
def get_user_status(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin_user(current_user)

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

    response_data = format_status_response(user, current_status)
    response_data["login_time_today"] = (
        format_utc_datetime(login_activity.timestamp) if login_activity else None
    )
    return response_data


@router.post("/status/break/start")
def start_break(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff_user(current_user)

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
    require_staff_user(current_user)

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
    require_meeting_user(current_user)

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
    require_meeting_user(current_user)

    current_status = get_user_current_status(current_user.id, db)
    if not current_status or current_status.status != "meeting":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not currently in a meeting",
        )

    now = datetime.utcnow()
    current_status.status = "active"
    current_status.updated_at = now
    write_activity_log(current_user, "active", now, db)
    db.commit()

    return {"status": "active"}


@router.post("/status/meeting/set-team")
def set_team_meeting(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin_user(current_user)

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

    for user_id in user_ids:
        try:
            parsed_user_id = uuid.UUID(str(user_id))
        except ValueError:
            skipped += 1
            continue

        user = (
            db.query(User)
            .filter(
                User.id == parsed_user_id,
                User.company_id == current_user.company_id,
                User.is_active.is_(True),
            )
            .first()
        )
        if not user:
            skipped += 1
            continue

        current_status = get_user_current_status(user.id, db)
        if not current_status:
            skipped += 1
            continue

        current_status.status = status_value
        current_status.updated_at = now
        write_activity_log(user, status_value, now, db)
        updated += 1

    db.commit()
    return {"updated": updated, "skipped": skipped}

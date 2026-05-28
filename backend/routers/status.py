import uuid
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import ActivityLog, CurrentStatus, User

router = APIRouter()

ADMIN_ROLES = {"admin", "super_admin"}
OFFLINE_GRACE_PERIOD = timedelta(minutes=2)
OFFLINE_EXEMPT_STATUSES = {"break", "meeting"}


def require_admin_user(current_user):
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
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


def format_status_response(user, current_status):
    return {
        "user_id": str(user.id),
        "full_name": user.full_name,
        "employee_id": user.employee_id,
        "department": user.department,
        "role": user.role,
        "status": calculate_status(current_status),
        "updated_at": current_status.updated_at if current_status else None,
        "today_work_mode": current_status.today_work_mode if current_status else None,
        "break_started_at": (
            current_status.break_started_at if current_status else None
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
        login_activity.timestamp if login_activity else None
    )
    return response_data

import uuid
from collections import defaultdict
from datetime import date as date_type
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, require_staff, require_admin
from utils import format_utc_datetime
from routers.settings import get_config
from database import get_db
from models import Attendance, Company, LeaveRequest, User

router = APIRouter()

VALID_LEAVE_STATUSES = {"pending", "approved", "rejected"}
VALID_REVIEW_DECISIONS = {"approved", "rejected"}

DAY_NAME_TO_WEEKDAY = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}


class LeaveRequestBody(BaseModel):
    leave_type: str
    start_date: date_type
    end_date: date_type
    reason: str | None = None


class LeaveReviewBody(BaseModel):
    decision: str
    comment: str | None = None



def get_company_config(company_id, db: Session):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        return {}
    return get_config(company)


def get_leave_types(company_id, db: Session):
    leave_types = get_company_config(company_id, db).get("leave_types", [])
    return leave_types if isinstance(leave_types, list) else []


def calculate_total_days(start_date: date_type, end_date: date_type, working_day_numbers: set | None = None) -> int:
    total = 0
    current = start_date
    while current <= end_date:
        if working_day_numbers is None or current.weekday() in working_day_numbers:
            total += 1
        current += timedelta(days=1)
    return total


def get_staff_user(user_id: str, current_user: User, db: Session):
    try:
        user_uuid = uuid.UUID(str(user_id))
    except ValueError:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user = (
        db.query(User)
        .filter(
            User.id == user_uuid,
            User.company_id == current_user.company_id,
            User.is_active.is_(True),
            User.role == "staff",
        )
        .first()
    )
    if not user:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if current_user.role == "staff" and user.id != current_user.id:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    return user


def format_leave_request(leave_request: LeaveRequest):
    return {
        "id": str(leave_request.id),
        "company_id": str(leave_request.company_id),
        "user_id": str(leave_request.user_id),
        "leave_type": leave_request.leave_type,
        "start_date": leave_request.start_date,
        "end_date": leave_request.end_date,
        "total_days": leave_request.total_days,
        "reason": leave_request.reason,
        "status": leave_request.status,
        "reviewed_by": (
            str(leave_request.reviewed_by) if leave_request.reviewed_by else None
        ),
        "reviewed_at": format_utc_datetime(leave_request.reviewed_at),
        "admin_comment": leave_request.admin_comment,
        "created_at": format_utc_datetime(leave_request.created_at),
    }


@router.post("/leave/request")
def submit_leave_request(
    leave_data: LeaveRequestBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff(current_user)

    today = datetime.utcnow().date()
    if leave_data.start_date < today:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Start date cannot be in the past",
        )

    if leave_data.end_date < leave_data.start_date:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="End date cannot be before start date",
        )

    leave_types = get_leave_types(current_user.company_id, db)
    if leave_types:
        leave_type_names = {leave_type.get("name") for leave_type in leave_types}
        if leave_data.leave_type not in leave_type_names:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Invalid leave type",
            )

    overlapping_request = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.user_id == current_user.id,
            LeaveRequest.status != "rejected",
            LeaveRequest.start_date <= leave_data.end_date,
            LeaveRequest.end_date >= leave_data.start_date,
        )
        .first()
    )
    if overlapping_request:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="You already have a leave request for these dates",
        )

    total_days = calculate_total_days(leave_data.start_date, leave_data.end_date)
    leave_request = LeaveRequest(
        company_id=current_user.company_id,
        user_id=current_user.id,
        leave_type=leave_data.leave_type,
        start_date=leave_data.start_date,
        end_date=leave_data.end_date,
        total_days=total_days,
        reason=leave_data.reason,
        status="pending",
        created_at=datetime.utcnow(),
    )
    db.add(leave_request)
    db.commit()
    db.refresh(leave_request)

    return {
        "message": "Leave request submitted",
        "leave_request_id": str(leave_request.id),
        "total_days": leave_request.total_days,
        "status": leave_request.status,
    }


@router.get("/leave/my-requests")
def get_my_leave_requests(
    status: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(LeaveRequest).filter(LeaveRequest.user_id == current_user.id)

    if status:
        if status not in VALID_LEAVE_STATUSES:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Invalid status",
            )
        query = query.filter(LeaveRequest.status == status)

    leave_requests = query.order_by(LeaveRequest.created_at.desc()).all()
    return [
        {
            **format_leave_request(leave_request),
            "reviewed_by_name": (
                leave_request.reviewer.full_name if leave_request.reviewer else None
            ),
        }
        for leave_request in leave_requests
    ]


@router.get("/leave/team-requests")
def get_team_leave_requests(
    status: str = "pending",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    if status not in VALID_LEAVE_STATUSES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Invalid status",
        )

    leave_rows = (
        db.query(LeaveRequest, User)
        .join(User, User.id == LeaveRequest.user_id)
        .filter(
            LeaveRequest.company_id == current_user.company_id,
            LeaveRequest.status == status,
            User.role == "staff",
        )
        .order_by(LeaveRequest.created_at.asc())
        .all()
    )

    return [
        {
            **format_leave_request(leave_request),
            "full_name": staff.full_name,
            "employee_id": staff.employee_id,
        }
        for leave_request, staff in leave_rows
    ]


@router.post("/leave/requests/{request_id}/review")
def review_leave_request(
    request_id: str,
    review_data: LeaveReviewBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    if review_data.decision not in VALID_REVIEW_DECISIONS:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Invalid decision",
        )

    try:
        request_uuid = uuid.UUID(str(request_id))
    except ValueError:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Leave request not found",
        )

    leave_request = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.id == request_uuid,
            LeaveRequest.company_id == current_user.company_id,
        )
        .first()
    )
    if not leave_request:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Leave request not found",
        )

    if leave_request.status != "pending":
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="This request has already been reviewed",
        )

    leave_request.status = review_data.decision
    leave_request.reviewed_by = current_user.id
    leave_request.reviewed_at = datetime.utcnow()
    leave_request.admin_comment = review_data.comment
    total_days_affected = 0

    if review_data.decision == "approved":
        company_config = get_company_config(leave_request.company_id, db)
        raw_days = company_config.get("working_days", ["monday", "tuesday", "wednesday", "thursday", "friday"])
        working_day_numbers = {DAY_NAME_TO_WEEKDAY[d] for d in raw_days if d in DAY_NAME_TO_WEEKDAY}

        current_date = leave_request.start_date
        while current_date <= leave_request.end_date:
            if current_date.weekday() in working_day_numbers:
                attendance = (
                    db.query(Attendance)
                    .filter(
                        Attendance.user_id == leave_request.user_id,
                        Attendance.date == current_date,
                    )
                    .first()
                )
                if attendance:
                    attendance.is_present = True
                else:
                    db.add(
                        Attendance(
                            company_id=leave_request.company_id,
                            user_id=leave_request.user_id,
                            date=current_date,
                            logged_in=False,
                            report_submitted=False,
                            is_present=True,
                            work_mode="leave",
                        )
                    )
                total_days_affected += 1
            current_date += timedelta(days=1)

    db.commit()

    return {
        "message": f"Leave request {review_data.decision}",
        "total_days_affected": total_days_affected,
    }


@router.get("/leave/balance/{user_id}")
def get_leave_balance(
    user_id: str,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = get_staff_user(user_id, current_user, db)
    leave_types = get_leave_types(current_user.company_id, db)
    if not leave_types:
        return {
            "user_id": str(user.id),
            "full_name": user.full_name,
            "year": year,
            "balances": [],
        }

    company_config = get_company_config(current_user.company_id, db)
    raw_days = company_config.get("working_days", ["monday", "tuesday", "wednesday", "thursday", "friday"])
    working_day_numbers = {DAY_NAME_TO_WEEKDAY[d] for d in raw_days if d in DAY_NAME_TO_WEEKDAY}

    year_start = date_type(year, 1, 1)
    year_end = date_type(year, 12, 31)
    balances = []

    all_approved = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.user_id == user.id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= year_end,
            LeaveRequest.end_date >= year_start,
        )
        .all()
    )
    requests_by_type = defaultdict(list)
    for req in all_approved:
        requests_by_type[req.leave_type].append(req)

    for leave_type in leave_types:
        leave_type_name = leave_type.get("name")
        annual_limit = leave_type.get("annual_limit", 0)

        used_days = 0
        for leave_request in requests_by_type[leave_type_name]:
            counted_start = max(leave_request.start_date, year_start)
            counted_end = min(leave_request.end_date, year_end)
            used_days += calculate_total_days(counted_start, counted_end, working_day_numbers)

        balances.append(
            {
                "leave_type": leave_type_name,
                "annual_limit": annual_limit,
                "used_days": used_days,
                "remaining_days": annual_limit - used_days,
            }
        )

    return {
        "user_id": str(user.id),
        "full_name": user.full_name,
        "year": year,
        "balances": balances,
    }


@router.get("/leave/pending-count")
def get_leave_pending_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    count = (
        db.query(LeaveRequest)
        .join(User, User.id == LeaveRequest.user_id)
        .filter(
            LeaveRequest.company_id == current_user.company_id,
            LeaveRequest.status == "pending",
            User.role == "staff",
        )
        .count()
    )
    return {"count": count}


@router.get("/leave/decisions-count")
def get_leave_decisions_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff(current_user)
    count = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.user_id == current_user.id,
            LeaveRequest.status != "pending",
            LeaveRequest.is_read_by_staff.is_(False),
        )
        .count()
    )
    return {"count": count}


@router.patch("/leave/mark-read")
def mark_leave_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff(current_user)
    db.query(LeaveRequest).filter(
        LeaveRequest.user_id == current_user.id,
        LeaveRequest.is_read_by_staff.is_(False),
    ).update({"is_read_by_staff": True})
    db.commit()
    return {"ok": True}

from copy import deepcopy

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Company, User

router = APIRouter()

DEFAULT_CONFIG = {
    "idle_timeout_minutes": 10,
    "break_limit_minutes": 60,
    "log_retention_months": 6,
    "failed_login_lockout_attempts": 5,
    "lockout_duration_minutes": 30,
    "password_min_length": 8,
    "working_hours_start": "09:00",
    "working_hours_end": "18:00",
    "working_days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
    "alert_expiry_minutes": 120,
    "alert_sound_enabled": True,
    "push_notifications_enabled": False,
    "chat_enabled": True,
    "staff_to_staff_chat_enabled": True,
    "chat_visibility": "full",
    "read_receipts_enabled": True,
    "chat_retention_months": 6,
    "attendance_rule": "login_and_report",
    "working_days_per_month": 22,
    "salary_visibility_to_staff": False,
    "currency_symbol": "₹",
    "daily_report_enabled": True,
    "report_deadline_time": "21:00",
    "report_retention_months": 6,
    "leave_types": [],
    "half_day_leave_enabled": False,
    "leave_carry_forward": False,
    "screenshot_enabled": True,
    "screenshot_interval_seconds": 600,
    "monitoring_enabled": True,
    "timezone": "UTC",
}


class LeaveTypeRequest(BaseModel):
    name: str
    annual_limit: int
    carry_forward: bool = False


def require_super_admin(current_user: User):
    if current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )


def get_current_company(current_user: User, db: Session):
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )

    return company


def get_config(company: Company):
    if not company.config:
        return deepcopy(DEFAULT_CONFIG)

    config = deepcopy(DEFAULT_CONFIG)
    config.update(company.config)
    return config


@router.get("/settings/config")
def get_settings_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    company = get_current_company(current_user, db)
    return get_config(company)


@router.patch("/settings/config")
def update_settings_config(
    config_updates: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    company = get_current_company(current_user, db)
    config = get_config(company)
    config.update(config_updates)
    company.config = config
    db.commit()
    db.refresh(company)
    return get_config(company)


@router.post("/settings/leave-types")
def add_leave_type(
    leave_type_data: LeaveTypeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)

    leave_type_name = leave_type_data.name.strip()
    if not leave_type_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Leave type name is required",
        )

    if leave_type_data.annual_limit <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Annual limit must be greater than 0",
        )

    company = get_current_company(current_user, db)
    config = get_config(company)
    leave_types = config.get("leave_types", [])

    if any(leave_type.get("name") == leave_type_name for leave_type in leave_types):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Leave type already exists",
        )

    leave_types.append(
        {
            "name": leave_type_name,
            "annual_limit": leave_type_data.annual_limit,
            "carry_forward": leave_type_data.carry_forward,
        }
    )
    config["leave_types"] = leave_types
    company.config = config
    db.commit()

    return leave_types


@router.delete("/settings/leave-types/{leave_type_name}")
def delete_leave_type(
    leave_type_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    company = get_current_company(current_user, db)
    config = get_config(company)
    config["leave_types"] = [
        leave_type
        for leave_type in config.get("leave_types", [])
        if leave_type.get("name") != leave_type_name
    ]
    company.config = config
    db.commit()

    return {"message": "Leave type removed"}

import asyncio
import io
import os
from copy import deepcopy
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from auth import get_current_user, require_super_admin
from database import get_db
from models import Company, User

LOGOS_DIR = "/home/teams.aidbro.com/logos"
MAX_LOGO_BYTES = 2 * 1024 * 1024

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
    "public_holidays": [],
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


class PublicHolidayRequest(BaseModel):
    date: str
    name: str



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
    flag_modified(company, "config")
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
    flag_modified(company, "config")
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
    flag_modified(company, "config")
    db.commit()

    return {"message": "Leave type removed"}


@router.get("/settings/public-holidays")
def get_public_holidays(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    company = get_current_company(current_user, db)
    config = get_config(company)
    return config.get("public_holidays", [])


@router.post("/settings/public-holidays")
def add_public_holiday(
    holiday_data: PublicHolidayRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)

    holiday_date = holiday_data.date.strip()
    holiday_name = holiday_data.name.strip()

    try:
        datetime.strptime(holiday_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid date format. Use YYYY-MM-DD",
        )

    if not holiday_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Holiday name is required",
        )

    company = get_current_company(current_user, db)
    config = get_config(company)
    holidays = config.get("public_holidays", [])

    if any(h.get("date") == holiday_date for h in holidays):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A holiday already exists for this date",
        )

    holidays.append({"date": holiday_date, "name": holiday_name})
    holidays.sort(key=lambda h: h["date"])
    config["public_holidays"] = holidays
    company.config = config
    flag_modified(company, "config")
    db.commit()

    return holidays


@router.delete("/settings/public-holidays/{holiday_date}")
def delete_public_holiday(
    holiday_date: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    company = get_current_company(current_user, db)
    config = get_config(company)
    config["public_holidays"] = [
        h for h in config.get("public_holidays", [])
        if h.get("date") != holiday_date
    ]
    company.config = config
    flag_modified(company, "config")
    db.commit()
    return {"message": "Public holiday removed"}


@router.post("/settings/logo")
async def upload_logo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)

    if file.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only JPEG and PNG images are allowed",
        )

    contents = await file.read()
    if len(contents) > MAX_LOGO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size must be under 2MB",
        )

    company = get_current_company(current_user, db)

    logo_filename = f"{company.id}.png"
    logo_path = os.path.join(LOGOS_DIR, logo_filename)

    def _process_and_save(data, save_path):
        img = Image.open(io.BytesIO(data))
        img.thumbnail((400, 400))
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        img.save(save_path, "PNG")

    try:
        await asyncio.to_thread(_process_and_save, contents, logo_path)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image file",
        )

    company.logo_path = logo_filename
    db.commit()

    return {"url": "/api/settings/logo/file"}


@router.delete("/settings/logo")
def delete_logo(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    company = get_current_company(current_user, db)

    if company.logo_path:
        full_path = os.path.join(LOGOS_DIR, company.logo_path)
        if os.path.exists(full_path):
            os.remove(full_path)
        company.logo_path = None
        db.commit()

    return {"message": "Logo deleted"}


@router.get("/settings/logo/file")
def get_logo_file(company_id: str, db: Session = Depends(get_db)):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company or not company.logo_path:
        raise HTTPException(status_code=404, detail="Logo not found")

    logo_full_path = os.path.join(LOGOS_DIR, company.logo_path)
    if not os.path.exists(logo_full_path):
        raise HTTPException(status_code=404, detail="Logo not found")

    return FileResponse(logo_full_path, media_type="image/png")

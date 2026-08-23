import asyncio
import calendar
import io
import os
from copy import deepcopy
from datetime import date, datetime

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


def get_logo_version(company: Company) -> int | None:
    """File mtime as a cache-busting token — re-uploading a logo always
    overwrites the same filename, so the URL never changes on its own;
    callers append this as a query param so the browser sees a genuinely
    new URL instead of relying on cache headers alone."""
    if not company.logo_path:
        return None
    logo_full_path = os.path.join(LOGOS_DIR, company.logo_path)
    try:
        return int(os.path.getmtime(logo_full_path))
    except OSError:
        return None

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
    # --- Salary calculation (Phase 1 of the salary overhaul) ---
    # "working_days_per_month" used to be a flat manually-typed number with no
    # real connection to the calendar — replaced by compute_working_days_in_month()
    # below, derived live from working_days (the weekly pattern) + public_holidays.
    # Not stored here on purpose: it must always reflect the *current* pattern
    # and holiday list for whichever month is being calculated, not a stale
    # snapshot someone typed in once.
    "working_hours_per_day": 8,
    "salary_calculation_mode": "daily",  # "hourly" | "daily" | "custom"
    "salary_custom_split": "quarter",  # "half" | "third" | "quarter" — only used when mode == "custom"
    "overtime_enabled": False,
}

VALID_SALARY_MODES = {"hourly", "daily", "custom"}
VALID_SALARY_SPLITS = {"half", "third", "quarter"}
WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def compute_working_days_in_month(company_config: dict, month: int, year: int) -> int:
    """The single source of truth for 'how many working days are in this
    month' — derived from the weekly working-days pattern and the public
    holiday list, instead of the old flat manually-entered number. A holiday
    that falls on a day that's already a non-working day (e.g. a Sunday) is
    not double-subtracted, since it was never counted in the first place."""
    working_days_set = {
        d.lower() for d in company_config.get("working_days", DEFAULT_CONFIG["working_days"])
    }
    holiday_dates = {h.get("date") for h in company_config.get("public_holidays", [])}

    days_in_month = calendar.monthrange(year, month)[1]
    count = 0
    for day in range(1, days_in_month + 1):
        current_date = date(year, month, day)
        if WEEKDAY_NAMES[current_date.weekday()] not in working_days_set:
            continue
        if current_date.isoformat() in holiday_dates:
            continue
        count += 1
    return count


class LeaveTypeRequest(BaseModel):
    name: str
    annual_limit: int
    carry_forward: bool = False
    is_paid: bool = True
    allowance_period: str = "yearly"  # "yearly" | "monthly"


class UpdateLeaveTypeRequest(BaseModel):
    annual_limit: int | None = None
    carry_forward: bool | None = None
    is_paid: bool | None = None
    allowance_period: str | None = None


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

    if "salary_calculation_mode" in config_updates and config_updates["salary_calculation_mode"] not in VALID_SALARY_MODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"salary_calculation_mode must be one of {sorted(VALID_SALARY_MODES)}",
        )
    if "salary_custom_split" in config_updates and config_updates["salary_custom_split"] not in VALID_SALARY_SPLITS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"salary_custom_split must be one of {sorted(VALID_SALARY_SPLITS)}",
        )
    if "working_hours_per_day" in config_updates:
        try:
            hours = float(config_updates["working_hours_per_day"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="working_hours_per_day must be a number")
        if hours <= 0 or hours > 24:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="working_hours_per_day must be between 0 and 24")

    company = get_current_company(current_user, db)
    config = get_config(company)
    config.update(config_updates)
    company.config = config
    flag_modified(company, "config")
    db.commit()
    db.refresh(company)
    return get_config(company)


@router.get("/settings/working-days-in-month")
def get_working_days_in_month(
    month: int,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Read-only, computed live from working_days + public_holidays — this is
    what replaced the old flat manually-typed 'working days per month'
    number. Any role can read it (used for salary preview display), but only
    a super_admin can change the inputs that feed it (weekly pattern,
    holidays)."""
    if month < 1 or month > 12:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid month")

    company = get_current_company(current_user, db)
    config = get_config(company)
    return {"month": month, "year": year, "working_days_in_month": compute_working_days_in_month(config, month, year)}


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

    if leave_type_data.annual_limit < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Allowance cannot be negative — use 0 for a leave type with no paid allowance",
        )

    if leave_type_data.allowance_period not in {"yearly", "monthly"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="allowance_period must be 'yearly' or 'monthly'",
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
            "is_paid": leave_type_data.is_paid,
            "allowance_period": leave_type_data.allowance_period,
        }
    )
    config["leave_types"] = leave_types
    company.config = config
    flag_modified(company, "config")
    db.commit()

    return leave_types


@router.patch("/settings/leave-types/{leave_type_name}")
def update_leave_type(
    leave_type_name: str,
    updates: UpdateLeaveTypeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)

    update_data = updates.model_dump(exclude_unset=True)
    if "annual_limit" in update_data and update_data["annual_limit"] < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Allowance cannot be negative — use 0 for a leave type with no paid allowance",
        )
    if "allowance_period" in update_data and update_data["allowance_period"] not in {"yearly", "monthly"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="allowance_period must be 'yearly' or 'monthly'",
        )

    company = get_current_company(current_user, db)
    config = get_config(company)
    leave_types = config.get("leave_types", [])

    found = False
    for leave_type in leave_types:
        if leave_type.get("name") == leave_type_name:
            leave_type.update(update_data)
            found = True
            break

    if not found:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave type not found")

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

    # The upload endpoint always writes to the same filename, so the URL never
    # changes when a company replaces its logo — force revalidation on every
    # request (cheap: FileResponse still answers with 304 via ETag/Last-Modified
    # when the file is unchanged) instead of letting browsers cache it forever.
    return FileResponse(
        logo_full_path,
        media_type="image/png",
        headers={"Cache-Control": "no-cache"},
    )

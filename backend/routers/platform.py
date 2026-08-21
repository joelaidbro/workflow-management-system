from copy import deepcopy
from datetime import datetime, time, timedelta
import os
import secrets
import shutil
import string
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from auth import get_current_user, hash_password, require_platform_admin
from database import get_db
from models import (
    Alert, Company, CurrentStatus, Message, User,
    ActivityLog, AlertRecipient, Attendance, DailyReport,
    LeaveRequest, SalaryRecord, Screenshot, MachineToken,
    Session as SessionModel, Subscription, SubscriptionInvoice,
)
from routers.settings import DEFAULT_CONFIG

router = APIRouter()


class CreateCompanyRequest(BaseModel):
    company_name: str
    admin_full_name: str
    admin_email: str


def generate_temp_password(length: int = 16) -> str:
    """Server-generated credential — platform admins never choose or see
    another account's password ahead of time, only relay this one-time value."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


class UpdateCompanyRequest(BaseModel):
    name: str | None = None
    is_active: bool | None = None


def format_company(company: Company):
    return {
        "id": str(company.id),
        "name": company.name,
        "is_active": company.is_active,
        "created_at": company.created_at,
        "is_deletion_pending": company.is_deletion_pending,
        "deletion_requested_at": company.deletion_requested_at,
        "deletion_scheduled_at": company.deletion_scheduled_at,
    }


def get_company_or_404(company_id: str, db: Session):
    try:
        company_uuid = uuid.UUID(str(company_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )

    company = db.query(Company).filter(Company.id == company_uuid).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found",
        )
    return company


def format_user(user: User):
    return {
        "id": str(user.id),
        "company_id": str(user.company_id),
        "employee_id": user.employee_id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "department": user.department,
        "job_title": user.job_title,
        "role": user.role,
        "work_type": user.work_type,
        "base_salary": user.base_salary,
        "is_active": user.is_active,
        "joining_date": user.joining_date,
        "created_at": user.created_at,
    }


@router.get("/platform/companies")
def list_companies(
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    companies = db.query(Company).order_by(Company.created_at.desc()).all()
    company_ids = [c.id for c in companies]

    counts_rows = (
        db.query(
            User.company_id,
            func.count(case((User.role == "staff", 1))).label("staff_count"),
            func.count(case((User.role.in_(["admin", "super_admin"]), 1))).label("admin_count"),
        )
        .filter(User.is_active.is_(True), User.company_id.in_(company_ids))
        .group_by(User.company_id)
        .all()
    )
    counts_by_company = {str(row.company_id): row for row in counts_rows}

    last_active_rows = (
        db.query(
            User.company_id,
            func.max(CurrentStatus.updated_at).label("last_active"),
        )
        .join(User, User.id == CurrentStatus.user_id)
        .filter(User.company_id.in_(company_ids))
        .group_by(User.company_id)
        .all()
    )
    last_active_by_company = {str(row.company_id): row.last_active for row in last_active_rows}

    response = []
    for company in companies:
        cid = str(company.id)
        counts = counts_by_company.get(cid)
        response.append({
            **format_company(company),
            "staff_count": counts.staff_count if counts else 0,
            "admin_count": counts.admin_count if counts else 0,
            "last_active": last_active_by_company.get(cid),
        })

    return response


@router.post("/platform/companies")
def create_company(
    company_data: CreateCompanyRequest,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    company = Company(
        name=company_data.company_name,
        config=deepcopy(DEFAULT_CONFIG),
        is_active=True,
    )
    db.add(company)
    db.flush()

    temp_password = generate_temp_password()

    super_admin = User(
        company_id=company.id,
        employee_id="SA-001",
        full_name=company_data.admin_full_name,
        email=company_data.admin_email,
        role="super_admin",
        work_type="office",
        password_hash=hash_password(temp_password),
        is_active=True,
    )
    db.add(super_admin)
    db.commit()
    db.refresh(company)
    db.refresh(super_admin)

    # Every company gets billed from day one — seeds an active subscription
    # with its first renewal invoice due within the platform's grace period.
    from routers.billing import get_or_create_platform_settings, get_or_create_subscription

    settings = get_or_create_platform_settings(db)
    get_or_create_subscription(company, db, settings)

    return {
        "company_id": str(company.id),
        "super_admin_id": str(super_admin.id),
        "admin_password": temp_password,
        "message": "Company created",
    }


@router.patch("/platform/companies/{company_id}")
def update_company(
    company_id: str,
    company_data: UpdateCompanyRequest,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    company = get_company_or_404(company_id, db)

    if company_data.name is not None:
        company.name = company_data.name

    if company_data.is_active is not None:
        company.is_active = company_data.is_active
        if company_data.is_active is False:
            db.query(User).filter(User.company_id == company.id).update({"is_active": False})

    db.commit()
    db.refresh(company)
    return format_company(company)


@router.get("/platform/companies/{company_id}/users")
def get_company_users(
    company_id: str,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    company = get_company_or_404(company_id, db)
    users = (
        db.query(User)
        .filter(User.company_id == company.id)
        .order_by(User.role.asc(), User.full_name.asc())
        .all()
    )

    grouped_users = {}
    for user in users:
        grouped_users.setdefault(user.role, []).append(format_user(user))

    return grouped_users


@router.post("/platform/companies/{company_id}/reset-super-admin-password")
def reset_super_admin_password(
    company_id: str,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    company = get_company_or_404(company_id, db)

    super_admin = (
        db.query(User)
        .filter(
            User.company_id == company.id,
            User.role == "super_admin",
            User.is_active.is_(True),
        )
        .order_by(User.created_at.asc())
        .first()
    )
    if not super_admin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active super admin found for this company",
        )

    temp_password = generate_temp_password()
    super_admin.password_hash = hash_password(temp_password)
    (
        db.query(SessionModel)
        .filter(SessionModel.user_id == super_admin.id, SessionModel.is_active.is_(True))
        .update({"is_active": False}, synchronize_session=False)
    )
    db.commit()

    return {
        "full_name": super_admin.full_name,
        "email": super_admin.email,
        "admin_password": temp_password,
    }


@router.get("/platform/stats")
def get_platform_stats(
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    today_start = datetime.combine(datetime.utcnow().date(), time.min)

    return {
        "total_companies": db.query(Company).count(),
        "active_companies": db.query(Company)
        .filter(Company.is_active.is_(True))
        .count(),
        "total_users": db.query(User).count(),
        "active_users": db.query(User).filter(User.is_active.is_(True)).count(),
        "total_messages_today": db.query(Message)
        .filter(Message.created_at >= today_start)
        .count(),
        "total_alerts_today": db.query(Alert)
        .filter(Alert.created_at >= today_start)
        .count(),
    }


class RequestDeletionBody(BaseModel):
    confirmation_name: str


@router.post("/platform/companies/{company_id}/request-deletion")
def request_company_deletion(
    company_id: str,
    body: RequestDeletionBody,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    company = get_company_or_404(company_id, db)

    if body.confirmation_name != company.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Company name does not match. Please type the exact company name to confirm.",
        )

    if company.is_deletion_pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deletion already scheduled",
        )

    now = datetime.utcnow()
    company.is_deletion_pending = True
    company.is_active = False
    company.deletion_requested_at = now
    company.deletion_scheduled_at = now + timedelta(days=30)

    db.query(User).filter(User.company_id == company.id).update({"is_active": False})
    db.commit()

    return {
        "message": "Company scheduled for deletion",
        "company_name": company.name,
        "deletion_scheduled_at": company.deletion_scheduled_at,
        "grace_period_days": 30,
    }


@router.post("/platform/companies/{company_id}/cancel-deletion")
def cancel_company_deletion(
    company_id: str,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    company = get_company_or_404(company_id, db)

    if not company.is_deletion_pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No deletion scheduled",
        )

    company.is_deletion_pending = False
    company.is_active = True
    company.deletion_requested_at = None
    company.deletion_scheduled_at = None

    db.query(User).filter(User.company_id == company.id).update({"is_active": True})
    db.commit()

    return {"message": "Deletion cancelled. Company restored."}


def delete_company_data(company_id: str, db: Session) -> None:
    user_ids = [u.id for u in db.query(User).filter(User.company_id == company_id).all()]

    # 1. screenshots
    screenshots = db.query(Screenshot).filter(Screenshot.company_id == company_id).all()
    for s in screenshots:
        if s.file_path and os.path.exists(s.file_path) and os.path.isfile(s.file_path):
            try:
                os.remove(s.file_path)
            except Exception:
                pass

    company_screenshot_dir = f"/home/teams.aidbro.com/screenshots/{company_id}"
    if os.path.exists(company_screenshot_dir):
        try:
            shutil.rmtree(company_screenshot_dir)
        except Exception:
            pass

    db.query(Screenshot).filter(Screenshot.company_id == company_id).delete(synchronize_session=False)

    # 2. activity_logs
    db.query(ActivityLog).filter(ActivityLog.company_id == company_id).delete(synchronize_session=False)

    # 3. alert_recipients
    if user_ids:
        db.query(AlertRecipient).filter(AlertRecipient.recipient_id.in_(user_ids)).delete(synchronize_session=False)

    # 4. alerts
    db.query(Alert).filter(Alert.company_id == company_id).delete(synchronize_session=False)

    # 5. messages
    db.query(Message).filter(Message.company_id == company_id).delete(synchronize_session=False)

    # 6. daily_reports
    db.query(DailyReport).filter(DailyReport.company_id == company_id).delete(synchronize_session=False)

    # 7. attendance
    db.query(Attendance).filter(Attendance.company_id == company_id).delete(synchronize_session=False)

    # 8. salary_records
    db.query(SalaryRecord).filter(SalaryRecord.company_id == company_id).delete(synchronize_session=False)

    # 9. leave_requests
    db.query(LeaveRequest).filter(LeaveRequest.company_id == company_id).delete(synchronize_session=False)

    # 10. current_status
    if user_ids:
        db.query(CurrentStatus).filter(CurrentStatus.user_id.in_(user_ids)).delete(synchronize_session=False)

    # 11. machine_tokens
    db.query(MachineToken).filter(MachineToken.company_id == company_id).delete(synchronize_session=False)

    # 12. sessions
    if user_ids:
        db.query(SessionModel).filter(SessionModel.user_id.in_(user_ids)).delete(synchronize_session=False)

    # 13. users
    db.query(User).filter(User.company_id == company_id).delete(synchronize_session=False)

    # 14. subscription_invoices + subscriptions
    db.query(SubscriptionInvoice).filter(SubscriptionInvoice.company_id == company_id).delete(synchronize_session=False)
    db.query(Subscription).filter(Subscription.company_id == company_id).delete(synchronize_session=False)

    # 15. companies
    db.query(Company).filter(Company.id == company_id).delete(synchronize_session=False)


@router.post("/platform/companies/{company_id}/execute-deletion")
def execute_company_deletion(
    company_id: str,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    company = get_company_or_404(company_id, db)

    if not company.is_deletion_pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Company deletion is not pending",
        )

    company_name = company.name
    delete_company_data(str(company.id), db)
    db.commit()

    return {"message": "Company permanently deleted", "company_name": company_name}

import secrets
import uuid
from datetime import date as date_type, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, hash_password, require_super_admin, require_admin
from database import get_db
from models import ActivityLog, CurrentStatus, MachineToken, Session as UserSession, User

router = APIRouter()

VALID_CREATE_ROLES = {"staff", "admin"}
VALID_WORK_TYPES = {"office", "wfh"}

SETUP_CODE_TTL = timedelta(hours=24)
# Excludes visually ambiguous characters (0/O, 1/I/L) so staff can type it by hand.
SETUP_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def generate_setup_code() -> str:
    raw = "".join(secrets.choice(SETUP_CODE_ALPHABET) for _ in range(10))
    return f"{raw[:5]}-{raw[5:]}"


class CreateUserRequest(BaseModel):
    full_name: str
    email: str
    employee_id: str
    department: str | None = None
    job_title: str | None = None
    phone: str | None = None
    role: str
    work_type: str
    password: str
    joining_date: date_type | None = None


class UpdateUserRequest(BaseModel):
    full_name: str | None = None
    email: str | None = None
    department: str | None = None
    job_title: str | None = None
    phone: str | None = None
    work_type: str | None = None
    base_salary: Decimal | None = None


class ResetPasswordRequest(BaseModel):
    new_password: str



def format_user(user: User, machine_token=None):
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
        "agent_version": machine_token.agent_version if machine_token else None,
        "agent_updated_at": machine_token.agent_updated_at if machine_token else None,
    }


def get_company_user(user_id: str, current_user: User, db: Session):
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
        )
        .first()
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return user


@router.post("/users/create")
def create_user(
    user_data: CreateUserRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)

    if user_data.role not in VALID_CREATE_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role",
        )

    if user_data.work_type not in VALID_WORK_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid work type",
        )

    existing_email = (
        db.query(User)
        .filter(
            User.company_id == current_user.company_id,
            User.email == user_data.email,
        )
        .first()
    )
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already exists",
        )

    existing_employee_id = (
        db.query(User)
        .filter(
            User.company_id == current_user.company_id,
            User.employee_id == user_data.employee_id,
        )
        .first()
    )
    if existing_employee_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Employee ID already exists",
        )

    user = User(
        company_id=current_user.company_id,
        employee_id=user_data.employee_id,
        full_name=user_data.full_name,
        email=user_data.email,
        phone=user_data.phone,
        department=user_data.department,
        job_title=user_data.job_title,
        role=user_data.role,
        work_type=user_data.work_type,
        password_hash=hash_password(user_data.password),
        joining_date=user_data.joining_date,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "message": "User created",
        "user_id": str(user.id),
        "employee_id": user.employee_id,
    }


@router.get("/users/list")
def list_users(
    role: str | None = None,
    department: str | None = None,
    is_active: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    query = db.query(User).filter(
        User.company_id == current_user.company_id,
        User.is_active == is_active,
    )

    if current_user.role == "admin":
        query = query.filter(User.role == "staff")
    elif role:
        query = query.filter(User.role == role)

    if department:
        query = query.filter(User.department == department)

    users = query.order_by(User.full_name.asc()).all()

    user_ids = [u.id for u in users]
    token_by_user = {}
    if user_ids:
        for mt in db.query(MachineToken).filter(MachineToken.user_id.in_(user_ids)).all():
            token_by_user[mt.user_id] = mt

    return [format_user(u, token_by_user.get(u.id)) for u in users]


@router.get("/users/chat-members")
def list_chat_members(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    users = (
        db.query(User)
        .filter(
            User.company_id == current_user.company_id,
            User.is_active.is_(True),
            User.id != current_user.id,
        )
        .order_by(User.full_name.asc())
        .all()
    )

    return [
        {
            "id": str(user.id),
            "full_name": user.full_name,
            "department": user.department,
            "role": user.role,
            "employee_id": user.employee_id,
        }
        for user in users
    ]


@router.patch("/users/{user_id}")
def update_user(
    user_id: str,
    user_data: UpdateUserRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    user = get_company_user(user_id, current_user, db)

    update_data = user_data.model_dump(exclude_unset=True)
    if "work_type" in update_data and update_data["work_type"] not in VALID_WORK_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid work type",
        )

    if "email" in update_data:
        existing_email = (
            db.query(User)
            .filter(
                User.company_id == current_user.company_id,
                User.email == update_data["email"],
                User.id != user.id,
            )
            .first()
        )
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already in use",
            )

    for field, value in update_data.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return format_user(user)


@router.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: str,
    password_data: ResetPasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    user = get_company_user(user_id, current_user, db)

    if len(password_data.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters",
        )

    user.password_hash = hash_password(password_data.new_password)
    (
        db.query(UserSession)
        .filter(UserSession.user_id == user.id, UserSession.is_active.is_(True))
        .update({"is_active": False}, synchronize_session=False)
    )
    db.commit()

    return {"message": "Password reset successfully"}


@router.post("/users/{user_id}/deactivate")
def deactivate_user(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    user = get_company_user(user_id, current_user, db)
    user.is_active = False

    machine_token = (
        db.query(MachineToken)
        .filter(MachineToken.user_id == user.id, MachineToken.is_active.is_(True))
        .first()
    )
    if machine_token:
        machine_token.is_active = False

    db.commit()
    return {"message": "User deactivated"}


@router.post("/users/{user_id}/generate-agent-token")
def generate_agent_token(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    user = get_company_user(user_id, current_user, db)

    if user.role in {"super_admin", "platform_admin"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Agent token cannot be generated for this role",
        )

    new_token = secrets.token_hex(32)
    new_setup_code = generate_setup_code()
    now = datetime.utcnow()
    setup_code_expires_at = now + SETUP_CODE_TTL

    existing_token = (
        db.query(MachineToken)
        .filter(MachineToken.user_id == user.id)
        .first()
    )

    if existing_token:
        if existing_token.session_active:
            cs = db.query(CurrentStatus).filter(CurrentStatus.user_id == user.id).first()
            if cs and cs.status != "offline":
                db.add(ActivityLog(
                    company_id=user.company_id,
                    user_id=user.id,
                    status="offline",
                    timestamp=now,
                    machine_id=cs.machine_id,
                ))
                cs.status = "offline"
                cs.updated_at = now
            existing_token.session_active = False

        existing_token.token = new_token
        existing_token.is_active = True
        existing_token.created_at = now
        existing_token.setup_code = new_setup_code
        existing_token.setup_code_expires_at = setup_code_expires_at
        existing_token.setup_code_used_at = None
    else:
        machine_token = MachineToken(
            company_id=user.company_id,
            user_id=user.id,
            token=new_token,
            is_active=True,
            setup_code=new_setup_code,
            setup_code_expires_at=setup_code_expires_at,
        )
        db.add(machine_token)

    db.commit()

    return {
        "machine_token": new_token,
        "staff_id": str(user.id),
        "token_preview": f"********{new_token[-8:]}",
        "setup_code": new_setup_code,
        "setup_code_expires_at": setup_code_expires_at,
        "message": "Save this token now. It will not be shown again in full.",
    }


@router.get("/users/{user_id}/agent-token-status")
def get_agent_token_status(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    user = get_company_user(user_id, current_user, db)

    machine_token = (
        db.query(MachineToken)
        .filter(MachineToken.user_id == user.id)
        .order_by(MachineToken.created_at.desc())
        .first()
    )
    if not machine_token:
        return {"has_token": False}

    return {
        "has_token": True,
        "token_preview": f"••••••••{machine_token.token[-8:]}",
        "is_active": machine_token.is_active,
        "created_at": machine_token.created_at,
        "agent_version": machine_token.agent_version,
        "agent_updated_at": machine_token.agent_updated_at,
    }

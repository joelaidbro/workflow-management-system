from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession

from auth import (
    create_jwt,
    generate_session_token,
    get_current_user,
    verify_password,
)
from database import get_db
from models import Session as SessionModel
from models import User

router = APIRouter()


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/auth/login")
def login(
    login_data: LoginRequest,
    response: Response,
    db: DBSession = Depends(get_db),
):
    user = (
        db.query(User)
        .filter(User.email == login_data.email, User.is_active.is_(True))
        .first()
    )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not verify_password(login_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    now = datetime.utcnow()
    session = SessionModel(
        user_id=user.id,
        token=generate_session_token(),
        created_at=now,
        expires_at=now + timedelta(days=7),
        is_active=True,
    )
    db.add(session)
    db.commit()

    jwt_token = create_jwt(
        {
            "user_id": str(user.id),
            "company_id": str(user.company_id),
        }
    )
    response.set_cookie(
        key="access_token",
        value=jwt_token,
        httponly=True,
        samesite="lax",
    )

    return {
        "user_id": str(user.id),
        "full_name": user.full_name,
        "role": user.role,
        "company_id": str(user.company_id),
    }


@router.post("/auth/logout")
def logout(
    response: Response,
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    session = (
        db.query(SessionModel)
        .filter(
            SessionModel.user_id == current_user.id,
            SessionModel.is_active.is_(True),
        )
        .order_by(SessionModel.created_at.desc())
        .first()
    )

    if session:
        session.is_active = False
        db.commit()

    response.delete_cookie(key="access_token", samesite="lax")
    return {"message": "Logged out successfully"}


@router.get("/auth/me")
def me(current_user: User = Depends(get_current_user)):
    return {
        "id": str(current_user.id),
        "full_name": current_user.full_name,
        "email": current_user.email,
        "role": current_user.role,
        "company_id": str(current_user.company_id),
        "work_type": current_user.work_type,
        "department": current_user.department,
        "job_title": current_user.job_title,
    }


@router.get("/auth/token")
def get_token(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    return {"token": request.cookies.get("access_token")}

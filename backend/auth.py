import os
import secrets
from datetime import datetime, timedelta

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import get_db
from models import User

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is not set. Add it to your .env file.")
if len(SECRET_KEY) < 32:
    raise RuntimeError("SECRET_KEY is too short (minimum 32 characters). Use: python -c \"import secrets; print(secrets.token_hex(32))\"")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain_password: str) -> str:
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def generate_session_token() -> str:
    return secrets.token_hex(32)


def create_jwt(data: dict) -> str:
    payload = data.copy()
    expires_at = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload.update({"exp": expires_at})
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_jwt(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def get_current_user(request: Request, db: Session = Depends(get_db)):
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1]
    else:
        token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    payload = decode_jwt(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return user


def require_staff(current_user: User):
    if current_user.role != "staff":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def require_staff_or_admin(current_user: User):
    if current_user.role not in {"staff", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def require_admin(current_user: User):
    if current_user.role not in {"admin", "super_admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def require_super_admin(current_user: User):
    if current_user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def is_sales_department(current_user: User) -> bool:
    return (current_user.department or "").strip().lower() == "sales"


def require_crm_access(current_user: User):
    """CRM is sales-department tooling: open to super_admin regardless of
    department, plus any staff/admin whose department is exactly "Sales"
    (case-insensitive). Admins configure this via the user's Department
    field — no separate CRM role exists."""
    if current_user.role == "super_admin":
        return
    if is_sales_department(current_user):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def require_crm_manage(current_user: User):
    """Managing CRM master data (lead sources/statuses, items, item
    categories) is restricted to super_admin, or an `admin`-role user who is
    also in the Sales department — plain sales staff can use the dropdowns
    but not edit them."""
    if current_user.role == "super_admin":
        return
    if current_user.role == "admin" and is_sales_department(current_user):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def require_platform_admin(current_user: User = Depends(get_current_user)):
    if current_user.role != "platform_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform admin access required",
        )
    return current_user

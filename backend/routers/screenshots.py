import os
import uuid
from datetime import datetime, time, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Screenshot, User
from routers.agent import verify_machine_token

router = APIRouter()

SCREENSHOTS_BASE_PATH = "/home/teams.aidbro.com/screenshots"


def require_super_admin(current_user: User):
    if current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )


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


def format_screenshot(screenshot: Screenshot):
    return {
        "id": str(screenshot.id),
        "captured_at": screenshot.captured_at,
        "uploaded_at": screenshot.uploaded_at,
        "file_size_kb": screenshot.file_size_kb,
        "width": screenshot.width,
        "height": screenshot.height,
    }


@router.post("/screenshots/upload")
async def upload_screenshot(
    file: UploadFile = File(...),
    machine_token: str = Form(...),
    staff_id: str = Form(...),
    captured_at: str = Form(...),
    db: Session = Depends(get_db),
):
    user, machine_token_row, token_error = verify_machine_token(
        staff_id,
        machine_token,
        db,
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=token_error,
        )

    try:
        captured_at_value = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
        captured_at_value = captured_at_value.replace(tzinfo=None)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid captured_at",
        )

    date_part = captured_at_value.strftime("%Y-%m-%d")
    timestamp_part = captured_at_value.strftime("%H-%M-%S")
    relative_path = os.path.join(
        str(user.company_id),
        user.employee_id,
        date_part,
        f"{timestamp_part}.jpg",
    )
    full_path = os.path.join(SCREENSHOTS_BASE_PATH, relative_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)

    contents = await file.read()
    with open(full_path, "wb") as output_file:
        output_file.write(contents)

    file_size_kb = round(len(contents) / 1024)
    screenshot = Screenshot(
        company_id=user.company_id,
        user_id=user.id,
        employee_id=user.employee_id,
        captured_at=captured_at_value,
        file_path=relative_path,
        file_size_kb=file_size_kb,
    )
    db.add(screenshot)
    db.commit()
    db.refresh(screenshot)

    return {"screenshot_id": str(screenshot.id), "message": "uploaded"}


@router.get("/screenshots/{user_id}")
def list_screenshots(
    user_id: str,
    date: str | None = None,
    page: int = 1,
    per_page: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    user = get_company_user(user_id, current_user, db)

    page = max(page, 1)
    per_page = min(max(per_page, 1), 50)
    query = db.query(Screenshot).filter(
        Screenshot.user_id == user.id,
        Screenshot.company_id == current_user.company_id,
        Screenshot.is_deleted.is_(False),
    )

    if date:
        try:
            selected_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date",
            )
        start_at = datetime.combine(selected_date, time.min)
        end_at = start_at + timedelta(days=1)
        query = query.filter(
            Screenshot.captured_at >= start_at,
            Screenshot.captured_at < end_at,
        )

    total = query.count()
    screenshots = (
        query.order_by(Screenshot.captured_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "screenshots": [format_screenshot(screenshot) for screenshot in screenshots],
    }


@router.get("/screenshots/file/{screenshot_id}")
def get_screenshot_file(
    screenshot_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    try:
        screenshot_uuid = uuid.UUID(str(screenshot_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screenshot not found",
        )

    screenshot = (
        db.query(Screenshot)
        .join(User, User.id == Screenshot.user_id)
        .filter(
            Screenshot.id == screenshot_uuid,
            Screenshot.company_id == current_user.company_id,
            User.company_id == current_user.company_id,
            Screenshot.is_deleted.is_(False),
        )
        .first()
    )
    if not screenshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screenshot not found",
        )

    full_path = os.path.join(SCREENSHOTS_BASE_PATH, screenshot.file_path)
    if not os.path.exists(full_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )

    return FileResponse(full_path, media_type="image/jpeg")


@router.delete("/screenshots/{screenshot_id}")
def delete_screenshot(
    screenshot_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    try:
        screenshot_uuid = uuid.UUID(str(screenshot_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screenshot not found",
        )

    screenshot = (
        db.query(Screenshot)
        .filter(
            Screenshot.id == screenshot_uuid,
            Screenshot.company_id == current_user.company_id,
            Screenshot.is_deleted.is_(False),
        )
        .first()
    )
    if not screenshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screenshot not found",
        )

    screenshot.is_deleted = True
    db.commit()

    return {"message": "deleted"}

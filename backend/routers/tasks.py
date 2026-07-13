import uuid
from datetime import date as date_type
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, require_admin
from database import get_db
from models import Task, User

router = APIRouter()

VALID_STATUSES = {"pending", "in_progress", "done"}


class TaskCreateBody(BaseModel):
    title: str
    description: str
    assigned_to: str
    due_date: date_type | None = None


class TaskEditBody(BaseModel):
    title: str | None = None
    description: str | None = None
    due_date: date_type | None = None
    clear_due_date: bool = False


class TaskStatusBody(BaseModel):
    status: str



def format_task(task: Task) -> dict:
    return {
        "id": str(task.id),
        "company_id": str(task.company_id),
        "title": task.title,
        "description": task.description,
        "assigned_to": str(task.assigned_to),
        "assigned_to_name": task.assignee.full_name if task.assignee else None,
        "assigned_to_employee_id": task.assignee.employee_id if task.assignee else None,
        "assigned_by": str(task.assigned_by),
        "assigned_by_name": task.assigner.full_name if task.assigner else None,
        "status": task.status,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "created_at": task.created_at.isoformat() + "Z" if task.created_at else None,
        "updated_at": task.updated_at.isoformat() + "Z" if task.updated_at else None,
    }


def get_task_in_company(task_id: str, company_id, db: Session) -> Task:
    try:
        task_uuid = uuid.UUID(task_id)
    except ValueError:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Task not found")

    task = (
        db.query(Task)
        .filter(Task.id == task_uuid, Task.company_id == company_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


@router.post("/tasks/")
def create_task(
    body: TaskCreateBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    title = body.title.strip()
    description = body.description.strip()
    if not title:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Title cannot be empty",
        )
    if not description:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Description cannot be empty",
        )

    try:
        assignee_uuid = uuid.UUID(body.assigned_to)
    except ValueError:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Invalid assignee",
        )

    assignee = (
        db.query(User)
        .filter(
            User.id == assignee_uuid,
            User.company_id == current_user.company_id,
            User.is_active.is_(True),
            User.role == "staff",
        )
        .first()
    )
    if not assignee:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Staff member not found",
        )

    now = datetime.utcnow()
    task = Task(
        company_id=current_user.company_id,
        title=title,
        description=description,
        assigned_to=assignee.id,
        assigned_by=current_user.id,
        status="pending",
        due_date=body.due_date,
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    return {"message": "Task created", "task": format_task(task)}


@router.get("/tasks/")
def list_tasks(
    status: str | None = None,
    assigned_to: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    if status and status not in VALID_STATUSES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Invalid status",
        )

    query = db.query(Task).filter(Task.company_id == current_user.company_id)

    if status:
        query = query.filter(Task.status == status)

    if assigned_to:
        try:
            assignee_uuid = uuid.UUID(assigned_to)
            query = query.filter(Task.assigned_to == assignee_uuid)
        except ValueError:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Invalid assignee filter",
            )

    tasks = query.order_by(Task.created_at.desc()).all()
    return [format_task(t) for t in tasks]


@router.get("/tasks/my-tasks")
def get_my_tasks(
    status: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if status and status not in VALID_STATUSES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Invalid status",
        )

    query = db.query(Task).filter(Task.assigned_to == current_user.id)

    if status:
        query = query.filter(Task.status == status)

    tasks = query.order_by(Task.created_at.desc()).all()
    return [format_task(t) for t in tasks]


@router.patch("/tasks/{task_id}")
def edit_task(
    task_id: str,
    body: TaskEditBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    task = get_task_in_company(task_id, current_user.company_id, db)

    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Title cannot be empty",
            )
        task.title = title

    if body.description is not None:
        description = body.description.strip()
        if not description:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Description cannot be empty",
            )
        task.description = description

    if body.clear_due_date:
        task.due_date = None
    elif body.due_date is not None:
        task.due_date = body.due_date

    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)

    return {"message": "Task updated", "task": format_task(task)}


@router.patch("/tasks/{task_id}/status")
def update_task_status(
    task_id: str,
    body: TaskStatusBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Invalid status",
        )

    task = get_task_in_company(task_id, current_user.company_id, db)

    is_admin = current_user.role in {"admin", "super_admin"}
    is_assignee = task.assigned_to == current_user.id

    if not is_admin and not is_assignee:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    task.status = body.status
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)

    return {"message": "Status updated", "task": format_task(task)}


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    task = get_task_in_company(task_id, current_user.company_id, db)
    db.delete(task)
    db.commit()

    return {"message": "Task deleted"}

import uuid
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, require_super_admin
from database import get_db
from models import AdminStaffAssignment, User

router = APIRouter()


class AssignmentBody(BaseModel):
    staff_id: str
    admin_id: str


def get_company_user_with_role(user_id: str, expected_role: str, current_user: User, db: Session) -> User:
    try:
        user_uuid = uuid.UUID(str(user_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user = (
        db.query(User)
        .filter(
            User.id == user_uuid,
            User.company_id == current_user.company_id,
            User.role == expected_role,
            User.is_active.is_(True),
        )
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.get("/team/admins")
def list_admins(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    admins = (
        db.query(User)
        .filter(
            User.company_id == current_user.company_id,
            User.role == "admin",
            User.is_active.is_(True),
        )
        .order_by(User.full_name.asc())
        .all()
    )
    return [
        {"id": str(a.id), "full_name": a.full_name, "employee_id": a.employee_id}
        for a in admins
    ]


@router.get("/team/roster")
def get_roster(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every active staff member with the admins currently assigned to them."""
    require_super_admin(current_user)

    staff = (
        db.query(User)
        .filter(
            User.company_id == current_user.company_id,
            User.role == "staff",
            User.is_active.is_(True),
        )
        .order_by(User.full_name.asc())
        .all()
    )

    assignments = (
        db.query(AdminStaffAssignment)
        .filter(AdminStaffAssignment.company_id == current_user.company_id)
        .all()
    )
    admin_ids_by_staff = defaultdict(list)
    for a in assignments:
        admin_ids_by_staff[a.staff_id].append(str(a.admin_id))

    return [
        {
            "id": str(s.id),
            "full_name": s.full_name,
            "employee_id": s.employee_id,
            "department": s.department,
            "assigned_admin_ids": admin_ids_by_staff.get(s.id, []),
        }
        for s in staff
    ]


@router.post("/team/assign")
def assign_staff(
    body: AssignmentBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)

    staff = get_company_user_with_role(body.staff_id, "staff", current_user, db)
    admin = get_company_user_with_role(body.admin_id, "admin", current_user, db)

    existing = (
        db.query(AdminStaffAssignment)
        .filter(
            AdminStaffAssignment.admin_id == admin.id,
            AdminStaffAssignment.staff_id == staff.id,
        )
        .first()
    )
    if existing:
        return {"message": "Already assigned"}

    db.add(
        AdminStaffAssignment(
            company_id=current_user.company_id,
            admin_id=admin.id,
            staff_id=staff.id,
            assigned_by=current_user.id,
            created_at=datetime.utcnow(),
        )
    )
    db.commit()

    return {"message": "Assigned"}


@router.delete("/team/assign")
def unassign_staff(
    body: AssignmentBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)

    try:
        staff_uuid = uuid.UUID(str(body.staff_id))
        admin_uuid = uuid.UUID(str(body.admin_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    deleted = (
        db.query(AdminStaffAssignment)
        .filter(
            AdminStaffAssignment.admin_id == admin_uuid,
            AdminStaffAssignment.staff_id == staff_uuid,
            AdminStaffAssignment.company_id == current_user.company_id,
        )
        .delete(synchronize_session=False)
    )
    db.commit()

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")

    return {"message": "Unassigned"}

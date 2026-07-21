from sqlalchemy.orm import Session

from models import AdminStaffAssignment, User


def get_assigned_staff_ids(admin_id, db: Session) -> set:
    """Staff members assigned to this admin. Empty set if none assigned yet."""
    rows = (
        db.query(AdminStaffAssignment.staff_id)
        .filter(AdminStaffAssignment.admin_id == admin_id)
        .all()
    )
    return {row[0] for row in rows}


def get_assigned_admin_ids(staff_id, db: Session) -> set:
    """Admins this staff member is assigned to. Empty set if unassigned."""
    rows = (
        db.query(AdminStaffAssignment.admin_id)
        .filter(AdminStaffAssignment.staff_id == staff_id)
        .all()
    )
    return {row[0] for row in rows}


def scope_staff_query(query, current_user: User, db: Session, staff_id_column=User.id):
    """Restrict a query of staff-owned rows to only the staff assigned to
    current_user when they hold the normal `admin` role. super_admin and
    every other role pass through unrestricted — only `admin` is scoped."""
    if current_user.role != "admin":
        return query
    assigned_ids = get_assigned_staff_ids(current_user.id, db)
    return query.filter(staff_id_column.in_(assigned_ids))

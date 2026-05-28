import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import ActivityLog, CurrentStatus, MachineToken, User

router = APIRouter()

VALID_AGENT_STATUSES = {"active", "idle"}


class HeartbeatRequest(BaseModel):
    staff_id: str
    machine_token: str
    status: str


class VerifyAgentRequest(BaseModel):
    staff_id: str
    machine_token: str


def verify_machine_token(staff_id, machine_token, db):
    try:
        staff_uuid = uuid.UUID(str(staff_id))
    except ValueError:
        return None, None, "Token mismatch"

    machine_token_row = (
        db.query(MachineToken)
        .filter(MachineToken.token == machine_token)
        .first()
    )
    if not machine_token_row or not machine_token_row.is_active:
        return None, None, "Unrecognised device"

    if machine_token_row.user_id != staff_uuid:
        return None, machine_token_row, "Token mismatch"

    user = (
        db.query(User)
        .filter(User.id == staff_uuid, User.is_active.is_(True))
        .first()
    )
    if not user:
        return None, machine_token_row, "Token mismatch"

    return user, machine_token_row, None


@router.post("/agent/heartbeat")
def heartbeat(
    heartbeat_data: HeartbeatRequest,
    db: Session = Depends(get_db),
):
    user, machine_token_row, token_error = verify_machine_token(
        heartbeat_data.staff_id,
        heartbeat_data.machine_token,
        db,
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=token_error,
        )

    current_status_value = heartbeat_data.status
    if current_status_value not in VALID_AGENT_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid status",
        )

    now = datetime.utcnow()
    current_status = (
        db.query(CurrentStatus)
        .filter(CurrentStatus.user_id == user.id)
        .first()
    )

    if current_status:
        current_status.status = current_status_value
        current_status.updated_at = now
        current_status.machine_id = str(machine_token_row.id)
    else:
        current_status = CurrentStatus(
            user_id=user.id,
            status=current_status_value,
            updated_at=now,
            machine_id=str(machine_token_row.id),
        )
        db.add(current_status)

    if current_status_value in {"active", "idle"}:
        current_status.break_started_at = None

    last_activity_log = (
        db.query(ActivityLog)
        .filter(ActivityLog.user_id == user.id)
        .order_by(ActivityLog.timestamp.desc())
        .first()
    )

    if not last_activity_log or last_activity_log.status != current_status_value:
        db.add(
            ActivityLog(
                company_id=user.company_id,
                user_id=user.id,
                status=current_status_value,
                timestamp=now,
                machine_id=current_status.machine_id,
            )
        )

    db.commit()
    return {"received": True}


@router.post("/agent/verify")
def verify_agent(
    verify_data: VerifyAgentRequest,
    db: Session = Depends(get_db),
):
    user, machine_token_row, token_error = verify_machine_token(
        verify_data.staff_id,
        verify_data.machine_token,
        db,
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=token_error,
        )

    return {
        "valid": True,
        "full_name": user.full_name,
        "role": user.role,
    }

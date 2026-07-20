import json
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import ActivityLog, Attendance, Company, CurrentStatus, MachineToken, User
from routers.settings import get_config


router = APIRouter()

VALID_AGENT_STATUSES = {"active", "idle", "break", "meeting"}


class HeartbeatRequest(BaseModel):
    staff_id: str
    machine_token: str
    status: str
    agent_version: str | None = None


class VerifyAgentRequest(BaseModel):
    staff_id: str
    machine_token: str
    agent_version: str | None = None


class RedeemSetupCodeRequest(BaseModel):
    setup_code: str


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
        previous_status = current_status.status

        if previous_status in {"break", "meeting"} and current_status_value in {"active", "idle"}:
            current_status_value = previous_status

        if current_status_value == "idle" and previous_status != "idle":
            current_status.idle_started_at = now

        if previous_status == "idle" and current_status_value == "active":
            if current_status.idle_started_at:
                idle_duration_minutes = round(
                    (now - current_status.idle_started_at).total_seconds() / 60
                )
                attendance = (
                    db.query(Attendance)
                    .filter(
                        Attendance.user_id == current_status.user_id,
                        Attendance.date == now.date(),
                    )
                    .first()
                )
                if attendance and idle_duration_minutes > 0:
                    attendance.idle_minutes = (
                        attendance.idle_minutes or 0
                    ) + idle_duration_minutes
            current_status.idle_started_at = None

        current_status.status = current_status_value
        current_status.updated_at = now
        current_status.machine_id = str(machine_token_row.id)
    else:
        current_status = CurrentStatus(
            user_id=user.id,
            status=current_status_value,
            updated_at=now,
            machine_id=str(machine_token_row.id),
            idle_started_at=now if current_status_value == "idle" else None,
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

    if (
        heartbeat_data.agent_version
        and machine_token_row.agent_version != heartbeat_data.agent_version
    ):
        machine_token_row.agent_version = heartbeat_data.agent_version
        machine_token_row.agent_updated_at = now

    db.commit()
    return {"received": True}


@router.post("/agent/redeem-setup-code")
def redeem_setup_code(
    redeem_data: RedeemSetupCodeRequest,
    db: Session = Depends(get_db),
):
    code = redeem_data.setup_code.strip().upper()
    machine_token_row = (
        db.query(MachineToken)
        .filter(MachineToken.setup_code == code)
        .first()
    )
    if not machine_token_row or not machine_token_row.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or unrecognised setup code",
        )
    if machine_token_row.setup_code_used_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This setup code has already been used",
        )
    if (
        not machine_token_row.setup_code_expires_at
        or machine_token_row.setup_code_expires_at < datetime.utcnow()
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This setup code has expired — ask your admin for a new one",
        )

    machine_token_row.setup_code_used_at = datetime.utcnow()
    db.commit()

    return {
        "machine_token": machine_token_row.token,
        "staff_id": str(machine_token_row.user_id),
    }


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

    now = datetime.utcnow()
    if (
        verify_data.agent_version
        and machine_token_row.agent_version != verify_data.agent_version
    ):
        machine_token_row.agent_version = verify_data.agent_version
        machine_token_row.agent_updated_at = now
        db.commit()

    company = db.query(Company).filter(Company.id == user.company_id).first()
    company_config = get_config(company) if company else {}
    idle_timeout_minutes = company_config.get("idle_timeout_minutes", 10)
    screenshot_enabled = company_config.get("screenshot_enabled", True)
    screenshot_interval_seconds = company_config.get("screenshot_interval_seconds", 600)
    monitoring_enabled = company_config.get("monitoring_enabled", True)

    return {
        "valid": True,
        "full_name": user.full_name,
        "role": user.role,
        "idle_timeout_minutes": idle_timeout_minutes,
        "screenshot_enabled": screenshot_enabled,
        "screenshot_interval_seconds": screenshot_interval_seconds,
        "monitoring_enabled": monitoring_enabled,
    }


@router.get("/agent/session-status")
def get_agent_session_status(
    staff_id: str,
    machine_token: str,
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

    current_status = (
        db.query(CurrentStatus)
        .filter(CurrentStatus.user_id == user.id)
        .first()
    )

    company = db.query(Company).filter(Company.id == user.company_id).first()
    company_config = get_config(company) if company else {}
    idle_timeout_minutes = company_config.get("idle_timeout_minutes", 10)
    screenshot_enabled = company_config.get("screenshot_enabled", True)
    screenshot_interval_seconds = company_config.get("screenshot_interval_seconds", 600)
    monitoring_enabled = company_config.get("monitoring_enabled", True)

    # Record that the agent is alive right now (used for "agent connected" check on
    # the web UI's Start Day flow). Heartbeats are suppressed in standby, so we
    # track presence here instead — this endpoint is polled every 15 s regardless
    # of agent state.
    now = datetime.utcnow()
    machine_token_row.last_seen_at = now

    # Cross-validate the session flag: if it claims True, confirm there is an open
    # attendance record for today.  This catches the case where the previous day's
    # session was never closed (staff powered off without "End My Day") — the flag
    # persists in the DB but no attendance row exists for today, so we reset it.
    effective_session_active = machine_token_row.session_active
    if effective_session_active:
        today = now.date()
        open_attendance = (
            db.query(Attendance)
            .filter(
                Attendance.user_id == user.id,
                Attendance.date == today,
                Attendance.logged_in.is_(True),
                Attendance.logout_time.is_(None),
            )
            .first()
        )
        if not open_attendance:
            machine_token_row.session_active = False
            effective_session_active = False

    db.commit()

    return {
        "active": True,
        "session_active": effective_session_active,
        "current_status": current_status.status if current_status else "offline",
        "idle_timeout_minutes": idle_timeout_minutes,
        "screenshot_enabled": screenshot_enabled,
        "screenshot_interval_seconds": screenshot_interval_seconds,
        "monitoring_enabled": monitoring_enabled,
    }


_RELEASE_FILE = Path(__file__).resolve().parent.parent.parent / "agent_release.json"


@router.get("/agent/version")
def get_agent_version():
    if not _RELEASE_FILE.exists():
        raise HTTPException(status_code=503, detail="Agent release info not available")
    try:
        with _RELEASE_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        raise HTTPException(status_code=503, detail="Agent release info unreadable")

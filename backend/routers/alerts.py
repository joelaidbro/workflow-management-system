import re
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from main import limiter
from models import Alert, AlertRecipient, Company, User
from routers.agent import verify_machine_token

router = APIRouter()

VALID_ALERT_TYPES = {"info", "urgent"}
ALLOWED_SENDER_ROLES = {"admin", "super_admin"}


class SendAlertRequest(BaseModel):
    alert_type: str
    message: str
    recipient_id: str | None = None


class AcknowledgeAlertRequest(BaseModel):
    alert_recipient_id: str
    reply: str | None = None


class BrowserAcknowledgeAlertRequest(BaseModel):
    reply: str | None = None


def strip_html_tags(message: str) -> str:
    return re.sub(r"<[^>]*>", "", message).strip()


def format_utc_datetime(value):
    return value.isoformat() + "Z" if value else None


@router.post("/alerts/send")
@limiter.limit("30/minute")
def send_alert(
    request: Request,
    alert_data: SendAlertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role not in ALLOWED_SENDER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    if alert_data.alert_type not in VALID_ALERT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid alert type",
        )

    clean_message = strip_html_tags(alert_data.message)
    if not clean_message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message must not be empty",
        )

    company = (
        db.query(Company)
        .filter(Company.id == current_user.company_id)
        .first()
    )
    company_config = company.config if company and company.config else {}
    expiry_minutes = company_config.get("alert_expiry_minutes", 120)

    now = datetime.utcnow()
    expires_at = now + timedelta(minutes=expiry_minutes)

    if alert_data.recipient_id is None:
        recipients_query = db.query(User).filter(
            User.company_id == current_user.company_id,
            User.is_active.is_(True),
        )

        if current_user.role == "admin":
            recipients_query = recipients_query.filter(User.role == "staff")
        else:
            recipients_query = recipients_query.filter(User.role.in_(["staff", "admin"]))

        recipients = recipients_query.all()
        alert_recipient_id = None
    else:
        try:
            recipient_uuid = uuid.UUID(str(alert_data.recipient_id))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Recipient not found",
            )

        recipient = (
            db.query(User)
            .filter(
                User.id == recipient_uuid,
                User.company_id == current_user.company_id,
                User.is_active.is_(True),
            )
            .first()
        )
        if not recipient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Recipient not found",
            )

        recipients = [recipient]
        alert_recipient_id = recipient.id

    alert = Alert(
        company_id=current_user.company_id,
        sender_id=current_user.id,
        recipient_id=alert_recipient_id,
        alert_type=alert_data.alert_type,
        message=clean_message,
        created_at=now,
        expires_at=expires_at,
    )
    db.add(alert)
    db.flush()

    for recipient in recipients:
        db.add(
            AlertRecipient(
                alert_id=alert.id,
                recipient_id=recipient.id,
                status="pending",
            )
        )

    db.commit()

    return {
        "alert_id": str(alert.id),
        "recipient_count": len(recipients),
    }


@router.get("/alerts/pending")
def get_pending_alerts(
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

    now = datetime.utcnow()
    pending_alerts = (
        db.query(AlertRecipient, Alert, User)
        .join(Alert, Alert.id == AlertRecipient.alert_id)
        .join(User, User.id == Alert.sender_id)
        .filter(
            AlertRecipient.recipient_id == user.id,
            AlertRecipient.status == "pending",
            Alert.expires_at > now,
        )
        .all()
    )

    return [
        {
            "alert_recipient_id": str(alert_recipient.id),
            "alert_type": alert.alert_type,
            "message": alert.message,
            "created_at": format_utc_datetime(alert.created_at),
            "sender_name": sender.full_name,
            "sender_id": str(sender.id),
        }
        for alert_recipient, alert, sender in pending_alerts
    ]


@router.post("/alerts/acknowledge")
def acknowledge_alert(
    acknowledge_data: AcknowledgeAlertRequest,
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

    try:
        alert_recipient_uuid = uuid.UUID(str(acknowledge_data.alert_recipient_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    alert_recipient = (
        db.query(AlertRecipient)
        .filter(AlertRecipient.id == alert_recipient_uuid)
        .first()
    )
    if not alert_recipient or alert_recipient.recipient_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    if alert_recipient.status == "acknowledged":
        return {"acknowledged": True}

    alert_recipient.status = "acknowledged"
    alert_recipient.acknowledged_at = datetime.utcnow()
    alert_recipient.reply = acknowledge_data.reply
    db.commit()

    return {"acknowledged": True}


def format_alert_recipient(alert_recipient, alert, sender):
    return {
        "alert_recipient_id": str(alert_recipient.id),
        "alert_type": alert.alert_type,
        "message": alert.message,
        "sender_name": sender.full_name,
        "created_at": format_utc_datetime(alert.created_at),
        "status": alert_recipient.status,
        "acknowledged_at": format_utc_datetime(alert_recipient.acknowledged_at),
        "reply": alert_recipient.reply,
    }


@router.get("/alerts/my-pending")
def get_my_pending_alerts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.utcnow()
    alert_rows = (
        db.query(AlertRecipient, Alert, User)
        .join(Alert, Alert.id == AlertRecipient.alert_id)
        .join(User, User.id == Alert.sender_id)
        .filter(
            AlertRecipient.recipient_id == current_user.id,
            AlertRecipient.status == "pending",
            Alert.expires_at > now,
        )
        .order_by(Alert.created_at.desc())
        .all()
    )

    return [
        format_alert_recipient(alert_recipient, alert, sender)
        for alert_recipient, alert, sender in alert_rows
    ]


@router.get("/alerts/my-history")
def get_my_alert_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    alert_rows = (
        db.query(AlertRecipient, Alert, User)
        .join(Alert, Alert.id == AlertRecipient.alert_id)
        .join(User, User.id == Alert.sender_id)
        .filter(AlertRecipient.recipient_id == current_user.id)
        .order_by(Alert.created_at.desc())
        .all()
    )

    return [
        format_alert_recipient(alert_recipient, alert, sender)
        for alert_recipient, alert, sender in alert_rows
    ]


@router.post("/alerts/my-acknowledge/{alert_recipient_id}")
def acknowledge_my_alert(
    alert_recipient_id: str,
    acknowledge_data: BrowserAcknowledgeAlertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        alert_recipient_uuid = uuid.UUID(str(alert_recipient_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found",
        )

    alert_recipient = (
        db.query(AlertRecipient)
        .filter(
            AlertRecipient.id == alert_recipient_uuid,
            AlertRecipient.recipient_id == current_user.id,
        )
        .first()
    )
    if not alert_recipient:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found",
        )

    if alert_recipient.status == "acknowledged":
        return {"acknowledged": True}

    alert_recipient.status = "acknowledged"
    alert_recipient.acknowledged_at = datetime.utcnow()
    alert_recipient.reply = acknowledge_data.reply
    db.commit()

    return {"acknowledged": True}


@router.get("/alerts/unread-replies-count")
def get_unread_replies_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role not in ALLOWED_SENDER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )
    count = (
        db.query(AlertRecipient)
        .join(Alert, Alert.id == AlertRecipient.alert_id)
        .filter(
            Alert.company_id == current_user.company_id,
            AlertRecipient.status == "acknowledged",
            AlertRecipient.reply.isnot(None),
            AlertRecipient.reply_read_by_admin.is_(False),
        )
        .count()
    )
    return {"count": count}


@router.get("/alerts/sent")
def get_sent_alerts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role not in ALLOWED_SENDER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    query = db.query(Alert).filter(Alert.company_id == current_user.company_id)
    if current_user.role == "admin":
        query = query.filter(Alert.sender_id == current_user.id)

    alerts = query.order_by(Alert.created_at.desc()).limit(20).all()
    response_data = []

    for alert in alerts:
        recipient_rows = (
            db.query(AlertRecipient)
            .filter(AlertRecipient.alert_id == alert.id)
            .all()
        )
        acknowledged_count = sum(
            1
            for alert_recipient in recipient_rows
            if alert_recipient.status == "acknowledged"
        )
        pending_count = sum(
            1
            for alert_recipient in recipient_rows
            if alert_recipient.status == "pending"
        )

        has_unread_replies = any(
            r.reply is not None and not r.reply_read_by_admin
            for r in recipient_rows
        )
        response_data.append(
            {
                "id": str(alert.id),
                "message": (
                    alert.message[:60]
                    if len(alert.message) <= 60
                    else f"{alert.message[:60]}..."
                ),
                "alert_type": alert.alert_type,
                "created_at": format_utc_datetime(alert.created_at),
                "total_recipients": len(recipient_rows),
                "acknowledged_count": acknowledged_count,
                "pending_count": pending_count,
                "has_unread_replies": has_unread_replies,
            }
        )

    return response_data


@router.get("/alerts/delivery-report/{alert_id}")
def get_delivery_report(
    alert_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        alert_uuid = uuid.UUID(str(alert_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found",
        )

    alert = (
        db.query(Alert)
        .filter(
            Alert.id == alert_uuid,
            Alert.company_id == current_user.company_id,
        )
        .first()
    )
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found",
        )

    if current_user.role != "super_admin" and alert.sender_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    recipient_rows = (
        db.query(AlertRecipient, User)
        .join(User, User.id == AlertRecipient.recipient_id)
        .filter(AlertRecipient.alert_id == alert.id)
        .all()
    )

    acknowledged_count = sum(
        1
        for alert_recipient, recipient in recipient_rows
        if alert_recipient.status == "acknowledged"
    )
    pending_count = sum(
        1
        for alert_recipient, recipient in recipient_rows
        if alert_recipient.status == "pending"
    )

    for alert_recipient, _ in recipient_rows:
        if alert_recipient.reply is not None and not alert_recipient.reply_read_by_admin:
            alert_recipient.reply_read_by_admin = True
    db.commit()

    return {
        "alert_id": str(alert.id),
        "message": alert.message,
        "alert_type": alert.alert_type,
        "created_at": format_utc_datetime(alert.created_at),
        "sender_name": alert.sender.full_name,
        "total_recipients": len(recipient_rows),
        "acknowledged_count": acknowledged_count,
        "pending_count": pending_count,
        "recipients": [
            {
                "recipient_id": str(recipient.id),
                "full_name": recipient.full_name,
                "employee_id": recipient.employee_id,
                "status": alert_recipient.status,
                "acknowledged_at": format_utc_datetime(
                    alert_recipient.acknowledged_at
                ),
                "reply": alert_recipient.reply,
            }
            for alert_recipient, recipient in recipient_rows
        ],
    }

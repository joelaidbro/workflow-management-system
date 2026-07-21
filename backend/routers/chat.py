import asyncio
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from auth import decode_jwt, get_current_user
from utils import strip_html_tags
from connection_manager import manager
from routers.notifications import send_push_to_user
from database import SessionLocal, get_db
from models import Message, User

router = APIRouter()



def parse_datetime(value: str | None):
    if not value:
        return None

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


@router.websocket("/chat/ws/{user_id}")
async def chat_websocket(websocket: WebSocket, user_id: str):
    db = SessionLocal()
    connected_user_id = None

    await websocket.accept()
    try:
        auth_message = await websocket.receive_json()
        token = auth_message.get("token")
        machine_token = auth_message.get("machine_token")

        payload = decode_jwt(token) if token else None
        if payload:
            token_user_id = payload.get("user_id")
            if str(token_user_id) != user_id:
                await websocket.close(code=1008)
                return

            try:
                sender_uuid = uuid.UUID(str(token_user_id))
            except ValueError:
                await websocket.close(code=1008)
                return

            sender = (
                db.query(User)
                .filter(User.id == sender_uuid, User.is_active.is_(True))
                .first()
            )
            if not sender:
                await websocket.close(code=1008)
                return
        elif machine_token:
            from routers.agent import verify_machine_token
            sender, _, token_error = verify_machine_token(user_id, machine_token, db)
            if token_error or not sender:
                await websocket.close(code=1008)
                return
        else:
            await websocket.close(code=1008)
            return

        await manager.register(user_id, websocket)
        connected_user_id = user_id

        while True:
            incoming = await websocket.receive_json()

            if incoming.get("type") == "visibility":
                await manager.set_visible(user_id, bool(incoming.get("visible")))
                continue

            recipient_id = incoming.get("recipient_id")
            content = strip_html_tags(incoming.get("content", ""))

            try:
                recipient_uuid = uuid.UUID(str(recipient_id))
            except ValueError:
                await websocket.send_json({"type": "error", "message": "Invalid recipient"})
                continue

            recipient = (
                db.query(User)
                .filter(
                    User.id == recipient_uuid,
                    User.company_id == sender.company_id,
                    User.is_active.is_(True),
                )
                .first()
            )
            if not recipient:
                await websocket.send_json({"type": "error", "message": "Invalid recipient"})
                continue

            if not content:
                await websocket.send_json({"type": "error", "message": "Message is empty"})
                continue

            message = Message(
                company_id=sender.company_id,
                sender_id=sender.id,
                recipient_id=recipient.id,
                content=content,
                is_read=False,
                created_at=datetime.utcnow(),
            )
            db.add(message)
            db.commit()
            db.refresh(message)

            await manager.send_to_user(
                str(recipient.id),
                {
                    "type": "new_message",
                    "message_id": str(message.id),
                    "sender_id": str(sender.id),
                    "sender_name": sender.full_name,
                    "content": message.content,
                    "created_at": message.created_at.isoformat() + "Z",
                },
            )

            asyncio.create_task(
                send_push_to_user(
                    str(recipient.id),
                    sender.full_name,
                    message.content[:100],
                )
            )

            await websocket.send_json(
                {
                    "type": "message_sent",
                    "message_id": str(message.id),
                    "recipient_id": str(recipient.id),
                    "created_at": message.created_at.isoformat() + "Z",
                }
            )
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(connected_user_id or user_id)
        db.close()


@router.get("/chat/history/{other_user_id}")
def get_message_history(
    other_user_id: str,
    before: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        other_uuid = uuid.UUID(str(other_user_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found")

    other_user = (
        db.query(User)
        .filter(
            User.id == other_uuid,
            User.company_id == current_user.company_id,
            User.is_active.is_(True),
        )
        .first()
    )
    if not other_user:
        raise HTTPException(status_code=404, detail="User not found")

    query = db.query(Message).filter(
        Message.company_id == current_user.company_id,
        or_(
            and_(
                Message.sender_id == current_user.id,
                Message.recipient_id == other_user.id,
            ),
            and_(
                Message.sender_id == other_user.id,
                Message.recipient_id == current_user.id,
            ),
        ),
    )

    before_datetime = parse_datetime(before)
    if before_datetime:
        query = query.filter(Message.created_at < before_datetime)

    messages = query.order_by(Message.created_at.desc()).limit(50).all()

    for message in messages:
        if message.recipient_id == current_user.id and not message.is_read:
            message.is_read = True
    db.commit()

    return [
        {
            "message_id": str(message.id),
            "sender_id": str(message.sender_id),
            "sender_name": message.sender.full_name,
            "content": message.content,
            "created_at": message.created_at.isoformat() + "Z",
            "is_read": message.is_read,
        }
        for message in reversed(messages)
    ]


@router.get("/chat/conversations")
def get_conversations(
    fmt: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    messages = (
        db.query(Message)
        .filter(
            Message.company_id == current_user.company_id,
            or_(
                Message.sender_id == current_user.id,
                Message.recipient_id == current_user.id,
            ),
        )
        .order_by(Message.created_at.desc())
        .limit(500)
        .all()
    )

    conversation_messages = {}
    for message in messages:
        if message.sender_id == current_user.id:
            other_user_id = message.recipient_id
            other_user = message.recipient
        else:
            other_user_id = message.sender_id
            other_user = message.sender

        if other_user_id not in conversation_messages:
            conversation_messages[other_user_id] = {
                "user": other_user,
                "last_message": message,
            }

    unread_rows = (
        db.query(Message.sender_id, func.count(Message.id).label("cnt"))
        .filter(
            Message.company_id == current_user.company_id,
            Message.recipient_id == current_user.id,
            Message.is_read.is_(False),
        )
        .group_by(Message.sender_id)
        .all()
    )
    unread_by_sender = {row.sender_id: row.cnt for row in unread_rows}

    conversations = []
    for other_user_id, conversation in conversation_messages.items():
        unread_count = unread_by_sender.get(other_user_id, 0)
        other_user = conversation["user"]
        last_message = conversation["last_message"]

        conversations.append(
            {
                "user_id": str(other_user.id),
                "full_name": other_user.full_name,
                "department": other_user.department,
                "last_message": last_message.content,
                "last_message_at": last_message.created_at.isoformat() + "Z",
                "unread_count": unread_count,
            }
        )

    total_unread_count = (
        db.query(Message)
        .filter(
            Message.company_id == current_user.company_id,
            Message.recipient_id == current_user.id,
            Message.is_read.is_(False),
        )
        .count()
    )

    if fmt == "dict":
        return {
            "conversations": conversations,
            "total_unread_count": total_unread_count,
        }

    for c in conversations:
        c["total_unread_count"] = total_unread_count
    return conversations


@router.get("/chat/unread-count")
def get_unread_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    unread_count = (
        db.query(Message)
        .filter(
            Message.company_id == current_user.company_id,
            Message.recipient_id == current_user.id,
            Message.is_read.is_(False),
        )
        .count()
    )
    return {"unread_count": unread_count}

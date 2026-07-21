import asyncio
import json
import logging
import os
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from connection_manager import manager
from database import SessionLocal, get_db
from models import PushSubscription, User

logger = logging.getLogger(__name__)
router = APIRouter()

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY") or os.getenv("VAPID_PRIVATE_KEY_PATH")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
VAPID_EMAIL = os.getenv("VAPID_EMAIL", "admin@example.com")


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


@router.post("/notifications/subscribe")
def subscribe_push(
    sub_data: PushSubscriptionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == sub_data.endpoint)
        .first()
    )
    if existing:
        existing.user_id = current_user.id
        existing.p256dh = sub_data.p256dh
        existing.auth = sub_data.auth
    else:
        db.add(
            PushSubscription(
                user_id=current_user.id,
                endpoint=sub_data.endpoint,
                p256dh=sub_data.p256dh,
                auth=sub_data.auth,
            )
        )
    db.commit()
    return {"ok": True}


@router.delete("/notifications/unsubscribe")
def unsubscribe_push(
    endpoint: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == endpoint,
        PushSubscription.user_id == current_user.id,
    ).delete()
    db.commit()
    return {"ok": True}


async def send_push_to_user(user_id: str, title: str, body: str):
    """
    Send a Web Push notification to all subscriptions for the given user.
    Silently skipped if:
      - VAPID keys are not configured
      - The user is currently connected via WebSocket (WS notification suffices)
      - pywebpush is not available
    """
    if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        return
    if await manager.is_visible(user_id):
        return

    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        return

    db = SessionLocal()
    try:
        subscriptions = (
            db.query(PushSubscription)
            .filter(PushSubscription.user_id == uuid.UUID(user_id))
            .all()
        )
        stale_ids = []
        for sub in subscriptions:
            try:
                await asyncio.to_thread(
                    webpush,
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                    },
                    data=json.dumps({"title": title, "body": body}),
                    vapid_private_key=VAPID_PRIVATE_KEY,
                    vapid_claims={"sub": f"mailto:{VAPID_EMAIL}"},
                )
            except WebPushException as ex:
                if ex.response is not None and ex.response.status_code == 410:
                    stale_ids.append(sub.id)
                else:
                    logger.debug(f"Push failed for {user_id}: {ex}")
            except Exception as e:
                logger.debug(f"Push error for {user_id}: {e}")

        if stale_ids:
            db.query(PushSubscription).filter(
                PushSubscription.id.in_(stale_ids)
            ).delete(synchronize_session=False)
            db.commit()
    finally:
        db.close()


def push_to_user_sync(user_id: str, title: str, body: str):
    """Schedule a push notification from a sync endpoint running in a threadpool."""
    if manager._loop and manager._loop.is_running():
        asyncio.run_coroutine_threadsafe(
            send_push_to_user(user_id, title, body), manager._loop
        )

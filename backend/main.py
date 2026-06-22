import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from database import SessionLocal
from models import ActivityLog, CurrentStatus, Screenshot, User

limiter = Limiter(key_func=get_remote_address)

from routers.agent import router as agent_router
from routers.alerts import router as alerts_router
from routers.attendance import router as attendance_router
from routers.auth import router as auth_router
from routers.chat import router as chat_router
from routers.leave import router as leave_router
from routers.platform import router as platform_router
from routers.settings import router as settings_router
from routers.screenshots import router as screenshots_router
from routers.status import router as status_router
from routers.users import router as users_router

load_dotenv()


async def offline_detection_task():
    logging.info("Offline detection task started")
    while True:
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            offline_cutoff = now - timedelta(minutes=2)
            stale_statuses = (
                db.query(CurrentStatus, User)
                .join(User, User.id == CurrentStatus.user_id)
                .filter(
                    CurrentStatus.updated_at < offline_cutoff,
                    CurrentStatus.status != "offline",
                )
                .all()
            )

            for current_status, user in stale_statuses:
                current_status.status = "offline"
                db.add(
                    ActivityLog(
                        company_id=user.company_id,
                        user_id=user.id,
                        status="offline",
                        timestamp=now,
                        machine_id=current_status.machine_id,
                    )
                )

            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

        await asyncio.sleep(60)


async def screenshot_cleanup_task():
    print("Screenshot cleanup task started")
    while True:
        db = SessionLocal()
        try:
            cutoff = datetime.utcnow() - timedelta(hours=48)
            old_screenshots = (
                db.query(Screenshot)
                .filter(
                    Screenshot.captured_at < cutoff,
                    Screenshot.is_deleted == False,
                )
                .all()
            )

            for screenshot in old_screenshots:
                try:
                    full_path = os.path.join(
                        "/home/teams.aidbro.com/screenshots",
                        screenshot.file_path,
                    )
                    if os.path.exists(full_path):
                        os.remove(full_path)
                except Exception:
                    pass
                screenshot.is_deleted = True

            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create the task inside the lifespan context.
    # This guarantees the event loop is running.
    tasks = [
        asyncio.create_task(offline_detection_task()),
        asyncio.create_task(screenshot_cleanup_task()),
    ]
    try:
        yield
    finally:
        # Clean shutdown - cancel the tasks when server stops.
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

allowed_origins_value = os.getenv("ALLOWED_ORIGINS")
allowed_origins = (
    [origin.strip() for origin in allowed_origins_value.split(",")]
    if allowed_origins_value
    else []
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(agent_router, prefix="/api")
app.include_router(status_router, prefix="/api")
app.include_router(alerts_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(attendance_router, prefix="/api")
app.include_router(leave_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(platform_router, prefix="/api")
app.include_router(screenshots_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}

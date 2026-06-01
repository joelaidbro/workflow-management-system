import asyncio
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
from models import ActivityLog, CurrentStatus, User

limiter = Limiter(key_func=get_remote_address)

from routers.agent import router as agent_router
from routers.alerts import router as alerts_router
from routers.attendance import router as attendance_router
from routers.auth import router as auth_router
from routers.chat import router as chat_router
from routers.leave import router as leave_router
from routers.status import router as status_router
from routers.users import router as users_router

load_dotenv()


async def offline_detection_task():
    print("Offline detection task started")
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create the task inside the lifespan context.
    # This guarantees the event loop is running.
    task = asyncio.create_task(offline_detection_task())
    try:
        yield
    finally:
        # Clean shutdown - cancel the task when server stops.
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
allowed_origins = [origin.strip() for origin in allowed_origins.split(",")]

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


@app.get("/health")
def health():
    return {"status": "ok"}

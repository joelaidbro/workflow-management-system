import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import SessionLocal
from models import ActivityLog, CurrentStatus, User
from routers.agent import router as agent_router
from routers.alerts import router as alerts_router
from routers.auth import router as auth_router
from routers.chat import router as chat_router
from routers.status import router as status_router

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


@app.get("/health")
def health():
    return {"status": "ok"}

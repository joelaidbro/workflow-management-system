import asyncio
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from sqlalchemy.exc import IntegrityError

import crypto_utils  # noqa: F401  (import triggers fail-fast OAUTH_ENCRYPTION_KEY validation)
from auth import decode_jwt
from connection_manager import manager
from database import SessionLocal
from limiter import limiter
from models import Subscription, User
from tasks import (
    company_deletion_task,
    daily_reset_task,
    offline_detection_task,
    reminder_dispatch_task,
    screenshot_cleanup_task,
    subscription_billing_task,
)

from routers.agent import router as agent_router
from routers.billing import router as billing_router
from routers.calendar import router as calendar_router
from routers.notifications import router as notifications_router
from routers.alerts import router as alerts_router
from routers.attendance import router as attendance_router
from routers.auth import router as auth_router
from routers.chat import router as chat_router
from routers.leave import router as leave_router
from routers.platform import router as platform_router
from routers.reminders import router as reminders_router
from routers.settings import router as settings_router
from routers.screenshots import router as screenshots_router
from routers.status import router as status_router
from routers.tasks import router as tasks_router
from routers.team import router as team_router
from routers.users import router as users_router

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    await manager.startup(redis_url)
    tasks = [
        asyncio.create_task(offline_detection_task()),
        asyncio.create_task(screenshot_cleanup_task()),
        asyncio.create_task(company_deletion_task()),
        asyncio.create_task(daily_reset_task()),
        asyncio.create_task(reminder_dispatch_task()),
        asyncio.create_task(subscription_billing_task()),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
        await manager.shutdown()


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


# Paths exempt from the subscription lock even for a 'locked' company: auth
# (must always be able to log in/out), billing (must always be able to pay
# their way out of the lock), platform (platform_admin isn't scoped to a
# company's billing state), and agent (the desktop tracking agent runs
# unattended on a machine token — locking it mid-shift would silently corrupt
# open attendance sessions rather than meaningfully pressure anyone to pay).
LOCK_EXEMPT_PREFIXES = ("/api/auth", "/api/billing", "/api/platform", "/api/agent")


class SubscriptionLockMiddleware(BaseHTTPMiddleware):
    """Blocks mutating requests (POST/PUT/PATCH/DELETE) from any company whose
    subscription has reached 'locked' status (unpaid past the grace period —
    see routers/billing.py and tasks.subscription_billing_task). Read (GET)
    requests always pass through untouched, per the product requirement that
    locked accounts can still log in and view their data. platform_admin
    accounts are never scoped to a single company's billing and always pass
    through."""

    async def dispatch(self, request, call_next):
        if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
            return await call_next(request)

        path = request.url.path
        if not path.startswith("/api/") or path.startswith(LOCK_EXEMPT_PREFIXES):
            return await call_next(request)

        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]
        else:
            token = request.cookies.get("access_token")
        if not token:
            return await call_next(request)  # let the route's own auth dependency 401 it

        payload = decode_jwt(token)
        user_id = payload.get("user_id") if payload else None
        if not user_id:
            return await call_next(request)

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
            if not user or user.role == "platform_admin":
                return await call_next(request)

            subscription = (
                db.query(Subscription).filter(Subscription.company_id == user.company_id).first()
            )
            if subscription and subscription.status == "locked":
                return JSONResponse(
                    status_code=402,
                    content={
                        "detail": "Your company's subscription payment is overdue. "
                        "Actions are locked until payment is made.",
                        "code": "SUBSCRIPTION_LOCKED",
                    },
                )
        finally:
            db.close()

        return await call_next(request)


app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(SubscriptionLockMiddleware)


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request, exc):
    return JSONResponse(
        status_code=409,
        content={"detail": "A conflicting record already exists. Please try again."},
    )

allowed_origins_value = os.getenv("ALLOWED_ORIGINS")
if not allowed_origins_value:
    raise RuntimeError("ALLOWED_ORIGINS is not set. Add it to your .env file (e.g. ALLOWED_ORIGINS=https://yourdomain.com).")
allowed_origins = [origin.strip() for origin in allowed_origins_value.split(",")]

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
app.include_router(tasks_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(team_router, prefix="/api")
app.include_router(calendar_router, prefix="/api")
app.include_router(reminders_router, prefix="/api")
app.include_router(billing_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}

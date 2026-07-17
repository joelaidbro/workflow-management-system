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

from connection_manager import manager
from limiter import limiter
from tasks import (
    company_deletion_task,
    daily_reset_task,
    offline_detection_task,
    screenshot_cleanup_task,
)

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
from routers.tasks import router as tasks_router
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


app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SecurityHeadersMiddleware)


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


@app.get("/health")
def health():
    return {"status": "ok"}

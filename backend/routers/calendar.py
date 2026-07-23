import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlencode

import requests
from cryptography.fernet import InvalidToken
from dotenv import load_dotenv
from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from auth import ALGORITHM, SECRET_KEY, get_current_user
from crypto_utils import decrypt_token, encrypt_token
from database import get_db
from models import GoogleOAuthToken, User
from utils import format_utc_datetime

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logger = logging.getLogger(__name__)
router = APIRouter()

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI")
if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET or not GOOGLE_REDIRECT_URI:
    raise RuntimeError(
        "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI must all be "
        "set in .env. See DEPLOYMENT.md for the Google Cloud Console setup steps."
    )

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"

STATE_PURPOSE = "google_oauth_state"
STATE_EXPIRE_MINUTES = 10

# Where to send the browser back to after the Google redirect. Deliberately
# just the top-level dashboard route (not a specific sidebar section) so this
# doesn't need updating every time a frontend section id changes.
DASHBOARD_PATH_BY_ROLE = {
    "staff": "/staff",
    "admin": "/admin",
    "super_admin": "/admin",
    "platform_admin": "/platform",
}


def _frontend_origin() -> str:
    origins = os.getenv("ALLOWED_ORIGINS", "")
    first = origins.split(",")[0].strip() if origins else ""
    return first or "http://localhost:5173"


def _create_state_token(user_id: str) -> str:
    payload = {
        "user_id": user_id,
        "purpose": STATE_PURPOSE,
        "exp": datetime.utcnow() + timedelta(minutes=STATE_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_valid_access_token(user: User, db: Session) -> str | None:
    """Return a valid Google access token for the user, refreshing it via the
    stored refresh_token if expired. Returns None if the user has never
    connected Google Calendar, or if Google rejects the refresh (revoked,
    expired, or the app lost access) - callers must treat None as "Google
    sync unavailable right now", never let it crash the caller's flow."""
    token_row = db.query(GoogleOAuthToken).filter(GoogleOAuthToken.user_id == user.id).first()
    if not token_row:
        return None

    if token_row.token_expiry > datetime.utcnow() + timedelta(minutes=1):
        try:
            return decrypt_token(token_row.access_token)
        except InvalidToken:
            logger.error(f"Undecryptable Google access_token for user {user.id} (key mismatch?)")
            return None

    try:
        raw_refresh_token = decrypt_token(token_row.refresh_token)
    except InvalidToken:
        logger.error(f"Undecryptable Google refresh_token for user {user.id} (key mismatch?)")
        return None

    try:
        resp = requests.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": raw_refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        logger.error(f"Google token refresh failed for user {user.id}: {exc}")
        return None

    new_access_token = data.get("access_token")
    expires_in = data.get("expires_in", 3600)
    if not new_access_token:
        logger.error(f"Google token refresh response missing access_token for user {user.id}")
        return None

    token_row.access_token = encrypt_token(new_access_token)
    token_row.token_expiry = datetime.utcnow() + timedelta(seconds=expires_in)
    db.commit()

    return new_access_token


@router.get("/calendar/auth-url")
def get_auth_url(current_user: User = Depends(get_current_user)):
    state = _create_state_token(str(current_user.id))
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": CALENDAR_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return {"auth_url": f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}"}


@router.get("/calendar/callback")
def google_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    origin = _frontend_origin()
    fallback_redirect = f"{origin}/login?calendar=failed"

    if not state:
        logger.warning("Google OAuth callback received with no state param")
        return RedirectResponse(fallback_redirect)

    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose") != STATE_PURPOSE:
            raise JWTError("wrong purpose claim")
        user_id = payload["user_id"]
    except (JWTError, KeyError):
        logger.warning("Google OAuth callback received with invalid or expired state")
        return RedirectResponse(fallback_redirect)

    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user:
        return RedirectResponse(fallback_redirect)

    dashboard_path = DASHBOARD_PATH_BY_ROLE.get(user.role, "/login")
    success_redirect = f"{origin}{dashboard_path}?calendar=connected"
    failure_redirect = f"{origin}{dashboard_path}?calendar=failed"

    if error:
        logger.warning(f"Google OAuth consent denied/error for user {user.id}: {error}")
        return RedirectResponse(failure_redirect)

    if not code:
        logger.warning(f"Google OAuth callback missing code for user {user.id}")
        return RedirectResponse(failure_redirect)

    try:
        token_response = requests.post(
            GOOGLE_TOKEN_ENDPOINT,
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        token_response.raise_for_status()
        token_data = token_response.json()
    except requests.RequestException as exc:
        logger.error(f"Google token exchange failed for user {user.id}: {exc}")
        return RedirectResponse(failure_redirect)

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)

    if not access_token or not refresh_token:
        # Google omits refresh_token if the user already granted consent before
        # and, rarely, doesn't re-issue it even with prompt=consent. Treat as a
        # failure so the user is told to reconnect rather than silently storing
        # a connection we can't refresh later.
        logger.error(
            f"Google token response missing access_token/refresh_token for user "
            f"{user.id}: keys={list(token_data.keys())}"
        )
        return RedirectResponse(failure_redirect)

    token_expiry = datetime.utcnow() + timedelta(seconds=expires_in)

    existing = db.query(GoogleOAuthToken).filter(GoogleOAuthToken.user_id == user.id).first()
    if existing:
        existing.access_token = encrypt_token(access_token)
        existing.refresh_token = encrypt_token(refresh_token)
        existing.token_expiry = token_expiry
        existing.connected_at = datetime.utcnow()
    else:
        db.add(
            GoogleOAuthToken(
                user_id=user.id,
                access_token=encrypt_token(access_token),
                refresh_token=encrypt_token(refresh_token),
                token_expiry=token_expiry,
            )
        )
    db.commit()

    return RedirectResponse(success_redirect)


@router.get("/calendar/status")
def calendar_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    token_row = db.query(GoogleOAuthToken).filter(GoogleOAuthToken.user_id == current_user.id).first()
    if not token_row:
        return {"connected": False}
    return {
        "connected": True,
        "connected_at": format_utc_datetime(token_row.connected_at),
        "google_email": token_row.google_email,
    }


@router.delete("/calendar/disconnect")
def disconnect_calendar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    token_row = db.query(GoogleOAuthToken).filter(GoogleOAuthToken.user_id == current_user.id).first()
    if not token_row:
        return {"ok": True, "was_connected": False}

    try:
        raw_refresh_token = decrypt_token(token_row.refresh_token)
        requests.post(GOOGLE_REVOKE_ENDPOINT, params={"token": raw_refresh_token}, timeout=10)
    except (InvalidToken, requests.RequestException) as exc:
        # The user's disconnect request must always succeed locally even if
        # Google's revoke endpoint is unreachable or the stored token is bad.
        logger.warning(f"Google token revoke call failed for user {current_user.id}: {exc}")

    db.delete(token_row)
    db.commit()
    return {"ok": True, "was_connected": True}

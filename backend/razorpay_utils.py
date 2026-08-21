"""Thin wrapper around the Razorpay SDK for the subscription/billing feature.

Kept deliberately optional at import time — the app must still start and run
normally before Razorpay test/live keys are configured (mirrors how
GOOGLE_CLIENT_ID/etc. are handled for the calendar feature, except billing
should not hard-crash the whole app on a missing key since companies can
still be viewed read-only without it). Any endpoint that actually needs to
talk to Razorpay calls `get_client()`, which raises a clear, catchable error
if the keys aren't set yet.
"""
import hmac
import hashlib
import logging
import os

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET")

_client = None


class RazorpayNotConfigured(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET)


def get_client():
    global _client
    if not is_configured():
        raise RazorpayNotConfigured(
            "Razorpay is not configured on this server yet. Set RAZORPAY_KEY_ID "
            "and RAZORPAY_KEY_SECRET in backend/.env, then restart the service."
        )
    if _client is None:
        import razorpay

        _client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    return _client


def rupees_to_paise(amount) -> int:
    """Razorpay amounts are always the smallest currency unit (paise for INR)."""
    return int(round(float(amount) * 100))


def create_order(amount_rupees, receipt: str, notes: dict | None = None) -> dict:
    client = get_client()
    order = client.order.create(
        {
            "amount": rupees_to_paise(amount_rupees),
            "currency": "INR",
            "receipt": receipt,
            "notes": notes or {},
        }
    )
    return order


def verify_payment_signature(order_id: str, payment_id: str, signature: str) -> bool:
    """Verify the signature returned by Razorpay Checkout in the browser after
    a successful payment. This is the client-reported confirmation path; the
    webhook (verify_webhook_signature) is the server-to-server backstop for
    cases where the browser closes before this call happens."""
    client = get_client()
    try:
        client.utility.verify_payment_signature(
            {
                "razorpay_order_id": order_id,
                "razorpay_payment_id": payment_id,
                "razorpay_signature": signature,
            }
        )
        return True
    except Exception as exc:
        logger.warning(f"Razorpay signature verification failed: {exc}")
        return False


def verify_webhook_signature(raw_body: bytes, received_signature: str) -> bool:
    if not RAZORPAY_WEBHOOK_SECRET:
        logger.warning("Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not set")
        return False
    expected_signature = hmac.new(
        RAZORPAY_WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected_signature, received_signature or "")

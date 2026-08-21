"""Subscription billing for the whole platform.

Pricing model (editable live by the platform admin via PlatformSettings,
never hardcoded): a company's monthly cost is
    monthly_base_price + max(0, staff_count - included_staff_count) * extra_staff_price
staff_count = every active, non-platform_admin user in the company (staff +
admin + super_admin combined) — the whole team using the product, not just
the "staff" role. The yearly plan is simply 12x the monthly figure computed
the same way (no separate discount table for now).

Payment is manual-per-invoice via Razorpay Orders, never auto-debited: each
billing cycle (or staff-count increase mid-cycle) produces a
SubscriptionInvoice; the super admin pays it from the Subscriptions page,
which opens Razorpay Checkout for that one order. If a cycle's renewal
invoice goes unpaid past its due date, the subscription enters 'overdue';
after PlatformSettings.grace_period_hours with still no payment, it flips to
'locked' and the SubscriptionLockMiddleware in main.py starts blocking
mutating requests company-wide except for billing/auth routes.
"""
import logging
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, require_platform_admin, require_super_admin
from database import get_db
from models import Company, PlatformSettings, Subscription, SubscriptionInvoice, User
from routers.notifications import push_to_user_sync
import razorpay_utils

logger = logging.getLogger(__name__)
router = APIRouter()

PLAN_CYCLE_DAYS = {"monthly": 30, "yearly": 365}


# --------------------------------------------------------------------------
# Shared helpers
# --------------------------------------------------------------------------

def get_or_create_platform_settings(db: Session) -> PlatformSettings:
    settings = db.query(PlatformSettings).first()
    if not settings:
        settings = PlatformSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def get_billable_staff_count(company_id, db: Session) -> int:
    return (
        db.query(User)
        .filter(
            User.company_id == company_id,
            User.is_active.is_(True),
            User.role != "platform_admin",
        )
        .count()
    )


def compute_cycle_amount(settings: PlatformSettings, plan_type: str, staff_count: int) -> Decimal:
    extra_units = max(0, staff_count - settings.included_staff_count)
    monthly_total = Decimal(settings.monthly_base_price) + (extra_units * Decimal(settings.extra_staff_price))
    if plan_type == "yearly":
        return (monthly_total * 12).quantize(Decimal("0.01"))
    return monthly_total.quantize(Decimal("0.01"))


def get_or_create_subscription(company: Company, db: Session, settings: PlatformSettings) -> Subscription:
    """Backfills a Subscription for any company that predates this feature
    (or was created before a subscription row exists for any other reason).
    New companies get one created here on first access to billing endpoints,
    or explicitly during onboarding — see create_company in platform.py."""
    if company.subscription:
        return company.subscription

    now = datetime.utcnow()
    staff_count = get_billable_staff_count(company.id, db)
    subscription = Subscription(
        company_id=company.id,
        plan_type="monthly",
        status="active",
        staff_count_at_invoice=staff_count,
        current_period_start=now,
        current_period_end=now + timedelta(days=PLAN_CYCLE_DAYS["monthly"]),
    )
    db.add(subscription)
    db.flush()

    # First invoice for a brand-new/backfilled subscription is due within the
    # grace window rather than a full cycle away, so companies don't get a
    # free month before their first payment is ever requested.
    amount = compute_cycle_amount(settings, "monthly", staff_count)
    db.add(
        SubscriptionInvoice(
            company_id=company.id,
            subscription_id=subscription.id,
            invoice_type="renewal",
            amount=amount,
            staff_count=staff_count,
            period_start=now,
            period_end=subscription.current_period_end,
            due_at=now + timedelta(hours=settings.grace_period_hours),
            status="pending",
        )
    )
    db.commit()
    db.refresh(subscription)
    return subscription


def days_left(subscription: Subscription) -> int:
    delta = subscription.current_period_end - datetime.utcnow()
    return max(0, delta.days)


def format_invoice(invoice: SubscriptionInvoice) -> dict:
    return {
        "id": str(invoice.id),
        "invoice_type": invoice.invoice_type,
        "amount": invoice.amount,
        "currency": invoice.currency,
        "status": invoice.status,
        "staff_count": invoice.staff_count,
        "period_start": invoice.period_start,
        "period_end": invoice.period_end,
        "due_at": invoice.due_at,
        "paid_at": invoice.paid_at,
        "created_at": invoice.created_at,
    }


def format_subscription(subscription: Subscription, settings: PlatformSettings, db: Session) -> dict:
    staff_count = get_billable_staff_count(subscription.company_id, db)
    current_amount = compute_cycle_amount(settings, subscription.plan_type, staff_count)
    pending_invoices = (
        db.query(SubscriptionInvoice)
        .filter(
            SubscriptionInvoice.subscription_id == subscription.id,
            SubscriptionInvoice.status == "pending",
        )
        .order_by(SubscriptionInvoice.created_at.asc())
        .all()
    )
    return {
        "plan_type": subscription.plan_type,
        "status": subscription.status,
        "staff_count": staff_count,
        "included_staff_count": settings.included_staff_count,
        "current_cycle_amount": current_amount,
        "currency": settings.currency,
        "current_period_start": subscription.current_period_start,
        "current_period_end": subscription.current_period_end,
        "days_left": days_left(subscription),
        "locked_at": subscription.locked_at,
        "pending_invoices": [format_invoice(inv) for inv in pending_invoices],
    }


def maybe_create_proration_invoice(company_id, db: Session) -> SubscriptionInvoice | None:
    """Called right after a new staff/admin user is created. If the company is
    now over its included seat count (or further over it than before), bills
    the newly-crossed seats immediately for the days remaining in the current
    cycle, rather than waiting for the next renewal. Returns the created
    invoice (or None if nothing extra is owed right now)."""
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        return None

    settings = get_or_create_platform_settings(db)
    subscription = get_or_create_subscription(company, db, settings)
    if subscription.status == "cancelled":
        return None

    new_staff_count = get_billable_staff_count(company_id, db)
    previous_staff_count = subscription.staff_count_at_invoice
    subscription.staff_count_at_invoice = new_staff_count

    extra_before = max(0, previous_staff_count - settings.included_staff_count)
    extra_after = max(0, new_staff_count - settings.included_staff_count)
    new_extra_units = max(0, extra_after - extra_before)

    if new_extra_units <= 0:
        db.commit()
        return None

    now = datetime.utcnow()
    cycle_days = max(1, (subscription.current_period_end - subscription.current_period_start).days)
    days_remaining = max(0, (subscription.current_period_end - now).days)
    proration_ratio = Decimal(days_remaining) / Decimal(cycle_days)
    amount = (Decimal(new_extra_units) * Decimal(settings.extra_staff_price) * proration_ratio).quantize(Decimal("0.01"))

    if amount <= 0:
        db.commit()
        return None

    invoice = SubscriptionInvoice(
        company_id=company_id,
        subscription_id=subscription.id,
        invoice_type="proration",
        amount=amount,
        staff_count=new_staff_count,
        period_start=now,
        period_end=subscription.current_period_end,
        due_at=now + timedelta(hours=settings.grace_period_hours),
        status="pending",
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    for super_admin in db.query(User).filter(
        User.company_id == company_id, User.role == "super_admin", User.is_active.is_(True)
    ):
        push_to_user_sync(
            str(super_admin.id),
            "Subscription: extra charge added",
            f"Adding staff pushed you over your included seats. A prorated charge of "
            f"{settings.currency} {amount} has been added — pay it from Subscriptions.",
        )

    return invoice


def _apply_paid_invoice(invoice: SubscriptionInvoice, subscription: Subscription, db: Session):
    now = datetime.utcnow()
    invoice.status = "paid"
    invoice.paid_at = now

    if invoice.invoice_type == "renewal":
        cycle_days = PLAN_CYCLE_DAYS.get(subscription.plan_type, 30)
        base = subscription.current_period_end if subscription.current_period_end > now else now
        subscription.current_period_start = base
        subscription.current_period_end = base + timedelta(days=cycle_days)
        subscription.status = "active"
        subscription.locked_at = None
        subscription.expiry_warning_sent_at = None

    db.commit()

    for super_admin in db.query(User).filter(
        User.company_id == invoice.company_id, User.role == "super_admin", User.is_active.is_(True)
    ):
        push_to_user_sync(
            str(super_admin.id),
            "Payment confirmed",
            f"Your payment of {invoice.currency} {invoice.amount} was received. Thank you!",
        )


# --------------------------------------------------------------------------
# Platform admin — global pricing + per-company overview
# --------------------------------------------------------------------------

class UpdatePlatformSettingsRequest(BaseModel):
    monthly_base_price: Decimal | None = None
    included_staff_count: int | None = None
    extra_staff_price: Decimal | None = None
    grace_period_hours: int | None = None


@router.get("/billing/platform-settings")
def get_platform_settings(
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    settings = get_or_create_platform_settings(db)
    return {
        "monthly_base_price": settings.monthly_base_price,
        "included_staff_count": settings.included_staff_count,
        "extra_staff_price": settings.extra_staff_price,
        "grace_period_hours": settings.grace_period_hours,
        "currency": settings.currency,
        "updated_at": settings.updated_at,
    }


@router.patch("/billing/platform-settings")
def update_platform_settings(
    body: UpdatePlatformSettingsRequest,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    settings = get_or_create_platform_settings(db)
    update_data = body.model_dump(exclude_unset=True)

    for field in ("monthly_base_price", "extra_staff_price"):
        if field in update_data and update_data[field] < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} cannot be negative")
    if "included_staff_count" in update_data and update_data["included_staff_count"] < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="included_staff_count cannot be negative")
    if "grace_period_hours" in update_data and update_data["grace_period_hours"] < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="grace_period_hours cannot be negative")

    for field, value in update_data.items():
        setattr(settings, field, value)

    db.commit()
    db.refresh(settings)
    return {
        "monthly_base_price": settings.monthly_base_price,
        "included_staff_count": settings.included_staff_count,
        "extra_staff_price": settings.extra_staff_price,
        "grace_period_hours": settings.grace_period_hours,
        "currency": settings.currency,
        "updated_at": settings.updated_at,
    }


@router.get("/billing/platform/companies")
def list_company_subscriptions(
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    settings = get_or_create_platform_settings(db)
    companies = db.query(Company).order_by(Company.name.asc()).all()

    response = []
    for company in companies:
        subscription = get_or_create_subscription(company, db, settings)
        response.append({
            "company_id": str(company.id),
            "company_name": company.name,
            **format_subscription(subscription, settings, db),
        })
    return response


class UpdateSubscriptionOverrideRequest(BaseModel):
    status: str | None = None
    extend_days: int | None = None


@router.patch("/billing/platform/companies/{company_id}/subscription")
def override_company_subscription(
    company_id: str,
    body: UpdateSubscriptionOverrideRequest,
    current_user: User = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Manual operator override — e.g. comp a company (status='cancelled',
    which exempts it from lock enforcement entirely) or grant a one-off
    extension without requiring a payment (extend_days)."""
    try:
        company_uuid = uuid.UUID(str(company_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    company = db.query(Company).filter(Company.id == company_uuid).first()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    settings = get_or_create_platform_settings(db)
    subscription = get_or_create_subscription(company, db, settings)

    valid_statuses = {"active", "overdue", "locked", "cancelled"}
    if body.status is not None:
        if body.status not in valid_statuses:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status")
        subscription.status = body.status
        subscription.locked_at = datetime.utcnow() if body.status == "locked" else None

    if body.extend_days is not None:
        if body.extend_days <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="extend_days must be positive")
        subscription.current_period_end = subscription.current_period_end + timedelta(days=body.extend_days)
        if subscription.status in ("overdue", "locked"):
            subscription.status = "active"
            subscription.locked_at = None

    db.commit()
    db.refresh(subscription)
    return format_subscription(subscription, settings, db)


# --------------------------------------------------------------------------
# Super admin — own company's subscription + checkout
# --------------------------------------------------------------------------

@router.get("/billing/status")
def get_my_billing_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lightweight, role-agnostic status check used to show the persistent
    banner in the dashboard shell for every role (admin/staff get just
    enough to know something's wrong and who to contact; super_admin gets
    the same shape here and the full picture on the Subscriptions page)."""
    if current_user.role == "platform_admin":
        return {"status": "active", "days_left": None}

    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    settings = get_or_create_platform_settings(db)
    subscription = get_or_create_subscription(company, db, settings)
    return {
        "status": subscription.status,
        "days_left": days_left(subscription),
    }


@router.get("/billing/subscription")
def get_my_subscription(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    settings = get_or_create_platform_settings(db)
    subscription = get_or_create_subscription(company, db, settings)
    return format_subscription(subscription, settings, db)


@router.get("/billing/payments")
def list_my_payments(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    invoices = (
        db.query(SubscriptionInvoice)
        .filter(SubscriptionInvoice.company_id == current_user.company_id)
        .order_by(SubscriptionInvoice.created_at.desc())
        .all()
    )
    return [format_invoice(inv) for inv in invoices]


class SwitchPlanRequest(BaseModel):
    plan_type: str


@router.post("/billing/subscription/plan")
def switch_plan(
    body: SwitchPlanRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    if body.plan_type not in PLAN_CYCLE_DAYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="plan_type must be 'monthly' or 'yearly'")

    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    settings = get_or_create_platform_settings(db)
    subscription = get_or_create_subscription(company, db, settings)
    subscription.plan_type = body.plan_type
    db.commit()
    db.refresh(subscription)
    return format_subscription(subscription, settings, db)


@router.post("/billing/checkout/create-order")
def create_checkout_order(
    invoice_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    settings = get_or_create_platform_settings(db)
    subscription = get_or_create_subscription(company, db, settings)

    if invoice_id:
        try:
            invoice_uuid = uuid.UUID(str(invoice_id))
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
        invoice = (
            db.query(SubscriptionInvoice)
            .filter(SubscriptionInvoice.id == invoice_uuid, SubscriptionInvoice.company_id == current_user.company_id)
            .first()
        )
        if not invoice or invoice.status != "pending":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such pending invoice")
    else:
        invoice = (
            db.query(SubscriptionInvoice)
            .filter(SubscriptionInvoice.company_id == current_user.company_id, SubscriptionInvoice.status == "pending")
            .order_by(SubscriptionInvoice.created_at.asc())
            .first()
        )
        if not invoice:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing due right now")

    try:
        order = razorpay_utils.create_order(
            invoice.amount,
            receipt=f"invoice-{invoice.id}",
            notes={"company_id": str(company.id), "invoice_id": str(invoice.id)},
        )
    except razorpay_utils.RazorpayNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    invoice.razorpay_order_id = order["id"]
    db.commit()

    return {
        "order_id": order["id"],
        "amount_paise": order["amount"],
        "currency": order["currency"],
        "key_id": razorpay_utils.RAZORPAY_KEY_ID,
        "invoice_id": str(invoice.id),
        "company_name": company.name,
        "user_name": current_user.full_name,
        "user_email": current_user.email,
    }


class VerifyPaymentRequest(BaseModel):
    invoice_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.post("/billing/checkout/verify")
def verify_checkout_payment(
    body: VerifyPaymentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)

    try:
        invoice_uuid = uuid.UUID(str(body.invoice_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")

    invoice = (
        db.query(SubscriptionInvoice)
        .filter(SubscriptionInvoice.id == invoice_uuid, SubscriptionInvoice.company_id == current_user.company_id)
        .first()
    )
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    if invoice.status == "paid":
        return {"message": "Already confirmed"}
    if invoice.razorpay_order_id != body.razorpay_order_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order mismatch")

    if not razorpay_utils.verify_payment_signature(
        body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment verification failed")

    invoice.razorpay_payment_id = body.razorpay_payment_id
    invoice.razorpay_signature = body.razorpay_signature

    subscription = db.query(Subscription).filter(Subscription.id == invoice.subscription_id).first()
    _apply_paid_invoice(invoice, subscription, db)

    settings = get_or_create_platform_settings(db)
    return format_subscription(subscription, settings, db)


@router.post("/billing/webhook/razorpay")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    """Server-to-server backstop: if the browser closes right after a
    successful payment and /billing/checkout/verify never fires, this
    webhook (configured in the Razorpay Dashboard) still confirms the
    invoice. Idempotent — safe to receive the same event more than once."""
    raw_body = await request.body()
    received_signature = request.headers.get("X-Razorpay-Signature", "")

    if not razorpay_utils.verify_webhook_signature(raw_body, received_signature):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook signature")

    import json

    payload = json.loads(raw_body)
    event = payload.get("event")
    if event != "payment.captured":
        return {"ok": True}

    payment_entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
    order_id = payment_entity.get("order_id")
    payment_id = payment_entity.get("id")
    if not order_id:
        return {"ok": True}

    invoice = db.query(SubscriptionInvoice).filter(SubscriptionInvoice.razorpay_order_id == order_id).first()
    if not invoice or invoice.status == "paid":
        return {"ok": True}

    invoice.razorpay_payment_id = payment_id
    subscription = db.query(Subscription).filter(Subscription.id == invoice.subscription_id).first()
    _apply_paid_invoice(invoice, subscription, db)
    return {"ok": True}

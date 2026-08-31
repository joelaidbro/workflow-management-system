"""Shared helpers for the CRM routers (crm_leads, crm_quotations, crm_bulk).

Kept separate from crm_settings.py because these are used across multiple
CRM routers and none of them own this logic more than another.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import Followup, Lead, LeadSource, LeadStatus, Quotation, SequenceCounter, User
from utils import format_utc_datetime

logger = logging.getLogger(__name__)

FOLLOWUP_EVENT_DURATION_MINUTES = 30

# Starting-point master data so a brand-new company's CRM isn't a blank,
# confusing screen. Lead statuses are the load-bearing one — enquiry
# creation is blocked without a "new"-nature status to default into — lead
# sources are just a convenience list. Both are fully editable/deletable
# afterward; this is only ever inserted when the table is completely empty,
# so it never overwrites or duplicates anything a company has customized.
DEFAULT_LEAD_STATUSES = [
    ("New", "new"),
    ("In Follow Up", "in_progress"),
    ("Won", "won"),
    ("Lost", "lost"),
]
DEFAULT_LEAD_SOURCES = ["Website", "Referral", "Phone Call", "Walk-in", "Social Media"]


def ensure_default_lead_statuses(db: Session, company_id) -> None:
    exists = db.query(LeadStatus.id).filter(LeadStatus.company_id == company_id).first()
    if exists:
        return
    now = datetime.utcnow()
    for name, nature in DEFAULT_LEAD_STATUSES:
        db.add(LeadStatus(company_id=company_id, name=name, nature=nature, created_at=now))
    db.commit()


def ensure_default_lead_sources(db: Session, company_id) -> None:
    exists = db.query(LeadSource.id).filter(LeadSource.company_id == company_id).first()
    if exists:
        return
    now = datetime.utcnow()
    for name in DEFAULT_LEAD_SOURCES:
        db.add(LeadSource(company_id=company_id, name=name, created_at=now))
    db.commit()


def ensure_default_crm_setup(db: Session, company_id) -> None:
    """Idempotent — safe to call on every request. Seeds whichever of
    lead statuses / lead sources is currently empty for this company."""
    ensure_default_lead_statuses(db, company_id)
    ensure_default_lead_sources(db, company_id)


def top_up_default_lead_statuses(db: Session, company_id) -> int:
    """Per-item idempotent seeding for the manual "Load Starter Defaults"
    button specifically. ensure_default_lead_statuses() above is a
    table-empty guard — it deliberately does nothing once a company has
    even one row, so it never resurrects a deliberate full wipe on every
    page load. But that same guard makes the manual button a permanent
    no-op after a company adds even a single custom status, which looks
    like a broken "success but nothing loaded" click. This inserts only
    the default names that aren't already present (case-insensitive),
    regardless of what else exists, and returns how many were added."""
    existing_names = {
        name.lower()
        for (name,) in db.query(LeadStatus.name).filter(LeadStatus.company_id == company_id).all()
    }
    now = datetime.utcnow()
    added = 0
    for name, nature in DEFAULT_LEAD_STATUSES:
        if name.lower() in existing_names:
            continue
        db.add(LeadStatus(company_id=company_id, name=name, nature=nature, created_at=now))
        added += 1
    if added:
        db.commit()
    return added


def top_up_default_lead_sources(db: Session, company_id) -> int:
    """Per-item idempotent counterpart to top_up_default_lead_statuses()
    for lead sources — see that function's docstring for why this exists
    separately from ensure_default_lead_sources()."""
    existing_names = {
        name.lower()
        for (name,) in db.query(LeadSource.name).filter(LeadSource.company_id == company_id).all()
    }
    now = datetime.utcnow()
    added = 0
    for name in DEFAULT_LEAD_SOURCES:
        if name.lower() in existing_names:
            continue
        db.add(LeadSource(company_id=company_id, name=name, created_at=now))
        added += 1
    if added:
        db.commit()
    return added


def build_lead_filter_query(db: Session, company_id, filters: dict):
    """Shared by GET /crm/leads and both crm_bulk.py endpoints (Task
    Assignment and Lead Transfer both filter leads down to a target set the
    same way — this is the one place that filter logic lives).

    `filters` keys (all optional): stage, lead_source_id, lead_status_id,
    assigned_to, lead_quality, created_from (date), created_to (date).
    """
    query = (
        db.query(Lead)
        .join(LeadStatus, Lead.lead_status_id == LeadStatus.id)
        .filter(Lead.company_id == company_id)
    )

    if filters.get("stage"):
        query = query.filter(LeadStatus.nature == filters["stage"])
    if filters.get("lead_source_id"):
        query = query.filter(Lead.lead_source_id == filters["lead_source_id"])
    if filters.get("lead_status_id"):
        query = query.filter(Lead.lead_status_id == filters["lead_status_id"])
    if filters.get("assigned_to"):
        query = query.filter(Lead.assigned_to == filters["assigned_to"])
    if filters.get("lead_quality"):
        query = query.filter(Lead.lead_quality == filters["lead_quality"])
    if filters.get("created_from"):
        query = query.filter(Lead.created_at >= filters["created_from"])
    if filters.get("created_to"):
        query = query.filter(Lead.created_at < filters["created_to"])

    return query


def next_sequence_number(db: Session, company_id, key: str, prefix: str, pad: int = 4) -> str:
    """Concurrency-safe ENQ-0001 / QUO-0001 style numbering. Locks the
    counter row with SELECT ... FOR UPDATE so two simultaneous requests
    can't be handed the same number — plain count()+1 breaks under
    concurrency and after deletions, which is why this exists as its own
    table instead of just counting existing rows."""
    counter = (
        db.query(SequenceCounter)
        .filter(SequenceCounter.company_id == company_id, SequenceCounter.key == key)
        .with_for_update()
        .first()
    )
    if not counter:
        counter = SequenceCounter(company_id=company_id, key=key, next_value=1)
        db.add(counter)
        db.flush()

    value = counter.next_value
    counter.next_value = value + 1
    db.flush()
    return f"{prefix}-{value:0{pad}d}"


def get_lead_in_company(lead_id: str, company_id, db: Session) -> Lead:
    try:
        lead_uuid = uuid.UUID(lead_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")

    lead = db.query(Lead).filter(Lead.id == lead_uuid, Lead.company_id == company_id).first()
    if not lead:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    return lead


def get_default_new_status(company_id, db: Session) -> LeadStatus:
    lead_status = (
        db.query(LeadStatus)
        .filter(LeadStatus.company_id == company_id, LeadStatus.nature == "new")
        .order_by(LeadStatus.created_at.asc())
        .first()
    )
    if not lead_status:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No lead status configured with nature 'new' — add one in CRM Settings first.",
        )
    return lead_status


def format_lead(lead: Lead) -> dict:
    return {
        "id": str(lead.id),
        "number": lead.number,
        "customer_name": lead.customer_name,
        "phone": lead.phone,
        "place": lead.place,
        "lead_source_id": str(lead.lead_source_id) if lead.lead_source_id else None,
        "lead_source_name": lead.source.name if lead.source else None,
        "lead_status_id": str(lead.lead_status_id),
        "lead_status_name": lead.lead_status.name if lead.lead_status else None,
        "lead_status_nature": lead.lead_status.nature if lead.lead_status else None,
        "assigned_to": str(lead.assigned_to) if lead.assigned_to else None,
        "assigned_to_name": lead.assignee.full_name if lead.assignee else None,
        "business_value": float(lead.business_value or 0),
        "lead_quality": lead.lead_quality,
        "next_followup_date": lead.next_followup_date.isoformat() + "Z" if lead.next_followup_date else None,
        "calendar_synced": lead.google_event_id is not None,
        "last_followup_date": lead.last_followup_date.isoformat() + "Z" if lead.last_followup_date else None,
        "won_at": lead.won_at.isoformat() + "Z" if lead.won_at else None,
        "lost_at": lead.lost_at.isoformat() + "Z" if lead.lost_at else None,
        "lost_reason": lead.lost_reason,
        "custom_fields": lead.custom_fields or {},
        "created_by": str(lead.created_by),
        "created_by_name": lead.creator.full_name if lead.creator else None,
        "created_at": lead.created_at.isoformat() + "Z" if lead.created_at else None,
        "updated_at": lead.updated_at.isoformat() + "Z" if lead.updated_at else None,
    }


def format_followup(followup: Followup) -> dict:
    return {
        "id": str(followup.id),
        "lead_id": str(followup.lead_id),
        "followup_date": followup.followup_date.isoformat() + "Z" if followup.followup_date else None,
        "note": followup.note,
        "status_at_time": followup.status_at_time,
        "created_by": str(followup.created_by),
        "created_by_name": followup.creator.full_name if followup.creator else None,
        "created_at": followup.created_at.isoformat() + "Z" if followup.created_at else None,
    }


def get_quotation_in_company(quotation_id: str, company_id, db: Session) -> Quotation:
    try:
        quotation_uuid = uuid.UUID(quotation_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found")

    quotation = (
        db.query(Quotation)
        .filter(Quotation.id == quotation_uuid, Quotation.company_id == company_id)
        .first()
    )
    if not quotation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quotation not found")
    return quotation


def _money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def compute_quotation_totals(items: list[dict], discount_type: str, discount_value) -> dict:
    """Server-side totals computation — the client only ever sends rate/qty/
    tax_percent per line, never a total. Returns per-item computed figures
    plus the quotation-level gross/tax/discount/payable breakdown.

    `items` is a list of dicts with keys: item_id, item_name, rate, qty,
    tax_percent, note.
    """
    computed_items = []
    gross_total = Decimal("0")
    tax_total = Decimal("0")

    for entry in items:
        rate = _money(entry["rate"])
        qty = Decimal(str(entry.get("qty", 1)))
        tax_percent = Decimal(str(entry.get("tax_percent", 0)))

        gross = _money(rate * qty)
        tax_amount = _money(gross * tax_percent / Decimal("100"))
        inc_tax = _money(gross + tax_amount)

        gross_total += gross
        tax_total += tax_amount

        computed_items.append({
            **entry,
            "rate": rate,
            "qty": qty,
            "tax_percent": tax_percent,
            "gross": gross,
            "inc_tax": inc_tax,
        })

    if discount_type == "flat":
        discount_amount = _money(discount_value)
    else:
        discount_amount = _money(gross_total * Decimal(str(discount_value)) / Decimal("100"))
    discount_amount = min(discount_amount, gross_total + tax_total)

    total_payable = _money(gross_total + tax_total - discount_amount)

    return {
        "items": computed_items,
        "gross_total": gross_total,
        "tax_total": tax_total,
        "discount_amount": discount_amount,
        "total_payable": total_payable,
    }


def format_quotation(quotation: Quotation) -> dict:
    return {
        "id": str(quotation.id),
        "number": quotation.number,
        "lead_id": str(quotation.lead_id),
        "lead_number": quotation.lead.number if quotation.lead else None,
        "lead_customer_name": quotation.lead.customer_name if quotation.lead else None,
        "sales_executive_id": str(quotation.sales_executive_id) if quotation.sales_executive_id else None,
        "sales_executive_name": quotation.sales_executive.full_name if quotation.sales_executive else None,
        "lead_source_id": str(quotation.lead_source_id) if quotation.lead_source_id else None,
        "lead_source_name": quotation.source.name if quotation.source else None,
        "currency": quotation.currency,
        "valid_upto": quotation.valid_upto.isoformat() if quotation.valid_upto else None,
        "next_followup_date": quotation.next_followup_date.isoformat() + "Z" if quotation.next_followup_date else None,
        "description": quotation.description,
        "terms_and_conditions": quotation.terms_and_conditions,
        "discount_type": quotation.discount_type,
        "discount_value": float(quotation.discount_value or 0),
        "gross_total": float(quotation.gross_total or 0),
        "tax_total": float(quotation.tax_total or 0),
        "total_payable": float(quotation.total_payable or 0),
        "custom_fields": quotation.custom_fields or {},
        "created_by": str(quotation.created_by),
        "created_by_name": quotation.creator.full_name if quotation.creator else None,
        "created_at": quotation.created_at.isoformat() + "Z" if quotation.created_at else None,
        "updated_at": quotation.updated_at.isoformat() + "Z" if quotation.updated_at else None,
        "items": [
            {
                "id": str(item.id),
                "item_id": str(item.item_id) if item.item_id else None,
                "item_name": item.item_name,
                "rate": float(item.rate or 0),
                "qty": float(item.qty or 0),
                "tax_percent": float(item.tax_percent or 0),
                "gross": float(item.gross or 0),
                "inc_tax": float(item.inc_tax or 0),
                "note": item.note,
            }
            for item in quotation.items
        ],
    }


def to_naive_utc(dt: datetime) -> datetime:
    """Followup dates arrive from the frontend as ISO strings ending in
    "Z", which Pydantic parses into timezone-aware datetimes. Leaving them
    aware breaks two things: format_utc_datetime() naively appends "Z" to
    isoformat(), producing an invalid "+00:00Z" string that Google's
    Calendar API rejects outright (silently, since the sync call swallows
    the failure) — and it's inconsistent with the naive-UTC values already
    stored everywhere else (e.g. the bucket comparisons in
    list_followups_by_bucket). Mirrors reminders.py's _to_naive_utc."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _build_followup_event_body(lead: Lead, latest_note: str | None) -> dict:
    # Defensive normalize — the caller (create_followup) already stores
    # next_followup_date as naive UTC, but this guards against a tz-aware
    # value slipping through and producing an invalid "+00:00Z" timestamp
    # that Google's Calendar API silently rejects.
    next_followup = to_naive_utc(lead.next_followup_date)
    start_iso = format_utc_datetime(next_followup)
    end_iso = format_utc_datetime(next_followup + timedelta(minutes=FOLLOWUP_EVENT_DURATION_MINUTES))
    description_lines = [f"Phone: {lead.phone}"]
    if lead.place:
        description_lines.append(f"Place: {lead.place}")
    if lead.lead_status:
        description_lines.append(f"Status: {lead.lead_status.name}")
    if latest_note:
        description_lines.append(f"Note: {latest_note}")

    return {
        "summary": f"Followup: {lead.customer_name} ({lead.number})",
        "description": "\n".join(description_lines),
        "start": {"dateTime": start_iso},
        "end": {"dateTime": end_iso},
        # Google's normal default reminder behavior, not a custom list —
        # this feature doesn't expose reminder-offset configuration.
        "reminders": {"useDefault": True},
    }


def sync_lead_calendar_event(db: Session, current_user: User, lead: Lead, latest_note: str | None = None) -> None:
    """Best-effort, non-blocking Google Calendar sync for a lead's
    next_followup_date, on whichever user is currently logging the
    followup. Never raises — a missing/expired/revoked Google connection
    just means calendar sync is skipped, the followup itself always saves.
    Mutates lead.google_event_id in place; caller is responsible for
    committing (this doesn't commit on its own, so it composes with
    create_followup's single transaction)."""
    # Local import avoids a routers.calendar <-> routers.crm_common import
    # cycle, since calendar.py doesn't need anything from here.
    from routers.calendar import get_valid_access_token
    from routers.reminders import _create_google_event, _delete_google_event, _update_google_event

    try:
        if not lead.next_followup_date:
            if lead.google_event_id:
                access_token = get_valid_access_token(current_user, db)
                if access_token:
                    _delete_google_event(access_token, lead.google_event_id)
                lead.google_event_id = None
            return

        access_token = get_valid_access_token(current_user, db)
        if not access_token:
            logger.info(
                f"CRM calendar sync skipped for lead {lead.id}: user {current_user.id} "
                "has no valid Google connection (not connected, or refresh failed)."
            )
            return

        event_body = _build_followup_event_body(lead, latest_note)
        if lead.google_event_id:
            synced = _update_google_event(access_token, lead.google_event_id, event_body)
            if not synced:
                # Event may have been deleted on Google's side externally —
                # fall through and create a fresh one instead of leaving the
                # lead permanently out of sync.
                lead.google_event_id = _create_google_event(access_token, event_body)
        else:
            lead.google_event_id = _create_google_event(access_token, event_body)

        if not lead.google_event_id:
            logger.error(
                f"CRM calendar sync failed for lead {lead.id}: Google Calendar API call "
                "did not return an event id (see the create/update error logged just above)."
            )
    except Exception as exc:  # never let calendar sync break followup creation
        logger.error(f"CRM calendar sync failed for lead {lead.id}: {exc}")


def assert_can_touch_lead(lead: Lead, current_user: User) -> None:
    """CRM currently has no admin<->staff scoping beyond the department gate
    (see auth.require_crm_access) — every Sales-department user and every
    super_admin can see and act on every lead in the company. This hook
    exists so that per-user lead scoping can be added later (e.g. "admin
    only sees their team's leads") without touching every call site."""
    return

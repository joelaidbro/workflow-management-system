"""Shared helpers for the CRM routers (crm_leads, crm_quotations, crm_bulk).

Kept separate from crm_settings.py because these are used across multiple
CRM routers and none of them own this logic more than another.
"""
import uuid
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import Followup, Lead, LeadSource, LeadStatus, Quotation, SequenceCounter, User

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


def assert_can_touch_lead(lead: Lead, current_user: User) -> None:
    """CRM currently has no admin<->staff scoping beyond the department gate
    (see auth.require_crm_access) — every Sales-department user and every
    super_admin can see and act on every lead in the company. This hook
    exists so that per-user lead scoping can be added later (e.g. "admin
    only sees their team's leads") without touching every call site."""
    return

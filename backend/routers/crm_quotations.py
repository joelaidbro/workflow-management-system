from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, require_crm_access
from database import get_db
from models import Item, LeadSource, Quotation, QuotationItem, User
from routers.crm_common import (
    compute_quotation_totals,
    format_quotation,
    get_lead_in_company,
    get_quotation_in_company,
    next_sequence_number,
)

router = APIRouter()

VALID_DISCOUNT_TYPES = {"percent", "flat"}


class QuotationItemBody(BaseModel):
    item_id: str | None = None
    item_name: str | None = None  # required if item_id is not given
    rate: float
    qty: float = 1
    tax_percent: float = 0
    note: str | None = None


class QuotationCreateBody(BaseModel):
    lead_id: str
    sales_executive_id: str | None = None
    lead_source_id: str | None = None
    currency: str = "INR"
    valid_upto: date | None = None
    next_followup_date: datetime | None = None
    description: str | None = None
    terms_and_conditions: str | None = None
    discount_type: str = "percent"
    discount_value: float = 0
    custom_fields: dict = {}
    items: list[QuotationItemBody]


class QuotationEditBody(BaseModel):
    sales_executive_id: str | None = None
    lead_source_id: str | None = None
    currency: str | None = None
    valid_upto: date | None = None
    next_followup_date: datetime | None = None
    description: str | None = None
    terms_and_conditions: str | None = None
    discount_type: str | None = None
    discount_value: float | None = None
    custom_fields: dict | None = None
    items: list[QuotationItemBody] | None = None


def _resolve_quotation_items(items_in: list[QuotationItemBody], company_id, db: Session) -> list[dict]:
    if not items_in:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one line item is required")

    resolved = []
    for entry in items_in:
        if entry.rate < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item rate can't be negative")
        if entry.qty <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item quantity must be positive")
        if entry.tax_percent < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item tax_percent can't be negative")

        item_id = None
        item_name = (entry.item_name or "").strip()
        if entry.item_id:
            item = (
                db.query(Item)
                .filter(Item.id == entry.item_id, Item.company_id == company_id)
                .first()
            )
            if not item:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid item")
            item_id = item.id
            item_name = item.name  # always snapshot the current item name

        if not item_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="item_name is required for a custom line item (no item_id)",
            )

        resolved.append({
            "item_id": item_id,
            "item_name": item_name,
            "rate": entry.rate,
            "qty": entry.qty,
            "tax_percent": entry.tax_percent,
            "note": entry.note,
        })

    return resolved


def _validate_discount(discount_type: str, discount_value: float):
    if discount_type not in VALID_DISCOUNT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"discount_type must be one of {sorted(VALID_DISCOUNT_TYPES)}")
    if discount_value < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="discount_value can't be negative")
    if discount_type == "percent" and discount_value > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Percent discount can't exceed 100")


@router.post("/crm/quotations")
def create_quotation(
    body: QuotationCreateBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_access(current_user)

    lead = get_lead_in_company(body.lead_id, current_user.company_id, db)
    _validate_discount(body.discount_type, body.discount_value)

    resolved_items = _resolve_quotation_items(body.items, current_user.company_id, db)
    totals = compute_quotation_totals(resolved_items, body.discount_type, body.discount_value)

    lead_source_id = None
    if body.lead_source_id:
        source = (
            db.query(LeadSource)
            .filter(LeadSource.id == body.lead_source_id, LeadSource.company_id == current_user.company_id)
            .first()
        )
        if not source:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid lead source")
        lead_source_id = source.id

    sales_executive_id = None
    if body.sales_executive_id:
        exec_user = (
            db.query(User)
            .filter(User.id == body.sales_executive_id, User.company_id == current_user.company_id)
            .first()
        )
        if not exec_user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sales executive")
        sales_executive_id = exec_user.id

    number = next_sequence_number(db, current_user.company_id, "quotation", "QUO")
    now = datetime.utcnow()

    quotation = Quotation(
        company_id=current_user.company_id,
        number=number,
        lead_id=lead.id,
        sales_executive_id=sales_executive_id,
        lead_source_id=lead_source_id,
        currency=body.currency or "INR",
        valid_upto=body.valid_upto,
        next_followup_date=body.next_followup_date,
        description=body.description,
        terms_and_conditions=body.terms_and_conditions,
        discount_type=body.discount_type,
        discount_value=body.discount_value,
        gross_total=totals["gross_total"],
        tax_total=totals["tax_total"],
        total_payable=totals["total_payable"],
        custom_fields=body.custom_fields or {},
        created_by=current_user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(quotation)
    db.flush()

    for item_data in totals["items"]:
        db.add(QuotationItem(
            quotation_id=quotation.id,
            item_id=item_data["item_id"],
            item_name=item_data["item_name"],
            rate=item_data["rate"],
            qty=item_data["qty"],
            tax_percent=item_data["tax_percent"],
            gross=item_data["gross"],
            inc_tax=item_data["inc_tax"],
            note=item_data.get("note"),
        ))

    db.commit()
    db.refresh(quotation)

    return {"message": "Quotation created", "quotation": format_quotation(quotation)}


@router.get("/crm/quotations")
def list_quotations(
    lead_id: str | None = None,
    page: int = 1,
    page_size: int = 25,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_access(current_user)
    page = max(1, page)
    page_size = min(100, max(1, page_size))

    query = db.query(Quotation).filter(Quotation.company_id == current_user.company_id)
    if lead_id:
        query = query.filter(Quotation.lead_id == lead_id)

    total = query.count()
    quotations = (
        query.order_by(Quotation.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "quotations": [format_quotation(q) for q in quotations],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/crm/quotations/{quotation_id}")
def get_quotation_detail(
    quotation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_access(current_user)
    quotation = get_quotation_in_company(quotation_id, current_user.company_id, db)
    return format_quotation(quotation)


@router.patch("/crm/quotations/{quotation_id}")
def edit_quotation(
    quotation_id: str,
    body: QuotationEditBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_access(current_user)
    quotation = get_quotation_in_company(quotation_id, current_user.company_id, db)

    if body.sales_executive_id is not None:
        if body.sales_executive_id == "":
            quotation.sales_executive_id = None
        else:
            exec_user = (
                db.query(User)
                .filter(User.id == body.sales_executive_id, User.company_id == current_user.company_id)
                .first()
            )
            if not exec_user:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sales executive")
            quotation.sales_executive_id = exec_user.id

    if body.lead_source_id is not None:
        if body.lead_source_id == "":
            quotation.lead_source_id = None
        else:
            source = (
                db.query(LeadSource)
                .filter(LeadSource.id == body.lead_source_id, LeadSource.company_id == current_user.company_id)
                .first()
            )
            if not source:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid lead source")
            quotation.lead_source_id = source.id

    if body.currency is not None:
        quotation.currency = body.currency
    if body.valid_upto is not None:
        quotation.valid_upto = body.valid_upto
    if body.next_followup_date is not None:
        quotation.next_followup_date = body.next_followup_date
    if body.description is not None:
        quotation.description = body.description
    if body.terms_and_conditions is not None:
        quotation.terms_and_conditions = body.terms_and_conditions
    if body.custom_fields is not None:
        quotation.custom_fields = body.custom_fields

    discount_type = body.discount_type if body.discount_type is not None else quotation.discount_type
    discount_value = body.discount_value if body.discount_value is not None else float(quotation.discount_value or 0)
    _validate_discount(discount_type, discount_value)
    quotation.discount_type = discount_type
    quotation.discount_value = discount_value

    if body.items is not None:
        resolved_items = _resolve_quotation_items(body.items, current_user.company_id, db)
        totals = compute_quotation_totals(resolved_items, discount_type, discount_value)

        for existing in list(quotation.items):
            db.delete(existing)
        db.flush()

        for item_data in totals["items"]:
            db.add(QuotationItem(
                quotation_id=quotation.id,
                item_id=item_data["item_id"],
                item_name=item_data["item_name"],
                rate=item_data["rate"],
                qty=item_data["qty"],
                tax_percent=item_data["tax_percent"],
                gross=item_data["gross"],
                inc_tax=item_data["inc_tax"],
                note=item_data.get("note"),
            ))
        quotation.gross_total = totals["gross_total"]
        quotation.tax_total = totals["tax_total"]
        quotation.total_payable = totals["total_payable"]
    else:
        # Discount may have changed even if line items didn't — recompute
        # totals from the existing items so gross/tax/payable stay correct.
        existing_items = [
            {
                "item_id": item.item_id,
                "item_name": item.item_name,
                "rate": float(item.rate or 0),
                "qty": float(item.qty or 0),
                "tax_percent": float(item.tax_percent or 0),
                "note": item.note,
            }
            for item in quotation.items
        ]
        totals = compute_quotation_totals(existing_items, discount_type, discount_value)
        quotation.gross_total = totals["gross_total"]
        quotation.tax_total = totals["tax_total"]
        quotation.total_payable = totals["total_payable"]

    quotation.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(quotation)

    return {"message": "Quotation updated", "quotation": format_quotation(quotation)}

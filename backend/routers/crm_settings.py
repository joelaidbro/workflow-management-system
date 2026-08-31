import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, require_crm_access, require_crm_manage
from database import get_db
from models import Item, ItemCategory, LeadSource, LeadStatus, User
from routers.crm_common import (
    ensure_default_lead_sources,
    ensure_default_lead_statuses,
    top_up_default_lead_sources,
    top_up_default_lead_statuses,
)

router = APIRouter()

VALID_NATURES = {"new", "in_progress", "won", "lost"}


class LeadSourceBody(BaseModel):
    name: str


class LeadStatusBody(BaseModel):
    name: str
    nature: str = "new"


class ItemCategoryBody(BaseModel):
    name: str


class ItemBody(BaseModel):
    name: str
    item_category_id: str | None = None
    default_rate: float | None = None


def format_lead_source(row: LeadSource) -> dict:
    return {"id": str(row.id), "name": row.name}


def format_lead_status(row: LeadStatus) -> dict:
    return {"id": str(row.id), "name": row.name, "nature": row.nature}


def format_item_category(row: ItemCategory) -> dict:
    return {"id": str(row.id), "name": row.name}


def format_item(row: Item) -> dict:
    return {
        "id": str(row.id),
        "name": row.name,
        "item_category_id": str(row.item_category_id) if row.item_category_id else None,
        "item_category_name": row.category.name if row.category else None,
        "default_rate": float(row.default_rate) if row.default_rate is not None else None,
    }


def get_in_company(model, row_id: str, company_id, db: Session):
    try:
        row_uuid = uuid.UUID(row_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    row = db.query(model).filter(model.id == row_uuid, model.company_id == company_id).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return row


@router.post("/crm/bootstrap-defaults")
def bootstrap_crm_defaults(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manual "Load Starter Defaults" button. Unlike the silent auto-seed on
    every GET /crm/lead-statuses and /crm/lead-sources call (which only
    fires when a table is completely empty, so it never resurrects a
    deliberate full wipe), this checks each default item individually by
    name and adds only the ones missing — so it reliably tops up standard
    statuses/sources even for a company that already added some of its own,
    instead of silently no-op'ing the moment any row exists."""
    require_crm_manage(current_user)
    added_statuses = top_up_default_lead_statuses(db, current_user.company_id)
    added_sources = top_up_default_lead_sources(db, current_user.company_id)
    return {
        "message": (
            f"Added {added_statuses} lead status(es) and {added_sources} lead source(s)"
            if (added_statuses or added_sources)
            else "All starter defaults were already present — nothing new to add"
        ),
        "added_statuses": added_statuses,
        "added_sources": added_sources,
        "lead_statuses": [
            format_lead_status(r)
            for r in db.query(LeadStatus).filter(LeadStatus.company_id == current_user.company_id).order_by(LeadStatus.name.asc()).all()
        ],
        "lead_sources": [
            format_lead_source(r)
            for r in db.query(LeadSource).filter(LeadSource.company_id == current_user.company_id).order_by(LeadSource.name.asc()).all()
        ],
    }


# ---- Lead Sources ----

@router.get("/crm/lead-sources")
def list_lead_sources(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_crm_access(current_user)
    ensure_default_lead_sources(db, current_user.company_id)
    rows = (
        db.query(LeadSource)
        .filter(LeadSource.company_id == current_user.company_id)
        .order_by(LeadSource.name.asc())
        .all()
    )
    return [format_lead_source(r) for r in rows]


@router.post("/crm/lead-sources")
def create_lead_source(
    body: LeadSourceBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_manage(current_user)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")

    row = LeadSource(company_id=current_user.company_id, name=name, created_at=datetime.utcnow())
    db.add(row)
    db.commit()
    db.refresh(row)
    return format_lead_source(row)


@router.delete("/crm/lead-sources/{source_id}")
def delete_lead_source(
    source_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_manage(current_user)
    row = get_in_company(LeadSource, source_id, current_user.company_id, db)
    db.delete(row)
    db.commit()
    return {"message": "Lead source removed"}


# ---- Lead Statuses ----

@router.get("/crm/lead-statuses")
def list_lead_statuses(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_crm_access(current_user)
    ensure_default_lead_statuses(db, current_user.company_id)
    rows = (
        db.query(LeadStatus)
        .filter(LeadStatus.company_id == current_user.company_id)
        .order_by(LeadStatus.name.asc())
        .all()
    )
    return [format_lead_status(r) for r in rows]


@router.post("/crm/lead-statuses")
def create_lead_status(
    body: LeadStatusBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_manage(current_user)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")
    if body.nature not in VALID_NATURES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"nature must be one of {sorted(VALID_NATURES)}",
        )

    row = LeadStatus(
        company_id=current_user.company_id,
        name=name,
        nature=body.nature,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return format_lead_status(row)


@router.delete("/crm/lead-statuses/{status_id}")
def delete_lead_status(
    status_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_manage(current_user)
    row = get_in_company(LeadStatus, status_id, current_user.company_id, db)

    from models import Lead
    in_use = db.query(Lead).filter(Lead.lead_status_id == row.id).first()
    if in_use:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This status is in use by existing leads and can't be removed",
        )

    db.delete(row)
    db.commit()
    return {"message": "Lead status removed"}


# ---- Item Categories ----

@router.get("/crm/item-categories")
def list_item_categories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_crm_access(current_user)
    rows = (
        db.query(ItemCategory)
        .filter(ItemCategory.company_id == current_user.company_id)
        .order_by(ItemCategory.name.asc())
        .all()
    )
    return [format_item_category(r) for r in rows]


@router.post("/crm/item-categories")
def create_item_category(
    body: ItemCategoryBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_manage(current_user)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")

    row = ItemCategory(company_id=current_user.company_id, name=name, created_at=datetime.utcnow())
    db.add(row)
    db.commit()
    db.refresh(row)
    return format_item_category(row)


@router.delete("/crm/item-categories/{category_id}")
def delete_item_category(
    category_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_manage(current_user)
    row = get_in_company(ItemCategory, category_id, current_user.company_id, db)
    db.delete(row)
    db.commit()
    return {"message": "Item category removed"}


# ---- Items ----

@router.get("/crm/items")
def list_items(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_crm_access(current_user)
    rows = (
        db.query(Item)
        .filter(Item.company_id == current_user.company_id)
        .order_by(Item.name.asc())
        .all()
    )
    return [format_item(r) for r in rows]


@router.post("/crm/items")
def create_item(
    body: ItemBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_manage(current_user)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name is required")
    if body.default_rate is not None and body.default_rate < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="default_rate can't be negative")

    category_id = None
    if body.item_category_id:
        category = get_in_company(ItemCategory, body.item_category_id, current_user.company_id, db)
        category_id = category.id

    row = Item(
        company_id=current_user.company_id,
        item_category_id=category_id,
        name=name,
        default_rate=body.default_rate,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return format_item(row)


@router.delete("/crm/items/{item_id}")
def delete_item(
    item_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_manage(current_user)
    row = get_in_company(Item, item_id, current_user.company_id, db)
    db.delete(row)
    db.commit()
    return {"message": "Item removed"}

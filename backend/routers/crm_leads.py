from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth import get_current_user, require_crm_access
from database import get_db
from models import Followup, Lead, LeadSource, LeadStatus, User
from routers.crm_common import (
    assert_can_touch_lead,
    format_followup,
    format_lead,
    get_default_new_status,
    get_lead_in_company,
    next_sequence_number,
)

router = APIRouter()

VALID_STAGES = {"new", "in_progress", "won", "lost"}
VALID_BUCKETS = {"today", "delayed", "upcoming", "none"}


class EnquiryCreateBody(BaseModel):
    customer_name: str
    phone: str
    place: str | None = None
    lead_source_id: str | None = None
    assigned_to: str | None = None
    business_value: float = 0
    lead_quality: str | None = None
    next_followup_date: datetime | None = None
    custom_fields: dict = {}


class LeadEditBody(BaseModel):
    customer_name: str | None = None
    phone: str | None = None
    place: str | None = None
    lead_source_id: str | None = None
    assigned_to: str | None = None
    business_value: float | None = None
    lead_quality: str | None = None
    custom_fields: dict | None = None


class LeadStatusChangeBody(BaseModel):
    lead_status_id: str
    lost_reason: str | None = None


class FollowupCreateBody(BaseModel):
    note: str | None = None
    followup_date: datetime | None = None
    next_followup_date: datetime | None = None


def _resolve_lead_source(source_id: str | None, company_id, db: Session):
    if not source_id:
        return None
    source = (
        db.query(LeadSource)
        .filter(LeadSource.id == source_id, LeadSource.company_id == company_id)
        .first()
    )
    if not source:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid lead source")
    return source.id


def _resolve_assignee(user_id: str | None, company_id, db: Session):
    if not user_id:
        return None
    user = (
        db.query(User)
        .filter(User.id == user_id, User.company_id == company_id, User.is_active.is_(True))
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assignee")
    return user.id


@router.post("/crm/enquiries")
def create_enquiry(
    body: EnquiryCreateBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_access(current_user)

    customer_name = body.customer_name.strip()
    phone = body.phone.strip()
    if not customer_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Customer name is required")
    if not phone:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phone is required")
    if body.lead_quality and body.lead_quality not in {"cold", "warm", "hot"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="lead_quality must be cold, warm, or hot")
    if body.business_value < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="business_value can't be negative")

    new_status = get_default_new_status(current_user.company_id, db)
    lead_source_id = _resolve_lead_source(body.lead_source_id, current_user.company_id, db)
    assignee_id = _resolve_assignee(body.assigned_to, current_user.company_id, db)

    number = next_sequence_number(db, current_user.company_id, "enquiry", "ENQ")
    now = datetime.utcnow()

    lead = Lead(
        company_id=current_user.company_id,
        number=number,
        customer_name=customer_name,
        phone=phone,
        place=body.place,
        lead_source_id=lead_source_id,
        lead_status_id=new_status.id,
        assigned_to=assignee_id,
        business_value=body.business_value,
        lead_quality=body.lead_quality,
        next_followup_date=body.next_followup_date,
        custom_fields=body.custom_fields or {},
        created_by=current_user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)

    return {"message": "Enquiry created", "lead": format_lead(lead)}


@router.get("/crm/leads")
def list_leads(
    stage: str | None = None,
    assigned_to: str | None = None,
    search: str | None = None,
    page: int = 1,
    page_size: int = 25,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_access(current_user)

    if stage and stage not in VALID_STAGES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"stage must be one of {sorted(VALID_STAGES)}")
    page = max(1, page)
    page_size = min(100, max(1, page_size))

    query = (
        db.query(Lead)
        .join(LeadStatus, Lead.lead_status_id == LeadStatus.id)
        .filter(Lead.company_id == current_user.company_id)
    )

    if stage:
        query = query.filter(LeadStatus.nature == stage)
    if assigned_to:
        query = query.filter(Lead.assigned_to == assigned_to)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(
            or_(Lead.customer_name.ilike(like), Lead.phone.ilike(like), Lead.number.ilike(like))
        )

    total = query.count()
    leads = (
        query.order_by(Lead.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "leads": [format_lead(lead) for lead in leads],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/crm/leads/{lead_id}")
def get_lead_detail(
    lead_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_access(current_user)
    lead = get_lead_in_company(lead_id, current_user.company_id, db)
    assert_can_touch_lead(lead, current_user)

    return {
        **format_lead(lead),
        "followups": [format_followup(f) for f in lead.followups],
    }


@router.patch("/crm/leads/{lead_id}")
def edit_lead(
    lead_id: str,
    body: LeadEditBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_access(current_user)
    lead = get_lead_in_company(lead_id, current_user.company_id, db)
    assert_can_touch_lead(lead, current_user)

    if body.customer_name is not None:
        name = body.customer_name.strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Customer name cannot be empty")
        lead.customer_name = name

    if body.phone is not None:
        phone = body.phone.strip()
        if not phone:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Phone cannot be empty")
        lead.phone = phone

    if body.place is not None:
        lead.place = body.place

    if body.lead_source_id is not None:
        lead.lead_source_id = _resolve_lead_source(body.lead_source_id, current_user.company_id, db)

    if body.assigned_to is not None:
        lead.assigned_to = _resolve_assignee(body.assigned_to, current_user.company_id, db)

    if body.business_value is not None:
        if body.business_value < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="business_value can't be negative")
        lead.business_value = body.business_value

    if body.lead_quality is not None:
        if body.lead_quality not in {"cold", "warm", "hot", ""}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="lead_quality must be cold, warm, or hot")
        lead.lead_quality = body.lead_quality or None

    if body.custom_fields is not None:
        lead.custom_fields = body.custom_fields

    lead.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(lead)

    return {"message": "Lead updated", "lead": format_lead(lead)}


@router.post("/crm/leads/{lead_id}/status")
def change_lead_status(
    lead_id: str,
    body: LeadStatusChangeBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_access(current_user)
    lead = get_lead_in_company(lead_id, current_user.company_id, db)
    assert_can_touch_lead(lead, current_user)

    new_status = (
        db.query(LeadStatus)
        .filter(LeadStatus.id == body.lead_status_id, LeadStatus.company_id == current_user.company_id)
        .first()
    )
    if not new_status:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid lead status")

    now = datetime.utcnow()
    lead.lead_status_id = new_status.id
    if new_status.nature == "won":
        lead.won_at = now
        lead.lost_at = None
        lead.lost_reason = None
    elif new_status.nature == "lost":
        lead.lost_at = now
        lead.lost_reason = body.lost_reason
        lead.won_at = None
    else:
        lead.won_at = None
        lead.lost_at = None
        lead.lost_reason = None

    lead.updated_at = now
    db.commit()
    db.refresh(lead)

    return {"message": "Lead status updated", "lead": format_lead(lead)}


@router.post("/crm/leads/{lead_id}/followups")
def create_followup(
    lead_id: str,
    body: FollowupCreateBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_access(current_user)
    lead = get_lead_in_company(lead_id, current_user.company_id, db)
    assert_can_touch_lead(lead, current_user)

    now = datetime.utcnow()
    followup_date = body.followup_date or now

    followup = Followup(
        company_id=current_user.company_id,
        lead_id=lead.id,
        followup_date=followup_date,
        note=body.note,
        status_at_time=lead.lead_status.name if lead.lead_status else None,
        created_by=current_user.id,
        created_at=now,
    )
    db.add(followup)

    lead.last_followup_date = followup_date
    lead.next_followup_date = body.next_followup_date
    lead.updated_at = now

    db.commit()
    db.refresh(followup)
    db.refresh(lead)

    return {"message": "Followup logged", "followup": format_followup(followup), "lead": format_lead(lead)}


@router.get("/crm/followups")
def list_followups_by_bucket(
    bucket: str,
    assigned_to: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_access(current_user)

    if bucket not in VALID_BUCKETS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"bucket must be one of {sorted(VALID_BUCKETS)}")

    query = db.query(Lead).filter(Lead.company_id == current_user.company_id)
    if assigned_to:
        query = query.filter(Lead.assigned_to == assigned_to)

    now = datetime.utcnow()
    today_start = datetime(now.year, now.month, now.day)
    today_end = today_start + timedelta(days=1)

    if bucket == "none":
        query = query.filter(Lead.next_followup_date.is_(None))
    elif bucket == "delayed":
        query = query.filter(Lead.next_followup_date.isnot(None), Lead.next_followup_date < today_start)
    elif bucket == "today":
        query = query.filter(Lead.next_followup_date >= today_start, Lead.next_followup_date < today_end)
    elif bucket == "upcoming":
        query = query.filter(Lead.next_followup_date >= today_end)

    leads = query.order_by(Lead.next_followup_date.asc().nullslast()).all()
    return {"bucket": bucket, "leads": [format_lead(lead) for lead in leads]}

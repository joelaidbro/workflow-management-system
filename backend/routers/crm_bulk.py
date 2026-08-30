from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user, require_crm_manage
from database import get_db
from models import Followup, User
from routers.crm_common import build_lead_filter_query, format_lead

router = APIRouter()


class LeadFilterBody(BaseModel):
    stage: str | None = None
    lead_source_id: str | None = None
    lead_status_id: str | None = None
    assigned_to: str | None = None
    lead_quality: str | None = None
    created_from: date | None = None
    created_to: date | None = None


class BulkAssignBody(LeadFilterBody):
    target_user_id: str


class BulkTransferBody(LeadFilterBody):
    target_user_id: str


def _resolve_target_user(target_user_id: str, company_id, db: Session) -> User:
    target = (
        db.query(User)
        .filter(User.id == target_user_id, User.company_id == company_id, User.is_active.is_(True))
        .first()
    )
    if not target:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid target user")
    return target


@router.post("/crm/leads/preview-filter")
def preview_lead_filter(
    body: LeadFilterBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lets the Task Assignment / Lead Transfer screens show the matching
    leads before committing to a bulk action."""
    require_crm_manage(current_user)
    query = build_lead_filter_query(db, current_user.company_id, body.model_dump())
    leads = query.all()
    return {"count": len(leads), "leads": [format_lead(lead) for lead in leads]}


@router.post("/crm/leads/bulk-assign")
def bulk_assign_leads(
    body: BulkAssignBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_crm_manage(current_user)
    target = _resolve_target_user(body.target_user_id, current_user.company_id, db)

    filters = body.model_dump(exclude={"target_user_id"})
    leads = build_lead_filter_query(db, current_user.company_id, filters).all()

    now = datetime.utcnow()
    for lead in leads:
        lead.assigned_to = target.id
        lead.updated_at = now

    db.commit()
    return {"message": f"{len(leads)} lead(s) assigned to {target.full_name}", "count": len(leads)}


@router.post("/crm/leads/bulk-transfer")
def bulk_transfer_leads(
    body: BulkTransferBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Same shape as bulk-assign, but meant for ownership changes (rep
    leaving, territory reshuffle) rather than routine task handout — so each
    affected lead gets a Followup note logging the transfer for a paper
    trail, which bulk-assign deliberately doesn't add."""
    require_crm_manage(current_user)
    target = _resolve_target_user(body.target_user_id, current_user.company_id, db)

    filters = body.model_dump(exclude={"target_user_id"})
    leads = build_lead_filter_query(db, current_user.company_id, filters).all()

    now = datetime.utcnow()
    for lead in leads:
        previous_owner = lead.assignee.full_name if lead.assignee else "Unassigned"
        lead.assigned_to = target.id
        lead.updated_at = now
        db.add(Followup(
            company_id=current_user.company_id,
            lead_id=lead.id,
            followup_date=now,
            note=f"Lead transferred from {previous_owner} to {target.full_name}",
            status_at_time=lead.lead_status.name if lead.lead_status else None,
            created_by=current_user.id,
            created_at=now,
        ))

    db.commit()
    return {"message": f"{len(leads)} lead(s) transferred to {target.full_name}", "count": len(leads)}

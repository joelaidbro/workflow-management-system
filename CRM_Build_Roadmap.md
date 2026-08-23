# CRM Feature — Build Roadmap for Workflow Management Software (FastAPI + PostgreSQL)

This is written to be handed to an AI coding agent as a task brief. It follows the conventions already
present in `Workflow Management Software/backend`: single `models.py` (SQLAlchemy, UUID primary keys,
every business table has `company_id` for multi-tenancy), a flat `routers/` folder with one file per
feature and Pydantic request/response models declared inline at the top of each router, `auth.py` for
`get_current_user` / `require_admin` / role checks, `team_scope.py` for admin↔staff row scoping,
Alembic migrations under `alembic/versions/`, and routers wired up in `main.py`.

## What this feature actually is

A CRM pipeline for turning a raw contact into a paying customer, in four stages:

1. **Enquiry** — someone expresses interest. You capture their contact info + qualifying details.
2. **Lead** — every enquiry becomes a Lead record with a status. It sits in New → In Follow Up until
   it's marked Won or Lost.
3. **Followup** — a log of every time someone contacts the lead, plus a "next followup date" so the
   system can remind reps what's overdue, due today, or upcoming.
4. **Quotation** — a priced document (line items + tax + discount + total) tied to a lead, sent to
   try to close the deal.

Around that core, there are supporting admin/master tables (Lead Source, Lead Status, Items, Item
Categories) that populate dropdowns, and two "bulk operate on many leads at once" tools (Task
Assignment, Lead Transfer) that filter leads and act on the filtered set.

Everything is scoped by `company_id` like the rest of this codebase — a CRM lead belongs to a company,
same as Users, Tasks, etc.

## Data model — new tables to add to `models.py`

Follow the exact style already used for `Task`/`User` (UUID pk default `uuid.uuid4`, `company_id`
FK + index, `created_at`/`updated_at` timestamps).

```
LeadSource       id, company_id, name, created_at
LeadStatus       id, company_id, name, nature (enum/string: "new" | "in_progress" | "won" | "lost"), created_at
ItemCategory     id, company_id, name, created_at
Item             id, company_id, item_category_id (nullable FK), name, default_rate (Numeric, nullable), created_at

Lead             id, company_id, number (string, e.g. "ENQ-0001", unique per company)
                 customer_name, phone, place
                 lead_source_id (FK), lead_status_id (FK)
                 assigned_to (FK -> users.id, nullable)
                 business_value (Numeric, default 0)
                 lead_quality (string: "cold"|"warm"|"hot", nullable)
                 next_followup_date (DateTime, nullable)
                 last_followup_date (DateTime, nullable)
                 won_at (DateTime, nullable), lost_at (DateTime, nullable), lost_reason (Text, nullable)
                 custom_fields (JSON, default dict)   -- see note below
                 created_by (FK -> users.id), created_at, updated_at

Followup         id, company_id, lead_id (FK), followup_date (DateTime)
                 note (Text, nullable), status_at_time (string, nullable)
                 created_by (FK -> users.id), created_at

Quotation        id, company_id, number (string, e.g. "QUO-0001", unique per company)
                 lead_id (FK), sales_executive_id (FK -> users.id, nullable)
                 lead_source_id (FK, nullable), currency (string, default "INR")
                 valid_upto (Date, nullable), next_followup_date (DateTime, nullable)
                 description (Text, nullable), terms_and_conditions (Text, nullable)
                 discount_type (string: "percent"|"flat"), discount_value (Numeric, default 0)
                 gross_total, tax_total, total_payable (Numeric)
                 custom_fields (JSON, default dict)
                 created_by (FK -> users.id), created_at, updated_at

QuotationItem    id, quotation_id (FK), item_id (FK, nullable), item_name (string, snapshot)
                 rate (Numeric), qty (Numeric), tax_percent (Numeric, default 0)
                 gross (Numeric), inc_tax (Numeric), note (Text, nullable)
```

**Note on the "candidate attribute block"** (age, qualification, salary, CV, job role, skill, etc.
from the reference video): don't hardcode 15+ nullable columns onto `Lead`/`Quotation`. Use the
`custom_fields JSON` column instead and define which keys are visible per company (or just per
install, hardcoded in frontend) since the exact fields are vertical-specific (recruitment vs. generic
sales vs. education). This keeps the schema clean and matches how a lot of these ERP demo videos
actually implement it under the hood. If you already know this will only ever be one vertical, it's
fine to add the columns directly to `Lead`/`Quotation` instead — simpler, just less flexible.

File uploads (CV, screenshot): store as file paths/URLs (string columns inside `custom_fields` or
dedicated `cv_path`, `screenshot_path` columns), reuse whatever upload pattern `routers/screenshots.py`
already uses in this repo.

## Migration

One Alembic revision (or a small chain) adding all the tables above, following the naming pattern
already used in `alembic/versions/` (short hash id + `_add_<thing>.py`). Add FK indexes on every
`company_id` and `lead_id` column — this codebase already does that for hot lookup columns (see
`Index` usage in `models.py`).

## Routers to add (`routers/crm_*.py`), registered in `main.py`

Mirror `routers/tasks.py`: pydantic `*Body` classes at the top, a `format_x()` serializer function,
`get_x_in_company()` lookup helper, `Depends(get_current_user)` on every route, `require_admin`
where an action should be admin-only (e.g. deleting master data).

- `routers/crm_settings.py` — CRUD for LeadSource, LeadStatus, Item, ItemCategory. Straightforward,
  build this first since everything else depends on these dropdowns having data.
- `routers/crm_leads.py`
  - `POST /crm/enquiries` — create Lead (status defaults to the LeadStatus with nature="new")
  - `GET /crm/leads?stage=new|in_progress|won|lost` — tab-filtered list, paginated
  - `GET /crm/leads/{id}` — detail
  - `PATCH /crm/leads/{id}` — edit fields
  - `POST /crm/leads/{id}/status` — move stage (sets `won_at`/`lost_at`/`lost_reason` as needed)
  - `POST /crm/leads/{id}/followups` — log a followup (updates `last_followup_date`, sets new
    `next_followup_date`)
  - `GET /crm/followups?bucket=today|delayed|upcoming|none` — the Followups page query, bucketed off
    `next_followup_date` vs `datetime.utcnow()`
- `routers/crm_quotations.py`
  - `POST /crm/quotations` — create with nested line items, auto-number `QUO-xxx`, server-computes
    gross/tax/discount/total (don't trust client-sent totals)
  - `GET /crm/quotations`, `GET /crm/quotations/{id}`, `PATCH /crm/quotations/{id}`
- `routers/crm_bulk.py`
  - `POST /crm/leads/bulk-assign` — body: filter criteria + target user id → updates `assigned_to`
    on all matching leads
  - `POST /crm/leads/bulk-transfer` — body: filter criteria + target (branch/user) → same shape,
    different target field
  - Build the filter as a single reusable query-builder function (dict of optional filters → SQLAlchemy
    filters chained conditionally) since Task Assignment and Lead Transfer use almost the same filter set.

## Auto-numbering (`ENQ-xxx` / `QUO-xxx`)

Simplest reliable approach with Postgres: a small `SequenceCounter` table (`company_id`, `key`
e.g. "enquiry"/"quotation", `next_value`) updated inside the same transaction with `SELECT ... FOR
UPDATE` to avoid race conditions under concurrent requests. Avoids relying on Python-side `count()+1`,
which breaks under concurrency and after deletions.

## Scoping / permissions

Reuse `team_scope.py`'s pattern: if you want admins to only see leads assigned to their staff (same
as tasks), call `scope_staff_query` the same way `routers/tasks.py` likely already does for the
`assigned_to` filter. If CRM leads should be visible company-wide regardless of role, skip scoping
and just filter by `company_id`.

## Build order (give this to the AI agent as sequential steps)

1. Add the 8 tables to `models.py`, plus relationships back to `Company`/`User` where useful.
2. Generate + review an Alembic migration; run it against a dev DB.
3. Build `routers/crm_settings.py` (LeadSource, LeadStatus, Item, ItemCategory CRUD) and register in `main.py`.
4. Build `routers/crm_leads.py`: enquiry creation → lead list/detail → status transitions → followups → followups-bucket endpoint.
5. Build `routers/crm_quotations.py`: create/list/detail/edit with server-side totals calculation.
6. Add the `SequenceCounter` table + helper function, wire it into both enquiry and quotation creation.
7. Build `routers/crm_bulk.py` with the shared filter-builder, then the assign and transfer endpoints.
8. Wire all new routers into `main.py` alongside the existing router imports.
9. Connect existing frontend pages (Followups, Create Enquiry, Create Quotation, Leads, Lead Task
   Assignment, Lead Transfer, Settings screens) to these endpoints — no backend logic left to guess
   here since the endpoints above map 1:1 to those pages.
10. Only after the above works: consider Facebook Lead Ads webhook ingestion as a separate, later task
    — it just needs an endpoint that creates Leads with `lead_source` = "Facebook" and stores
    campaign/ad/form/page names in `custom_fields`.

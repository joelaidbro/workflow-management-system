"""add_crm_tables

Revision ID: q7e8f9a0b1c2
Revises: p6d7e8f9a0b1
Create Date: 2026-08-24

CRM feature for sales-department staff: enquiry -> lead -> followup ->
quotation pipeline. Adds 9 tables:
  - lead_sources, lead_statuses, item_categories, items — company-scoped
    master/dropdown data
  - leads, followups, quotations, quotation_items — the core pipeline
  - sequence_counters — concurrency-safe ENQ-xxx / QUO-xxx auto-numbering

Extra lead/quotation attributes (candidate age, CV, budget, etc.) live in
each table's custom_fields JSON column rather than as fixed columns, since
the exact field set is sales-team-specific and expected to change without a
migration each time.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "q7e8f9a0b1c2"
down_revision: Union[str, None] = "p6d7e8f9a0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "lead_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lead_sources_company_id", "lead_sources", ["company_id"])

    op.create_table(
        "lead_statuses",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("nature", sa.String(20), nullable=False, server_default="new"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lead_statuses_company_id", "lead_statuses", ["company_id"])

    op.create_table(
        "item_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_item_categories_company_id", "item_categories", ["company_id"])

    op.create_table(
        "items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("default_rate", sa.Numeric(10, 2), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["item_category_id"], ["item_categories.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_items_company_id", "items", ["company_id"])

    op.create_table(
        "leads",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("number", sa.String(30), nullable=False),
        sa.Column("customer_name", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("place", sa.String(255), nullable=True),
        sa.Column("lead_source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lead_status_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("assigned_to", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("business_value", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("lead_quality", sa.String(10), nullable=True),
        sa.Column("next_followup_date", sa.DateTime(), nullable=True),
        sa.Column("last_followup_date", sa.DateTime(), nullable=True),
        sa.Column("won_at", sa.DateTime(), nullable=True),
        sa.Column("lost_at", sa.DateTime(), nullable=True),
        sa.Column("lost_reason", sa.Text(), nullable=True),
        sa.Column("custom_fields", postgresql.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["lead_source_id"], ["lead_sources.id"]),
        sa.ForeignKeyConstraint(["lead_status_id"], ["lead_statuses.id"]),
        sa.ForeignKeyConstraint(["assigned_to"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "number", name="uq_leads_company_number"),
    )
    op.create_index("ix_leads_company_id", "leads", ["company_id"])
    op.create_index("ix_leads_company_id_lead_status_id", "leads", ["company_id", "lead_status_id"])
    op.create_index("ix_leads_assigned_to", "leads", ["assigned_to"])
    op.create_index("ix_leads_next_followup_date", "leads", ["next_followup_date"])

    op.create_table(
        "followups",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("followup_date", sa.DateTime(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status_at_time", sa.String(100), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_followups_company_id", "followups", ["company_id"])
    op.create_index("ix_followups_lead_id", "followups", ["lead_id"])

    op.create_table(
        "quotations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("number", sa.String(30), nullable=False),
        sa.Column("lead_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sales_executive_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("lead_source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
        sa.Column("valid_upto", sa.Date(), nullable=True),
        sa.Column("next_followup_date", sa.DateTime(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("terms_and_conditions", sa.Text(), nullable=True),
        sa.Column("discount_type", sa.String(10), nullable=False, server_default="percent"),
        sa.Column("discount_value", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("gross_total", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tax_total", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_payable", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("custom_fields", postgresql.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"]),
        sa.ForeignKeyConstraint(["sales_executive_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["lead_source_id"], ["lead_sources.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "number", name="uq_quotations_company_number"),
    )
    op.create_index("ix_quotations_company_id", "quotations", ["company_id"])
    op.create_index("ix_quotations_lead_id", "quotations", ["lead_id"])

    op.create_table(
        "quotation_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quotation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("item_name", sa.String(255), nullable=False),
        sa.Column("rate", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("qty", sa.Numeric(12, 2), nullable=False, server_default="1"),
        sa.Column("tax_percent", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("gross", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("inc_tax", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["quotation_id"], ["quotations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_quotation_items_quotation_id", "quotation_items", ["quotation_id"])

    op.create_table(
        "sequence_counters",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.String(30), nullable=False),
        sa.Column("next_value", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "key", name="uq_sequence_counters_company_key"),
    )


def downgrade() -> None:
    op.drop_table("sequence_counters")
    op.drop_index("ix_quotation_items_quotation_id", table_name="quotation_items")
    op.drop_table("quotation_items")
    op.drop_index("ix_quotations_lead_id", table_name="quotations")
    op.drop_index("ix_quotations_company_id", table_name="quotations")
    op.drop_table("quotations")
    op.drop_index("ix_followups_lead_id", table_name="followups")
    op.drop_index("ix_followups_company_id", table_name="followups")
    op.drop_table("followups")
    op.drop_index("ix_leads_next_followup_date", table_name="leads")
    op.drop_index("ix_leads_assigned_to", table_name="leads")
    op.drop_index("ix_leads_company_id_lead_status_id", table_name="leads")
    op.drop_index("ix_leads_company_id", table_name="leads")
    op.drop_table("leads")
    op.drop_index("ix_items_company_id", table_name="items")
    op.drop_table("items")
    op.drop_index("ix_item_categories_company_id", table_name="item_categories")
    op.drop_table("item_categories")
    op.drop_index("ix_lead_statuses_company_id", table_name="lead_statuses")
    op.drop_table("lead_statuses")
    op.drop_index("ix_lead_sources_company_id", table_name="lead_sources")
    op.drop_table("lead_sources")

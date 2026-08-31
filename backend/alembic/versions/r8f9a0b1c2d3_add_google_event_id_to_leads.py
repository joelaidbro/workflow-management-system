"""add_google_event_id_to_leads

Revision ID: r8f9a0b1c2d3
Revises: q7e8f9a0b1c2
Create Date: 2026-08-31

Adds leads.google_event_id so a lead's next_followup_date can be kept in
sync with a Google Calendar event (created/moved/deleted) on whichever
user's calendar last logged a followup on that lead.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "r8f9a0b1c2d3"
down_revision: Union[str, None] = "q7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("leads", sa.Column("google_event_id", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("leads", "google_event_id")

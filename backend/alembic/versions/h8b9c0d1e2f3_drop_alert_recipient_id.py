"""drop_alert_recipient_id

Revision ID: h8b9c0d1e2f3
Revises: g7a8b9c0d1e2
Create Date: 2026-07-14

alerts.recipient_id was written on INSERT but never read for business logic.
All recipient tracking goes through the alert_recipients join table.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'h8b9c0d1e2f3'
down_revision: Union[str, None] = 'g7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('alerts', 'recipient_id')


def downgrade() -> None:
    op.add_column(
        'alerts',
        sa.Column('recipient_id', postgresql.UUID(as_uuid=True), nullable=True),
    )

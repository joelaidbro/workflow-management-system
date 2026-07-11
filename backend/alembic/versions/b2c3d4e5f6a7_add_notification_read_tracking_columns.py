"""add notification read tracking columns

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-11 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "daily_reports",
        sa.Column("is_read_by_staff", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "leave_requests",
        sa.Column("is_read_by_staff", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "alert_recipients",
        sa.Column("reply_read_by_admin", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("alert_recipients", "reply_read_by_admin")
    op.drop_column("leave_requests", "is_read_by_staff")
    op.drop_column("daily_reports", "is_read_by_staff")

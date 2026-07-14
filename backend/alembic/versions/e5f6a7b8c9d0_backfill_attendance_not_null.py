"""backfill_attendance_not_null

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-14

Backfill NULL values in attendance minute columns to 0, then enforce
NOT NULL so arithmetic on these columns can never silently return NULL.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE attendance SET working_minutes  = 0 WHERE working_minutes  IS NULL")
    op.execute("UPDATE attendance SET break_minutes    = 0 WHERE break_minutes    IS NULL")
    op.execute("UPDATE attendance SET meeting_minutes  = 0 WHERE meeting_minutes  IS NULL")
    op.execute("UPDATE attendance SET idle_minutes     = 0 WHERE idle_minutes     IS NULL")
    op.execute("UPDATE attendance SET offline_minutes  = 0 WHERE offline_minutes  IS NULL")

    op.alter_column('attendance', 'working_minutes',  nullable=False)
    op.alter_column('attendance', 'break_minutes',    nullable=False)
    op.alter_column('attendance', 'meeting_minutes',  nullable=False)
    op.alter_column('attendance', 'idle_minutes',     nullable=False)
    op.alter_column('attendance', 'offline_minutes',  nullable=False)


def downgrade() -> None:
    op.alter_column('attendance', 'offline_minutes',  nullable=True)
    op.alter_column('attendance', 'idle_minutes',     nullable=True)
    op.alter_column('attendance', 'meeting_minutes',  nullable=True)
    op.alter_column('attendance', 'break_minutes',    nullable=True)
    op.alter_column('attendance', 'working_minutes',  nullable=True)

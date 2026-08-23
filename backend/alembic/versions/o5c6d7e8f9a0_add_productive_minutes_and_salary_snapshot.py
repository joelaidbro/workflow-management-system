"""add_productive_minutes_and_salary_snapshot

Revision ID: o5c6d7e8f9a0
Revises: n4b5c6d7e8f9
Create Date: 2026-08-23

Phase 1 of the salary calculation overhaul. Adds:
- attendance.productive_minutes: working_minutes minus break_minutes minus
  idle_minutes (meeting time counts as work, so it's not deducted). Kept
  separate from the existing working_minutes (raw start-day-to-end-day span)
  rather than replacing it, since other features already depend on that
  figure meaning "the whole shift."
- attendance.overtime_minutes: productive_minutes beyond the company's
  configured working_hours_per_day for that day. Informational only.
- salary_records.calculation_mode / calculation_snapshot / updated_at: once
  approved, a salary record must stay self-explanatory even if the company's
  settings change later — this snapshots which formula and inputs produced
  it, rather than letting it be silently reinterpreted after the fact.

Existing attendance rows get productive_minutes backfilled from
working_minutes - break_minutes - idle_minutes (floored at 0) so historical
data isn't just zeroed out; there's no way to retroactively know overtime
without knowing what working_hours_per_day was on each historical date, so
overtime_minutes backfills to 0 for existing rows.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'o5c6d7e8f9a0'
down_revision: Union[str, None] = 'n4b5c6d7e8f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('attendance', sa.Column('productive_minutes', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('attendance', sa.Column('overtime_minutes', sa.Integer(), nullable=False, server_default='0'))

    op.execute(
        """
        UPDATE attendance
        SET productive_minutes = GREATEST(
            0,
            COALESCE(working_minutes, 0) - COALESCE(break_minutes, 0) - COALESCE(idle_minutes, 0)
        )
        """
    )

    op.add_column('salary_records', sa.Column('calculation_mode', sa.String(20), nullable=True))
    op.add_column('salary_records', sa.Column('calculation_snapshot', postgresql.JSON(), nullable=True))
    op.add_column('salary_records', sa.Column('updated_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('salary_records', 'updated_at')
    op.drop_column('salary_records', 'calculation_snapshot')
    op.drop_column('salary_records', 'calculation_mode')
    op.drop_column('attendance', 'overtime_minutes')
    op.drop_column('attendance', 'productive_minutes')

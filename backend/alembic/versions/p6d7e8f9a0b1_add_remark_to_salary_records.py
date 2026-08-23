"""add_remark_to_salary_records

Revision ID: p6d7e8f9a0b1
Revises: o5c6d7e8f9a0
Create Date: 2026-08-23

Adds salary_records.remark — a free-text note a super_admin can attach when
approving a month, explaining why final_salary differs from the
system-calculated calculated_salary (bonus, deduction, correction, etc).
Purely optional/informational, no backfill needed.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'p6d7e8f9a0b1'
down_revision: Union[str, None] = 'o5c6d7e8f9a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('salary_records', sa.Column('remark', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('salary_records', 'remark')

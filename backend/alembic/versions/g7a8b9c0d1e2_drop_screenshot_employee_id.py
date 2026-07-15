"""drop_screenshot_employee_id

Revision ID: g7a8b9c0d1e2
Revises: f6a7b8c9d0e1
Create Date: 2026-07-14

screenshots.employee_id is redundant — the value is always derivable via
screenshots.user_id → users.employee_id. Dropping frees storage and removes
the risk of the denormalised value drifting out of sync.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'g7a8b9c0d1e2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('screenshots', 'employee_id')


def downgrade() -> None:
    op.add_column(
        'screenshots',
        sa.Column('employee_id', sa.String(50), nullable=True),
    )

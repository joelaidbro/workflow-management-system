"""add offline_minutes to attendance

Revision ID: b3d4e5f6a7b8
Revises: 4c71bc76f371
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3d4e5f6a7b8'
down_revision: Union[str, None] = '4c71bc76f371'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'attendance',
        sa.Column('offline_minutes', sa.Integer(), nullable=True)
    )
    op.execute("UPDATE attendance SET offline_minutes = 0")
    op.alter_column('attendance', 'offline_minutes', nullable=False)


def downgrade() -> None:
    op.drop_column('attendance', 'offline_minutes')

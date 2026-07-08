"""add last_seen_at to machine_tokens

Revision ID: c4d5e6f7a8b9
Revises: b3d4e5f6a7b8
Create Date: 2026-07-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, None] = 'b3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'machine_tokens',
        sa.Column('last_seen_at', sa.DateTime(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('machine_tokens', 'last_seen_at')

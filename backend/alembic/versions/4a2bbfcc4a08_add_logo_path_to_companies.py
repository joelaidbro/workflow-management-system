"""add_logo_path_to_companies

Revision ID: 4a2bbfcc4a08
Revises: c4d5e6f7a8b9
Create Date: 2026-07-08 18:25:43.958347

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4a2bbfcc4a08'
down_revision: Union[str, None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_path VARCHAR(500)")


def downgrade() -> None:
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS logo_path")

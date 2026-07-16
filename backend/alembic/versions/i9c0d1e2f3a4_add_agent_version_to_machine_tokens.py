"""add_agent_version_to_machine_tokens

Revision ID: i9c0d1e2f3a4
Revises: h8b9c0d1e2f3
Create Date: 2026-07-16

Tracks which agent version is installed on each staff member's machine.
agent_version: the version string last reported by the agent (e.g. "1.0.0")
agent_updated_at: when that version was first seen (i.e. when it changed)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'i9c0d1e2f3a4'
down_revision: Union[str, None] = 'h8b9c0d1e2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'machine_tokens',
        sa.Column('agent_version', sa.String(20), nullable=True),
    )
    op.add_column(
        'machine_tokens',
        sa.Column('agent_updated_at', sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('machine_tokens', 'agent_updated_at')
    op.drop_column('machine_tokens', 'agent_version')

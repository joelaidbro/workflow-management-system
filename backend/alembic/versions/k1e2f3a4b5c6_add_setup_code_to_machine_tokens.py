"""add_setup_code_to_machine_tokens

Revision ID: k1e2f3a4b5c6
Revises: j0d1e2f3a4b5
Create Date: 2026-07-21

Adds a short-lived, single-use setup code so the permanent machine_token
never has to be embedded in a downloadable setup card. The agent wizard
exchanges the code for the real credentials via /agent/redeem-setup-code.
setup_code: short human-typeable code shown on the setup card
setup_code_expires_at: code is worthless after this time (24h from issue)
setup_code_used_at: set once the code has been redeemed (single-use)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'k1e2f3a4b5c6'
down_revision: Union[str, None] = 'j0d1e2f3a4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'machine_tokens',
        sa.Column('setup_code', sa.String(16), nullable=True),
    )
    op.add_column(
        'machine_tokens',
        sa.Column('setup_code_expires_at', sa.DateTime(), nullable=True),
    )
    op.add_column(
        'machine_tokens',
        sa.Column('setup_code_used_at', sa.DateTime(), nullable=True),
    )
    op.create_index(
        'ix_machine_tokens_setup_code',
        'machine_tokens',
        ['setup_code'],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_machine_tokens_setup_code', table_name='machine_tokens')
    op.drop_column('machine_tokens', 'setup_code_used_at')
    op.drop_column('machine_tokens', 'setup_code_expires_at')
    op.drop_column('machine_tokens', 'setup_code')

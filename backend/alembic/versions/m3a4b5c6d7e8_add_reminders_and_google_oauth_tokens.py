"""add_reminders_and_google_oauth_tokens

Revision ID: m3a4b5c6d7e8
Revises: l2f3a4b5c6d7
Create Date: 2026-07-22

Reminder feature (Phase 1): self-service reminders synced to the user's
connected Google Calendar, with in-app push as a fallback delivery channel.
google_oauth_tokens holds one encrypted token pair per user (Fernet, via
crypto_utils.OAUTH_ENCRYPTION_KEY - encryption happens in the application
layer, columns are just Text here). reminders is the source-of-truth table;
google_event_id stays NULL if the user never connected Google or the Calendar
call failed at save time.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'm3a4b5c6d7e8'
down_revision: Union[str, None] = 'l2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'google_oauth_tokens',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('access_token', sa.Text(), nullable=False),
        sa.Column('refresh_token', sa.Text(), nullable=False),
        sa.Column('token_expiry', sa.DateTime(), nullable=False),
        sa.Column('google_email', sa.String(255), nullable=True),
        sa.Column('connected_at', sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', name='uq_google_oauth_tokens_user_id'),
    )

    op.create_table(
        'reminders',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('remind_at', sa.DateTime(), nullable=False),
        sa.Column('reminder_offsets', postgresql.JSON(), nullable=False, server_default='[]'),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('google_event_id', sa.String(255), nullable=True),
        sa.Column('failure_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint("status IN ('pending', 'sent', 'failed')", name='ck_reminders_status'),
    )
    op.create_index(
        'ix_reminders_user_id_created_at',
        'reminders',
        ['user_id', 'created_at'],
    )
    op.create_index(
        'ix_reminders_status_remind_at',
        'reminders',
        ['status', 'remind_at'],
    )


def downgrade() -> None:
    op.drop_index('ix_reminders_status_remind_at', table_name='reminders')
    op.drop_index('ix_reminders_user_id_created_at', table_name='reminders')
    op.drop_table('reminders')
    op.drop_table('google_oauth_tokens')

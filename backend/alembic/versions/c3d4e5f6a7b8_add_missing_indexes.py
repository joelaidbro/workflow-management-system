"""add_missing_indexes

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-14

sessions.user_id, alerts.sender_id, salary_records.user_id/company_id
were FK columns with no index — added here.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_sessions_user_id', 'sessions', ['user_id'], unique=False)
    op.create_index('ix_alerts_sender_id', 'alerts', ['sender_id'], unique=False)
    op.create_index('ix_salary_records_user_id', 'salary_records', ['user_id'], unique=False)
    op.create_index('ix_salary_records_company_id', 'salary_records', ['company_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_salary_records_company_id', table_name='salary_records')
    op.drop_index('ix_salary_records_user_id', table_name='salary_records')
    op.drop_index('ix_alerts_sender_id', table_name='alerts')
    op.drop_index('ix_sessions_user_id', table_name='sessions')

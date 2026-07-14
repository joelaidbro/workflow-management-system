"""add_user_unique_constraints

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-14

Composite unique constraints on users so two employees at the same company
cannot share an employee_id or email address.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        'uq_users_company_employee_id', 'users', ['company_id', 'employee_id']
    )
    op.create_unique_constraint(
        'uq_users_company_email', 'users', ['company_id', 'email']
    )


def downgrade() -> None:
    op.drop_constraint('uq_users_company_email', 'users', type_='unique')
    op.drop_constraint('uq_users_company_employee_id', 'users', type_='unique')

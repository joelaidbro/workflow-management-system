"""add_admin_staff_assignments

Revision ID: l2f3a4b5c6d7
Revises: k1e2f3a4b5c6
Create Date: 2026-07-21

Team assignment feature: super_admin can assign specific staff members to
specific admins so a normal admin only sees/manages their assigned staff
instead of the whole company roster. Many-to-many (a staff member may be
assigned to more than one admin); staff with no rows here are visible only
to super_admin.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'l2f3a4b5c6d7'
down_revision: Union[str, None] = 'k1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'admin_staff_assignments',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('admin_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('staff_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('assigned_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id']),
        sa.ForeignKeyConstraint(['admin_id'], ['users.id']),
        sa.ForeignKeyConstraint(['staff_id'], ['users.id']),
        sa.ForeignKeyConstraint(['assigned_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('admin_id', 'staff_id', name='uq_admin_staff_assignment'),
    )
    op.create_index(
        'ix_admin_staff_assignments_admin_id',
        'admin_staff_assignments',
        ['admin_id'],
    )
    op.create_index(
        'ix_admin_staff_assignments_staff_id',
        'admin_staff_assignments',
        ['staff_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_admin_staff_assignments_staff_id', table_name='admin_staff_assignments')
    op.drop_index('ix_admin_staff_assignments_admin_id', table_name='admin_staff_assignments')
    op.drop_table('admin_staff_assignments')

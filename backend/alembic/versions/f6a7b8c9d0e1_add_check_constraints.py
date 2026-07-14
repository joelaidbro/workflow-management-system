"""add_check_constraints

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-07-14

Adds CHECK constraints on status/enum string columns so the DB rejects
any value not recognised by the application layer.
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_check_constraint(
        'ck_users_role',
        'users',
        "role IN ('admin', 'staff', 'super_admin', 'platform_admin')",
    )
    op.create_check_constraint(
        'ck_users_work_type',
        'users',
        "work_type IN ('office', 'wfh')",
    )
    op.create_check_constraint(
        'ck_attendance_work_mode',
        'attendance',
        "work_mode IS NULL OR work_mode IN ('office', 'wfh', 'leave')",
    )
    op.create_check_constraint(
        'ck_current_status_status',
        'current_status',
        "status IN ('offline', 'active', 'break', 'meeting', 'idle')",
    )
    op.create_check_constraint(
        'ck_leave_requests_status',
        'leave_requests',
        "status IN ('pending', 'approved', 'rejected')",
    )
    op.create_check_constraint(
        'ck_tasks_status',
        'tasks',
        "status IN ('pending', 'in_progress', 'done')",
    )
    op.create_check_constraint(
        'ck_alert_recipients_status',
        'alert_recipients',
        "status IN ('pending', 'acknowledged')",
    )
    op.create_check_constraint(
        'ck_alerts_alert_type',
        'alerts',
        "alert_type IN ('info', 'urgent')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_alerts_alert_type',       'alerts',           type_='check')
    op.drop_constraint('ck_alert_recipients_status', 'alert_recipients', type_='check')
    op.drop_constraint('ck_tasks_status',            'tasks',            type_='check')
    op.drop_constraint('ck_leave_requests_status',   'leave_requests',   type_='check')
    op.drop_constraint('ck_current_status_status',   'current_status',   type_='check')
    op.drop_constraint('ck_attendance_work_mode',    'attendance',       type_='check')
    op.drop_constraint('ck_users_work_type',         'users',            type_='check')
    op.drop_constraint('ck_users_role',              'users',            type_='check')

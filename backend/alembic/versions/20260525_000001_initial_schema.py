"""initial schema

Revision ID: 20260525_000001
Revises:
Create Date: 2026-05-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260525_000001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", sa.String(length=50), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("department", sa.String(length=100), nullable=True),
        sa.Column("job_title", sa.String(length=100), nullable=True),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("work_type", sa.String(length=10), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("joining_date", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_company_id", "users", ["company_id"], unique=False)
    op.create_table(
        "activity_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("company_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("machine_id", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_activity_logs_company_id_user_id_timestamp",
        "activity_logs",
        ["company_id", "user_id", "timestamp"],
        unique=False,
    )
    op.create_table(
        "current_status",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("machine_id", sa.String(length=255), nullable=True),
        sa.Column("today_work_mode", sa.String(length=10), nullable=True),
        sa.Column("break_started_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index("ix_sessions_token", "sessions", ["token"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_sessions_token", table_name="sessions")
    op.drop_table("sessions")
    op.drop_table("current_status")
    op.drop_index(
        "ix_activity_logs_company_id_user_id_timestamp",
        table_name="activity_logs",
    )
    op.drop_table("activity_logs")
    op.drop_index("ix_users_company_id", table_name="users")
    op.drop_table("users")
    op.drop_table("companies")

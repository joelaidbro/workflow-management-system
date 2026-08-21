"""add_subscription_billing

Revision ID: n4b5c6d7e8f9
Revises: m3a4b5c6d7e8
Create Date: 2026-08-16

Subscription/billing feature: platform_settings (singleton, editable pricing
config), subscriptions (one row per company, live billing-cycle state), and
subscription_invoices (one row per renewal/proration billing event, paid via
Razorpay Orders). Seeds a default platform_settings row and backfills every
pre-existing company with an active subscription plus a first renewal
invoice due within the grace window, so nobody is skipped when this ships.
"""
import uuid
from datetime import datetime, timedelta
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'n4b5c6d7e8f9'
down_revision: Union[str, None] = 'm3a4b5c6d7e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

DEFAULT_MONTHLY_BASE_PRICE = 5000
DEFAULT_INCLUDED_STAFF_COUNT = 10
DEFAULT_EXTRA_STAFF_PRICE = 500
DEFAULT_GRACE_PERIOD_HOURS = 48


def upgrade() -> None:
    op.create_table(
        'platform_settings',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('monthly_base_price', sa.Numeric(10, 2), nullable=False, server_default=str(DEFAULT_MONTHLY_BASE_PRICE)),
        sa.Column('included_staff_count', sa.Integer(), nullable=False, server_default=str(DEFAULT_INCLUDED_STAFF_COUNT)),
        sa.Column('extra_staff_price', sa.Numeric(10, 2), nullable=False, server_default=str(DEFAULT_EXTRA_STAFF_PRICE)),
        sa.Column('grace_period_hours', sa.Integer(), nullable=False, server_default=str(DEFAULT_GRACE_PERIOD_HOURS)),
        sa.Column('currency', sa.String(3), nullable=False, server_default='INR'),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'subscriptions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('plan_type', sa.String(10), nullable=False, server_default='monthly'),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('staff_count_at_invoice', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('current_period_start', sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.Column('current_period_end', sa.DateTime(), nullable=False),
        sa.Column('locked_at', sa.DateTime(), nullable=True),
        sa.Column('expiry_warning_sent_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('company_id', name='uq_subscriptions_company_id'),
        sa.CheckConstraint("plan_type IN ('monthly', 'yearly')", name='ck_subscriptions_plan_type'),
        sa.CheckConstraint("status IN ('active', 'overdue', 'locked', 'cancelled')", name='ck_subscriptions_status'),
    )

    op.create_table(
        'subscription_invoices',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('company_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('subscription_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('invoice_type', sa.String(20), nullable=False, server_default='renewal'),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('currency', sa.String(3), nullable=False, server_default='INR'),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('staff_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('period_start', sa.DateTime(), nullable=True),
        sa.Column('period_end', sa.DateTime(), nullable=True),
        sa.Column('due_at', sa.DateTime(), nullable=False),
        sa.Column('razorpay_order_id', sa.String(64), nullable=True),
        sa.Column('razorpay_payment_id', sa.String(64), nullable=True),
        sa.Column('razorpay_signature', sa.String(255), nullable=True),
        sa.Column('paid_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text("NOW()")),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id']),
        sa.ForeignKeyConstraint(['subscription_id'], ['subscriptions.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint(
            "invoice_type IN ('renewal', 'proration')", name='ck_subscription_invoices_invoice_type'
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'paid', 'failed')", name='ck_subscription_invoices_status'
        ),
    )

    op.create_index('ix_subscriptions_company_id', 'subscriptions', ['company_id'])
    op.create_index(
        'ix_subscriptions_status_current_period_end', 'subscriptions', ['status', 'current_period_end']
    )
    op.create_index(
        'ix_subscription_invoices_company_id_created_at', 'subscription_invoices', ['company_id', 'created_at']
    )
    op.create_index(
        'ix_subscription_invoices_status_due_at', 'subscription_invoices', ['status', 'due_at']
    )
    op.create_index(
        'ix_subscription_invoices_razorpay_order_id', 'subscription_invoices', ['razorpay_order_id']
    )

    # --- Data backfill -----------------------------------------------------
    bind = op.get_bind()
    now = datetime.utcnow()

    settings_table = sa.table(
        'platform_settings',
        sa.column('id', postgresql.UUID(as_uuid=True)),
        sa.column('monthly_base_price', sa.Numeric(10, 2)),
        sa.column('included_staff_count', sa.Integer()),
        sa.column('extra_staff_price', sa.Numeric(10, 2)),
        sa.column('grace_period_hours', sa.Integer()),
        sa.column('currency', sa.String(3)),
        sa.column('updated_at', sa.DateTime()),
    )
    bind.execute(
        settings_table.insert().values(
            id=uuid.uuid4(),
            monthly_base_price=DEFAULT_MONTHLY_BASE_PRICE,
            included_staff_count=DEFAULT_INCLUDED_STAFF_COUNT,
            extra_staff_price=DEFAULT_EXTRA_STAFF_PRICE,
            grace_period_hours=DEFAULT_GRACE_PERIOD_HOURS,
            currency='INR',
            updated_at=now,
        )
    )

    companies = bind.execute(sa.text("SELECT id FROM companies")).fetchall()

    subscriptions_table = sa.table(
        'subscriptions',
        sa.column('id', postgresql.UUID(as_uuid=True)),
        sa.column('company_id', postgresql.UUID(as_uuid=True)),
        sa.column('plan_type', sa.String(10)),
        sa.column('status', sa.String(20)),
        sa.column('staff_count_at_invoice', sa.Integer()),
        sa.column('current_period_start', sa.DateTime()),
        sa.column('current_period_end', sa.DateTime()),
        sa.column('created_at', sa.DateTime()),
        sa.column('updated_at', sa.DateTime()),
    )
    invoices_table = sa.table(
        'subscription_invoices',
        sa.column('id', postgresql.UUID(as_uuid=True)),
        sa.column('company_id', postgresql.UUID(as_uuid=True)),
        sa.column('subscription_id', postgresql.UUID(as_uuid=True)),
        sa.column('invoice_type', sa.String(20)),
        sa.column('amount', sa.Numeric(10, 2)),
        sa.column('currency', sa.String(3)),
        sa.column('status', sa.String(20)),
        sa.column('staff_count', sa.Integer()),
        sa.column('period_start', sa.DateTime()),
        sa.column('period_end', sa.DateTime()),
        sa.column('due_at', sa.DateTime()),
        sa.column('created_at', sa.DateTime()),
    )

    period_end = now + timedelta(days=30)
    # 48-hour first-payment window for every pre-existing company, per product
    # decision — treated as if their billing cycle started the moment this
    # migration ran, same terms every future company gets.
    first_due_at = now + timedelta(hours=DEFAULT_GRACE_PERIOD_HOURS)

    for (company_id,) in companies:
        staff_count_row = bind.execute(
            sa.text(
                "SELECT COUNT(*) FROM users WHERE company_id = :cid AND is_active = TRUE AND role != 'platform_admin'"
            ),
            {"cid": company_id},
        ).fetchone()
        staff_count = staff_count_row[0] if staff_count_row else 0
        extra_units = max(0, staff_count - DEFAULT_INCLUDED_STAFF_COUNT)
        amount = DEFAULT_MONTHLY_BASE_PRICE + extra_units * DEFAULT_EXTRA_STAFF_PRICE

        subscription_id = uuid.uuid4()
        bind.execute(
            subscriptions_table.insert().values(
                id=subscription_id,
                company_id=company_id,
                plan_type='monthly',
                status='active',
                staff_count_at_invoice=staff_count,
                current_period_start=now,
                current_period_end=period_end,
                created_at=now,
                updated_at=now,
            )
        )
        bind.execute(
            invoices_table.insert().values(
                id=uuid.uuid4(),
                company_id=company_id,
                subscription_id=subscription_id,
                invoice_type='renewal',
                amount=amount,
                currency='INR',
                status='pending',
                staff_count=staff_count,
                period_start=now,
                period_end=period_end,
                due_at=first_due_at,
                created_at=now,
            )
        )


def downgrade() -> None:
    op.drop_index('ix_subscription_invoices_razorpay_order_id', table_name='subscription_invoices')
    op.drop_index('ix_subscription_invoices_status_due_at', table_name='subscription_invoices')
    op.drop_index('ix_subscription_invoices_company_id_created_at', table_name='subscription_invoices')
    op.drop_index('ix_subscriptions_status_current_period_end', table_name='subscriptions')
    op.drop_index('ix_subscriptions_company_id', table_name='subscriptions')
    op.drop_table('subscription_invoices')
    op.drop_table('subscriptions')
    op.drop_table('platform_settings')

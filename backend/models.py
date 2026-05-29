import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from database import Base


class Company(Base):
    __tablename__ = "companies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    config = Column(JSON, nullable=False, default=dict)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="company")


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    employee_id = Column(String(50), nullable=False)
    full_name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False)
    phone = Column(String(20), nullable=True)
    department = Column(String(100), nullable=True)
    job_title = Column(String(100), nullable=True)
    role = Column(String(20), nullable=False)
    work_type = Column(String(10), nullable=False, default="office")
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    joining_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    company = relationship("Company", back_populates="users")
    sessions = relationship("Session", back_populates="user")
    current_status = relationship(
        "CurrentStatus",
        back_populates="user",
        uselist=False,
    )
    activity_logs = relationship("ActivityLog", back_populates="user")
    machine_token = relationship(
        "MachineToken",
        back_populates="user",
        uselist=False,
    )
    sent_alerts = relationship(
        "Alert",
        back_populates="sender",
        foreign_keys="Alert.sender_id",
    )
    alert_recipients = relationship(
        "AlertRecipient",
        back_populates="recipient",
    )


class Session(Base):
    __tablename__ = "sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token = Column(String(255), unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    is_active = Column(Boolean, default=True)

    user = relationship("User", back_populates="sessions")


class CurrentStatus(Base):
    __tablename__ = "current_status"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    status = Column(String(20), nullable=False, default="offline")
    updated_at = Column(DateTime, default=datetime.utcnow)
    machine_id = Column(String(255), nullable=True)
    today_work_mode = Column(String(10), nullable=True)
    break_started_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="current_status")


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status = Column(String(20), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    machine_id = Column(String(255), nullable=True)

    user = relationship("User", back_populates="activity_logs")


class MachineToken(Base):
    __tablename__ = "machine_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
        unique=True,
    )
    token = Column(String(255), unique=True, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="machine_token")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    sender_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    recipient_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    alert_type = Column(String(10), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)

    sender = relationship(
        "User",
        back_populates="sent_alerts",
        foreign_keys=[sender_id],
    )
    recipients = relationship("AlertRecipient", back_populates="alert")


class AlertRecipient(Base):
    __tablename__ = "alert_recipients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alert_id = Column(UUID(as_uuid=True), ForeignKey("alerts.id"), nullable=False)
    recipient_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    acknowledged_at = Column(DateTime, nullable=True)
    reply = Column(Text, nullable=True)

    alert = relationship("Alert", back_populates="recipients")
    recipient = relationship("User", back_populates="alert_recipients")


Index(
    "ix_activity_logs_company_id_user_id_timestamp",
    ActivityLog.company_id,
    ActivityLog.user_id,
    ActivityLog.timestamp,
)
Index("ix_users_company_id", User.company_id)
Index("ix_sessions_token", Session.token)
Index("ix_machine_tokens_token", MachineToken.token)
Index(
    "ix_alert_recipients_alert_id_recipient_id",
    AlertRecipient.alert_id,
    AlertRecipient.recipient_id,
)
Index(
    "ix_alert_recipients_recipient_id_status",
    AlertRecipient.recipient_id,
    AlertRecipient.status,
)
Index("ix_alerts_company_id_created_at", Alert.company_id, Alert.created_at)

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
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
    base_salary = Column(Numeric(10, 2), default=0)
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
    sent_messages = relationship(
        "Message",
        back_populates="sender",
        foreign_keys="Message.sender_id",
    )
    received_messages = relationship(
        "Message",
        back_populates="recipient",
        foreign_keys="Message.recipient_id",
    )
    daily_reports = relationship(
        "DailyReport",
        back_populates="user",
        foreign_keys="DailyReport.user_id",
    )
    replied_reports = relationship(
        "DailyReport",
        back_populates="reply_admin",
        foreign_keys="DailyReport.replied_by",
    )
    attendance_records = relationship("Attendance", back_populates="user")
    approved_salary_records = relationship(
        "SalaryRecord",
        back_populates="approver",
        foreign_keys="SalaryRecord.approved_by",
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


class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    sender_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    recipient_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    sender = relationship(
        "User",
        back_populates="sent_messages",
        foreign_keys=[sender_id],
    )
    recipient = relationship(
        "User",
        back_populates="received_messages",
        foreign_keys=[recipient_id],
    )


class DailyReport(Base):
    __tablename__ = "daily_reports"
    __table_args__ = (
        UniqueConstraint("user_id", "report_date", name="uq_daily_reports_user_date"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    report_date = Column(Date, nullable=False)
    content = Column(Text, nullable=False)
    submitted_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    admin_reply = Column(Text, nullable=True)
    admin_reply_at = Column(DateTime, nullable=True)
    replied_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    is_read_by_admin = Column(Boolean, default=False, nullable=False)

    user = relationship(
        "User",
        back_populates="daily_reports",
        foreign_keys=[user_id],
    )
    reply_admin = relationship(
        "User",
        back_populates="replied_reports",
        foreign_keys=[replied_by],
    )


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (
        UniqueConstraint("user_id", "date", name="uq_attendance_user_date"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    date = Column(Date, nullable=False)
    logged_in = Column(Boolean, default=False, nullable=False)
    report_submitted = Column(Boolean, default=False, nullable=False)
    is_present = Column(Boolean, default=False, nullable=False)
    work_mode = Column(String(10), nullable=True)
    login_time = Column(DateTime, nullable=True)
    logout_time = Column(DateTime, nullable=True)
    working_minutes = Column(Integer, default=0)
    break_minutes = Column(Integer, default=0)
    meeting_minutes = Column(Integer, default=0)

    user = relationship("User", back_populates="attendance_records")


class SalaryRecord(Base):
    __tablename__ = "salary_records"
    __table_args__ = (
        UniqueConstraint("user_id", "month", "year", name="uq_salary_user_month_year"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    month = Column(Integer, nullable=False)
    year = Column(Integer, nullable=False)
    base_salary = Column(Numeric(10, 2))
    calculated_salary = Column(Numeric(10, 2))
    final_salary = Column(Numeric(10, 2))
    is_approved = Column(Boolean, default=False)
    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    approved_at = Column(DateTime)

    approver = relationship(
        "User",
        back_populates="approved_salary_records",
        foreign_keys=[approved_by],
    )


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
Index(
    "ix_messages_company_id_sender_id_recipient_id",
    Message.company_id,
    Message.sender_id,
    Message.recipient_id,
)
Index("ix_messages_recipient_id_is_read", Message.recipient_id, Message.is_read)
Index(
    "ix_daily_reports_company_id_user_id_report_date",
    DailyReport.company_id,
    DailyReport.user_id,
    DailyReport.report_date,
)
Index(
    "ix_daily_reports_company_id_report_date",
    DailyReport.company_id,
    DailyReport.report_date,
)
Index(
    "ix_daily_reports_company_id_is_read_by_admin",
    DailyReport.company_id,
    DailyReport.is_read_by_admin,
)
Index(
    "ix_attendance_company_id_user_id_date",
    Attendance.company_id,
    Attendance.user_id,
    Attendance.date,
)
Index("ix_attendance_company_id_date", Attendance.company_id, Attendance.date)

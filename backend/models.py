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
    deletion_requested_at = Column(DateTime, nullable=True)
    deletion_scheduled_at = Column(DateTime, nullable=True)
    is_deletion_pending = Column(Boolean, default=False, nullable=False)
    logo_path = Column(String(500), nullable=True)

    users = relationship("User", back_populates="company")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("company_id", "employee_id", name="uq_users_company_employee_id"),
        UniqueConstraint("company_id", "email", name="uq_users_company_email"),
    )

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
    leave_requests = relationship(
        "LeaveRequest",
        back_populates="user",
        foreign_keys="LeaveRequest.user_id",
    )
    reviewed_leave_requests = relationship(
        "LeaveRequest",
        back_populates="reviewer",
        foreign_keys="LeaveRequest.reviewed_by",
    )
    screenshots = relationship("Screenshot", back_populates="user")
    assigned_tasks = relationship(
        "Task",
        back_populates="assignee",
        foreign_keys="Task.assigned_to",
    )
    created_tasks = relationship(
        "Task",
        back_populates="assigner",
        foreign_keys="Task.assigned_by",
    )
    push_subscriptions = relationship(
        "PushSubscription",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    google_oauth_token = relationship(
        "GoogleOAuthToken",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    reminders = relationship(
        "Reminder",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class AdminStaffAssignment(Base):
    __tablename__ = "admin_staff_assignments"
    __table_args__ = (
        UniqueConstraint("admin_id", "staff_id", name="uq_admin_staff_assignment"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    admin_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    staff_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    assigned_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    admin = relationship("User", foreign_keys=[admin_id])
    staff = relationship("User", foreign_keys=[staff_id])


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint = Column(String(2048), nullable=False, unique=True)
    p256dh = Column(String(512), nullable=False)
    auth = Column(String(256), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="push_subscriptions")


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
    idle_started_at = Column(DateTime, nullable=True)

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
    session_active = Column(Boolean, default=False, nullable=False)
    last_seen_at = Column(DateTime, nullable=True)
    agent_version = Column(String(20), nullable=True)
    agent_updated_at = Column(DateTime, nullable=True)
    setup_code = Column(String(16), unique=True, nullable=True)
    setup_code_expires_at = Column(DateTime, nullable=True)
    setup_code_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="machine_token")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    sender_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
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
    reply_read_by_admin = Column(Boolean, default=False, nullable=False)

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
    is_read_by_staff = Column(Boolean, default=False, nullable=False)

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
    working_minutes = Column(Integer, default=0, nullable=False)
    break_minutes = Column(Integer, default=0, nullable=False)
    meeting_minutes = Column(Integer, default=0, nullable=False)
    idle_minutes = Column(Integer, default=0, nullable=False)
    offline_minutes = Column(Integer, default=0, nullable=False)

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


class LeaveRequest(Base):
    __tablename__ = "leave_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    leave_type = Column(String(50), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    total_days = Column(Integer, nullable=False)
    reason = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    admin_comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    is_read_by_staff = Column(Boolean, default=False, nullable=False)

    user = relationship(
        "User",
        back_populates="leave_requests",
        foreign_keys=[user_id],
    )
    reviewer = relationship(
        "User",
        back_populates="reviewed_leave_requests",
        foreign_keys=[reviewed_by],
    )


class Screenshot(Base):
    __tablename__ = "screenshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    captured_at = Column(DateTime, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size_kb = Column(Integer, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    is_deleted = Column(Boolean, default=False)

    user = relationship("User", back_populates="screenshots")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    assigned_to = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    assigned_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    due_date = Column(Date, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    assignee = relationship(
        "User",
        back_populates="assigned_tasks",
        foreign_keys=[assigned_to],
    )
    assigner = relationship(
        "User",
        back_populates="created_tasks",
        foreign_keys=[assigned_by],
    )


class GoogleOAuthToken(Base):
    __tablename__ = "google_oauth_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=False)
    token_expiry = Column(DateTime, nullable=False)
    google_email = Column(String(255), nullable=True)
    connected_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="google_oauth_token")


class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    remind_at = Column(DateTime, nullable=False)
    reminder_offsets = Column(JSON, nullable=False, default=list)
    status = Column(String(20), nullable=False, default="pending")
    google_event_id = Column(String(255), nullable=True)
    failure_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="reminders")


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
Index(
    "ix_leave_requests_company_id_user_id_status",
    LeaveRequest.company_id,
    LeaveRequest.user_id,
    LeaveRequest.status,
)
Index(
    "ix_leave_requests_company_id_status_created_at",
    LeaveRequest.company_id,
    LeaveRequest.status,
    LeaveRequest.created_at,
)
Index(
    "ix_screenshots_company_id_user_id_captured_at",
    Screenshot.company_id,
    Screenshot.user_id,
    Screenshot.captured_at,
)
Index("ix_screenshots_captured_at", Screenshot.captured_at)
Index("ix_screenshots_is_deleted", Screenshot.is_deleted)
Index(
    "ix_tasks_company_id_assigned_to_status",
    Task.company_id,
    Task.assigned_to,
    Task.status,
)
Index("ix_tasks_company_id_created_at", Task.company_id, Task.created_at)
Index("ix_sessions_user_id", Session.user_id)
Index("ix_alerts_sender_id", Alert.sender_id)
Index("ix_salary_records_user_id", SalaryRecord.user_id)
Index("ix_salary_records_company_id", SalaryRecord.company_id)
Index("ix_admin_staff_assignments_admin_id", AdminStaffAssignment.admin_id)
Index("ix_admin_staff_assignments_staff_id", AdminStaffAssignment.staff_id)
Index("ix_reminders_user_id_created_at", Reminder.user_id, Reminder.created_at)
Index("ix_reminders_status_remind_at", Reminder.status, Reminder.remind_at)

import re
import uuid
from io import BytesIO
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from main import limiter
from models import Attendance, Company, DailyReport, SalaryRecord, User

router = APIRouter()

VALID_WORK_MODES = {"wfh", "office"}


class StartDayRequest(BaseModel):
    work_mode: str


class EndDayRequest(BaseModel):
    report_content: str


class ReportReplyRequest(BaseModel):
    reply: str


class SalaryApprovalRequest(BaseModel):
    final_salary: Decimal


def strip_html_tags(value: str) -> str:
    return re.sub(r"<[^>]*>", "", value).strip()


def format_utc_datetime(value):
    return value.isoformat() + "Z" if value else None


def require_staff(current_user: User):
    if current_user.role != "staff":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )


def require_admin(current_user: User):
    if current_user.role not in {"admin", "super_admin"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )


def require_super_admin(current_user: User):
    if current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )


def get_month_range(month: int, year: int):
    if month < 1 or month > 12:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid month",
        )

    start_date = date_type(year, month, 1)
    if month == 12:
        end_date = date_type(year + 1, 1, 1)
    else:
        end_date = date_type(year, month + 1, 1)

    return start_date, end_date


def get_staff_for_attendance(user_id: str, current_user: User, db: Session):
    try:
        user_uuid = uuid.UUID(str(user_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user = (
        db.query(User)
        .filter(
            User.id == user_uuid,
            User.company_id == current_user.company_id,
            User.is_active.is_(True),
            User.role == "staff",
        )
        .first()
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if current_user.role == "staff" and user.id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )

    return user


def build_attendance_summary(user: User, month: int, year: int, db: Session):
    start_date, end_date = get_month_range(month, year)
    records = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == user.id,
            Attendance.date >= start_date,
            Attendance.date < end_date,
        )
        .order_by(Attendance.date.asc())
        .all()
    )

    total_working_days = sum(1 for record in records if record.logged_in)
    days_present = sum(1 for record in records if record.is_present)
    days_absent = total_working_days - days_present

    return {
        "user_id": str(user.id),
        "full_name": user.full_name,
        "employee_id": user.employee_id,
        "email": user.email,
        "phone": user.phone,
        "department": user.department,
        "job_title": user.job_title,
        "work_type": user.work_type,
        "joining_date": format_utc_datetime(user.joining_date),
        "base_salary": float(user.base_salary) if user.base_salary else None,
        "month": month,
        "year": year,
        "total_working_days": total_working_days,
        "days_present": days_present,
        "days_absent": days_absent,
        "total_working_minutes": sum(record.working_minutes or 0 for record in records),
        "total_break_minutes": sum(record.break_minutes or 0 for record in records),
        "total_meeting_minutes": sum(record.meeting_minutes or 0 for record in records),
        "total_idle_minutes": sum(record.idle_minutes or 0 for record in records),
        "attendance_records": [
            {
                "date": record.date,
                "is_present": record.is_present,
                "work_mode": record.work_mode,
                "working_minutes": record.working_minutes,
                "idle_minutes": record.idle_minutes,
                "login_time": format_utc_datetime(record.login_time),
                "logout_time": format_utc_datetime(record.logout_time),
            }
            for record in records
        ],
    }


def calculate_monthly_salary(user: User, summary: dict, db: Session):
    company = db.query(Company).filter(Company.id == user.company_id).first()
    company_config = company.config if company and company.config else {}
    configured_days = company_config.get("working_days_per_month")
    total_days = configured_days or (
        summary["days_present"] + summary["days_absent"]
    )

    base_salary = Decimal(user.base_salary or 0)
    if total_days:
        calculated_salary = (base_salary / Decimal(total_days)) * Decimal(
            summary["days_present"]
        )
    else:
        calculated_salary = Decimal("0")

    return calculated_salary.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@router.post("/attendance/start-day")
def start_day(
    start_data: StartDayRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff(current_user)

    if start_data.work_mode not in VALID_WORK_MODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid work mode",
        )

    now = datetime.utcnow()
    today = now.date()
    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == current_user.id,
            Attendance.date == today,
        )
        .first()
    )

    if attendance and attendance.logged_in:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Day already started",
        )

    if not attendance:
        attendance = Attendance(
            company_id=current_user.company_id,
            user_id=current_user.id,
            date=today,
            logged_in=True,
            login_time=now,
            work_mode=start_data.work_mode,
        )
        db.add(attendance)
    else:
        attendance.logged_in = True
        attendance.login_time = now
        attendance.work_mode = start_data.work_mode

    db.commit()

    return {
        "message": "Day started",
        "date": today.isoformat(),
        "work_mode": start_data.work_mode,
    }


@router.post("/attendance/end-day")
@limiter.limit("5/minute")
def end_day(
    request: Request,
    end_data: EndDayRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff(current_user)

    report_content = strip_html_tags(end_data.report_content)
    if not report_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Report content must not be empty",
        )

    now = datetime.utcnow()
    today = now.date()
    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == current_user.id,
            Attendance.date == today,
        )
        .first()
    )

    if not attendance:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Day not started — please use start-day first",
        )

    if attendance.logout_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Day already ended",
        )

    working_minutes = int((now - attendance.login_time).total_seconds() // 60)
    attendance.logout_time = now
    attendance.report_submitted = True
    attendance.is_present = True
    attendance.working_minutes = working_minutes

    db.add(
        DailyReport(
            company_id=current_user.company_id,
            user_id=current_user.id,
            report_date=today,
            content=report_content,
            submitted_at=now,
        )
    )
    db.commit()

    return {
        "message": "Day ended successfully",
        "working_minutes": working_minutes,
        "report_submitted": True,
    }


@router.get("/attendance/today")
def get_today_attendance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = datetime.utcnow().date()
    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == current_user.id,
            Attendance.date == today,
        )
        .first()
    )

    if not attendance:
        return {"started": False}

    return {
        "started": True,
        "id": str(attendance.id),
        "company_id": str(attendance.company_id),
        "user_id": str(attendance.user_id),
        "date": attendance.date,
        "logged_in": attendance.logged_in,
        "report_submitted": attendance.report_submitted,
        "is_present": attendance.is_present,
        "work_mode": attendance.work_mode,
        "login_time": format_utc_datetime(attendance.login_time),
        "logout_time": format_utc_datetime(attendance.logout_time),
        "working_minutes": attendance.working_minutes,
        "break_minutes": attendance.break_minutes,
        "meeting_minutes": attendance.meeting_minutes,
        "idle_minutes": attendance.idle_minutes,
    }


@router.get("/attendance/reports/my-reports")
def get_my_reports(
    month: int | None = None,
    year: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_staff(current_user)

    now = datetime.utcnow()
    report_month = month or now.month
    report_year = year or now.year
    start_date, end_date = get_month_range(report_month, report_year)

    reports = (
        db.query(DailyReport)
        .filter(
            DailyReport.user_id == current_user.id,
            DailyReport.report_date >= start_date,
            DailyReport.report_date < end_date,
        )
        .order_by(DailyReport.report_date.desc())
        .all()
    )

    return [
        {
            "id": str(report.id),
            "report_date": report.report_date,
            "content": report.content,
            "submitted_at": format_utc_datetime(report.submitted_at),
            "admin_reply": report.admin_reply,
            "admin_reply_at": format_utc_datetime(report.admin_reply_at),
            "is_read_by_admin": report.is_read_by_admin,
        }
        for report in reports
    ]


@router.get("/attendance/reports/team")
def get_team_reports(
    date: str | None = None,
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    query = (
        db.query(DailyReport, User)
        .join(User, User.id == DailyReport.user_id)
        .filter(
            DailyReport.company_id == current_user.company_id,
            User.role == "staff",
        )
    )

    if date:
        try:
            report_date = date_type.fromisoformat(date)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date",
            )
        query = query.filter(DailyReport.report_date == report_date)

    if unread_only:
        query = query.filter(DailyReport.is_read_by_admin.is_(False))

    report_rows = query.order_by(DailyReport.submitted_at.desc()).all()

    response = [
        {
            "id": str(report.id),
            "report_date": report.report_date,
            "content": report.content,
            "submitted_at": format_utc_datetime(report.submitted_at),
            "admin_reply": report.admin_reply,
            "is_read_by_admin": report.is_read_by_admin,
            "full_name": staff.full_name,
            "employee_id": staff.employee_id,
        }
        for report, staff in report_rows
    ]

    for report, staff in report_rows:
        report.is_read_by_admin = True
    db.commit()

    return response


@router.post("/attendance/reports/{report_id}/reply")
def reply_to_report(
    report_id: str,
    reply_data: ReportReplyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    reply_text = strip_html_tags(reply_data.reply)
    if not reply_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reply must not be empty",
        )

    try:
        report_uuid = uuid.UUID(str(report_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )

    report = (
        db.query(DailyReport)
        .filter(
            DailyReport.id == report_uuid,
            DailyReport.company_id == current_user.company_id,
        )
        .first()
    )
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )

    if report.admin_reply is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Report already has a reply",
        )

    report.admin_reply = reply_text
    report.admin_reply_at = datetime.utcnow()
    report.replied_by = current_user.id
    db.commit()

    return {"message": "Reply submitted"}


@router.get("/attendance/export/team-excel")
def export_team_attendance_excel(
    month: int,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    require_admin(current_user)
    staff_members = (
        db.query(User)
        .filter(
            User.company_id == current_user.company_id,
            User.role == "staff",
            User.is_active.is_(True),
        )
        .order_by(User.full_name.asc())
        .all()
    )

    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = f"Attendance {month}-{year}"

    headers = [
        "Full Name",
        "Employee ID",
        "Department",
        "Days Present",
        "Days Absent",
        "Total Working Hours",
        "Total Break Hours",
        "Base Salary",
        "Calculated Salary",
        "Salary Approved",
    ]
    worksheet.append(headers)

    header_fill = PatternFill("solid", fgColor="1E3A8A")
    header_font = Font(color="FFFFFF", bold=True)
    alternate_fill = PatternFill("solid", fgColor="F3F4F6")

    for cell in worksheet[1]:
        cell.fill = header_fill
        cell.font = header_font

    for staff in staff_members:
        summary = build_attendance_summary(staff, month, year, db)
        calculated_salary = calculate_monthly_salary(staff, summary, db)
        salary_record = (
            db.query(SalaryRecord)
            .filter(
                SalaryRecord.user_id == staff.id,
                SalaryRecord.month == month,
                SalaryRecord.year == year,
            )
            .first()
        )

        worksheet.append(
            [
                staff.full_name,
                staff.employee_id,
                staff.department,
                summary["days_present"],
                summary["days_absent"],
                round(summary["total_working_minutes"] / 60, 1),
                round(summary["total_break_minutes"] / 60, 1),
                float(staff.base_salary or 0),
                float(calculated_salary),
                "Yes" if salary_record and salary_record.is_approved else "No",
            ]
        )

    for row in worksheet.iter_rows(min_row=2):
        if row[0].row % 2 == 0:
            for cell in row:
                cell.fill = alternate_fill

    for column_cells in worksheet.columns:
        max_length = max(
            len(str(cell.value)) if cell.value is not None else 0
            for cell in column_cells
        )
        worksheet.column_dimensions[get_column_letter(column_cells[0].column)].width = (
            max_length + 2
        )

    output = BytesIO()
    workbook.save(output)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        headers={
            "Content-Disposition": f"attachment; filename=attendance_{month}_{year}.xlsx"
        },
    )


@router.get("/attendance/export/salary-slip/{user_id}")
def export_salary_slip_pdf(
    user_id: str,
    month: int,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    staff = get_staff_for_attendance(user_id, current_user, db)
    salary_record = (
        db.query(SalaryRecord)
        .filter(
            SalaryRecord.user_id == staff.id,
            SalaryRecord.month == month,
            SalaryRecord.year == year,
            SalaryRecord.is_approved.is_(True),
        )
        .first()
    )
    if not salary_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Salary not yet approved for this period",
        )

    company = db.query(Company).filter(Company.id == staff.company_id).first()
    summary = build_attendance_summary(staff, month, year, db)

    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4)
    styles = getSampleStyleSheet()
    elements = [
        Paragraph(company.name if company else "Company", styles["Title"]),
        Paragraph("SALARY SLIP", styles["Heading1"]),
        Paragraph(f"Month: {month} / Year: {year}", styles["Normal"]),
        Spacer(1, 16),
        Paragraph(f"Full Name: {staff.full_name}", styles["Normal"]),
        Paragraph(f"Employee ID: {staff.employee_id}", styles["Normal"]),
        Paragraph(f"Department: {staff.department or 'N/A'}", styles["Normal"]),
        Paragraph(f"Job Title: {staff.job_title or 'N/A'}", styles["Normal"]),
        Spacer(1, 16),
    ]

    salary_table = Table(
        [
            ["Basic Salary", f"{salary_record.base_salary}"],
            ["Working Days in Month", summary["total_working_days"]],
            ["Days Present", summary["days_present"]],
            ["Days Absent", summary["days_absent"]],
            ["Calculated Salary", f"{salary_record.calculated_salary}"],
            ["Final Approved Salary", f"{salary_record.final_salary}"],
        ],
        colWidths=[220, 220],
    )
    salary_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, -1), (-1, -1), 13),
                ("BACKGROUND", (0, -1), (-1, -1), colors.whitesmoke),
                ("PADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    elements.extend(
        [
            salary_table,
            Spacer(1, 24),
            Paragraph("This is a computer generated document", styles["Italic"]),
        ]
    )

    document.build(elements)
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"attachment; filename=salary_slip_{staff.employee_id}_{month}_{year}.pdf"
            )
        },
    )


@router.get("/attendance/summary/{user_id}")
def get_attendance_summary(
    user_id: str,
    month: int,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = get_staff_for_attendance(user_id, current_user, db)
    return build_attendance_summary(user, month, year, db)


@router.get("/attendance/salary/{user_id}")
def get_salary_calculation(
    user_id: str,
    month: int,
    year: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    user = get_staff_for_attendance(user_id, current_user, db)
    summary = build_attendance_summary(user, month, year, db)
    calculated_salary = calculate_monthly_salary(user, summary, db)
    salary_record = (
        db.query(SalaryRecord)
        .filter(
            SalaryRecord.user_id == user.id,
            SalaryRecord.month == month,
            SalaryRecord.year == year,
        )
        .first()
    )

    return {
        "user_id": str(user.id),
        "full_name": user.full_name,
        "month": month,
        "year": year,
        "base_salary": user.base_salary or Decimal("0"),
        "total_working_days": summary["total_working_days"],
        "days_present": summary["days_present"],
        "calculated_salary": calculated_salary,
        "is_approved": salary_record.is_approved if salary_record else False,
        "approved_by": str(salary_record.approved_by) if salary_record else None,
        "approved_at": format_utc_datetime(salary_record.approved_at)
        if salary_record
        else None,
    }


@router.post("/attendance/salary/{user_id}/approve")
def approve_salary(
    user_id: str,
    month: int,
    year: int,
    approval_data: SalaryApprovalRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_super_admin(current_user)
    user = get_staff_for_attendance(user_id, current_user, db)
    summary = build_attendance_summary(user, month, year, db)
    calculated_salary = calculate_monthly_salary(user, summary, db)
    final_salary = approval_data.final_salary.quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )

    salary_record = (
        db.query(SalaryRecord)
        .filter(
            SalaryRecord.user_id == user.id,
            SalaryRecord.month == month,
            SalaryRecord.year == year,
        )
        .first()
    )

    if not salary_record:
        salary_record = SalaryRecord(
            company_id=user.company_id,
            user_id=user.id,
            month=month,
            year=year,
        )
        db.add(salary_record)

    salary_record.base_salary = user.base_salary or Decimal("0")
    salary_record.calculated_salary = calculated_salary
    salary_record.final_salary = final_salary
    salary_record.is_approved = True
    salary_record.approved_by = current_user.id
    salary_record.approved_at = datetime.utcnow()
    db.commit()

    return {
        "message": "Salary approved",
        "final_salary": final_salary,
    }

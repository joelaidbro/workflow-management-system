import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api.js";
import { playActionSound } from "../utils/sounds";
import {
  formatDate,
  formatDateTime,
  formatTime,
  minutesToHours,
} from "../utils/dateUtils";

import {
  TeamStatusPanel,
  StaffManagementPanel,
  StaffProfileModal,
  ChatPanel,
  LogoDisplay,
  MyDayPanel,
  TASK_STATUS_COLORS,
} from "./AdminDashboard.jsx";

// ─── My Profile Panel ────────────────────────────────────────────────────────

function MyProfilePanel() {
  const user = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState({ visible: false, day: null, x: 0, y: 0 });

  useEffect(() => {
    if (!user?.id && !user?.user_id) return;
    const userId = user.user_id || user.id;
    const fetchSummary = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/api/attendance/summary/${userId}`, {
          params: { month: currentMonth, year: currentYear },
        });
        setSummary(response.data);
      } catch {
        toast.error("Could not load profile");
      } finally {
        setLoading(false);
      }
    };
    fetchSummary();
  }, []);

  const calendarDays = useMemo(() => {
    const recordsByDate = new Map(
      (summary?.attendance_records || []).map((record) => [record.date, record])
    );
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const leadingBlankDays = (new Date(currentYear, currentMonth - 1, 1).getDay() + 6) % 7;
    return [
      ...Array.from({ length: leadingBlankDays }, (_, index) => ({ blank: true, id: `blank-${index}` })),
      ...Array.from({ length: daysInMonth }, (_, index) => {
        const day = index + 1;
        const date = new Date(currentYear, currentMonth - 1, day);
        const dateKey = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const record = recordsByDate.get(dateKey);
        const defaultWorkingDays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
        const workingDays = summary?.working_days || defaultWorkingDays;
        const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        const isWeekend = !workingDays.includes(dayNames[date.getDay()]);
        const publicHolidayDates = new Set((summary?.public_holidays || []).map((h) => h.date));
        const isPublicHoliday = publicHolidayDates.has(dateKey);
        let dotClass = "bg-red-500";
        if (isPublicHoliday && !record) {
          dotClass = "bg-amber-400";
        } else if (isWeekend && !record) {
          dotClass = "bg-gray-400";
        } else if (record?.work_mode === "leave") {
          dotClass = "bg-blue-500";
        } else if (record?.is_present) {
          dotClass = "bg-green-500";
        }
        return {
          day,
          date: dateKey,
          dotClass,
          record,
          work_mode: record?.work_mode || (isPublicHoliday ? "holiday" : (isWeekend ? "weekend" : "office")),
          working_minutes: record?.working_minutes || 0,
          break_minutes: record?.break_minutes || 0,
          idle_minutes: record?.idle_minutes || 0,
          login_time: record?.login_time || null,
          logout_time: record?.logout_time || null,
        };
      }),
    ];
  }, [currentYear, currentMonth, summary]);

  if (loading) {
    return <div className="py-12 text-center text-gray-500">Loading profile...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4">
          <h3 className="text-2xl font-bold text-gray-900">{summary?.full_name || user?.full_name || "My Profile"}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {summary?.employee_id || "N/A"} · {summary?.department || "No department"}
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div>
              <span className="text-gray-500">Employee ID</span>
              <div className="font-semibold text-gray-900">{summary?.employee_id || "N/A"}</div>
            </div>
            <div>
              <span className="text-gray-500">Department</span>
              <div className="font-semibold text-gray-900">{summary?.department || "N/A"}</div>
            </div>
            <div>
              <span className="text-gray-500">Job Title</span>
              <div className="font-semibold text-gray-900">{summary?.job_title || "N/A"}</div>
            </div>
            <div>
              <span className="text-gray-500">Work Type</span>
              <div className="mt-1">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${summary?.work_type === "wfh" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                  {summary?.work_type === "wfh" ? "WFH" : "Office"}
                </span>
              </div>
            </div>
            <div>
              <span className="text-gray-500">Email</span>
              <div className="font-semibold text-gray-900">{summary?.email || "N/A"}</div>
            </div>
            <div>
              <span className="text-gray-500">Phone</span>
              <div className="font-semibold text-gray-900">{summary?.phone || "N/A"}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
          <div className="rounded-xl bg-green-50 p-4">
            <div className="text-green-700">Days Present</div>
            <div className="mt-1 text-2xl font-bold text-green-900">{summary?.days_present || 0}</div>
          </div>
          <div className="rounded-xl bg-red-50 p-4">
            <div className="text-red-700">Days Absent</div>
            <div className="mt-1 text-2xl font-bold text-red-900">{summary?.days_absent || 0}</div>
          </div>
          <div className="rounded-xl bg-blue-50 p-4">
            <div className="text-blue-700">Working Hours</div>
            <div className="mt-1 text-2xl font-bold text-blue-900">{minutesToHours(summary?.total_working_minutes || 0)}</div>
          </div>
          <div className="rounded-xl bg-orange-50 p-4">
            <div className="text-orange-700">Break Time</div>
            <div className="mt-1 text-2xl font-bold text-orange-900">{minutesToHours(summary?.total_break_minutes || 0)}</div>
          </div>
          <div className="rounded-xl bg-yellow-50 p-4">
            <div className="text-yellow-700">Idle Time</div>
            <div className="mt-1 text-2xl font-bold text-yellow-900">{minutesToHours(summary?.total_idle_minutes || 0)}</div>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-bold text-gray-900">Attendance Calendar</h4>
            <div className="flex gap-3 text-xs text-gray-500">
              <span>Green present</span>
              <span>Red absent</span>
              <span>Blue leave</span>
              <span>Gray weekend</span>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold uppercase text-gray-500">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-2 rounded-xl bg-gray-50 p-4">
            {calendarDays.map((item) =>
              item.blank ? (
                <div key={item.id} className="h-12" />
              ) : (
                <div key={item.day} className="flex flex-col items-center gap-1 rounded-lg bg-white p-2 text-xs text-gray-600">
                  <span>{item.day}</span>
                  <span
                    className={`h-3 w-3 cursor-pointer rounded-full ${item.dotClass}`}
                    onMouseEnter={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setTooltip({ visible: true, day: item, x: rect.left, y: rect.top });
                    }}
                    onMouseLeave={() => setTooltip({ visible: false, day: null, x: 0, y: 0 })}
                  />
                </div>
              )
            )}
          </div>
          {tooltip.visible && tooltip.day && (
            <div
              className="pointer-events-none fixed z-50 rounded-lg bg-gray-900 p-3 text-xs text-white shadow-xl"
              style={{ left: tooltip.x + 10, top: tooltip.y - 80 }}
            >
              <div className="mb-1 font-bold">{formatDate(tooltip.day.date)}</div>
              <div>🕐 Working: {minutesToHours(tooltip.day.working_minutes)}</div>
              <div>☕ Break: {minutesToHours(tooltip.day.break_minutes)}</div>
              <div>💤 Idle: {minutesToHours(tooltip.day.idle_minutes)}</div>
              <div>🔵 Mode: {tooltip.day.work_mode || "Office"}</div>
              {tooltip.day.login_time && <div>⏰ Login: {formatTime(tooltip.day.login_time)}</div>}
              {tooltip.day.logout_time && <div>⏰ Logout: {formatTime(tooltip.day.logout_time)}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Admin Reports Panel (dual-tab) ──────────────────────────────────────────

function MyReportsTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetch = async () => {
      setLoading(true);
      try {
        const response = await api.get("/api/attendance/reports/my-reports", {
          params: { month, year },
        });
        if (isMounted) setReports(response.data);
      } catch {
        if (isMounted) toast.error("Could not load reports");
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetch();
    return () => { isMounted = false; };
  }, [month, year]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-600">Month</label>
          <input
            type="number"
            min="1"
            max="12"
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value, 10) || 1)}
            className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-600">Year</label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value, 10) || now.getFullYear())}
            className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center text-gray-500">Loading reports...</div>
      ) : reports.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500">
          No reports found for this period
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <div key={report.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="font-bold text-gray-900">{formatDate(report.report_date)}</div>
                <div className="text-sm text-gray-500">{formatTime(report.submitted_at)}</div>
              </div>
              <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm leading-6 text-gray-800">
                {report.content}
              </div>
              {report.admin_reply && (
                <div className="mt-4 rounded-lg bg-blue-50 p-4">
                  <div className="text-sm font-semibold text-blue-900">Reply received:</div>
                  <p className="mt-2 text-sm leading-6 text-blue-900">{report.admin_reply}</p>
                  {report.admin_reply_at && (
                    <p className="mt-2 text-xs text-blue-600">{formatDateTime(report.admin_reply_at)}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamReportsTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [replyText, setReplyText] = useState({});
  const [replyErrors, setReplyErrors] = useState({});
  const [submittingReplyId, setSubmittingReplyId] = useState(null);
  const [unreadDates, setUnreadDates] = useState([]);

  useEffect(() => {
    api.get("/api/attendance/reports/unread-dates")
      .then((res) => setUnreadDates(res.data.dates))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let isMounted = true;
    const fetchReports = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await api.get("/api/attendance/reports/team", {
          params: { date: selectedDate, unread_only: unreadOnly },
        });
        if (isMounted) {
          setReports(response.data);
          setUnreadDates((prev) => prev.filter((d) => d !== selectedDate));
        }
      } catch {
        if (isMounted) setError("Could not load reports.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchReports();
    return () => { isMounted = false; };
  }, [selectedDate, unreadOnly]);

  const handleReplySubmit = async (reportId) => {
    const reply = (replyText[reportId] || "").trim();
    if (!reply) {
      setReplyErrors((c) => ({ ...c, [reportId]: "Reply cannot be empty" }));
      return;
    }
    setSubmittingReplyId(reportId);
    setReplyErrors((c) => ({ ...c, [reportId]: "" }));
    try {
      await api.post(`/api/attendance/reports/${reportId}/reply`, { reply });
      setReports((r) => r.map((rep) => rep.id === reportId ? { ...rep, admin_reply: reply, is_read_by_admin: true } : rep));
      setReplyText((c) => ({ ...c, [reportId]: "" }));
    } catch {
      setReplyErrors((c) => ({ ...c, [reportId]: "Could not submit reply" }));
    } finally {
      setSubmittingReplyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-600">Report date</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setUnreadOnly((c) => !c)}
          className={`mt-6 rounded-lg px-4 py-2 text-sm font-semibold transition ${unreadOnly ? "bg-blue-700 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
        >
          Unread Only
        </button>
        {unreadDates.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {unreadDates.map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${selectedDate === date ? "border-blue-700 bg-blue-700 text-white" : "border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50"}`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                {date}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="text-sm font-medium text-red-600">{error}</div>}

      {loading ? (
        <div className="flex min-h-64 items-center justify-center text-gray-500">Loading reports...</div>
      ) : reports.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500">
          No reports found for this date
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <div key={report.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-900">{report.full_name}</h3>
                    {!report.is_read_by_admin && (
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">New</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{report.employee_id || "No employee ID"}</p>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <div>{formatDate(report.report_date)}</div>
                  <div>{formatTime(report.submitted_at)}</div>
                </div>
              </div>
              <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm leading-6 text-gray-800">{report.content}</div>
              {report.admin_reply ? (
                <div className="mt-4 rounded-lg bg-blue-50 p-4">
                  <div className="text-sm font-semibold text-blue-900">Your reply:</div>
                  <p className="mt-2 text-sm leading-6 text-blue-900">{report.admin_reply}</p>
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  <textarea
                    value={replyText[report.id] || ""}
                    onChange={(e) => setReplyText((c) => ({ ...c, [report.id]: e.target.value }))}
                    placeholder="Type a reply..."
                    className="min-h-20 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                  />
                  {replyErrors[report.id] && (
                    <div className="text-sm text-red-600">{replyErrors[report.id]}</div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleReplySubmit(report.id)}
                    disabled={submittingReplyId === report.id}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submittingReplyId === report.id ? "Replying..." : "Send Reply"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminReportsPanel() {
  const [activeTab, setActiveTab] = useState("team");

  return (
    <div className="space-y-5">
      <div className="flex gap-2 rounded-xl border border-gray-200 bg-white p-2">
        <button
          type="button"
          onClick={() => setActiveTab("team")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === "team" ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          Team Reports
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("my")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === "my" ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          My Reports
        </button>
      </div>
      {activeTab === "team" ? <TeamReportsTab /> : <MyReportsTab />}
    </div>
  );
}

// ─── Admin Leave Panel (dual-tab) ────────────────────────────────────────────

function MyLeaveTab() {
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [showForm, setShowForm] = useState(false);

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [configuredLeaveTypes, setConfiguredLeaveTypes] = useState([]);

  const fetchRequests = async () => {
    try {
      const response = await api.get("/api/leave/my-requests");
      setRequests(response.data);
    } catch {
      toast.error("Could not load leave requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    api.patch("/api/leave/mark-read").catch(() => {});
    api.get("/api/leave/types")
      .then((res) => setConfiguredLeaveTypes(res.data || []))
      .catch(() => {});
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitError("");
    if (!leaveType.trim()) { setSubmitError("Leave type is required"); return; }
    if (!startDate) { setSubmitError("Start date is required"); return; }
    if (!endDate) { setSubmitError("End date is required"); return; }

    setSubmitting(true);
    try {
      await api.post("/api/leave/request", {
        leave_type: leaveType.trim(),
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim() || null,
      });
      toast.success("Leave request submitted");
      setLeaveType("");
      setStartDate("");
      setEndDate("");
      setReason("");
      setShowForm(false);
      fetchRequests();
    } catch (err) {
      setSubmitError(err.response?.data?.detail || "Could not submit request");
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadgeClasses = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowForm((c) => !c)}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
        >
          {showForm ? "Cancel" : "+ New Leave Request"}
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-5 text-lg font-bold text-gray-900">Submit Leave Request</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Leave Type</label>
              {configuredLeaveTypes.length > 0 ? (
                <select
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">Select leave type</option>
                  {configuredLeaveTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              ) : (
                <select
                  disabled
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-400"
                >
                  <option>No leave types configured</option>
                </select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Reason (optional)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Briefly describe the reason..."
                className="min-h-24 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
              />
            </div>
            {submitError && <div className="text-sm font-medium text-red-600">{submitError}</div>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-64 items-center justify-center text-gray-500">Loading...</div>
      ) : requests.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500">
          No leave requests found
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <div key={request.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-bold text-gray-900">{request.leave_type}</div>
                  <div className="mt-1 text-sm text-gray-500">
                    {formatDate(request.start_date)} → {formatDate(request.end_date)} · {request.total_days} days
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClasses[request.status] || statusBadgeClasses.pending}`}>
                  {request.status}
                </span>
              </div>
              {request.reason && (
                <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{request.reason}</div>
              )}
              {request.admin_comment && (
                <div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                  <span className="font-semibold">Comment: </span>{request.admin_comment}
                </div>
              )}
              {request.reviewed_at && (
                <div className="mt-2 text-xs text-gray-500">Reviewed {formatDateTime(request.reviewed_at)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamLeaveTab() {
  const [activeStatus, setActiveStatus] = useState("pending");
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewingRequest, setReviewingRequest] = useState(null);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const fetchLeaveRequests = async (status) => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/api/leave/team-requests", { params: { status } });
      setLeaveRequests(response.data);
    } catch {
      setError("Could not load leave requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLeaveRequests(activeStatus); }, [activeStatus]);

  const handleReviewSubmit = async () => {
    if (!reviewingRequest) return;
    setSubmittingReview(true);
    try {
      await api.post(`/api/leave/requests/${reviewingRequest.requestId}/review`, {
        decision: reviewingRequest.decision,
        comment: reviewComment || null,
      });
      setLeaveRequests((c) => c.filter((r) => r.id !== reviewingRequest.requestId));
      toast.success(`Leave request ${reviewingRequest.decision}`);
      setReviewingRequest(null);
      setReviewComment("");
    } catch {
      setError("Could not submit review.");
    } finally {
      setSubmittingReview(false);
    }
  };

  const tabs = [
    { id: "pending", label: "Pending" },
    { id: "approved", label: "Approved" },
    { id: "rejected", label: "Rejected" },
  ];

  const statusBadgeClasses = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-5">
      <div className="flex gap-2 rounded-xl border border-gray-200 bg-white p-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveStatus(tab.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeStatus === tab.id ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-100"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="text-sm font-medium text-red-600">{error}</div>}

      {loading ? (
        <div className="flex min-h-64 items-center justify-center text-gray-500">Loading leave requests...</div>
      ) : leaveRequests.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500">
          No leave requests found
        </div>
      ) : (
        <div className="space-y-4">
          {leaveRequests.map((request) => {
            const isReviewing = reviewingRequest?.requestId === request.id;
            return (
              <div key={request.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-bold text-gray-900">{request.full_name}</div>
                    <div className="mt-1 text-sm text-gray-500">{request.employee_id || "No employee ID"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">{request.leave_type}</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClasses[request.status]}`}>{request.status}</span>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Date range</span>
                    <div className="mt-1 font-medium text-gray-900">{formatDate(request.start_date)} → {formatDate(request.end_date)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Total days</span>
                    <div className="mt-1 font-medium text-gray-900">{request.total_days} days</div>
                  </div>
                </div>
                {request.reason && (
                  <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">{request.reason}</div>
                )}
                {request.status === "pending" ? (
                  <div className="mt-5">
                    {!isReviewing ? (
                      <div className="flex gap-3">
                        <button type="button" onClick={() => { setReviewingRequest({ requestId: request.id, decision: "approved" }); setReviewComment(""); }} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">Approve</button>
                        <button type="button" onClick={() => { setReviewingRequest({ requestId: request.id, decision: "rejected" }); setReviewComment(""); }} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Reject</button>
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-lg bg-gray-50 p-4">
                        <textarea
                          value={reviewComment}
                          onChange={(e) => setReviewComment(e.target.value)}
                          placeholder="Optional comment..."
                          className="min-h-24 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                        />
                        <div className="flex gap-3">
                          <button type="button" onClick={handleReviewSubmit} disabled={submittingReview} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-70">
                            {submittingReview ? "Submitting..." : `Confirm ${reviewingRequest.decision}`}
                          </button>
                          <button type="button" onClick={() => setReviewingRequest(null)} className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  request.admin_comment && (
                    <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                      <span className="font-semibold">Comment:</span> {request.admin_comment}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PublicHolidaysReadonlyTab() {
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/api/settings/public-holidays")
      .then((res) => setHolidays(res.data || []))
      .catch(() => toast.error("Could not load public holidays"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex min-h-40 items-center justify-center text-gray-500">Loading holidays...</div>;
  }
  if (holidays.length === 0) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500">
        No public holidays configured
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {holidays.map((holiday) => (
        <div key={holiday.date} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div>
            <div className="font-semibold text-gray-900">{holiday.name}</div>
            <div className="mt-1 text-sm text-gray-500">{holiday.date}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminLeavePanel() {
  const [activeTab, setActiveTab] = useState("team");

  const tabs = [
    { id: "team", label: "Team Requests" },
    { id: "my", label: "My Requests" },
    { id: "holidays", label: "Public Holidays" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex gap-2 rounded-xl border border-gray-200 bg-white p-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === tab.id ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-100"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === "team" ? <TeamLeaveTab /> : activeTab === "my" ? <MyLeaveTab /> : <PublicHolidaysReadonlyTab />}
    </div>
  );
}

// ─── Admin Alerts Panel (dual-tab) ───────────────────────────────────────────

function SentAlertsTab() {
  const [alertType, setAlertType] = useState("info");
  const [recipientId, setRecipientId] = useState("");
  const [message, setMessage] = useState("");
  const [staffList, setStaffList] = useState([]);
  const [sentAlerts, setSentAlerts] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [loadingSentAlerts, setLoadingSentAlerts] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [deliveryReport, setDeliveryReport] = useState(null);
  const [loadingReportId, setLoadingReportId] = useState(null);

  useEffect(() => {
    let isMounted = true;
    api.get("/api/alerts/potential-recipients")
      .then((res) => { if (isMounted) setStaffList(res.data); })
      .catch(() => { if (isMounted) setError("Could not load recipient list."); })
      .finally(() => { if (isMounted) setLoadingStaff(false); });
    return () => { isMounted = false; };
  }, []);

  const fetchSentAlerts = async () => {
    try {
      const response = await api.get("/api/alerts/sent");
      setSentAlerts(response.data);
    } catch {
      toast.error("Could not load sent alerts");
    } finally {
      setLoadingSentAlerts(false);
    }
  };

  useEffect(() => {
    fetchSentAlerts();
    const interval = setInterval(fetchSentAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleViewDeliveryReport = async (alertId) => {
    setLoadingReportId(alertId);
    try {
      const response = await api.get(`/api/alerts/delivery-report/${alertId}`);
      setDeliveryReport(response.data);
      setSentAlerts((prev) => prev.map((a) => a.id === alertId ? { ...a, has_unread_replies: false } : a));
    } catch {
      toast.error("Could not load delivery report");
    } finally {
      setLoadingReportId(null);
    }
  };

  const handleSendAlert = async (event) => {
    event.preventDefault();
    const cleanMessage = message.trim();
    if (!cleanMessage) { setError("Message cannot be empty."); return; }
    setSending(true);
    setError("");
    try {
      const response = await api.post("/api/alerts/send", {
        alert_type: alertType,
        message: cleanMessage,
        recipient_id: recipientId || null,
      });
      toast.success(`Alert sent to ${response.data.recipient_count} recipients`);
      setAlertType("info");
      setRecipientId("");
      setMessage("");
      fetchSentAlerts();
    } catch {
      setError("Could not send alert.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2">
        <h3 className="text-xl font-bold text-gray-900">Send Alert</h3>
        <form onSubmit={handleSendAlert} className="mt-6 space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Alert type</label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setAlertType("info")} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${alertType === "info" ? "bg-blue-700 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>Info</button>
              <button type="button" onClick={() => setAlertType("urgent")} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${alertType === "urgent" ? "bg-red-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>Urgent</button>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Recipient</label>
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              disabled={loadingStaff}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
            >
              <option value="">Broadcast to all team</option>
              {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 500))}
              placeholder="Type your message here..."
              className="min-h-40 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
            />
            <div className="mt-1 text-right text-xs text-gray-500">{message.length}/500</div>
          </div>
          {error && <div className="text-sm font-medium text-red-600">{error}</div>}
          <button
            type="submit"
            disabled={sending}
            className={`w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-70 ${alertType === "urgent" ? "bg-red-600 hover:bg-red-700" : "bg-blue-700 hover:bg-blue-800"}`}
          >
            {sending ? "Sending..." : "Send Alert"}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-3">
        <h3 className="text-xl font-bold text-gray-900">Sent Alerts</h3>
        <div className="mt-6 space-y-4">
          {loadingSentAlerts ? (
            <div className="flex min-h-64 items-center justify-center text-gray-500">Loading sent alerts...</div>
          ) : sentAlerts.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center text-gray-500">No alerts sent yet</div>
          ) : (
            sentAlerts.map((alert) => {
              const progress = alert.total_recipients > 0 ? Math.round((alert.acknowledged_count / alert.total_recipients) * 100) : 0;
              return (
                <div key={alert.id} className={`rounded-xl border p-4 ${alert.has_unread_replies ? "border-red-300 bg-red-50/40" : "border-gray-200"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${alert.alert_type === "urgent" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                          {alert.alert_type === "urgent" ? "URGENT" : "INFO"}
                        </span>
                        {alert.has_unread_replies && (
                          <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">New replies</span>
                        )}
                        <span className="text-xs text-gray-500">{formatDateTime(alert.created_at)}</span>
                      </div>
                      <p className="mt-3 text-sm font-medium text-gray-900">{alert.message}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleViewDeliveryReport(alert.id)}
                      disabled={loadingReportId === alert.id}
                      className="shrink-0 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-70"
                    >
                      {loadingReportId === alert.id ? "Loading..." : "View Report"}
                    </button>
                  </div>
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">{alert.acknowledged_count}/{alert.total_recipients} acknowledged</span>
                      {alert.pending_count > 0 && <span className="font-medium text-orange-600">{alert.pending_count} pending</span>}
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
                      <div className="h-full rounded-full bg-green-500" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {deliveryReport && (
        <div className="fixed inset-0 z-50 col-span-5 flex items-center justify-center bg-black/50 px-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Delivery Report</h3>
                <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-800 border border-gray-100">
                  {deliveryReport.message}
                </div>
              </div>
              <button type="button" onClick={() => setDeliveryReport(null)} className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200">Close</button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-lg bg-gray-50 p-3"><div className="font-bold text-gray-900">{deliveryReport.total_recipients}</div><div className="text-gray-500">Recipients</div></div>
              <div className="rounded-lg bg-green-50 p-3"><div className="font-bold text-green-700">{deliveryReport.acknowledged_count}</div><div className="text-green-700">Acknowledged</div></div>
              <div className="rounded-lg bg-orange-50 p-3"><div className="font-bold text-orange-700">{deliveryReport.pending_count}</div><div className="text-orange-700">Pending</div></div>
            </div>
            <div className="mt-6">
              <h4 className="text-sm font-bold text-gray-700 mb-2">Recipients</h4>
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 max-h-60 overflow-y-auto">
                {deliveryReport.recipients.map((recipient) => (
                  <div key={recipient.recipient_id} className="flex items-start justify-between gap-4 p-4 text-sm">
                    <div>
                      <div className="font-semibold text-gray-900">{recipient.full_name}</div>
                      {recipient.reply && <div className="mt-2 rounded-lg bg-gray-50 p-2 text-gray-700">{recipient.reply}</div>}
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${recipient.status === "acknowledged" ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>{recipient.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReceivedAlertsTab() {
  const [pendingAlerts, setPendingAlerts] = useState([]);
  const [historyAlerts, setHistoryAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState(null);
  const [replyText, setReplyText] = useState({});
  const [view, setView] = useState("pending");

  const fetchAlerts = async () => {
    try {
      const [pendingRes, historyRes] = await Promise.all([
        api.get("/api/alerts/my-pending"),
        api.get("/api/alerts/my-history"),
      ]);
      setPendingAlerts(pendingRes.data);
      setHistoryAlerts(historyRes.data);
    } catch {
      toast.error("Could not load alerts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleAcknowledge = async (alertRecipientId) => {
    const reply = (replyText[alertRecipientId] || "").trim();
    setAcknowledging(alertRecipientId);
    try {
      await api.post(`/api/alerts/my-acknowledge/${alertRecipientId}`, { reply: reply || null });
      toast.success("Alert acknowledged");
      setReplyText((c) => ({ ...c, [alertRecipientId]: "" }));
      fetchAlerts();
    } catch {
      toast.error("Could not acknowledge alert");
    } finally {
      setAcknowledging(null);
    }
  };

  const currentAlerts = view === "pending" ? pendingAlerts : historyAlerts;

  return (
    <div className="space-y-5">
      <div className="flex gap-2 rounded-xl border border-gray-200 bg-white p-2">
        <button
          type="button"
          onClick={() => setView("pending")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${view === "pending" ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          Pending
          {pendingAlerts.length > 0 && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{pendingAlerts.length}</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setView("history")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${view === "history" ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          History
        </button>
      </div>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center text-gray-500">Loading alerts...</div>
      ) : currentAlerts.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500">
          No {view === "pending" ? "pending" : ""} alerts
        </div>
      ) : (
        <div className="space-y-4">
          {currentAlerts.map((alert) => (
            <div
              key={alert.alert_recipient_id}
              className={`rounded-xl border p-5 shadow-sm ${alert.alert_type === "urgent" ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${alert.alert_type === "urgent" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                      {alert.alert_type === "urgent" ? "URGENT" : "INFO"}
                    </span>
                    <span className="text-sm text-gray-500">from {alert.sender_name}</span>
                  </div>
                  <p className="mt-3 text-sm font-medium text-gray-900">{alert.message}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-gray-500">{formatDateTime(alert.created_at)}</div>
              </div>

              {alert.reply && (
                <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                  <span className="font-semibold">Your reply: </span>{alert.reply}
                </div>
              )}

              {alert.status === "pending" && (
                <div className="mt-4 space-y-3">
                  <textarea
                    value={replyText[alert.alert_recipient_id] || ""}
                    onChange={(e) => setReplyText((c) => ({ ...c, [alert.alert_recipient_id]: e.target.value }))}
                    placeholder="Optional reply..."
                    className="min-h-20 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                  />
                  <button
                    type="button"
                    onClick={() => handleAcknowledge(alert.alert_recipient_id)}
                    disabled={acknowledging === alert.alert_recipient_id}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-70"
                  >
                    {acknowledging === alert.alert_recipient_id ? "Acknowledging..." : "Acknowledge"}
                  </button>
                </div>
              )}

              {alert.status === "acknowledged" && (
                <div className="mt-3 text-xs text-gray-500">
                  Acknowledged {alert.acknowledged_at ? formatDateTime(alert.acknowledged_at) : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminAlertsPanel() {
  const [activeTab, setActiveTab] = useState("sent");

  return (
    <div className="space-y-5">
      <div className="flex gap-2 rounded-xl border border-gray-200 bg-white p-2">
        <button
          type="button"
          onClick={() => setActiveTab("sent")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === "sent" ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          Sent
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("received")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === "received" ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          Received
        </button>
      </div>
      {activeTab === "sent" ? <SentAlertsTab /> : <ReceivedAlertsTab />}
    </div>
  );
}

// ─── Admin Tasks Panel (dual-tab) ─────────────────────────────────────────────

function MyTasksTab() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [updatingStatusId, setUpdatingStatusId] = useState(null);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const response = await api.get("/api/tasks/my-tasks", { params });
      setTasks(response.data);
    } catch {
      toast.error("Could not load tasks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTasks(); }, [statusFilter]);

  const handleStatusChange = async (taskId, newStatus) => {
    setUpdatingStatusId(taskId);
    try {
      const response = await api.patch(`/api/tasks/${taskId}/status`, { status: newStatus });
      setTasks((prev) => prev.map((t) => t.id === taskId ? response.data.task : t));
    } catch {
      toast.error("Could not update status");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
        </select>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No tasks assigned to you.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Task</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Assigned By</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Due Date</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <div className="font-medium text-gray-900">{task.title}</div>
                      <div className="mt-0.5 max-w-xs truncate text-xs text-gray-500">{task.description}</div>
                    </td>
                    <td className="px-5 py-4 text-gray-700">{task.assigned_by_name}</td>
                    <td className="px-5 py-4">
                      <select
                        value={task.status}
                        disabled={updatingStatusId === task.id}
                        onChange={(e) => handleStatusChange(task.id, e.target.value)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold cursor-pointer border-0 focus:outline-none ${TASK_STATUS_COLORS[task.status]}`}
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                      </select>
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      {task.due_date ? formatDate(task.due_date) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-4 text-gray-500">{formatDate(task.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TeamTasksTab() {
  const [tasks, setTasks] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignForm, setAssignForm] = useState({ title: "", description: "", assigned_to: "", due_date: "" });
  const [assignError, setAssignError] = useState("");
  const [submittingAssign, setSubmittingAssign] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", due_date: "" });
  const [editError, setEditError] = useState("");
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (assigneeFilter) params.assigned_to = assigneeFilter;
      const response = await api.get("/api/tasks/", { params });
      setTasks(response.data);
    } catch {
      toast.error("Could not load tasks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.get("/api/users/list")
      .then((res) => setStaffList(res.data.filter((u) => u.role === "staff")))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchTasks(); }, [statusFilter, assigneeFilter]);

  const handleAssignSubmit = async () => {
    if (!assignForm.title.trim()) { setAssignError("Title is required"); return; }
    if (!assignForm.description.trim()) { setAssignError("Description is required"); return; }
    if (!assignForm.assigned_to) { setAssignError("Please select a staff member"); return; }
    setSubmittingAssign(true);
    setAssignError("");
    try {
      await api.post("/api/tasks/", {
        title: assignForm.title.trim(),
        description: assignForm.description.trim(),
        assigned_to: assignForm.assigned_to,
        due_date: assignForm.due_date || null,
      });
      toast.success("Task assigned successfully");
      setShowAssignModal(false);
      setAssignForm({ title: "", description: "", assigned_to: "", due_date: "" });
      fetchTasks();
    } catch (err) {
      setAssignError(err.response?.data?.detail || "Could not assign task");
    } finally {
      setSubmittingAssign(false);
    }
  };

  const handleEditSubmit = async () => {
    if (!editForm.title.trim()) { setEditError("Title is required"); return; }
    if (!editForm.description.trim()) { setEditError("Description is required"); return; }
    setSubmittingEdit(true);
    setEditError("");
    try {
      await api.patch(`/api/tasks/${editTask.id}`, {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        due_date: editForm.due_date || null,
        clear_due_date: !editForm.due_date,
      });
      toast.success("Task updated");
      setEditTask(null);
      fetchTasks();
    } catch (err) {
      setEditError(err.response?.data?.detail || "Could not update task");
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleDelete = async (taskId) => {
    setDeletingId(taskId);
    try {
      await api.delete(`/api/tasks/${taskId}`);
      toast.success("Task deleted");
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch {
      toast.error("Could not delete task");
    } finally {
      setDeletingId(null);
    }
  };

  const handleStatusChange = async (taskId, newStatus) => {
    setUpdatingStatusId(taskId);
    try {
      const response = await api.patch(`/api/tasks/${taskId}/status`, { status: newStatus });
      setTasks((prev) => prev.map((t) => t.id === taskId ? response.data.task : t));
    } catch {
      toast.error("Could not update status");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
            <option value="">All Staff</option>
            {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        <button type="button" onClick={() => { setAssignForm({ title: "", description: "", assigned_to: "", due_date: "" }); setAssignError(""); setShowAssignModal(true); }} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
          + Assign Task
        </button>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No tasks found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Task</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Assigned To</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Due Date</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Assigned By</th>
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tasks.map((task) => (
                  <tr key={task.id} className="hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <div className="font-medium text-gray-900">{task.title}</div>
                      <div className="mt-0.5 max-w-xs truncate text-xs text-gray-500">{task.description}</div>
                    </td>
                    <td className="px-5 py-4 text-gray-700">
                      <div>{task.assigned_to_name}</div>
                      <div className="text-xs text-gray-400">{task.assigned_to_employee_id}</div>
                    </td>
                    <td className="px-5 py-4">
                      <select
                        value={task.status}
                        disabled={updatingStatusId === task.id}
                        onChange={(e) => handleStatusChange(task.id, e.target.value)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold cursor-pointer border-0 focus:outline-none ${TASK_STATUS_COLORS[task.status]}`}
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                      </select>
                    </td>
                    <td className="px-5 py-4 text-gray-600">{task.due_date ? formatDate(task.due_date) : <span className="text-gray-400">—</span>}</td>
                    <td className="px-5 py-4 text-gray-600">{task.assigned_by_name}</td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setEditTask(task); setEditForm({ title: task.title, description: task.description, due_date: task.due_date || "" }); setEditError(""); }} className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200">Edit</button>
                        <button type="button" onClick={() => handleDelete(task.id)} disabled={deletingId === task.id} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-60">{deletingId === task.id ? "..." : "Delete"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-gray-900">Assign New Task</h2>
            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Assign To</label>
                <select value={assignForm.assigned_to} onChange={(e) => setAssignForm((f) => ({ ...f, assigned_to: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                  <option value="">Select staff member...</option>
                  {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.employee_id})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Task Title</label>
                <input type="text" value={assignForm.title} onChange={(e) => setAssignForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Prepare monthly report" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea value={assignForm.description} onChange={(e) => setAssignForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe what needs to be done..." className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Due Date <span className="text-gray-400">(optional)</span></label>
                <input type="date" value={assignForm.due_date} onChange={(e) => setAssignForm((f) => ({ ...f, due_date: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              {assignError && <p className="text-sm text-red-600">{assignError}</p>}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowAssignModal(false)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200">Cancel</button>
              <button type="button" onClick={handleAssignSubmit} disabled={submittingAssign} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">{submittingAssign ? "Assigning..." : "Assign Task"}</button>
            </div>
          </div>
        </div>
      )}

      {editTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-gray-900">Edit Task</h2>
            <p className="mt-1 text-sm text-gray-500">Assigned to: <span className="font-medium">{editTask.assigned_to_name}</span></p>
            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Task Title</label>
                <input type="text" value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Due Date <span className="text-gray-400">(optional)</span></label>
                <input type="date" value={editForm.due_date} onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                {editForm.due_date && <button type="button" onClick={() => setEditForm((f) => ({ ...f, due_date: "" }))} className="mt-1 text-xs text-gray-400 hover:text-red-500">Clear due date</button>}
              </div>
              {editError && <p className="text-sm text-red-600">{editError}</p>}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEditTask(null)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200">Cancel</button>
              <button type="button" onClick={handleEditSubmit} disabled={submittingEdit} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">{submittingEdit ? "Saving..." : "Save Changes"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminTasksPanel() {
  const [activeTab, setActiveTab] = useState("team");

  return (
    <div className="space-y-5">
      <div className="flex gap-2 rounded-xl border border-gray-200 bg-white p-2">
        <button
          type="button"
          onClick={() => setActiveTab("team")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === "team" ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          Team Tasks
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("my")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === "my" ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-100"}`}
        >
          My Tasks
        </button>
      </div>
      {activeTab === "team" ? <TeamTasksTab /> : <MyTasksTab />}
    </div>
  );
}

// ─── Nav config ───────────────────────────────────────────────────────────────

const adminNavItems = [
  { id: "dashboard", label: "Dashboard" },
  { id: "my-profile", label: "My Profile" },
  { id: "staff-management", label: "Staff" },
  { id: "reports", label: "Reports" },
  { id: "leave", label: "Leave Requests" },
  { id: "alerts", label: "Alerts" },
  { id: "tasks", label: "Tasks" },
  { id: "chat", label: "Chat" },
];

// ─── Main NormalAdminDashboard ────────────────────────────────────────────────

function NormalAdminDashboard() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("dashboard");
  const [chatWithUser, setChatWithUser] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [unreadCount, setUnreadCount] = useState(0);
  const [reportUnreadCount, setReportUnreadCount] = useState(0);
  const [leavePendingCount, setLeavePendingCount] = useState(0);
  const [alertReplyCount, setAlertReplyCount] = useState(0);
  const prevReportCountRef = useRef(null);
  const prevLeaveCountRef = useRef(null);
  const prevAlertReplyCountRef = useRef(null);

  const user = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);

  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const response = await api.get("/api/chat/unread-count");
        setUnreadCount(response.data.unread_count);
      } catch {
        // non-critical
      }
    };
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const [reportRes, leaveRes, alertRes] = await Promise.all([
          api.get("/api/attendance/reports/unread-count"),
          api.get("/api/leave/pending-count"),
          api.get("/api/alerts/unread-replies-count"),
        ]);
        const newReportCount = reportRes.data.count;
        const newLeaveCount = leaveRes.data.count;
        const newAlertCount = alertRes.data.count;
        if (prevReportCountRef.current !== null && newReportCount > prevReportCountRef.current) playActionSound();
        else if (prevLeaveCountRef.current !== null && newLeaveCount > prevLeaveCountRef.current) playActionSound();
        else if (prevAlertReplyCountRef.current !== null && newAlertCount > prevAlertReplyCountRef.current) playActionSound();
        prevReportCountRef.current = newReportCount;
        prevLeaveCountRef.current = newLeaveCount;
        prevAlertReplyCountRef.current = newAlertCount;
        setReportUnreadCount(newReportCount);
        setLeavePendingCount(newLeaveCount);
        setAlertReplyCount(newAlertCount);
      } catch {
        // Silent fail
      }
    };
    poll();
    const notifInterval = setInterval(poll, 30000);
    return () => clearInterval(notifInterval);
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const activeItem = adminNavItems.find((item) => item.id === activeSection);

  const handleLogout = async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      localStorage.removeItem("access_token");
      localStorage.removeItem("user");
      navigate("/login");
    }
  };

  const renderContent = () => {
    if (activeSection === "my-profile") return <MyProfilePanel />;
    if (activeSection === "staff-management") return <StaffManagementPanel openProfile={setProfileUser} />;
    if (activeSection === "reports") return <AdminReportsPanel />;
    if (activeSection === "leave") return <AdminLeavePanel />;
    if (activeSection === "alerts") return <AdminAlertsPanel />;
    if (activeSection === "tasks") return <AdminTasksPanel />;
    if (activeSection === "chat") return <ChatPanel chatWithUser={chatWithUser} />;

    return (
      <div className="space-y-8">
        <MyDayPanel />
        <TeamStatusPanel
          setActiveSection={setActiveSection}
          setChatWithUser={setChatWithUser}
          openProfile={setProfileUser}
        />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <aside className="fixed left-0 top-0 flex h-screen w-64 flex-col bg-blue-900 text-white">
        <div className="border-b border-blue-800 px-6 py-6">
          <LogoDisplay user={user} />
          <p className="mt-1 text-sm text-blue-200">Admin Console</p>
        </div>

        <nav className="flex-1 px-4 py-6">
          <div className="space-y-2">
            {adminNavItems.map((item) => {
              const badgeCounts = {
                chat: unreadCount,
                reports: reportUnreadCount,
                leave: leavePendingCount,
                alerts: alertReplyCount,
              };
              const badge = badgeCounts[item.id] ?? 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === "chat") setUnreadCount(0);
                    else if (item.id === "reports") setReportUnreadCount(0);
                    else if (item.id === "leave") setLeavePendingCount(0);
                    else if (item.id === "alerts") setAlertReplyCount(0);
                    setActiveSection(item.id);
                  }}
                  className={`w-full rounded-lg px-4 py-3 text-left text-sm font-medium transition ${
                    activeSection === item.id ? "bg-blue-700 text-white" : "text-blue-100 hover:bg-blue-800"
                  }`}
                >
                  {badge > 0 ? (
                    <div className="relative inline-block">
                      {item.label}
                      <span className="absolute -top-1 -right-6 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                        {badge > 99 ? "99+" : badge}
                      </span>
                    </div>
                  ) : (
                    item.label
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-blue-800 p-4">
          <div className="mb-4">
            <p className="truncate text-sm font-semibold">{user?.full_name || "Admin User"}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-blue-200">admin</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Logout
          </button>
        </div>
      </aside>

      <main className="ml-64 min-h-screen">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-5">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {activeItem?.label || "Dashboard"}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {formatDateTime(currentTime.toISOString())}
            </p>
          </div>
        </header>

        <section className="p-8">{renderContent()}</section>
      </main>

      {profileUser && (
        <StaffProfileModal
          userId={profileUser}
          onClose={() => setProfileUser(null)}
        />
      )}
    </div>
  );
}

export default NormalAdminDashboard;

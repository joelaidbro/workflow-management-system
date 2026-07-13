import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api.js";
import { playMessageSound, playActionSound } from "../utils/sounds";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatTime,
  minutesToHours,
} from "../utils/dateUtils";

const statusColors = {
  active: "bg-green-500",
  idle: "bg-yellow-400",
  break: "bg-orange-400",
  meeting: "bg-blue-400",
  offline: "bg-gray-400",
};

const statusLabels = {
  active: "🟢 Active",
  idle: "🟡 Idle",
  break: "☕ Break",
  meeting: "📋 Meeting",
  offline: "⚫ Offline",
};

function formatElapsedDuration(startValue, endValue) {
  if (!startValue || !endValue) {
    return "N/A";
  }

  const normalize = (value) =>
    typeof value === "string" && !value.endsWith("Z") ? `${value}Z` : value;
  const minutes = Math.max(
    0,
    Math.floor((new Date(normalize(endValue)) - new Date(normalize(startValue))) / 60000)
  );
  return formatDuration(minutes);
}

function getBreakMinutes(startValue) {
  if (!startValue) {
    return null;
  }

  return Math.max(0, Math.floor((new Date() - new Date(startValue)) / 60000));
}

function TeamStatusPanel({ setActiveSection, setChatWithUser, openProfile }) {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [alertTarget, setAlertTarget] = useState(null);
  const [directAlertType, setDirectAlertType] = useState("info");
  const [directAlertMessage, setDirectAlertMessage] = useState("");
  const [directAlertError, setDirectAlertError] = useState("");
  const [sendingDirectAlert, setSendingDirectAlert] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchTeamStatus = async () => {
      try {
        const response = await api.get("/api/status/team");
        if (isMounted) {
          setStaffList(response.data);
          setError("");
        }
      } catch (err) {
        if (isMounted) {
          setError("Could not load team status. Retrying...");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchTeamStatus();
    const intervalId = setInterval(fetchTeamStatus, 30000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  const counts = {
    active: staffList.filter((staff) => staff.status === "active").length,
    idle: staffList.filter((staff) => staff.status === "idle").length,
    break: staffList.filter((staff) => staff.status === "break").length,
    meeting: staffList.filter((staff) => staff.status === "meeting").length,
    offline: staffList.filter((staff) => staff.status === "offline").length,
  };

  const handleSendDirectAlert = async () => {
    const cleanMessage = directAlertMessage.trim();
    if (!cleanMessage) {
      setDirectAlertError("Message cannot be empty");
      return;
    }

    setSendingDirectAlert(true);
    setDirectAlertError("");
    try {
      await api.post("/api/alerts/send", {
        alert_type: directAlertType,
        message: cleanMessage,
        recipient_id: alertTarget.user_id,
      });
      toast.success(`Alert sent to ${alertTarget.full_name}`);
      setAlertTarget(null);
      setDirectAlertType("info");
      setDirectAlertMessage("");
    } catch (err) {
      setDirectAlertError(err.response?.data?.detail || "Could not send alert");
    } finally {
      setSendingDirectAlert(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-80 items-center justify-center text-gray-500">
        Loading team status...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <div className="text-sm font-medium text-red-600">{error}</div>}

      <div className="grid grid-cols-5 gap-4">
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="text-sm font-medium text-green-700">🟢 Active</div>
          <div className="mt-3 text-3xl font-bold text-green-900">
            {counts.active}
          </div>
        </div>
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-5">
          <div className="text-sm font-medium text-yellow-700">🟡 Idle</div>
          <div className="mt-3 text-3xl font-bold text-yellow-900">
            {counts.idle}
          </div>
        </div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-5">
          <div className="text-sm font-medium text-orange-700">☕ On Break</div>
          <div className="mt-3 text-3xl font-bold text-orange-900">
            {counts.break}
          </div>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <div className="text-sm font-medium text-blue-700">📋 In Meeting</div>
          <div className="mt-3 text-3xl font-bold text-blue-900">
            {counts.meeting}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
          <div className="text-sm font-medium text-gray-700">⚫ Offline</div>
          <div className="mt-3 text-3xl font-bold text-gray-900">
            {counts.offline}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {staffList.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No staff members found
          </div>
        ) : (
          staffList.map((staff) => {
            const isExpanded = expandedUserId === staff.user_id;
            const breakMinutes = getBreakMinutes(staff.break_started_at);

            return (
              <div key={staff.user_id} className="border-b border-gray-100 last:border-b-0">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedUserId(isExpanded ? null : staff.user_id)
                  }
                  className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-gray-50"
                >
                  <span
                    className={`h-3 w-3 rounded-full ${
                      statusColors[staff.status] || "bg-gray-400"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-900">
                      {staff.full_name}
                    </div>
                    <div className="text-sm text-gray-500">
                      {staff.department || "No department"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
                      {statusLabels[staff.status] || staff.status}
                    </span>
                    {staff.status === "break" && breakMinutes !== null && (
                      <span className="text-sm text-gray-500">
                        {breakMinutes} min
                      </span>
                    )}
                    <span className="text-lg text-gray-400">
                      {isExpanded ? "⌃" : "⌄"}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="bg-gray-50 px-5 py-5">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Employee ID</span>
                        <div className="font-medium text-gray-900">
                          {staff.employee_id || "N/A"}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">Work mode today</span>
                        <div className="font-medium text-gray-900">
                          {staff.today_work_mode
                            ? staff.today_work_mode.toUpperCase()
                            : "N/A"}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">Login time</span>
                        <div className="font-medium text-gray-900">
                          {formatTime(staff.login_time)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">Last activity</span>
                        <div className="font-medium text-gray-900">
                          {formatTime(staff.updated_at)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">Working hours today</span>
                        <div className="font-medium text-gray-900">
                          {minutesToHours(staff.working_minutes_so_far ?? 0)}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">Idle Time Today</span>
                        <div className="font-medium text-gray-900">
                          {minutesToHours(staff.idle_minutes || 0)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex gap-3">
                      <button
                        type="button"
                        onClick={() => openProfile(staff.user_id)}
                        className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
                      >
                        View Profile
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAlertTarget(staff);
                          setDirectAlertType("info");
                          setDirectAlertMessage("");
                          setDirectAlertError("");
                        }}
                        className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-yellow-950 hover:bg-yellow-500"
                      >
                        Send Alert
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setChatWithUser({
                            user_id: staff.user_id,
                            full_name: staff.full_name,
                            department: staff.department,
                          });
                          setActiveSection("chat");
                        }}
                        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                      >
                        Open Chat
                      </button>
                    </div>

                    {alertTarget?.user_id === staff.user_id && (
                      <div className="mt-5 rounded-xl border border-yellow-200 bg-white p-4">
                        <div className="text-sm font-semibold text-gray-900">
                          Send alert to {staff.full_name}
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setDirectAlertType("info")}
                            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                              directAlertType === "info"
                                ? "bg-blue-700 text-white"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            Info
                          </button>
                          <button
                            type="button"
                            onClick={() => setDirectAlertType("urgent")}
                            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                              directAlertType === "urgent"
                                ? "bg-red-600 text-white"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            Urgent
                          </button>
                        </div>
                        <textarea
                          value={directAlertMessage}
                          onChange={(event) =>
                            setDirectAlertMessage(event.target.value)
                          }
                          className="mt-4 min-h-28 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                          placeholder="Type alert message..."
                        />
                        {directAlertError && (
                          <div className="mt-2 text-sm font-medium text-red-600">
                            {directAlertError}
                          </div>
                        )}
                        <div className="mt-4 flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => setAlertTarget(null)}
                            className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSendDirectAlert}
                            disabled={sendingDirectAlert}
                            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {sendingDirectAlert ? "Sending..." : "Send"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function StaffProfileModal({ userId, onClose }) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const currentUser = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [tooltip, setTooltip] = useState({
    visible: false,
    day: null,
    x: 0,
    y: 0,
  });

  useEffect(() => {
    const fetchSummary = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/api/attendance/summary/${userId}`, {
          params: { month: currentMonth, year: currentYear },
        });
        setSummary(response.data);
      } catch (err) {
        toast.error("Could not load profile");
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      fetchSummary();
    }
  }, [userId, currentMonth, currentYear]);

  const handleDownloadReport = async () => {
    setDownloading(true);
    try {
      const response = await api.get(
        `/api/attendance/export/salary-slip/${userId}`,
        {
          params: { month: currentMonth, year: currentYear },
          responseType: "blob",
        }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `salary_slip_${summary?.employee_id || userId}_${currentMonth}_${currentYear}.pdf`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      if (err.response?.status === 400) {
        toast.error("Salary not yet approved for this period");
      } else {
        toast.error("Could not download report");
      }
    } finally {
      setDownloading(false);
    }
  };

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
        const dateKey = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(
          day
        ).padStart(2, "0")}`;
        const record = recordsByDate.get(dateKey);
        const defaultWorkingDays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
        const workingDays = summary?.working_days || defaultWorkingDays;
        const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        const isWeekend = !workingDays.includes(dayNames[date.getDay()]);
        let dotClass = "bg-red-500";

        if (isWeekend && !record) {
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
          work_mode: record?.work_mode || (isWeekend ? "weekend" : "office"),
          working_minutes: record?.working_minutes || 0,
          break_minutes: record?.break_minutes || 0,
          idle_minutes: record?.idle_minutes || 0,
          login_time: record?.login_time || null,
          logout_time: record?.logout_time || null,
        };
      }),
    ];
  }, [currentYear, currentMonth, summary]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-bold text-gray-900">
              {summary?.full_name || "Profile"}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {summary?.employee_id || "N/A"} · {summary?.department || "No department"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
          >
            Close
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-500">Loading profile...</div>
        ) : (
          <>
            <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-5">
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
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        summary?.work_type === "wfh"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {summary?.work_type === "wfh" ? "WFH" : "Office"}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Email</span>
                  <div>
                    {summary?.email ? (
                      <a
                        href={`mailto:${summary.email}`}
                        className="font-semibold text-blue-700 hover:text-blue-800"
                      >
                        {summary.email}
                      </a>
                    ) : (
                      <span className="font-semibold text-gray-900">N/A</span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">Phone</span>
                  <div className="font-semibold text-gray-900">{summary?.phone || "N/A"}</div>
                </div>
                <div>
                  <span className="text-gray-500">Joining Date</span>
                  <div className="font-semibold text-gray-900">{formatDate(summary?.joining_date)}</div>
                </div>
                {currentUser?.role === "super_admin" && (
                  <div>
                    <span className="text-gray-500">Base Salary</span>
                    <div className="font-semibold text-gray-900">
                      {summary?.base_salary != null ? summary.base_salary : "N/A"}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
              <div className="rounded-xl bg-green-50 p-4">
                <div className="text-green-700">Days Present</div>
                <div className="mt-1 text-2xl font-bold text-green-900">
                  {summary?.days_present || 0}
                </div>
              </div>
              <div className="rounded-xl bg-red-50 p-4">
                <div className="text-red-700">Days Absent</div>
                <div className="mt-1 text-2xl font-bold text-red-900">
                  {summary?.days_absent || 0}
                </div>
              </div>
              <div className="rounded-xl bg-blue-50 p-4">
                <div className="text-blue-700">Working Hours</div>
                <div className="mt-1 text-2xl font-bold text-blue-900">
                  {minutesToHours(summary?.total_working_minutes || 0)}
                </div>
              </div>
              <div className="rounded-xl bg-orange-50 p-4">
                <div className="text-orange-700">Break Time</div>
                <div className="mt-1 text-2xl font-bold text-orange-900">
                  {minutesToHours(summary?.total_break_minutes || 0)}
                </div>
              </div>
              <div className="rounded-xl bg-yellow-50 p-4">
                <div className="text-yellow-700">Idle Time</div>
                <div className="mt-1 text-2xl font-bold text-yellow-900">
                  {minutesToHours(summary?.total_idle_minutes || 0)}
                </div>
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
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                  <div key={day}>{day}</div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-7 gap-2 rounded-xl bg-gray-50 p-4">
                {calendarDays.map((item) =>
                  item.blank ? (
                    <div key={item.id} className="h-12" />
                  ) : (
                    <div
                      key={item.day}
                      className="flex flex-col items-center gap-1 rounded-lg bg-white p-2 text-xs text-gray-600"
                    >
                      <span>{item.day}</span>
                      <span
                        className={`h-3 w-3 cursor-pointer rounded-full ${item.dotClass}`}
                        onMouseEnter={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          setTooltip({
                            visible: true,
                            day: item,
                            x: rect.left,
                            y: rect.top,
                          });
                        }}
                        onMouseLeave={() =>
                          setTooltip({ visible: false, day: null, x: 0, y: 0 })
                        }
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
                  <div className="mb-1 font-bold">
                    {formatDate(tooltip.day.date)}
                  </div>
                  <div>🕐 Working: {minutesToHours(tooltip.day.working_minutes)}</div>
                  <div>☕ Break: {minutesToHours(tooltip.day.break_minutes)}</div>
                  <div>💤 Idle: {minutesToHours(tooltip.day.idle_minutes)}</div>
                  <div>🔵 Mode: {tooltip.day.work_mode || "Office"}</div>
                  {tooltip.day.login_time && (
                    <div>⏰ Login: {formatTime(tooltip.day.login_time)}</div>
                  )}
                  {tooltip.day.logout_time && (
                    <div>⏰ Logout: {formatTime(tooltip.day.logout_time)}</div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={handleDownloadReport}
                disabled={downloading}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {downloading ? "Downloading..." : "Download Report"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReportsPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [replyText, setReplyText] = useState({});
  const [replyErrors, setReplyErrors] = useState({});
  const [submittingReplyId, setSubmittingReplyId] = useState(null);
  const [downloadingTeamReport, setDownloadingTeamReport] = useState(false);
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
          params: {
            date: selectedDate,
            unread_only: unreadOnly,
          },
        });

        if (isMounted) {
          setReports(response.data);
          setUnreadDates((prev) => prev.filter((d) => d !== selectedDate));
        }
      } catch (err) {
        if (isMounted) {
          setError("Could not load reports.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchReports();

    return () => {
      isMounted = false;
    };
  }, [selectedDate, unreadOnly]);

  const handleReplySubmit = async (reportId) => {
    const reply = (replyText[reportId] || "").trim();
    if (!reply) {
      setReplyErrors((current) => ({
        ...current,
        [reportId]: "Reply cannot be empty",
      }));
      return;
    }

    setSubmittingReplyId(reportId);
    setReplyErrors((current) => ({ ...current, [reportId]: "" }));

    try {
      await api.post(`/api/attendance/reports/${reportId}/reply`, {
        reply,
      });

      setReports((currentReports) =>
        currentReports.map((report) =>
          report.id === reportId
            ? {
                ...report,
                admin_reply: reply,
                is_read_by_admin: true,
              }
            : report
        )
      );
      setReplyText((current) => ({ ...current, [reportId]: "" }));
    } catch (err) {
      setReplyErrors((current) => ({
        ...current,
        [reportId]: "Could not submit reply",
      }));
    } finally {
      setSubmittingReplyId(null);
    }
  };

  const handleDownloadTeamReport = async () => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    setDownloadingTeamReport(true);

    try {
      const response = await api.get("/api/attendance/export/team-excel", {
        params: { month: currentMonth, year: currentYear },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `attendance_${currentMonth}_${currentYear}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Could not download team report");
    } finally {
      setDownloadingTeamReport(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-4">
          <div>
            <label
              htmlFor="reports-date"
              className="mb-1 block text-sm font-medium text-gray-600"
            >
              Report date
            </label>
            <input
              id="reports-date"
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <button
            type="button"
            onClick={() => setUnreadOnly((current) => !current)}
            className={`mt-6 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              unreadOnly
                ? "bg-blue-700 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
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
                  className={`relative flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    selectedDate === date
                      ? "border-blue-700 bg-blue-700 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50"
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                  {date}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleDownloadTeamReport}
          disabled={downloadingTeamReport}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {downloadingTeamReport ? "Downloading..." : "↓ Download Team Report"}
        </button>
      </div>

      {error && <div className="text-sm font-medium text-red-600">{error}</div>}

      {loading ? (
        <div className="flex min-h-80 items-center justify-center text-gray-500">
          Loading reports...
        </div>
      ) : reports.length === 0 ? (
        <div className="flex min-h-80 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500">
          No reports found for this date
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <div
              key={report.id}
              className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-900">{report.full_name}</h3>
                    {!report.is_read_by_admin && (
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                        New
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    {report.employee_id || "No employee ID"}
                  </p>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <div>{formatDate(report.report_date)}</div>
                  <div>{formatTime(report.submitted_at)}</div>
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm leading-6 text-gray-800">
                {report.content}
              </div>

              {report.admin_reply ? (
                <div className="mt-4 rounded-lg bg-blue-50 p-4">
                  <div className="text-sm font-semibold text-blue-900">
                    Your reply:
                  </div>
                  <p className="mt-2 text-sm leading-6 text-blue-900">
                    {report.admin_reply}
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <textarea
                    value={replyText[report.id] || ""}
                    onChange={(event) =>
                      setReplyText((current) => ({
                        ...current,
                        [report.id]: event.target.value,
                      }))
                    }
                    placeholder="Write a reply..."
                    className="min-h-28 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                  />
                  {replyErrors[report.id] && (
                    <div className="text-sm font-medium text-red-600">
                      {replyErrors[report.id]}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => handleReplySubmit(report.id)}
                    disabled={submittingReplyId === report.id}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {submittingReplyId === report.id
                      ? "Submitting..."
                      : "Submit Reply"}
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

function LeavePanel() {
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
      const response = await api.get("/api/leave/team-requests", {
        params: { status },
      });
      setLeaveRequests(response.data);
    } catch (err) {
      setError("Could not load leave requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaveRequests(activeStatus);
  }, [activeStatus]);

  const handleReviewStart = (requestId, decision) => {
    setReviewingRequest({ requestId, decision });
    setReviewComment("");
  };

  const handleReviewSubmit = async () => {
    if (!reviewingRequest) {
      return;
    }

    setSubmittingReview(true);
    try {
      await api.post(`/api/leave/requests/${reviewingRequest.requestId}/review`, {
        decision: reviewingRequest.decision,
        comment: reviewComment || null,
      });

      setLeaveRequests((current) =>
        current.filter((request) => request.id !== reviewingRequest.requestId)
      );
      toast.success(`Leave request ${reviewingRequest.decision}`);
      setReviewingRequest(null);
      setReviewComment("");
    } catch (err) {
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

  const leaveTypeClasses = {
    pending: "bg-blue-100 text-blue-800",
    approved: "bg-purple-100 text-purple-800",
    rejected: "bg-gray-100 text-gray-800",
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2 rounded-xl border border-gray-200 bg-white p-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveStatus(tab.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeStatus === tab.id
                ? "bg-blue-700 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="text-sm font-medium text-red-600">{error}</div>}

      {loading ? (
        <div className="flex min-h-80 items-center justify-center text-gray-500">
          Loading leave requests...
        </div>
      ) : leaveRequests.length === 0 ? (
        <div className="flex min-h-80 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500">
          No leave requests found
        </div>
      ) : (
        <div className="space-y-4">
          {leaveRequests.map((request) => {
            const isReviewing = reviewingRequest?.requestId === request.id;
            const dateRange = `${formatDate(request.start_date)} -> ${formatDate(
              request.end_date
            )}`;

            return (
              <div
                key={request.id}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-bold text-gray-900">
                      {request.full_name}
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {request.employee_id || "No employee ID"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        leaveTypeClasses[request.status] || leaveTypeClasses.pending
                      }`}
                    >
                      {request.leave_type}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        statusBadgeClasses[request.status]
                      }`}
                    >
                      {request.status}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Date range</span>
                    <div className="mt-1 font-medium text-gray-900">
                      {dateRange}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500">Total days</span>
                    <div className="mt-1 font-medium text-gray-900">
                      {request.total_days} days
                    </div>
                  </div>
                </div>

                {request.reason && (
                  <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                    {request.reason}
                  </div>
                )}

                {request.status === "pending" ? (
                  <div className="mt-5">
                    {!isReviewing ? (
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => handleReviewStart(request.id, "approved")}
                          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewStart(request.id, "rejected")}
                          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-lg bg-gray-50 p-4">
                        <textarea
                          value={reviewComment}
                          onChange={(event) => setReviewComment(event.target.value)}
                          placeholder="Optional comment..."
                          className="min-h-24 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                        />
                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={handleReviewSubmit}
                            disabled={submittingReview}
                            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {submittingReview
                              ? "Submitting..."
                              : `Confirm ${reviewingRequest.decision}`}
                          </button>
                          <button
                            type="button"
                            onClick={() => setReviewingRequest(null)}
                            className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                    {request.admin_comment && (
                      <p>
                        <span className="font-semibold">Admin comment:</span>{" "}
                        {request.admin_comment}
                      </p>
                    )}
                    {request.reviewed_at && (
                      <p className="mt-2 text-gray-500">
                        Reviewed {formatDateTime(request.reviewed_at)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AlertsPanel() {
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

    const fetchStaff = async () => {
      try {
        const response = await api.get("/api/status/team");
        if (isMounted) {
          setStaffList(response.data);
        }
      } catch (err) {
        if (isMounted) {
          setError("Could not load staff list.");
        }
      } finally {
        if (isMounted) {
          setLoadingStaff(false);
        }
      }
    };

    fetchStaff();

    return () => {
      isMounted = false;
    };
  }, []);

  const fetchSentAlerts = async () => {
    try {
      const response = await api.get("/api/alerts/sent");
      setSentAlerts((prev) => {
        return response.data;
      });
    } catch (err) {
      toast.error("Could not load sent alerts");
    } finally {
      setLoadingSentAlerts(false);
    }
  };

  useEffect(() => {
    fetchSentAlerts();
    const intervalId = setInterval(fetchSentAlerts, 30000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  const handleViewDeliveryReport = async (alertId) => {
    setLoadingReportId(alertId);
    try {
      const response = await api.get(`/api/alerts/delivery-report/${alertId}`);
      setDeliveryReport(response.data);
      setSentAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, has_unread_replies: false } : a))
      );
    } catch (err) {
      toast.error("Could not load delivery report");
    } finally {
      setLoadingReportId(null);
    }
  };

  const handleSendAlert = async (event) => {
    event.preventDefault();
    const cleanMessage = message.trim();

    if (!cleanMessage) {
      setError("Message cannot be empty.");
      return;
    }

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
    } catch (err) {
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
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Alert type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAlertType("info")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  alertType === "info"
                    ? "bg-blue-700 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Info
              </button>
              <button
                type="button"
                onClick={() => setAlertType("urgent")}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  alertType === "urgent"
                    ? "bg-red-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Urgent
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="alert-recipient"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              Recipient
            </label>
            <select
              id="alert-recipient"
              value={recipientId}
              onChange={(event) => setRecipientId(event.target.value)}
              disabled={loadingStaff}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              <option value="">Broadcast to all staff</option>
              {staffList.map((staff) => (
                <option key={staff.user_id} value={staff.user_id}>
                  {staff.full_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="alert-message"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              Message
            </label>
            <textarea
              id="alert-message"
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, 500))}
              placeholder="Type your message here..."
              className="min-h-40 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
            />
            <div className="mt-1 text-right text-xs text-gray-500">
              {message.length}/500
            </div>
          </div>

          {error && <div className="text-sm font-medium text-red-600">{error}</div>}

          <button
            type="submit"
            disabled={sending}
            className={`w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-70 ${
              alertType === "urgent"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-700 hover:bg-blue-800"
            }`}
          >
            {sending ? "Sending..." : "Send Alert"}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-3">
        <h3 className="text-xl font-bold text-gray-900">Sent Alerts</h3>
        <div className="mt-6 space-y-4">
          {loadingSentAlerts ? (
            <div className="flex min-h-80 items-center justify-center rounded-lg bg-gray-50 text-gray-500">
              Loading sent alerts...
            </div>
          ) : sentAlerts.length === 0 ? (
            <div className="flex min-h-80 items-center justify-center rounded-lg bg-gray-50 text-gray-500">
              No alerts sent yet
            </div>
          ) : (
            sentAlerts.map((alert) => {
              const progress =
                alert.total_recipients > 0
                  ? Math.round(
                      (alert.acknowledged_count / alert.total_recipients) * 100
                    )
                  : 0;

              return (
                <div
                  key={alert.id}
                  className={`rounded-xl border p-4 ${
                    alert.has_unread_replies
                      ? "border-red-300 bg-red-50/40"
                      : "border-gray-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            alert.alert_type === "urgent"
                              ? "bg-red-100 text-red-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {alert.alert_type === "urgent" ? "URGENT" : "INFO"}
                        </span>
                        {alert.has_unread_replies && (
                          <span className="flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                            <span className="h-1.5 w-1.5 rounded-full bg-white" />
                            New replies
                          </span>
                        )}
                        <span className="text-xs text-gray-500">
                          {formatDateTime(alert.created_at)}
                        </span>
                      </div>
                      <p className="mt-3 text-sm font-medium text-gray-900">
                        {alert.message}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleViewDeliveryReport(alert.id)}
                      disabled={loadingReportId === alert.id}
                      className="shrink-0 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {loadingReportId === alert.id
                        ? "Loading..."
                        : "View Full Report"}
                    </button>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">
                        {alert.acknowledged_count}/{alert.total_recipients} acknowledged
                      </span>
                      {alert.pending_count > 0 && (
                        <span className="font-medium text-orange-600">
                          {alert.pending_count} pending
                        </span>
                      )}
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-green-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {deliveryReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">
                  Delivery Report
                </h3>
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-gray-600">
                  <div>
                    <span className="font-semibold text-gray-500">Type:</span>{" "}
                    <span className="capitalize font-semibold text-gray-900">
                      {deliveryReport.alert_type}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500">Sender:</span>{" "}
                    <span className="font-semibold text-gray-900">
                      {deliveryReport.sender_name || "Admin"}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500">Sent Time:</span>{" "}
                    <span className="font-semibold text-gray-900">
                      {formatDateTime(deliveryReport.created_at)}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-500">Recipients:</span>{" "}
                    <span className="font-semibold text-gray-900">
                      {deliveryReport.total_recipients}
                    </span>
                  </div>
                </div>
                <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-800 border border-gray-100">
                  <div className="font-semibold text-gray-700 mb-1">Message:</div>
                  {deliveryReport.message}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeliveryReport(null)}
                className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="font-bold text-gray-900">
                  {deliveryReport.total_recipients}
                </div>
                <div className="text-gray-500">Recipients</div>
              </div>
              <div className="rounded-lg bg-green-50 p-3">
                <div className="font-bold text-green-700">
                  {deliveryReport.acknowledged_count}
                </div>
                <div className="text-green-700">Acknowledged</div>
              </div>
              <div className="rounded-lg bg-orange-50 p-3">
                <div className="font-bold text-orange-700">
                  {deliveryReport.pending_count}
                </div>
                <div className="text-orange-700">Pending</div>
              </div>
            </div>

            <div className="mt-6">
              <h4 className="text-sm font-bold text-gray-700 mb-2">Acknowledgements</h4>
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 max-h-60 overflow-y-auto">
                {deliveryReport.recipients.map((recipient) => (
                  <div
                    key={recipient.recipient_id}
                    className="flex items-start justify-between gap-4 p-4 text-sm"
                  >
                    <div>
                      <div className="font-semibold text-gray-900">
                        {recipient.full_name}
                      </div>
                      {recipient.acknowledged_at && (
                        <div className="mt-1 text-xs text-gray-500">
                          {formatDateTime(recipient.acknowledged_at)}
                        </div>
                      )}
                      {recipient.reply && (
                        <div className="mt-2 rounded-lg bg-gray-50 p-2 text-gray-700">
                          {recipient.reply}
                        </div>
                      )}
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        recipient.status === "acknowledged"
                          ? "bg-green-100 text-green-700"
                          : "bg-orange-100 text-orange-700"
                      }`}
                    >
                      {recipient.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 border-t border-gray-100 pt-6">
              <h4 className="text-sm font-bold text-gray-700 mb-2">Replies</h4>
              {((deliveryReport.recipients || [])
                .filter((r) => r.reply)
                .sort((a, b) => new Date(a.acknowledged_at) - new Date(b.acknowledged_at))
              ).length === 0 ? (
                <div className="text-sm text-gray-500 italic py-2">No replies yet</div>
              ) : (
                <div className="space-y-3">
                  {(deliveryReport.recipients || [])
                    .filter((r) => r.reply)
                    .sort((a, b) => new Date(a.acknowledged_at) - new Date(b.acknowledged_at))
                    .map((reply) => (
                      <div
                        key={reply.recipient_id}
                        className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 text-sm"
                      >
                        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                          <div className="font-semibold text-gray-900">
                            {reply.full_name}{" "}
                            {reply.employee_id && (
                              <span className="text-xs font-normal text-gray-500">
                                ({reply.employee_id})
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatDateTime(reply.acknowledged_at)}
                          </div>
                        </div>
                        <div className="mt-2 text-gray-700">{reply.reply}</div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatPanel({ chatWithUser }) {
  const user = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);
  const currentUserId = user?.user_id || user?.id;
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showNewChatSelector, setShowNewChatSelector] = useState(false);
  const [availableChatUsers, setAvailableChatUsers] = useState([]);
  const [loadingChatUsers, setLoadingChatUsers] = useState(false);
  const wsRef = useRef(null);
  const selectedConversationRef = useRef(null);
  const lastSentMessageRef = useRef("");
  const messagesContainerRef = useRef(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const skipScrollRef = useRef(false);
  const prevScrollHeightRef = useRef(0);

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const response = await api.get("/api/chat/conversations");
        setConversations(response.data);
      } catch (err) {
        toast.error("Could not load conversations");
      } finally {
        setLoadingConversations(false);
      }
    };

    fetchConversations();
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token || !currentUserId) {
      return;
    }

    const apiUrl = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
    const wsUrl = apiUrl.replace("https://", "wss://").replace("http://", "ws://");
    let reconnectDelay = 3000;
    let reconnectTimeout = null;
    let destroyed = false;

    function connect() {
    const ws = new WebSocket(`${wsUrl}/api/chat/ws/${currentUserId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectDelay = 3000;
      ws.send(JSON.stringify({ token }));
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      wsRef.current = null;
      if (!destroyed) {
        reconnectTimeout = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          connect();
        }, reconnectDelay);
      }
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "error") {
        toast.error(data.message || "Message failed to send");
        return;
      }

      if (data.type === "message_sent") {
        const activeConversation = selectedConversationRef.current;
        if (activeConversation) {
          setConversations((current) => {
            const exists = current.some(
              (conversation) =>
                conversation.user_id === activeConversation.user_id
            );
            if (exists) {
              return current;
            }

            return [
              {
                user_id: activeConversation.user_id,
                full_name: activeConversation.full_name,
                department: activeConversation.department,
                last_message: lastSentMessageRef.current,
                last_message_at: data.created_at,
                unread_count: 0,
              },
              ...current,
            ];
          });
        }
      }

      if (data.type === "new_message") {
        if (data.sender_id !== currentUserId) {
          playMessageSound();
        }
        const activeConversation = selectedConversationRef.current;
        if (activeConversation?.user_id === data.sender_id) {
          setMessages((current) => [
            ...current,
            {
              message_id: data.message_id,
              sender_id: data.sender_id,
              sender_name: data.sender_name,
              content: data.content,
              created_at: data.created_at,
              is_read: false,
            },
          ]);
        } else {
          setConversations((current) =>
            current.map((conversation) =>
              conversation.user_id === data.sender_id
                ? {
                    ...conversation,
                    last_message: data.content,
                    last_message_at: data.created_at,
                    unread_count: (conversation.unread_count || 0) + 1,
                  }
                : conversation
            )
          );
        }
      }
    };

    }

    connect();

    return () => {
      destroyed = true;
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [currentUserId]);

  const openConversation = async (conversation) => {
    const existingConversation = conversations.find(
      (item) => item.user_id === conversation.user_id
    );
    const conversationToOpen = existingConversation || {
      user_id: conversation.user_id,
      full_name: conversation.full_name,
      department: conversation.department,
      last_message: "",
      last_message_at: null,
      unread_count: 0,
      is_new: true,
    };

    setSelectedConversation(conversationToOpen);
    setLoadingMessages(true);
    setConversations((current) =>
      current.map((item) =>
        item.user_id === conversationToOpen.user_id
          ? { ...item, unread_count: 0 }
          : item
      )
    );

    try {
      const response = await api.get(
        `/api/chat/history/${conversationToOpen.user_id}`
      );
      setMessages(response.data);
      setHasMoreMessages(response.data.length === 50);
    } catch (err) {
      toast.error("Could not load messages");
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (chatWithUser) {
      openConversation(chatWithUser);
    }
  }, [chatWithUser]);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  const loadOlderMessages = async () => {
    if (!hasMoreMessages || loadingOlder || messages.length === 0 || !selectedConversation) return;
    setLoadingOlder(true);
    const before = messages[0].created_at;
    prevScrollHeightRef.current = messagesContainerRef.current?.scrollHeight ?? 0;
    try {
      const response = await api.get(`/api/chat/history/${selectedConversation.user_id}`, {
        params: { before },
      });
      if (response.data.length === 0) {
        setHasMoreMessages(false);
        return;
      }
      skipScrollRef.current = true;
      setMessages((current) => [...response.data, ...current]);
      setHasMoreMessages(response.data.length === 50);
    } catch {
      toast.error("Could not load older messages");
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleMessagesScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    setShowScrollButton(scrollHeight - scrollTop - clientHeight > 100);
    if (scrollTop < 10 && hasMoreMessages && !loadingOlder) {
      loadOlderMessages();
    }
  };

  useEffect(() => {
    if (skipScrollRef.current) {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop =
          messagesContainerRef.current.scrollHeight - prevScrollHeightRef.current;
      }
      skipScrollRef.current = false;
    } else {
      scrollToBottom();
    }
  }, [messages]);

  const fetchAvailableChatUsers = async () => {
    setShowNewChatSelector((current) => !current);
    if (availableChatUsers.length > 0) {
      return;
    }

    setLoadingChatUsers(true);
    try {
      const response = await api.get("/api/users/list");
      setAvailableChatUsers(
        response.data
          .filter((item) => item.role === "staff")
          .map((item) => ({
            user_id: item.id,
            full_name: item.full_name,
            department: item.department,
          }))
      );
    } catch (err) {
      toast.error("Could not load staff");
    } finally {
      setLoadingChatUsers(false);
    }
  };

  const handleSelectConversation = async (conversation) => {
    openConversation(conversation);
  };

  const handleSendMessage = () => {
    const content = messageText.trim();
    if (!content || !selectedConversation) {
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    const optimisticMessage = {
      message_id: `temp-${Date.now()}`,
      sender_id: currentUserId,
      sender_name: user?.full_name,
      content,
      created_at: new Date().toISOString(),
      is_read: false,
    };

    setMessages((current) => [...current, optimisticMessage]);
    lastSentMessageRef.current = content;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.user_id === selectedConversation.user_id
          ? {
              ...conversation,
              last_message: content,
              last_message_at: optimisticMessage.created_at,
            }
          : conversation
      )
    );
    wsRef.current.send(
      JSON.stringify({
        recipient_id: selectedConversation.user_id,
        content,
      })
    );
    setMessageText("");
  };

  const handleInputKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const truncateMessage = (value) => {
    if (!value) {
      return "";
    }

    return value.length > 40 ? `${value.slice(0, 40)}...` : value;
  };

  return (
    <div className="flex h-[calc(100vh-9rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <aside className="w-1/3 border-r border-gray-200">
        <div className="border-b border-gray-200 p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-bold text-gray-900">Messages</h3>
            <button
              type="button"
              onClick={fetchAvailableChatUsers}
              className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              New Chat
            </button>
          </div>
          {showNewChatSelector && (
            <div className="mt-4">
              <select
                defaultValue=""
                onChange={(event) => {
                  const selectedUser = availableChatUsers.find(
                    (item) => item.user_id === event.target.value
                  );
                  if (selectedUser) {
                    openConversation(selectedUser);
                    setShowNewChatSelector(false);
                    event.target.value = "";
                  }
                }}
                disabled={loadingChatUsers}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
              >
                <option value="">
                  {loadingChatUsers ? "Loading staff..." : "Select staff member"}
                </option>
                {availableChatUsers.map((item) => (
                  <option key={item.user_id} value={item.user_id}>
                    {item.full_name}
                    {item.department ? ` - ${item.department}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="h-full overflow-y-auto">
          {loadingConversations ? (
            <div className="p-6 text-center text-gray-500">
              Loading conversations...
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No conversations yet
            </div>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.user_id}
                type="button"
                onClick={() => handleSelectConversation(conversation)}
                className={`w-full border-b border-gray-100 p-4 text-left transition ${
                  selectedConversation?.user_id === conversation.user_id
                    ? "bg-blue-50"
                    : "hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-gray-900">
                      {conversation.full_name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {conversation.department || "No department"}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatTime(conversation.last_message_at)}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="truncate text-sm text-gray-600">
                    {truncateMessage(conversation.last_message)}
                  </div>
                  {conversation.unread_count > 0 && (
                    <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-blue-700 px-2 text-xs font-bold text-white">
                      {conversation.unread_count}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="relative flex flex-1 flex-col">
        {!selectedConversation ? (
          <div className="flex flex-1 items-center justify-center text-gray-500">
            Select a conversation to start chatting
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-5 py-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                {selectedConversation.full_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-bold text-gray-900">
                  {selectedConversation.full_name}
                </div>
                <div className="text-xs text-gray-500">
                  {selectedConversation.department || "No department"}
                </div>
              </div>
            </div>

            <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="flex flex-1 flex-col gap-4 overflow-y-auto bg-gray-50 p-5">
              {loadingMessages ? (
                <div className="text-center text-gray-500">Loading messages...</div>
              ) : messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-gray-500">
                  Start a conversation with {selectedConversation.full_name}
                </div>
              ) : (
                <>
                  {hasMoreMessages && (
                    <div className="flex justify-center py-2">
                      {loadingOlder ? (
                        <span className="text-xs text-gray-400">Loading older messages...</span>
                      ) : (
                        <button
                          type="button"
                          onClick={loadOlderMessages}
                          className="rounded-full bg-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-300"
                        >
                          Load older messages
                        </button>
                      )}
                    </div>
                  )}
                  {messages.map((message) => {
                  const sentByMe = message.sender_id === currentUserId;

                  return (
                    <div
                      key={message.message_id}
                      className={`flex ${sentByMe ? "justify-end" : "justify-start"}`}
                    >
                      <div className="max-w-[70%]">
                        {!sentByMe && (
                          <div className="mb-1 text-xs font-semibold text-gray-500">
                            {message.sender_name || selectedConversation.full_name}
                          </div>
                        )}
                        <div
                          className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                            sentByMe
                              ? "bg-blue-700 text-white"
                              : "bg-white text-gray-800"
                          }`}
                        >
                          {message.content}
                        </div>
                        <div
                          className={`mt-1 text-xs text-gray-500 ${
                            sentByMe ? "text-right" : "text-left"
                          }`}
                        >
                          {formatTime(message.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                  })}
                </>
              )}
            </div>

            {showScrollButton && (
              <button
                type="button"
                onClick={scrollToBottom}
                title="Scroll to latest message"
                className="absolute bottom-24 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-blue-700 text-lg text-white shadow-lg hover:bg-blue-800"
              >
                ↓
              </button>
            )}

            <div className="border-t border-gray-200 bg-white p-4">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Type a message..."
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  className="rounded-lg bg-blue-700 px-5 py-3 text-lg font-bold text-white hover:bg-blue-800"
                >
                  →
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function StaffManagementPanel({ openProfile }) {
  const emptyForm = {
    full_name: "",
    email: "",
    employee_id: "",
    department: "",
    job_title: "",
    phone: "",
    role: "staff",
    work_type: "office",
    password: "",
    joining_date: "",
  };
  const [view, setView] = useState("list");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState(emptyForm);
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [tokenModal, setTokenModal] = useState(null);
  const [copiedTokenField, setCopiedTokenField] = useState("");
  const [salarySlipModal, setSalarySlipModal] = useState(null);
  const [salarySlipDate, setSalarySlipDate] = useState(() => {
    const previousMonth = new Date();
    previousMonth.setMonth(previousMonth.getMonth() - 1);
    return {
      month: previousMonth.getMonth() + 1,
      year: previousMonth.getFullYear(),
    };
  });
  const [downloadingSalarySlip, setDownloadingSalarySlip] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [passwordModal, setPasswordModal] = useState(null);
  const [passwordForm, setPasswordForm] = useState({
    new_password: "",
    confirm_password: "",
  });
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const currentUser = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await api.get("/api/users/list");
      setUsers(response.data);
    } catch (error) {
      toast.error("Could not load staff");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const updateForm = (field, value) => {
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const handleCreateUser = async (event) => {
    event.preventDefault();
    setCreating(true);
    setCreateError("");

    try {
      await api.post("/api/users/create", {
        ...formData,
        joining_date: formData.joining_date || null,
        department: formData.department || null,
        job_title: formData.job_title || null,
        phone: formData.phone || null,
      });
      toast.success("Staff member created successfully");
      setFormData(emptyForm);
      setView("list");
      fetchUsers();
    } catch (error) {
      setCreateError(
        error.response?.data?.detail || "Could not create staff member"
      );
    } finally {
      setCreating(false);
    }
  };

  const showFirstTimeTokenModal = (tokenData, userId) => {
    setTokenModal({
      type: "first_time",
      userId,
      ...tokenData,
    });
  };

  const handleAgentTokenClick = async (userId) => {
    try {
      const statusResponse = await api.get(
        `/api/users/${userId}/agent-token-status`
      );
      if (!statusResponse.data.has_token) {
        const tokenResponse = await api.post(
          `/api/users/${userId}/generate-agent-token`
        );
        showFirstTimeTokenModal(tokenResponse.data, userId);
        return;
      }

      setTokenModal({
        type: "existing",
        userId,
        ...statusResponse.data,
      });
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not load token status");
    }
  };

  const handleRegenerateToken = async () => {
    if (!tokenModal?.userId) {
      return;
    }

    const confirmed = window.confirm(
      "Are you sure? The existing agent will stop working until config.json is updated."
    );
    if (!confirmed) {
      return;
    }

    try {
      const response = await api.post(
        `/api/users/${tokenModal.userId}/generate-agent-token`
      );
      showFirstTimeTokenModal(response.data, tokenModal.userId);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not regenerate token");
    }
  };

  const copyTokenValue = (value, field) => {
    navigator.clipboard.writeText(value);
    setCopiedTokenField(field);
    setTimeout(() => setCopiedTokenField(""), 2000);
  };

  const handleDeactivate = async (userId) => {
    const confirmed = window.confirm("Deactivate this user?");
    if (!confirmed) {
      return;
    }

    try {
      await api.post(`/api/users/${userId}/deactivate`);
      toast.success("User deactivated");
      setUsers((current) =>
        current.map((user) =>
          user.id === userId ? { ...user, is_active: false } : user
        )
      );
    } catch (error) {
      toast.error("Could not deactivate user");
    }
  };

  const openEditModal = (user) => {
    setEditModal(user);
    setEditError("");
    setEditForm({
      full_name: user.full_name || "",
      email: user.email || "",
      phone: user.phone || "",
      department: user.department || "",
      job_title: user.job_title || "",
      work_type: user.work_type || "office",
      base_salary: user.base_salary ?? "",
    });
  };

  const updateEditForm = (field, value) => {
    setEditForm((current) => ({ ...current, [field]: value }));
  };

  const handleSaveEdit = async (event) => {
    event.preventDefault();
    if (!editModal) {
      return;
    }

    const payload = {};
    const fields = [
      "full_name",
      "email",
      "phone",
      "department",
      "job_title",
      "work_type",
      "base_salary",
    ];

    fields.forEach((field) => {
      if (field === "base_salary" && currentUser?.role !== "super_admin") {
        return;
      }

      const originalValue = editModal[field] ?? "";
      const nextValue = editForm[field] ?? "";
      if (String(originalValue) !== String(nextValue)) {
        if (field === "base_salary") {
          payload[field] = nextValue === "" ? 0 : nextValue;
        } else if (["full_name", "email", "work_type"].includes(field)) {
          payload[field] = nextValue;
        } else {
          payload[field] = nextValue || null;
        }
      }
    });

    setSavingEdit(true);
    setEditError("");
    try {
      await api.patch(`/api/users/${editModal.id}`, payload);
      toast.success("Staff details updated");
      setEditModal(null);
      fetchUsers();
    } catch (error) {
      setEditError(error.response?.data?.detail || "Could not update staff details");
    } finally {
      setSavingEdit(false);
    }
  };

  const openPasswordModal = (user) => {
    setPasswordModal(user);
    setPasswordForm({ new_password: "", confirm_password: "" });
    setPasswordError("");
    setShowResetPassword(false);
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    if (!passwordModal) {
      return;
    }

    if (passwordForm.new_password.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordError("Passwords do not match");
      return;
    }

    setResettingPassword(true);
    setPasswordError("");
    try {
      await api.post(`/api/users/${passwordModal.id}/reset-password`, {
        new_password: passwordForm.new_password,
      });
      toast.success("Password reset successfully. Staff member will need to log in again.");
      setPasswordModal(null);
    } catch (error) {
      setPasswordError(error.response?.data?.detail || "Could not reset password");
    } finally {
      setResettingPassword(false);
    }
  };

  const handleSalarySlipDownload = async () => {
    if (!salarySlipModal) {
      return;
    }

    setDownloadingSalarySlip(true);
    try {
      const response = await api.get(
        `/api/attendance/export/salary-slip/${salarySlipModal.id}`,
        {
          params: salarySlipDate,
          responseType: "blob",
        }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `salary_slip_${salarySlipModal.employee_id}_${salarySlipDate.month}_${salarySlipDate.year}.pdf`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setSalarySlipModal(null);
    } catch (error) {
      if (error.response?.status === 400) {
        toast.error("Salary not yet approved for this period");
      } else {
        toast.error("Could not download salary slip");
      }
    } finally {
      setDownloadingSalarySlip(false);
    }
  };

  if (view === "create") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <button
          type="button"
          onClick={() => setView("list")}
          className="mb-5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
        >
          Back
        </button>
        <h3 className="text-2xl font-bold text-gray-900">Add New Staff Member</h3>

        <form onSubmit={handleCreateUser} className="mt-6 grid grid-cols-2 gap-4">
          <input
            type="text"
            required
            value={formData.full_name}
            onChange={(event) => updateForm("full_name", event.target.value)}
            placeholder="Full Name"
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
          />
          <input
            type="email"
            required
            value={formData.email}
            onChange={(event) => updateForm("email", event.target.value)}
            placeholder="Email"
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
          />
          <input
            type="text"
            required
            value={formData.employee_id}
            onChange={(event) => updateForm("employee_id", event.target.value)}
            placeholder="Employee ID"
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
          />
          <input
            type="text"
            value={formData.department}
            onChange={(event) => updateForm("department", event.target.value)}
            placeholder="Department"
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
          />
          <input
            type="text"
            value={formData.job_title}
            onChange={(event) => updateForm("job_title", event.target.value)}
            placeholder="Job Title"
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
          />
          <input
            type="text"
            value={formData.phone}
            onChange={(event) => updateForm("phone", event.target.value)}
            placeholder="Phone"
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
          />
          <select
            value={formData.role}
            onChange={(event) => updateForm("role", event.target.value)}
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
          >
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
          <select
            value={formData.work_type}
            onChange={(event) => updateForm("work_type", event.target.value)}
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
          >
            <option value="office">Office</option>
            <option value="wfh">WFH</option>
          </select>
          <input
            type="password"
            required
            value={formData.password}
            onChange={(event) => updateForm("password", event.target.value)}
            placeholder="Password"
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
          />
          <input
            type="date"
            value={formData.joining_date}
            onChange={(event) => updateForm("joining_date", event.target.value)}
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
          />

          {createError && (
            <div className="col-span-2 text-sm font-medium text-red-600">
              {createError}
            </div>
          )}

          <button
            type="submit"
            disabled={creating}
            className="col-span-2 rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {creating ? "Creating..." : "Create Staff Member"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-bold text-gray-900">Staff Management</h3>
        <button
          type="button"
          onClick={() => setView("create")}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
        >
          Add Staff Member
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading staff...</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Full Name</th>
                <th className="px-4 py-3">Employee ID</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Work Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    <div className="flex items-center gap-2">
                      <span>{user.full_name}</span>
                      <span className="group relative inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                        i
                        <span className="pointer-events-none absolute left-1/2 top-7 z-20 hidden w-64 -translate-x-1/2 rounded-lg bg-gray-900 p-3 text-left text-xs font-medium text-white shadow-lg group-hover:block">
                          <span className="block">
                            Email: {user.email || "N/A"}
                          </span>
                          <span className="mt-1 block">
                            Phone: {user.phone || "N/A"}
                          </span>
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{user.employee_id}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {user.department || "N/A"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        user.role === "admin"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {user.work_type === "wfh" ? "WFH" : "Office"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        user.is_active
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {user.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openProfile(user.id || user.user_id)}
                        className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                      >
                        View Profile
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(user)}
                        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => openPasswordModal(user)}
                        className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600"
                      >
                        Reset Password
                      </button>
                      {(user.role === "staff" || user.role === "admin") && (
                        <button
                          type="button"
                          onClick={() => handleAgentTokenClick(user.id)}
                          className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200"
                        >
                          Agent Token
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setSalarySlipModal(user)}
                        className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700"
                      >
                        Salary Slip
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeactivate(user.id)}
                        className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
                      >
                        Deactivate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900">Edit Staff Details</h3>
            <p className="mt-1 text-sm text-gray-500">{editModal.full_name}</p>

            <form onSubmit={handleSaveEdit} className="mt-6 grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  Full Name
                </span>
                <input
                  type="text"
                  value={editForm.full_name || ""}
                  onChange={(event) => updateEditForm("full_name", event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  Email
                </span>
                <input
                  type="email"
                  value={editForm.email || ""}
                  onChange={(event) => updateEditForm("email", event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  Phone
                </span>
                <input
                  type="text"
                  value={editForm.phone || ""}
                  onChange={(event) => updateEditForm("phone", event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  Department
                </span>
                <input
                  type="text"
                  value={editForm.department || ""}
                  onChange={(event) =>
                    updateEditForm("department", event.target.value)
                  }
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  Job Title
                </span>
                <input
                  type="text"
                  value={editForm.job_title || ""}
                  onChange={(event) => updateEditForm("job_title", event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  Work Type
                </span>
                <select
                  value={editForm.work_type || "office"}
                  onChange={(event) => updateEditForm("work_type", event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                >
                  <option value="office">Office</option>
                  <option value="wfh">WFH</option>
                </select>
              </label>

              {currentUser?.role === "super_admin" && (
                <label className="col-span-2 block">
                  <span className="mb-2 block text-sm font-medium text-gray-700">
                    Base Salary
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.base_salary ?? ""}
                    onChange={(event) =>
                      updateEditForm("base_salary", event.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                  />
                </label>
              )}

              {editError && (
                <div className="col-span-2 text-sm font-medium text-red-600">
                  {editError}
                </div>
              )}

              <div className="col-span-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditModal(null)}
                  className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {passwordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900">Reset Password</h3>
            <p className="mt-1 text-sm text-gray-500">{passwordModal.full_name}</p>

            <form onSubmit={handleResetPassword} className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  New Password
                </span>
                <input
                  type={showResetPassword ? "text" : "password"}
                  value={passwordForm.new_password}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      new_password: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  Confirm Password
                </span>
                <input
                  type={showResetPassword ? "text" : "password"}
                  value={passwordForm.confirm_password}
                  onChange={(event) =>
                    setPasswordForm((current) => ({
                      ...current,
                      confirm_password: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={showResetPassword}
                  onChange={(event) => setShowResetPassword(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Show password
              </label>

              {passwordError && (
                <div className="text-sm font-medium text-red-600">
                  {passwordError}
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPasswordModal(null)}
                  className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resettingPassword}
                  className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {resettingPassword ? "Resetting..." : "Reset Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            {tokenModal.type === "first_time" ? (
              <>
                <div className="rounded-lg bg-yellow-100 px-4 py-3 text-sm font-semibold text-yellow-900">
                  ⚠️ Copy this token now — it cannot be viewed again in full
                </div>
                <h3 className="mt-5 text-xl font-bold text-gray-900">
                  Agent Token
                </h3>
                <div className="mt-5 space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">
                      Machine Token:
                    </label>
                    <div className="flex gap-2">
                      <div className="min-w-0 flex-1 rounded-lg bg-gray-100 p-4 font-mono text-sm text-gray-900">
                        {tokenModal.machine_token}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          copyTokenValue(tokenModal.machine_token, "token")
                        }
                        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                      >
                        {copiedTokenField === "token" ? "Copied ✓" : "Copy Token"}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-gray-700">
                      Staff ID:
                    </label>
                    <div className="flex gap-2">
                      <div className="min-w-0 flex-1 rounded-lg bg-gray-100 p-4 font-mono text-sm text-gray-900">
                        {tokenModal.staff_id}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          copyTokenValue(tokenModal.staff_id, "staff_id")
                        }
                        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                      >
                        {copiedTokenField === "staff_id"
                          ? "Copied ✓"
                          : "Copy Staff ID"}
                      </button>
                    </div>
                  </div>
                </div>
                <p className="mt-5 text-sm text-gray-600">
                  Add both values to config.json on the staff member's PC
                </p>
                <button
                  type="button"
                  onClick={() => setTokenModal(null)}
                  className="mt-6 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <h3 className="text-xl font-bold text-gray-900">
                  Existing Token
                </h3>
                <p className="mt-3 text-sm text-gray-700">
                  An agent token already exists for this staff member
                </p>
                <div className="mt-5 rounded-lg bg-gray-100 p-4 text-sm text-gray-800">
                  Active token:{" "}
                  <span className="font-mono">{tokenModal.token_preview}</span>
                </div>
                <div className="mt-3 text-sm text-gray-600">
                  Generated on: {formatDate(tokenModal.created_at)}
                </div>
                <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-800">
                  This will invalidate the existing agent installation. IT will
                  need to update config.json on the staff member's PC.
                </div>
                <div className="mt-6 flex gap-3">
                  <button
                    type="button"
                    onClick={handleRegenerateToken}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    Regenerate Token
                  </button>
                  <button
                    type="button"
                    onClick={() => setTokenModal(null)}
                    className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {salarySlipModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900">Download Salary Slip</h3>
            <p className="mt-2 text-sm text-gray-600">
              {salarySlipModal.full_name}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  Month
                </span>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={salarySlipDate.month}
                  onChange={(event) =>
                    setSalarySlipDate((current) => ({
                      ...current,
                      month: parseInt(event.target.value, 10) || 1,
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  Year
                </span>
                <input
                  type="number"
                  value={salarySlipDate.year}
                  onChange={(event) =>
                    setSalarySlipDate((current) => ({
                      ...current,
                      year: parseInt(event.target.value, 10) || new Date().getFullYear(),
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setSalarySlipModal(null)}
                className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSalarySlipDownload}
                disabled={downloadingSalarySlip}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {downloadingSalarySlip ? "Downloading..." : "Download PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`flex h-7 w-12 items-center rounded-full p-1 transition ${
        value ? "bg-blue-700" : "bg-gray-300"
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow transition ${
          value ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function SettingsPanel() {
  const [activeTab, setActiveTab] = useState("monitoring");
  const [config, setConfig] = useState(null);
  const [monitoringSettings, setMonitoringSettings] = useState({
    idle_timeout_minutes: 10,
    break_limit_minutes: 60,
    working_hours_start: "09:00",
    working_hours_end: "18:00",
    working_days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    screenshot_enabled: true,
    screenshot_interval_seconds: 600,
    monitoring_enabled: true,
  });
  const [securitySettings, setSecuritySettings] = useState({
    failed_login_lockout_attempts: 5,
    lockout_duration_minutes: 30,
    password_min_length: 8,
  });
  const [chatSettings, setChatSettings] = useState({
    chat_enabled: true,
    staff_to_staff_chat_enabled: true,
    read_receipts_enabled: true,
    chat_retention_months: 6,
  });
  const [attendanceSettings, setAttendanceSettings] = useState({
    working_days_per_month: 22,
    currency_symbol: "₹",
    salary_visibility_to_staff: false,
    daily_report_enabled: true,
    report_deadline_time: "21:00",
  });
  const [leaveSettings, setLeaveSettings] = useState({
    half_day_leave_enabled: false,
    leave_carry_forward: false,
  });
  const [loading, setLoading] = useState(true);
  const [newLeaveType, setNewLeaveType] = useState({
    name: "",
    annual_limit: 1,
    carry_forward: false,
  });
  const currentUser = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);
  const fileInputRef = useRef(null);
  const [logoExists, setLogoExists] = useState(false);
  const [logoTimestamp, setLogoTimestamp] = useState(Date.now());
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await api.get("/api/settings/config");
        setConfig(response.data);
      } catch (error) {
        toast.error("Could not load settings");
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }

    setMonitoringSettings({
      idle_timeout_minutes: config.idle_timeout_minutes ?? 10,
      break_limit_minutes: config.break_limit_minutes ?? 60,
      working_hours_start: config.working_hours_start || "09:00",
      working_hours_end: config.working_hours_end || "18:00",
      working_days: config.working_days ?? [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
      ],
      screenshot_enabled: config.screenshot_enabled ?? true,
      screenshot_interval_seconds: config.screenshot_interval_seconds ?? 600,
      monitoring_enabled: config.monitoring_enabled ?? true,
    });
    setSecuritySettings({
      failed_login_lockout_attempts: config.failed_login_lockout_attempts ?? 5,
      lockout_duration_minutes: config.lockout_duration_minutes ?? 30,
      password_min_length: config.password_min_length ?? 8,
    });
    setChatSettings({
      chat_enabled: config.chat_enabled ?? true,
      staff_to_staff_chat_enabled: config.staff_to_staff_chat_enabled ?? true,
      read_receipts_enabled: config.read_receipts_enabled ?? true,
      chat_retention_months: config.chat_retention_months ?? 6,
    });
    setAttendanceSettings({
      working_days_per_month: config.working_days_per_month ?? 22,
      currency_symbol: config.currency_symbol ?? "₹",
      salary_visibility_to_staff: config.salary_visibility_to_staff ?? false,
      daily_report_enabled: config.daily_report_enabled ?? true,
      report_deadline_time: config.report_deadline_time || "21:00",
    });
    setLeaveSettings({
      half_day_leave_enabled: config.half_day_leave_enabled ?? false,
      leave_carry_forward: config.leave_carry_forward ?? false,
    });
  }, [config]);

  useEffect(() => {
    if (!currentUser?.company_id) return;
    const apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
    fetch(`${apiBase}/api/settings/logo/file?company_id=${currentUser.company_id}`)
      .then((response) => setLogoExists(response.ok))
      .catch(() => setLogoExists(false));
  }, []);

  const tabs = [
    { id: "monitoring", label: "Monitoring" },
    { id: "security", label: "Security" },
    { id: "chat", label: "Chat" },
    { id: "attendance", label: "Attendance & Salary" },
    { id: "leave", label: "Leave Management" },
    { id: "branding", label: "Branding" },
  ];

  const days = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];

  const updateConfig = (key, value) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  const toggleWorkingDay = (day) => {
    const workingDays = monitoringSettings.working_days || [];
    setMonitoringSettings((current) => ({
      ...current,
      working_days: workingDays.includes(day)
        ? workingDays.filter((item) => item !== day)
        : [...workingDays, day],
    }));
  };

  const saveSettings = async (payload) => {
    try {
      const response = await api.patch("/api/settings/config", payload);
      setConfig(response.data);
      toast.success("Settings saved");
    } catch (error) {
      toast.error("Could not save settings");
    }
  };

  const deleteLeaveType = async (name) => {
    try {
      await api.delete(`/api/settings/leave-types/${encodeURIComponent(name)}`);
      updateConfig(
        "leave_types",
        (config.leave_types || []).filter((leaveType) => leaveType.name !== name)
      );
      toast.success("Leave type removed");
    } catch (error) {
      toast.error("Could not remove leave type");
    }
  };

  const addLeaveType = async () => {
    if (!newLeaveType.name.trim() || Number(newLeaveType.annual_limit) <= 0) {
      toast.error("Enter a valid leave type");
      return;
    }

    try {
      const response = await api.post("/api/settings/leave-types", {
        name: newLeaveType.name,
        annual_limit: Number(newLeaveType.annual_limit),
        carry_forward: newLeaveType.carry_forward,
      });
      updateConfig("leave_types", response.data);
      setNewLeaveType({ name: "", annual_limit: 1, carry_forward: false });
      toast.success("Leave type added");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not add leave type");
    }
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setSelectedFile(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleLogoUpload = async () => {
    if (!selectedFile) return;
    const formData = new FormData();
    formData.append("file", selectedFile);
    setUploading(true);
    try {
      await api.post("/api/settings/logo", formData);
      toast.success("Logo uploaded successfully");
      setLogoExists(true);
      setLogoTimestamp(Date.now());
      setSelectedFile(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not upload logo");
    } finally {
      setUploading(false);
    }
  };

  const handleLogoDelete = async () => {
    if (!window.confirm("Delete the company logo?")) return;
    setDeleting(true);
    try {
      await api.delete("/api/settings/logo");
      toast.success("Logo deleted");
      setLogoExists(false);
    } catch (error) {
      toast.error("Could not delete logo");
    } finally {
      setDeleting(false);
    }
  };

  const renderNumberInput = (label, field, state, setState, min, max) => (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-gray-700">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={state[field] ?? ""}
        onChange={(event) =>
          setState((current) => ({
            ...current,
            [field]: parseInt(event.target.value, 10) || 0,
          }))
        }
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
      />
    </label>
  );

  const renderTextInput = (label, field, state, setState, maxLength) => (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-gray-700">{label}</span>
      <input
        type="text"
        maxLength={maxLength}
        value={state[field] ?? ""}
        onChange={(event) =>
          setState((current) => ({ ...current, [field]: event.target.value }))
        }
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
      />
    </label>
  );

  const renderTimeInput = (label, field, state, setState, fallback) => (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-gray-700">{label}</span>
      <input
        type="time"
        value={state[field] || fallback}
        onChange={(event) =>
          setState((current) => ({ ...current, [field]: event.target.value }))
        }
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
      />
    </label>
  );

  const renderToggleRow = (label, field, state, setState) => (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <ToggleSwitch
        value={Boolean(state[field])}
        onChange={(value) =>
          setState((current) => ({ ...current, [field]: value }))
        }
      />
    </div>
  );

  if (loading || !config) {
    return (
      <div className="flex min-h-80 items-center justify-center text-gray-500">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              activeTab === tab.id
                ? "bg-blue-700 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {activeTab === "monitoring" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              {renderNumberInput(
                "Idle timeout (minutes)",
                "idle_timeout_minutes",
                monitoringSettings,
                setMonitoringSettings,
                5,
                60
              )}
              {renderNumberInput(
                "Break limit (minutes)",
                "break_limit_minutes",
                monitoringSettings,
                setMonitoringSettings,
                15,
                240
              )}
              {renderTimeInput(
                "Working hours start",
                "working_hours_start",
                monitoringSettings,
                setMonitoringSettings,
                "09:00"
              )}
              {renderTimeInput(
                "Working hours end",
                "working_hours_end",
                monitoringSettings,
                setMonitoringSettings,
                "18:00"
              )}
              {renderNumberInput(
                "Screenshot interval (seconds)",
                "screenshot_interval_seconds",
                monitoringSettings,
                setMonitoringSettings,
                10,
                3600
              )}
              {renderToggleRow(
                "Enable screenshot capture",
                "screenshot_enabled",
                monitoringSettings,
                setMonitoringSettings
              )}
              {renderToggleRow(
                "Enable monitoring",
                "monitoring_enabled",
                monitoringSettings,
                setMonitoringSettings
              )}
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-gray-700">
                Working days
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {days.map((day) => (
                  <label key={day} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={(monitoringSettings.working_days || []).includes(day)}
                      onChange={() => toggleWorkingDay(day)}
                    />
                    {day}
                  </label>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => saveSettings(monitoringSettings)}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Save Changes
            </button>
          </div>
        )}

        {activeTab === "security" && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-4">
              {renderNumberInput(
                "Failed login lockout attempts",
                "failed_login_lockout_attempts",
                securitySettings,
                setSecuritySettings,
                3,
                10
              )}
              {renderNumberInput(
                "Lockout duration (minutes)",
                "lockout_duration_minutes",
                securitySettings,
                setSecuritySettings
              )}
              {renderNumberInput(
                "Password minimum length",
                "password_min_length",
                securitySettings,
                setSecuritySettings,
                6,
                20
              )}
            </div>
            <button
              type="button"
              onClick={() => saveSettings(securitySettings)}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Save Changes
            </button>
          </div>
        )}

        {activeTab === "chat" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              {renderToggleRow(
                "Chat enabled",
                "chat_enabled",
                chatSettings,
                setChatSettings
              )}
              {renderToggleRow(
                "Staff to staff chat enabled",
                "staff_to_staff_chat_enabled",
                chatSettings,
                setChatSettings
              )}
              {renderToggleRow(
                "Read receipts enabled",
                "read_receipts_enabled",
                chatSettings,
                setChatSettings
              )}
              {renderNumberInput(
                "Chat retention months",
                "chat_retention_months",
                chatSettings,
                setChatSettings
              )}
            </div>
            <button
              type="button"
              onClick={() => saveSettings(chatSettings)}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Save Changes
            </button>
          </div>
        )}

        {activeTab === "attendance" && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              {renderNumberInput(
                "Working days per month",
                "working_days_per_month",
                attendanceSettings,
                setAttendanceSettings
              )}
              {renderTextInput(
                "Currency symbol",
                "currency_symbol",
                attendanceSettings,
                setAttendanceSettings,
                3
              )}
              {renderTimeInput(
                "Report deadline time",
                "report_deadline_time",
                attendanceSettings,
                setAttendanceSettings,
                "21:00"
              )}
              {renderToggleRow(
                "Salary visibility to staff",
                "salary_visibility_to_staff",
                attendanceSettings,
                setAttendanceSettings
              )}
              {renderToggleRow(
                "Daily report enabled",
                "daily_report_enabled",
                attendanceSettings,
                setAttendanceSettings
              )}
            </div>
            <button
              type="button"
              onClick={() => saveSettings(attendanceSettings)}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Save Changes
            </button>
          </div>
        )}

        {activeTab === "leave" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              {renderToggleRow(
                "Half day leave enabled",
                "half_day_leave_enabled",
                leaveSettings,
                setLeaveSettings
              )}
              {renderToggleRow(
                "Leave carry forward",
                "leave_carry_forward",
                leaveSettings,
                setLeaveSettings
              )}
            </div>

            <div className="grid gap-3">
              {(config.leave_types || []).map((leaveType) => (
                <div
                  key={leaveType.name}
                  className="flex items-center justify-between rounded-lg border border-gray-200 p-4"
                >
                  <div>
                    <div className="font-semibold text-gray-900">{leaveType.name}</div>
                    <div className="text-sm text-gray-500">
                      Annual limit: {leaveType.annual_limit}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteLeaveType(leaveType.name)}
                    className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-4 gap-3 rounded-lg bg-gray-50 p-4">
              <input
                type="text"
                value={newLeaveType.name}
                onChange={(event) =>
                  setNewLeaveType((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Name"
                className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
              />
              <input
                type="number"
                value={newLeaveType.annual_limit}
                onChange={(event) =>
                  setNewLeaveType((current) => ({
                    ...current,
                    annual_limit: event.target.value,
                  }))
                }
                placeholder="Annual limit"
                className="rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
              />
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4">
                <span className="text-sm text-gray-700">Carry forward</span>
                <ToggleSwitch
                  value={newLeaveType.carry_forward}
                  onChange={(value) =>
                    setNewLeaveType((current) => ({
                      ...current,
                      carry_forward: value,
                    }))
                  }
                />
              </div>
              <button
                type="button"
                onClick={addLeaveType}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
              >
                Add Leave Type
              </button>
            </div>

            <button
              type="button"
              onClick={() => saveSettings(leaveSettings)}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Save Changes
            </button>
          </div>
        )}

        {activeTab === "branding" && (
          <div className="space-y-6">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Company Logo</h3>
              <p className="mt-1 text-sm text-gray-500">Maximum 2MB. PNG or JPG.</p>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-gray-200 bg-gray-50">
                {logoExists ? (
                  <img
                    key={logoTimestamp}
                    src={`${import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"}/api/settings/logo/file?company_id=${currentUser?.company_id}&t=${logoTimestamp}`}
                    alt="Company logo"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-2xl font-bold text-gray-400">
                    {(currentUser?.full_name || "Co").slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-600">
                {logoExists ? "Current logo" : "No logo uploaded yet"}
              </p>
            </div>

            {previewUrl && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">Preview</p>
                <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border-2 border-blue-200 bg-gray-50">
                  <img
                    src={previewUrl}
                    alt="Logo preview"
                    className="h-full w-full object-contain"
                  />
                </div>
                <p className="text-xs text-gray-500">{selectedFile?.name}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png"
                className="hidden"
                onChange={handleFileSelect}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Choose File
              </button>
              {selectedFile && (
                <button
                  type="button"
                  onClick={handleLogoUpload}
                  disabled={uploading}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {uploading ? "Uploading..." : "Upload Logo"}
                </button>
              )}
              {logoExists && !selectedFile && (
                <button
                  type="button"
                  onClick={handleLogoDelete}
                  disabled={deleting}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {deleting ? "Deleting..." : "Delete Logo"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScreenshotsPanel() {
  const [staffList, setStaffList] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  });
  const [screenshots, setScreenshots] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [modalIndex, setModalIndex] = useState(null);
  const perPage = 20;

  useEffect(() => {
    const fetchStaff = async () => {
      try {
        const response = await api.get("/api/users/list");
        setStaffList(response.data.filter((u) => u.role === "staff" || u.role === "admin"));
      } catch (error) {
        toast.error("Could not load staff members");
      }
    };

    fetchStaff();
  }, []);

  useEffect(() => {
    return () => {
      screenshots.forEach((screenshot) => {
        if (screenshot.image_url) {
          URL.revokeObjectURL(screenshot.image_url);
        }
      });
    };
  }, [screenshots]);

  const loadScreenshots = async (nextPage = page) => {
    if (!selectedUserId) {
      return;
    }

    setLoading(true);
    try {
      const response = await api.get(`/api/screenshots/${selectedUserId}`, {
        params: {
          date: selectedDate,
          page: nextPage,
          per_page: perPage,
        },
      });

      const screenshotsWithImages = await Promise.all(
        response.data.screenshots.map(async (screenshot) => {
          const imageResponse = await api.get(
            `/api/screenshots/file/${screenshot.id}`,
            { responseType: "blob" }
          );
          return {
            ...screenshot,
            image_url: URL.createObjectURL(imageResponse.data),
          };
        })
      );

      setScreenshots(screenshotsWithImages);
      setTotal(response.data.total);
      setPage(response.data.page);
    } catch (error) {
      toast.error("Could not load screenshots");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (screenshotId) => {
    const confirmed = window.confirm("Delete this screenshot?");
    if (!confirmed) {
      return;
    }

    try {
      await api.delete(`/api/screenshots/${screenshotId}`);
      toast.success("Screenshot deleted");
      loadScreenshots(page);
    } catch (error) {
      toast.error("Could not delete screenshot");
    }
  };

  const selectedStaff = staffList.find((staff) => staff.id === selectedUserId);
  const showingStart = total === 0 ? 0 : (page - 1) * perPage + 1;
  const showingEnd = Math.min(page * perPage, total);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const modalScreenshot = modalIndex !== null ? screenshots[modalIndex] : null;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-gray-700">
              Staff member
            </span>
            <select
              value={selectedUserId}
              onChange={(event) => {
                setSelectedUserId(event.target.value);
                setScreenshots([]);
                setTotal(0);
                setPage(1);
              }}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
            >
              <option value="">Select staff member</option>
              {staffList.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.full_name} ({staff.employee_id})
                </option>
              ))}
            </select>
          </label>

          {selectedUserId && (
            <>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">
                  Date
                </span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(event) => {
                    setSelectedDate(event.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => loadScreenshots(1)}
                  className="w-full rounded-lg bg-blue-700 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  Load Screenshots
                </button>
              </div>
            </>
          )}
        </div>

        {!selectedUserId && (
          <div className="mt-8 rounded-xl bg-gray-50 p-8 text-center text-gray-500">
            Select a staff member to view screenshots
          </div>
        )}
        {selectedStaff && (
          <div className="mt-4 text-sm text-gray-500">
            Viewing screenshots for {selectedStaff.full_name}
          </div>
        )}
      </div>

      {selectedUserId && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {loading ? (
            <div className="py-16 text-center text-gray-500">
              Loading screenshots...
            </div>
          ) : screenshots.length === 0 ? (
            <div className="py-16 text-center text-gray-500">
              No screenshots found for this date
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {screenshots.map((screenshot, index) => (
                  <div
                    key={screenshot.id}
                    className="group overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
                  >
                    <button
                      type="button"
                      onClick={() => setModalIndex(index)}
                      className="block w-full"
                    >
                      <img
                        src={screenshot.image_url}
                        alt={`Screenshot ${formatTime(screenshot.captured_at)}`}
                        className="aspect-video w-full object-cover"
                      />
                    </button>
                    <div className="flex items-center justify-between gap-3 p-3 text-xs text-gray-600">
                      <div>
                        <div className="font-semibold text-gray-900">
                          {formatTime(screenshot.captured_at)}
                        </div>
                        <div>{screenshot.file_size_kb || 0} KB</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDelete(screenshot.id)}
                        className="rounded-lg bg-red-600 px-3 py-2 text-white opacity-0 transition hover:bg-red-700 group-hover:opacity-100"
                        title="Delete screenshot"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex items-center justify-between gap-4 text-sm text-gray-600">
                <div>
                  Showing {showingStart}-{showingEnd} of {total} screenshots
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => loadScreenshots(page - 1)}
                    disabled={page <= 1}
                    className="rounded-lg bg-gray-100 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => loadScreenshots(page + 1)}
                    disabled={page >= totalPages}
                    className="rounded-lg bg-gray-100 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {modalScreenshot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4"
          onClick={() => setModalIndex(null)}
        >
          <div
            className="relative max-h-[92vh] w-full max-w-6xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setModalIndex(null)}
              className="absolute right-0 top-0 z-10 rounded-bl-lg bg-white px-4 py-2 text-sm font-semibold text-gray-700"
            >
              Close
            </button>
            <img
              src={modalScreenshot.image_url}
              alt="Screenshot full size"
              className="max-h-[82vh] w-full rounded-lg object-contain"
            />
            <div className="mt-3 flex items-center justify-between rounded-lg bg-white p-4 text-sm text-gray-700">
              <button
                type="button"
                onClick={() => setModalIndex((current) => Math.max(0, current - 1))}
                disabled={modalIndex <= 0}
                className="rounded-lg bg-gray-100 px-4 py-2 font-semibold hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <div className="text-center">
                <div className="font-semibold text-gray-900">
                  {formatDateTime(modalScreenshot.captured_at)}
                </div>
                <div>
                  {modalScreenshot.width || "?"} x {modalScreenshot.height || "?"} ·{" "}
                  {modalScreenshot.file_size_kb || 0} KB
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setModalIndex((current) =>
                    Math.min(screenshots.length - 1, current + 1)
                  )
                }
                disabled={modalIndex >= screenshots.length - 1}
                className="rounded-lg bg-gray-100 px-4 py-2 font-semibold hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LogoDisplay({ user }) {
  const [logoError, setLogoError] = useState(false);
  const apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
  const logoSrc = user?.company_id
    ? `${apiBase}/api/settings/logo/file?company_id=${user.company_id}`
    : null;

  const companyLogo = logoSrc && !logoError ? (
    <img
      src={logoSrc}
      alt="Company logo"
      style={{ maxHeight: "40px" }}
      className="object-contain"
      onError={() => setLogoError(true)}
    />
  ) : (
    <span className="text-lg font-semibold text-blue-100">
      {user?.company_name || "Company"}
    </span>
  );

  if (user?.role === "super_admin") {
    return (
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold">WorkFlow</span>
        {companyLogo}
      </div>
    );
  }

  return companyLogo;
}

const TASK_STATUS_LABELS = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Done",
};

const TASK_STATUS_COLORS = {
  pending: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  done: "bg-green-100 text-green-800",
};

function TasksPanel() {
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
    const fetchStaff = async () => {
      try {
        const response = await api.get("/api/users/list");
        setStaffList(response.data.filter((u) => u.role === "staff"));
      } catch {
        // staff list optional; leave empty
      }
    };
    fetchStaff();
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [statusFilter, assigneeFilter]);

  const openAssignModal = () => {
    setAssignForm({ title: "", description: "", assigned_to: "", due_date: "" });
    setAssignError("");
    setShowAssignModal(true);
  };

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
      fetchTasks();
    } catch (err) {
      setAssignError(err.response?.data?.detail || "Could not assign task");
    } finally {
      setSubmittingAssign(false);
    }
  };

  const openEditModal = (task) => {
    setEditTask(task);
    setEditForm({
      title: task.title,
      description: task.description,
      due_date: task.due_date || "",
    });
    setEditError("");
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
      setTasks((prev) => prev.map((t) => (t.id === taskId ? response.data.task : t)));
    } catch {
      toast.error("Could not update status");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-3">
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
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
          >
            <option value="">All Staff</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>{s.full_name}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={openAssignModal}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
        >
          + Assign Task
        </button>
      </div>

      {/* Task table */}
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
                  <th className="px-5 py-3 text-left font-semibold text-gray-600">Created</th>
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
                    <td className="px-5 py-4 text-gray-600">
                      {task.due_date ? formatDate(task.due_date) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-5 py-4 text-gray-600">{task.assigned_by_name}</td>
                    <td className="px-5 py-4 text-gray-500">{formatDate(task.created_at)}</td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(task)}
                          className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(task.id)}
                          disabled={deletingId === task.id}
                          className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-60"
                        >
                          {deletingId === task.id ? "..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Assign Task Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-gray-900">Assign New Task</h2>
            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Assign To</label>
                <select
                  value={assignForm.assigned_to}
                  onChange={(e) => setAssignForm((f) => ({ ...f, assigned_to: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select staff member...</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>{s.full_name} ({s.employee_id})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Task Title</label>
                <input
                  type="text"
                  value={assignForm.title}
                  onChange={(e) => setAssignForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Prepare monthly report"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={assignForm.description}
                  onChange={(e) => setAssignForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Describe what needs to be done..."
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Due Date <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="date"
                  value={assignForm.due_date}
                  onChange={(e) => setAssignForm((f) => ({ ...f, due_date: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              {assignError && <p className="text-sm text-red-600">{assignError}</p>}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssignSubmit}
                disabled={submittingAssign}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
              >
                {submittingAssign ? "Assigning..." : "Assign Task"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Task Modal */}
      {editTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-gray-900">Edit Task</h2>
            <p className="mt-1 text-sm text-gray-500">
              Assigned to: <span className="font-medium">{editTask.assigned_to_name}</span>
            </p>
            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Task Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Due Date <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="date"
                  value={editForm.due_date}
                  onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                {editForm.due_date && (
                  <button
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, due_date: "" }))}
                    className="mt-1 text-xs text-gray-400 hover:text-red-500"
                  >
                    Clear due date
                  </button>
                )}
              </div>
              {editError && <p className="text-sm text-red-600">{editError}</p>}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditTask(null)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEditSubmit}
                disabled={submittingEdit}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
              >
                {submittingEdit ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MyDayPanel() {
  const user = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);

  const [attendance, setAttendance] = useState(null);
  const [workMode, setWorkMode] = useState("office");
  const [loadingAttendance, setLoadingAttendance] = useState(true);
  const [currentStatus, setCurrentStatus] = useState("not_started");
  const [breakStartedAt, setBreakStartedAt] = useState(null);
  const [checkingAgentConnection, setCheckingAgentConnection] = useState(false);
  const [showEndDayModal, setShowEndDayModal] = useState(false);
  const [reportContent, setReportContent] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const intervalId = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  const fetchAttendance = async () => {
    try {
      const response = await api.get("/api/attendance/today");
      setAttendance(response.data);
      if (response.data?.work_mode) {
        setWorkMode(response.data.work_mode);
      }
      setCurrentStatus((prev) => {
        if (!response.data?.started) return "not_started";
        if (response.data.logout_time) return "ended";
        if (prev === "break" || prev === "meeting") return prev;
        return "active";
      });
    } catch {
      toast.error("Could not load today's attendance");
    } finally {
      setLoadingAttendance(false);
    }
  };

  useEffect(() => {
    fetchAttendance();
    const intervalId = setInterval(fetchAttendance, 30000);
    return () => clearInterval(intervalId);
  }, []);

  const handleStartDay = async () => {
    setCheckingAgentConnection(true);
    try {
      const checkResponse = await api.get("/api/attendance/today");
      if (checkResponse.data?.agent_connected === false) {
        toast.error("Agent not connected. Please ensure the WorkFlow Agent is running.");
        return;
      }
    } catch {
      // proceed
    } finally {
      setCheckingAgentConnection(false);
    }

    try {
      const response = await api.post("/api/attendance/start-day", { work_mode: workMode });
      toast.success("Day started");
      setAttendance({
        started: true,
        logged_in: true,
        report_submitted: false,
        is_present: false,
        work_mode: response.data.work_mode,
        login_time: new Date().toISOString(),
        logout_time: null,
        working_minutes: 0,
        working_minutes_so_far: 0,
        agent_connected: true,
      });
      setCurrentStatus("active");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not start day");
    }
  };

  const handleStartBreak = async () => {
    try {
      const response = await api.post("/api/status/break/start");
      setCurrentStatus("break");
      setBreakStartedAt(response.data.break_started_at);
      toast.success("Break started");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not start break");
    }
  };

  const handleEndBreak = async () => {
    try {
      const response = await api.post("/api/status/break/end");
      setCurrentStatus("active");
      setBreakStartedAt(null);
      toast.success(`Break ended — ${response.data.break_duration_minutes} minutes`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not end break");
    }
  };

  const handleStartMeeting = async () => {
    try {
      await api.post("/api/status/meeting/start");
      setCurrentStatus("meeting");
      toast.success("Meeting started");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not start meeting");
    }
  };

  const handleEndMeeting = async () => {
    try {
      await api.post("/api/status/meeting/end");
      setCurrentStatus("active");
      toast.success("Meeting ended");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not end meeting");
    }
  };

  const handleEndDay = async () => {
    const cleanReport = reportContent.trim();
    if (!cleanReport) {
      toast.error("Daily report is required");
      return;
    }

    setSubmittingReport(true);
    try {
      await api.post("/api/attendance/end-day", { report_content: cleanReport });
      toast.success("Day ended successfully");
      setShowEndDayModal(false);
      setReportContent("");
      fetchAttendance();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not end day");
    } finally {
      setSubmittingReport(false);
    }
  };

  const breakDurationMinutes = breakStartedAt
    ? Math.max(0, Math.floor((currentTime - new Date(breakStartedAt)) / 60000))
    : 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-6 text-xl font-bold text-gray-900">My Day</h2>

      {loadingAttendance ? (
        <div className="text-center text-gray-500">Loading work day...</div>
      ) : !attendance?.started ? (
        <div className="space-y-6">
          <p className="text-gray-600">Start your monitored work session for today.</p>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Work mode</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setWorkMode("office")}
                className={`rounded-lg px-4 py-3 text-sm font-semibold ${
                  workMode === "office"
                    ? "bg-blue-700 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Office
              </button>
              <button
                type="button"
                onClick={() => setWorkMode("wfh")}
                className={`rounded-lg px-4 py-3 text-sm font-semibold ${
                  workMode === "wfh"
                    ? "bg-blue-700 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                WFH
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={handleStartDay}
            disabled={checkingAgentConnection}
            className="w-full rounded-lg bg-green-600 px-5 py-4 text-lg font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {checkingAgentConnection ? "Checking agent connection..." : "Start My Day"}
          </button>
        </div>
      ) : attendance.logout_time ? (
        <div className="text-center">
          <h3 className="text-2xl font-bold text-gray-900">Your day has ended!</h3>
          <p className="mt-3 text-gray-600">
            Working hours: {formatElapsedDuration(attendance.login_time, attendance.logout_time)}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <div className="rounded-xl bg-gray-50 p-4">
              <div className="text-sm text-gray-500">Login time</div>
              <div className="mt-1 font-bold text-gray-900">
                {formatTime(attendance.login_time)}
              </div>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <div className="text-sm text-gray-500">Working hours so far</div>
              <div className="mt-1 font-bold text-gray-900">
                {minutesToHours(attendance.working_minutes_so_far ?? 0)}
              </div>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <div className="text-sm text-gray-500">Work mode</div>
              <div className="mt-1 font-bold text-gray-900">
                {attendance.work_mode?.toUpperCase() || "N/A"}
              </div>
            </div>
            <div className="rounded-xl bg-gray-50 p-4">
              <div className="text-sm text-gray-500">Idle time</div>
              <div className="mt-1 font-bold text-gray-900">
                {minutesToHours(attendance.idle_minutes || 0)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={currentStatus === "break" ? handleEndBreak : handleStartBreak}
              className="rounded-lg bg-orange-400 px-4 py-3 font-semibold text-orange-950 hover:bg-orange-500"
            >
              {currentStatus === "break"
                ? `End Break (${breakDurationMinutes} min)`
                : "Start Break"}
            </button>
            <button
              type="button"
              onClick={currentStatus === "meeting" ? handleEndMeeting : handleStartMeeting}
              className="rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700"
            >
              {currentStatus === "meeting" ? "End Meeting" : "Start Meeting"}
            </button>
            <button
              type="button"
              onClick={() => setShowEndDayModal(true)}
              className="rounded-lg bg-red-600 px-4 py-3 text-lg font-bold text-white hover:bg-red-700"
            >
              End My Day
            </button>
          </div>

          {currentStatus === "meeting" && (
            <span className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-700">
              In Meeting
            </span>
          )}
        </div>
      )}

      {showEndDayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-2xl font-bold text-gray-900">End My Day</h3>
            <p className="mt-2 text-gray-600">Submit your daily report before ending.</p>
            <textarea
              value={reportContent}
              onChange={(event) => setReportContent(event.target.value)}
              placeholder="What did you work on today? Any blockers?"
              className="mt-5 min-h-40 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
            />
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowEndDayModal(false)}
                className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEndDay}
                disabled={submittingReport}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submittingReport ? "Submitting..." : "Submit & End Day"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const navItems = [
  { id: "dashboard", label: "Dashboard" },
  { id: "staff-management", label: "Staff" },
  { id: "screenshots", label: "Screenshots", superAdminOnly: true },
  { id: "reports", label: "Reports" },
  { id: "leave", label: "Leave Requests" },
  { id: "alerts", label: "Alerts" },
  { id: "chat", label: "Chat" },
  { id: "tasks", label: "Tasks" },
];

function AdminDashboard() {
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
      } catch (err) {
        // silently ignore — unread count is non-critical
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
        if (prevReportCountRef.current !== null && newReportCount > prevReportCountRef.current) {
          playActionSound();
        } else if (prevLeaveCountRef.current !== null && newLeaveCount > prevLeaveCountRef.current) {
          playActionSound();
        } else if (prevAlertReplyCountRef.current !== null && newAlertCount > prevAlertReplyCountRef.current) {
          playActionSound();
        }
        prevReportCountRef.current = newReportCount;
        prevLeaveCountRef.current = newLeaveCount;
        prevAlertReplyCountRef.current = newAlertCount;
        setReportUnreadCount(newReportCount);
        setLeavePendingCount(newLeaveCount);
        setAlertReplyCount(newAlertCount);
      } catch {
        // Silent fail — notification failures should never break the main UI
      }
    };
    poll();
    const notifInterval = setInterval(poll, 30000);
    return () => clearInterval(notifInterval);
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  const activeItem = navItems.find((item) => item.id === activeSection);
  const visibleNavItems = navItems.filter(
    (item) => !item.superAdminOnly || user?.role === "super_admin"
  );

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
    if (activeSection === "settings") {
      return <SettingsPanel />;
    }

    if (activeSection === "staff-management") {
      return <StaffManagementPanel openProfile={setProfileUser} />;
    }

    if (activeSection === "screenshots") {
      return <ScreenshotsPanel />;
    }

    if (activeSection === "reports") {
      return <ReportsPanel />;
    }

    if (activeSection === "leave") {
      return <LeavePanel />;
    }

    if (activeSection === "alerts") {
      return <AlertsPanel />;
    }

    if (activeSection === "chat") {
      return <ChatPanel chatWithUser={chatWithUser} />;
    }

    if (activeSection === "tasks") {
      return <TasksPanel />;
    }

    return (
      <div className="space-y-8">
        {user?.role === "admin" && <MyDayPanel />}
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
            {visibleNavItems.map((item) => {
              const badgeCounts = {
                chat: unreadCount,
                reports: reportUnreadCount,
                leave: leavePendingCount,
                alerts: alertReplyCount,
                tasks: 0,
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
                    activeSection === item.id
                      ? "bg-blue-700 text-white"
                      : "text-blue-100 hover:bg-blue-800"
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
            {user?.role === "super_admin" && (
              <button
                type="button"
                onClick={() => setActiveSection("settings")}
                className={`w-full rounded-lg px-4 py-3 text-left text-sm font-medium transition ${
                  activeSection === "settings"
                    ? "bg-blue-700 text-white"
                    : "text-blue-100 hover:bg-blue-800"
                }`}
              >
                Settings
              </button>
            )}
          </div>
        </nav>

        <div className="border-t border-blue-800 p-4">
          <div className="mb-4">
            <p className="truncate text-sm font-semibold">
              {user?.full_name || "Admin User"}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wide text-blue-200">
              {user?.role || "admin"}
            </p>
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

export default AdminDashboard;

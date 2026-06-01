import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api.js";

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

function formatTime(value) {
  if (!value) {
    return "N/A";
  }

  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startValue, endValue) {
  if (!startValue || !endValue) {
    return "N/A";
  }

  const minutes = Math.max(
    0,
    Math.floor((new Date(endValue) - new Date(startValue)) / 60000)
  );
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function getBreakMinutes(startValue) {
  if (!startValue) {
    return null;
  }

  return Math.max(0, Math.floor((new Date() - new Date(startValue)) / 60000));
}

function TeamStatusPanel() {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedUserId, setExpandedUserId] = useState(null);

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
    offline: staffList.filter((staff) => staff.status === "offline").length,
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

      <div className="grid grid-cols-4 gap-4">
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
                          {formatDuration(staff.login_time, staff.updated_at)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex gap-3">
                      <button
                        type="button"
                        onClick={() => alert("Coming soon")}
                        className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
                      >
                        View Profile
                      </button>
                      <button
                        type="button"
                        onClick={() => alert("Coming soon")}
                        className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-yellow-950 hover:bg-yellow-500"
                      >
                        Send Alert
                      </button>
                      <button
                        type="button"
                        onClick={() => alert("Coming soon")}
                        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                      >
                        Open Chat
                      </button>
                    </div>
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
        </div>
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
                  <div>{report.report_date}</div>
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
            const dateRange = `${new Date(request.start_date).toLocaleDateString(
              undefined,
              { day: "2-digit", month: "short", year: "numeric" }
            )} → ${new Date(request.end_date).toLocaleDateString(undefined, {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}`;

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
                        Reviewed {new Date(request.reviewed_at).toLocaleString()}
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
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

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
        <div className="mt-6 flex min-h-80 items-center justify-center rounded-lg bg-gray-50 text-gray-500">
          Delivery reports will appear here
        </div>
      </section>
    </div>
  );
}

function ChatPanel() {
  const user = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);
  const currentUserId = user?.user_id;
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const websocketRef = useRef(null);
  const selectedConversationRef = useRef(null);

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

    const websocket = new WebSocket(
      `ws://127.0.0.1:8000/api/chat/ws/${currentUserId}`
    );
    websocketRef.current = websocket;

    websocket.onopen = () => {
      websocket.send(JSON.stringify({ token }));
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "new_message") {
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

    return () => {
      websocket.close();
    };
  }, [currentUserId]);

  const handleSelectConversation = async (conversation) => {
    setSelectedConversation(conversation);
    setLoadingMessages(true);
    setConversations((current) =>
      current.map((item) =>
        item.user_id === conversation.user_id
          ? { ...item, unread_count: 0 }
          : item
      )
    );

    try {
      const response = await api.get(`/api/chat/history/${conversation.user_id}`);
      setMessages(response.data);
    } catch (err) {
      toast.error("Could not load messages");
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSendMessage = () => {
    const content = messageText.trim();
    if (!content || !selectedConversation || !websocketRef.current) {
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
    websocketRef.current.send(
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
          <h3 className="text-xl font-bold text-gray-900">Messages</h3>
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

      <section className="flex flex-1 flex-col">
        {!selectedConversation ? (
          <div className="flex flex-1 items-center justify-center text-gray-500">
            Select a conversation to start chatting
          </div>
        ) : (
          <>
            <div className="border-b border-gray-200 p-5">
              <div className="font-bold text-gray-900">
                {selectedConversation.full_name}
              </div>
              <div className="text-sm text-gray-500">
                {selectedConversation.department || "No department"}
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-gray-50 p-5">
              {loadingMessages ? (
                <div className="text-center text-gray-500">Loading messages...</div>
              ) : (
                messages.map((message) => {
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
                })
              )}
            </div>

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

function StaffManagementPanel() {
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

  const handleGenerateToken = async (userId) => {
    try {
      const response = await api.post(`/api/users/${userId}/generate-agent-token`);
      setTokenModal(response.data);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not generate token");
    }
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
                    {user.full_name}
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
                        onClick={() => handleGenerateToken(user.id)}
                        className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200"
                      >
                        Agent Token
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

      {tokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900">Agent Token</h3>
            <p className="mt-3 text-sm text-gray-600">
              Send this token to IT to install the agent on this staff member's
              computer
            </p>
            <div className="mt-5 rounded-lg bg-gray-100 p-4 font-mono text-sm text-gray-900">
              {tokenModal.machine_token}
            </div>
            <div className="mt-4 text-sm text-gray-600">
              Staff ID: <span className="font-mono">{tokenModal.staff_id}</span>
            </div>
            <button
              type="button"
              onClick={() => setTokenModal(null)}
              className="mt-6 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const navItems = [
  { id: "dashboard", label: "Dashboard" },
  { id: "staff-management", label: "Staff" },
  { id: "reports", label: "Reports" },
  { id: "leave", label: "Leave Requests" },
  { id: "alerts", label: "Alerts" },
  { id: "chat", label: "Chat" },
];

function AdminDashboard() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("dashboard");
  const [currentTime, setCurrentTime] = useState(new Date());

  const user = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
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
    if (activeSection === "staff-management") {
      return <StaffManagementPanel />;
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
      return <ChatPanel />;
    }

    return <TeamStatusPanel />;
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <aside className="fixed left-0 top-0 flex h-screen w-64 flex-col bg-blue-900 text-white">
        <div className="border-b border-blue-800 px-6 py-6">
          <h1 className="text-2xl font-bold">{user?.company_name || "WorkFlow"}</h1>
          <p className="mt-1 text-sm text-blue-200">Admin Console</p>
        </div>

        <nav className="flex-1 px-4 py-6">
          <div className="space-y-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`w-full rounded-lg px-4 py-3 text-left text-sm font-medium transition ${
                  activeSection === item.id
                    ? "bg-blue-700 text-white"
                    : "text-blue-100 hover:bg-blue-800"
                }`}
              >
                {item.label}
              </button>
            ))}
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
              {currentTime.toLocaleDateString()} {currentTime.toLocaleTimeString()}
            </p>
          </div>
        </header>

        <section className="p-8">{renderContent()}</section>
      </main>
    </div>
  );
}

export default AdminDashboard;

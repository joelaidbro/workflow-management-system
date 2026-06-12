import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api.js";

function formatTime(value) {
  if (!value) {
    return "N/A";
  }

  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value) {
  if (!value) {
    return "N/A";
  }

  return new Date(value).toLocaleDateString();
}

function formatDuration(startValue, endValue = new Date()) {
  if (!startValue) {
    return "0h 0m";
  }

  const minutes = Math.max(
    0,
    Math.floor((new Date(endValue) - new Date(startValue)) / 60000)
  );
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function truncate(value, length) {
  if (!value) {
    return "";
  }

  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function StaffDashboard() {
  const navigate = useNavigate();
  const user = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);
  const currentUserId = user?.user_id || user?.id;

  const [attendance, setAttendance] = useState(null);
  const [workMode, setWorkMode] = useState("office");
  const [loadingAttendance, setLoadingAttendance] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showEndDayModal, setShowEndDayModal] = useState(false);
  const [reportContent, setReportContent] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const [downloadingSalarySlip, setDownloadingSalarySlip] = useState(null);
  const [currentStatus, setCurrentStatus] = useState("not_started");
  const [breakStartedAt, setBreakStartedAt] = useState(null);

  const [reports, setReports] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showNewChatSelector, setShowNewChatSelector] = useState(false);
  const [availableChatUsers, setAvailableChatUsers] = useState([]);
  const [loadingChatUsers, setLoadingChatUsers] = useState(false);
  const wsRef = useRef(null);
  const selectedConversationRef = useRef(null);
  const lastSentMessageRef = useRef("");

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const fetchAttendance = async () => {
      try {
        const response = await api.get("/api/attendance/today");
        setAttendance(response.data);
        if (response.data?.work_mode) {
          setWorkMode(response.data.work_mode);
        }
        setCurrentStatus((previousStatus) => {
          if (!response.data?.started) {
            return "not_started";
          }
          if (response.data.logout_time) {
            return "ended";
          }
          if (previousStatus === "break" || previousStatus === "meeting") {
            return previousStatus;
          }
          return "active";
        });
      } catch (error) {
        toast.error("Could not load today's attendance");
      } finally {
        setLoadingAttendance(false);
      }
    };

    const fetchReports = async () => {
      const now = new Date();
      try {
        const response = await api.get("/api/attendance/reports/my-reports", {
          params: {
            month: now.getMonth() + 1,
            year: now.getFullYear(),
          },
        });
        setReports(response.data.slice(0, 5));
      } catch (error) {
        toast.error("Could not load reports");
      }
    };

    const fetchConversations = async () => {
      try {
        const response = await api.get("/api/chat/conversations");
        setConversations(response.data);
      } catch (error) {
        toast.error("Could not load messages");
      }
    };

    fetchAttendance();
    fetchReports();
    fetchConversations();

    const attendanceIntervalId = setInterval(fetchAttendance, 30000);
    return () => clearInterval(attendanceIntervalId);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token || !currentUserId) {
      return;
    }

    const apiUrl = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
    const wsUrl = apiUrl.replace("https://", "wss://").replace("http://", "ws://");
    const ws = new WebSocket(`${wsUrl}/api/chat/ws/${currentUserId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected successfully");
      ws.send(JSON.stringify({ token }));
      console.log("Auth token sent");
    };

    ws.onerror = (error) => {
      console.log("WebSocket error:", error);
    };

    ws.onclose = (event) => {
      console.log(
        "WebSocket closed. Code:",
        event.code,
        "Reason:",
        event.reason
      );
      wsRef.current = null;
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("WebSocket message received:", data);
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

      if (data.type !== "new_message") {
        return;
      }

      const activeConversation = selectedConversationRef.current;
      if (activeConversation?.user_id === data.sender_id) {
        setChatMessages((current) => [
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
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [currentUserId]);

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const handleStartDay = async () => {
    try {
      const response = await api.post("/api/attendance/start-day", {
        work_mode: workMode,
      });
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
      });
      setCurrentStatus("active");
    } catch (error) {
      toast.error("Could not start day");
    }
  };

  const getErrorMessage = (error, fallback) => {
    return error.response?.data?.detail || fallback;
  };

  const handleStartBreak = async () => {
    try {
      const response = await api.post("/api/status/break/start");
      setCurrentStatus("break");
      setBreakStartedAt(response.data.break_started_at);
      toast.success("Break started");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not start break"));
    }
  };

  const handleEndBreak = async () => {
    try {
      const response = await api.post("/api/status/break/end");
      setCurrentStatus("active");
      setBreakStartedAt(null);
      toast.success(`Break ended - ${response.data.break_duration_minutes} minutes`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not end break"));
    }
  };

  const handleStartMeeting = async () => {
    try {
      await api.post("/api/status/meeting/start");
      setCurrentStatus("meeting");
      toast.success("Meeting started");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not start meeting"));
    }
  };

  const handleEndMeeting = async () => {
    try {
      await api.post("/api/status/meeting/end");
      setCurrentStatus("active");
      toast.success("Meeting ended");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not end meeting"));
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
      await api.post("/api/attendance/end-day", {
        report_content: cleanReport,
      });
      toast.success("Day ended successfully");
      localStorage.removeItem("access_token");
      localStorage.removeItem("user");
      navigate("/login");
    } catch (error) {
      toast.error("Could not end day");
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleDownloadSalarySlip = async (report) => {
    const reportDate = new Date(report.report_date);
    const month = reportDate.getMonth() + 1;
    const year = reportDate.getFullYear();
    setDownloadingSalarySlip(report.id);

    try {
      const response = await api.get(
        `/api/attendance/export/salary-slip/${currentUserId}`,
        {
          params: { month, year },
          responseType: "blob",
        }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `salary_slip_${currentUserId}_${month}_${year}.pdf`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      if (error.response?.status === 400) {
        toast.error("Salary not yet approved for this period");
      } else {
        toast.error("Could not download salary slip");
      }
    } finally {
      setDownloadingSalarySlip(null);
    }
  };

  const handleOpenConversation = async (conversation) => {
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
      setChatMessages(response.data);
    } catch (error) {
      toast.error("Could not load chat");
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSendMessage = () => {
    console.log("Send attempted. Input:", chatInput);
    console.log("WebSocket state:", wsRef.current?.readyState);
    console.log("Selected conversation:", selectedConversation);

    const content = chatInput.trim();
    if (!content || !selectedConversation) {
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log("WebSocket not connected. State:", wsRef.current?.readyState);
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

    setChatMessages((current) => [...current, optimisticMessage]);
    console.log("Optimistic message added:", optimisticMessage);
    lastSentMessageRef.current = content;
    wsRef.current.send(
      JSON.stringify({
        recipient_id: selectedConversation.user_id,
        content,
      })
    );
    console.log("WebSocket send completed");
    setChatInput("");
  };

  const fetchAvailableChatUsers = async () => {
    setShowNewChatSelector((current) => !current);
    if (availableChatUsers.length > 0) {
      return;
    }

    setLoadingChatUsers(true);
    try {
      const response = await api.get("/api/users/chat-members");
      setAvailableChatUsers(
        response.data
          .filter(
            (item) =>
              ["staff", "admin"].includes(item.role) &&
              item.id !== currentUserId
          )
          .map((item) => ({
            user_id: item.id,
            full_name: item.full_name,
            department: item.department,
          }))
      );
    } catch (error) {
      toast.error("Could not load users");
    } finally {
      setLoadingChatUsers(false);
    }
  };

  const statusLabels = {
    not_started: "Not started",
    ended: "Day ended",
    active: "Active",
    break: "On Break",
    meeting: "In Meeting",
    idle: "Idle",
  };
  const statusClasses = {
    not_started: "bg-blue-800",
    ended: "bg-gray-700",
    active: "bg-green-700",
    break: "bg-orange-500 text-orange-950",
    meeting: "bg-blue-600",
    idle: "bg-yellow-400 text-yellow-950",
  };
  const liveStatus = statusLabels[currentStatus] || "Active";
  const breakDurationMinutes = breakStartedAt
    ? Math.max(0, Math.floor((currentTime - new Date(breakStartedAt)) / 60000))
    : 0;

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="flex items-center justify-between bg-blue-900 px-8 py-4 text-white">
        <div className="text-2xl font-bold">WorkFlow</div>
        <div
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            statusClasses[currentStatus] || "bg-green-700"
          }`}
        >
          {liveStatus}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium">{user?.full_name || "Staff"}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold hover:bg-blue-700"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {loadingAttendance ? (
            <div className="text-center text-gray-500">Loading work day...</div>
          ) : !attendance?.started ? (
            <div className="space-y-6">
              <h1 className="text-2xl font-bold text-gray-900">
                Good morning, {user?.full_name || "there"}
              </h1>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Work mode
                </label>
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
                className="w-full rounded-lg bg-green-600 px-5 py-4 text-lg font-bold text-white hover:bg-green-700"
              >
                Start My Day
              </button>
            </div>
          ) : attendance.logout_time ? (
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900">
                Your day has ended. See you tomorrow!
              </h2>
              <p className="mt-3 text-gray-600">
                Working hours: {formatDuration(attendance.login_time, attendance.logout_time)}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-xl bg-gray-50 p-4">
                  <div className="text-sm text-gray-500">Login time</div>
                  <div className="mt-1 font-bold text-gray-900">
                    {formatTime(attendance.login_time)}
                  </div>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <div className="text-sm text-gray-500">Working hours so far</div>
                  <div className="mt-1 font-bold text-gray-900">
                    {formatDuration(attendance.login_time, currentTime)}
                  </div>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <div className="text-sm text-gray-500">Work mode</div>
                  <div className="mt-1 font-bold text-gray-900">
                    {attendance.work_mode?.toUpperCase() || "N/A"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={
                    currentStatus === "break" ? handleEndBreak : handleStartBreak
                  }
                  className="rounded-lg bg-orange-400 px-4 py-3 font-semibold text-orange-950 hover:bg-orange-500"
                >
                  {currentStatus === "break"
                    ? `End Break (${breakDurationMinutes} min)`
                    : "Start Break"}
                </button>
                <button
                  type="button"
                  onClick={
                    currentStatus === "meeting"
                      ? handleEndMeeting
                      : handleStartMeeting
                  }
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
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900">Recent Reports</h2>
          <div className="mt-4 space-y-3">
            {reports.length === 0 ? (
              <div className="text-gray-500">No reports yet</div>
            ) : (
              reports.map((report) => (
                <div key={report.id} className="rounded-xl bg-gray-50 p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-gray-900">
                      {formatDate(report.report_date)}
                    </div>
                    <div className="flex items-center gap-2">
                      {report.admin_reply && (
                        <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                          Replied
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDownloadSalarySlip(report)}
                        disabled={downloadingSalarySlip === report.id}
                        className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {downloadingSalarySlip === report.id
                          ? "Downloading..."
                          : "Download Salary Slip"}
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-gray-700">
                    {truncate(report.content, 100)}
                  </p>
                  {report.admin_reply && (
                    <div className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-900">
                      {report.admin_reply}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-gray-900">Messages</h2>
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
                    handleOpenConversation(selectedUser);
                    setShowNewChatSelector(false);
                    event.target.value = "";
                  }
                }}
                disabled={loadingChatUsers}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
              >
                <option value="">
                  {loadingChatUsers ? "Loading users..." : "Select person"}
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
          <div className="mt-4 divide-y divide-gray-100">
            {conversations.length === 0 ? (
              <div className="py-8 text-center text-gray-500">
                No conversations yet
              </div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.user_id}
                  type="button"
                  onClick={() => handleOpenConversation(conversation)}
                  className="flex w-full items-center justify-between gap-4 py-4 text-left hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900">
                      {conversation.full_name}
                    </div>
                    <div className="text-sm text-gray-500">
                      {conversation.department || "No department"}
                    </div>
                    <div className="mt-1 truncate text-sm text-gray-600">
                      {truncate(conversation.last_message, 40)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">
                      {formatTime(conversation.last_message_at)}
                    </span>
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
        </section>
      </main>

      {showEndDayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-2xl font-bold text-gray-900">End Your Day</h2>
            <textarea
              value={reportContent}
              onChange={(event) => setReportContent(event.target.value)}
              placeholder="Summarise what you worked on today..."
              className="mt-5 min-h-40 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
            />
            <div className="mt-1 text-right text-xs text-gray-500">
              {reportContent.length} characters
            </div>
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
                {submittingReport ? "Submitting..." : "Submit & Logout"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedConversation && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4">
          <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 p-5">
              <div>
                <div className="font-bold text-gray-900">
                  {selectedConversation.full_name}
                </div>
                <div className="text-sm text-gray-500">
                  {selectedConversation.department || "No department"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedConversation(null)}
                className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
              >
                Close
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-gray-50 p-5">
              {loadingMessages ? (
                <div className="text-center text-gray-500">Loading messages...</div>
              ) : chatMessages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-gray-500">
                  Start a conversation with {selectedConversation.full_name}
                </div>
              ) : (
                chatMessages.map((message) => {
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

            <div className="border-t border-gray-200 p-4">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
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
          </div>
        </div>
      )}
    </div>
  );
}

export default StaffDashboard;

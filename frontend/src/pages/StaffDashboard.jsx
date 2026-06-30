import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api.js";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatTime,
  minutesToHours,
} from "../utils/dateUtils";

function formatElapsedDuration(startValue, endValue = new Date()) {
  if (!startValue) {
    return "0h 0m";
  }

  const normalize = (value) =>
    typeof value === "string" && !value.endsWith("Z") ? `${value}Z` : value;
  const minutes = Math.max(
    0,
    Math.floor((new Date(normalize(endValue)) - new Date(normalize(startValue))) / 60000)
  );
  return formatDuration(minutes);
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
  const [activeSection, setActiveSection] = useState("dashboard");
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

  const getDateInputValue = (date) => {
    const timezoneOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
  };

  const todayDate = getDateInputValue(new Date());
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [attendanceSummary, setAttendanceSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [calendarTooltip, setCalendarTooltip] = useState({
    visible: false,
    day: null,
    x: 0,
    y: 0,
  });
  const [profileDetails, setProfileDetails] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [alertTab, setAlertTab] = useState("pending");
  const [pendingAlerts, setPendingAlerts] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [acknowledgingAlertId, setAcknowledgingAlertId] = useState(null);

  const [leaveRequests, setLeaveRequests] = useState([]);
  const [loadingLeaveRequests, setLoadingLeaveRequests] = useState(true);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [submittingLeave, setSubmittingLeave] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    leave_type: "",
    start_date: todayDate,
    end_date: todayDate,
    reason: "",
  });

  const fetchLeaveRequests = async () => {
    setLoadingLeaveRequests(true);
    try {
      const response = await api.get("/api/leave/my-requests");
      setLeaveRequests(response.data);
    } catch (error) {
      toast.error("Could not load leave requests");
    } finally {
      setLoadingLeaveRequests(false);
    }
  };

  const fetchAlerts = async () => {
    setLoadingAlerts(true);
    try {
      const [pendingResponse, historyResponse] = await Promise.all([
        api.get("/api/alerts/my-pending"),
        api.get("/api/alerts/my-history"),
      ]);
      setPendingAlerts(pendingResponse.data);
      setAlertHistory(historyResponse.data);
    } catch (error) {
      toast.error("Could not load alerts");
    } finally {
      setLoadingAlerts(false);
    }
  };

  const calculateLeaveDays = () => {
    if (!leaveForm.start_date || !leaveForm.end_date) {
      return 0;
    }

    const startDate = new Date(`${leaveForm.start_date}T00:00:00`);
    const endDate = new Date(`${leaveForm.end_date}T00:00:00`);
    if (endDate < startDate) {
      return 0;
    }

    return Math.floor((endDate - startDate) / 86400000) + 1;
  };

  const updateLeaveForm = (field, value) => {
    setLeaveForm((current) => {
      const updated = { ...current, [field]: value };
      if (field === "start_date" && updated.end_date < value) {
        updated.end_date = value;
      }
      return updated;
    });
  };

  useEffect(() => {
    selectedConversationRef.current = selectedConversation;
  }, [selectedConversation]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

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
        console.log("Conversations response:", response.data);
        setConversations(response.data);
      } catch (error) {
        toast.error("Could not load messages");
      }
    };

    fetchAttendance();
    fetchReports();
    fetchConversations();
    fetchLeaveRequests();
    fetchAlerts();

    const attendanceIntervalId = setInterval(fetchAttendance, 30000);
    return () => clearInterval(attendanceIntervalId);
  }, []);

  useEffect(() => {
    const fetchSummary = async () => {
      if (!currentUserId) {
        return;
      }

      setLoadingSummary(true);
      try {
        const response = await api.get(`/api/attendance/summary/${currentUserId}`, {
          params: {
            month: selectedMonth.getMonth() + 1,
            year: selectedMonth.getFullYear(),
          },
        });
        setAttendanceSummary(response.data);
      } catch (error) {
        toast.error("Could not load attendance summary");
      } finally {
        setLoadingSummary(false);
      }
    };

    fetchSummary();
  }, [currentUserId, selectedMonth]);

  useEffect(() => {
    const fetchProfile = async () => {
      setLoadingProfile(true);
      try {
        const response = await api.get("/api/auth/me");
        setProfileDetails(response.data);
      } catch (error) {
        toast.error("Could not load profile");
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchProfile();
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
      console.log("Raw websocket data:", data);
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
      toast.error(getErrorMessage(error, "Could not start day"));
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
      toast.error(error.response?.data?.detail || "Could not end day");
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
      console.log("Chat history response:", response.data);
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

  const handleSubmitLeaveRequest = async () => {
    const leaveType = leaveForm.leave_type.trim();
    if (!leaveType) {
      setLeaveError("Leave type is required");
      return;
    }

    setSubmittingLeave(true);
    setLeaveError("");
    try {
      await api.post("/api/leave/request", {
        leave_type: leaveType,
        start_date: leaveForm.start_date,
        end_date: leaveForm.end_date,
        reason: leaveForm.reason.trim() || null,
      });
      toast.success("Leave request submitted");
      setShowLeaveForm(false);
      setLeaveForm({
        leave_type: "",
        start_date: todayDate,
        end_date: todayDate,
        reason: "",
      });
      fetchLeaveRequests();
    } catch (error) {
      setLeaveError(
        error.response?.data?.detail || "Could not submit leave request"
      );
    } finally {
      setSubmittingLeave(false);
    }
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
  const leaveStatusClasses = {
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
  };
  const alertTypeClasses = {
    urgent: "bg-red-100 text-red-700",
    info: "bg-blue-100 text-blue-700",
  };
  const liveStatus = statusLabels[currentStatus] || "Active";
  const breakDurationMinutes = breakStartedAt
    ? Math.max(0, Math.floor((currentTime - new Date(breakStartedAt)) / 60000))
    : 0;
  const sectionTitles = {
    dashboard: "Dashboard",
    reports: "Reports",
    leave: "Leave Requests",
    messages: "Messages",
    attendance: "Attendance",
    alerts: "Alerts",
    profile: "Profile",
  };
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "🏠" },
    { id: "reports", label: "Reports", icon: "📋" },
    { id: "leave", label: "Leave Requests", icon: "🗓️" },
    { id: "messages", label: "Messages", icon: "💬" },
    { id: "attendance", label: "Attendance", icon: "📅" },
    { id: "alerts", label: "Alerts", icon: "🔔" },
    { id: "profile", label: "Profile", icon: "👤" },
  ];
  const selectedMonthNumber = selectedMonth.getMonth() + 1;
  const selectedYear = selectedMonth.getFullYear();
  const recordsByDate = new Map(
    (attendanceSummary?.attendance_records || []).map((record) => [record.date, record])
  );
  const daysInMonth = new Date(selectedYear, selectedMonthNumber, 0).getDate();
  const leadingBlankDays =
    (new Date(selectedYear, selectedMonthNumber - 1, 1).getDay() + 6) % 7;
  const calendarDays = [
    ...Array.from({ length: leadingBlankDays }, (_, index) => ({
      blank: true,
      id: `blank-${index}`,
    })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const date = new Date(selectedYear, selectedMonthNumber - 1, day);
      const dateKey = `${selectedYear}-${String(selectedMonthNumber).padStart(
        2,
        "0"
      )}-${String(day).padStart(2, "0")}`;
      const record = recordsByDate.get(dateKey);
      const defaultWorkingDays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
      const workingDays = attendanceSummary?.working_days || defaultWorkingDays;
      const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const isWeekend = !workingDays.includes(dayNames[date.getDay()]);
      const isFuture = date > new Date();
      let dotClass = "bg-white border border-gray-300";

      if (isWeekend || isFuture) {
        dotClass = "bg-gray-300";
      } else if (record?.work_mode === "leave") {
        dotClass = "bg-blue-500";
      } else if (record?.is_present) {
        dotClass = "bg-green-500";
      } else if (record) {
        dotClass = "bg-red-500";
      }

      return {
        id: dateKey,
        date: dateKey,
        day,
        dotClass,
        work_mode: record?.work_mode || "office",
        working_minutes: record?.working_minutes || 0,
        break_minutes: record?.break_minutes || 0,
        idle_minutes: record?.idle_minutes || 0,
        login_time: record?.login_time || null,
        logout_time: record?.logout_time || null,
      };
    }),
  ];
  const profile = attendanceSummary || profileDetails || user;

  const changeSelectedMonth = (offset) => {
    setSelectedMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + offset, 1)
    );
  };

  const handleAcknowledgeAlert = async (alertRecipientId) => {
    setAcknowledgingAlertId(alertRecipientId);
    try {
      await api.post(`/api/alerts/my-acknowledge/${alertRecipientId}`, {
        reply: null,
      });
      toast.success("Alert acknowledged");
      fetchAlerts();
    } catch (error) {
      toast.error("Could not acknowledge alert");
    } finally {
      setAcknowledgingAlertId(null);
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-100">
      <aside className="fixed inset-y-0 left-0 flex w-64 flex-col bg-blue-900 text-white">
        <div className="border-b border-blue-800 p-6">
          <div className="text-2xl font-bold">WorkFlow</div>
          <div className="mt-1 text-sm text-blue-200">
            {user?.company_name || "Staff Portal"}
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-semibold transition ${
                activeSection === item.id
                  ? "bg-blue-700 text-white"
                  : "text-blue-100 hover:bg-blue-800"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="border-t border-blue-800 p-4">
          <div className="font-semibold">{user?.full_name || "Staff"}</div>
          <span className="mt-2 inline-flex rounded-full bg-blue-700 px-3 py-1 text-xs font-bold uppercase text-white">
            {user?.role || "staff"}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 w-full rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold hover:bg-blue-700"
          >
            Logout
          </button>
        </div>
      </aside>

      <div className="ml-64 flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-4 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {sectionTitles[activeSection]}
            </h1>
            <div
              className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold text-white ${
                statusClasses[currentStatus] || "bg-green-700"
              }`}
            >
              {liveStatus}
            </div>
          </div>
          <div className="text-right text-sm text-gray-600">
            <div className="font-semibold text-gray-900">
              {formatDateTime(currentTime.toISOString())}
            </div>
            <div>{user?.full_name || "Staff"}</div>
          </div>
        </header>

      <main className="flex-1 space-y-6 p-8">
        {activeSection === "dashboard" && (
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
                    {formatElapsedDuration(attendance.login_time, currentTime)}
                  </div>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <div className="text-sm text-gray-500">Work mode</div>
                  <div className="mt-1 font-bold text-gray-900">
                    {attendance.work_mode?.toUpperCase() || "N/A"}
                  </div>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <div className="text-sm text-gray-500">Idle Time</div>
                  <div className="mt-1 font-bold text-gray-900">
                    {minutesToHours(attendance.idle_minutes || 0)}
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
        )}

        {activeSection === "reports" && (
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
        )}

        {activeSection === "leave" && (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-gray-900">Leave Requests</h2>
            <button
              type="button"
              onClick={() => {
                setShowLeaveForm(true);
                setLeaveError("");
              }}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Request Leave
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {loadingLeaveRequests ? (
              <div className="text-gray-500">Loading leave requests...</div>
            ) : leaveRequests.length === 0 ? (
              <div className="text-gray-500">No leave requests yet</div>
            ) : (
              leaveRequests.map((request) => (
                <div key={request.id} className="rounded-xl bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-gray-900">
                        {request.leave_type}
                      </div>
                      <div className="mt-1 text-sm text-gray-600">
                        {formatDate(request.start_date)} -{" "}
                        {formatDate(request.end_date)} · {request.total_days}{" "}
                        {request.total_days === 1 ? "day" : "days"}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        leaveStatusClasses[request.status] ||
                        "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {request.status}
                    </span>
                  </div>
                  {request.admin_comment && (
                    <div className="mt-3 rounded-lg bg-white p-3 text-sm text-gray-700">
                      {request.admin_comment}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {showLeaveForm && (
            <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-700">
                    Leave Type
                  </span>
                  <input
                    type="text"
                    value={leaveForm.leave_type}
                    onChange={(event) =>
                      updateLeaveForm("leave_type", event.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-700">
                    Start Date
                  </span>
                  <input
                    type="date"
                    min={todayDate}
                    value={leaveForm.start_date}
                    onChange={(event) =>
                      updateLeaveForm("start_date", event.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-700">
                    End Date
                  </span>
                  <input
                    type="date"
                    min={leaveForm.start_date || todayDate}
                    value={leaveForm.end_date}
                    onChange={(event) =>
                      updateLeaveForm("end_date", event.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                  />
                </label>
                <div className="flex items-end text-sm font-semibold text-gray-700">
                  Total: {calculateLeaveDays()}{" "}
                  {calculateLeaveDays() === 1 ? "day" : "days"}
                </div>
                <label className="block md:col-span-2">
                  <span className="mb-2 block text-sm font-medium text-gray-700">
                    Reason
                  </span>
                  <textarea
                    value={leaveForm.reason}
                    onChange={(event) =>
                      updateLeaveForm("reason", event.target.value)
                    }
                    className="min-h-28 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                  />
                </label>
              </div>

              {leaveError && (
                <div className="mt-4 text-sm font-medium text-red-600">
                  {leaveError}
                </div>
              )}

              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowLeaveForm(false);
                    setLeaveError("");
                  }}
                  className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmitLeaveRequest}
                  disabled={submittingLeave}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submittingLeave ? "Submitting..." : "Submit Request"}
                </button>
              </div>
            </div>
          )}
        </section>
        )}

        {activeSection === "messages" && (
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
        )}

        {activeSection === "attendance" && (
          <section className="space-y-6">
            <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <button
                type="button"
                onClick={() => setSelectedMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                className="rounded-lg bg-gray-100 px-4 py-2 font-bold text-gray-700 hover:bg-gray-200"
              >
                &lt;
              </button>
              <div className="text-center">
                <h2 className="text-xl font-bold text-gray-900">
                  {selectedMonth.toLocaleDateString([], {
                    month: "long",
                    year: "numeric",
                  })}
                </h2>
                <p className="text-sm text-gray-500">Monthly attendance summary</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                className="rounded-lg bg-gray-100 px-4 py-2 font-bold text-gray-700 hover:bg-gray-200"
              >
                &gt;
              </button>
            </div>

            {loadingSummary ? (
              <div className="text-center text-gray-500">Loading attendance...</div>
            ) : (
              <div className="grid gap-4 md:grid-cols-5">
                <div className="rounded-xl bg-green-50 p-4">
                  <div className="text-sm font-medium text-green-700">Days Present</div>
                  <div className="mt-2 text-2xl font-bold text-green-900">
                    {attendanceSummary?.days_present || 0}
                  </div>
                </div>
                <div className="rounded-xl bg-red-50 p-4">
                  <div className="text-sm font-medium text-red-700">Days Absent</div>
                  <div className="mt-2 text-2xl font-bold text-red-900">
                    {attendanceSummary?.days_absent || 0}
                  </div>
                </div>
                <div className="rounded-xl bg-blue-50 p-4">
                  <div className="text-sm font-medium text-blue-700">
                    Total Working Hours
                  </div>
                  <div className="mt-2 text-2xl font-bold text-blue-900">
                    {minutesToHours(attendanceSummary?.total_working_minutes || 0)}
                  </div>
                </div>
                <div className="rounded-xl bg-orange-50 p-4">
                  <div className="text-sm font-medium text-orange-700">
                    Total Break Time
                  </div>
                  <div className="mt-2 text-2xl font-bold text-orange-900">
                    {minutesToHours(attendanceSummary?.total_break_minutes || 0)}
                  </div>
                </div>
                <div className="rounded-xl bg-gray-50 p-4">
                  <div className="text-sm font-medium text-gray-700">Total Idle Time</div>
                  <div className="mt-2 text-2xl font-bold text-gray-900">
                    {minutesToHours(attendanceSummary?.total_idle_minutes || 0)}
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="grid grid-cols-7 gap-2 text-center text-xs font-bold uppercase text-gray-500">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                  <div key={day}>{day}</div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-7 gap-2">
                {calendarDays.map((day) =>
                  day.blank ? (
                    <div key={day.id} className="h-12" />
                  ) : (
                    <div
                      key={day.id}
                      className="flex h-14 flex-col items-center justify-center gap-1 rounded-lg bg-gray-50 text-xs text-gray-600"
                    >
                      <span>{day.day}</span>
                      <span
                        className={`h-6 w-6 cursor-pointer rounded-full ${day.dotClass}`}
                        onMouseEnter={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          setCalendarTooltip({
                            visible: true,
                            day,
                            x: rect.left,
                            y: rect.top,
                          });
                        }}
                        onMouseLeave={() =>
                          setCalendarTooltip({
                            visible: false,
                            day: null,
                            x: 0,
                            y: 0,
                          })
                        }
                      />
                    </div>
                  )
                )}
              </div>
              {calendarTooltip.visible && calendarTooltip.day && (
                <div
                  className="pointer-events-none fixed z-50 rounded-lg bg-gray-900 p-3 text-xs text-white shadow-xl"
                  style={{ left: calendarTooltip.x + 10, top: calendarTooltip.y - 95 }}
                >
                  <div className="mb-1 font-bold">
                    {formatDate(calendarTooltip.day.date)}
                  </div>
                  <div>
                    Working: {minutesToHours(calendarTooltip.day.working_minutes)}
                  </div>
                  <div>Break: {minutesToHours(calendarTooltip.day.break_minutes)}</div>
                  <div>Idle: {minutesToHours(calendarTooltip.day.idle_minutes)}</div>
                  <div>Mode: {calendarTooltip.day.work_mode || "Office"}</div>
                  {calendarTooltip.day.login_time && (
                    <div>Login: {formatTime(calendarTooltip.day.login_time)}</div>
                  )}
                  {calendarTooltip.day.logout_time && (
                    <div>Logout: {formatTime(calendarTooltip.day.logout_time)}</div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {activeSection === "alerts" && (
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex gap-2 rounded-xl bg-gray-100 p-1">
              {["pending", "history"].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setAlertTab(tab)}
                  className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold capitalize ${
                    alertTab === tab
                      ? "bg-blue-700 text-white"
                      : "text-gray-600 hover:bg-white"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="mt-5 space-y-4">
              {loadingAlerts ? (
                <div className="py-10 text-center text-gray-500">Loading alerts...</div>
              ) : (alertTab === "pending" ? pendingAlerts : alertHistory).length === 0 ? (
                <div className="py-10 text-center text-gray-500">No alerts found</div>
              ) : (
                (alertTab === "pending" ? pendingAlerts : alertHistory).map((alert) => (
                  <div
                    key={alert.alert_recipient_id}
                    className="rounded-xl border border-gray-200 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
                            alertTypeClasses[alert.alert_type] || alertTypeClasses.info
                          }`}
                        >
                          {alert.alert_type}
                        </span>
                        <div className="mt-3 font-semibold text-gray-900">
                          {alert.sender_name}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-gray-700">
                          {alert.message}
                        </p>
                        <div className="mt-3 text-xs text-gray-500">
                          Sent: {formatDateTime(alert.created_at)}
                        </div>
                        {alert.acknowledged_at && (
                          <div className="mt-1 text-xs text-gray-500">
                            Acknowledged: {formatDateTime(alert.acknowledged_at)}
                          </div>
                        )}
                        {alert.reply && (
                          <div className="mt-2 rounded-lg bg-gray-50 p-2 text-sm text-gray-700">
                            {alert.reply}
                          </div>
                        )}
                      </div>
                      {alertTab === "pending" && (
                        <button
                          type="button"
                          onClick={() =>
                            handleAcknowledgeAlert(alert.alert_recipient_id)
                          }
                          disabled={acknowledgingAlertId === alert.alert_recipient_id}
                          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {acknowledgingAlertId === alert.alert_recipient_id
                            ? "Acknowledging..."
                            : "Acknowledge"}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {activeSection === "profile" && (
          <section className="space-y-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-bold text-gray-900">
                {profile?.full_name || user?.full_name || "Staff"}
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {profile?.employee_id || "Employee ID not available"}
              </p>
              {loadingProfile ? (
                <div className="mt-6 text-gray-500">Loading profile...</div>
              ) : (
                <div className="mt-6 grid gap-4 text-sm md:grid-cols-2">
                  <div>
                    <span className="text-gray-500">Department</span>
                    <div className="font-semibold text-gray-900">
                      {profile?.department || "N/A"}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500">Job Title</span>
                    <div className="font-semibold text-gray-900">
                      {profile?.job_title || "N/A"}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500">Email</span>
                    <div className="font-semibold text-gray-900">
                      {profile?.email || "N/A"}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500">Phone</span>
                    <div className="font-semibold text-gray-900">
                      {profile?.phone || "N/A"}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500">Work Type</span>
                    <div className="mt-1">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          profile?.work_type === "wfh"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-green-100 text-green-700"
                        }`}
                      >
                        {profile?.work_type === "wfh" ? "WFH" : "Office"}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-500">Joining Date</span>
                    <div className="font-semibold text-gray-900">
                      {formatDate(profile?.joining_date)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-5">
              <div className="rounded-xl bg-green-50 p-4">
                <div className="text-sm font-medium text-green-700">Days Present</div>
                <div className="mt-2 text-2xl font-bold text-green-900">
                  {attendanceSummary?.days_present || 0}
                </div>
              </div>
              <div className="rounded-xl bg-red-50 p-4">
                <div className="text-sm font-medium text-red-700">Days Absent</div>
                <div className="mt-2 text-2xl font-bold text-red-900">
                  {attendanceSummary?.days_absent || 0}
                </div>
              </div>
              <div className="rounded-xl bg-blue-50 p-4">
                <div className="text-sm font-medium text-blue-700">
                  Total Working Hours
                </div>
                <div className="mt-2 text-2xl font-bold text-blue-900">
                  {minutesToHours(attendanceSummary?.total_working_minutes || 0)}
                </div>
              </div>
              <div className="rounded-xl bg-orange-50 p-4">
                <div className="text-sm font-medium text-orange-700">
                  Total Break Time
                </div>
                <div className="mt-2 text-2xl font-bold text-orange-900">
                  {minutesToHours(attendanceSummary?.total_break_minutes || 0)}
                </div>
              </div>
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="text-sm font-medium text-gray-700">Total Idle Time</div>
                <div className="mt-2 text-2xl font-bold text-gray-900">
                  {minutesToHours(attendanceSummary?.total_idle_minutes || 0)}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
      </div>

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
                  console.log("Message timestamp:", message.created_at);
                  console.log("Parsed:", new Date(message.created_at));
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

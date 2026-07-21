import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowDown,
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Home,
  ListChecks,
  MessageSquare,
  Plus,
  Send,
  UserRound,
} from "lucide-react";

import api from "../api.js";
import { playMessageSound, playActionSound } from "../utils/sounds";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatTime,
  minutesToHours,
} from "../utils/dateUtils";
import Button from "../components/ui/Button.jsx";
import Card, { CardBody, CardHeader } from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Modal from "../components/ui/Modal.jsx";
import TabBar from "../components/ui/TabBar.jsx";
import { EmptyState, LoadingState } from "../components/ui/States.jsx";
import DashboardShell from "../components/ui/DashboardShell.jsx";

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

const STATUS_TONE = {
  not_started: "neutral",
  ended: "neutral",
  active: "success",
  break: "warning",
  meeting: "info",
  idle: "warning",
};

const LEAVE_STATUS_TONE = {
  pending: "pending",
  approved: "success",
  rejected: "danger",
};

const ALERT_TYPE_TONE = {
  urgent: "danger",
  info: "info",
};

const TASK_STATUS_TONE = {
  pending: "pending",
  in_progress: "info",
  done: "success",
};

const TASK_STATUS_LABEL = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Done",
};

const STAFF_SECTION_IDS = [
  "dashboard",
  "reports",
  "leave",
  "messages",
  "attendance",
  "alerts",
  "tasks",
  "profile",
];

const TOOLTIP_HEADER_CLASS = {
  "bg-emerald-500": "bg-emerald-500/25",
  "bg-rose-500": "bg-rose-500/25",
  "bg-sky-500": "bg-sky-500/25",
  "bg-amber-400": "bg-amber-400/25",
};

function StaffDashboard() {
  const navigate = useNavigate();
  const user = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);
  const currentUserId = user?.user_id || user?.id;
  const [logoError, setLogoError] = useState(false);
  const apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
  const logoUrl =
    user?.company_id && !logoError
      ? `${apiBase}/api/settings/logo/file?company_id=${user.company_id}&v=${user.logo_version ?? 0}`
      : null;
  const [unreadCount, setUnreadCount] = useState(0);
  const [reportReplyCount, setReportReplyCount] = useState(0);
  const [leaveDecisionCount, setLeaveDecisionCount] = useState(0);
  const prevMsgCountRef = useRef(null);
  const prevReportReplyCountRef = useRef(null);
  const prevLeaveDecisionCountRef = useRef(null);
  const { section } = useParams();
  const activeSection = STAFF_SECTION_IDS.includes(section) ? section : "dashboard";
  const setActiveSection = (id) => navigate(`/staff/${id}`);

  useEffect(() => {
    const poll = async () => {
      const [msgResult, reportResult, leaveResult] = await Promise.allSettled([
        api.get("/api/chat/unread-count"),
        api.get("/api/attendance/reports/reply-count"),
        api.get("/api/leave/decisions-count"),
      ]);

      if (msgResult.status === "fulfilled") {
        const n = msgResult.value.data.unread_count;
        if (prevMsgCountRef.current !== null && n > prevMsgCountRef.current) {
          playMessageSound();
        }
        prevMsgCountRef.current = n;
        setUnreadCount(n);
      }

      if (reportResult.status === "fulfilled") {
        const n = reportResult.value.data.count;
        prevReportReplyCountRef.current = n;
        setReportReplyCount(n);
      }

      if (leaveResult.status === "fulfilled") {
        const n = leaveResult.value.data.count;
        if (prevLeaveDecisionCountRef.current !== null && n > prevLeaveDecisionCountRef.current) {
          playActionSound();
        }
        prevLeaveDecisionCountRef.current = n;
        setLeaveDecisionCount(n);
      }
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
    if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) return;

    const registerPush = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          const padding = "=".repeat((4 - (VAPID_PUBLIC_KEY.length % 4)) % 4);
          const base64 = (VAPID_PUBLIC_KEY + padding).replace(/-/g, "+").replace(/_/g, "/");
          const raw = window.atob(base64);
          const key = Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        }

        await api.post("/api/notifications/subscribe", {
          endpoint: sub.endpoint,
          p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")))),
          auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")))),
        });
      } catch {
        // Push is optional — silent failure
      }
    };

    registerPush();
  }, []);

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
  const [checkingAgentConnection, setCheckingAgentConnection] = useState(false);

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
  const chatMessagesContainerRef = useRef(null);
  const [showChatScrollButton, setShowChatScrollButton] = useState(false);
  const [hasMoreChatMessages, setHasMoreChatMessages] = useState(false);
  const [loadingOlderChat, setLoadingOlderChat] = useState(false);
  const skipChatScrollRef = useRef(false);
  const prevChatScrollHeightRef = useRef(0);

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
  const TOOLTIP_WIDTH = 208;
  const TOOLTIP_HEIGHT = 190;
  const showCalendarTooltip = (event, day) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const margin = 8;
    const x = Math.min(
      Math.max(margin, rect.left - TOOLTIP_WIDTH / 2 + rect.width / 2),
      window.innerWidth - TOOLTIP_WIDTH - margin
    );
    const preferredY = rect.top - TOOLTIP_HEIGHT - 10;
    const y =
      preferredY < margin
        ? Math.min(rect.bottom + 10, window.innerHeight - TOOLTIP_HEIGHT - margin)
        : preferredY;
    setCalendarTooltip({ visible: true, day, x, y });
  };
  const hideCalendarTooltip = () =>
    setCalendarTooltip({ visible: false, day: null, x: 0, y: 0 });
  const [profileDetails, setProfileDetails] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [alertTab, setAlertTab] = useState("pending");
  const [pendingAlerts, setPendingAlerts] = useState([]);
  const [alertHistory, setAlertHistory] = useState([]);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [acknowledgingAlertId, setAcknowledgingAlertId] = useState(null);
  const [replyAlertId, setReplyAlertId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [sentAlerts, setSentAlerts] = useState([]);
  const [sendAlertType, setSendAlertType] = useState("info");
  const [sendRecipientId, setSendRecipientId] = useState("");
  const [sendAlertMessage, setSendAlertMessage] = useState("");
  const [sendAlertError, setSendAlertError] = useState("");
  const [sendingAlert, setSendingAlert] = useState(false);
  const [potentialRecipients, setPotentialRecipients] = useState([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [alertDeliveryReport, setAlertDeliveryReport] = useState(null);
  const [loadingAlertReportId, setLoadingAlertReportId] = useState(null);

  const [myTasks, setMyTasks] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [taskStatusFilter, setTaskStatusFilter] = useState("");
  const [updatingTaskStatusId, setUpdatingTaskStatusId] = useState(null);
  const [configuredLeaveTypes, setConfiguredLeaveTypes] = useState([]);

  const fetchMyTasks = async () => {
    setLoadingTasks(true);
    try {
      const params = {};
      if (taskStatusFilter) params.status = taskStatusFilter;
      const response = await api.get("/api/tasks/my-tasks", { params });
      setMyTasks(response.data);
    } catch {
      toast.error("Could not load tasks");
    } finally {
      setLoadingTasks(false);
    }
  };

  const handleTaskStatusUpdate = async (taskId, newStatus) => {
    setUpdatingTaskStatusId(taskId);
    try {
      const response = await api.patch(`/api/tasks/${taskId}/status`, { status: newStatus });
      setMyTasks((prev) => prev.map((t) => (t.id === taskId ? response.data.task : t)));
    } catch {
      toast.error("Could not update task status");
    } finally {
      setUpdatingTaskStatusId(null);
    }
  };

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
      const [pendingResponse, historyResponse, sentResponse] = await Promise.all([
        api.get("/api/alerts/my-pending"),
        api.get("/api/alerts/my-history"),
        api.get("/api/alerts/sent"),
      ]);
      setPendingAlerts(pendingResponse.data);
      setAlertHistory(historyResponse.data);
      setSentAlerts(sentResponse.data);
    } catch (error) {
      toast.error("Could not load alerts");
    } finally {
      setLoadingAlerts(false);
    }
  };

  const fetchPotentialRecipients = async () => {
    setLoadingRecipients(true);
    try {
      const response = await api.get("/api/alerts/potential-recipients");
      setPotentialRecipients(response.data);
    } catch {
      // silently ignore; user will see an empty dropdown
    } finally {
      setLoadingRecipients(false);
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
        setCurrentStatus(() => {
          if (!response.data?.started) return "not_started";
          if (response.data.logout_time) return "ended";
          return response.data.current_status || "active";
        });
        if (response.data?.break_started_at) {
          setBreakStartedAt(response.data.break_started_at);
        }
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
    fetchLeaveRequests();
    fetchAlerts();
    fetchMyTasks();
    fetchPotentialRecipients();

    const attendanceIntervalId = setInterval(fetchAttendance, 30000);
    const alertsIntervalId = setInterval(fetchAlerts, 30000);
    return () => {
      clearInterval(attendanceIntervalId);
      clearInterval(alertsIntervalId);
    };
  }, []);

  useEffect(() => {
    api.get("/api/leave/types")
      .then((res) => setConfiguredLeaveTypes(res.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); e.returnValue = ""; };
    if (attendance?.started && !attendance?.logout_time) {
      window.addEventListener("beforeunload", handler);
      return () => window.removeEventListener("beforeunload", handler);
    }
  }, [attendance?.started, attendance?.logout_time]);

  useEffect(() => {
    if (activeSection === "tasks") {
      fetchMyTasks();
    }
  }, [activeSection, taskStatusFilter]);

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
    let reconnectDelay = 3000;
    let reconnectTimeout = null;
    let destroyed = false;

    function sendVisibility() {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: "visibility", visible: document.visibilityState === "visible" })
        );
      }
    }

    function connect() {
    const ws = new WebSocket(`${wsUrl}/api/chat/ws/${currentUserId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectDelay = 3000;
      ws.send(JSON.stringify({ token }));
      sendVisibility();
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

      if (data.type === "notification") {
        const { kind } = data;
        if (kind === "report_reply") {
          setReportReplyCount((c) => c + 1);
          playActionSound();
        } else if (kind === "leave_decision") {
          setLeaveDecisionCount((c) => c + 1);
          playActionSound();
        }
        return;
      }

      if (data.type !== "new_message") {
        return;
      }

      const activeConversation = selectedConversationRef.current;
      const isFromSomeoneElse = data.sender_id !== currentUserId;
      const isActiveChat = activeConversation?.user_id === data.sender_id;

      if (isFromSomeoneElse) {
        playMessageSound();
        // Update sidebar badge immediately — don't wait for the 30 s poll
        if (!isActiveChat) {
          setUnreadCount((c) => c + 1);
        }
      }

      if (isActiveChat) {
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

    }

    connect();

    document.addEventListener("visibilitychange", sendVisibility);
    const visibilityRefreshInterval = setInterval(sendVisibility, 30000);

    return () => {
      destroyed = true;
      clearTimeout(reconnectTimeout);
      clearInterval(visibilityRefreshInterval);
      document.removeEventListener("visibilitychange", sendVisibility);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [currentUserId]);

  const scrollChatToBottom = () => {
    if (chatMessagesContainerRef.current) {
      chatMessagesContainerRef.current.scrollTop = chatMessagesContainerRef.current.scrollHeight;
    }
  };

  const loadOlderChatMessages = async () => {
    if (!hasMoreChatMessages || loadingOlderChat || chatMessages.length === 0 || !selectedConversation) return;
    setLoadingOlderChat(true);
    const before = chatMessages[0].created_at;
    prevChatScrollHeightRef.current = chatMessagesContainerRef.current?.scrollHeight ?? 0;
    try {
      const response = await api.get(`/api/chat/history/${selectedConversation.user_id}`, {
        params: { before },
      });
      if (response.data.length === 0) {
        setHasMoreChatMessages(false);
        return;
      }
      skipChatScrollRef.current = true;
      setChatMessages((current) => [...response.data, ...current]);
      setHasMoreChatMessages(response.data.length === 50);
    } catch {
      toast.error("Could not load older messages");
    } finally {
      setLoadingOlderChat(false);
    }
  };

  const handleChatScroll = () => {
    if (!chatMessagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatMessagesContainerRef.current;
    setShowChatScrollButton(scrollHeight - scrollTop - clientHeight > 100);
    if (scrollTop < 10 && hasMoreChatMessages && !loadingOlderChat) {
      loadOlderChatMessages();
    }
  };

  useEffect(() => {
    if (skipChatScrollRef.current) {
      if (chatMessagesContainerRef.current) {
        chatMessagesContainerRef.current.scrollTop =
          chatMessagesContainerRef.current.scrollHeight - prevChatScrollHeightRef.current;
      }
      skipChatScrollRef.current = false;
    } else {
      scrollChatToBottom();
    }
  }, [chatMessages]);

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const handleStartDay = async () => {
    setCheckingAgentConnection(true);
    try {
      // Fresh check — the cached attendance poll may be up to 30 s stale,
      // so always re-fetch right now to get the latest agent_connected value.
      const checkResponse = await api.get("/api/attendance/today");
      if (checkResponse.data?.agent_connected === false) {
        toast.error("Agent not connected. Please ensure the WorkFlow Agent is running.");
        return;
      }
    } catch {
      // Network error on the check — proceed and let the start-day call surface it.
    } finally {
      setCheckingAgentConnection(false);
    }

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
        working_minutes_so_far: 0,
        agent_connected: true,
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
      setChatMessages(response.data);
      setHasMoreChatMessages(response.data.length === 50);
    } catch (error) {
      toast.error("Could not load chat");
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleSendMessage = () => {
    const content = chatInput.trim();
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

    setChatMessages((current) => [...current, optimisticMessage]);
    lastSentMessageRef.current = content;
    wsRef.current.send(
      JSON.stringify({
        recipient_id: selectedConversation.user_id,
        content,
      })
    );
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
    tasks: "My Tasks",
    profile: "Profile",
  };
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: Home },
    { id: "reports", label: "Reports", icon: ClipboardList, badge: reportReplyCount },
    { id: "leave", label: "Leave Requests", icon: CalendarDays, badge: leaveDecisionCount },
    { id: "messages", label: "Messages", icon: MessageSquare, badge: unreadCount },
    { id: "attendance", label: "Attendance", icon: CalendarClock },
    { id: "alerts", label: "Alerts", icon: Bell },
    { id: "tasks", label: "My Tasks", icon: ListChecks },
    { id: "profile", label: "Profile", icon: UserRound },
  ];
  const calendarDays = useMemo(() => {
    const selectedMonthNumber = selectedMonth.getMonth() + 1;
    const selectedYear = selectedMonth.getFullYear();
    const recordsByDate = new Map(
      (attendanceSummary?.attendance_records || []).map((record) => [record.date, record])
    );
    const daysInMonth = new Date(selectedYear, selectedMonthNumber, 0).getDate();
    const leadingBlankDays =
      (new Date(selectedYear, selectedMonthNumber - 1, 1).getDay() + 6) % 7;
    return [
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
        const publicHolidayDates = new Set((attendanceSummary?.public_holidays || []).map((h) => h.date));
        const isPublicHoliday = publicHolidayDates.has(dateKey);
        let dotClass = "bg-white border border-slate-300 dark:bg-white/5 dark:border-white/15";
        let statusLabel = "No record";

        if (isPublicHoliday && !record) {
          dotClass = "bg-amber-400";
          statusLabel = "Public holiday";
        } else if (isWeekend || isFuture) {
          dotClass = "bg-slate-300 dark:bg-white/10";
          statusLabel = isFuture ? "Upcoming" : "Weekend";
        } else if (record?.work_mode === "leave") {
          dotClass = "bg-sky-500";
          statusLabel = "On leave";
        } else if (record?.is_present) {
          dotClass = "bg-emerald-500";
          statusLabel = "Present";
        } else if (record) {
          dotClass = "bg-rose-500";
          statusLabel = "Absent";
        }

        return {
          id: dateKey,
          date: dateKey,
          day,
          dotClass,
          statusLabel,
          work_mode: record?.work_mode || (isPublicHoliday ? "holiday" : "office"),
          working_minutes: record?.working_minutes || 0,
          break_minutes: record?.break_minutes || 0,
          idle_minutes: record?.idle_minutes || 0,
          login_time: record?.login_time || null,
          logout_time: record?.logout_time || null,
        };
      }),
    ];
  }, [selectedMonth, attendanceSummary]);
  const profile = attendanceSummary || profileDetails || user;

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

  const handleSendAlertReply = async (alert) => {
    const cleanReply = replyText.trim();
    if (!cleanReply) {
      toast.error("Reply message cannot be empty");
      return;
    }

    try {
      await api.post(`/api/alerts/my-acknowledge/${alert.alert_recipient_id}`, {
        reply: cleanReply,
      });
      toast.success("Reply submitted successfully!");
      setReplyAlertId(null);
      setReplyText("");
      fetchAlerts();
    } catch (error) {
      toast.error("Could not submit reply");
    }
  };

  const handleSendAlert = async (e) => {
    e.preventDefault();
    const cleanMessage = sendAlertMessage.trim();
    if (!cleanMessage) {
      setSendAlertError("Message cannot be empty");
      return;
    }
    if (!sendRecipientId) {
      setSendAlertError("Please select a recipient");
      return;
    }
    setSendingAlert(true);
    setSendAlertError("");
    try {
      const response = await api.post("/api/alerts/send", {
        alert_type: sendAlertType,
        message: cleanMessage,
        recipient_id: sendRecipientId === "all" ? null : sendRecipientId,
      });
      toast.success(`Alert sent to ${response.data.recipient_count} recipient(s)`);
      setSendAlertType("info");
      setSendRecipientId("");
      setSendAlertMessage("");
      fetchAlerts();
    } catch (err) {
      setSendAlertError(err.response?.data?.detail || "Could not send alert");
    } finally {
      setSendingAlert(false);
    }
  };

  const handleViewAlertDeliveryReport = async (alertId) => {
    setLoadingAlertReportId(alertId);
    try {
      const response = await api.get(`/api/alerts/delivery-report/${alertId}`);
      setAlertDeliveryReport(response.data);
      setSentAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, has_unread_replies: false } : a))
      );
    } catch {
      toast.error("Could not load delivery report");
    } finally {
      setLoadingAlertReportId(null);
    }
  };

  return (
    <DashboardShell
      brand="WorkFlow"
      logoUrl={logoUrl}
      onLogoError={() => setLogoError(true)}
      navItems={navItems}
      activeSection={activeSection}
      onSectionChange={(id) => {
        if (id === "messages") setUnreadCount(0);
        if (id === "reports") {
          setReportReplyCount(0);
          api.patch("/api/attendance/reports/mark-read").catch(() => {});
        }
        if (id === "leave") {
          setLeaveDecisionCount(0);
          api.patch("/api/leave/mark-read").catch(() => {});
        }
        setActiveSection(id);
      }}
      sectionLabel={sectionTitles[activeSection]}
      userName={user?.full_name || "Staff"}
      userSubtitle={user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "Staff"}
      onLogout={handleLogout}
      headerExtra={
        <>
          <Badge tone={STATUS_TONE[currentStatus] || "success"} className="hidden sm:inline-flex">
            {liveStatus}
          </Badge>
          <span className="hidden text-sm font-medium text-slate-500 dark:text-slate-400 md:inline">
            {formatDateTime(currentTime.toISOString())}
          </span>
        </>
      }
    >
      <div className="space-y-6">
        {activeSection === "dashboard" && (
          <Card>
            <CardBody>
              {loadingAttendance ? (
                <LoadingState label="Loading work day…" />
              ) : !attendance?.started ? (
                <div className="space-y-6">
                  <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                    Good morning, {user?.full_name || "there"}
                  </h1>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                      Work mode
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setWorkMode("office")}
                        className={`focus-ring rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                          workMode === "office"
                            ? "bg-brand-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                        }`}
                      >
                        Office
                      </button>
                      <button
                        type="button"
                        onClick={() => setWorkMode("wfh")}
                        className={`focus-ring rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                          workMode === "wfh"
                            ? "bg-brand-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                        }`}
                      >
                        WFH
                      </button>
                    </div>
                  </div>
                  <Button
                    onClick={handleStartDay}
                    loading={checkingAgentConnection}
                    className="w-full"
                    size="lg"
                  >
                    {checkingAgentConnection ? "Checking agent connection…" : "Start My Day"}
                  </Button>
                </div>
              ) : attendance.logout_time ? (
                <div className="text-center">
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                    Your day has ended. See you tomorrow!
                  </h2>
                  <p className="mt-3 text-slate-500 dark:text-slate-400">
                    Working hours: {formatElapsedDuration(attendance.login_time, attendance.logout_time)}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <div className="rounded-xl border border-slate-200/70 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Login time</div>
                      <div className="mt-1 font-bold text-slate-900 dark:text-white">
                        {formatTime(attendance.login_time)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200/70 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Working hours</div>
                      <div className="mt-1 font-bold text-slate-900 dark:text-white">
                        {minutesToHours(attendance.working_minutes_so_far ?? 0)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200/70 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Work mode</div>
                      <div className="mt-1 font-bold text-slate-900 dark:text-white">
                        {attendance.work_mode?.toUpperCase() || "N/A"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-amber-200/60 bg-amber-50 p-4 dark:border-amber-400/20 dark:bg-amber-500/10">
                      <div className="text-xs font-medium text-amber-700 dark:text-amber-300">Break</div>
                      <div className="mt-1 font-bold text-amber-900 dark:text-amber-200">
                        {minutesToHours(attendance.break_minutes || 0)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-brand-200/60 bg-brand-50 p-4 dark:border-brand-400/20 dark:bg-brand-500/10">
                      <div className="text-xs font-medium text-brand-700 dark:text-brand-300">Meeting</div>
                      <div className="mt-1 font-bold text-brand-900 dark:text-brand-200">
                        {minutesToHours(attendance.meeting_minutes || 0)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200/70 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Idle time</div>
                      <div className="mt-1 font-bold text-slate-900 dark:text-white">
                        {minutesToHours(attendance.idle_minutes || 0)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={currentStatus === "break" ? handleEndBreak : handleStartBreak}
                      className="focus-ring rounded-xl bg-amber-400 px-4 py-3 font-semibold text-amber-950 transition-colors hover:bg-amber-500"
                    >
                      {currentStatus === "break"
                        ? `End Break (${breakDurationMinutes} min)`
                        : "Start Break"}
                    </button>
                    <button
                      type="button"
                      onClick={currentStatus === "meeting" ? handleEndMeeting : handleStartMeeting}
                      className="focus-ring rounded-xl bg-brand-600 px-4 py-3 font-semibold text-white transition-colors hover:bg-brand-700"
                    >
                      {currentStatus === "meeting" ? "End Meeting" : "Start Meeting"}
                    </button>
                    <Button variant="danger" size="lg" onClick={() => setShowEndDayModal(true)}>
                      End My Day
                    </Button>
                  </div>
                  {currentStatus === "meeting" && <Badge tone="info">In Meeting</Badge>}
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {activeSection === "reports" && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Recent Reports</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              {reports.length === 0 ? (
                <EmptyState title="No reports yet" description="Your submitted daily reports will show up here." />
              ) : (
                reports.map((report) => (
                  <div key={report.id} className="rounded-xl border border-slate-200/70 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {formatDate(report.report_date)}
                      </div>
                      <div className="flex items-center gap-2">
                        {report.admin_reply && <Badge tone="success">Replied</Badge>}
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={downloadingSalarySlip === report.id}
                          onClick={() => handleDownloadSalarySlip(report)}
                        >
                          Salary Slip
                        </Button>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      {truncate(report.content, 100)}
                    </p>
                    {report.admin_reply && (
                      <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
                        {report.admin_reply}
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        )}

        {activeSection === "leave" && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Leave Requests</h2>
              <Button
                size="sm"
                onClick={() => {
                  setShowLeaveForm(true);
                  setLeaveError("");
                }}
              >
                Request Leave
              </Button>
            </CardHeader>
            <CardBody className="space-y-3">
              {loadingLeaveRequests ? (
                <LoadingState label="Loading leave requests…" />
              ) : leaveRequests.length === 0 ? (
                <EmptyState title="No leave requests yet" />
              ) : (
                leaveRequests.map((request) => (
                  <div key={request.id} className="rounded-xl border border-slate-200/70 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {request.leave_type}
                        </div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          {formatDate(request.start_date)} - {formatDate(request.end_date)} ·{" "}
                          {request.total_days} {request.total_days === 1 ? "day" : "days"}
                        </div>
                      </div>
                      <Badge tone={LEAVE_STATUS_TONE[request.status] || "neutral"}>
                        {request.status}
                      </Badge>
                    </div>
                    {request.admin_comment && (
                      <div className="mt-3 rounded-lg bg-white dark:bg-slate-900/80 p-3 text-sm text-slate-700 dark:text-slate-300">
                        {request.admin_comment}
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        )}

        {activeSection === "messages" && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Messages</h2>
              <Button size="sm" onClick={fetchAvailableChatUsers}>
                <Plus className="h-4 w-4" /> New Chat
              </Button>
            </CardHeader>
            <CardBody>
              {showNewChatSelector && (
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
                  className="focus-ring mb-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                >
                  <option value="">{loadingChatUsers ? "Loading users..." : "Select person"}</option>
                  {availableChatUsers.map((item) => (
                    <option key={item.user_id} value={item.user_id}>
                      {item.full_name}
                      {item.department ? ` - ${item.department}` : ""}
                    </option>
                  ))}
                </select>
              )}
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {conversations.length === 0 ? (
                  <EmptyState title="No conversations yet" />
                ) : (
                  conversations.map((conversation) => (
                    <button
                      key={conversation.user_id}
                      type="button"
                      onClick={() => handleOpenConversation(conversation)}
                      className="focus-ring flex w-full items-center justify-between gap-4 py-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {conversation.full_name}
                        </div>
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          {conversation.department || "No department"}
                        </div>
                        <div className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
                          {truncate(conversation.last_message, 40)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-xs text-slate-400">
                          {formatTime(conversation.last_message_at)}
                        </span>
                        {conversation.unread_count > 0 && (
                          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-600 px-2 text-xs font-bold text-white">
                            {conversation.unread_count}
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </CardBody>
          </Card>
        )}

        {activeSection === "attendance" && (
          <div className="space-y-6">
            <Card>
              <CardBody className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setSelectedMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                  aria-label="Previous month"
                  className="focus-ring rounded-lg bg-slate-100 p-2 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-center">
                  <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                    {selectedMonth.toLocaleDateString([], { month: "long", year: "numeric" })}
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Monthly attendance summary</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                  aria-label="Next month"
                  className="focus-ring rounded-lg bg-slate-100 p-2 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </CardBody>
            </Card>

            {loadingSummary ? (
              <LoadingState label="Loading attendance…" />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                <div className="rounded-xl border border-emerald-200/60 bg-emerald-50 p-4 dark:border-emerald-400/20 dark:bg-emerald-500/10">
                  <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Days Present</div>
                  <div className="mt-2 text-2xl font-bold text-emerald-900 dark:text-emerald-200">
                    {attendanceSummary?.days_present || 0}
                  </div>
                </div>
                <div className="rounded-xl border border-rose-200/60 bg-rose-50 p-4 dark:border-rose-400/20 dark:bg-rose-500/10">
                  <div className="text-xs font-medium text-rose-700 dark:text-rose-300">Days Absent</div>
                  <div className="mt-2 text-2xl font-bold text-rose-900 dark:text-rose-200">
                    {attendanceSummary?.days_absent || 0}
                  </div>
                </div>
                <div className="rounded-xl border border-brand-200/60 bg-brand-50 p-4 dark:border-brand-400/20 dark:bg-brand-500/10">
                  <div className="text-xs font-medium text-brand-700 dark:text-brand-300">Total Working Hours</div>
                  <div className="mt-2 text-2xl font-bold text-brand-900 dark:text-brand-200">
                    {minutesToHours(attendanceSummary?.total_working_minutes || 0)}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-200/60 bg-amber-50 p-4 dark:border-amber-400/20 dark:bg-amber-500/10">
                  <div className="text-xs font-medium text-amber-700 dark:text-amber-300">Total Break Time</div>
                  <div className="mt-2 text-2xl font-bold text-amber-900 dark:text-amber-200">
                    {minutesToHours(attendanceSummary?.total_break_minutes || 0)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-slate-100 p-4 dark:border-white/10 dark:bg-white/5">
                  <div className="text-xs font-medium text-slate-600 dark:text-slate-300">Total Idle Time</div>
                  <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                    {minutesToHours(attendanceSummary?.total_idle_minutes || 0)}
                  </div>
                </div>
              </div>
            )}

            <Card>
              <CardBody>
                <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-slate-400 sm:gap-2">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                    <div key={day}>{day}</div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-7 gap-1 sm:gap-2">
                  {calendarDays.map((day) =>
                    day.blank ? (
                      <div key={day.id} className="h-12" />
                    ) : (
                      <div
                        key={day.id}
                        className={`flex h-12 flex-col items-center justify-center gap-1 rounded-lg border text-xs text-slate-600 transition-colors dark:text-slate-300 sm:h-14 ${
                          day.date === todayDate
                            ? "border-brand-400/60 bg-brand-50 dark:border-brand-400/50 dark:bg-brand-500/10"
                            : "border-slate-200/70 bg-slate-50/80 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20"
                        }`}
                      >
                        <span className={day.date === todayDate ? "font-bold text-brand-700 dark:text-brand-200" : ""}>
                          {day.day}
                        </span>
                        <button
                          type="button"
                          aria-label={`${formatDate(day.date)}: ${day.statusLabel}`}
                          className={`focus-ring h-5 w-5 rounded-full ring-2 ring-black/5 transition-transform hover:scale-110 dark:ring-white/10 sm:h-6 sm:w-6 ${day.dotClass}`}
                          onMouseEnter={(event) => showCalendarTooltip(event, day)}
                          onMouseLeave={hideCalendarTooltip}
                          onFocus={(event) => showCalendarTooltip(event, day)}
                          onBlur={hideCalendarTooltip}
                        />
                      </div>
                    )
                  )}
                </div>
                {calendarTooltip.visible && calendarTooltip.day && createPortal(
                  <div
                    role="tooltip"
                    className="pointer-events-none fixed z-50 w-52 overflow-hidden rounded-xl bg-slate-900 text-xs text-white shadow-2xl ring-1 ring-white/10"
                    style={{ left: calendarTooltip.x, top: calendarTooltip.y }}
                  >
                    <div className={`flex items-center justify-between gap-2 px-3 py-2 ${TOOLTIP_HEADER_CLASS[calendarTooltip.day.dotClass] || "bg-white/10"}`}>
                      <span className="font-bold">{formatDate(calendarTooltip.day.date)}</span>
                      <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                        {calendarTooltip.day.statusLabel}
                      </span>
                    </div>
                    <div className="space-y-1.5 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Working</span>
                        <span className="font-semibold">{minutesToHours(calendarTooltip.day.working_minutes)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Break</span>
                        <span className="font-semibold">{minutesToHours(calendarTooltip.day.break_minutes)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Idle</span>
                        <span className="font-semibold">{minutesToHours(calendarTooltip.day.idle_minutes)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Mode</span>
                        <span className="font-semibold capitalize">{calendarTooltip.day.work_mode || "Office"}</span>
                      </div>
                      {calendarTooltip.day.login_time && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Login</span>
                          <span className="font-semibold">{formatTime(calendarTooltip.day.login_time)}</span>
                        </div>
                      )}
                      {calendarTooltip.day.logout_time && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Logout</span>
                          <span className="font-semibold">{formatTime(calendarTooltip.day.logout_time)}</span>
                        </div>
                      )}
                    </div>
                  </div>,
                  document.body
                )}
              </CardBody>
            </Card>
          </div>
        )}

        {activeSection === "alerts" && (
          <Card>
            <CardBody>
              <TabBar
                tabs={[
                  { id: "pending", label: "Pending", badge: pendingAlerts.length },
                  { id: "history", label: "History" },
                  { id: "send", label: "Send Alert" },
                ]}
                activeId={alertTab}
                onChange={setAlertTab}
              />

              {(alertTab === "pending" || alertTab === "history") && (
                <div className="mt-5 space-y-4">
                  {loadingAlerts ? (
                    <LoadingState label="Loading alerts…" />
                  ) : (alertTab === "pending" ? pendingAlerts : alertHistory).length === 0 ? (
                    <EmptyState title="No alerts found" />
                  ) : (
                    (alertTab === "pending" ? pendingAlerts : alertHistory).map((alert) => (
                      <div
                        key={alert.alert_recipient_id}
                        className="rounded-xl border border-slate-200 p-4 dark:border-white/10"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <Badge tone={ALERT_TYPE_TONE[alert.alert_type] || "info"}>
                              {alert.alert_type}
                            </Badge>
                            <div className="mt-3 font-semibold text-slate-900 dark:text-white">
                              From: {alert.sender_name}
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                              {alert.message}
                            </p>
                            <div className="mt-3 text-xs text-slate-400">
                              Sent: {formatDateTime(alert.created_at)}
                            </div>
                            {alert.acknowledged_at && (
                              <div className="mt-1 text-xs text-slate-400">
                                Acknowledged: {formatDateTime(alert.acknowledged_at)}
                              </div>
                            )}
                            {alert.reply && (
                              <div className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">
                                {alert.reply}
                              </div>
                            )}
                            {replyAlertId === alert.alert_recipient_id && (
                              <div className="mt-3 space-y-2">
                                <textarea
                                  value={replyText}
                                  onChange={(e) => setReplyText(e.target.value)}
                                  placeholder="Type your reply message..."
                                  className="focus-ring w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"
                                  rows={2}
                                />
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={() => handleSendAlertReply(alert)}>
                                    Send Reply
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => {
                                      setReplyAlertId(null);
                                      setReplyText("");
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {alertTab === "pending" && (
                              <Button
                                size="sm"
                                loading={acknowledgingAlertId === alert.alert_recipient_id}
                                onClick={() => handleAcknowledgeAlert(alert.alert_recipient_id)}
                              >
                                Acknowledge
                              </Button>
                            )}
                            {replyAlertId !== alert.alert_recipient_id && !alert.reply && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setReplyAlertId(alert.alert_recipient_id);
                                  setReplyText("");
                                }}
                              >
                                Reply
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {alertTab === "send" && (
                <div className="mt-5 grid gap-6 lg:grid-cols-5">
                  <div className="lg:col-span-2">
                    <div className="rounded-xl border border-slate-200 p-5 dark:border-white/10">
                      <h4 className="text-base font-bold text-slate-900 dark:text-white">New Alert</h4>
                      <form onSubmit={handleSendAlert} className="mt-5 space-y-5">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                            Alert type
                          </label>
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              type="button"
                              onClick={() => setSendAlertType("info")}
                              className={`focus-ring rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                                sendAlertType === "info"
                                  ? "bg-brand-600 text-white"
                                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                              }`}
                            >
                              Info
                            </button>
                            <button
                              type="button"
                              onClick={() => setSendAlertType("urgent")}
                              className={`focus-ring rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                                sendAlertType === "urgent"
                                  ? "bg-rose-600 text-white"
                                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                              }`}
                            >
                              Urgent
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                            Recipient
                          </label>
                          <select
                            value={sendRecipientId}
                            onChange={(e) => setSendRecipientId(e.target.value)}
                            disabled={loadingRecipients}
                            className="focus-ring w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none disabled:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-white"
                          >
                            <option value="">-- Select recipient --</option>
                            {potentialRecipients.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.full_name} ({r.role})
                              </option>
                            ))}
                            <option value="all">Broadcast to all team</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                            Message
                          </label>
                          <textarea
                            value={sendAlertMessage}
                            onChange={(e) => setSendAlertMessage(e.target.value.slice(0, 500))}
                            placeholder="Type your alert message..."
                            rows={4}
                            className="focus-ring w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                          />
                          <div className="mt-1 text-right text-xs text-slate-400">
                            {sendAlertMessage.length}/500
                          </div>
                        </div>
                        {sendAlertError && (
                          <div className="text-sm font-medium text-rose-600 dark:text-rose-400">
                            {sendAlertError}
                          </div>
                        )}
                        <Button
                          type="submit"
                          variant={sendAlertType === "urgent" ? "danger" : "primary"}
                          loading={sendingAlert}
                          className="w-full"
                        >
                          {sendingAlert ? "Sending..." : "Send Alert"}
                        </Button>
                      </form>
                    </div>
                  </div>

                  <div className="lg:col-span-3">
                    <div className="rounded-xl border border-slate-200 p-5 dark:border-white/10">
                      <h4 className="text-base font-bold text-slate-900 dark:text-white">Sent Alerts</h4>

                      {alertDeliveryReport ? (
                        <div className="mt-5">
                          <div className="flex items-center justify-between">
                            <h5 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                              Delivery Report
                            </h5>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setAlertDeliveryReport(null)}
                            >
                              Back to list
                            </Button>
                          </div>
                          <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
                            <div className="rounded-lg bg-slate-50 p-3 dark:bg-white/5">
                              <div className="font-bold text-slate-900 dark:text-white">
                                {alertDeliveryReport.total_recipients}
                              </div>
                              <div className="text-slate-500 dark:text-slate-400">Recipients</div>
                            </div>
                            <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-500/10">
                              <div className="font-bold text-emerald-700 dark:text-emerald-300">
                                {alertDeliveryReport.acknowledged_count}
                              </div>
                              <div className="text-emerald-700 dark:text-emerald-300">Acknowledged</div>
                            </div>
                            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-500/10">
                              <div className="font-bold text-amber-700 dark:text-amber-300">
                                {alertDeliveryReport.pending_count}
                              </div>
                              <div className="text-amber-700 dark:text-amber-300">Pending</div>
                            </div>
                          </div>
                          <div className="mt-5">
                            <h6 className="mb-2 text-xs font-bold uppercase text-slate-400">Recipients</h6>
                            <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
                              {alertDeliveryReport.recipients.map((r) => (
                                <div key={r.recipient_id} className="flex items-start justify-between gap-4 p-4 text-sm">
                                  <div>
                                    <div className="font-semibold text-slate-900 dark:text-white">{r.full_name}</div>
                                    {r.reply && (
                                      <div className="mt-2 rounded-lg bg-slate-50 p-2 text-slate-600 dark:bg-white/5 dark:text-slate-300">
                                        {r.reply}
                                      </div>
                                    )}
                                  </div>
                                  <Badge tone={r.status === "acknowledged" ? "success" : "warning"}>
                                    {r.status}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-5 space-y-3">
                          {loadingAlerts ? (
                            <LoadingState />
                          ) : sentAlerts.length === 0 ? (
                            <EmptyState title="No alerts sent yet" />
                          ) : (
                            sentAlerts.map((alert) => {
                              const progress =
                                alert.total_recipients > 0
                                  ? Math.round((alert.acknowledged_count / alert.total_recipients) * 100)
                                  : 0;
                              return (
                                <div
                                  key={alert.id}
                                  className={`rounded-xl border p-4 ${
                                    alert.has_unread_replies
                                      ? "border-rose-300 bg-rose-50/40 dark:border-rose-500/30 dark:bg-rose-500/5"
                                      : "border-slate-200 dark:border-white/10"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge tone={alert.alert_type === "urgent" ? "danger" : "info"}>
                                          {alert.alert_type === "urgent" ? "URGENT" : "INFO"}
                                        </Badge>
                                        {alert.has_unread_replies && (
                                          <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">
                                            New replies
                                          </span>
                                        )}
                                        <span className="text-xs text-slate-400">
                                          {formatDateTime(alert.created_at)}
                                        </span>
                                      </div>
                                      <p className="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                                        {alert.message}
                                      </p>
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      loading={loadingAlertReportId === alert.id}
                                      onClick={() => handleViewAlertDeliveryReport(alert.id)}
                                    >
                                      View Report
                                    </Button>
                                  </div>
                                  <div className="mt-3">
                                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                                      <span>{alert.acknowledged_count}/{alert.total_recipients} acknowledged</span>
                                      {alert.pending_count > 0 && (
                                        <span className="font-medium text-amber-600 dark:text-amber-400">
                                          {alert.pending_count} pending
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                                      <div
                                        className="h-full rounded-full bg-emerald-500 transition-all"
                                        style={{ width: `${progress}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {activeSection === "tasks" && (
          <div className="space-y-4">
            <select
              value={taskStatusFilter}
              onChange={(e) => setTaskStatusFilter(e.target.value)}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Done</option>
            </select>

            {loadingTasks ? (
              <Card><CardBody><LoadingState label="Loading tasks…" /></CardBody></Card>
            ) : myTasks.length === 0 ? (
              <Card><CardBody><EmptyState title="No tasks assigned to you yet" /></CardBody></Card>
            ) : (
              <div className="space-y-4">
                {myTasks.map((task) => (
                  <Card key={task.id}>
                    <CardBody>
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex-1">
                          <h3 className="text-base font-bold text-slate-900 dark:text-white">{task.title}</h3>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                            {task.description}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                            <span>
                              Assigned by:{" "}
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {task.assigned_by_name}
                              </span>
                            </span>
                            <span>
                              Created:{" "}
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {formatDate(task.created_at)}
                              </span>
                            </span>
                            {task.due_date && (
                              <span>
                                Due:{" "}
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                  {formatDate(task.due_date)}
                                </span>
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge tone={TASK_STATUS_TONE[task.status]}>
                            {TASK_STATUS_LABEL[task.status]}
                          </Badge>
                          {task.status !== "done" && (
                            <select
                              value={task.status}
                              disabled={updatingTaskStatusId === task.id}
                              onChange={(e) => handleTaskStatusUpdate(task.id, e.target.value)}
                              className="focus-ring rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-slate-200"
                            >
                              <option value="pending">Mark Pending</option>
                              <option value="in_progress">Mark In Progress</option>
                              <option value="done">Mark Done</option>
                            </select>
                          )}
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSection === "profile" && (
          <div className="space-y-6">
            <Card>
              <CardBody>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {profile?.full_name || user?.full_name || "Staff"}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {profile?.employee_id || "Employee ID not available"}
                </p>
                {loadingProfile ? (
                  <LoadingState label="Loading profile…" />
                ) : (
                  <div className="mt-6 grid gap-4 text-sm md:grid-cols-2">
                    <div>
                      <span className="text-slate-400">Department</span>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {profile?.department || "N/A"}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400">Job Title</span>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {profile?.job_title || "N/A"}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400">Email</span>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {profile?.email || "N/A"}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400">Phone</span>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {profile?.phone || "N/A"}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400">Work Type</span>
                      <div className="mt-1">
                        <Badge tone={profile?.work_type === "wfh" ? "info" : "success"}>
                          {profile?.work_type === "wfh" ? "WFH" : "Office"}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400">Joining Date</span>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {formatDate(profile?.joining_date)}
                      </div>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              <div className="rounded-xl border border-emerald-200/60 bg-emerald-50 p-4 dark:border-emerald-400/20 dark:bg-emerald-500/10">
                <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Days Present</div>
                <div className="mt-2 text-2xl font-bold text-emerald-900 dark:text-emerald-200">
                  {attendanceSummary?.days_present || 0}
                </div>
              </div>
              <div className="rounded-xl border border-rose-200/60 bg-rose-50 p-4 dark:border-rose-400/20 dark:bg-rose-500/10">
                <div className="text-xs font-medium text-rose-700 dark:text-rose-300">Days Absent</div>
                <div className="mt-2 text-2xl font-bold text-rose-900 dark:text-rose-200">
                  {attendanceSummary?.days_absent || 0}
                </div>
              </div>
              <div className="rounded-xl border border-brand-200/60 bg-brand-50 p-4 dark:border-brand-400/20 dark:bg-brand-500/10">
                <div className="text-xs font-medium text-brand-700 dark:text-brand-300">Total Working Hours</div>
                <div className="mt-2 text-2xl font-bold text-brand-900 dark:text-brand-200">
                  {minutesToHours(attendanceSummary?.total_working_minutes || 0)}
                </div>
              </div>
              <div className="rounded-xl border border-amber-200/60 bg-amber-50 p-4 dark:border-amber-400/20 dark:bg-amber-500/10">
                <div className="text-xs font-medium text-amber-700 dark:text-amber-300">Total Break Time</div>
                <div className="mt-2 text-2xl font-bold text-amber-900 dark:text-amber-200">
                  {minutesToHours(attendanceSummary?.total_break_minutes || 0)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200/70 bg-slate-100 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-300">Total Idle Time</div>
                <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {minutesToHours(attendanceSummary?.total_idle_minutes || 0)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={showEndDayModal}
        onClose={() => setShowEndDayModal(false)}
        title="End Your Day"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEndDayModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={submittingReport} onClick={handleEndDay}>
              Submit & Logout
            </Button>
          </>
        }
      >
        <textarea
          value={reportContent}
          onChange={(event) => setReportContent(event.target.value)}
          placeholder="Summarise what you worked on today..."
          className="focus-ring min-h-40 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
        />
        <div className="mt-1 text-right text-xs text-slate-400">
          {reportContent.length} characters
        </div>
      </Modal>

      {selectedConversation && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:p-4">
          <div className="relative flex h-full w-full flex-col bg-white/95 shadow-xl backdrop-blur-xl dark:bg-slate-900/95 sm:h-[80vh] sm:max-w-3xl sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-5 dark:border-white/10">
              <div>
                <div className="font-bold text-slate-900 dark:text-white">
                  {selectedConversation.full_name}
                </div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  {selectedConversation.department || "No department"}
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setSelectedConversation(null)}>
                Close
              </Button>
            </div>

            <div
              ref={chatMessagesContainerRef}
              onScroll={handleChatScroll}
              className="flex flex-1 flex-col gap-4 overflow-y-auto bg-slate-50 p-5 dark:bg-black/20"
            >
              {loadingMessages ? (
                <LoadingState label="Loading messages…" />
              ) : chatMessages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-slate-400">
                  Start a conversation with {selectedConversation.full_name}
                </div>
              ) : (
                <>
                  {hasMoreChatMessages && (
                    <div className="flex justify-center py-2">
                      {loadingOlderChat ? (
                        <span className="text-xs text-slate-400">Loading older messages...</span>
                      ) : (
                        <button
                          type="button"
                          onClick={loadOlderChatMessages}
                          className="focus-ring rounded-full bg-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-300 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15"
                        >
                          Load older messages
                        </button>
                      )}
                    </div>
                  )}
                  {chatMessages.map((message) => {
                    const sentByMe = message.sender_id === currentUserId;
                    return (
                      <div key={message.message_id} className={`flex ${sentByMe ? "justify-end" : "justify-start"}`}>
                        <div className="max-w-[80%] sm:max-w-[70%]">
                          {!sentByMe && (
                            <div className="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                              {message.sender_name || selectedConversation.full_name}
                            </div>
                          )}
                          <div
                            className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
                              sentByMe
                                ? "bg-brand-600 text-white"
                                : "bg-white text-slate-800 dark:bg-white/10 dark:text-slate-100"
                            }`}
                          >
                            {message.content}
                          </div>
                          <div className={`mt-1 text-xs text-slate-400 ${sentByMe ? "text-right" : "text-left"}`}>
                            {formatTime(message.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {showChatScrollButton && (
              <button
                type="button"
                onClick={scrollChatToBottom}
                aria-label="Scroll to latest message"
                title="Scroll to latest message"
                className="focus-ring absolute bottom-24 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
            )}

            <div className="border-t border-slate-200 p-4 dark:border-white/10">
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
                  className="focus-ring flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  aria-label="Send message"
                  className="focus-ring flex items-center justify-center rounded-lg bg-brand-600 px-5 py-3 text-white hover:bg-brand-700"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

export default StaffDashboard;

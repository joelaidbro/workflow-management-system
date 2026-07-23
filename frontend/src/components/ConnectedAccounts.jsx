import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CalendarCheck, ShieldCheck } from "lucide-react";

import api from "../api.js";
import Card, { CardBody, CardHeader } from "./ui/Card.jsx";
import Button from "./ui/Button.jsx";
import Badge from "./ui/Badge.jsx";
import { formatDateTime } from "../utils/dateUtils";

export default function ConnectedAccounts() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await api.get("/api/calendar/status");
      setStatus(res.data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    const params = new URLSearchParams(window.location.search);
    const calendarResult = params.get("calendar");
    if (calendarResult === "connected") {
      toast.success("Google Calendar connected");
    } else if (calendarResult === "failed") {
      toast.error("Google Calendar connection failed. Please try again.");
    }
    if (calendarResult) {
      params.delete("calendar");
      const newSearch = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${newSearch ? `?${newSearch}` : ""}`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await api.get("/api/calendar/auth-url");
      window.location.href = res.data.auth_url;
    } catch {
      toast.error("Could not start Google connection. Please try again.");
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await api.delete("/api/calendar/disconnect");
      toast.success("Google Calendar disconnected");
      await fetchStatus();
    } catch {
      toast.error("Could not disconnect. Please try again.");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Connected Accounts</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Sync your reminders to Google Calendar for notifications on all your devices.
          </p>
        </div>
        {!loading && (
          <Badge tone={status?.connected ? "success" : "neutral"}>
            {status?.connected ? "Connected" : "Not connected"}
          </Badge>
        )}
      </CardHeader>
      <CardBody>
        {loading ? (
          <p className="text-sm text-slate-400">Checking connection...</p>
        ) : status?.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
              <CalendarCheck className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                Connected since{" "}
                {status.connected_at ? formatDateTime(status.connected_at) : "recently"}
              </span>
            </div>
            <Button variant="secondary" size="sm" loading={disconnecting} onClick={handleDisconnect}>
              Disconnect Google Calendar
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-slate-200/70 bg-slate-50 p-4 text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              <ShieldCheck className="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" />
              <p>
                We only request permission to create, edit, and delete calendar events for your
                reminders — never to read your existing calendar. Your connection is stored
                encrypted, and you can disconnect at any time.
              </p>
            </div>
            <Button size="sm" loading={connecting} onClick={handleConnect}>
              Connect Google Calendar
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

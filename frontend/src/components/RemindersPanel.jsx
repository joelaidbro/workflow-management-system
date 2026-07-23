import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Bell, Pencil, Plus, Trash2 } from "lucide-react";

import api from "../api.js";
import Button from "./ui/Button.jsx";
import Card, { CardBody } from "./ui/Card.jsx";
import Badge from "./ui/Badge.jsx";
import Modal from "./ui/Modal.jsx";
import { EmptyState, LoadingState } from "./ui/States.jsx";
import { formatDateTime } from "../utils/dateUtils";

const OFFSET_OPTIONS = [
  { minutes: 10, label: "10 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
];

const STATUS_TONE = { pending: "pending", sent: "success", failed: "danger" };

const EMPTY_FORM = { title: "", description: "", remindAt: "", offsets: [] };

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function toDate(isoString) {
  return new Date(isoString.endsWith("Z") ? isoString : `${isoString}Z`);
}

export default function RemindersPanel() {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingReminder, setEditingReminder] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchReminders = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/reminders/");
      setReminders(res.data);
    } catch {
      toast.error("Could not load reminders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReminders();
  }, []);

  const openCreateForm = () => {
    const defaultTime = new Date(Date.now() + 60 * 60 * 1000);
    setEditingReminder(null);
    setForm({ ...EMPTY_FORM, remindAt: toLocalInputValue(defaultTime) });
    setFormError("");
    setShowForm(true);
  };

  const openEditForm = (reminder) => {
    setEditingReminder(reminder);
    setForm({
      title: reminder.title,
      description: reminder.description || "",
      remindAt: toLocalInputValue(toDate(reminder.remind_at)),
      offsets: reminder.reminder_offsets || [],
    });
    setFormError("");
    setShowForm(true);
  };

  const toggleOffset = (minutes) => {
    setForm((f) => ({
      ...f,
      offsets: f.offsets.includes(minutes)
        ? f.offsets.filter((m) => m !== minutes)
        : [...f.offsets, minutes],
    }));
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      setFormError("Title is required");
      return;
    }
    if (!form.remindAt) {
      setFormError("Reminder date and time is required");
      return;
    }
    const remindAtDate = new Date(form.remindAt);
    if (remindAtDate <= new Date()) {
      setFormError("Reminder date and time must be in the future");
      return;
    }

    setSubmitting(true);
    setFormError("");
    const body = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      remind_at: remindAtDate.toISOString(),
      reminder_offsets: form.offsets,
    };
    try {
      if (editingReminder) {
        await api.patch(`/api/reminders/${editingReminder.id}`, body);
        toast.success("Reminder updated");
      } else {
        await api.post("/api/reminders/", body);
        toast.success("Reminder set");
      }
      setShowForm(false);
      fetchReminders();
    } catch (err) {
      setFormError(err.response?.data?.detail || "Could not save reminder");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (reminderId) => {
    setDeletingId(reminderId);
    try {
      await api.delete(`/api/reminders/${reminderId}`);
      toast.success("Reminder deleted");
      setReminders((prev) => prev.filter((r) => r.id !== reminderId));
    } catch {
      toast.error("Could not delete reminder");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Reminders</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Set a reminder for yourself — synced to Google Calendar if connected, with an in-app
            notification as backup.
          </p>
        </div>
        <Button onClick={openCreateForm}>
          <Plus className="h-4 w-4" /> New Reminder
        </Button>
      </div>

      {loading ? (
        <LoadingState label="Loading reminders…" />
      ) : reminders.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No reminders yet"
          description="Create one to get notified at the right time."
        />
      ) : (
        <div className="space-y-3">
          {reminders.map((reminder) => (
            <Card key={reminder.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900 dark:text-white">
                        {reminder.title}
                      </h3>
                      <Badge tone={STATUS_TONE[reminder.status] || "neutral"}>
                        {reminder.status.charAt(0).toUpperCase() + reminder.status.slice(1)}
                      </Badge>
                    </div>
                    {reminder.description && (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {reminder.description}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-slate-400">
                      {formatDateTime(reminder.remind_at)}
                    </p>
                    {reminder.status === "failed" && (
                      <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">
                        Reminder failed to send. Try resetting it or contact your admin.
                      </p>
                    )}
                  </div>
                  {reminder.status === "pending" && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => openEditForm(reminder)}
                        aria-label="Edit reminder"
                        title="Edit reminder"
                        className="focus-ring rounded-lg bg-slate-100 p-2 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(reminder.id)}
                        disabled={deletingId === reminder.id}
                        aria-label="Delete reminder"
                        title="Delete reminder"
                        className="focus-ring rounded-lg bg-rose-50 p-2 text-rose-600 hover:bg-rose-100 disabled:opacity-60 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/15"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingReminder ? "Edit Reminder" : "New Reminder"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button loading={submitting} onClick={handleSubmit}>
              {editingReminder ? "Save Changes" : "Set Reminder"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {formError}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
              Title
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Call the client"
              className="focus-ring mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional details"
              className="focus-ring mt-1 min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
              Reminder Date & Time
            </label>
            <input
              type="datetime-local"
              value={form.remindAt}
              onChange={(e) => setForm((f) => ({ ...f, remindAt: e.target.value }))}
              className="focus-ring mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
              Notify me
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {OFFSET_OPTIONS.map((opt) => (
                <button
                  key={opt.minutes}
                  type="button"
                  onClick={() => toggleOffset(opt.minutes)}
                  className={`focus-ring rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    form.offsets.includes(opt.minutes)
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

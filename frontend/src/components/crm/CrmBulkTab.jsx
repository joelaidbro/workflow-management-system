import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../../api.js";
import Card, { CardBody } from "../ui/Card.jsx";
import Button from "../ui/Button.jsx";
import { EmptyState } from "../ui/States.jsx";

const STAGE_OPTIONS = [
  { value: "", label: "Any stage" },
  { value: "new", label: "New" },
  { value: "in_progress", label: "In Follow Up" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export default function CrmBulkTab({ masterData }) {
  const [mode, setMode] = useState("assign"); // "assign" | "transfer"
  const [filters, setFilters] = useState({
    stage: "",
    lead_source_id: "",
    lead_status_id: "",
    assigned_to: "",
    lead_quality: "",
  });
  const [targetUserId, setTargetUserId] = useState("");
  const [salesUsers, setSalesUsers] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    api.get("/api/users/list", { params: { department: "Sales" } })
      .then((res) => setSalesUsers(res.data))
      .catch(() => toast.error("Could not load sales staff — you may not have permission for bulk actions"));
  }, []);

  const cleanFilters = () =>
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ""));

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const response = await api.post("/api/crm/leads/preview-filter", cleanFilters());
      setPreview(response.data);
      setSelectedIds(response.data.leads.map((l) => l.id));
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not preview leads");
    } finally {
      setPreviewing(false);
    }
  };

  const toggleOne = (leadId) => {
    setSelectedIds((c) => (c.includes(leadId) ? c.filter((id) => id !== leadId) : [...c, leadId]));
  };

  const toggleAll = () => {
    if (!preview) return;
    setSelectedIds((c) => (c.length === preview.leads.length ? [] : preview.leads.map((l) => l.id)));
  };

  const runAction = async () => {
    if (!targetUserId) {
      toast.error("Choose a target staff member");
      return;
    }
    if (!preview || preview.count === 0) {
      toast.error("Preview the filter first — nothing to act on");
      return;
    }
    if (selectedIds.length === 0) {
      toast.error("Select at least one lead");
      return;
    }
    setSubmitting(true);
    try {
      const endpoint = mode === "assign" ? "/api/crm/leads/bulk-assign" : "/api/crm/leads/bulk-transfer";
      const response = await api.post(endpoint, { ...cleanFilters(), target_user_id: targetUserId, lead_ids: selectedIds });
      toast.success(response.data.message);
      setPreview(null);
      setSelectedIds([]);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Bulk action failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/5">
        <button
          type="button"
          onClick={() => { setMode("assign"); setPreview(null); }}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${mode === "assign" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white" : "text-slate-500 dark:text-slate-400"}`}
        >
          Task Assignment
        </button>
        <button
          type="button"
          onClick={() => { setMode("transfer"); setPreview(null); }}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${mode === "transfer" ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white" : "text-slate-500 dark:text-slate-400"}`}
        >
          Lead Transfer
        </button>
      </div>

      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm text-slate-500">
            {mode === "assign"
              ? "Assign every lead matching these filters to a staff member — for routine task handout."
              : "Transfer ownership of every lead matching these filters — logs a followup note on each lead for a paper trail (rep leaving, territory change, etc.)."}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <select
              value={filters.stage}
              onChange={(e) => setFilters((c) => ({ ...c, stage: e.target.value }))}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              {STAGE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select
              value={filters.lead_source_id}
              onChange={(e) => setFilters((c) => ({ ...c, lead_source_id: e.target.value }))}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Any lead source</option>
              {masterData.leadSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select
              value={filters.lead_quality}
              onChange={(e) => setFilters((c) => ({ ...c, lead_quality: e.target.value }))}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Any quality</option>
              <option value="cold">Cold</option>
              <option value="warm">Warm</option>
              <option value="hot">Hot</option>
            </select>
            <select
              value={filters.assigned_to}
              onChange={(e) => setFilters((c) => ({ ...c, assigned_to: e.target.value }))}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Currently assigned to anyone</option>
              {salesUsers.map((u) => <option key={u.id} value={u.id}>Currently: {u.full_name}</option>)}
            </select>
            <select
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Target staff member…</option>
              {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" loading={previewing} onClick={runPreview}>Preview Matching Leads</Button>
            <Button loading={submitting} disabled={!preview || selectedIds.length === 0} onClick={runAction}>
              {mode === "assign" ? "Assign" : "Transfer"} {preview ? `(${selectedIds.length} selected)` : ""}
            </Button>
          </div>
        </CardBody>
      </Card>

      {preview && (
        preview.count === 0 ? (
          <EmptyState title="No leads match these filters" />
        ) : (
          <Card>
            <CardBody className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400 dark:border-white/10">
                    <th className="py-2 pr-4">
                      <input
                        type="checkbox"
                        checked={preview.leads.length > 0 && selectedIds.length === preview.leads.length}
                        onChange={toggleAll}
                      />
                    </th>
                    <th className="py-2 pr-4">Number</th>
                    <th className="py-2 pr-4">Customer</th>
                    <th className="py-2 pr-4">Phone</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Currently assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.leads.map((lead) => (
                    <tr key={lead.id} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                      <td className="py-2 pr-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(lead.id)}
                          onChange={() => toggleOne(lead.id)}
                        />
                      </td>
                      <td className="py-2 pr-4 font-semibold text-slate-900 dark:text-white">{lead.number}</td>
                      <td className="py-2 pr-4 font-medium text-slate-900 dark:text-white">{lead.customer_name}</td>
                      <td className="py-2 pr-4 text-slate-500">{lead.phone}</td>
                      <td className="py-2 pr-4 text-slate-500">{lead.lead_status_name}</td>
                      <td className="py-2 pr-4 text-slate-500">{lead.assigned_to_name || "Unassigned"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        )
      )}
    </div>
  );
}

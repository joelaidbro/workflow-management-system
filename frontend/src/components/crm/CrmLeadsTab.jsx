import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../../api.js";
import Card, { CardBody } from "../ui/Card.jsx";
import Badge from "../ui/Badge.jsx";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import { EmptyState, LoadingState } from "../ui/States.jsx";

const STAGE_TABS = [
  { id: "", label: "All" },
  { id: "new", label: "New" },
  { id: "in_progress", label: "In Follow Up" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

const QUALITY_TONE = { hot: "danger", warm: "warning", cold: "info" };

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export default function CrmLeadsTab({ masterData, currentUser, onCreateQuotationForLead }) {
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ leads: [], total: 0, page_size: 25 });
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [detailLeadId, setDetailLeadId] = useState(null);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const response = await api.get("/api/crm/leads", {
        params: { stage: stage || undefined, search: search || undefined, page },
      });
      setData(response.data);
    } catch (err) {
      toast.error("Could not load leads");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, page]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setPage(1);
    fetchLeads();
  };

  const totalPages = Math.max(1, Math.ceil(data.total / (data.page_size || 25)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/5">
          {STAGE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setStage(tab.id); setPage(1); }}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                stage === tab.id
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Button onClick={() => setShowCreateModal(true)}>Create Enquiry</Button>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, or number…"
          className="focus-ring w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
        />
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      {loading ? (
        <LoadingState label="Loading leads…" />
      ) : data.leads.length === 0 ? (
        <EmptyState title="No leads found" description="Create an enquiry to get started." />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400 dark:border-white/10">
                  <th className="py-2 pr-4">Number</th>
                  <th className="py-2 pr-4">Customer</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Quality</th>
                  <th className="py-2 pr-4">Assigned</th>
                  <th className="py-2 pr-4">Next followup</th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => setDetailLeadId(lead.id)}
                    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5"
                  >
                    <td className="py-2 pr-4 font-semibold text-slate-900 dark:text-white">{lead.number}</td>
                    <td className="py-2 pr-4">{lead.customer_name}</td>
                    <td className="py-2 pr-4 text-slate-500">{lead.phone}</td>
                    <td className="py-2 pr-4 text-slate-500">{lead.lead_source_name || "—"}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={lead.lead_status_nature === "won" ? "success" : lead.lead_status_nature === "lost" ? "danger" : "info"}>
                        {lead.lead_status_name}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">
                      {lead.lead_quality ? (
                        <Badge tone={QUALITY_TONE[lead.lead_quality] || "neutral"} icon={false}>
                          {lead.lead_quality}
                        </Badge>
                      ) : "—"}
                    </td>
                    <td className="py-2 pr-4 text-slate-500">{lead.assigned_to_name || "Unassigned"}</td>
                    <td className="py-2 pr-4 text-slate-500">{formatDate(lead.next_followup_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
                <span>Page {data.page} of {totalPages} · {data.total} lead(s)</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40 dark:border-white/10"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40 dark:border-white/10"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {showCreateModal && (
        <CreateEnquiryModal
          masterData={masterData}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetchLeads(); }}
        />
      )}

      {detailLeadId && (
        <LeadDetailModal
          leadId={detailLeadId}
          masterData={masterData}
          currentUser={currentUser}
          onClose={() => setDetailLeadId(null)}
          onChanged={fetchLeads}
          onCreateQuotation={(lead) => {
            setDetailLeadId(null);
            onCreateQuotationForLead?.(lead);
          }}
        />
      )}
    </div>
  );
}

function CreateEnquiryModal({ masterData, onClose, onCreated }) {
  const [form, setForm] = useState({
    customer_name: "",
    phone: "",
    place: "",
    lead_source_id: "",
    lead_quality: "",
    business_value: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!form.customer_name.trim() || !form.phone.trim()) {
      toast.error("Customer name and phone are required");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/crm/enquiries", {
        customer_name: form.customer_name.trim(),
        phone: form.phone.trim(),
        place: form.place || null,
        lead_source_id: form.lead_source_id || null,
        lead_quality: form.lead_quality || null,
        business_value: form.business_value === "" ? 0 : Number(form.business_value),
      });
      toast.success("Enquiry created");
      onCreated();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not create enquiry");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Create Enquiry"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={submitting} onClick={submit}>Create</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          type="text"
          value={form.customer_name}
          onChange={(e) => setForm((c) => ({ ...c, customer_name: e.target.value }))}
          placeholder="Customer name"
          className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
        />
        <input
          type="text"
          value={form.phone}
          onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))}
          placeholder="Phone"
          className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
        />
        <input
          type="text"
          value={form.place}
          onChange={(e) => setForm((c) => ({ ...c, place: e.target.value }))}
          placeholder="Place"
          className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
        />
        <select
          value={form.lead_source_id}
          onChange={(e) => setForm((c) => ({ ...c, lead_source_id: e.target.value }))}
          className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
        >
          <option value="">Lead source…</option>
          {masterData.leadSources.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={form.lead_quality}
          onChange={(e) => setForm((c) => ({ ...c, lead_quality: e.target.value }))}
          className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
        >
          <option value="">Quality…</option>
          <option value="cold">Cold</option>
          <option value="warm">Warm</option>
          <option value="hot">Hot</option>
        </select>
        <input
          type="number"
          value={form.business_value}
          onChange={(e) => setForm((c) => ({ ...c, business_value: e.target.value }))}
          placeholder="Business value"
          className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
        />
      </div>
    </Modal>
  );
}

function LeadDetailModal({ leadId, masterData, onClose, onChanged, onCreateQuotation }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusId, setStatusId] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [followupNote, setFollowupNote] = useState("");
  const [nextFollowupDate, setNextFollowupDate] = useState("");
  const [loggingFollowup, setLoggingFollowup] = useState(false);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/api/crm/leads/${leadId}`);
      setLead(response.data);
      setEditForm({
        customer_name: response.data.customer_name,
        phone: response.data.phone,
        place: response.data.place || "",
        lead_source_id: response.data.lead_source_id || "",
        business_value: response.data.business_value,
        lead_quality: response.data.lead_quality || "",
      });
      setStatusId(response.data.lead_status_id);
    } catch (err) {
      toast.error("Could not load lead");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const saveEdit = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/crm/leads/${leadId}`, {
        customer_name: editForm.customer_name,
        phone: editForm.phone,
        place: editForm.place || null,
        lead_source_id: editForm.lead_source_id || null,
        business_value: Number(editForm.business_value),
        lead_quality: editForm.lead_quality || null,
      });
      toast.success("Lead updated");
      fetchDetail();
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not update lead");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async () => {
    const target = masterData.leadStatuses.find((s) => s.id === statusId);
    if (target?.nature === "lost" && !lostReason.trim()) {
      toast.error("Enter a reason for marking this lead lost");
      return;
    }
    try {
      await api.post(`/api/crm/leads/${leadId}/status`, {
        lead_status_id: statusId,
        lost_reason: target?.nature === "lost" ? lostReason.trim() : null,
      });
      toast.success("Status updated");
      fetchDetail();
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not update status");
    }
  };

  const logFollowup = async () => {
    setLoggingFollowup(true);
    try {
      await api.post(`/api/crm/leads/${leadId}/followups`, {
        note: followupNote.trim() || null,
        next_followup_date: nextFollowupDate ? new Date(nextFollowupDate).toISOString() : null,
      });
      toast.success("Followup logged");
      setFollowupNote("");
      setNextFollowupDate("");
      fetchDetail();
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not log followup");
    } finally {
      setLoggingFollowup(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="xl" title={lead ? `${lead.number} — ${lead.customer_name}` : "Lead"}>
      {loading || !lead || !editForm ? (
        <LoadingState label="Loading lead…" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={editForm.customer_name}
              onChange={(e) => setEditForm((c) => ({ ...c, customer_name: e.target.value }))}
              placeholder="Customer name"
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
            <input
              type="text"
              value={editForm.phone}
              onChange={(e) => setEditForm((c) => ({ ...c, phone: e.target.value }))}
              placeholder="Phone"
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
            <input
              type="text"
              value={editForm.place}
              onChange={(e) => setEditForm((c) => ({ ...c, place: e.target.value }))}
              placeholder="Place"
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
            <select
              value={editForm.lead_source_id}
              onChange={(e) => setEditForm((c) => ({ ...c, lead_source_id: e.target.value }))}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Lead source…</option>
              {masterData.leadSources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <input
              type="number"
              value={editForm.business_value}
              onChange={(e) => setEditForm((c) => ({ ...c, business_value: e.target.value }))}
              placeholder="Business value"
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
            <select
              value={editForm.lead_quality}
              onChange={(e) => setEditForm((c) => ({ ...c, lead_quality: e.target.value }))}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">Quality…</option>
              <option value="cold">Cold</option>
              <option value="warm">Warm</option>
              <option value="hot">Hot</option>
            </select>
          </div>
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => onCreateQuotation(lead)}>Create Quotation</Button>
            <Button loading={saving} onClick={saveEdit}>Save Changes</Button>
          </div>

          <div className="rounded-lg border border-slate-200 p-4 dark:border-white/10">
            <h4 className="mb-2 font-semibold text-slate-900 dark:text-white">Status</h4>
            <div className="flex flex-wrap items-end gap-3">
              <select
                value={statusId}
                onChange={(e) => setStatusId(e.target.value)}
                className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
              >
                {masterData.leadStatuses.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              {masterData.leadStatuses.find((s) => s.id === statusId)?.nature === "lost" && (
                <input
                  type="text"
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  placeholder="Reason for losing this lead"
                  className="focus-ring flex-1 min-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              )}
              <Button variant="secondary" onClick={changeStatus}>Update Status</Button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4 dark:border-white/10">
            <h4 className="mb-2 font-semibold text-slate-900 dark:text-white">Log a Followup</h4>
            <div className="space-y-3">
              <textarea
                value={followupNote}
                onChange={(e) => setFollowupNote(e.target.value)}
                rows={2}
                placeholder="What happened in this contact?"
                className="focus-ring w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Next followup date</span>
                  <input
                    type="datetime-local"
                    value={nextFollowupDate}
                    onChange={(e) => setNextFollowupDate(e.target.value)}
                    className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                  />
                </label>
                <Button loading={loggingFollowup} onClick={logFollowup}>Log Followup</Button>
              </div>
            </div>
          </div>

          <div>
            <h4 className="mb-2 font-semibold text-slate-900 dark:text-white">Followup History</h4>
            {lead.followups.length === 0 ? (
              <p className="text-sm text-slate-400">No followups logged yet.</p>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {lead.followups.map((f) => (
                  <div key={f.id} className="rounded-lg border border-slate-100 p-3 text-sm dark:border-white/5">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>{formatDate(f.followup_date)} · {f.created_by_name}</span>
                      <span>{f.status_at_time}</span>
                    </div>
                    {f.note && <p className="mt-1 text-slate-700 dark:text-slate-300">{f.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

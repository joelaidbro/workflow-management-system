import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../../api.js";
import Card, { CardBody } from "../ui/Card.jsx";
import Badge from "../ui/Badge.jsx";
import { EmptyState, LoadingState } from "../ui/States.jsx";

const BUCKETS = [
  { id: "delayed", label: "Delayed", tone: "danger" },
  { id: "today", label: "Today", tone: "warning" },
  { id: "upcoming", label: "Upcoming", tone: "info" },
  { id: "none", label: "No date set", tone: "neutral" },
];

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function CrmFollowupsTab() {
  const [bucket, setBucket] = useState("delayed");
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchBucket = async () => {
    setLoading(true);
    try {
      const response = await api.get("/api/crm/followups", { params: { bucket } });
      setLeads(response.data.leads);
    } catch (err) {
      toast.error("Could not load followups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBucket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/5">
        {BUCKETS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBucket(b.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              bucket === b.id
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading followups…" />
      ) : leads.length === 0 ? (
        <EmptyState title="Nothing here" description="No leads in this bucket right now." />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400 dark:border-white/10">
                  <th className="py-2 pr-4">Number</th>
                  <th className="py-2 pr-4">Customer</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Assigned</th>
                  <th className="py-2 pr-4">Next followup</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-slate-100 last:border-0 dark:border-white/5">
                    <td className="py-2 pr-4 font-semibold text-slate-900 dark:text-white">{lead.number}</td>
                    <td className="py-2 pr-4">{lead.customer_name}</td>
                    <td className="py-2 pr-4 text-slate-500">{lead.phone}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={lead.lead_status_nature === "won" ? "success" : lead.lead_status_nature === "lost" ? "danger" : "info"}>
                        {lead.lead_status_name}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-slate-500">{lead.assigned_to_name || "Unassigned"}</td>
                    <td className="py-2 pr-4 text-slate-500">{formatDateTime(lead.next_followup_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

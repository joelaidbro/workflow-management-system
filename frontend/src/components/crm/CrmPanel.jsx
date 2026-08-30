import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../../api.js";
import TabBar from "../ui/TabBar.jsx";
import { LoadingState } from "../ui/States.jsx";
import CrmLeadsTab from "./CrmLeadsTab.jsx";
import CrmFollowupsTab from "./CrmFollowupsTab.jsx";
import CrmQuotationsTab from "./CrmQuotationsTab.jsx";
import CrmBulkTab from "./CrmBulkTab.jsx";
import CrmSettingsTab from "./CrmSettingsTab.jsx";

/**
 * Top-level CRM container, mounted from all three dashboards (super_admin,
 * admin, staff) behind the same access gate the backend enforces:
 * super_admin, or anyone in the Sales department. It owns the shared master
 * data (lead sources/statuses, item categories, items) so the five tabs
 * below don't each fetch it separately.
 */
export default function CrmPanel() {
  const currentUser = useMemo(() => {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  }, []);

  const isSuperAdmin = currentUser?.role === "super_admin";
  const isSalesDept = (currentUser?.department || "").trim().toLowerCase() === "sales";
  // Mirrors backend require_crm_manage: super_admin, or an admin-role user
  // in Sales, can edit master data. Plain sales staff can use it read-only.
  const canManageSettings = isSuperAdmin || (currentUser?.role === "admin" && isSalesDept);

  const [activeTab, setActiveTab] = useState("leads");
  const [masterData, setMasterData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [prefillQuotationLead, setPrefillQuotationLead] = useState(null);

  const fetchMasterData = async () => {
    try {
      const [sources, statuses, categories, items] = await Promise.all([
        api.get("/api/crm/lead-sources"),
        api.get("/api/crm/lead-statuses"),
        api.get("/api/crm/item-categories"),
        api.get("/api/crm/items"),
      ]);
      setMasterData({
        leadSources: sources.data,
        leadStatuses: statuses.data,
        itemCategories: categories.data,
        items: items.data,
      });
    } catch (err) {
      toast.error("Could not load CRM settings data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMasterData();
  }, []);

  const tabs = [
    { id: "leads", label: "Leads" },
    { id: "followups", label: "Followups" },
    { id: "quotations", label: "Quotations" },
    { id: "bulk", label: "Task Assignment / Transfer" },
    { id: "settings", label: "Settings" },
  ];

  if (loading || !masterData) {
    return <LoadingState label="Loading CRM…" />;
  }

  const newLeadStatusMissing = !masterData.leadStatuses.some((s) => s.nature === "new");

  return (
    <div className="space-y-6">
      <TabBar tabs={tabs} activeId={activeTab} onChange={setActiveTab} />

      {newLeadStatusMissing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          No lead status is configured with the "New" stage yet — enquiries can't be created until
          one exists. Add it under the Settings tab.
        </div>
      )}

      {activeTab === "leads" && (
        <CrmLeadsTab
          masterData={masterData}
          currentUser={currentUser}
          onCreateQuotationForLead={(lead) => {
            setPrefillQuotationLead(lead);
            setActiveTab("quotations");
          }}
        />
      )}
      {activeTab === "followups" && <CrmFollowupsTab />}
      {activeTab === "quotations" && (
        <CrmQuotationsTab
          masterData={masterData}
          currentUser={currentUser}
          prefillLead={prefillQuotationLead}
          clearPrefill={() => setPrefillQuotationLead(null)}
        />
      )}
      {activeTab === "bulk" && <CrmBulkTab masterData={masterData} />}
      {activeTab === "settings" && (
        <CrmSettingsTab
          masterData={masterData}
          refreshMasterData={fetchMasterData}
          canManage={canManageSettings}
        />
      )}
    </div>
  );
}

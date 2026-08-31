import { useState } from "react";
import toast from "react-hot-toast";
import api from "../../api.js";
import Card, { CardBody } from "../ui/Card.jsx";

const NATURE_OPTIONS = [
  { value: "new", label: "New" },
  { value: "in_progress", label: "In Follow Up" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

function MasterListCard({
  title,
  description,
  rows,
  renderRow,
  canManage,
  onDelete,
  children,
}) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-white">{title}</h3>
          {description && (
            <p className="text-xs text-slate-400">{description}</p>
          )}
        </div>

        <div className="grid gap-2">
          {rows.length === 0 && (
            <p className="text-sm text-slate-400">Nothing added yet.</p>
          )}
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm dark:border-white/10"
            >
              {renderRow(row)}
              {canManage && (
                <button
                  type="button"
                  onClick={() => onDelete(row.id)}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>

        {canManage && children}
      </CardBody>
    </Card>
  );
}

export default function CrmSettingsTab({ masterData, refreshMasterData, canManage }) {
  const [newSource, setNewSource] = useState("");
  const [newStatus, setNewStatus] = useState({ name: "", nature: "new" });
  const [newCategory, setNewCategory] = useState("");
  const [newItem, setNewItem] = useState({ name: "", item_category_id: "", default_rate: "" });
  const [loadingDefaults, setLoadingDefaults] = useState(false);

  const loadStarterDefaults = async () => {
    setLoadingDefaults(true);
    try {
      const response = await api.post("/api/crm/bootstrap-defaults");
      refreshMasterData();
      toast.success(response.data.message || "Starter defaults loaded");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not load starter defaults");
    } finally {
      setLoadingDefaults(false);
    }
  };

  const addLeadSource = async () => {
    if (!newSource.trim()) return;
    try {
      await api.post("/api/crm/lead-sources", { name: newSource.trim() });
      setNewSource("");
      refreshMasterData();
      toast.success("Lead source added");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not add lead source");
    }
  };

  const deleteLeadSource = async (id) => {
    try {
      await api.delete(`/api/crm/lead-sources/${id}`);
      refreshMasterData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not remove lead source");
    }
  };

  const addLeadStatus = async () => {
    if (!newStatus.name.trim()) return;
    try {
      await api.post("/api/crm/lead-statuses", newStatus);
      setNewStatus({ name: "", nature: "new" });
      refreshMasterData();
      toast.success("Lead status added");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not add lead status");
    }
  };

  const deleteLeadStatus = async (id) => {
    try {
      await api.delete(`/api/crm/lead-statuses/${id}`);
      refreshMasterData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not remove lead status");
    }
  };

  const addItemCategory = async () => {
    if (!newCategory.trim()) return;
    try {
      await api.post("/api/crm/item-categories", { name: newCategory.trim() });
      setNewCategory("");
      refreshMasterData();
      toast.success("Item category added");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not add item category");
    }
  };

  const deleteItemCategory = async (id) => {
    try {
      await api.delete(`/api/crm/item-categories/${id}`);
      refreshMasterData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not remove item category");
    }
  };

  const addItem = async () => {
    if (!newItem.name.trim()) return;
    try {
      await api.post("/api/crm/items", {
        name: newItem.name.trim(),
        item_category_id: newItem.item_category_id || null,
        default_rate: newItem.default_rate === "" ? null : Number(newItem.default_rate),
      });
      setNewItem({ name: "", item_category_id: "", default_rate: "" });
      refreshMasterData();
      toast.success("Item added");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not add item");
    }
  };

  const deleteItem = async (id) => {
    try {
      await api.delete(`/api/crm/items/${id}`);
      refreshMasterData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not remove item");
    }
  };

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 p-4 dark:border-white/15">
          <div>
            <h4 className="font-semibold text-slate-900 dark:text-white">Starter Defaults</h4>
            <p className="text-xs text-slate-400">
              Adds whichever of the standard New/In Follow Up/Won/Lost statuses and common lead
              sources you're missing by name — safe to click anytime, never duplicates anything
              you've already added.
            </p>
          </div>
          <button
            type="button"
            onClick={loadStarterDefaults}
            disabled={loadingDefaults}
            className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loadingDefaults ? "Loading…" : "Load Starter Defaults"}
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
      <MasterListCard
        title="Lead Sources"
        description="Where enquiries come from (Website, Referral, WhatsApp, etc.)"
        rows={masterData.leadSources}
        renderRow={(row) => <span className="font-medium text-slate-900 dark:text-white">{row.name}</span>}
        canManage={canManage}
        onDelete={deleteLeadSource}
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={newSource}
            onChange={(e) => setNewSource(e.target.value)}
            placeholder="e.g. Website"
            className="focus-ring flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          <button
            type="button"
            onClick={addLeadSource}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Add
          </button>
        </div>
      </MasterListCard>

      <MasterListCard
        title="Lead Statuses"
        description="Pipeline stages — each maps to New / In Follow Up / Won / Lost for the Leads tabs"
        rows={masterData.leadStatuses}
        renderRow={(row) => (
          <span className="font-medium text-slate-900 dark:text-white">
            {row.name}{" "}
            <span className="text-xs font-normal text-slate-400">
              ({NATURE_OPTIONS.find((n) => n.value === row.nature)?.label || row.nature})
            </span>
          </span>
        )}
        canManage={canManage}
        onDelete={deleteLeadStatus}
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={newStatus.name}
            onChange={(e) => setNewStatus((c) => ({ ...c, name: e.target.value }))}
            placeholder="e.g. Quotation Sent"
            className="focus-ring flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          <select
            value={newStatus.nature}
            onChange={(e) => setNewStatus((c) => ({ ...c, nature: e.target.value }))}
            className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            {NATURE_OPTIONS.map((n) => (
              <option key={n.value} value={n.value}>{n.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={addLeadStatus}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Add
          </button>
        </div>
      </MasterListCard>

      <MasterListCard
        title="Item Categories"
        description="Grouping for quotation line items"
        rows={masterData.itemCategories}
        renderRow={(row) => <span className="font-medium text-slate-900 dark:text-white">{row.name}</span>}
        canManage={canManage}
        onDelete={deleteItemCategory}
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="e.g. Services"
            className="focus-ring flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          <button
            type="button"
            onClick={addItemCategory}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Add
          </button>
        </div>
      </MasterListCard>

      <MasterListCard
        title="Items"
        description="Products/services used to build quotation line items, with an optional default rate"
        rows={masterData.items}
        renderRow={(row) => (
          <span className="font-medium text-slate-900 dark:text-white">
            {row.name}{" "}
            {row.item_category_name && (
              <span className="text-xs font-normal text-slate-400">({row.item_category_name})</span>
            )}
            {row.default_rate != null && (
              <span className="ml-2 text-xs font-normal text-slate-400">₹{row.default_rate}</span>
            )}
          </span>
        )}
        canManage={canManage}
        onDelete={deleteItem}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <input
            type="text"
            value={newItem.name}
            onChange={(e) => setNewItem((c) => ({ ...c, name: e.target.value }))}
            placeholder="Item name"
            className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          <select
            value={newItem.item_category_id}
            onChange={(e) => setNewItem((c) => ({ ...c, item_category_id: e.target.value }))}
            className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <option value="">No category</option>
            {masterData.itemCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="number"
            value={newItem.default_rate}
            onChange={(e) => setNewItem((c) => ({ ...c, default_rate: e.target.value }))}
            placeholder="Default rate"
            className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
          <button
            type="button"
            onClick={addItem}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Add
          </button>
        </div>
      </MasterListCard>
      </div>
    </div>
  );
}

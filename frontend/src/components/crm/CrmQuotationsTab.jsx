import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../../api.js";
import Card, { CardBody } from "../ui/Card.jsx";
import Modal from "../ui/Modal.jsx";
import Button from "../ui/Button.jsx";
import { EmptyState, LoadingState } from "../ui/States.jsx";

function emptyLine() {
  return { key: crypto.randomUUID(), item_id: "", item_name: "", rate: "", qty: 1, tax_percent: 0, note: "" };
}

function computeTotals(lines, discountType, discountValue) {
  let gross = 0;
  let tax = 0;
  for (const line of lines) {
    const rate = Number(line.rate) || 0;
    const qty = Number(line.qty) || 0;
    const taxPercent = Number(line.tax_percent) || 0;
    const lineGross = rate * qty;
    gross += lineGross;
    tax += lineGross * (taxPercent / 100);
  }
  const discount = discountType === "flat" ? Number(discountValue) || 0 : gross * ((Number(discountValue) || 0) / 100);
  const payable = Math.max(0, gross + tax - discount);
  return { gross, tax, discount, payable };
}

export default function CrmQuotationsTab({ masterData, currentUser, prefillLead, clearPrefill }) {
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewingQuotationId, setViewingQuotationId] = useState(null);

  const fetchQuotations = async () => {
    setLoading(true);
    try {
      const response = await api.get("/api/crm/quotations");
      setQuotations(response.data.quotations);
    } catch (err) {
      toast.error("Could not load quotations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotations();
  }, []);

  useEffect(() => {
    if (prefillLead) {
      setShowCreateModal(true);
    }
  }, [prefillLead]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreateModal(true)}>Create Quotation</Button>
      </div>

      {loading ? (
        <LoadingState label="Loading quotations…" />
      ) : quotations.length === 0 ? (
        <EmptyState title="No quotations yet" description="Create one from a lead to get started." />
      ) : (
        <Card>
          <CardBody className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400 dark:border-white/10">
                  <th className="py-2 pr-4">Number</th>
                  <th className="py-2 pr-4">Lead</th>
                  <th className="py-2 pr-4">Executive</th>
                  <th className="py-2 pr-4">Total Payable</th>
                  <th className="py-2 pr-4">Valid Upto</th>
                </tr>
              </thead>
              <tbody>
                {quotations.map((q) => (
                  <tr
                    key={q.id}
                    onClick={() => setViewingQuotationId(q.id)}
                    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5"
                  >
                    <td className="py-2 pr-4 font-semibold text-slate-900 dark:text-white">{q.number}</td>
                    <td className="py-2 pr-4">{q.lead_customer_name} <span className="text-xs text-slate-400">({q.lead_number})</span></td>
                    <td className="py-2 pr-4 text-slate-500">{q.sales_executive_name || "—"}</td>
                    <td className="py-2 pr-4 font-semibold">{q.currency} {q.total_payable}</td>
                    <td className="py-2 pr-4 text-slate-500">{q.valid_upto || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {showCreateModal && (
        <QuotationFormModal
          masterData={masterData}
          currentUser={currentUser}
          leadId={prefillLead?.id}
          leadLabel={prefillLead ? `${prefillLead.customer_name} (${prefillLead.number})` : ""}
          onClose={() => { setShowCreateModal(false); clearPrefill?.(); }}
          onSaved={() => { setShowCreateModal(false); clearPrefill?.(); fetchQuotations(); }}
        />
      )}

      {viewingQuotationId && (
        <QuotationFormModal
          masterData={masterData}
          currentUser={currentUser}
          quotationId={viewingQuotationId}
          onClose={() => setViewingQuotationId(null)}
          onSaved={() => { setViewingQuotationId(null); fetchQuotations(); }}
        />
      )}
    </div>
  );
}

function QuotationFormModal({ masterData, currentUser, leadId, leadLabel, quotationId, onClose, onSaved }) {
  const isEdit = Boolean(quotationId);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [salesUsers, setSalesUsers] = useState([]);
  const [form, setForm] = useState({
    lead_id: leadId || "",
    lead_label: leadLabel || "",
    sales_executive_id: "",
    lead_source_id: "",
    currency: "INR",
    valid_upto: "",
    description: "",
    terms_and_conditions: "",
    discount_type: "percent",
    discount_value: 0,
  });
  const [lines, setLines] = useState([emptyLine()]);

  const canPickExecutive = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  useEffect(() => {
    if (canPickExecutive) {
      api.get("/api/users/list", { params: { department: "Sales" } })
        .then((res) => setSalesUsers(res.data))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/api/crm/quotations/${quotationId}`)
      .then((res) => {
        const q = res.data;
        setForm({
          lead_id: q.lead_id,
          lead_label: `${q.lead_customer_name} (${q.lead_number})`,
          sales_executive_id: q.sales_executive_id || "",
          lead_source_id: q.lead_source_id || "",
          currency: q.currency,
          valid_upto: q.valid_upto || "",
          description: q.description || "",
          terms_and_conditions: q.terms_and_conditions || "",
          discount_type: q.discount_type,
          discount_value: q.discount_value,
        });
        setLines(
          q.items.map((item) => ({
            key: crypto.randomUUID(),
            item_id: item.item_id || "",
            item_name: item.item_name,
            rate: item.rate,
            qty: item.qty,
            tax_percent: item.tax_percent,
            note: item.note || "",
          }))
        );
      })
      .catch(() => toast.error("Could not load quotation"))
      .finally(() => setLoading(false));
  }, [isEdit, quotationId]);

  const updateLine = (key, field, value) => {
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      if (field === "item_id" && value) {
        const item = masterData.items.find((i) => i.id === value);
        return { ...line, item_id: value, item_name: item?.name || "", rate: item?.default_rate ?? line.rate };
      }
      return { ...line, [field]: value };
    }));
  };

  const addLine = () => setLines((current) => [...current, emptyLine()]);
  const removeLine = (key) => setLines((current) => current.filter((line) => line.key !== key));

  const totals = computeTotals(lines, form.discount_type, form.discount_value);

  const submit = async () => {
    if (!form.lead_id) {
      toast.error("A lead is required");
      return;
    }
    if (lines.length === 0) {
      toast.error("Add at least one line item");
      return;
    }
    for (const line of lines) {
      if (!line.item_id && !line.item_name.trim()) {
        toast.error("Every line item needs a name or a selected item");
        return;
      }
      if (!line.rate || Number(line.rate) < 0) {
        toast.error("Every line item needs a valid rate");
        return;
      }
    }

    const payload = {
      sales_executive_id: form.sales_executive_id || null,
      lead_source_id: form.lead_source_id || null,
      currency: form.currency,
      valid_upto: form.valid_upto || null,
      description: form.description || null,
      terms_and_conditions: form.terms_and_conditions || null,
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value) || 0,
      items: lines.map((line) => ({
        item_id: line.item_id || null,
        item_name: line.item_name || null,
        rate: Number(line.rate),
        qty: Number(line.qty) || 1,
        tax_percent: Number(line.tax_percent) || 0,
        note: line.note || null,
      })),
    };

    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/api/crm/quotations/${quotationId}`, payload);
        toast.success("Quotation updated");
      } else {
        await api.post("/api/crm/quotations", { ...payload, lead_id: form.lead_id });
        toast.success("Quotation created");
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not save quotation");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={isEdit ? "Quotation" : "Create Quotation"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={submit}>{isEdit ? "Save Changes" : "Create"}</Button>
        </>
      }
    >
      {loading ? (
        <LoadingState label="Loading…" />
      ) : (
        <div className="space-y-5">
          {form.lead_label ? (
            <p className="text-sm text-slate-500">
              For lead: <span className="font-semibold text-slate-900 dark:text-white">{form.lead_label}</span>
            </p>
          ) : (
            <p className="text-sm text-amber-600">
              Open this from a lead's detail view (Leads tab → a lead → "Create Quotation") so it's linked correctly.
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {canPickExecutive && (
              <select
                value={form.sales_executive_id}
                onChange={(e) => setForm((c) => ({ ...c, sales_executive_id: e.target.value }))}
                className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
              >
                <option value="">Sales executive…</option>
                {salesUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            )}
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
            <input
              type="date"
              value={form.valid_upto}
              onChange={(e) => setForm((c) => ({ ...c, valid_upto: e.target.value }))}
              className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="font-semibold text-slate-900 dark:text-white">Line Items</h4>
              <button type="button" onClick={addLine} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                + Add line
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((line) => (
                <div key={line.key} className="grid grid-cols-12 gap-2 rounded-lg border border-slate-200 p-2 dark:border-white/10">
                  <select
                    value={line.item_id}
                    onChange={(e) => updateLine(line.key, "item_id", e.target.value)}
                    className="focus-ring col-span-3 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                  >
                    <option value="">Custom item…</option>
                    {masterData.items.map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={line.item_name}
                    onChange={(e) => updateLine(line.key, "item_name", e.target.value)}
                    disabled={Boolean(line.item_id)}
                    placeholder="Name"
                    className="focus-ring col-span-3 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white"
                  />
                  <input
                    type="number"
                    value={line.rate}
                    onChange={(e) => updateLine(line.key, "rate", e.target.value)}
                    placeholder="Rate"
                    className="focus-ring col-span-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                  />
                  <input
                    type="number"
                    value={line.qty}
                    onChange={(e) => updateLine(line.key, "qty", e.target.value)}
                    placeholder="Qty"
                    className="focus-ring col-span-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                  />
                  <input
                    type="number"
                    value={line.tax_percent}
                    onChange={(e) => updateLine(line.key, "tax_percent", e.target.value)}
                    placeholder="Tax %"
                    className="focus-ring col-span-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    className="col-span-1 rounded-lg bg-rose-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex gap-2">
              <select
                value={form.discount_type}
                onChange={(e) => setForm((c) => ({ ...c, discount_type: e.target.value }))}
                className="focus-ring rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
              >
                <option value="percent">Discount %</option>
                <option value="flat">Discount flat</option>
              </select>
              <input
                type="number"
                value={form.discount_value}
                onChange={(e) => setForm((c) => ({ ...c, discount_value: e.target.value }))}
                className="focus-ring w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-white/5">
              <div className="flex justify-between"><span className="text-slate-500">Gross</span><span>{totals.gross.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Tax</span><span>{totals.tax.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Discount</span><span>-{totals.discount.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-slate-900 dark:text-white"><span>Payable</span><span>{totals.payable.toFixed(2)}</span></div>
              <p className="mt-1 text-[11px] text-slate-400">Final totals are recalculated by the server on save.</p>
            </div>
          </div>

          <textarea
            value={form.terms_and_conditions}
            onChange={(e) => setForm((c) => ({ ...c, terms_and_conditions: e.target.value }))}
            rows={2}
            placeholder="Terms and conditions"
            className="focus-ring w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </div>
      )}
    </Modal>
  );
}

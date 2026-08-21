import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle2, CreditCard, Users } from "lucide-react";

import api from "../api.js";
import Card, { CardBody, CardHeader } from "./ui/Card.jsx";
import Button from "./ui/Button.jsx";
import Badge from "./ui/Badge.jsx";
import { formatDateTime } from "../utils/dateUtils";

const STATUS_TONE = {
  active: "success",
  overdue: "warning",
  locked: "danger",
  cancelled: "neutral",
};

const STATUS_LABEL = {
  active: "Active",
  overdue: "Payment due",
  locked: "Locked — action needed",
  cancelled: "Cancelled",
};

const INVOICE_TYPE_LABEL = {
  renewal: "Renewal",
  proration: "Added staff (prorated)",
};

let razorpayScriptPromise = null;
function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve(true);
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

export default function SubscriptionPage() {
  const [subscription, setSubscription] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [switchingPlan, setSwitchingPlan] = useState(false);
  const [payingInvoiceId, setPayingInvoiceId] = useState(null);

  const fetchSubscription = async () => {
    try {
      const response = await api.get("/api/billing/subscription");
      setSubscription(response.data);
    } catch (error) {
      toast.error("Could not load subscription details");
    }
  };

  const fetchPayments = async () => {
    try {
      const response = await api.get("/api/billing/payments");
      setPayments(response.data);
    } catch (error) {
      toast.error("Could not load payment history");
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSubscription(), fetchPayments()]).finally(() => setLoading(false));
  }, []);

  const handleSwitchPlan = async (planType) => {
    if (!subscription || subscription.plan_type === planType) return;
    setSwitchingPlan(true);
    try {
      const response = await api.post("/api/billing/subscription/plan", { plan_type: planType });
      setSubscription(response.data);
      toast.success(`Switched to the ${planType} plan — applies from your next renewal`);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not switch plan");
    } finally {
      setSwitchingPlan(false);
    }
  };

  const handlePay = async (invoiceId) => {
    setPayingInvoiceId(invoiceId);
    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        toast.error("Could not load the payment window. Check your connection and try again.");
        return;
      }

      const { data: order } = await api.post("/api/billing/checkout/create-order", null, {
        params: { invoice_id: invoiceId },
      });

      const razorpay = new window.Razorpay({
        key: order.key_id,
        amount: order.amount_paise,
        currency: order.currency,
        name: "WorkFlow",
        description: "Subscription payment",
        order_id: order.order_id,
        prefill: {
          name: order.user_name,
          email: order.user_email,
        },
        notes: { company: order.company_name },
        theme: { color: "#4f46e5" },
        handler: async (result) => {
          try {
            const verifyResponse = await api.post("/api/billing/checkout/verify", {
              invoice_id: order.invoice_id,
              razorpay_order_id: result.razorpay_order_id,
              razorpay_payment_id: result.razorpay_payment_id,
              razorpay_signature: result.razorpay_signature,
            });
            setSubscription(verifyResponse.data);
            toast.success("Payment confirmed — thank you!");
            fetchPayments();
          } catch (error) {
            toast.error("Payment received but confirmation failed — contact support with your payment ID.");
          }
        },
        modal: {
          ondismiss: () => setPayingInvoiceId(null),
        },
      });
      razorpay.on("payment.failed", () => {
        toast.error("Payment failed. Please try again.");
      });
      razorpay.open();
    } catch (error) {
      if (error.response?.status === 503) {
        toast.error("Online payment isn't set up yet — contact your platform administrator.");
      } else {
        toast.error(error.response?.data?.detail || "Could not start payment");
      }
    } finally {
      setPayingInvoiceId(null);
    }
  };

  if (loading || !subscription) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-400">Loading subscription...</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {subscription.status !== "active" && (
        <div
          className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
            subscription.status === "locked"
              ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200"
          }`}
        >
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">
              {subscription.status === "locked"
                ? "Your team's actions are locked."
                : "Payment is due."}
            </p>
            <p className="mt-1">
              {subscription.status === "locked"
                ? "Pay the outstanding invoice below to immediately restore full access for your admins and staff."
                : "Pay before the grace period ends to avoid your team's actions being locked."}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Current Plan
            </h2>
          </div>
          <Badge tone={STATUS_TONE[subscription.status] || "neutral"}>
            {STATUS_LABEL[subscription.status] || subscription.status}
          </Badge>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs font-medium uppercase text-slate-400">Plan</p>
              <p className="mt-1 text-lg font-bold capitalize text-slate-900 dark:text-white">
                {subscription.plan_type}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-slate-400">Team size</p>
              <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-slate-900 dark:text-white">
                <Users className="h-4 w-4 text-slate-400" />
                {subscription.staff_count}
                <span className="text-xs font-normal text-slate-400">
                  / {subscription.included_staff_count} incl.
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-slate-400">This cycle</p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                {subscription.currency} {subscription.current_cycle_amount}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-slate-400">
                {subscription.status === "locked" ? "Renewal date" : "Days left"}
              </p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
                {subscription.status === "locked" ? "—" : `${subscription.days_left}d`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-slate-900/8 pt-4 dark:border-white/10">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Billing cycle:</span>
            {["monthly", "yearly"].map((plan) => (
              <button
                key={plan}
                type="button"
                disabled={switchingPlan}
                onClick={() => handleSwitchPlan(plan)}
                className={`focus-ring rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors ${
                  subscription.plan_type === plan
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15"
                }`}
              >
                {plan}
              </button>
            ))}
            <span className="text-xs text-slate-400">Takes effect from your next renewal.</span>
          </div>
        </CardBody>
      </Card>

      {subscription.pending_invoices.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              Payment Due
            </h2>
          </CardHeader>
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {subscription.pending_invoices.map((invoice) => (
              <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {INVOICE_TYPE_LABEL[invoice.invoice_type] || invoice.invoice_type} —{" "}
                    {invoice.currency} {invoice.amount}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Due {formatDateTime(invoice.due_at)}
                  </p>
                </div>
                <Button
                  size="sm"
                  loading={payingInvoiceId === invoice.id}
                  onClick={() => handlePay(invoice.id)}
                >
                  <CreditCard className="h-3.5 w-3.5" /> Pay Now
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            Payment History
          </h2>
        </CardHeader>
        {payments.length === 0 ? (
          <CardBody>
            <p className="text-sm text-slate-400">No payments yet.</p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Paid At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {payments.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                      {INVOICE_TYPE_LABEL[invoice.invoice_type] || invoice.invoice_type}
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                      {invoice.currency} {invoice.amount}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={invoice.status === "paid" ? "success" : "pending"} icon={invoice.status === "paid"}>
                        {invoice.status === "paid" ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Paid
                          </>
                        ) : (
                          invoice.status
                        )}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                      {invoice.paid_at ? formatDateTime(invoice.paid_at) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Activity,
  AlertTriangle,
  Bell,
  Building2,
  CreditCard,
  KeyRound,
  LayoutGrid,
  MessageSquare,
  Plus,
  Save,
  Search,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";

import api from "../api.js";
import Button from "../components/ui/Button.jsx";
import Card, { CardBody, CardHeader } from "../components/ui/Card.jsx";
import Badge from "../components/ui/Badge.jsx";
import Modal from "../components/ui/Modal.jsx";
import { EmptyState } from "../components/ui/States.jsx";
import DashboardShell from "../components/ui/DashboardShell.jsx";

function formatLastActive(value) {
  if (!value) {
    return "Never";
  }

  const minutes = Math.floor((new Date() - new Date(value)) / 60000);
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes} minutes ago`;
  }
  return `${Math.floor(minutes / 60)} hours ago`;
}

const PLATFORM_SECTION_IDS = ["overview", "companies", "create-company", "subscriptions"];

const SUBSCRIPTION_STATUS_TONE = {
  active: "success",
  overdue: "warning",
  locked: "danger",
  cancelled: "neutral",
};

const SUBSCRIPTION_STATUS_LABEL = {
  active: "Active",
  overdue: "Overdue",
  locked: "Locked",
  cancelled: "Cancelled",
};

function PlatformDashboard() {
  const navigate = useNavigate();
  const { section } = useParams();
  const user = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);
  const activeSection = PLATFORM_SECTION_IDS.includes(section) ? section : "overview";
  const setActiveSection = (id) => navigate(`/platform/${id}`);
  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [companySearch, setCompanySearch] = useState("");
  const [usersModal, setUsersModal] = useState(null);
  const [createdCompanyModal, setCreatedCompanyModal] = useState(null);
  const [createForm, setCreateForm] = useState({
    company_name: "",
    admin_full_name: "",
    admin_email: "",
  });
  const [creating, setCreating] = useState(false);
  const [requestDeletionModal, setRequestDeletionModal] = useState(null);
  const [executeDeletionModal, setExecuteDeletionModal] = useState(null);
  const [toggleModal, setToggleModal] = useState(null);
  const [confirmName, setConfirmName] = useState("");
  const [resetPasswordModal, setResetPasswordModal] = useState(null);
  const [resetPasswordResult, setResetPasswordResult] = useState(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [platformSettings, setPlatformSettings] = useState(null);
  const [settingsForm, setSettingsForm] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [companySubscriptions, setCompanySubscriptions] = useState([]);

  const fetchStats = async () => {
    try {
      const response = await api.get("/api/platform/stats");
      setStats(response.data);
    } catch (error) {
      toast.error("Could not load platform stats");
    }
  };

  const fetchCompanies = async () => {
    try {
      const response = await api.get("/api/platform/companies");
      setCompanies(response.data);
    } catch (error) {
      toast.error("Could not load companies");
    }
  };

  useEffect(() => {
    fetchStats();
    const intervalId = setInterval(fetchStats, 60000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (activeSection === "companies") {
      fetchCompanies();
    }
  }, [activeSection]);

  const fetchPlatformSettings = async () => {
    try {
      const response = await api.get("/api/billing/platform-settings");
      setPlatformSettings(response.data);
      setSettingsForm(response.data);
    } catch (error) {
      toast.error("Could not load subscription pricing");
    }
  };

  const fetchCompanySubscriptions = async () => {
    try {
      const response = await api.get("/api/billing/platform/companies");
      setCompanySubscriptions(response.data);
    } catch (error) {
      toast.error("Could not load company subscriptions");
    }
  };

  useEffect(() => {
    if (activeSection === "subscriptions") {
      fetchPlatformSettings();
      fetchCompanySubscriptions();
    }
  }, [activeSection]);

  const handleSaveSettings = async (event) => {
    event.preventDefault();
    setSavingSettings(true);
    try {
      const response = await api.patch("/api/billing/platform-settings", {
        monthly_base_price: Number(settingsForm.monthly_base_price),
        included_staff_count: Number(settingsForm.included_staff_count),
        extra_staff_price: Number(settingsForm.extra_staff_price),
        grace_period_hours: Number(settingsForm.grace_period_hours),
      });
      setPlatformSettings(response.data);
      setSettingsForm(response.data);
      toast.success("Pricing updated — applies immediately across every panel");
      fetchCompanySubscriptions();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not update pricing");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const handleViewUsers = async (company) => {
    try {
      const response = await api.get(`/api/platform/companies/${company.id}/users`);
      setUsersModal({ company, users: response.data });
    } catch (error) {
      toast.error("Could not load users");
    }
  };

  const handleToggleCompany = async () => {
    if (!toggleModal) return;
    const { company, isActive } = toggleModal;
    try {
      const response = await api.patch(`/api/platform/companies/${company.id}`, {
        is_active: isActive,
      });
      setCompanies((current) =>
        current.map((item) =>
          item.id === company.id ? { ...item, ...response.data } : item
        )
      );
      toast.success(isActive ? "Company activated" : "Company suspended");
    } catch (error) {
      toast.error("Could not update company");
    } finally {
      setToggleModal(null);
    }
  };

  const handleResetSuperAdminPassword = async () => {
    if (!resetPasswordModal) return;
    setResettingPassword(true);
    try {
      const response = await api.post(
        `/api/platform/companies/${resetPasswordModal.id}/reset-super-admin-password`
      );
      setResetPasswordResult(response.data);
      setResetPasswordModal(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not reset password");
    } finally {
      setResettingPassword(false);
    }
  };

  const copyResetCredentials = () => {
    if (!resetPasswordResult) return;
    navigator.clipboard.writeText(
      `Login Email: ${resetPasswordResult.email}\nPassword: ${resetPasswordResult.admin_password}`
    );
    toast.success("Copied");
  };

  const handleCancelDeletion = async (company) => {
    try {
      await api.post(`/api/platform/companies/${company.id}/cancel-deletion`);
      toast.success("Deletion cancelled. Company restored.");
      fetchCompanies();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not cancel deletion");
    }
  };

  const handleOpenRequestDeletionModal = (company) => {
    setRequestDeletionModal(company);
    setConfirmName("");
  };

  const handleRequestDeletion = async (company) => {
    if (confirmName !== company.name) {
      toast.error("Company name does not match.");
      return;
    }

    try {
      await api.post(`/api/platform/companies/${company.id}/request-deletion`, {
        confirmation_name: confirmName,
      });
      toast.success("Company scheduled for deletion in 30 days");
      setRequestDeletionModal(null);
      setConfirmName("");
      fetchCompanies();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not schedule deletion");
    }
  };

  const handleOpenExecuteDeletionModal = (company) => {
    setExecuteDeletionModal(company);
    setConfirmName("");
  };

  const handleExecuteDeletion = async (company) => {
    if (confirmName !== company.name) {
      toast.error("Company name does not match.");
      return;
    }

    try {
      await api.post(`/api/platform/companies/${company.id}/execute-deletion`);
      toast.success("Company permanently deleted");
      setExecuteDeletionModal(null);
      setConfirmName("");
      fetchCompanies();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Could not execute deletion");
    }
  };

  const handleCreateCompany = async (event) => {
    event.preventDefault();
    setCreating(true);

    try {
      const response = await api.post("/api/platform/companies", createForm);
      toast.success("Company created successfully");
      setCreatedCompanyModal({
        ...createForm,
        admin_password: response.data.admin_password,
      });
      setCreateForm({
        company_name: "",
        admin_full_name: "",
        admin_email: "",
      });
      setActiveSection("companies");
      fetchCompanies();
    } catch (error) {
      toast.error("Could not create company");
    } finally {
      setCreating(false);
    }
  };

  const copyCreatedCredentials = () => {
    if (!createdCompanyModal) {
      return;
    }

    navigator.clipboard.writeText(
      `Company: ${createdCompanyModal.company_name}\nLogin Email: ${createdCompanyModal.admin_email}\nPassword: ${createdCompanyModal.admin_password}`
    );
    toast.success("Copied");
  };

  const filteredCompanies = companies.filter((company) =>
    company.name.toLowerCase().includes(companySearch.toLowerCase())
  );

  const navItems = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "companies", label: "Companies", icon: Building2 },
    { id: "create-company", label: "Create Company", icon: Plus },
    { id: "subscriptions", label: "Subscriptions", icon: CreditCard },
  ];

  const sectionTitles = {
    overview: "Overview",
    companies: "Companies",
    "create-company": "Onboard New Company",
    subscriptions: "Subscriptions",
  };

  const statTiles = [
    { label: "Total Companies", value: stats?.total_companies ?? 0, icon: Building2, tone: "brand" },
    { label: "Active Companies", value: stats?.active_companies ?? 0, icon: UserCheck, tone: "emerald" },
    { label: "Total Users", value: stats?.total_users ?? 0, icon: Users, tone: "sky" },
    { label: "Active Users", value: stats?.active_users ?? 0, icon: Activity, tone: "teal" },
    { label: "Messages Today", value: stats?.total_messages_today ?? 0, icon: MessageSquare, tone: "amber" },
    { label: "Alerts Today", value: stats?.total_alerts_today ?? 0, icon: Bell, tone: "rose" },
  ];

  const STAT_TILE_CLASS = {
    brand: "border-brand-200/60 bg-brand-50 text-brand-700 dark:border-brand-400/20 dark:bg-brand-500/10 dark:text-brand-300",
    emerald: "border-emerald-200/60 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300",
    sky: "border-sky-200/60 bg-sky-50 text-sky-700 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-300",
    teal: "border-teal-200/60 bg-teal-50 text-teal-700 dark:border-teal-400/20 dark:bg-teal-500/10 dark:text-teal-300",
    amber: "border-amber-200/60 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300",
    rose: "border-rose-200/60 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300",
  };

  return (
    <DashboardShell
      brand="WorkFlow"
      navItems={navItems}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      sectionLabel={sectionTitles[activeSection]}
      userName={user?.full_name || "Platform Admin"}
      userSubtitle="Platform Admin"
      onLogout={handleLogout}
    >
      <div className="space-y-6">
        {activeSection === "overview" && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {statTiles.map(({ label, value, icon: Icon, tone }) => (
              <div key={label} className={`rounded-xl border p-5 ${STAT_TILE_CLASS[tone]}`}>
                <Icon className="h-5 w-5 opacity-70" />
                <div className="mt-3 text-3xl font-bold tracking-tight">{value}</div>
                <div className="mt-1 text-sm font-medium opacity-80">{label}</div>
              </div>
            ))}
          </div>
        )}

        {activeSection === "companies" && (
          <Card>
            <CardHeader className="flex-wrap gap-3">
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Companies</h2>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={companySearch}
                  onChange={(event) => setCompanySearch(event.target.value)}
                  placeholder="Search companies..."
                  className="focus-ring w-56 rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              </div>
            </CardHeader>
            {filteredCompanies.length === 0 ? (
              <CardBody>
                <EmptyState title="No companies found" />
              </CardBody>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-5 py-3">Company Name</th>
                      <th className="px-5 py-3">Staff</th>
                      <th className="px-5 py-3">Admins</th>
                      <th className="px-5 py-3">Last Active</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {filteredCompanies.map((company) => (
                      <tr key={company.id}>
                        <td className="px-5 py-3 font-semibold text-slate-900 dark:text-white">
                          {company.name}
                        </td>
                        <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{company.staff_count}</td>
                        <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{company.admin_count}</td>
                        <td className="px-5 py-3 text-slate-600 dark:text-slate-300">{formatLastActive(company.last_active)}</td>
                        <td className="px-5 py-3">
                          {company.is_deletion_pending ? (
                            <div className="flex flex-col items-start gap-1">
                              <Badge tone="danger">Pending Deletion</Badge>
                              <span className="text-[11px] font-medium text-rose-500 dark:text-rose-400">
                                Deletes on: {new Date(company.deletion_scheduled_at).toLocaleDateString()}
                              </span>
                            </div>
                          ) : (
                            <Badge tone={company.is_active ? "success" : "danger"}>
                              {company.is_active ? "Active" : "Suspended"}
                            </Badge>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="secondary" onClick={() => handleViewUsers(company)}>
                              View Users
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setResetPasswordModal(company)}
                            >
                              <KeyRound className="h-3.5 w-3.5" /> Reset Password
                            </Button>
                            {company.is_deletion_pending ? (
                              <>
                                <Button size="sm" onClick={() => handleCancelDeletion(company)}>
                                  Cancel Deletion
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => handleOpenExecuteDeletionModal(company)}
                                >
                                  Delete Now
                                </Button>
                              </>
                            ) : (
                              <>
                                {company.is_active ? (
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={() => setToggleModal({ company, isActive: false })}
                                  >
                                    Suspend
                                  </Button>
                                ) : (
                                  <Button size="sm" onClick={() => setToggleModal({ company, isActive: true })}>
                                    Activate
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => handleOpenRequestDeletionModal(company)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" /> Delete
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {activeSection === "create-company" && (
          <Card className="max-w-2xl">
            <CardBody>
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Onboard New Company</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                A secure temporary password is generated automatically — you'll see it once after creation to share with the company.
              </p>
              <form onSubmit={handleCreateCompany} className="mt-6 space-y-4">
                {[
                  ["company_name", "Company Name", "text"],
                  ["admin_full_name", "Super Admin Full Name", "text"],
                  ["admin_email", "Super Admin Email", "email"],
                ].map(([field, placeholder, type]) => (
                  <div key={field}>
                    <label htmlFor={field} className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
                      {placeholder}
                    </label>
                    <input
                      id={field}
                      type={type}
                      required
                      value={createForm[field]}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          [field]: event.target.value,
                        }))
                      }
                      className="focus-ring w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                    />
                  </div>
                ))}
                <Button type="submit" loading={creating} className="w-full" size="lg">
                  {creating ? "Creating..." : "Create Company"}
                </Button>
              </form>
            </CardBody>
          </Card>
        )}

        {activeSection === "subscriptions" && (
          <div className="space-y-6">
            <Card className="max-w-2xl">
              <CardHeader>
                <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                  Global Pricing
                </h2>
              </CardHeader>
              <CardBody>
                <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
                  Changes apply immediately across the platform admin, super admin, and every
                  company's billing — no restart or redeploy needed.
                </p>
                {settingsForm && (
                  <form onSubmit={handleSaveSettings} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {[
                        ["monthly_base_price", "Monthly base price (₹, includes seats below)"],
                        ["included_staff_count", "Seats included in base price"],
                        ["extra_staff_price", "Price per extra seat / month (₹)"],
                        ["grace_period_hours", "Grace period after due date (hours)"],
                      ].map(([field, label]) => (
                        <div key={field}>
                          <label className="mb-1.5 block text-sm font-medium text-slate-600 dark:text-slate-300">
                            {label}
                          </label>
                          <input
                            type="number"
                            min="0"
                            step={field.includes("price") ? "0.01" : "1"}
                            required
                            value={settingsForm[field]}
                            onChange={(event) =>
                              setSettingsForm((current) => ({ ...current, [field]: event.target.value }))
                            }
                            className="focus-ring w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Yearly plan = 12 × the computed monthly amount. A company on the yearly
                      plan pays this rate for the whole year even if seat count changes later.
                    </p>
                    <Button type="submit" loading={savingSettings}>
                      <Save className="h-4 w-4" /> Save Pricing
                    </Button>
                  </form>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                  Company Subscriptions
                </h2>
              </CardHeader>
              {companySubscriptions.length === 0 ? (
                <CardBody>
                  <EmptyState title="No companies yet" />
                </CardBody>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-400">
                      <tr>
                        <th className="px-5 py-3">Company</th>
                        <th className="px-5 py-3">Plan</th>
                        <th className="px-5 py-3">Seats</th>
                        <th className="px-5 py-3">Amount / cycle</th>
                        <th className="px-5 py-3">Days Left</th>
                        <th className="px-5 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {companySubscriptions.map((sub) => (
                        <tr key={sub.company_id}>
                          <td className="px-5 py-3 font-semibold text-slate-900 dark:text-white">
                            {sub.company_name}
                          </td>
                          <td className="px-5 py-3 capitalize text-slate-600 dark:text-slate-300">
                            {sub.plan_type}
                          </td>
                          <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                            {sub.staff_count}{" "}
                            <span className="text-slate-400">/ {sub.included_staff_count} incl.</span>
                          </td>
                          <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                            {sub.currency} {sub.current_cycle_amount}
                          </td>
                          <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                            {sub.status === "locked" ? "—" : `${sub.days_left}d`}
                          </td>
                          <td className="px-5 py-3">
                            <Badge tone={SUBSCRIPTION_STATUS_TONE[sub.status] || "neutral"}>
                              {SUBSCRIPTION_STATUS_LABEL[sub.status] || sub.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      <Modal open={!!usersModal} onClose={() => setUsersModal(null)} title={usersModal ? `${usersModal.company.name} Users` : ""} size="lg">
        {usersModal && (
          <div className="space-y-5">
            {Object.entries(usersModal.users).map(([role, users]) => (
              <div key={role}>
                <h4 className="font-semibold capitalize text-slate-900 dark:text-white">{role}</h4>
                <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-white/5 dark:border-white/10">
                  {users.map((item) => (
                    <div key={item.id} className="p-3 text-sm text-slate-600 dark:text-slate-300">
                      {item.full_name} - {item.email}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={!!createdCompanyModal}
        onClose={() => setCreatedCompanyModal(null)}
        title="Company created"
        footer={
          <>
            <Button variant="secondary" onClick={copyCreatedCredentials}>
              Copy All
            </Button>
            <Button onClick={() => setCreatedCompanyModal(null)}>Close</Button>
          </>
        }
      >
        {createdCompanyModal && (
          <>
            <p className="text-sm text-slate-500 dark:text-slate-400">Share these credentials with the client:</p>
            <div className="mt-4 space-y-1 rounded-lg bg-slate-100 p-4 text-sm text-slate-800 dark:bg-white/5 dark:text-slate-200">
              <div>Company: {createdCompanyModal.company_name}</div>
              <div>Login Email: {createdCompanyModal.admin_email}</div>
              <div>Password: {createdCompanyModal.admin_password}</div>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={!!toggleModal}
        onClose={() => setToggleModal(null)}
        title={toggleModal?.isActive ? "Activate company?" : "Suspend company?"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setToggleModal(null)}>
              Cancel
            </Button>
            <Button variant={toggleModal?.isActive ? "primary" : "danger"} onClick={handleToggleCompany}>
              {toggleModal?.isActive ? "Activate" : "Suspend"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {toggleModal?.isActive
            ? `${toggleModal?.company.name} and its users will regain access immediately.`
            : `${toggleModal?.company.name} and its users will lose access immediately.`}
        </p>
      </Modal>

      <Modal
        open={!!resetPasswordModal}
        onClose={() => setResetPasswordModal(null)}
        title="Reset super admin password?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetPasswordModal(null)}>
              Cancel
            </Button>
            <Button loading={resettingPassword} onClick={handleResetSuperAdminPassword}>
              Reset Password
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This generates a new password for {resetPasswordModal?.name}'s super admin account and
          signs them out everywhere. You'll see the new password once — share it with the client
          right after.
        </p>
      </Modal>

      <Modal
        open={!!resetPasswordResult}
        onClose={() => setResetPasswordResult(null)}
        title="Password reset"
        footer={
          <>
            <Button variant="secondary" onClick={copyResetCredentials}>
              Copy All
            </Button>
            <Button onClick={() => setResetPasswordResult(null)}>Close</Button>
          </>
        }
      >
        {resetPasswordResult && (
          <>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Share these credentials with the client:
            </p>
            <div className="mt-4 space-y-1 rounded-lg bg-slate-100 p-4 text-sm text-slate-800 dark:bg-white/5 dark:text-slate-200">
              <div>Name: {resetPasswordResult.full_name}</div>
              <div>Login Email: {resetPasswordResult.email}</div>
              <div>Password: {resetPasswordResult.admin_password}</div>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={!!requestDeletionModal}
        onClose={() => setRequestDeletionModal(null)}
        title="Delete Company — This cannot be undone"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRequestDeletionModal(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmName !== requestDeletionModal?.name}
              onClick={() => handleRequestDeletion(requestDeletionModal)}
            >
              Schedule Deletion
            </Button>
          </>
        }
      >
        {requestDeletionModal && (
          <>
            <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              This will schedule the company for permanent deletion in 30 days. All staff accounts, attendance records, messages, and screenshots will be permanently deleted. The company will be immediately deactivated.
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                Type the company name to confirm:
              </label>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={requestDeletionModal.name}
                className="focus-ring mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={!!executeDeletionModal}
        onClose={() => setExecuteDeletionModal(null)}
        title="Permanently Delete Now"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExecuteDeletionModal(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmName !== executeDeletionModal?.name}
              onClick={() => handleExecuteDeletion(executeDeletionModal)}
            >
              Permanently Delete
            </Button>
          </>
        }
      >
        {executeDeletionModal && (
          <>
            <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              This will immediately and permanently delete all company data. This cannot be recovered.
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                Type the company name again to confirm:
              </label>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={executeDeletionModal.name}
                className="focus-ring mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </div>
          </>
        )}
      </Modal>
    </DashboardShell>
  );
}

export default PlatformDashboard;

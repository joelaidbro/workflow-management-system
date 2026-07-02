import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api.js";

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

function PlatformDashboard() {
  const navigate = useNavigate();
  const user = useMemo(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  }, []);
  const [activeSection, setActiveSection] = useState("overview");
  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [companySearch, setCompanySearch] = useState("");
  const [usersModal, setUsersModal] = useState(null);
  const [createdCompanyModal, setCreatedCompanyModal] = useState(null);
  const [createForm, setCreateForm] = useState({
    company_name: "",
    admin_full_name: "",
    admin_email: "",
    admin_password: "",
  });
  const [creating, setCreating] = useState(false);
  const [requestDeletionModal, setRequestDeletionModal] = useState(null);
  const [executeDeletionModal, setExecuteDeletionModal] = useState(null);
  const [confirmName, setConfirmName] = useState("");

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

  const handleToggleCompany = async (company, isActive) => {
    const confirmed = window.confirm(
      isActive ? "Activate this company?" : "Suspend this company?"
    );
    if (!confirmed) {
      return;
    }

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
    }
  };

  const handleCancelDeletion = async (company) => {
    const confirmed = window.confirm(`Cancel deletion and restore ${company.name}?`);
    if (!confirmed) return;

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
      await api.post("/api/platform/companies", createForm);
      toast.success("Company created successfully");
      setCreatedCompanyModal({ ...createForm });
      setCreateForm({
        company_name: "",
        admin_full_name: "",
        admin_email: "",
        admin_password: "",
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
    { id: "overview", label: "Overview" },
    { id: "companies", label: "Companies" },
    { id: "create-company", label: "Create Company" },
  ];

  return (
    <div className="min-h-screen bg-gray-100">
      <aside className="fixed left-0 top-0 flex h-screen w-64 flex-col bg-gray-900 text-white">
        <div className="border-b border-gray-800 px-6 py-6">
          <h1 className="text-2xl font-bold">WorkFlow Platform</h1>
        </div>

        <nav className="flex-1 px-4 py-6">
          <div className="space-y-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`w-full rounded-lg px-4 py-3 text-left text-sm font-medium transition ${
                  activeSection === item.id
                    ? "bg-gray-700 text-white"
                    : "text-gray-200 hover:bg-gray-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="border-t border-gray-800 p-4">
          <p className="mb-4 truncate text-sm font-semibold">
            {user?.full_name || "Platform Admin"}
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold hover:bg-gray-700"
          >
            Logout
          </button>
        </div>
      </aside>

      <main className="ml-64 min-h-screen p-8">
        {activeSection === "overview" && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
            <div className="mt-6 grid grid-cols-3 gap-4">
              {[
                ["Total Companies", stats?.total_companies ?? 0, "bg-blue-50"],
                ["Active Companies", stats?.active_companies ?? 0, "bg-green-50"],
                ["Total Users", stats?.total_users ?? 0, "bg-purple-50"],
                ["Active Users", stats?.active_users ?? 0, "bg-emerald-50"],
                ["Messages Today", stats?.total_messages_today ?? 0, "bg-yellow-50"],
                ["Alerts Today", stats?.total_alerts_today ?? 0, "bg-red-50"],
              ].map(([label, value, className]) => (
                <div key={label} className={`rounded-xl p-5 shadow-sm ${className}`}>
                  <div className="text-3xl font-bold text-gray-900">{value}</div>
                  <div className="mt-2 text-sm font-medium text-gray-600">{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSection === "companies" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Companies</h2>
              <input
                type="text"
                value={companySearch}
                onChange={(event) => setCompanySearch(event.target.value)}
                placeholder="Search companies..."
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-200"
              />
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Company Name</th>
                    <th className="px-4 py-3">Staff Count</th>
                    <th className="px-4 py-3">Admin Count</th>
                    <th className="px-4 py-3">Last Active</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredCompanies.map((company) => (
                    <tr key={company.id}>
                      <td className="px-4 py-3 font-semibold text-gray-900">
                        {company.name}
                      </td>
                      <td className="px-4 py-3">{company.staff_count}</td>
                      <td className="px-4 py-3">{company.admin_count}</td>
                      <td className="px-4 py-3">{formatLastActive(company.last_active)}</td>
                      <td className="px-4 py-3">
                        {company.is_deletion_pending ? (
                          <div className="flex flex-col items-start">
                            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                              Pending Deletion
                            </span>
                            <span className="mt-1 text-[11px] font-medium text-red-600">
                              Deletes on: {new Date(company.deletion_scheduled_at).toLocaleDateString()}
                            </span>
                          </div>
                        ) : (
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              company.is_active
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {company.is_active ? "Active" : "Suspended"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleViewUsers(company)}
                            className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200"
                          >
                            View Users
                          </button>
                          {company.is_deletion_pending ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleCancelDeletion(company)}
                                className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700"
                              >
                                Cancel Deletion
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenExecuteDeletionModal(company)}
                                className="rounded-lg bg-red-850 px-3 py-2 text-xs font-semibold text-white hover:bg-red-950"
                              >
                                Delete Now
                              </button>
                            </>
                          ) : (
                            <>
                              {company.is_active ? (
                                <button
                                  type="button"
                                  onClick={() => handleToggleCompany(company, false)}
                                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
                                >
                                  Suspend
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleToggleCompany(company, true)}
                                  className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700"
                                >
                                  Activate
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenRequestDeletionModal(company)}
                                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 flex items-center gap-1"
                              >
                                <span>🗑️</span>
                                <span>Delete</span>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeSection === "create-company" && (
          <div className="max-w-2xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold text-gray-900">Onboard New Company</h2>
            <form onSubmit={handleCreateCompany} className="mt-6 space-y-4">
              {[
                ["company_name", "Company Name", "text"],
                ["admin_full_name", "Super Admin Full Name", "text"],
                ["admin_email", "Super Admin Email", "email"],
                ["admin_password", "Super Admin Password", "password"],
              ].map(([field, placeholder, type]) => (
                <input
                  key={field}
                  type={type}
                  required
                  value={createForm[field]}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                  placeholder={placeholder}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-200"
                />
              ))}
              <button
                type="submit"
                disabled={creating}
                className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {creating ? "Creating..." : "Create Company"}
              </button>
            </form>
          </div>
        )}
      </main>

      {usersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900">
              {usersModal.company.name} Users
            </h3>
            <div className="mt-5 space-y-5">
              {Object.entries(usersModal.users).map(([role, users]) => (
                <div key={role}>
                  <h4 className="font-semibold text-gray-900">{role}</h4>
                  <div className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {users.map((item) => (
                      <div key={item.id} className="p-3 text-sm text-gray-700">
                        {item.full_name} - {item.email}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setUsersModal(null)}
              className="mt-6 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {createdCompanyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900">Company created</h3>
            <p className="mt-3 text-sm text-gray-600">
              Share these credentials with the client:
            </p>
            <div className="mt-5 rounded-lg bg-gray-100 p-4 text-sm text-gray-800">
              <div>Company: {createdCompanyModal.company_name}</div>
              <div>Login Email: {createdCompanyModal.admin_email}</div>
              <div>Password: {createdCompanyModal.admin_password}</div>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={copyCreatedCredentials}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
              >
                Copy All
              </button>
              <button
                type="button"
                onClick={() => setCreatedCompanyModal(null)}
                className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {requestDeletionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900">
              Delete Company — This cannot be undone
            </h3>
            <div className="mt-4 rounded-lg bg-red-50 p-4 border border-red-200 text-sm text-red-800">
              This will schedule the company for permanent deletion in 30 days. All staff accounts, attendance records, messages, and screenshots will be permanently deleted. The company will be immediately deactivated.
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700">
                Type the company name to confirm:
              </label>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={requestDeletionModal.name}
                className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:border-gray-700"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2 text-sm">
              <button
                type="button"
                onClick={() => setRequestDeletionModal(null)}
                className="rounded-lg bg-gray-100 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRequestDeletion(requestDeletionModal)}
                disabled={confirmName !== requestDeletionModal.name}
                className="rounded-lg bg-red-800 px-4 py-2 font-semibold text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Schedule Deletion
              </button>
            </div>
          </div>
        </div>
      )}

      {executeDeletionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900">
              Permanently Delete Now
            </h3>
            <div className="mt-4 rounded-lg bg-red-50 p-4 border border-red-200 text-sm text-red-800">
              This will immediately and permanently delete all company data. This cannot be recovered.
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700">
                Type the company name again to confirm:
              </label>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={executeDeletionModal.name}
                className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:border-gray-700"
              />
            </div>
            <div className="mt-6 flex justify-end gap-2 text-sm">
              <button
                type="button"
                onClick={() => setExecuteDeletionModal(null)}
                className="rounded-lg bg-gray-100 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleExecuteDeletion(executeDeletionModal)}
                disabled={confirmName !== executeDeletionModal.name}
                className="rounded-lg bg-red-800 px-4 py-2 font-semibold text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Permanently Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PlatformDashboard;

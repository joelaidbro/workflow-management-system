import { Navigate, Route, Routes } from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute.jsx";
import SuperAdminDashboard from "./pages/AdminDashboard.jsx";
import NormalAdminDashboard from "./pages/NormalAdminDashboard.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import PlatformDashboard from "./pages/PlatformDashboard.jsx";
import LegalPolicy from "./pages/LegalPolicy.jsx";
import StaffDashboard from "./pages/StaffDashboard.jsx";

function AdminRouter() {
  const storedUser = localStorage.getItem("user");
  const role = storedUser ? JSON.parse(storedUser)?.role : null;
  if (role === "super_admin") return <SuperAdminDashboard />;
  return <NormalAdminDashboard />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/privacy-policy" element={<LegalPolicy />} />
      <Route
        path="/staff"
        element={
          <ProtectedRoute allowedRoles={["staff"]}>
            <StaffDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
            <AdminRouter />
          </ProtectedRoute>
        }
      />
      <Route
        path="/platform"
        element={
          <ProtectedRoute allowedRoles={["platform_admin"]}>
            <PlatformDashboard />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default App;

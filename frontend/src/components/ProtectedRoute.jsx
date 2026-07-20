import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import api from "../api.js";

function ProtectedRoute({ children, allowedRoles }) {
  const [authState, setAuthState] = useState("checking");
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      navigate("/login");
      return;
    }

    let cancelled = false;

    const checkAuth = async () => {
      try {
        const response = await api.get("/api/auth/me");
        const user = response.data;
        localStorage.setItem("user", JSON.stringify(user));
        if (allowedRoles && !allowedRoles.includes(user.role)) {
          if (!cancelled) navigate("/login");
          return;
        }
        if (!cancelled) setAuthState("authenticated");
      } catch (error) {
        localStorage.removeItem("access_token");
        localStorage.removeItem("user");
        if (!cancelled) navigate("/login");
      }
    };

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [allowedRoles, navigate]);

  if (authState === "checking") {
    return (
      <div className="relative flex min-h-screen items-center justify-center">
        <div className="app-mesh-bg" aria-hidden="true" />
        <div
          role="status"
          aria-live="polite"
          className="text-sm font-medium text-slate-400"
        >
          Loading…
        </div>
      </div>
    );
  }

  return children;
}

export default ProtectedRoute;

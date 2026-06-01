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

    const storedUser = localStorage.getItem("user");
    if (storedUser) {
      const user = JSON.parse(storedUser);
      if (allowedRoles && !allowedRoles.includes(user.role)) {
        navigate("/login");
        return;
      }
      setAuthState("authenticated");
    }

    const checkAuth = async () => {
      try {
        const response = await api.get("/api/auth/me");
        const user = response.data;
        localStorage.setItem("user", JSON.stringify(user));
        if (allowedRoles && !allowedRoles.includes(user.role)) {
          navigate("/login");
          return;
        }
        setAuthState("authenticated");
      } catch (error) {
        localStorage.removeItem("access_token");
        localStorage.removeItem("user");
        navigate("/login");
      }
    };

    const timeoutId = setTimeout(checkAuth, 250);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [allowedRoles, navigate]);

  if (authState === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return children;
}

export default ProtectedRoute;

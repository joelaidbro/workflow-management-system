import { useState } from "react";
import { useNavigate } from "react-router-dom";

import api from "../api.js";

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await api.post("/api/auth/login", {
        email,
        password,
      });

      localStorage.setItem("access_token", response.data.access_token);
      localStorage.setItem(
        "user",
        JSON.stringify({
          user_id: response.data.user_id,
          full_name: response.data.full_name,
          role: response.data.role,
          company_id: response.data.company_id,
        })
      );

      const { role } = response.data;
      if (role === "platform_admin") {
        navigate("/platform");
      } else if (role === "staff") {
        navigate("/staff");
      } else {
        navigate("/admin");
      }
    } catch (err) {
      setError("Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="flex w-full max-w-md flex-col">
        <div className="rounded-2xl bg-white p-8 shadow-md">
          <div className="mb-8 text-center">
            <h1 className="text-4xl font-bold text-blue-950">WorkFlow</h1>
            <p className="mt-2 text-sm text-gray-500">Staff Monitoring System</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                required
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-20 text-gray-900 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-200"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-blue-700"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>

            {error && <p className="text-center text-sm text-red-600">{error}</p>}
          </form>
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">
          <a href="/privacy-policy" className="hover:underline">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}

export default LoginPage;

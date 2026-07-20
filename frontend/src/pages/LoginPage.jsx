import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";

import api from "../api.js";
import Button from "../components/ui/Button.jsx";
import ThemeToggle from "../components/ui/ThemeToggle.jsx";

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
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="app-mesh-bg" aria-hidden="true" />

      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="flex w-full max-w-md flex-col">
        <div className="rounded-2xl border border-slate-900/10 bg-white/80 p-8 shadow-xl backdrop-blur-xl dark:border-white/15 dark:bg-slate-900/70">
          <div className="mb-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-xl font-bold text-white">
              W
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              WorkFlow
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Staff Monitoring System
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="focus-ring w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                  required
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="focus-ring w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-11 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="focus-ring absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" loading={loading} className="w-full" size="lg">
              {loading ? "Signing in..." : "Sign In"}
            </Button>

            {error && (
              <p className="text-center text-sm font-medium text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">
          <a href="/privacy-policy" className="hover:underline">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}

export default LoginPage;

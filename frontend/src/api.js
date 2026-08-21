import axios from "axios";
import toast from "react-hot-toast";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let lastLockToastAt = 0;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url?.includes("/api/auth/login");
    if (error.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem("access_token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }

    if (error.response?.status === 402 && error.response?.data?.code === "SUBSCRIPTION_LOCKED") {
      const now = Date.now();
      if (now - lastLockToastAt > 4000) {
        lastLockToastAt = now;
        const storedUser = localStorage.getItem("user");
        const role = storedUser ? JSON.parse(storedUser)?.role : null;
        toast.error(
          role === "super_admin"
            ? "Payment is overdue. Pay now from Subscriptions to restore full access."
            : "This action is unavailable — please contact your company's IT department.",
          { duration: 6000 }
        );
      }
    }

    return Promise.reject(error);
  }
);

export default api;

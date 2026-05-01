import axios from "axios";

const api = axios.create({
  baseURL: "/api",
});

const CLIENT_TOKEN_KEY = "ocr_client_token";
const ADMIN_TOKEN_KEY = "ocr_admin_token";

export function getClientToken() {
  return localStorage.getItem(CLIENT_TOKEN_KEY);
}
export function setClientToken(t: string | null) {
  if (t) localStorage.setItem(CLIENT_TOKEN_KEY, t);
  else localStorage.removeItem(CLIENT_TOKEN_KEY);
}
export function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}
export function setAdminToken(t: string | null) {
  if (t) localStorage.setItem(ADMIN_TOKEN_KEY, t);
  else localStorage.removeItem(ADMIN_TOKEN_KEY);
}

// Attach the right token based on path: /admin/* uses admin token
api.interceptors.request.use((config) => {
  const url = config.url || "";
  const isAdmin = url.startsWith("/admin") || url.startsWith("/auth/admin");
  const token = isAdmin ? getAdminToken() : getClientToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401: clear the stale token and redirect to the appropriate login page
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      const url: string = err?.config?.url || "";
      const isAdmin = url.startsWith("/admin") || url.startsWith("/auth/admin");
      if (isAdmin) {
        setAdminToken(null);
        if (!window.location.pathname.startsWith("/admin/login")) {
          window.location.href = "/admin/login";
        }
      } else {
        setClientToken(null);
        if (!window.location.pathname.startsWith("/portal/login")) {
          window.location.href = "/portal/login";
        }
      }
    }
    return Promise.reject(err);
  },
);

export default api;

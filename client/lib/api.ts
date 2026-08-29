import axios from "axios";
import { isAdminApiPath } from "./apiAuthPath";

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

// Attach the right token based on path: /admin/*, /mcp/*, /voice/* use admin token
api.interceptors.request.use((config) => {
  const url = config.url || "";
  const isAdmin = isAdminApiPath(url);
  const token = isAdmin ? getAdminToken() : getClientToken();
  if (token) {
    config.headers = (config.headers ?? {}) as any;
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401: clear the stale token and redirect to the appropriate login page.
// Only logout when the request actually sent a Bearer token — bare 401s
// (race / missing header) would otherwise wipe a valid session and make the
// next Conversations poll fail in ~1ms with Unauthorized.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      const url: string = err?.config?.url || "";
      const sentAuth = Boolean(
        err?.config?.headers?.Authorization ||
          (err?.config?.headers as { authorization?: string } | undefined)
            ?.authorization,
      );
      if (sentAuth) {
        const isAdmin = isAdminApiPath(url);
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
    }
    return Promise.reject(err);
  },
);

export default api;

/** Normalize API/axios errors to a user-visible string (never render raw objects). */
export function formatApiError(err: unknown, fallback = "Something went wrong"): string {
  if (err == null) return fallback;
  if (typeof err === "string") return err || fallback;

  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.error === "string") return o.error;
    if (o.error && typeof o.error === "object") {
      const nested = o.error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message;
    }
    if (typeof o.message === "string" && o.message.trim()) return o.message;
  }

  return fallback;
}

/** Extract a display message from an axios catch block. */
export function formatAxiosError(e: unknown, fallback: string): string {
  const ax = e as { response?: { data?: unknown }; message?: string };
  const data = ax?.response?.data;

  if (typeof data === "string" && data.trim()) {
    const firstLine = data.split("\n")[0]?.trim();
    if (firstLine && !firstLine.startsWith("FUNCTION_INVOCATION")) {
      return firstLine;
    }
  }

  if (data && typeof data === "object") {
    const msg = formatApiError(data, "");
    if (msg) return msg;
  }

  if (typeof ax?.message === "string" && ax.message !== "Network Error") {
    return ax.message;
  }

  return fallback;
}

/**
 * Paths that use the admin session Bearer token (and admin login on 401).
 * Voice routes are /api/voice/* — they must not fall through to the client token
 * or a 401 will wipe the session and redirect to /portal/login.
 */
export function isAdminApiPath(url: string): boolean {
  const path = String(url || "").split("?")[0];
  return (
    path.startsWith("/admin") ||
    path.startsWith("/auth/admin") ||
    path.startsWith("/mcp/") ||
    path.startsWith("/voice/")
  );
}

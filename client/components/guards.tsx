import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAppSelector } from "@/store/hooks";

/**
 * Protect admin routes — redirect unauthenticated visitors to /admin/login.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const token = useAppSelector((s) => s.adminAuth.token);
  const location = useLocation();
  if (!token) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

/**
 * Protect super_admin-only routes — redirect non-super-admins to /admin dashboard.
 */
export function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { token, user } = useAppSelector((s) => s.adminAuth);
  const location = useLocation();
  if (!token) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  if (user && user.role !== "super_admin") {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}

/**
 * Protect affiliate-manager routes (super_admin/admin) — redirect affiliates
 * to their own portal and other roles (agent/support) to the dashboard.
 * Gated by server AFFILIATES_ENABLED (surfaced via section_locks).
 */
export function RequireAffiliateManager({ children }: { children: ReactNode }) {
  const { token, user } = useAppSelector((s) => s.adminAuth);
  const { sectionLocks, sectionLocksInitialized } = useAppSelector(
    (s) => s.admin,
  );
  const location = useLocation();
  if (!token) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  const sectionLocked = sectionLocks.some(
    (l) => l.section_key === "affiliates" && l.is_locked,
  );
  if (sectionLocksInitialized && sectionLocked) {
    return <Navigate to="/admin" replace />;
  }
  if (user?.role === "affiliate") {
    return <Navigate to="/admin/affiliate" replace />;
  }
  if (user && user.role !== "super_admin" && user.role !== "admin") {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}

/**
 * Affiliate self-portal — gated when AFFILIATES_ENABLED is off (via section_locks).
 */
export function RequireAffiliatePortal({ children }: { children: ReactNode }) {
  const { token } = useAppSelector((s) => s.adminAuth);
  const { sectionLocks, sectionLocksInitialized } = useAppSelector(
    (s) => s.admin,
  );
  const location = useLocation();
  if (!token) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  const sectionLocked = sectionLocks.some(
    (l) => l.section_key === "affiliate-portal" && l.is_locked,
  );
  if (sectionLocksInitialized && sectionLocked) {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}

/**
 * Protect staff-only admin routes — affiliates may use dashboard / clients /
 * pipeline / their portal, but not team ops pages (API already 403s).
 */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { token, user } = useAppSelector((s) => s.adminAuth);
  const location = useLocation();
  if (!token) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  if (user?.role === "affiliate") {
    return <Navigate to="/admin/affiliate" replace />;
  }
  return <>{children}</>;
}

/**
 * Protect client portal routes — redirect unauthenticated visitors to /portal/login.
 */
export function RequireClient({ children }: { children: ReactNode }) {
  const token = useAppSelector((s) => s.clientAuth.token);
  const location = useLocation();
  if (!token) {
    return <Navigate to="/portal/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

/**
 * Guest-only for /admin/login — if already authenticated as admin, go to /admin.
 */
export function NoAuthAdmin({ children }: { children: ReactNode }) {
  const token = useAppSelector((s) => s.adminAuth.token);
  if (token) {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}

/**
 * Guest-only for /portal/login — if already authenticated as client, go to /portal.
 */
export function NoAuthClient({ children }: { children: ReactNode }) {
  const token = useAppSelector((s) => s.clientAuth.token);
  if (token) {
    return <Navigate to="/portal" replace />;
  }
  return <>{children}</>;
}

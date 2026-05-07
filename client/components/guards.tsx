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

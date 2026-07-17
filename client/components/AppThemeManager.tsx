import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  applyAdminTheme,
  applyPortalTheme,
  applyThemeForPath,
  getStoredAdminScheme,
  getStoredPortalScheme,
  isAdminRoute,
  ADMIN_THEME_CHANGE_EVENT,
  PORTAL_THEME_CHANGE_EVENT,
} from "@/lib/routeTheme";

/**
 * Syncs `<html class="dark">` with the current route:
 * - Admin: light by default (toggle)
 * - Client-facing (marketing, register, portal): light by default (toggle)
 */
export default function AppThemeManager() {
  const { pathname } = useLocation();
  const [zone, setZone] = useState<"admin" | "client">(() =>
    isAdminRoute(pathname) ? "admin" : "client",
  );

  useEffect(() => {
    applyThemeForPath(pathname);
    setZone(isAdminRoute(pathname) ? "admin" : "client");
  }, [pathname]);

  useEffect(() => {
    if (zone === "admin") {
      const sync = () => applyAdminTheme(getStoredAdminScheme());
      window.addEventListener(ADMIN_THEME_CHANGE_EVENT, sync);
      return () => window.removeEventListener(ADMIN_THEME_CHANGE_EVENT, sync);
    }
    const sync = () => applyPortalTheme(getStoredPortalScheme());
    window.addEventListener(PORTAL_THEME_CHANGE_EVENT, sync);
    return () => window.removeEventListener(PORTAL_THEME_CHANGE_EVENT, sync);
  }, [zone]);

  return null;
}

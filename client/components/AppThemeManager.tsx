import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  applyAdminTheme,
  applyPortalTheme,
  applyPublicDarkTheme,
  applyThemeForPath,
  getStoredAdminScheme,
  getStoredPortalScheme,
  isAdminRoute,
  isPortalRoute,
  ADMIN_THEME_CHANGE_EVENT,
  PORTAL_THEME_CHANGE_EVENT,
} from "@/lib/routeTheme";

/**
 * Syncs `<html class="dark">` with the current route:
 * - Marketing / register / pay: always dark
 * - Admin: light by default (toggle)
 * - Client portal: dark by default (toggle)
 */
export default function AppThemeManager() {
  const { pathname } = useLocation();
  const [zone, setZone] = useState<"admin" | "portal" | "public">(() => {
    if (isAdminRoute(pathname)) return "admin";
    if (isPortalRoute(pathname)) return "portal";
    return "public";
  });

  useEffect(() => {
    applyThemeForPath(pathname);
    if (isAdminRoute(pathname)) setZone("admin");
    else if (isPortalRoute(pathname)) setZone("portal");
    else setZone("public");
  }, [pathname]);

  useEffect(() => {
    if (zone === "admin") {
      const sync = () => applyAdminTheme(getStoredAdminScheme());
      window.addEventListener(ADMIN_THEME_CHANGE_EVENT, sync);
      return () => window.removeEventListener(ADMIN_THEME_CHANGE_EVENT, sync);
    }
    if (zone === "portal") {
      const sync = () => applyPortalTheme(getStoredPortalScheme());
      window.addEventListener(PORTAL_THEME_CHANGE_EVENT, sync);
      return () => window.removeEventListener(PORTAL_THEME_CHANGE_EVENT, sync);
    }
  }, [zone]);

  return null;
}

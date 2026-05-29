/** Per-area color scheme (admin, portal) vs public site (always dark). */

export type ColorScheme = "light" | "dark";

export const ADMIN_THEME_STORAGE_KEY = "optimum-admin-color-scheme";
export const PORTAL_THEME_STORAGE_KEY = "optimum-portal-color-scheme";

export const ADMIN_THEME_CHANGE_EVENT = "optimum-admin-theme-change";
export const PORTAL_THEME_CHANGE_EVENT = "optimum-portal-theme-change";

export type ThemeZone = "admin" | "portal";

export function isAdminRoute(pathname: string): boolean {
  return pathname.startsWith("/admin");
}

export function isPortalRoute(pathname: string): boolean {
  return pathname.startsWith("/portal");
}

export function getStoredAdminScheme(): ColorScheme {
  if (typeof window === "undefined") return "light";
  return localStorage.getItem(ADMIN_THEME_STORAGE_KEY) === "dark"
    ? "dark"
    : "light";
}

export function getStoredPortalScheme(): ColorScheme {
  if (typeof window === "undefined") return "dark";
  return localStorage.getItem(PORTAL_THEME_STORAGE_KEY) === "light"
    ? "light"
    : "dark";
}

export function getStoredScheme(zone: ThemeZone): ColorScheme {
  return zone === "admin" ? getStoredAdminScheme() : getStoredPortalScheme();
}

export function setStoredScheme(zone: ThemeZone, scheme: ColorScheme): void {
  const key =
    zone === "admin" ? ADMIN_THEME_STORAGE_KEY : PORTAL_THEME_STORAGE_KEY;
  const event =
    zone === "admin" ? ADMIN_THEME_CHANGE_EVENT : PORTAL_THEME_CHANGE_EVENT;
  localStorage.setItem(key, scheme);
  window.dispatchEvent(new Event(event));
}

export function applyDocumentScheme(scheme: ColorScheme): void {
  document.documentElement.classList.toggle("dark", scheme === "dark");
}

export function applyPublicDarkTheme(): void {
  document.documentElement.classList.add("dark");
}

export function applyAdminTheme(scheme: ColorScheme = getStoredAdminScheme()): void {
  applyDocumentScheme(scheme);
}

export function applyPortalTheme(
  scheme: ColorScheme = getStoredPortalScheme(),
): void {
  applyDocumentScheme(scheme);
}

export function applyThemeForPath(pathname: string): void {
  if (isAdminRoute(pathname)) {
    applyAdminTheme(getStoredAdminScheme());
  } else if (isPortalRoute(pathname)) {
    applyPortalTheme(getStoredPortalScheme());
  } else {
    applyPublicDarkTheme();
  }
}

export function toggleScheme(zone: ThemeZone): ColorScheme {
  const current = getStoredScheme(zone);
  const next: ColorScheme = current === "dark" ? "light" : "dark";
  setStoredScheme(zone, next);
  applyDocumentScheme(next);
  return next;
}

export function themeChangeEvent(zone: ThemeZone): string {
  return zone === "admin" ? ADMIN_THEME_CHANGE_EVENT : PORTAL_THEME_CHANGE_EVENT;
}

// Back-compat aliases
export type AdminColorScheme = ColorScheme;
export const toggleAdminScheme = () => toggleScheme("admin");
export const setStoredAdminScheme = (scheme: ColorScheme) =>
  setStoredScheme("admin", scheme);

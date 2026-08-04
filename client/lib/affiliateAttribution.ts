/**
 * Client-side first-touch affiliate attribution (decision 6A — 30-day window).
 * Stored in both a cookie (survives across subdomains/SSR-less reloads) and
 * localStorage (used to know *when* attribution was captured, since cookies
 * don't expose their own expiry to JS).
 */
import {
  AFFILIATE_ATTRIBUTION_COOKIE,
  AFFILIATE_ATTRIBUTION_DAYS,
} from "@shared/affiliate";

interface StoredAffiliateRef {
  slug: string;
  ts: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string, days: number) {
  if (typeof document === "undefined") return;
  const maxAgeSeconds = Math.round(days * 24 * 60 * 60);
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=/; samesite=lax`;
}

function eraseCookie(name: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; max-age=0; path=/`;
}

function isExpired(ts: number): boolean {
  return Date.now() - ts > AFFILIATE_ATTRIBUTION_DAYS * MS_PER_DAY;
}

function readStoredRef(): StoredAffiliateRef | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AFFILIATE_ATTRIBUTION_COOKIE);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredAffiliateRef;
      if (parsed && typeof parsed.slug === "string" && typeof parsed.ts === "number") {
        return parsed;
      }
    }
  } catch {
    // ignore malformed localStorage payloads
  }
  // Fall back to the cookie alone (e.g. localStorage cleared but cookie
  // survived) — treat it as freshly captured since the cookie's own
  // max-age already enforces the 30-day window server-side.
  const cookieSlug = readCookie(AFFILIATE_ATTRIBUTION_COOKIE);
  return cookieSlug ? { slug: cookieSlug, ts: Date.now() } : null;
}

/**
 * First-touch capture: if a non-expired referral is already stored, it is
 * kept as-is. Otherwise stores `slug` as the new attribution.
 */
export function captureAffiliateRef(slug: string | null | undefined): void {
  if (typeof window === "undefined" || !slug) return;
  const trimmed = slug.trim();
  if (!trimmed) return;

  const existing = readStoredRef();
  if (existing && !isExpired(existing.ts)) return;

  const value: StoredAffiliateRef = { slug: trimmed, ts: Date.now() };
  writeCookie(AFFILIATE_ATTRIBUTION_COOKIE, trimmed, AFFILIATE_ATTRIBUTION_DAYS);
  try {
    window.localStorage.setItem(
      AFFILIATE_ATTRIBUTION_COOKIE,
      JSON.stringify(value),
    );
  } catch {
    // localStorage may be unavailable (private mode) — cookie still works
  }
}

/** Returns the stored affiliate slug, or null if none is set or it expired. */
export function getAffiliateRef(): string | null {
  const stored = readStoredRef();
  if (!stored) return null;
  if (isExpired(stored.ts)) {
    clearAffiliateRef();
    return null;
  }
  return stored.slug;
}

export function clearAffiliateRef(): void {
  eraseCookie(AFFILIATE_ATTRIBUTION_COOKIE);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AFFILIATE_ATTRIBUTION_COOKIE);
  } catch {
    // ignore
  }
}

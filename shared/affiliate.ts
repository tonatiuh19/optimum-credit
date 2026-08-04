/**
 * Affiliate tier defaults, slug helpers, and commission suggestions.
 * Safe for client + API (no Node-only APIs).
 */

export type AffiliatePlan = "standard" | "master" | "sub_affiliate";
export type AffiliateLanding = "credit_analysis" | "pricing";
export type AffiliateSubscriptionStatus =
  | "none"
  | "pending"
  | "active"
  | "past_due"
  | "cancelled"
  | "comped";

export const AFFILIATE_ATTRIBUTION_COOKIE = "oc_aff_ref";
/** First-touch attribution window (days) — decision 6A */
export const AFFILIATE_ATTRIBUTION_DAYS = 30;

/** Suggested monthly subscription prices (cents) — decision 3A */
export const AFFILIATE_TIER_PRICES_CENTS: Record<AffiliatePlan, number> = {
  standard: 20_000, // ~$200
  master: 50_000, // ~$500
  sub_affiliate: 0,
};

/**
 * Suggested commission rates in basis points (1% = 100).
 * Decision 20A — admins can override per affiliate.
 */
export const AFFILIATE_COMMISSION_SUGGESTIONS_BPS: Record<
  AffiliatePlan,
  { enrollment_bps: number; parent_override_bps: number }
> = {
  standard: { enrollment_bps: 1000, parent_override_bps: 0 }, // 10%
  master: { enrollment_bps: 1500, parent_override_bps: 500 }, // 15% + 5% on subs
  sub_affiliate: { enrollment_bps: 500, parent_override_bps: 0 }, // 5%
};

/** Feature flags — decision 4C: everything on for both paid tiers for now */
export const AFFILIATE_FEATURES_ALL_ON = {
  pipeline: true,
  lead_create: true,
  credit_analysis_links: true,
  sms: false, // deferred — Twilio number purchase later
  view_team_pipeline: true,
  sub_affiliates: true,
  commission_reports: true,
} as const;

export function slugifyAffiliateName(
  firstName: string,
  lastName: string,
): string {
  const base = `${firstName || ""}-${lastName || ""}`
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "affiliate";
}

export function normalizeAffiliateSlug(raw: string): string {
  return String(raw || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function isValidAffiliateSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 2 && slug.length <= 64;
}

export function suggestedTierDefaults(plan: AffiliatePlan): {
  monthly_price_cents: number;
  commission_rate_bps: number;
  parent_override_rate_bps: number;
} {
  const prices = AFFILIATE_TIER_PRICES_CENTS[plan];
  const rates = AFFILIATE_COMMISSION_SUGGESTIONS_BPS[plan];
  return {
    monthly_price_cents: prices,
    commission_rate_bps: rates.enrollment_bps,
    parent_override_rate_bps: rates.parent_override_bps,
  };
}

export function computeCommissionCents(
  baseAmountCents: number,
  rateBps: number,
): number {
  if (baseAmountCents <= 0 || rateBps <= 0) return 0;
  return Math.round((baseAmountCents * rateBps) / 10_000);
}

export function affiliateHasPortalAccess(opts: {
  status: string;
  subscription_status: string;
}): boolean {
  if (opts.status === "suspended" || opts.status === "inactive") return false;
  if (opts.status === "active") {
    return (
      opts.subscription_status === "active" ||
      opts.subscription_status === "comped"
    );
  }
  // invited: only if comped early
  return opts.subscription_status === "comped";
}

export function affiliateLandingPath(
  landing: AffiliateLanding,
  slug: string,
): string {
  if (landing === "pricing") return `/pricing?ref=${encodeURIComponent(slug)}`;
  return `/credit-analysis?ref=${encodeURIComponent(slug)}`;
}

export function buildAffiliatePublicLinks(slug: string, appUrl?: string): {
  short_default: string;
  short_analysis: string;
  short_pricing: string;
  analysis_ref: string;
  pricing_ref: string;
} {
  const base = (appUrl || "").replace(/\/$/, "");
  const s = encodeURIComponent(slug);
  const prefix = base ? `${base}` : "";
  return {
    short_default: `${prefix}/r/${s}`,
    short_analysis: `${prefix}/r/${s}?to=analysis`,
    short_pricing: `${prefix}/r/${s}?to=pricing`,
    analysis_ref: `${prefix}/credit-analysis?ref=${s}`,
    pricing_ref: `${prefix}/pricing?ref=${s}`,
  };
}

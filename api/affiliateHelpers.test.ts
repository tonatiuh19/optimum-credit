import { describe, expect, it } from "vitest";
import {
  affiliateCanReceiveClicks,
  affiliateHasPortalAccess,
  buildAffiliatePublicLinks,
  computeCommissionCents,
  isValidAffiliateSlug,
  normalizeAffiliateSlug,
  slugifyAffiliateName,
  suggestedTierDefaults,
  AFFILIATE_ATTRIBUTION_DAYS,
  AFFILIATE_TIER_PRICES_CENTS,
} from "./index";

describe("affiliate helpers", () => {
  it("slugifies names and strips accents", () => {
    expect(slugifyAffiliateName("José", "García")).toBe("jose-garcia");
    expect(slugifyAffiliateName("", "")).toBe("affiliate");
  });

  it("normalizes and validates slugs", () => {
    expect(normalizeAffiliateSlug(" Juan Perez!! ")).toBe("juan-perez");
    expect(isValidAffiliateSlug("juan-perez")).toBe(true);
    expect(isValidAffiliateSlug("JP")).toBe(false); // uppercase invalid after normalize expectation
    expect(isValidAffiliateSlug("a")).toBe(false);
    expect(isValidAffiliateSlug("-bad-")).toBe(false);
  });

  it("uses 30-day first-touch window constant", () => {
    expect(AFFILIATE_ATTRIBUTION_DAYS).toBe(30);
  });

  it("suggests tier prices and commission bps", () => {
    expect(AFFILIATE_TIER_PRICES_CENTS.standard).toBe(20_000);
    expect(AFFILIATE_TIER_PRICES_CENTS.master).toBe(50_000);
    expect(suggestedTierDefaults("standard").commission_rate_bps).toBe(1000);
    expect(suggestedTierDefaults("master").parent_override_rate_bps).toBe(500);
    expect(suggestedTierDefaults("sub_affiliate").monthly_price_cents).toBe(0);
  });

  it("computes commission cents from bps", () => {
    expect(computeCommissionCents(100_000, 1000)).toBe(10_000); // 10% of $1000
    expect(computeCommissionCents(0, 1000)).toBe(0);
    expect(computeCommissionCents(50_000, 0)).toBe(0);
  });

  it("gates portal access by status + subscription", () => {
    expect(
      affiliateHasPortalAccess({
        status: "active",
        subscription_status: "active",
      }),
    ).toBe(true);
    expect(
      affiliateHasPortalAccess({
        status: "active",
        subscription_status: "comped",
      }),
    ).toBe(true);
    expect(
      affiliateHasPortalAccess({
        status: "active",
        subscription_status: "none",
      }),
    ).toBe(false);
    expect(
      affiliateHasPortalAccess({
        status: "suspended",
        subscription_status: "active",
      }),
    ).toBe(false);
    expect(
      affiliateHasPortalAccess({
        status: "invited",
        subscription_status: "comped",
      }),
    ).toBe(true);
  });

  it("allows clicks for invited/active but not inactive/suspended", () => {
    expect(affiliateCanReceiveClicks({ status: "invited" })).toBe(true);
    expect(affiliateCanReceiveClicks({ status: "active" })).toBe(true);
    expect(affiliateCanReceiveClicks({ status: "inactive" })).toBe(false);
    expect(affiliateCanReceiveClicks({ status: "suspended" })).toBe(false);
  });

  it("builds public short + ref links", () => {
    const links = buildAffiliatePublicLinks("juan-perez", "https://app.example.com");
    expect(links.short_default).toBe("https://app.example.com/r/juan-perez");
    expect(links.short_analysis).toContain("/r/juan-perez?to=analysis");
    expect(links.analysis_ref).toContain("/credit-analysis?ref=juan-perez");
    expect(links.pricing_ref).toContain("/pricing?ref=juan-perez");
  });
});

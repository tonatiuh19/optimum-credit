/**
 * Round-report delivery helpers (portal next-path allowlist + SMS copy + partner flags).
 */
import { describe, expect, it } from "vitest";
import {
  sanitizePortalNextPath,
  computePartnersPdfNotifyFlags,
} from "./index";
import { smsClientReminderBody } from "./clientReminderSms";

describe("sanitizePortalNextPath", () => {
  it("allows portal reports / documents", () => {
    expect(sanitizePortalNextPath("/portal/reports")).toBe("/portal/reports");
    expect(sanitizePortalNextPath("/portal/documents")).toBe(
      "/portal/documents",
    );
  });

  it("rejects open redirects and unknown paths", () => {
    expect(sanitizePortalNextPath("https://evil.example")).toBeNull();
    expect(sanitizePortalNextPath("//evil.example")).toBeNull();
    expect(sanitizePortalNextPath("/portal/../admin")).toBeNull();
    expect(sanitizePortalNextPath("/portal/settings")).toBeNull();
    expect(sanitizePortalNextPath("")).toBeNull();
  });
});

describe("round complete SMS (secure download copy)", () => {
  it("EN/ES mention secure download", () => {
    const en = smsClientReminderBody({
      triggerEvent: "round_2_complete",
      firstName: "Alex",
      lang: "en",
      portalUrl: "https://app.example/api/public/round-report-pdf/abc",
    });
    expect(en).toMatch(/Secure download/i);
    expect(en).toContain("round-report-pdf");

    const es = smsClientReminderBody({
      triggerEvent: "round_2_complete",
      firstName: "Alex",
      lang: "es",
      portalUrl: "https://app.example/api/public/round-report-pdf/abc",
    });
    expect(es).toMatch(/Descarga segura/i);
  });
});

describe("computePartnersPdfNotifyFlags (wizard finalize partner path)", () => {
  it("skips partners when notify_partners is false", () => {
    expect(
      computePartnersPdfNotifyFlags({
        notifyPartners: false,
        hasPdfAttachment: true,
        partnersWithEmail: 2,
      }),
    ).toEqual({ shouldEmailPartners: false, partnersPdfLoadFailed: false });
  });

  it("emails partners when PDF bytes are available", () => {
    expect(
      computePartnersPdfNotifyFlags({
        notifyPartners: true,
        hasPdfAttachment: true,
        partnersWithEmail: 1,
      }),
    ).toEqual({ shouldEmailPartners: true, partnersPdfLoadFailed: false });
  });

  it("flags pdf load failure when partners expected but bytes missing", () => {
    expect(
      computePartnersPdfNotifyFlags({
        notifyPartners: true,
        hasPdfAttachment: false,
        partnersWithEmail: 1,
      }),
    ).toEqual({ shouldEmailPartners: false, partnersPdfLoadFailed: true });
  });

  it("does not flag failure when no partner emails exist", () => {
    expect(
      computePartnersPdfNotifyFlags({
        notifyPartners: true,
        hasPdfAttachment: false,
        partnersWithEmail: 0,
      }),
    ).toEqual({ shouldEmailPartners: false, partnersPdfLoadFailed: false });
  });
});

import { describe, expect, it } from "vitest";
import { adminAiBuildCrmHref, adminAiCrmRequired } from "./index";

describe("adminAiCrmRequired handoff", () => {
  it("builds pipeline client href by default", () => {
    expect(adminAiBuildCrmHref({ clientId: 13685458 })).toBe(
      "/admin/pipeline?client=13685458",
    );
  });

  it("prefers funding board when fundingId set", () => {
    expect(
      adminAiBuildCrmHref({ fundingId: 42, clientId: 1 }),
    ).toBe("/admin/funding?id=42");
  });

  it("appends crm_href to user_message when missing", () => {
    const payload = adminAiCrmRequired({
      reason: "file_too_large",
      userMessage: "Too large for ATLAS — upload in CRM",
      clientId: 99,
      crmAction: "Upload in Pipeline",
      details: { atlas_max_bytes: 3_000_000 },
    });
    expect(payload.crm_required).toBe(true);
    expect(payload.reason).toBe("file_too_large");
    expect(payload.crm_href).toBe("/admin/pipeline?client=99");
    expect(payload.crm_action).toBe("Upload in Pipeline");
    expect(payload.user_message).toContain("Open CRM: /admin/pipeline?client=99");
    expect(payload.details?.atlas_max_bytes).toBe(3_000_000);
  });

  it("does not duplicate href when already in the message", () => {
    const href = "/admin/pipeline?client=7";
    const payload = adminAiCrmRequired({
      reason: "unsupported_mime",
      userMessage: `Use CRM ${href}`,
      clientId: 7,
    });
    expect(payload.user_message).toBe(`Use CRM ${href}`);
  });
});

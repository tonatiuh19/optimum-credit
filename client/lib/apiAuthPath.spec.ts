import { describe, expect, it } from "vitest";
import { isAdminApiPath } from "./apiAuthPath";

describe("isAdminApiPath", () => {
  it("treats voice routes as admin (prevents portal logout after login)", () => {
    expect(isAdminApiPath("/voice/token")).toBe(true);
    expect(isAdminApiPath("/voice/availability")).toBe(true);
    expect(isAdminApiPath("/voice/call-forwarding")).toBe(true);
  });

  it("keeps admin and mcp paths as admin", () => {
    expect(isAdminApiPath("/admin/conversations/badge")).toBe(true);
    expect(isAdminApiPath("/auth/admin/me")).toBe(true);
    expect(isAdminApiPath("/mcp/oauth/approve")).toBe(true);
  });

  it("leaves client portal paths as non-admin", () => {
    expect(isAdminApiPath("/auth/client/me")).toBe(false);
    expect(isAdminApiPath("/client/dashboard")).toBe(false);
    expect(isAdminApiPath("/auth/logout")).toBe(false);
  });
});

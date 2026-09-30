import { describe, expect, it } from "vitest";
import {
  buildComposeDeepLink,
  normalizeContactPhone,
} from "./contactPhoneActions";

describe("normalizeContactPhone", () => {
  it("normalizes US 10-digit to +1", () => {
    expect(normalizeContactPhone("(765) 123-4567")).toEqual({
      phone: "+17651234567",
      label: "(765) 123-4567",
    });
  });

  it("returns null for empty", () => {
    expect(normalizeContactPhone("")).toBeNull();
    expect(normalizeContactPhone(null)).toBeNull();
  });
});

describe("buildComposeDeepLink", () => {
  it("builds phone-only compose link", () => {
    expect(buildComposeDeepLink({ phone: "7651234567" })).toBe(
      "/admin/conversations?composePhone=%2B17651234567",
    );
  });

  it("builds client + phone compose link", () => {
    const href = buildComposeDeepLink({
      clientId: 42,
      phone: "+17651234567",
    });
    expect(href).toContain("composeClient=42");
    expect(href).toContain("composePhone=%2B17651234567");
  });

  it("builds contact + phone compose link (no client)", () => {
    const href = buildComposeDeepLink({
      contactId: 99,
      phone: "+17651234567",
    });
    expect(href).toContain("composeContact=99");
    expect(href).toContain("composePhone=%2B17651234567");
    expect(href).not.toContain("composeClient=");
  });

  it("prefers client over contact in compose link", () => {
    const href = buildComposeDeepLink({
      clientId: 42,
      contactId: 99,
      phone: "+17651234567",
    });
    expect(href).toContain("composeClient=42");
    expect(href).not.toContain("composeContact=");
  });

  it("returns null when nothing usable", () => {
    expect(buildComposeDeepLink({})).toBeNull();
  });
});

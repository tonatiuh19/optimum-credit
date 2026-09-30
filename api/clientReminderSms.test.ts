import { describe, expect, it } from "vitest";
import {
  isClientReminderSmsSettingOn,
  smsClientActivated,
  smsClientReminderBody,
} from "./clientReminderSms";

describe("smsClientReminderBody", () => {
  const base = {
    firstName: "Alex",
    portalUrl: "https://example.test/portal/onboarding/abc",
  };

  it("builds EN/ES templates per trigger", () => {
    expect(
      smsClientReminderBody({
        ...base,
        triggerEvent: "docs_ready",
        lang: "en",
      }),
    ).toContain("docs are ready");
    expect(
      smsClientReminderBody({
        ...base,
        triggerEvent: "docs_ready",
        lang: "es",
      }),
    ).toContain("documentos ya están listos");
    expect(
      smsClientReminderBody({
        ...base,
        triggerEvent: "round_2_complete",
        lang: "en",
      }),
    ).toContain("Round 2");
    expect(
      smsClientReminderBody({
        ...base,
        triggerEvent: "payment_due",
        lang: "en",
      }),
    ).toContain("payment reminder");
    expect(
      smsClientReminderBody({
        ...base,
        triggerEvent: "payment_confirmed",
        lang: "en",
      }),
    ).toContain("upload your documents");
  });

  it("includes portal / magic url", () => {
    const body = smsClientReminderBody({
      ...base,
      triggerEvent: "completed",
      lang: "en",
    });
    expect(body).toContain(base.portalUrl);
  });
});

describe("smsClientActivated", () => {
  it("includes magic onboarding link (not bare /portal)", () => {
    const magic = "https://example.test/portal/onboarding/tok123";
    const en = smsClientActivated({
      firstName: "Alex",
      caseNumber: "CR-00001",
      lang: "en",
      portalUrl: magic,
    });
    expect(en).toContain(magic);
    expect(en).toContain("Get Started");
    expect(en).not.toMatch(/Get Started: https:\/\/example\.test\/portal$/);

    const es = smsClientActivated({
      firstName: "Alex",
      caseNumber: "CR-00001",
      lang: "es",
      portalUrl: magic,
    });
    expect(es).toContain(magic);
    expect(es).toContain("tareas de inicio");
  });
});

describe("isClientReminderSmsSettingOn", () => {
  it("defaults on when unset", () => {
    expect(isClientReminderSmsSettingOn(undefined)).toBe(true);
    expect(isClientReminderSmsSettingOn(null)).toBe(true);
  });

  it("parses common truthy/falsy values", () => {
    expect(isClientReminderSmsSettingOn("1")).toBe(true);
    expect(isClientReminderSmsSettingOn("true")).toBe(true);
    expect(isClientReminderSmsSettingOn("0")).toBe(false);
    expect(isClientReminderSmsSettingOn("off")).toBe(false);
  });
});

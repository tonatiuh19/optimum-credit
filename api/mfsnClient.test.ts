import { describe, expect, it } from "vitest";
import {
  buildMfsnPublicStatus,
  isMfsnFeatureEnabled,
  mfsnLoginCredentialsPresent,
  parseMfsn3BReport,
  parseMfsnLoginResponse,
  readMfsnEnv,
} from "./mfsnClient";

describe("isMfsnFeatureEnabled", () => {
  it("defaults off so prod/dev stay unchanged without the flag", () => {
    expect(isMfsnFeatureEnabled(undefined)).toBe(false);
    expect(isMfsnFeatureEnabled("")).toBe(false);
    expect(isMfsnFeatureEnabled("0")).toBe(false);
    expect(isMfsnFeatureEnabled("false")).toBe(false);
  });

  it("accepts common truthy flags", () => {
    expect(isMfsnFeatureEnabled("1")).toBe(true);
    expect(isMfsnFeatureEnabled("true")).toBe(true);
    expect(isMfsnFeatureEnabled("ON")).toBe(true);
    expect(isMfsnFeatureEnabled(" yes ")).toBe(true);
  });
});

describe("buildMfsnPublicStatus", () => {
  it("hides base URL and stays disabled when the flag is off even if creds exist", () => {
    const status = buildMfsnPublicStatus({
      enabled: false,
      baseUrl: "https://uat-api.myfreescorenow.com",
      apiEmail: "API#UserTest_29544",
      apiPassword: "secret",
      clientToken: "MAPIK#x",
    });
    expect(status.mode).toBe("disabled");
    expect(status.base_url).toBeNull();
    expect(status.credentials_present).toBe(true);
    expect(status.warnings.length).toBeGreaterThan(0);
  });

  it("does not treat credentials as present when password is empty", () => {
    expect(
      mfsnLoginCredentialsPresent({
        apiEmail: "API#UserTest_29544",
        apiPassword: "",
      }),
    ).toBe(false);
  });
});

describe("parseMfsnLoginResponse", () => {
  it("requires a token and never treats success:false as ok", () => {
    expect(
      parseMfsnLoginResponse(200, {
        success: true,
        message: "Login successful",
        token: "abc",
      }),
    ).toEqual({ ok: true, message: "Login successful", token: "abc" });
    expect(parseMfsnLoginResponse(401, { success: false, message: "nope" }).ok).toBe(
      false,
    );
    expect(parseMfsnLoginResponse(200, { success: true }).token).toBeNull();
  });
});

describe("parseMfsn3BReport", () => {
  it("maps EFX/EXP/TU scores, as-of dates, and score factors", () => {
    const asOfMs = Date.parse("2024-09-10T16:00:00.000Z");
    const parsed = parseMfsn3BReport({
      generatedDate: asOfMs,
      providerViews: [
        {
          provider: "EFX",
          summary: {
            reportGenerated: asOfMs,
            creditScore: {
              score: 640,
              scoreReasons: [
                {
                  code: "T001",
                  description: "Derogatory public record",
                  creditScoreFactorEffect: "HURTING",
                },
              ],
            },
          },
        },
        {
          provider: "TU",
          summary: {
            creditScore: { score: 655 },
          },
        },
      ],
    });
    expect(parsed.bureauScores.map((b) => b.bureau)).toEqual([
      "Equifax",
      "TransUnion",
    ]);
    expect(parsed.bureauScores[0]?.score).toBe(640);
    expect(parsed.bureauScores[0]?.asOf).toBe("2024-09-10T16:00:00.000Z");
    expect(parsed.scoreFactors[0]?.code).toBe("T001");
    expect(parsed.generatedAt).toBe("2024-09-10T16:00:00.000Z");
  });
});

describe("readMfsnEnv", () => {
  it("defaults to UAT host and does not enable from empty env", () => {
    const cfg = readMfsnEnv({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.baseUrl).toBe("https://uat-api.myfreescorenow.com");
  });
});

import { describe, expect, it } from "vitest";
import {
  computeLeadTemperature,
  isHotLeadStale,
  isLeadTemperatureUpgrade,
  type LeadSignals,
} from "./leadTemperature";

const now = new Date("2026-10-15T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const base: LeadSignals = {
  now,
  lastInboundAt: null,
  hasCreditReport: false,
  analysisReviewedAt: null,
  callScheduledAt: null,
  paymentStarted: false,
  monitoringLogin: false,
  documentsUploaded: false,
};

describe("computeLeadTemperature (semáforo)", () => {
  it("Caliente: analysis reviewed, call scheduled, or registration started", () => {
    expect(computeLeadTemperature({ ...base, analysisReviewedAt: daysAgo(1) }).temperature).toBe("hot");
    expect(computeLeadTemperature({ ...base, callScheduledAt: daysAgo(-2) })).toEqual({ temperature: "hot", reasons: ["call_scheduled"] });
    expect(computeLeadTemperature({ ...base, paymentStarted: true }).reasons).toEqual(["payment_started"]);
    expect(computeLeadTemperature({ ...base, monitoringLogin: true }).temperature).toBe("hot");
    expect(computeLeadTemperature({ ...base, documentsUploaded: true }).temperature).toBe("hot");
  });

  it("a scheduled call stops counting 2 days after it passes", () => {
    expect(computeLeadTemperature({ ...base, callScheduledAt: daysAgo(3) }).temperature).toBe("cold");
  });

  it("Tibio: replied in the last 14 days or has a credit report/analysis", () => {
    expect(computeLeadTemperature({ ...base, lastInboundAt: daysAgo(13) })).toEqual({ temperature: "warm", reasons: ["recent_reply"] });
    expect(computeLeadTemperature({ ...base, lastInboundAt: daysAgo(40), hasCreditReport: true }).reasons).toEqual(["has_credit_report"]);
  });

  it("Frío: no reply in 14+ days and no credit report", () => {
    expect(computeLeadTemperature({ ...base, lastInboundAt: daysAgo(14) })).toEqual({ temperature: "cold", reasons: ["no_reply_14d"] });
    expect(computeLeadTemperature(base).temperature).toBe("cold");
  });
});

describe("alerts", () => {
  it("detects color upgrades only", () => {
    expect(isLeadTemperatureUpgrade("warm", "hot")).toBe(true);
    expect(isLeadTemperatureUpgrade("cold", "warm")).toBe(true);
    expect(isLeadTemperatureUpgrade("hot", "warm")).toBe(false);
    expect(isLeadTemperatureUpgrade(null, "hot")).toBe(false);
  });

  it("flags a hot lead with no movement for 3 days, once per stretch", () => {
    expect(isHotLeadStale({ temperature: "hot", lastMovementAt: daysAgo(3), lastAlertAt: null, now })).toBe(true);
    expect(isHotLeadStale({ temperature: "hot", lastMovementAt: daysAgo(2), lastAlertAt: null, now })).toBe(false);
    expect(isHotLeadStale({ temperature: "hot", lastMovementAt: daysAgo(5), lastAlertAt: daysAgo(1), now })).toBe(false);
    expect(isHotLeadStale({ temperature: "warm", lastMovementAt: daysAgo(9), lastAlertAt: null, now })).toBe(false);
  });
});

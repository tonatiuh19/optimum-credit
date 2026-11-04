/**
 * Platform billing (OFG pays the platform owner): $750 base prorated from
 * deploy + $0.01 per MCP tool call; Claude / Twilio shown, not charged.
 */
import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  BILLING_LINE_LABELS,
  anthropicCostUsd,
  billingMonthBounds,
  computeBillingLines,
  previousBillingMonth,
  projectBillingLines,
  summarizeStripePaymentMethod,
  verifyStripeSignature,
} from "./index";

const PRICES = [
  { action: "platform_base_fee", unit: "month", unit_price_usd: 750, billable: true },
  { action: "mcp_tool_call", unit: "call", unit_price_usd: 0.01, billable: true },
  { action: "ai_credit_report_read", unit: "call", unit_price_usd: 0, billable: false },
];

describe("computeBillingLines", () => {
  it("first month: base prorated from the deploy moment, MCP counted", () => {
    const out = computeBillingLines({
      month: "2026-10",
      billingStart: new Date("2026-10-23T00:00:00Z"),
      prices: PRICES,
      counts: { mcp_tool_call: 5321, ai_credit_report_read: 400 },
    });
    expect(out.lines).toEqual([
      { action: "platform_base_fee", unit: "month", quantity: 0.2903, unit_price_usd: 750, amount_usd: 217.74, billed_days: 9, days_in_month: 31 },
      { action: "mcp_tool_call", unit: "call", quantity: 5321, unit_price_usd: 0.01, amount_usd: 53.21 },
    ]);
    expect(out.total_usd).toBe(270.95);
  });

  it("full month after the start: whole base fee", () => {
    const out = computeBillingLines({ month: "2026-11", billingStart: new Date("2026-10-23T00:00:00Z"), prices: PRICES, counts: {} });
    expect(out.lines[0].amount_usd).toBe(750);
    expect(out.total_usd).toBe(750);
  });

  it("nothing before billing started (or never started)", () => {
    expect(computeBillingLines({ month: "2026-09", billingStart: new Date("2026-10-23T00:00:00Z"), prices: PRICES, counts: { mcp_tool_call: 9 } }).total_usd).toBe(0);
    expect(computeBillingLines({ month: "2026-10", billingStart: null, prices: PRICES, counts: { mcp_tool_call: 9 } }).lines).toEqual([]);
  });

  it("non-billable actions never reach the invoice", () => {
    const out = computeBillingLines({ month: "2026-11", billingStart: new Date("2026-01-01T00:00:00Z"), prices: PRICES, counts: { ai_credit_report_read: 999 } });
    expect(out.lines.map((l) => l.action)).toEqual(["platform_base_fee", "mcp_tool_call"]);
  });
});

describe("anthropicCostUsd", () => {
  it("Sonnet: $3 in / $15 out per MTok; batch is half", () => {
    const u = { input_tokens: 100_000, output_tokens: 10_000 };
    expect(anthropicCostUsd("claude-sonnet-4-6", u)).toBe(0.45);
    expect(anthropicCostUsd("claude-sonnet-4-6", u, { batch: true })).toBe(0.225);
  });
  it("cache reads 0.1× and writes 1.25× input", () => {
    expect(anthropicCostUsd("claude-sonnet-4-6", { cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 })).toBe(4.05);
  });
  it("Haiku and Opus price rows; no usage = 0", () => {
    expect(anthropicCostUsd("claude-haiku-4-5", { input_tokens: 1_000_000 })).toBe(1);
    expect(anthropicCostUsd("claude-opus-4-6", { output_tokens: 1_000_000 })).toBe(25);
    expect(anthropicCostUsd("claude-sonnet-4-6", null)).toBe(0);
  });
});

describe("months + Stripe signature", () => {
  it("month bounds and previous month (UTC)", () => {
    expect(billingMonthBounds("2026-02").days).toBe(28);
    expect(previousBillingMonth(new Date("2026-11-01T00:05:00Z"))).toBe("2026-10");
    expect(previousBillingMonth(new Date("2027-01-15T00:00:00Z"))).toBe("2026-12");
    expect(() => billingMonthBounds("2026-1")).toThrow();
  });

  it("accepts a valid signature, rejects tampered / stale ones", () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ type: "invoice.paid", data: { object: { id: "in_1" } } });
    const t = 1_800_000_000;
    const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, t + 10)).toBe(true);
    expect(verifyStripeSignature(body + " ", `t=${t},v1=${v1}`, secret, t + 10)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, t + 1000)).toBe(false);
    expect(verifyStripeSignature(body, "", secret, t)).toBe(false);
  });
});

describe("summarizeStripePaymentMethod", () => {
  it("card", () => {
    expect(summarizeStripePaymentMethod({ id: "pm_1", type: "card", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030 } })).toEqual({
      id: "pm_1", type: "card", brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030, bank_name: null,
    });
  });
  it("US bank account; nothing saved = null", () => {
    expect(summarizeStripePaymentMethod({ id: "pm_2", type: "us_bank_account", us_bank_account: { last4: "6789", bank_name: "CHASE" } })).toMatchObject({
      last4: "6789", bank_name: "CHASE", brand: null,
    });
    expect(summarizeStripePaymentMethod(null)).toBeNull();
    expect(summarizeStripePaymentMethod("pm_unexpanded")).toBeNull();
  });
});

describe("projectBillingLines", () => {
  const lines = [
    { action: "platform_base_fee", unit: "month", quantity: 1, unit_price_usd: 750, amount_usd: 750, billed_days: 31, days_in_month: 31 },
    { action: "mcp_tool_call", unit: "call", quantity: 14786, unit_price_usd: 0.01, amount_usd: 147.86 },
  ];
  it("base stays, per-call extrapolated from the pace (22 of 31 days)", () => {
    const out = projectBillingLines(lines, {
      from: new Date("2026-10-01T00:00:00Z"),
      now: new Date("2026-10-23T00:00:00Z"),
      end: new Date("2026-11-01T00:00:00Z"),
    });
    expect(out.lines[0].amount_usd).toBe(750);
    expect(out.lines[1].quantity).toBe(Math.round(14786 * (31 / 22)));
    expect(out.total_usd).toBe(Math.round((750 + out.lines[1].quantity * 0.01) * 100) / 100);
  });
  it("closed month: no change", () => {
    const out = projectBillingLines(lines, { from: new Date("2026-10-01T00:00:00Z"), now: new Date("2026-12-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") });
    expect(out.total_usd).toBe(897.86);
  });
});

describe("OFG Operating Suite", () => {
  const SUITE = {
    suite_credit_intelligence: 152.35,
    suite_communications_hub: 109.8,
    suite_crm_automations: 94.65,
    suite_cloud_infrastructure: 95.4,
    suite_security_compliance: 54.95,
    suite_managed_support: 74.85,
  };
  it("6 services add up to $582 a month, each with an invoice label", () => {
    expect(Math.round(Object.values(SUITE).reduce((a, b) => a + b, 0) * 100)).toBe(58200);
    for (const k of Object.keys(SUITE)) expect(BILLING_LINE_LABELS[k]).toMatch(/^OFG Operating Suite — /);
    expect(BILLING_LINE_LABELS.mcp_tool_call).toBe("AI Assistant Connector (MCP) — usage");
  });
  it("full month bills every service in full; first partial month prorates each", () => {
    const prices = [
      ...Object.entries(SUITE).map(([action, p]) => ({ action, unit: "month", unit_price_usd: p, billable: true })),
      { action: "mcp_tool_call", unit: "call", unit_price_usd: 0.01, billable: true },
    ];
    const full = computeBillingLines({ month: "2026-10", billingStart: new Date("2026-10-01T00:00:00Z"), prices, counts: { mcp_tool_call: 14786 } });
    expect(full.lines).toHaveLength(7);
    expect(full.total_usd).toBe(729.86);
    const half = computeBillingLines({ month: "2026-11", billingStart: new Date("2026-11-16T00:00:00Z"), prices, counts: {} });
    expect(half.total_usd).toBe(291);
  });
});

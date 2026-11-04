import { describe, expect, it } from "vitest";
import { SUITE_SUBITEM_WEIGHTS, splitEvenly, splitWeighted } from "@/components/billing/OperatingSuiteCard";

describe("splitEvenly (suite sub-item prices)", () => {
  it.each([
    [195, [48.75, 48.75, 48.75, 48.75]],
    [140, [35, 35, 35, 35]],
    [125, [31.25, 31.25, 31.25, 31.25]],
    [70, [17.5, 17.5, 17.5, 17.5]],
  ])("$%s across 4", (amount, out) => {
    expect(splitEvenly(amount, 4)).toEqual(out);
  });

  it("uneven cents always add back to the service amount", () => {
    const parts = splitEvenly(100, 3);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100)).toBe(10000);
  });

  it("no sub-items → empty", () => {
    expect(splitEvenly(195, 0)).toEqual([]);
  });
});

describe("splitWeighted (rate-card sub-item prices)", () => {
  const PRICES: Record<string, number> = {
    suite_credit_intelligence: 152.35,
    suite_communications_hub: 109.8,
    suite_crm_automations: 94.65,
    suite_cloud_infrastructure: 95.4,
    suite_security_compliance: 54.95,
    suite_managed_support: 74.85,
  };

  it.each(Object.entries(PRICES))("%s: at the current price the sub-items are exactly the rate card", (action, price) => {
    expect(splitWeighted(price, SUITE_SUBITEM_WEIGHTS[action], 4)).toEqual(SUITE_SUBITEM_WEIGHTS[action]);
  });

  it("suite total is $582", () => {
    expect(Math.round(Object.values(PRICES).reduce((a, b) => a + b, 0) * 100)).toBe(58200);
  });

  it.each([153, 99.99, 1, 200])("rescaled to $%s still adds up to the cent and keeps the order", (amount) => {
    const w = SUITE_SUBITEM_WEIGHTS.suite_credit_intelligence;
    const parts = splitWeighted(amount, w, 4);
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100)).toBe(Math.round(amount * 100));
    expect(parts[0]).toBeGreaterThanOrEqual(parts[3]);
  });

  it("falls back to an even split when weights do not match", () => {
    expect(splitWeighted(100, [1, 2], 4)).toEqual([25, 25, 25, 25]);
    expect(splitWeighted(100, undefined, 4)).toEqual([25, 25, 25, 25]);
  });
});

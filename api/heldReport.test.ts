/**
 * Held-report explanations (Nov 7, 2026): parsed from the exact detail strings the self-check writes.
 */
import { describe, expect, it } from "vitest";
import { explainHeldChecks } from "../shared/heldReport";

describe("explainHeldChecks", () => {
  it("a client: Experian limits held → the platform, with both numbers", () => {
    const e = explainHeldChecks([
      { key: "limits", pass: false, detail: "After EX: revolving limits $22,800 vs summary $15,800" },
      { key: "printed_repairs", pass: true, detail: "Before: CAPITAL ONE …5178: duplicate copy of the same card removed" },
      { key: "collections", pass: null, detail: "pull prints no summary" },
    ]);
    expect(e.cause).toBe("platform");
    expect(e.reasons).toEqual([
      { key: "limits", kind: "limits", pull: "after", bureau: "EX", platform: 22800, report: 15800, detail: "After EX: revolving limits $22,800 vs summary $15,800" },
    ]);
  });

  it("several parts in one check, each its own reason (balances, open accounts, inquiries)", () => {
    const e = explainHeldChecks([
      { key: "balances", pass: false, detail: "After TU: balances $340,147 vs summary $321,051; After EX: balances $328,046 vs summary $308,950" },
      { key: "account_totals", pass: false, detail: "Before TU: 9 open accounts read, summary 10" },
      { key: "inquiries", pass: false, detail: "After EX: 20 inquiries read, summary 19" },
    ]);
    expect(e.cause).toBe("platform");
    expect(e.reasons.map((r) => `${r.kind}:${r.pull}:${r.bureau}:${r.platform}/${r.report}`)).toEqual([
      "balances:after:TU:340147/321051",
      "balances:after:EX:328046/308950",
      "open_accounts:before:TU:9/10",
      "inquiries:after:EX:20/19",
    ]);
  });

  it("many accounts missing (10%+) points at the PDF itself", () => {
    expect(explainHeldChecks([{ key: "account_totals", pass: false, detail: "After EQ: 16 accounts read, summary 24" }]).cause).toBe("file");
    expect(explainHeldChecks([{ key: "account_totals", pass: false, detail: "Before: 35 accounts read, the report lists 39" }]).cause).toBe("platform");
    expect(explainHeldChecks([{ key: "account_totals", pass: false, detail: "After EQ: 48 accounts read, summary 46" }]).cause).toBe("platform");
  });

  it("an unknown detail is kept as written; passed / not-applicable checks are ignored", () => {
    const e = explainHeldChecks([
      { key: "target_count", pass: false, detail: "PDF 20 / record 21 / engine 21" },
      { key: "scores", pass: true, detail: "ok" },
    ]);
    expect(e.reasons).toEqual([{ key: "target_count", kind: "other", pull: null, bureau: null, platform: null, report: null, detail: "PDF 20 / record 21 / engine 21" }]);
    expect(explainHeldChecks([]).reasons).toEqual([]);
  });
});

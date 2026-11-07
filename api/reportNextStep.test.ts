/**
 * One recommended next step per report state (Nov 7, 2026): the same rule everywhere staff look.
 */
import { describe, expect, it } from "vitest";
import { reportNextStep } from "../shared/reportNextStep";

describe("reportNextStep", () => {
  it.each([
    ["wizard: nothing known yet", {}, "reading"],
    ["wizard: reading", { reads: {} }, "reading"],
    ["wizard: same file twice", { reads: { blockedSameFile: true } }, "newer_report"],
    ["wizard: half-loaded print", { reads: { incompletePrint: true } }, "resave_pdf"],
    ["wizard: half-loaded but scores readable", { reads: { incompletePrint: true, scoreUpdateAvailable: true } }, "score_update"],
    ["wizard: a read failed", { reads: { failed: true } }, "read_failed"],
    ["wizard: both read", { reads: { ready: true } }, "publish"],
    ["waiting, I approve", { delivery: { status: "pending_approval", canApprove: true } }, "approve"],
    ["waiting, someone else approves", { delivery: { status: "pending_approval", canApprove: false } }, "wait_approver"],
    ["rebuilt itself and passes", { delivery: { status: "pending_approval", canApprove: true, rebuilt: true } }, "approve_rebuilt"],
    ["held, the PDF is fine", { delivery: { status: "needs_review", checks: [{ key: "limits", pass: false, detail: "After EX: revolving limits $22,800 vs summary $15,800" }] } }, "held_platform"],
    ["held, half the accounts missing", { delivery: { status: "needs_review", checks: [{ key: "account_totals", pass: false, detail: "After EQ: 10 accounts read, summary 24" }] } }, "resave_pdf"],
    ["sent", { delivery: { status: "sent" } }, "done"],
    ["released silently", { delivery: { status: "silent" } }, "done"],
  ] as const)("%s → %s", (_n, input, step) => {
    expect(reportNextStep(input as any).step).toBe(step);
  });

  it("never tells anyone to reset or wait for an OK", async () => {
    const en = (await import("../client/locales/en/translation.json")).default as any;
    const es = (await import("../client/locales/es/translation.json")).default as any;
    for (const text of [...Object.values(en.reportNextStep), ...Object.values(es.reportNextStep)] as string[]) {
      expect(text).not.toMatch(/reset the round|reinicia la ronda|wait for (my|an) ok/i);
    }
  });
});

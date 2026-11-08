/**
 * Spec v1.1 P0-1 UI: a published report waits for Approve & send; a failed
 * self-check shows the failing check and only a release manager's override.
 */
import { describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { Provider } from "react-redux";

vi.mock("@/lib/api", async (orig) => {
  const real: any = await orig();
  const pending = () => new Promise(() => {});
  return { ...real, default: { get: pending, post: pending, put: pending, patch: pending, delete: pending, interceptors: real.default.interceptors } };
});

import { configureStore } from "@reduxjs/toolkit";
import { renderWithProviders } from "@/test/renderWithProviders";
import reportApproval, { fetchReportApproval, type ReportApproval } from "@/store/slices/reportApprovalSlice";
import { ReportApprovalCard } from "@/components/admin/report-approval/ReportApprovalCard";

const base = (o: Partial<ReportApproval>): ReportApproval => ({
  id: 9,
  round_number: 4,
  delivery_status: "pending_approval",
  checks: [
    { key: "account_totals", pass: true, detail: "matches the pull summary" },
    { key: "target_count", pass: true, detail: "PDF 21 / record 21 / engine 21" },
  ],
  options: { notify_client: true, notify_partners: true },
  approved_at: null,
  approved_by: null,
  can_approve: true,
  can_override: false,
  ...o,
});

function setup(a: ReportApproval) {
  const store = configureStore({ reducer: { reportApproval } });
  renderWithProviders(
    <Provider store={store}>
      <ReportApprovalCard reportId={9} />
    </Provider>,
  );
  act(() => {
    store.dispatch({ type: fetchReportApproval.fulfilled.type, payload: a, meta: { arg: 9 } });
  });
}

describe("ReportApprovalCard", () => {
  it("pending: not sent yet + Approve & send for the approver", () => {
    setup(base({}));
    expect(screen.getByTestId("report-approval-card").textContent).toMatch(/Waiting for approval — not sent yet/);
    expect(screen.getByTestId("report-approve").textContent).toMatch(/Approve & send/);
    expect(screen.getByText(/2 of 2 checks passed/)).toBeTruthy();
  });

  it("pending, not an approver: no button, says who can approve", () => {
    setup(base({ can_approve: false }));
    expect(screen.queryByTestId("report-approve")).toBeNull();
    expect(screen.getByTestId("report-approval-card").textContent).toMatch(/language owner or Cesar/);
  });

  it("self-check failed: named failure, no send button; the override form only for a release manager", () => {
    const failed = base({
      delivery_status: "needs_review",
      checks: [{ key: "account_totals", pass: false, detail: "Before TU: 11 accounts read, summary 32" }],
    });
    setup(failed);
    expect(screen.getByTestId("self-check-failed").textContent).toMatch(/Account totals vs the pull summary · Before TU: 11 accounts read, summary 32/);
    expect(screen.queryByTestId("report-approve")).toBeNull();
    expect(screen.queryByTestId("report-override-form")).toBeNull();
    expect(screen.getByTestId("report-approval-card").textContent).toMatch(/Only Cesar can override/);
  });

  it("self-check failed, release manager: override form with a required reason", () => {
    setup(base({ delivery_status: "needs_review", can_override: true, checks: [{ key: "scores", pass: false, detail: "TU After 640 vs pull 627" }] }));
    expect(screen.getByTestId("report-override-form")).toBeTruthy();
  });

  it("sent: shows who approved", () => {
    setup(base({ delivery_status: "sent", approved_by: "Lecca B" }));
    expect(screen.getByTestId("report-approval-done").textContent).toMatch(/Sent to the client · approved by Lecca B/);
  });

  it("held: the approver can send it back to Review (Rebuild); a waiting report has no Rebuild; repairs show as a check line", () => {
    setup(
      base({
        delivery_status: "needs_review",
        checks: [
          { key: "account_totals", pass: false, detail: "After EQ: 16 accounts read, summary 24" },
          { key: "printed_repairs", pass: true, detail: "Before: BK OF AMER TU: limit $1,279 → $500" },
        ],
      }),
    );
    expect(screen.getByTestId("report-rebuild").textContent).toMatch(/Rebuild with the latest checks/);
    expect(screen.getByTestId("report-approval-card").textContent).toMatch(/same PDFs/);
    expect(screen.getByTestId("report-approval-card").textContent).toMatch(/Corrected from the PDF/);
    expect(screen.getByTestId("report-approval-card").textContent).toMatch(/limit \$1,279 → \$500/);
  });

  it("held, not an approver → no Rebuild; waiting → no Rebuild", () => {
    setup(base({ delivery_status: "needs_review", can_approve: false, checks: [{ key: "account_totals", pass: false, detail: "x" }] }));
    expect(screen.queryByTestId("report-rebuild")).toBeNull();
  });

  it("pending approval never shows Rebuild", () => {
    setup(base({}));
    expect(screen.queryByTestId("report-rebuild")).toBeNull();
  });

  it("held for a platform reason: says the PDF is fine, explains in plain words, nothing to do, never says reset", () => {
    setup(base({ delivery_status: "needs_review", checks: [{ key: "limits", pass: false, detail: "After EX: revolving limits $22,800 vs summary $15,800" }] }));
    const card = screen.getByTestId("report-approval-card").textContent || "";
    expect(card).toMatch(/your PDF is fine/);
    expect(screen.getByTestId("report-held-reasons").textContent).toMatch(/After report · Experian: credit limits — the platform counted \$22,800, the report shows \$15,800/);
    expect(screen.getByTestId("next-step-held_platform").textContent).toMatch(/Nothing to do — Cesar was notified, and it re-checks itself/);
    expect(screen.getByTestId("report-held-body").textContent).toMatch(/please don't reset/);
  });

  it("held because the PDF is incomplete: says to re-save it, no 'nothing to do'", () => {
    setup(base({ delivery_status: "needs_review", checks: [{ key: "account_totals", pass: false, detail: "After EQ: 16 accounts read, summary 24" }] }));
    expect(screen.getByTestId("report-held-body").textContent).toMatch(/Re-save it from SmartCredit/);
    expect(screen.getByTestId("next-step-resave_pdf")).toBeTruthy();
    expect(screen.queryByTestId("next-step-held_platform")).toBeNull();
  });
});

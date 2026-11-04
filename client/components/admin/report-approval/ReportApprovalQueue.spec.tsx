/**
 * Approval queue (Spec v1.1 P0-1): a Score update (Oct 28, 2026) is labeled so the
 * approver knows it carries scores + verified inquiries only; full reports are unchanged.
 */
import { describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/api", async (orig) => {
  const real: any = await orig();
  const pending = () => new Promise(() => {});
  return { ...real, default: { get: pending, post: pending, put: pending, patch: pending, delete: pending, interceptors: real.default.interceptors } };
});

import { configureStore } from "@reduxjs/toolkit";
import { renderWithProviders } from "@/test/renderWithProviders";
import reportApproval, { fetchPendingReportApprovals, type PendingReportApproval } from "@/store/slices/reportApprovalSlice";
import { ReportApprovalQueue } from "@/components/admin/report-approval/ReportApprovalQueue";

const item = (o: Partial<PendingReportApproval>): PendingReportApproval => ({
  id: 1,
  client_id: 9,
  case_id: 3,
  round_number: 5,
  locale: "en",
  delivery_status: "pending_approval",
  failed_checks: [],
  client_name: "Ana Lopez",
  published_by: "Lecca",
  created_at: "2026-10-28T15:00:00.000Z",
  can_approve: true,
  can_override: true,
  ...o,
});

function setup(items: PendingReportApproval[]) {
  const store = configureStore({ reducer: { reportApproval } });
  renderWithProviders(
    <Provider store={store}>
      <MemoryRouter>
        <ReportApprovalQueue />
      </MemoryRouter>
    </Provider>,
  );
  act(() => {
    store.dispatch({ type: fetchPendingReportApprovals.fulfilled.type, payload: items });
  });
}

describe("ReportApprovalQueue", () => {
  it("labels a Score update row; a full report row has no label", () => {
    setup([item({ id: 1, report_kind: "score_update" }), item({ id: 2, client_name: "Ben Ruiz", report_kind: "progress_report" })]);
    const badges = screen.getAllByTestId("approval-score-update-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe("Score update");
    expect(badges[0].closest("button")?.textContent).toMatch(/Ana Lopez · R5/);
  });

  it("rows from an older API (no report_kind) render as before", () => {
    setup([item({ id: 3 })]);
    expect(screen.queryByTestId("approval-score-update-badge")).toBeNull();
    expect(screen.getByTestId("report-approval-queue").textContent).toMatch(/Ana Lopez · R5 · EN/);
  });
});

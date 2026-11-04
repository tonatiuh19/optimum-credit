import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import type { CreditAnalysisResult } from "@shared/api";
import { renderWithProviders } from "@/test/renderWithProviders";

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return {
    ...actual,
    default: { ...actual.default, get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
  };
});

const { store } = await import("@/store");
const { default: CreditAnalysisResultPanel } = await import(
  "@/components/credit/CreditAnalysisResultPanel"
);

const result = {
  id: 4242,
  client_id: 1,
  mode: "agent",
  scores: { transunion: 600, experian: 610, equifax: 620 },
  negatives: [],
  suggested_labels: [],
  email_sent: false,
  generated_at: "2026-10-14T00:00:00.000Z",
  text_language: "en",
} as unknown as CreditAnalysisResult;

function renderPanel(staff: boolean, extra: Partial<CreditAnalysisResult> = {}) {
  return renderWithProviders(
    <Provider store={store}>
      <CreditAnalysisResultPanel result={{ ...result, id: result.id, ...extra } as CreditAnalysisResult} staffEnhancedPdf={staff} />
    </Provider>,
  );
}

describe("CreditAnalysisResultPanel — new engine everywhere", () => {
  beforeEach(() => apiGet.mockReset());

  it("no read on file (no token, not staff): says so — never an old-engine summary", async () => {
    renderPanel(false);
    expect(screen.getByTestId("credit-analysis-read-failed")).toBeTruthy();
    expect(screen.queryByTestId("credit-analysis-download")).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("portal row (token, read finished): polls by token even when not pending", async () => {
    apiGet.mockResolvedValue({ data: { status: "ready" } });
    renderPanel(false, { enhanced_pending: false, public_token: "b".repeat(32) });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(`/public/credit-analyses/${"b".repeat(32)}/status`));
  });

  it("staff: while reading, shows progress only (no quick scores) and download waits", async () => {
    apiGet.mockResolvedValue({ data: { status: "submitted" } });
    renderPanel(true, { enhanced_pending: true });
    await waitFor(() => expect(screen.getByTestId("credit-analysis-reading")).toBeTruthy());
    expect(apiGet).toHaveBeenCalledWith("/admin/credit-analyses/4242/enhanced-status");
    expect((screen.getByTestId("credit-analysis-download") as HTMLButtonElement).disabled).toBe(true);
    // Quick-summary negatives section is not rendered while reading.
    expect(screen.queryByText(/No negative items detected/i)).toBeNull();
  });

  it("staff: ready → new-engine summary replaces the quick summary", async () => {
    apiGet.mockImplementation(async (url: unknown) =>
      String(url).endsWith("/enhanced-status")
        ? { data: { status: "ready" } }
        : { data: { analysis: null } },
    );
    renderPanel(true, { enhanced_pending: true });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith("/admin/credit-analyses/4242/enhanced-analysis"));
    expect(screen.queryByTestId("credit-analysis-reading")).toBeNull();
  });

  it("public form / portal: polls by secure token, never the admin endpoints", async () => {
    apiGet.mockResolvedValue({ data: { status: "queued" } });
    renderPanel(false, { enhanced_pending: true, public_token: "a".repeat(32) });
    await waitFor(() => expect(screen.getByTestId("credit-analysis-reading")).toBeTruthy());
    expect(apiGet).toHaveBeenCalledWith(`/public/credit-analyses/${"a".repeat(32)}/status`);
    expect(apiGet.mock.calls.some((c) => String(c[0]).startsWith("/admin/"))).toBe(false);
  });

  it("read failed: says so, no quick summary presented as the analysis", async () => {
    apiGet.mockResolvedValue({ data: { status: "failed" } });
    renderPanel(true, { enhanced_pending: true });
    await waitFor(() => expect(screen.getByTestId("credit-analysis-read-failed")).toBeTruthy());
    expect(screen.queryByText(/No negative items detected/i)).toBeNull();
  });

  it("public: analysis held for staff review → 'We're reviewing your report', no data, no download", async () => {
    apiGet.mockResolvedValue({ data: { status: "review" } });
    renderPanel(false, { enhanced_pending: false, public_token: "c".repeat(32) });
    await waitFor(() => expect(screen.getByTestId("credit-analysis-in-review")).toBeTruthy());
    expect(screen.getByText(/reviewing your report/i)).toBeTruthy();
    expect(screen.queryByTestId("credit-analysis-download")).toBeNull();
    expect(apiGet.mock.calls.some((c) => String(c[0]).includes("/analysis"))).toBe(false);
  });

  it("staff: needs review → findings + Approve (calls the review endpoint)", async () => {
    apiGet.mockImplementation(async (url: unknown) =>
      String(url).endsWith("/enhanced-status")
        ? {
            data: {
              status: "ready",
              review: {
                status: "needs_review",
                reviewedAt: null,
                findings: {
                  selfCheck: { ok: false, items: [{ key: "accounts", label: "Account count", expected: "29", actual: "28", ok: false }] },
                  audit: [{ check: "Score", severity: "blocking", detail: "TU score is 578 on the report" }],
                  reconciledAdded: 0,
                  error: null,
                },
              },
            },
          }
        : { data: { analysis: null } },
    );
    apiPost.mockResolvedValue({ data: { review_status: "approved" } });
    renderPanel(true, { enhanced_pending: false });
    await waitFor(() => expect(screen.getByTestId("credit-review-needs")).toBeTruthy());
    expect(screen.getByText(/Account count: report 29, read 28/)).toBeTruthy();
    expect(screen.getByText(/TU score is 578/)).toBeTruthy();
    screen.getByTestId("credit-review-approve").click();
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/admin/credit-analyses/4242/review", { action: "approve" }),
    );
  });
});

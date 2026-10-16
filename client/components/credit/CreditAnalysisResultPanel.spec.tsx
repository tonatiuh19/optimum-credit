import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import type { CreditAnalysisResult } from "@shared/api";
import { renderWithProviders } from "@/test/renderWithProviders";

const apiGet = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => apiGet(...a) } };
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
  analysis_html: "<p>x</p>",
  email_sent: false,
  generated_at: "2026-10-14T00:00:00.000Z",
  extraction_status: "ok",
  text_language: "en",
} as unknown as CreditAnalysisResult;

function renderPanel(staff: boolean) {
  return renderWithProviders(
    <Provider store={store}>
      <CreditAnalysisResultPanel result={result} staffEnhancedPdf={staff} />
    </Provider>,
  );
}

describe("CreditAnalysisResultPanel enhanced PDF (staff only)", () => {
  beforeEach(() => apiGet.mockReset());

  it("public/portal usage is unchanged: no status calls, no hint", async () => {
    renderPanel(false);
    expect(screen.getByRole("button", { name: /download/i })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId("credit-analysis-enhanced-status")).toBeNull();
  });

  it("staff view shows the ready hint once the enhanced read is done", async () => {
    apiGet.mockResolvedValue({ data: { status: "ready" } });
    renderPanel(true);
    await waitFor(() =>
      expect(screen.getByTestId("credit-analysis-enhanced-status").textContent).toMatch(
        /Enhanced report ready/,
      ),
    );
    expect(apiGet).toHaveBeenCalledWith("/admin/credit-analyses/4242/enhanced-status");
  });

  it("staff view without an enhanced read keeps today's button and no hint", async () => {
    apiGet.mockResolvedValue({ data: { status: null } });
    renderPanel(true);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.queryByTestId("credit-analysis-enhanced-status")).toBeNull();
  });
});

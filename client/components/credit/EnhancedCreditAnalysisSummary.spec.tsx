import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { renderWithProviders } from "@/test/renderWithProviders";

const apiGet = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => apiGet(...a) } };
});

const { store } = await import("@/store");
const { EnhancedCreditAnalysisSummary } = await import("@/components/credit/EnhancedCreditAnalysisSummary");

const analysis = {
  reportDate: "10/15/2026",
  scoreModel: "VantageScore 3.0",
  scores: { TU: 752, EX: 644, EQ: 666 },
  scoreRatings: { TU: "Very Good", EX: "Fair", EQ: "Good" },
  missingBureaus: [],
  negatives: [
    { creditor: "TBOM/FORTIVA THD", kind: "late", bureaus: ["EX", "EQ"], status: "Late 30 Days (09/2026), $60 past due", round: 3, hold: false, legalBasis: "FCRA §611, §623" },
  ],
  inquiryClusters: [{ count: 17, from: "12/12/2024", to: "12/13/2024" }],
  accuracyUpdates: [{ creditor: "WESTLAKE SERVICE INC" }],
  identityFlags: [{ bureau: "EQ", field: "ssn" }],
  projections: [{ key: "current", scores: { TU: 752, EX: 644, EQ: 666 } }, { key: "round4", scores: { TU: 772, EX: 700, EQ: 710 } }],
  fileStrength: { current: 46, postRepair: 78 },
  programTier: "standard",
  escrow: { active: true, source: "mortgage_pull" },
  lender: { model: "FICO", score: 630, target: 660 },
  utilizationOverall: { all: 10.5 },
};

describe("EnhancedCreditAnalysisSummary", () => {
  it("shows the new engine: Fortiva negative, ratings, escrow, lender, 46 → 78", async () => {
    apiGet.mockResolvedValueOnce({ data: { analysis } });
    renderWithProviders(
      <Provider store={store}>
        <EnhancedCreditAnalysisSummary analysisId={9001} />
      </Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("enhanced-analysis-summary")).toBeTruthy());
    expect(apiGet).toHaveBeenCalledWith("/admin/credit-analyses/9001/enhanced-analysis");
    expect(screen.getByText("TBOM/FORTIVA THD")).toBeTruthy();
    expect(screen.getByText("Very Good")).toBeTruthy();
    expect(screen.queryByText(/No negative items/i)).toBeNull();
    expect(screen.getByText(/46 → 78/)).toBeTruthy();
    expect(screen.getByText(/630/)).toBeTruthy();
    expect(screen.getByText(/Scores: VantageScore 3\.0/)).toBeTruthy();
    // No self-check data on this analysis → no review warning.
    expect(screen.queryByTestId("analysis-self-check")).toBeNull();
  });

  it("Spec v2.1: middle score, Not itemized bureaus, informational, and the staff self-check warning", async () => {
    apiGet.mockResolvedValueOnce({
      data: {
        analysis: {
          ...analysis,
          scoreModel: "FICO",
          middleScore: 585,
          negatives: [{ ...analysis.negatives[0], creditor: "GM FINANCIAL", bureausNotItemized: true, round: 4 }],
          informational: [{ creditor: "DEPT OF ED", note: "Prior dispute remark" }],
          selfCheck: {
            ok: false,
            items: [{ key: "accounts", label: "Account count", expected: "29", actual: "28", ok: false }],
          },
        },
      },
    });
    renderWithProviders(
      <Provider store={store}>
        <EnhancedCreditAnalysisSummary analysisId={9002} />
      </Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("analysis-self-check")).toBeTruthy());
    expect(screen.getByText(/Middle score 585/)).toBeTruthy();
    expect(screen.getByText(/Not itemized/)).toBeTruthy();
    expect(screen.getByText(/DEPT OF ED/)).toBeTruthy();
    expect(screen.getByText(/Account count: report 29, read 28/)).toBeTruthy();
  });
});

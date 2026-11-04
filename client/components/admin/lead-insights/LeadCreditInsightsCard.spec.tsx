import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { LeadCreditInsightsData, LeadCreditInsightsResponse, Prospect } from "@shared/api";

const apiGet = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => apiGet(...a) } };
});

const { store } = await import("@/store");
const { LeadCreditInsightsCard } = await import("@/components/admin/lead-insights/LeadCreditInsightsCard");
const { LeadInsightChips } = await import("@/components/admin/lead-insights/LeadInsightChips");

const insights = (o: Partial<LeadCreditInsightsData> = {}): LeadCreditInsightsData => ({
  version: 1, reportDate: "10/26/2026", reportFormat: "merged", scoreModel: "FICO 2/4/5", scores: { TU: 530, EX: 589, EQ: 559 },
  middleScore: 559, targetScore: 580, pointsToTarget: 21, projectedMiddle: 633, roundToTarget: 2, readiness: "close",
  negatives: { total: 7, collections: 2, chargeOffs: 1, lates: 4, publicRecords: 0, repossessions: 0 }, derogBalance: 18263, pastDue: 18263,
  utilizationPct: 42, lenderUtilizationPct: 42, noOpenCard: true, inquiries: { last120d: 5, last12m: 5, sameDayMax: 4 },
  newAccount90d: { creditor: "SBNA", opened: "09/2026" },
  source: { vendor: "Xactus", reportId: "94944806", company: "STATEWIDE", requestedBy: "Angelina Angeles", ordered: "10/26/2026" },
  activeLoanFile: true, fileStrength: { now: 28, projected: 50 }, programTier: "standard", tradelineRecommended: true, estValueUsd: 2297,
  heatScore: 95, heatReasons: ["active_loan_file", "partner_referred"], quickWins: [{ key: "paid_collections", count: 2 }], quickWinsTotal: 2,
  nextAction: "call_partner_before_underwriting", scoreFactors: ["SERIOUS DELINQUENCY"], oldestAccountMonths: 74, thinFile: false,
  studentLoanBalance: 0, medicalCollections: { count: 0, balance: 0 }, addressCount: 3, statesSeen: ["CA", "FL", "TX"], lenderSimulation: null,
  ...o,
});

describe("lead credit insights UI", () => {
  beforeEach(() => apiGet.mockReset());

  it("panel card: heat, readiness, mortgage file, target, next action, history", async () => {
    const row = (id: number, middle: number, date: string) => ({ id, client_id: 5, credit_file_extraction_id: id, purpose: "analysis", report_date: date, created_at: `${date}T00:00:00Z`, insights: insights({ middleScore: middle }) });
    const body: LeadCreditInsightsResponse = { latest: row(2, 559, "2026-10-26"), history: [row(2, 559, "2026-10-26"), row(1, 540, "2026-08-01")] };
    apiGet.mockResolvedValue({ data: body });
    renderWithProviders(
      <Provider store={store}>
        <LeadCreditInsightsCard clientId={5} />
      </Provider>,
    );
    expect(await screen.findByTestId("lead-credit-insights")).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith("/admin/clients/5/credit-insights");
    expect(screen.getByText("95")).toBeTruthy();
    expect(screen.getByText(/Mortgage file · Angelina Angeles/)).toBeTruthy();
    expect(screen.getByText(/21 pts to 580/)).toBeTruthy();
    expect(screen.getByText(/Call the partner — file before underwriting/)).toBeTruthy();
    expect(screen.getByText(/2026-08-01 · 540/)).toBeTruthy();
  });

  it("panel card: empty state before the first read", async () => {
    apiGet.mockResolvedValue({ data: { latest: null, history: [] } });
    renderWithProviders(
      <Provider store={store}>
        <LeadCreditInsightsCard clientId={6} />
      </Provider>,
    );
    expect(await screen.findByText(/No credit report read yet/)).toBeTruthy();
  });

  it("prospect card chips: hidden without insights, shown with them", () => {
    const base = { id: 1, first_name: "A", last_name: "B", email: "a@b.c", created_at: "" } as Prospect;
    const { container } = renderWithProviders(<LeadInsightChips prospect={base} />);
    expect(container.textContent).toBe("");
    renderWithProviders(
      <LeadInsightChips prospect={{ ...base, insight_heat_score: 80, insight_readiness: "close", insight_middle_score: 559, insight_target_score: 580, insight_active_loan_file: 1, insight_est_value_usd: 2297 }} />,
    );
    const chips = screen.getByTestId("lead-insight-chips");
    expect(chips.textContent).toMatch(/80/);
    expect(chips.textContent).toMatch(/559 → 580/);
    expect(chips.textContent).toMatch(/Mortgage file/);
    expect(chips.textContent).toMatch(/~\$2,297/);
  });
});

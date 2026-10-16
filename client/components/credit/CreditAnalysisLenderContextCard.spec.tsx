import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { renderWithProviders } from "@/test/renderWithProviders";

const apiPatch = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, default: { ...actual.default, patch: (...a: unknown[]) => apiPatch(...a) } };
});

const { store } = await import("@/store");
const { CreditAnalysisLenderContextCard } = await import(
  "@/components/credit/CreditAnalysisLenderContextCard"
);

const ctx = (over = {}) => ({
  escrow: null,
  lender_score_model: null,
  lender_score: null,
  lender_target_score: null,
  ...over,
});

describe("CreditAnalysisLenderContextCard", () => {
  beforeEach(() => apiPatch.mockReset());

  it("switches escrow to 'In escrow' (true) and back to auto (null)", async () => {
    apiPatch.mockResolvedValueOnce({ data: { context: ctx({ escrow: true }) } });
    renderWithProviders(
      <Provider store={store}>
        <CreditAnalysisLenderContextCard analysisId={7001} />
      </Provider>,
    );
    expect(screen.getByTestId("escrow-auto").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("escrow-on"));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith("/admin/credit-analyses/7001/context", { escrow: true }));
    await waitFor(() => expect(screen.getByTestId("escrow-on").getAttribute("aria-checked")).toBe("true"));

    apiPatch.mockResolvedValueOnce({ data: { context: ctx({ escrow: null }) } });
    fireEvent.click(screen.getByTestId("escrow-auto"));
    await waitFor(() => expect(apiPatch).toHaveBeenLastCalledWith("/admin/credit-analyses/7001/context", { escrow: null }));
  });

  it("rejects an out-of-range lender score before saving", async () => {
    renderWithProviders(
      <Provider store={store}>
        <CreditAnalysisLenderContextCard analysisId={7002} />
      </Provider>,
    );
    fireEvent.change(screen.getByTestId("lender-score"), { target: { value: "99" } });
    fireEvent.submit(screen.getByTestId("lender-score").closest("form")!);
    await waitFor(() => expect(screen.getByText(/300|900/)).toBeTruthy());
    expect(apiPatch).not.toHaveBeenCalled();
  });
});

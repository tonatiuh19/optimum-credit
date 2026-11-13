import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import type { ReactElement } from "react";
import { renderWithProviders } from "@/test/renderWithProviders";

const apiPost = vi.fn();
const apiGet = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return {
    ...actual,
    default: { ...actual.default, post: (...a: unknown[]) => apiPost(...a), get: (...a: unknown[]) => apiGet(...a) },
  };
});

const { store } = await import("@/store");
const { SuspectedReadRows, collectSuspects } = await import("@/components/admin/report-approval/SuspectedReadRows");
const render = (ui: ReactElement) => renderWithProviders(<Provider store={store}>{ui}</Provider>);

const row = (o: Record<string, unknown> = {}) => ({
  bureau: "TU" as const, creditor: "AVANT LLC/WEB BANK", mask: "1", balance: 492, dateOpened: "07/22/2023", fragment: true, extraction_id: 77, side: "before" as const, ...o,
});
const checks = [
  { key: "account_totals", pass: false, detail: "Before TU: 27 accounts read, summary 25", suspects: [row(), row({ creditor: "AFFIRM INC", mask: "5YA5", balance: 355, fragment: false })] },
  { key: "balances", pass: false, detail: "Before TU: balances", suspects: [row()] },
  { key: "limits", pass: true, detail: "ok", suspects: [row({ creditor: "IGNORED BECAUSE PASSING" })] },
];

describe("SuspectedReadRows", () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiGet.mockReset().mockResolvedValue({ data: { items: [] } });
  });

  it("lists each suspect once, only from failing checks", () => {
    expect(collectSuspects(checks as any).map((r) => r.creditor)).toEqual(["AVANT LLC/WEB BANK", "AFFIRM INC"]);
    render(<SuspectedReadRows reportId={5} checks={checks as any} canEdit />);
    expect(screen.getAllByTestId("suspect-exclude")).toHaveLength(2);
    expect(screen.getByTestId("suspected-read-rows").textContent).not.toContain("IGNORED");
  });

  it("marks a row: posts the exact row, disables the button, refreshes", async () => {
    apiPost.mockResolvedValueOnce({ data: { ok: true, outcome: "ready", reason: null, round_report_id: 6 } });
    const onChanged = vi.fn();
    render(<SuspectedReadRows reportId={5} checks={checks as any} canEdit onChanged={onChanged} />);
    fireEvent.click(screen.getAllByTestId("suspect-exclude")[0]);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    // Passed and replaced: the card is told the new report id.
    expect(onChanged).toHaveBeenCalledWith(6);
    expect(apiPost).toHaveBeenCalledWith("/admin/round-reports/5/exclude-read", {
      extraction_id: 77, bureau: "TU", creditor: "AVANT LLC/WEB BANK", mask: "1", balance: 492, date_opened: "07/22/2023",
    });
    expect((screen.getAllByTestId("suspect-exclude")[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("a failed save does not mark the row", async () => {
    apiPost.mockRejectedValueOnce(new Error("boom"));
    const onChanged = vi.fn();
    render(<SuspectedReadRows reportId={5} checks={checks as any} canEdit onChanged={onChanged} />);
    fireEvent.click(screen.getAllByTestId("suspect-exclude")[1]);
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    await waitFor(() => expect((screen.getAllByTestId("suspect-exclude")[1] as HTMLButtonElement).disabled).toBe(false));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("staff who cannot approve see the rows but no buttons; no suspects → nothing", () => {
    const { unmount } = render(<SuspectedReadRows reportId={5} checks={checks as any} canEdit={false} />);
    expect(screen.getByTestId("suspected-read-rows")).toBeTruthy();
    expect(screen.queryByTestId("suspect-exclude")).toBeNull();
    unmount();
    render(<SuspectedReadRows reportId={5} checks={[{ key: "account_totals", pass: false, detail: "x" }] as any} canEdit />);
    expect(screen.queryByTestId("suspected-read-rows")).toBeNull();
  });

  it("still held after the save: no new id", async () => {
    apiPost.mockResolvedValueOnce({ data: { ok: true, outcome: "still_held", reason: null, round_report_id: 5 } });
    const onChanged = vi.fn();
    render(<SuspectedReadRows reportId={5} checks={checks as any} canEdit onChanged={onChanged} />);
    fireEvent.click(screen.getAllByTestId("suspect-exclude")[0]);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null));
  });
});

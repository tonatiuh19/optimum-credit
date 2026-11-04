import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { renderWithProviders } from "@/test/renderWithProviders";

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) } };
});

const { store } = await import("@/store");
const { FundingUnderwritingPanel } = await import("@/components/admin/FundingUnderwritingPanel");

describe("FundingUnderwritingPanel", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockImplementation(async (url: unknown) =>
      String(url).endsWith("/sensitive")
        ? { data: { ssn_masked: "***-**-6789", ein_masked: "**-***4321" } }
        : String(url).includes("/documents/")
          ? { data: new Blob(["%PDF"]) }
          : {
              data: {
                documents: [
                  { id: 11, doc_type: "funding_drivers_license", file_name: "license.pdf", file_size: 10, mime_type: "application/pdf", review_status: "pending", rejection_reason: null, uploaded_at: "2026-10-19" },
                ],
                notes: "",
              },
            },
    );
  });

  it("shows masked SSN/EIN and reveals on click (server-logged)", async () => {
    apiPost.mockResolvedValueOnce({ data: { field: "ssn", value: "123456789" } });
    renderWithProviders(
      <Provider store={store}>
        <FundingUnderwritingPanel applicationId={501} />
      </Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("funding-ssn").textContent).toBe("***-**-6789"));
    expect(screen.getByTestId("funding-ein").textContent).toBe("**-***4321");
    fireEvent.click(screen.getAllByRole("button", { name: /reveal|mostrar/i })[0]);
    await waitFor(() => expect(screen.getByTestId("funding-ssn").textContent).toBe("123456789"));
    expect(apiPost).toHaveBeenCalledWith("/admin/funding/501/sensitive/reveal", { field: "ssn" });
  });

  it("opens a document through the logged file endpoint", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    renderWithProviders(
      <Provider store={store}>
        <FundingUnderwritingPanel applicationId={502} />
      </Provider>,
    );
    fireEvent.click(await screen.findByTestId("funding-view-funding_drivers_license"));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith("/admin/funding/502/documents/11/file", { responseType: "blob" }));
    open.mockRestore();
  });
});

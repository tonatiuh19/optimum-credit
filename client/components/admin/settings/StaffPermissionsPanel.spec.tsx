import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { renderWithProviders } from "@/test/renderWithProviders";

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => apiGet(...a), put: (...a: unknown[]) => apiPut(...a) } };
});

const { store } = await import("@/store");
const { default: StaffPermissionsPanel } = await import("@/components/admin/settings/StaffPermissionsPanel");

const DATA = {
  permissions: { out_of_office_manager_ids: [1], holiday_greeting_approver_ids: [1, 2] },
  staff: [
    { id: 1, name: "Ana One", role: "super_admin" },
    { id: 2, name: "Ben Two", role: "super_admin" },
  ],
};
const chips = (name: string) => screen.getAllByRole("button", { name: new RegExp(name) });

describe("StaffPermissionsPanel", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
    apiGet.mockResolvedValue({ data: structuredClone(DATA) });
  });

  it("shows both lists with the selected people pressed", async () => {
    renderWithProviders(<Provider store={store}><StaffPermissionsPanel /></Provider>);
    await waitFor(() => expect(chips("Ben Two")).toHaveLength(2));
    const [oooBen, holidayBen] = chips("Ben Two");
    expect(oooBen.getAttribute("aria-pressed")).toBe("false");
    expect(holidayBen.getAttribute("aria-pressed")).toBe("true");
  });

  it("adding someone saves only that list", async () => {
    apiPut.mockResolvedValueOnce({ data: { permissions: { ...DATA.permissions, out_of_office_manager_ids: [1, 2] } } });
    renderWithProviders(<Provider store={store}><StaffPermissionsPanel /></Provider>);
    await waitFor(() => expect(chips("Ben Two")).toHaveLength(2));
    fireEvent.click(chips("Ben Two")[0]);
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith("/admin/settings/staff-permissions", { out_of_office_manager_ids: [1, 2] }));
    await waitFor(() => expect(chips("Ben Two")[0].getAttribute("aria-pressed")).toBe("true"));
  });

  it("will not remove the last person on a list", async () => {
    renderWithProviders(<Provider store={store}><StaffPermissionsPanel /></Provider>);
    await waitFor(() => expect(chips("Ana One")).toHaveLength(2));
    fireEvent.click(chips("Ana One")[0]);
    await new Promise((r) => setTimeout(r, 50));
    expect(apiPut).not.toHaveBeenCalled();
  });

  it("shows the server error when saving fails", async () => {
    apiPut.mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, data: { error: "Staff 2 is not active" } } });
    renderWithProviders(<Provider store={store}><StaffPermissionsPanel /></Provider>);
    await waitFor(() => expect(chips("Ben Two")).toHaveLength(2));
    fireEvent.click(chips("Ben Two")[0]);
    await waitFor(() => expect(apiPut).toHaveBeenCalled());
    expect(chips("Ben Two")[0].getAttribute("aria-pressed")).toBe("false");
  });
});

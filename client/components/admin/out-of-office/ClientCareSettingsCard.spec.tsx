import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CLIENT_CARE_DEFAULT_SETTINGS } from "@shared/clientCareTemplate";

// Radix Switch measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => apiGet(...a), put: (...a: unknown[]) => apiPut(...a) } };
});

const { store } = await import("@/store");
const { ClientCareSettingsCard } = await import("@/components/admin/out-of-office/ClientCareSettingsCard");

const load = (canEdit: boolean) =>
  apiGet.mockImplementation((url: string) =>
    Promise.resolve({
      data: url.includes("client-care")
        ? { settings: CLIENT_CARE_DEFAULT_SETTINGS, defaults: CLIENT_CARE_DEFAULT_SETTINGS, tokens: ["first_name"], can_edit: canEdit }
        : { mine: [], everyone: [], can_manage_others: canEdit, staff: [{ id: 90001, name: "Cesar Gomez", language_owner_for: null }] },
    }),
  );

describe("ClientCareSettingsCard", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPut.mockReset();
  });

  it("live preview renders the real text; an invalid template shows the error and blocks saving", async () => {
    load(true);
    renderWithProviders(<Provider store={store}><ClientCareSettingsCard /></Provider>);
    await waitFor(() => expect(screen.getByTestId("cc-preview-tpl_en_message").textContent).toMatch(/^Hi Maria! We got your message about your progress report\. Lecca \(English, 949-736-5644\) will reply/));
    fireEvent.change(screen.getByLabelText(/English — message/), { target: { value: "Hello there" } });
    await waitFor(() => expect(screen.getByTestId("cc-err-tpl_en_message").textContent).toMatch(/\{owner\} is required/));
    expect((screen.getByTestId("cc-save") as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves a valid change", async () => {
    load(true);
    apiPut.mockResolvedValueOnce({ data: { settings: { ...CLIENT_CARE_DEFAULT_SETTINGS, remind_after_min: 90 } } });
    renderWithProviders(<Provider store={store}><ClientCareSettingsCard /></Provider>);
    const input = await screen.findByLabelText(/Remind after/);
    fireEvent.change(input, { target: { value: "90" } });
    await waitFor(() => expect((screen.getByTestId("cc-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("cc-save"));
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith("/admin/client-care/settings", expect.objectContaining({ remind_after_min: 90 })));
  });

  it("read-only for staff who cannot edit", async () => {
    load(false);
    renderWithProviders(<Provider store={store}><ClientCareSettingsCard /></Provider>);
    await screen.findByTestId("client-care-settings");
    expect(screen.queryByTestId("cc-save")).toBeNull();
    expect((screen.getByLabelText(/English — message/) as HTMLTextAreaElement).disabled).toBe(true);
  });
});

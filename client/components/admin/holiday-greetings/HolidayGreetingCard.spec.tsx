import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { renderWithProviders } from "@/test/renderWithProviders";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, default: { ...actual.default, get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a), put: (...a: unknown[]) => apiPut(...a) } };
});

const { store } = await import("@/store");
const { fetchHolidayGreetings } = await import("@/store/slices/holidayGreetingsSlice");
const { HolidayGreetingCard } = await import("@/components/admin/holiday-greetings/HolidayGreetingCard");

const g = {
  id: 7, holiday_key: "thanksgiving" as const, label: { en: "Thanksgiving", es: "Día de Acción de Gracias" }, year: 2026, date: "2026-11-26",
  send_at: "2026-11-26 09:00:00", status: "draft" as const, body_en: "Happy Thanksgiving, {{first_name}}!", body_es: "¡Feliz Día de Acción de Gracias, {{first_name}}!",
  media_url: null, media_content_type: null, approved_by: null, approved_at: null, sent_at: null, stats: null,
};
const audience = { mode: "preview", count: 120, by_language: { en: 110, es: 10 }, skipped: { no_phone: 1, opted_out: 3, no_recent_text: 200, no_sender_line: 2 }, total_current_clients: 326, preview: { en: "Happy Thanksgiving, Maria!\nReply STOP to opt out.", es: "x" }, recipients: [] };

async function load(canApprove: boolean, status: "draft" | "approved" = "draft") {
  apiGet.mockImplementation((url: string) =>
    url.endsWith("/audience")
      ? Promise.resolve({ data: audience })
      : Promise.resolve({ data: { greetings: [{ ...g, status }], can_approve: canApprove, stop_footer: { en: "Reply STOP to opt out.", es: "Responde STOP para no recibir mensajes." } } }),
  );
  await store.dispatch(fetchHolidayGreetings());
  renderWithProviders(<Provider store={store}><HolidayGreetingCard g={{ ...g, status }} defaultOpen /></Provider>);
}

describe("HolidayGreetingCard", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
  });

  it("shows the audience with the STOP preview; an approver can approve", async () => {
    await load(true);
    await waitFor(() => expect(screen.getByTestId("holiday-audience").textContent).toContain("120"));
    expect(screen.getByTestId("holiday-audience").textContent).toContain("Reply STOP to opt out.");
    apiPost.mockResolvedValueOnce({ data: { greeting: { ...g, status: "approved", approved_by: "Cesar Gomez" } } });
    fireEvent.click(screen.getByTestId("holiday-approve"));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/admin/holiday-greetings/7/approve"));
  });

  it("no Approve button for staff who cannot approve", async () => {
    await load(false);
    expect(screen.queryByTestId("holiday-approve")).toBeNull();
  });

  it("unsaved edits block approval until saved", async () => {
    await load(true);
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Happy Thanksgiving!" } });
    await waitFor(() => expect((screen.getByTestId("holiday-approve") as HTMLButtonElement).disabled).toBe(true));
  });
});

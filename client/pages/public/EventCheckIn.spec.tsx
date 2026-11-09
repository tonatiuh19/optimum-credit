import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import EventCheckIn from "@/pages/public/EventCheckIn";

type State = Record<string, unknown>;
let state: State;
const dispatched: Array<{ type?: string; arg?: unknown }> = [];

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => (action: unknown) => {
    dispatched.push(typeof action === "function" ? { type: "thunk" } : (action as { type: string }));
    return Promise.resolve(action);
  },
  useAppSelector: (sel: (s: { eventMarketing: State }) => unknown) => sel({ eventMarketing: state }),
}));
vi.mock("@/components/PageMeta", () => ({ default: () => null }));
vi.mock("@/store/slices/eventMarketingSlice", () => ({
  fetchPublicCheckIn: (token: string) => ({ type: "fetchPublicCheckIn", arg: token }),
  resetPublicCheckIn: () => ({ type: "resetPublicCheckIn" }),
  submitPublicCheckIn: (arg: unknown) => ({ type: "submitPublicCheckIn", arg }),
}));

const info = {
  company: { slug: "ofy", name: "Options for Youth", name_es: null },
  session: { title_en: "Family Fun Night", title_es: "Noche Familiar", starts_at: "2026-11-12T17:00:00", location_en: "Chino", location_es: null },
  form_fields: [],
  window_open: true,
};

const base = (over: State = {}): State => ({
  checkInInfo: info,
  checkInLoading: false,
  checkInError: null,
  checkInSubmitting: false,
  checkInStatus: null,
  checkInSubmitError: null,
  ...over,
});

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={["/e/checkin/tok123"]}>
      <Routes>
        <Route path="/e/checkin/:token" element={<EventCheckIn />} />
      </Routes>
    </MemoryRouter>,
  );

describe("EventCheckIn (door QR)", () => {
  beforeEach(() => {
    dispatched.length = 0;
  });

  it("loads the session by token and checks in by phone", async () => {
    state = base();
    const user = userEvent.setup();
    renderPage();
    expect(dispatched).toContainEqual({ type: "fetchPublicCheckIn", arg: "tok123" });
    expect(screen.getByText("Family Fun Night")).toBeTruthy();
    await user.type(screen.getByLabelText(/phone/i), "123");
    await user.click(screen.getByRole("button", { name: /check me in/i }));
    expect(await screen.findByText(/valid 10-digit phone/i)).toBeTruthy();
    expect(dispatched.some((d) => d.type === "submitPublicCheckIn")).toBe(false);
    await user.clear(screen.getByLabelText(/phone/i));
    await user.type(screen.getByLabelText(/phone/i), "(909) 555-1234");
    await user.click(screen.getByRole("button", { name: /check me in/i }));
    expect(dispatched).toContainEqual({ type: "submitPublicCheckIn", arg: { token: "tok123", body: { phone: "(909) 555-1234" } } });
  });

  it("walk-in form requires names and sends answers", async () => {
    state = base({ checkInStatus: "needs_registration" });
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText(/didn't find your registration/i)).toBeTruthy();
    await user.type(screen.getByLabelText(/^phone$/i), "9095551234");
    await user.click(screen.getByRole("button", { name: /join and check in/i }));
    expect(dispatched.some((d) => d.type === "submitPublicCheckIn")).toBe(false);
    await user.type(screen.getByLabelText(/first name/i), "Maria");
    await user.type(screen.getByLabelText(/last name/i), "Lopez");
    await user.click(screen.getByRole("button", { name: /join and check in/i }));
    const sent = dispatched.find((d) => d.type === "submitPublicCheckIn") as { arg: { body: { answers: Record<string, string> } } };
    expect(sent.arg.body.answers).toMatchObject({ first_name: "Maria", last_name: "Lopez", phone: "9095551234", email: "" });
  });

  it("shows success, already-checked-in and closed states", () => {
    state = base({ checkInStatus: "checked_in" });
    const { unmount } = renderPage();
    expect(screen.getByTestId("checkin-done").textContent).toMatch(/checked in!/i);
    unmount();
    state = base({ checkInStatus: "already_checked_in" });
    const second = renderPage();
    expect(screen.getByTestId("checkin-done").textContent).toMatch(/already checked in/i);
    second.unmount();
    state = base({ checkInInfo: { ...info, window_open: false } });
    renderPage();
    expect(screen.getByText(/isn't open right now/i)).toBeTruthy();
  });

  it("bad link shows a friendly error", () => {
    state = base({ checkInInfo: null, checkInError: "Check-in not found." });
    renderPage();
    expect(screen.getByText(/link isn't valid/i)).toBeTruthy();
  });
});

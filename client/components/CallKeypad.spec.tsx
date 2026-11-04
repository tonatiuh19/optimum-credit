import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { renderWithProviders } from "@/test/renderWithProviders";

const apiPost = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, default: { ...actual.default, post: (...a: unknown[]) => apiPost(...a) } };
});

const { store } = await import("@/store");
const { resetThreeWay } = await import("@/store/slices/voiceSlice");
const { CallKeypad } = await import("@/components/CallKeypad");

describe("CallKeypad", () => {
  beforeEach(() => {
    apiPost.mockReset();
    store.dispatch(resetThreeWay());
  });

  it("sends DTMF on the live call (tap + keyboard) and shows what was sent", async () => {
    const call = { sendDigits: vi.fn() };
    renderWithProviders(
      <Provider store={store}>
        <CallKeypad call={call} />
      </Provider>,
    );
    fireEvent.click(screen.getByTestId("call-keypad-trigger"));
    fireEvent.click(await screen.findByTestId("call-keypad-1"));
    fireEvent.click(screen.getByTestId("call-keypad-#"));
    fireEvent.keyDown(window, { key: "0" });
    fireEvent.keyDown(window, { key: "a" }); // ignored
    expect(call.sendDigits.mock.calls.map((c) => c[0])).toEqual(["1", "#", "0"]);
    expect(screen.getByTestId("call-keypad-display").textContent).toBe("1#0");
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("routes keys through the server while a three-way call is active", async () => {
    const { startThreeWayCall } = await import("@/store/slices/voiceSlice");
    store.dispatch(
      startThreeWayCall.fulfilled(
        { session_id: 77, third_party: { label: "SmartCredit", number: "+18775550100" } } as never,
        "req",
        { callSid: "CA1", to: "+18775550100", label: "SmartCredit" },
      ),
    );
    expect(store.getState().voice.threeWay.status).toBe("active");
    const call = { sendDigits: vi.fn() };
    apiPost.mockResolvedValue({ data: { ok: true } });
    renderWithProviders(
      <Provider store={store}>
        <CallKeypad call={call} />
      </Provider>,
    );
    fireEvent.click(screen.getByTestId("call-keypad-trigger"));
    fireEvent.click(await screen.findByTestId("call-keypad-2"));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    expect(String(apiPost.mock.calls[0][0])).toMatch(/three-way/);
    expect(apiPost.mock.calls[0][1]).toMatchObject({ session_id: 77, digits: "2" });
    expect(call.sendDigits).not.toHaveBeenCalled();
  });
});

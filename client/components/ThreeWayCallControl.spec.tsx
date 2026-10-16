import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { renderWithProviders } from "@/test/renderWithProviders";

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      get: (...a: unknown[]) => apiGet(...a),
      post: (...a: unknown[]) => apiPost(...a),
    },
  };
});

const { store } = await import("@/store");
const { resetThreeWay } = await import("@/store/slices/voiceSlice");
const { ThreeWayCallControl } = await import("@/components/ThreeWayCallControl");

function renderControl(callSid: string | null = "CAstaff1") {
  return renderWithProviders(
    <Provider store={store}>
      <ThreeWayCallControl callSid={callSid} />
    </Provider>,
  );
}

describe("ThreeWayCallControl", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    store.dispatch(resetThreeWay());
    apiGet.mockResolvedValue({ data: { presets: [{ label: "SmartCredit", number: "+18775550100" }] } });
  });

  it("is disabled until the call is connected", () => {
    renderControl(null);
    expect((screen.getByTestId("three-way-trigger") as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects non-US numbers before calling the API", async () => {
    renderControl();
    await userEvent.click(screen.getByTestId("three-way-trigger"));
    await userEvent.type(screen.getByTestId("three-way-number"), "+52 33 1234 5678");
    await userEvent.click(screen.getByRole("button", { name: /call and add/i }));
    await waitFor(() => expect(screen.getByText(/valid US phone number/i)).toBeTruthy());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("adds a quick-dial caller, then shows the keypad and sends digits", async () => {
    apiPost.mockImplementation(async (url: string) => {
      if (url === "/voice/three-way/start") {
        return { data: { session_id: 7, status: "active", third_party: { label: "SmartCredit", number: "+18775550100" } } };
      }
      return { data: { ok: true } };
    });
    renderControl();
    await userEvent.click(screen.getByTestId("three-way-trigger"));
    await userEvent.click(await screen.findByRole("button", { name: "SmartCredit" }));
    expect(apiPost).toHaveBeenCalledWith(
      "/voice/three-way/start",
      { call_sid: "CAstaff1", to: "+18775550100", label: "SmartCredit" },
      expect.anything(),
    );
    await waitFor(() => expect(screen.getByText(/On the call with SmartCredit/)).toBeTruthy());
    fireEvent.click(screen.getByTestId("three-way-key-1"));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith(
        "/voice/three-way/digits",
        { session_id: 7, digits: "1" },
        expect.anything(),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: /remove smartcredit/i }));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/voice/three-way/remove", { session_id: 7 }, expect.anything()),
    );
    expect(store.getState().voice.threeWay.status).toBe("idle");
  });
});

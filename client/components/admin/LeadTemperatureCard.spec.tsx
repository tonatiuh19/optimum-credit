import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { renderWithProviders } from "@/test/renderWithProviders";

const apiPost = vi.fn();
const apiGet = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      post: (...a: unknown[]) => apiPost(...a),
      get: (...a: unknown[]) => apiGet(...a),
    },
  };
});

const { store } = await import("@/store");
const { LeadTemperatureCard } = await import("@/components/admin/LeadTemperatureCard");
const { LeadTemperatureBadge } = await import("@/components/admin/LeadTemperatureBadge");

describe("prospect traffic light UI", () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiGet.mockReset().mockResolvedValue({ data: { client: {} } });
  });

  it("badge shows the color with traffic-light tokens", () => {
    renderWithProviders(<LeadTemperatureBadge temperature="warm" />);
    const b = screen.getByTestId("lead-temp-warm");
    expect(b.textContent).toMatch(/Warm/);
    expect(b.className).toMatch(/text-warning/);
  });

  it("card shows the action + reasons and marks the analysis reviewed", async () => {
    apiPost.mockResolvedValue({
      data: { lead_temperature: "hot", lead_temperature_reasons: ["analysis_reviewed"], lead_temperature_at: null, analysis_reviewed_at: "2026-10-15T00:00:00Z", call_scheduled_at: null },
    });
    renderWithProviders(
      <Provider store={store}>
        <LeadTemperatureCard
          client={{ id: 9, lead_temperature: "warm", lead_temperature_reasons: "recent_reply" }}
        />
      </Provider>,
    );
    expect(screen.getByText(/Call to review the analysis/)).toBeTruthy();
    expect(screen.getByText(/replied in the last 14 days/)).toBeTruthy();
    await userEvent.click(screen.getByTestId("lead-analysis-reviewed"));
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith("/admin/clients/9/lead-signals", { analysis_reviewed: true }),
    );
  });
});

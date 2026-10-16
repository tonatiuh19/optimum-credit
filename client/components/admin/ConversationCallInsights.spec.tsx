import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import ConversationCallInsights from "@/components/admin/ConversationCallInsights";
import type { ConversationMessage } from "@shared/api";

vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: (sel: (s: { conversations: { retryCallInsightsId: null } }) => unknown) =>
    sel({ conversations: { retryCallInsightsId: null } }),
}));

function callMessage(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: 7125599,
    direction: "outbound",
    channel: "call",
    body: "",
    created_at: "2026-09-24T18:00:00.000Z",
    call_insights_status: "ready",
    call_transcript: "Alex asked if the fee is per round. It is one-time.",
    call_insights_json: {
      summary_bullets: ["Should not render this insight"],
      sentiment: { label: "hopeful", feelings: ["relieved"] },
      topics: ["pricing"],
      action_items: ["Send docs"],
    },
    ...overrides,
  };
}

describe("ConversationCallInsights", () => {
  it("keeps the transcript inside the collapse and hides insights", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ConversationCallInsights message={callMessage()} />,
    );

    expect(screen.getByTestId("call-transcript")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /transcript/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.queryByText(/Alex asked if the fee is per round/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Should not render this insight/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/pricing/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /transcript/i }));

    expect(screen.getByRole("button", { name: /transcript/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByText(/Alex asked if the fee is per round/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Should not render this insight/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Send docs/i)).not.toBeInTheDocument();
  });

  it("explains a missing transcript only after the collapse is opened", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ConversationCallInsights
        message={callMessage({
          call_transcript: null,
          call_insights_json: null,
          call_insights_status: "skipped",
          call_insights_error: "twilio_ai_addendum",
        })}
      />,
    );

    expect(
      screen.queryByText(/not enabled for this account/i),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /transcript/i }));
    expect(screen.getByText(/not enabled for this account/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /retry transcription/i }),
    ).toBeInTheDocument();
  });
});

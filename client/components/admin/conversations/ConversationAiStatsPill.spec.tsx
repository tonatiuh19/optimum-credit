import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ConversationAiStatsPill } from "@/components/admin/conversations/ConversationAiStatsPill";
import type { ConversationsAiStats } from "@shared/api";

let stats: ConversationsAiStats | null = null;
vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: (sel: (s: { conversations: { aiStats: ConversationsAiStats | null } }) => unknown) =>
    sel({ conversations: { aiStats: stats } }),
}));

const base: ConversationsAiStats = {
  days: 30,
  answered: 44,
  resolved: 17,
  escalated: 142,
  resolve_rate: 24,
  lookups: 9,
  callbacks: 3,
  escalated_by_reason: [
    { reason: "third_party", count: 12 },
    { reason: "reply_guard:unverified_date", count: 3 },
    { reason: "Some old free-text reason from before codes", count: 1 },
  ],
};

describe("ConversationAiStatsPill", () => {
  it("is hidden until there is data", () => {
    stats = { ...base, answered: 0, escalated: 0, resolve_rate: null };
    renderWithProviders(<ConversationAiStatsPill />);
    expect(screen.queryByTestId("conversations-ai-stats")).toBeNull();
  });

  it("shows the answered rate and explains where texts went", async () => {
    stats = base;
    const user = userEvent.setup();
    renderWithProviders(<ConversationAiStatsPill />);
    const pill = screen.getByTestId("conversations-ai-stats");
    expect(pill.textContent).toMatch(/24%/);
    await user.click(pill);
    expect(await screen.findByText("44")).toBeTruthy();
    expect(screen.getByText("142")).toBeTruthy();
    expect(screen.getByText(/9 live lookups/)).toBeTruthy();
    expect(screen.getByText(/3 callbacks/)).toBeTruthy();
    // Coded reasons get labels; "reply_guard:x" never breaks i18n; old free text falls back to "Other".
    expect(screen.getByText("About another person")).toBeTruthy();
    expect(screen.getByText("Reply blocked by safety check")).toBeTruthy();
    expect(screen.getByText("Other")).toBeTruthy();
  });
});

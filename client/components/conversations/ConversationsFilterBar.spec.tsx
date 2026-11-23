import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConversationsFilterBar } from "@/components/conversations/ConversationsFilterBar";
import { DEFAULT_FILTER_PREFS } from "@/lib/conversationsFilterPrefs";

describe("ConversationsFilterBar", () => {
  it("switches tabs and status, and shows unread badges", () => {
    const onChange = vi.fn();
    render(<ConversationsFilterBar prefs={DEFAULT_FILTER_PREFS} onChange={onChange} socialLive unread={{ sms: 3, social: 2 }} />);
    expect(screen.getByRole("tab", { name: /SMS.*3 unread/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByTestId("conversations-hub-social"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTER_PREFS, hub: "social" });
    fireEvent.click(screen.getByRole("tab", { name: "Closed" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTER_PREFS, status: "closed" });
  });

  it("echoes active filters as removable chips with a count on the Filters button", () => {
    const onChange = vi.fn();
    const prefs = { ...DEFAULT_FILTER_PREFS, hub: "social" as const, owner: "mine" as const, unread: true, platform: "instagram" as const };
    render(<ConversationsFilterBar prefs={prefs} onChange={onChange} socialLive unread={{ sms: 0, social: 0 }} />);
    expect(screen.getByTestId("conversations-filters-button").textContent).toContain("3");
    const chips = screen.getByTestId("conversations-active-filters");
    expect(chips.textContent).toContain("Me");
    expect(chips.textContent).toContain("Unread only");
    expect(chips.textContent).toContain("Instagram");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Unread only" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...prefs, unread: false });
  });

  it("hides status and filters on a locked Social tab", () => {
    render(<ConversationsFilterBar prefs={{ ...DEFAULT_FILTER_PREFS, hub: "social" }} onChange={() => {}} socialLive={false} unread={{ sms: 0, social: 0 }} />);
    expect(screen.queryByTestId("conversations-filters-button")).toBeNull();
  });
});

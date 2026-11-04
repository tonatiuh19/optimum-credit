import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { RoundDeliveryTimeline } from "@/components/admin/RoundDeliveryTimeline";

const round = {
  events: [
    { type: "opened" as const, at: "2026-10-21T01:40:00Z", open_count: 2, first_at: "2026-10-20T17:15:00Z" },
    { type: "send" as const, at: "2026-10-20T17:15:00Z", channel: "sms" as const, recipient_type: "client", to: "+12135550000", status: "undelivered", error: "30003" },
    { type: "send" as const, at: "2026-10-20T17:15:00Z", channel: "email" as const, recipient_type: "partner", recipient_name: "John Doe", recipient_role: "realtor_broker", to: "john@realty.com", status: "sent" },
    { type: "generated" as const, at: "2026-10-20T17:14:00Z", by: "Lecca B" },
  ],
  summary: { sends: 2, failed: 1, delivered: 0, recipients: 2, opened: 2, last_opened_at: "2026-10-21T01:40:00Z", last_sent_at: "2026-10-20T17:15:00Z" },
};

describe("RoundDeliveryTimeline", () => {
  it("status strip: sent to N, failed, opened N×", () => {
    renderWithProviders(<RoundDeliveryTimeline round={round} />);
    expect(screen.getByTestId("delivery-chip-sent").textContent).toMatch(/2/);
    expect(screen.getByTestId("delivery-chip-failed").textContent).toMatch(/1/);
    expect(screen.getByTestId("delivery-chip-opened").textContent).toMatch(/2/);
  });

  it("expands to a timeline with partner name, live status and error", () => {
    renderWithProviders(<RoundDeliveryTimeline round={round} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    const tl = screen.getByTestId("delivery-timeline");
    expect(tl.querySelectorAll("li")).toHaveLength(4);
    expect(tl.textContent).toMatch(/John Doe/);
    expect(tl.textContent).toMatch(/30003/);
    expect(tl.textContent).toMatch(/Lecca B/);
  });

  it("renders nothing without events", () => {
    const { container } = renderWithProviders(<RoundDeliveryTimeline round={undefined} />);
    expect(container.innerHTML).toBe("");
  });
});

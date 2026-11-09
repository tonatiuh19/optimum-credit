import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { EventResultsPanel } from "@/components/admin/events/EventResultsPanel";
import type { EventCompanyResults } from "@shared/api";

let results: EventCompanyResults | null = null;
vi.mock("@/store/hooks", () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: (sel: (s: unknown) => unknown) =>
    sel({ eventMarketing: { results, resultsLoading: false, resultsError: null } }),
}));

const row = {
  session_id: 1,
  title_en: "Family Fun Night — Chino",
  title_es: "Noche Familiar — Chino",
  starts_at: "2026-10-01T17:00:00",
  status: "completed" as const,
  capacity: null,
  registered: 20,
  waitlisted: 0,
  attended: 15,
  no_show: 5,
  new_contacts: 12,
  paid_clients: 2,
  revenue_cents: 99400,
};

describe("EventResultsPanel", () => {
  it("shows the funnel totals, show-up rate and revenue", () => {
    results = {
      totals: { registered: 20, waitlisted: 0, attended: 15, no_show: 5, new_contacts: 12, paid_clients: 2, revenue_cents: 99400 },
      sessions: [row, { ...row, session_id: null, title_en: "x", starts_at: null, status: null, registered: 1, attended: 0, no_show: 0, new_contacts: 1, paid_clients: 0, revenue_cents: 0 }],
    };
    renderWithProviders(<EventResultsPanel companyId={1} />);
    const panel = screen.getByTestId("event-results").textContent || "";
    expect(panel).toMatch(/75% show-up rate/i);
    expect(panel).toMatch(/\$994/);
    expect(panel).toMatch(/No session picked/);
    expect(panel).toMatch(/Family Fun Night — Chino/);
  });

  it("explains how to start when there are no sessions", () => {
    results = { totals: { registered: 0, waitlisted: 0, attended: 0, no_show: 0, new_contacts: 0, paid_clients: 0, revenue_cents: 0 }, sessions: [] };
    renderWithProviders(<EventResultsPanel companyId={1} />);
    expect(screen.getByText(/No sessions yet/i)).toBeTruthy();
  });
});

/**
 * GF-8 scorecard metric card: graded progress, lock gate, not-graded states
 * and the evidence list.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { MetricCard } from "@/components/productivity/MetricCard";
import { GradeRing } from "@/components/productivity/GradeRing";
import type { ProductivityMetric } from "@/store/slices/productivitySlice";

const metric = (o: Partial<ProductivityMetric>): ProductivityMetric => ({
  key: "daily_list",
  weight: 25,
  tier: "bronze",
  kind: "ratio",
  target: 1,
  done: 3,
  total: 4,
  score: 75,
  locked: false,
  graded: true,
  reason: null,
  evidence: [
    { label: "Maria Lopez · R2", done: true, at: "2026-10-23T18:00:00Z" },
    { label: "Review docs", done: false },
  ],
  ...o,
});

describe("MetricCard", () => {
  it("graded: score, weight, progress and evidence on demand", () => {
    renderWithProviders(<MetricCard m={metric({})} />);
    const card = screen.getByTestId("metric-daily_list");
    expect(card.textContent).toMatch(/Daily list contacted/);
    expect(card.textContent).toMatch(/75/);
    expect(card.textContent).toMatch(/25 pts/);
    expect(card.textContent).toMatch(/3 of 4 done/);
    expect(screen.queryByTestId("evidence-daily_list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /2 items/ }));
    expect(screen.getByTestId("evidence-daily_list").textContent).toMatch(/Maria Lopez · R2.*Review docs/);
  });

  it("locked: shows the level that unlocks it", () => {
    renderWithProviders(<MetricCard m={metric({ key: "call_notes", tier: "silver", locked: true, score: null, graded: false, reason: "locked" })} />);
    expect(screen.getByTestId("metric-call_notes").textContent).toMatch(/Unlocks at Silver/);
  });

  it("not graded: nothing pending / Slack not connected", () => {
    const { unmount } = renderWithProviders(<MetricCard m={metric({ score: null, total: null, graded: false, reason: "nothing_pending", evidence: [] })} />);
    expect(screen.getByTestId("metric-daily_list").textContent).toMatch(/Nothing pending — not graded/);
    unmount();
    renderWithProviders(<MetricCard m={metric({ key: "slack_report", score: null, total: null, graded: false, reason: "slack_not_connected", evidence: [] })} />);
    expect(screen.getByTestId("metric-slack_report").textContent).toMatch(/Slack not connected/);
  });
});

describe("GradeRing", () => {
  it("shows the grade and total", () => {
    renderWithProviders(<GradeRing total={91.5} grade="A" label="Today's grade A" />);
    const ring = screen.getByTestId("grade-ring");
    expect(ring.getAttribute("aria-label")).toBe("Today's grade A");
    expect(ring.textContent).toMatch(/A91\.5/);
  });
});

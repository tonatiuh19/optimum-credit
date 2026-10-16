import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ClientStageBadge } from "@/components/admin/ClientStageBadge";

describe("ClientStageBadge", () => {
  it("shows the real extended round (stored as round_5) with an Extended tag", () => {
    renderWithProviders(<ClientStageBadge stage="round_5" effectiveRound={12} />);
    const badge = screen.getByTestId("client-stage-badge");
    expect(badge.textContent).toMatch(/12/);
    expect(badge.textContent).not.toMatch(/5/);
    expect(badge.className).toMatch(/text-accent/);
    expect(screen.getByText(/extended|extendido/i)).toBeTruthy();
  });

  it("plain stages are unchanged (no Extended tag)", () => {
    renderWithProviders(<ClientStageBadge stage="round_5" effectiveRound={5} />);
    expect(screen.getByTestId("client-stage-badge").textContent).toBe("round 5");
    expect(screen.queryByText(/extended|extendido/i)).toBeNull();
  });

  it("other stages ignore effectiveRound", () => {
    renderWithProviders(<ClientStageBadge stage="new_client" effectiveRound={null} />);
    expect(screen.getByTestId("client-stage-badge").textContent).toBe("new client");
  });
});

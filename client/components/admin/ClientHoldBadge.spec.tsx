import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ClientHoldBadge } from "@/components/admin/ClientHoldBadge";

describe("ClientHoldBadge", () => {
  it("shows a destructive badge for blocked clients", () => {
    renderWithProviders(<ClientHoldBadge status="blocked" />);
    const badge = screen.getByTestId("client-hold-badge-blocked");
    expect(badge.className).toMatch(/text-destructive/);
  });

  it("shows a muted badge for paused clients", () => {
    renderWithProviders(<ClientHoldBadge status="paused" />);
    expect(screen.getByTestId("client-hold-badge-paused")).toBeTruthy();
  });

  it("renders nothing for working clients", () => {
    const { container } = renderWithProviders(
      <ClientHoldBadge status="active" />,
    );
    expect(container.querySelector("[data-testid^='client-hold-badge']")).toBeNull();
  });
});

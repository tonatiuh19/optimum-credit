import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ReportReviewFlags } from "@/components/admin/ReportReviewFlags";

describe("ReportReviewFlags", () => {
  it("separates blocking flags from internal notes", () => {
    renderWithProviders(
      <ReportReviewFlags
        flags={[
          { code: "parse_failure", message: "Parse failure: 0 accounts BEFORE / 12 AFTER." },
          { code: "internal_note", message: "New inquiries: US BANK TU 06/01/2026" },
        ]}
      />,
    );
    expect(screen.getByText(/Parse failure: 0 accounts/)).toBeTruthy();
    expect(screen.getByText(/New inquiries: US BANK/)).toBeTruthy();
    expect(screen.getByTestId("report-review-flags")).toBeTruthy();
  });

  it("shows a clean state when there are no flags", () => {
    renderWithProviders(<ReportReviewFlags flags={[]} />);
    expect(screen.getByTestId("report-flags-clean")).toBeTruthy();
  });
});

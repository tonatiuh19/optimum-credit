import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import PipelineFilterBar from "@/components/admin/PipelineFilterBar";
import { EMPTY_PIPELINE_FILTERS } from "@/lib/pipelineFilters";

const baseProps = {
  search: "",
  onSearchChange: vi.fn(),
  debouncedSearch: "",
  showFilters: false,
  onToggleFilters: vi.fn(),
  filters: EMPTY_PIPELINE_FILTERS,
  onFiltersChange: vi.fn(),
  activeFilterCount: 0,
  caseCount: 3,
  prospectCount: 1,
  packages: [{ id: 1, name: "Starter" }],
  team: [
    {
      id: 10,
      first_name: "Ada",
      last_name: "Admin",
      status: "active",
    },
  ],
  labels: [],
  showEmptyState: false,
};

describe("PipelineFilterBar", () => {
  it("updates search input", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    renderWithProviders(
      <PipelineFilterBar {...baseProps} onSearchChange={onSearchChange} />,
    );

    await user.type(
      screen.getByPlaceholderText(/Search name, email, phone/i),
      "CR-99",
    );
    expect(onSearchChange).toHaveBeenCalled();
    const last = onSearchChange.mock.calls[onSearchChange.mock.calls.length - 1]?.[0];
    expect(last).toContain("9");
  });

  it("toggles the filters panel", async () => {
    const user = userEvent.setup();
    const onToggleFilters = vi.fn();
    const { rerender } = renderWithProviders(
      <PipelineFilterBar
        {...baseProps}
        onToggleFilters={onToggleFilters}
        showFilters={false}
      />,
    );

    expect(screen.queryByTestId("pipeline-filters-panel")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Filters/i }));
    expect(onToggleFilters).toHaveBeenCalled();

    rerender(
      <PipelineFilterBar
        {...baseProps}
        onToggleFilters={onToggleFilters}
        showFilters
      />,
    );
    expect(screen.getByTestId("pipeline-filters-panel")).toBeInTheDocument();
  });

  it("emits language filter changes", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderWithProviders(
      <PipelineFilterBar
        {...baseProps}
        showFilters
        onFiltersChange={onFiltersChange}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText("Language", { exact: true }),
      "es",
    );
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...EMPTY_PIPELINE_FILTERS,
      language: "es",
    });
  });

  it("shows empty filtered state", () => {
    renderWithProviders(
      <PipelineFilterBar
        {...baseProps}
        caseCount={0}
        prospectCount={0}
        activeFilterCount={1}
        showEmptyState
      />,
    );
    expect(screen.getByTestId("pipeline-empty-filtered")).toHaveTextContent(
      /No cases match these filters/i,
    );
  });

  it("clears all filters from chip row", async () => {
    const user = userEvent.setup();
    const onFiltersChange = vi.fn();
    renderWithProviders(
      <PipelineFilterBar
        {...baseProps}
        showFilters={false}
        filters={{ ...EMPTY_PIPELINE_FILTERS, language: "es", billing: "overdue" }}
        activeFilterCount={2}
        onFiltersChange={onFiltersChange}
      />,
    );

    await user.click(screen.getByTestId("pipeline-clear-all"));
    expect(onFiltersChange).toHaveBeenCalledWith(EMPTY_PIPELINE_FILTERS);
  });
});

import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FundingType } from "@shared/api";

export interface FundingFilterState {
  funding_type: FundingType | "all";
  language: "en" | "es" | "all";
}

export const EMPTY_FUNDING_FILTERS: FundingFilterState = {
  funding_type: "all",
  language: "all",
};

export function countActiveFundingFilters(filters: FundingFilterState): number {
  let n = 0;
  if (filters.funding_type !== "all") n++;
  if (filters.language !== "all") n++;
  return n;
}

export interface FundingFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  debouncedSearch: string;
  showFilters: boolean;
  onToggleFilters: () => void;
  filters: FundingFilterState;
  onFiltersChange: (next: FundingFilterState) => void;
  activeFilterCount: number;
  totalCount: number;
  showEmptyState?: boolean;
}

export default function FundingFilterBar({
  search,
  onSearchChange,
  debouncedSearch,
  showFilters,
  onToggleFilters,
  filters,
  onFiltersChange,
  activeFilterCount,
  totalCount,
  showEmptyState = false,
}: FundingFilterBarProps) {
  const { t } = useTranslation();
  const filterSelectClass =
    "w-full h-9 pl-3 pr-7 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50";

  const clearAllFilters = () => onFiltersChange(EMPTY_FUNDING_FILTERS);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-0 w-full">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("adminFunding.searchPlaceholder")}
            aria-label={t("adminFunding.searchPlaceholder")}
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <button
          type="button"
          onClick={onToggleFilters}
          aria-expanded={showFilters}
          className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg border text-sm font-medium transition-colors ${
            showFilters || activeFilterCount > 0
              ? "bg-primary text-primary-foreground border-primary"
              : "border-input bg-background text-foreground hover:bg-muted"
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          {t("adminFunding.filters")}
          {activeFilterCount > 0 && (
            <span className="ml-0.5 h-5 min-w-5 px-1 rounded-full bg-primary-foreground/20 text-[11px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${showFilters ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {showFilters && (
        <div
          className="bg-card border border-border rounded-2xl p-5 space-y-4"
          data-testid="funding-filters-panel"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminFunding.fields.fundingType")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminFunding.fields.fundingType")}
                  value={filters.funding_type}
                  onChange={(e) =>
                    onFiltersChange({
                      ...filters,
                      funding_type: e.target.value as FundingFilterState["funding_type"],
                    })
                  }
                  className={filterSelectClass}
                >
                  <option value="all">{t("adminFunding.allTypes")}</option>
                  <option value="credit_card_stacking">
                    {t("adminFunding.types.credit_card_stacking")}
                  </option>
                  <option value="bank_statements">
                    {t("adminFunding.types.bank_statements")}
                  </option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminFunding.fields.language")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminFunding.fields.language")}
                  value={filters.language}
                  onChange={(e) =>
                    onFiltersChange({
                      ...filters,
                      language: e.target.value as FundingFilterState["language"],
                    })
                  }
                  className={filterSelectClass}
                >
                  <option value="all">{t("adminFunding.allLanguages")}</option>
                  <option value="en">English (EN)</option>
                  <option value="es">Español (ES)</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="h-9 px-4 rounded-lg border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors inline-flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" /> {t("adminFunding.clearAll")}
            </button>
          )}
        </div>
      )}

      {(activeFilterCount > 0 || !!debouncedSearch) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {t("adminFunding.resultsHint", { count: totalCount })}
          </span>
          {debouncedSearch && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted border border-border hover:bg-muted/80"
            >
              “{debouncedSearch}” <X className="w-3 h-3" />
            </button>
          )}
          {filters.funding_type !== "all" && (
            <button
              type="button"
              onClick={() =>
                onFiltersChange({ ...filters, funding_type: "all" })
              }
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15"
            >
              {t(`adminFunding.types.${filters.funding_type}`)}{" "}
              <X className="w-3 h-3" />
            </button>
          )}
          {filters.language !== "all" && (
            <button
              type="button"
              onClick={() => onFiltersChange({ ...filters, language: "all" })}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15"
            >
              {filters.language === "es" ? "Español" : "English"}{" "}
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {showEmptyState && (
        <div
          className="rounded-xl border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground"
          data-testid="funding-empty-filtered"
        >
          {t("adminFunding.emptyFiltered")}
        </div>
      )}
    </div>
  );
}

import {
  ChevronDown,
  CreditCard,
  FileText,
  Globe2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Label } from "@shared/api";
import { LabelMultiSelect } from "@/components/admin/LabelMultiSelect";
import EnumLegend from "@/components/admin/EnumLegend";
import {
  EMPTY_PIPELINE_FILTERS,
  type PipelineFilterState,
  pipelineFilterChipLabel,
} from "@/lib/pipelineFilters";

const STAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "prospect", label: "Prospect" },
  { value: "new_client", label: "New Client" },
  { value: "docs_ready", label: "Docs Verified" },
  { value: "round_1", label: "Round 1" },
  { value: "round_2", label: "Round 2" },
  { value: "round_3", label: "Round 3" },
  { value: "round_4", label: "Round 4" },
  { value: "round_5", label: "Round 5" },
  { value: "completed", label: "Completed" },
];

export interface PipelineFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  debouncedSearch: string;
  showFilters: boolean;
  onToggleFilters: () => void;
  filters: PipelineFilterState;
  onFiltersChange: (next: PipelineFilterState) => void;
  activeFilterCount: number;
  caseCount: number;
  prospectCount: number;
  packages: { id: number; name: string }[];
  team: { id: number; first_name: string; last_name: string; status: string }[];
  labels: Label[];
  showEmptyState?: boolean;
}

export default function PipelineFilterBar({
  search,
  onSearchChange,
  debouncedSearch,
  showFilters,
  onToggleFilters,
  filters,
  onFiltersChange,
  activeFilterCount,
  caseCount,
  prospectCount,
  packages,
  team,
  labels,
  showEmptyState = false,
}: PipelineFilterBarProps) {
  const { t } = useTranslation();
  const filterSelectClass =
    "w-full h-9 pl-3 pr-7 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50";

  const setFilter = <K extends keyof PipelineFilterState>(
    key: K,
    value: PipelineFilterState[K],
  ) => onFiltersChange({ ...filters, [key]: value });

  const clearFilter = (key: keyof PipelineFilterState) =>
    setFilter(key, key === "labels" ? ([] as string[]) : ("all" as never));

  const clearAllFilters = () => onFiltersChange(EMPTY_PIPELINE_FILTERS);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-0 w-full">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("adminPipeline.searchPlaceholder")}
            aria-label={t("adminPipeline.searchPlaceholder")}
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
          {t("adminPipeline.filters")}
          {activeFilterCount > 0 && (
            <span className="ml-0.5 h-5 min-w-5 px-1 rounded-full bg-white/20 text-[11px] font-bold flex items-center justify-center">
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
          data-testid="pipeline-filters-panel"
        >
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminPipeline.filterStage")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterStage")}
                  value={filters.stage}
                  onChange={(e) => setFilter("stage", e.target.value)}
                  className={filterSelectClass}
                >
                  <option value="all">{t("adminPipeline.allStages")}</option>
                  {STAGE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Globe2 className="w-3 h-3" /> {t("adminPipeline.filterLanguage")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterLanguage")}
                  value={filters.language}
                  onChange={(e) => setFilter("language", e.target.value)}
                  className={filterSelectClass}
                >
                  <option value="all">{t("adminPipeline.allLanguages")}</option>
                  <option value="en">English (EN)</option>
                  <option value="es">Spanish (ES)</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <CreditCard className="w-3 h-3" />{" "}
                {t("adminPipeline.filterBilling")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterBilling")}
                  value={filters.billing}
                  onChange={(e) => setFilter("billing", e.target.value)}
                  className={filterSelectClass}
                >
                  <option value="all">{t("adminPipeline.allBilling")}</option>
                  <option value="split_plan">Split plan</option>
                  <option value="overdue">Has overdue</option>
                  <option value="paid_full">Paid in full</option>
                  <option value="direct_paid">Direct paid</option>
                  <option value="no_payment">No payment</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
              <EnumLegend
                value={filters.billing !== "all" ? filters.billing : undefined}
                items={[
                  {
                    value: "split_plan",
                    label: "Split plan",
                    description: t("adminHelpers.billingFilter.split_plan"),
                  },
                  {
                    value: "overdue",
                    label: "Has overdue",
                    description: t("adminHelpers.billingFilter.overdue"),
                  },
                  {
                    value: "paid_full",
                    label: "Paid in full",
                    description: t("adminHelpers.billingFilter.paid_full"),
                  },
                  {
                    value: "direct_paid",
                    label: "Direct paid",
                    description: t("adminHelpers.billingFilter.direct_paid"),
                  },
                  {
                    value: "no_payment",
                    label: "No payment",
                    description: t("adminHelpers.billingFilter.no_payment"),
                  },
                ]}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminPipeline.filterPaymentBadge")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterPaymentBadge")}
                  value={filters.payment_badge}
                  onChange={(e) => setFilter("payment_badge", e.target.value)}
                  className={filterSelectClass}
                >
                  <option value="all">
                    {t("adminPipeline.allPaymentBadges")}
                  </option>
                  <option value="paid">{t("adminPipeline.paymentPaid")}</option>
                  <option value="unpaid">
                    {t("adminPipeline.paymentUnpaid")}
                  </option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminPipeline.filterPackage")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterPackage")}
                  value={filters.package_id}
                  onChange={(e) => setFilter("package_id", e.target.value)}
                  className={filterSelectClass}
                >
                  <option value="all">{t("adminPipeline.allPackages")}</option>
                  <option value="none">{t("adminPipeline.noPackage")}</option>
                  {packages.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminPipeline.filterOwner")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterOwner")}
                  value={filters.assigned_admin_id}
                  onChange={(e) =>
                    setFilter("assigned_admin_id", e.target.value)
                  }
                  className={filterSelectClass}
                >
                  <option value="all">{t("adminPipeline.allOwners")}</option>
                  <option value="unassigned">
                    {t("adminPipeline.unassignedOwner")}
                  </option>
                  {team
                    .filter((a) => a.status === "active")
                    .map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {a.first_name} {a.last_name}
                      </option>
                    ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminPipeline.filterReferral")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterReferral")}
                  value={filters.referral_category}
                  onChange={(e) =>
                    setFilter("referral_category", e.target.value)
                  }
                  className={filterSelectClass}
                >
                  <option value="all">{t("adminPipeline.allReferrals")}</option>
                  <option value="realtor_broker">Realtor / Broker</option>
                  <option value="one_off">One-off</option>
                  <option value="affiliate_partner">Affiliate partner</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminPipeline.leadTemp.filter")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.leadTemp.filter")}
                  value={filters.lead_temperature}
                  onChange={(e) => setFilter("lead_temperature", e.target.value)}
                  className={filterSelectClass}
                  data-testid="filter-lead-temperature"
                >
                  <option value="all">{t("adminPipeline.leadTemp.all")}</option>
                  {(["hot", "warm", "cold"] as const).map((c) => (
                    <option key={c} value={c}>
                      {t(`adminPipeline.leadTemp.color.${c}`)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminPipeline.filterClientStatus")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterClientStatus")}
                  value={filters.client_status}
                  onChange={(e) => setFilter("client_status", e.target.value)}
                  className={filterSelectClass}
                >
                  <option value="all">
                    {t("adminPipeline.allClientStatuses")}
                  </option>
                  {[
                    "prospect",
                    "funding",
                    "pending_payment",
                    "onboarding",
                    "active",
                    "paused",
                    "blocked",
                    "cancelled",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {t(`adminHelpers.clientStatus.${s}`, {
                        defaultValue: s.replace(/_/g, " "),
                      })}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminPipeline.filterCaseStatus")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterCaseStatus")}
                  value={filters.case_status}
                  onChange={(e) => setFilter("case_status", e.target.value)}
                  className={filterSelectClass}
                >
                  <option value="all">
                    {t("adminPipeline.allCaseStatuses")}
                  </option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="on_hold">On hold</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminPipeline.filterTasks")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterTasks")}
                  value={filters.tasks}
                  onChange={(e) => setFilter("tasks", e.target.value)}
                  className={filterSelectClass}
                >
                  <option value="all">{t("adminPipeline.allTasks")}</option>
                  <option value="incomplete">
                    {t("adminPipeline.tasksIncomplete")}
                  </option>
                  <option value="complete">
                    {t("adminPipeline.tasksComplete")}
                  </option>
                  <option value="pending_review">
                    {t("adminPipeline.tasksPendingReview")}
                  </option>
                  <option value="rejected">
                    {t("adminPipeline.tasksRejected")}
                  </option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminPipeline.filterInfoRequests")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterInfoRequests")}
                  value={filters.info_requests}
                  onChange={(e) => setFilter("info_requests", e.target.value)}
                  className={filterSelectClass}
                >
                  <option value="all">
                    {t("adminPipeline.allInfoRequests")}
                  </option>
                  <option value="open">{t("adminPipeline.infoOpen")}</option>
                  <option value="none">{t("adminPipeline.infoNone")}</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> {t("adminPipeline.filterNotes")}
              </label>
              <div className="relative">
                <select
                  aria-label={t("adminPipeline.filterNotes")}
                  value={filters.has_notes}
                  onChange={(e) => setFilter("has_notes", e.target.value)}
                  className={filterSelectClass}
                >
                  <option value="all">{t("adminPipeline.allNotes")}</option>
                  <option value="yes">{t("adminPipeline.hasNotes")}</option>
                  <option value="no">{t("adminPipeline.noNotes")}</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminPipeline.filterLabels")}
              </label>
              <LabelMultiSelect
                labels={labels}
                selected={filters.labels}
                onChange={(slugs) => setFilter("labels", slugs)}
                placeholder={t("adminPipeline.filterLabels")}
              />
            </div>

            {activeFilterCount > 0 && (
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="h-9 px-4 rounded-lg border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors flex items-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" /> {t("adminPipeline.clearAll")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {(activeFilterCount > 0 || !!debouncedSearch) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {t("adminPipeline.resultsHint", {
              cases: caseCount,
              prospects: prospectCount,
            })}
          </span>
          {activeFilterCount > 0 && (
            <button
              type="button"
              data-testid="pipeline-clear-all"
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-destructive/30 text-destructive hover:bg-destructive/5"
            >
              {t("adminPipeline.clearAll")} <X className="w-3 h-3" />
            </button>
          )}
          {debouncedSearch && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted border border-border hover:bg-muted/80"
            >
              “{debouncedSearch}” <X className="w-3 h-3" />
            </button>
          )}
          {activeFilterCount > 0 &&
            (
              Object.keys(EMPTY_PIPELINE_FILTERS) as Array<
                keyof PipelineFilterState
              >
            )
              .filter((k) =>
                k === "labels"
                  ? filters.labels.length > 0
                  : filters[k] !== "all",
              )
              .map((k) => {
                const pkg =
                  k === "package_id" &&
                  filters.package_id !== "all" &&
                  filters.package_id !== "none"
                    ? packages.find((p) => String(p.id) === filters.package_id)
                    : undefined;
                const owner =
                  k === "assigned_admin_id" &&
                  filters.assigned_admin_id !== "all" &&
                  filters.assigned_admin_id !== "unassigned"
                    ? team.find(
                        (a) => String(a.id) === filters.assigned_admin_id,
                      )
                    : undefined;
                const label = pipelineFilterChipLabel(k, filters, {
                  t,
                  packageName: pkg?.name,
                  ownerName: owner
                    ? `${owner.first_name} ${owner.last_name}`
                    : undefined,
                });
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => clearFilter(k)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15"
                  >
                    {label} <X className="w-3 h-3" />
                  </button>
                );
              })}
        </div>
      )}

      {showEmptyState && (
        <div
          className="rounded-xl border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground"
          data-testid="pipeline-empty-filtered"
        >
          {t("adminPipeline.emptyFiltered")}
        </div>
      )}
    </div>
  );
}

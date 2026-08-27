import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Banknote,
  CheckCircle2,
  Circle,
  Loader2,
  Plus,
  RefreshCw,
  UserPlus,
  X,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import FieldHint from "@/components/admin/FieldHint";
import FundingFilterBar, {
  EMPTY_FUNDING_FILTERS,
  countActiveFundingFilters,
  type FundingFilterState,
} from "@/components/admin/FundingFilterBar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClientSearchPicker } from "@/components/ui/client-search-picker";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminFundingDetail,
  convertFundingApplication,
  createAdminFundingApplication,
  fetchFundingApplication,
  fetchFundingApplications,
  fetchMoreFundingColumn,
  setFundingApplicationStatus,
} from "@/store/slices/fundingSlice";
import type {
  AdminClientListItem,
  AdminFundingQuery,
  FundingApplication,
  FundingApplicationStatus,
  FundingDocSlot,
  FundingType,
} from "@shared/api";
import { FUNDING_REQUIRED_DOC_SLOTS } from "@shared/api";
import { cn } from "@/lib/utils";

const BOARD_COLUMNS: FundingApplicationStatus[] = [
  "awaiting_docs",
  "submitted",
  "under_review",
  "complete",
  "converted",
];

const STATUS_ACTIONS: FundingApplicationStatus[] = [
  "awaiting_docs",
  "submitted",
  "under_review",
  "complete",
  "converted",
  "cancelled",
];

function formatWhen(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function DocChecklist({
  uploaded,
}: {
  uploaded?: FundingDocSlot[];
}) {
  const { t } = useTranslation();
  const set = new Set(uploaded || []);
  return (
    <ul className="space-y-1.5">
      {FUNDING_REQUIRED_DOC_SLOTS.map((slot) => {
        const ok = set.has(slot);
        const labelKey = slot.replace("funding_", "");
        return (
          <li
            key={slot}
            className="flex items-center gap-2 text-sm text-foreground"
          >
            {ok ? (
              <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
            ) : (
              <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <span className={ok ? "" : "text-muted-foreground"}>
              {t(`adminFunding.docs.${labelKey}`, {
                defaultValue: labelKey.replace(/_/g, " "),
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function FundingDetailSheet({
  open,
  onClose,
  onBoardRefresh,
}: {
  open: boolean;
  onClose: () => void;
  onBoardRefresh?: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { adminDetail, adminDetailLoading, adminDetailError, adminActionLoading } =
    useAppSelector((s) => s.funding);

  const app = adminDetail;

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto p-0"
      >
        <div className="sticky top-0 z-10 bg-card border-b border-border px-5 py-4 flex items-start justify-between gap-3">
          <SheetTitle className="text-base font-semibold pr-6">
            {app
              ? `${app.first_name} ${app.last_name}`
              : t("adminFunding.detailTitle")}
          </SheetTitle>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-secondary"
            aria-label={t("adminFunding.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {adminDetailLoading && !app ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : null}

          {adminDetailError ? (
            <p className="text-sm text-destructive">{adminDetailError}</p>
          ) : null}

          {app ? (
            <>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full bg-primary/10 text-primary">
                  {t(`adminFunding.status.${app.status}`)}
                </span>
                <span className="inline-flex text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full bg-secondary text-muted-foreground">
                  {t(`adminFunding.types.${app.funding_type}`)}
                </span>
              </div>

              <dl className="grid grid-cols-1 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("adminFunding.fields.email")}
                  </dt>
                  <dd className="font-medium break-all">{app.email}</dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("adminFunding.fields.phone")}
                    </dt>
                    <dd>{app.phone || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("adminFunding.fields.language")}
                    </dt>
                    <dd>{app.preferred_language?.toUpperCase()}</dd>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("adminFunding.fields.postalCode")}
                    </dt>
                    <dd>{app.postal_code || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("adminFunding.fields.state")}
                    </dt>
                    <dd>{app.state || "—"}</dd>
                  </div>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("adminFunding.fields.llcName")}
                  </dt>
                  <dd>{app.llc_name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("adminFunding.fields.llcAddress")}
                  </dt>
                  <dd className="whitespace-pre-wrap">{app.llc_address || "—"}</dd>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("adminFunding.fields.ssn")}
                    </dt>
                    <dd>
                      {app.has_secrets
                        ? t("adminFunding.secretPresent")
                        : t("adminFunding.secretAbsent")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("adminFunding.fields.ein")}
                    </dt>
                    <dd>
                      {app.has_secrets
                        ? t("adminFunding.secretPresent")
                        : t("adminFunding.secretAbsent")}
                    </dd>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <dt>{t("adminFunding.fields.created")}</dt>
                    <dd>{formatWhen(app.created_at)}</dd>
                  </div>
                  <div>
                    <dt>{t("adminFunding.fields.submitted")}</dt>
                    <dd>{formatWhen(app.submitted_at)}</dd>
                  </div>
                </div>
              </dl>

              <div>
                <h3 className="text-sm font-semibold mb-2">
                  {t("adminFunding.docsTitle")}
                </h3>
                <DocChecklist uploaded={app.docs_uploaded} />
                {app.docs_complete ? (
                  <p className="text-xs text-accent mt-2 font-medium">
                    {t("adminFunding.docsComplete")}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {t("adminFunding.statusActions")}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {STATUS_ACTIONS.filter((s) => s !== app.status).map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={adminActionLoading}
                      onClick={() =>
                        void dispatch(
                          setFundingApplicationStatus({
                            id: app.id,
                            status: s,
                          }),
                        ).then(() => onBoardRefresh?.())
                      }
                    >
                      {t(`adminFunding.status.${s}`)}
                    </Button>
                  ))}
                </div>
              </div>

              {app.status !== "converted" && app.status !== "cancelled" ? (
                <Button
                  type="button"
                  className="w-full"
                  disabled={adminActionLoading}
                  onClick={() =>
                    void dispatch(convertFundingApplication(app.id)).then(() =>
                      onBoardRefresh?.(),
                    )
                  }
                >
                  {adminActionLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <UserPlus className="w-4 h-4 mr-2" />
                  )}
                  {t("adminFunding.convert")}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const MANUAL_CREATE_STATUSES: FundingApplicationStatus[] = [
  "awaiting_docs",
  "submitted",
  "under_review",
  "complete",
];

const FUNDING_TYPES: FundingType[] = [
  "credit_card_stacking",
  "bank_statements",
];

function KanbanCard({
  app,
  onOpen,
}: {
  app: FundingApplication;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const docsCount = app.docs_uploaded?.length ?? 0;
  const docsTotal = FUNDING_REQUIRED_DOC_SLOTS.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left bg-card border border-border rounded-xl p-3 shadow-sm hover:border-primary/40 hover:shadow-md transition-all"
    >
      <div className="font-semibold text-sm text-foreground truncate">
        {app.first_name} {app.last_name}
      </div>
      <div className="text-xs text-muted-foreground truncate mt-0.5">
        {app.email}
      </div>
      <div className="flex items-center justify-between mt-2 gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
          {t(`adminFunding.types.${app.funding_type}`)}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {t("adminFunding.docsProgress", {
            count: docsCount,
            total: docsTotal,
          })}
        </span>
      </div>
    </button>
  );
}

function NewFundingModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (app: FundingApplication) => void;
}) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { adminActionLoading } = useAppSelector((s) => s.funding);

  const [selectedClient, setSelectedClient] =
    useState<AdminClientListItem | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fundingType, setFundingType] =
    useState<FundingType>("credit_card_stacking");
  const [preferredLanguage, setPreferredLanguage] = useState<"en" | "es">("en");
  const [status, setStatus] =
    useState<FundingApplicationStatus>("awaiting_docs");

  const resetForm = () => {
    setSelectedClient(null);
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setFundingType("credit_card_stacking");
    setPreferredLanguage("en");
    setStatus("awaiting_docs");
  };

  const handleClientChange = (client: AdminClientListItem | null) => {
    setSelectedClient(client);
    if (!client) return;
    setFirstName(client.first_name || "");
    setLastName(client.last_name || "");
    setEmail(client.email || "");
    setPhone(client.phone || "");
    if (client.preferred_language === "es") setPreferredLanguage("es");
    else if (client.preferred_language === "en") setPreferredLanguage("en");
  };

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    if (!firstName.trim() || !lastName.trim() || !trimmedEmail) {
      toast({
        title: t("adminFunding.createRequiredTitle"),
        description: t("adminFunding.createRequiredBody"),
        variant: "destructive",
      });
      return;
    }
    try {
      const app = await dispatch(
        createAdminFundingApplication({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: trimmedEmail,
          phone: phone.trim() || undefined,
          funding_type: fundingType,
          preferred_language: preferredLanguage,
          status,
          client_id: selectedClient?.id,
        }),
      ).unwrap();
      toast({ title: t("adminFunding.createSuccessTitle") });
      onCreated?.(app);
      onClose();
      resetForm();
    } catch (e: unknown) {
      toast({
        title: t("adminFunding.createErrorTitle"),
        description:
          (typeof e === "string" ? e : (e as Error)?.message) ??
          t("adminFunding.createErrorBody"),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          resetForm();
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-w-lg w-full bg-card border-border p-0 gap-0 overflow-hidden [&>button:last-child]:hidden"
        data-testid="new-funding-modal"
      >
        <DialogTitle className="px-6 pt-6 pb-4 text-base font-bold text-foreground border-b border-border">
          {t("adminFunding.newApplication")}
        </DialogTitle>
        <div className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {t("adminFunding.clientLabel")}
            </label>
            <ClientSearchPicker
              value={selectedClient}
              onChange={handleClientChange}
              placeholder={t("adminFunding.clientSearchPlaceholder")}
            />
            <FieldHint>{t("adminFunding.newApplicationClientHint")}</FieldHint>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminFunding.fields.firstName")}
              </label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminFunding.fields.lastName")}
              </label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {t("adminFunding.fields.email")}
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {t("adminFunding.fields.phone")}
            </label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminFunding.fields.fundingType")}
              </label>
              <Select
                value={fundingType}
                onValueChange={(v) => setFundingType(v as FundingType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FUNDING_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`adminFunding.types.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("adminFunding.fields.language")}
              </label>
              <Select
                value={preferredLanguage}
                onValueChange={(v) =>
                  setPreferredLanguage(v as "en" | "es")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {t("adminFunding.fields.initialStatus")}
            </label>
            <Select
              value={status}
              onValueChange={(v) =>
                setStatus(v as FundingApplicationStatus)
              }
            >
              <SelectTrigger data-testid="new-funding-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_CREATE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`adminFunding.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldHint>{t("adminFunding.newApplicationStatusHint")}</FieldHint>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              resetForm();
              onClose();
            }}
          >
            {t("adminFunding.cancel")}
          </Button>
          <Button
            type="button"
            disabled={adminActionLoading}
            onClick={() => void handleSubmit()}
          >
            {adminActionLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            {t("adminFunding.createApplication")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminFunding() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    adminList,
    adminColumns,
    adminListLoading,
    adminListError,
    adminLoadingMore,
    adminPageLimit,
  } = useAppSelector((s) => s.funding);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNewFunding, setShowNewFunding] = useState(false);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] =
    useState<FundingFilterState>(EMPTY_FUNDING_FILTERS);
  const debouncedSearch = useDebounce(search, 300);

  const fundingQuery = useMemo((): AdminFundingQuery => {
    const q: AdminFundingQuery = {};
    if (debouncedSearch) q.search = debouncedSearch;
    if (filters.funding_type !== "all") q.funding_type = filters.funding_type;
    if (filters.language !== "all") q.language = filters.language;
    return q;
  }, [debouncedSearch, filters]);

  const reloadBoard = useCallback(() => {
    void dispatch(fetchFundingApplications(fundingQuery));
  }, [dispatch, fundingQuery]);

  useEffect(() => {
    reloadBoard();
  }, [reloadBoard]);

  const activeFilterCount = countActiveFundingFilters(filters);

  const byStatus = useMemo(() => {
    const map: Record<string, FundingApplication[]> = {};
    const hasColumnData = Object.keys(adminColumns).length > 0;
    for (const col of BOARD_COLUMNS) {
      if (hasColumnData) {
        map[col] = adminColumns[col]?.items ?? [];
      } else {
        map[col] = [];
      }
    }
    if (!hasColumnData) {
      for (const app of adminList) {
        if (map[app.status]) map[app.status].push(app);
        else if (app.status === "draft") map.awaiting_docs.push(app);
      }
    }
    return map;
  }, [adminColumns, adminList]);

  const totalCount = useMemo(
    () =>
      BOARD_COLUMNS.reduce(
        (sum, col) => sum + (adminColumns[col]?.total ?? byStatus[col]?.length ?? 0),
        0,
      ),
    [adminColumns, byStatus],
  );

  const loadMoreColumn = (column: string, shown: number) => {
    const page = adminColumns[column];
    if (!page?.has_more || adminLoadingMore) return;
    void dispatch(
      fetchMoreFundingColumn({
        ...fundingQuery,
        column,
        offset: shown,
        limit: adminPageLimit || 20,
      }),
    );
  };

  const showBoardSkeleton =
    adminListLoading && adminList.length === 0 && totalCount === 0;

  const openDetail = (id: number) => {
    setSelectedId(id);
    void dispatch(fetchFundingApplication(id));
  };

  const closeDetail = () => {
    setSelectedId(null);
    dispatch(clearAdminFundingDetail());
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Banknote}
        title={t("adminFunding.title")}
        description={t("adminFunding.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowNewFunding(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 px-3 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />{" "}
              {t("adminFunding.newApplication")}
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={adminListLoading}
              onClick={reloadBoard}
            >
              <RefreshCw
                className={cn(
                  "w-4 h-4 mr-1.5",
                  adminListLoading && "animate-spin",
                )}
              />
              {t("adminFunding.refresh")}
            </Button>
          </div>
        }
      />

      {adminListError ? (
        <p className="text-sm text-destructive">{adminListError}</p>
      ) : null}

      <FundingFilterBar
        search={search}
        onSearchChange={setSearch}
        debouncedSearch={debouncedSearch}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((v) => !v)}
        filters={filters}
        onFiltersChange={setFilters}
        activeFilterCount={activeFilterCount}
        totalCount={totalCount}
        showEmptyState={
          (activeFilterCount > 0 || !!debouncedSearch) &&
          totalCount === 0 &&
          !adminListLoading
        }
      />

      <div
        className={cn(
          "overflow-x-auto -mx-1 px-1 pb-2 transition-opacity",
          adminListLoading && !showBoardSkeleton ? "opacity-60" : "",
        )}
      >
        {showBoardSkeleton ? (
          <div className="flex gap-3 min-w-max lg:min-w-0 lg:grid lg:grid-cols-5">
            {BOARD_COLUMNS.map((col) => (
              <div
                key={col}
                className="w-[260px] lg:w-auto shrink-0 bg-secondary/40 rounded-2xl border border-border p-3 space-y-2"
              >
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-20 w-full rounded-xl" />
                <Skeleton className="h-20 w-full rounded-xl" />
              </div>
            ))}
          </div>
        ) : (
        <div className="flex gap-3 min-w-max lg:min-w-0 lg:grid lg:grid-cols-5">
          {BOARD_COLUMNS.map((col) => {
            const colApps = byStatus[col] ?? [];
            const colPage = adminColumns[col];
            const colTotal = colPage?.total ?? colApps.length;
            return (
            <div
              key={col}
              className="w-[260px] lg:w-auto shrink-0 bg-secondary/40 rounded-2xl border border-border p-3 space-y-2 flex flex-col"
            >
              <div className="flex items-center justify-between px-1 mb-1">
                <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t(`adminFunding.status.${col}`)}
                </h2>
                <span className="text-[10px] font-semibold bg-card border border-border rounded-full px-1.5 py-0.5 text-muted-foreground tabular-nums">
                  {colTotal}
                </span>
              </div>

              <div className="space-y-2 flex-1">
              {colApps.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  {t("adminFunding.emptyColumn")}
                </p>
              ) : (
                colApps.map((app) => (
                  <KanbanCard
                    key={app.id}
                    app={app}
                    onOpen={() => openDetail(app.id)}
                  />
                ))
              )}
              </div>

              {colPage?.has_more ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={adminLoadingMore === col}
                  onClick={() => loadMoreColumn(col, colApps.length)}
                >
                  {adminLoadingMore === col ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : null}
                  {t("adminFunding.loadMore", {
                    shown: colApps.length,
                    total: colTotal,
                  })}
                </Button>
              ) : null}
            </div>
          );
          })}
        </div>
        )}
      </div>

      <FundingDetailSheet
        open={selectedId != null}
        onClose={closeDetail}
        onBoardRefresh={reloadBoard}
      />

      <NewFundingModal
        open={showNewFunding}
        onClose={() => setShowNewFunding(false)}
        onCreated={(app) => {
          reloadBoard();
          setSelectedId(app.id);
          void dispatch(fetchFundingApplication(app.id));
        }}
      />
    </div>
  );
}

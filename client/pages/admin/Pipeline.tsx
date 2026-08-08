import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Workflow,
  X,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Lock,
  Clock,
  ArrowRight,
  ArrowDown,
  RefreshCw,
  Plus,
  UserPlus,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPipeline,
  updateCaseStage,
  createAdminCase,
  fetchAdminTeam,
} from "@/store/slices/adminSlice";
import { fetchLabels } from "@/store/slices/prospectsSlice";
import type {
  CreditRepairCase,
  PipelineStage,
  AdminClientListItem,
  Prospect,
  RoundScheduleInput,
} from "@shared/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
import { LangBadge } from "@/components/ui/lang-badge";
import { LabelChips } from "@/components/admin/LabelChips";
import FieldHint from "@/components/admin/FieldHint";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import InstallmentDraftFields, {
  emptyInstallmentDraft,
  draftToCreateSplitPayload,
  type InstallmentDraft,
} from "@/components/admin/InstallmentDraftFields";
import RoundCalendarScheduleFields, {
  emptyRoundScheduleInput,
} from "@/components/admin/RoundCalendarScheduleFields";
import ConvertProspectDialog from "@/components/admin/ConvertProspectDialog";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { ClientPanelSheet } from "@/components/admin/ClientPanelSheet";
import { buildStageChangeConfirmMessage } from "@/lib/pipelineStage";
import { fetchPackages } from "@/store/slices/packagesSlice";
import { useDebounce } from "@/hooks/use-debounce";
import {
  EMPTY_PIPELINE_FILTERS,
  buildAdminPipelineQuery,
  countActivePipelineFilters,
} from "@/lib/pipelineFilters";
import { buildNewCaseCreatePayload } from "@/lib/newCasePayload";
import PipelineFilterBar from "@/components/admin/PipelineFilterBar";
import PipelineBoardSkeleton from "@/components/admin/PipelineBoardSkeleton";

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS: {
  stage: PipelineStage;
  label: string;
  topBorder: string;
  accent: string;
  countBg: string;
}[] = [
  {
    stage: "new_client",
    label: "New Client",
    topBorder: "border-t-primary",
    accent: "text-primary",
    countBg: "bg-primary/10 text-primary",
  },
  {
    stage: "docs_ready",
    label: "Docs Verified",
    topBorder: "border-t-accent",
    accent: "text-accent",
    countBg: "bg-accent/10 text-accent",
  },
  {
    stage: "round_1",
    label: "Round 1",
    topBorder: "border-t-primary/70",
    accent: "text-primary/80",
    countBg: "bg-primary/8 text-primary/80",
  },
  {
    stage: "round_2",
    label: "Round 2",
    topBorder: "border-t-primary/80",
    accent: "text-primary/90",
    countBg: "bg-primary/10 text-primary/90",
  },
  {
    stage: "round_3",
    label: "Round 3",
    topBorder: "border-t-primary",
    accent: "text-primary",
    countBg: "bg-primary/10 text-primary",
  },
  {
    stage: "round_4",
    label: "Round 4",
    topBorder: "border-t-primary/90",
    accent: "text-primary/95",
    countBg: "bg-primary/12 text-primary",
  },
  {
    stage: "round_5",
    label: "Round 5",
    topBorder: "border-t-primary",
    accent: "text-primary",
    countBg: "bg-primary/15 text-primary",
  },
  {
    stage: "completed",
    label: "Completed",
    topBorder: "border-t-accent",
    accent: "text-accent",
    countBg: "bg-accent/10 text-accent",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(d: string) {
  return Math.floor(
    (Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24),
  );
}
function formatCaseId(id: number) {
  return `#CR-${String(id).padStart(5, "0")}`;
}
function canMoveToDocsReady(c: CreditRepairCase) {
  const required = c.tasks_required_total ?? 0;
  return required > 0 && (c.tasks_approved ?? 0) >= required;
}
/** Case cards can move to any real stage (subject to docs_ready gating) but never back onto the Prospect column. */
function isCaseDragAllowed(
  targetStage: string,
  client: CreditRepairCase | null,
) {
  if (!client) return false;
  if (targetStage === "prospect") return false;
  if (targetStage === "docs_ready") return canMoveToDocsReady(client);
  return true;
}
/** Prospect cards are only droppable on New Client — that's what converts them into a real case. */
function isProspectDragAllowed(targetStage: string) {
  return targetStage === "new_client";
}

// ─── KanbanCard ───────────────────────────────────────────────────────────────

function KanbanCard({
  client,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  client: CreditRepairCase;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const isPaid =
    client.client_status === "onboarding" || client.client_status === "active";
  const tasksApproved = client.tasks_approved ?? 0;
  const tasksPending = client.tasks_pending_review ?? 0;
  const tasksRejected = client.tasks_rejected ?? 0;
  const tasksRequired = client.tasks_required_total ?? 0;
  const tasksTotal = client.tasks_total ?? 0;
  const siblingCases = client.sibling_active_cases ?? 0;
  const infoOpen = client.info_requests_open ?? 0;
  const infoPending = client.info_requests_pending_review ?? 0;
  const days = daysSince(client.created_at);
  const initials =
    `${client.first_name?.[0] ?? ""}${client.last_name?.[0] ?? ""}`.toUpperCase();
  const pct =
    tasksRequired > 0
      ? Math.min((tasksApproved / tasksRequired) * 100, 100)
      : 0;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", `case:${client.id}`);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="group select-none rounded-xl bg-card border border-border
                 hover:border-primary/30 hover:shadow-md hover:shadow-primary/8
                 cursor-grab active:cursor-grabbing active:opacity-60
                 transition-all duration-150 shadow-sm overflow-hidden"
    >
      {/* Top progress strip */}
      <div className="h-[3px] bg-muted">
        <div
          className={`h-full transition-all duration-500 ${
            tasksRequired > 0 && tasksApproved >= tasksRequired
              ? "bg-accent"
              : tasksRejected > 0
                ? "bg-destructive"
                : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="p-3.5">
        {/* Avatar + name row */}
        <div className="flex items-start gap-2.5 mb-2.5">
          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 leading-tight">
              <span className="font-semibold text-[13px] text-foreground truncate">
                {client.first_name} {client.last_name}
              </span>
              <LangBadge lang={client.preferred_language} />
            </div>
            <div className="text-[11px] text-muted-foreground truncate mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="truncate">
                {client.package_name || "No package"}
              </span>
              {siblingCases > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 shrink-0 text-[9px] font-semibold text-destructive"
                  title="Onboarding tasks are shared per client — duplicate active cases"
                >
                  <AlertCircle className="w-2.5 h-2.5" />+{siblingCases}
                </span>
              )}
              {(infoOpen > 0 || infoPending > 0) && (
                <span
                  className="inline-flex items-center gap-0.5 shrink-0 text-[9px] font-semibold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full"
                  title="Open or pending info requests"
                >
                  {infoPending > 0
                    ? `${infoPending} review`
                    : `${infoOpen} info`}
                </span>
              )}
            </div>
          </div>
          {isPaid ? (
            <span className="text-[9px] font-bold bg-accent/10 text-accent border border-accent/25 px-1.5 py-0.5 rounded-full shrink-0 leading-tight">
              Paid
            </span>
          ) : (
            <span className="text-[9px] font-bold bg-muted text-muted-foreground border border-border px-1.5 py-0.5 rounded-full shrink-0 leading-tight">
              Unpaid
            </span>
          )}
        </div>

        {/* Tasks progress */}
        {tasksTotal > 0 ? (
          <div className="mb-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground font-medium">
                {tasksApproved}/{tasksRequired} tasks
              </span>
              <div className="flex gap-2">
                {tasksPending > 0 && (
                  <span className="text-primary font-medium">
                    {tasksPending} pending
                  </span>
                )}
                {tasksRejected > 0 && (
                  <span
                    className="text-destructive font-medium"
                    title={
                      siblingCases > 0
                        ? "Task status is shared across all cases for this client"
                        : undefined
                    }
                  >
                    {tasksRejected} rejected
                  </span>
                )}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  tasksRequired > 0 && tasksApproved >= tasksRequired
                    ? "bg-accent"
                    : tasksRejected > 0
                      ? "bg-destructive"
                      : "bg-primary"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="mb-2.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <Clock className="w-3 h-3" />
            Awaiting tasks
          </div>
        )}

        {/* Labels */}
        <LabelChips labels={client.labels} max={3} className="mb-2" />

        {/* Footer row */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-mono font-semibold text-primary/70">
            {client.case_number}
          </span>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-primary font-semibold flex items-center gap-0.5">
            Open <ArrowRight className="w-2.5 h-2.5" />
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── ProspectKanbanCard ───────────────────────────────────────────────────────

function ProspectKanbanCard({
  prospect,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  prospect: Prospect;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const initials =
    `${prospect.first_name?.[0] ?? ""}${prospect.last_name?.[0] ?? ""}`.toUpperCase();

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", `prospect:${prospect.id}`);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="group select-none rounded-xl bg-card border border-dashed border-accent/40
                 hover:border-accent hover:shadow-md hover:shadow-accent/10
                 cursor-grab active:cursor-grabbing active:opacity-60
                 transition-all duration-150 shadow-sm overflow-hidden"
    >
      <div className="h-[3px] bg-accent/40" />
      <div className="p-3.5">
        <div className="flex items-start gap-2.5 mb-2.5">
          <div className="w-8 h-8 rounded-full bg-accent/10 border border-accent/25 flex items-center justify-center text-[11px] font-bold text-accent shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 leading-tight">
              <span className="font-semibold text-[13px] text-foreground truncate">
                {prospect.first_name} {prospect.last_name}
              </span>
              <LangBadge lang={prospect.preferred_language} />
            </div>
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
              {prospect.email}
            </div>
          </div>
        </div>

        {prospect.client_goal && (
          <p className="text-[11px] text-muted-foreground line-clamp-2 mb-2.5">
            {prospect.client_goal}
          </p>
        )}

        <LabelChips labels={prospect.labels} max={3} className="mb-2" />

        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="uppercase tracking-wide font-semibold text-accent/80">
            {prospect.case_number
              ? prospect.case_number
              : (prospect.source_label ?? "prospect").replace(/_/g, " ")}
          </span>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-accent font-semibold flex items-center gap-0.5">
            Open <ArrowRight className="w-2.5 h-2.5" />
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── NewCaseModal ──────────────────────────────────────────────────────────────

function NewCaseModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [selectedClient, setSelectedClient] =
    useState<AdminClientListItem | null>(null);
  const [packageName, setPackageName] = useState("");
  const [stage, setStage] = useState<PipelineStage>("new_client");
  const [splits, setSplits] = useState<InstallmentDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [roundSchedule, setRoundSchedule] = useState<RoundScheduleInput>(
    emptyRoundScheduleInput(),
  );

  const isProspectStage = stage === "prospect";

  const addSplit = () =>
    setSplits((prev) => [...prev, emptyInstallmentDraft(prev.length + 1)]);

  const removeSplit = (i: number) =>
    setSplits((prev) => prev.filter((_, idx) => idx !== i));

  const hasIncompleteSplit = splits.some(
    (s) => (!!s.amount.trim()) !== (!!s.due_date.trim()),
  );

  const resetForm = () => {
    setSelectedClient(null);
    setPackageName("");
    setStage("new_client");
    setSplits([]);
    setRoundSchedule(emptyRoundScheduleInput());
  };

  const handleStageChange = (next: PipelineStage) => {
    setStage(next);
    // Clear picker when switching between prospect-only and clients-only modes
    if (next === "prospect" && selectedClient?.status !== "prospect") {
      setSelectedClient(null);
    }
    if (next !== "prospect" && selectedClient?.status === "prospect") {
      setSelectedClient(null);
    }
  };

  const handleClientChange = (client: AdminClientListItem | null) => {
    if (!client) {
      setSelectedClient(null);
      return;
    }
    if (isProspectStage && client.status !== "prospect") {
      toast({
        title: t("adminPipeline.newCaseNeedProspectTitle"),
        description: t("adminPipeline.newCaseNeedProspectBody"),
        variant: "destructive",
      });
      return;
    }
    if (!isProspectStage && client.status === "prospect") {
      toast({
        title: t("adminPipeline.newCaseProspectBlockedTitle"),
        description: t("adminPipeline.newCaseProspectBlockedBody"),
        variant: "destructive",
      });
      return;
    }
    setSelectedClient(client);
  };

  const handleSubmit = async () => {
    if (!selectedClient) {
      toast({
        title: isProspectStage
          ? t("adminPipeline.selectProspectRequired")
          : t("adminPipeline.selectClientRequired"),
        variant: "destructive",
      });
      return;
    }
    if (isProspectStage && selectedClient.status !== "prospect") {
      toast({
        title: t("adminPipeline.newCaseNeedProspectTitle"),
        description: t("adminPipeline.newCaseNeedProspectBody"),
        variant: "destructive",
      });
      return;
    }
    if (!isProspectStage && selectedClient.status === "prospect") {
      toast({
        title: t("adminPipeline.newCaseProspectBlockedTitle"),
        description: t("adminPipeline.newCaseProspectBlockedBody"),
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      await dispatch(
        createAdminCase(
          buildNewCaseCreatePayload({
            stage,
            clientId: selectedClient.id,
            packageName,
            splits,
            roundSchedule,
          }),
        ),
      ).unwrap();
      toast({
        title: isProspectStage
          ? t("adminPipeline.prospectCaseCreatedTitle")
          : t("adminPipeline.caseCreatedTitle"),
      });
      onCreated?.();
      onClose();
      resetForm();
    } catch (e: any) {
      toast({
        title: t("adminPipeline.convertErrorTitle"),
        description:
          (typeof e === "string" ? e : e?.message) ??
          t("adminPipeline.convertErrorBody"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Match API: New Case may only start at Prospect or New Client.
  const STAGES: PipelineStage[] = ["prospect", "new_client"];

  const stageLabel = (s: PipelineStage) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          resetForm();
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-w-lg w-full bg-card border-border p-0 gap-0 overflow-hidden [&>button:last-child]:hidden"
        data-testid="new-case-modal"
      >
        <DialogTitle className="px-6 pt-6 pb-4 text-base font-bold text-foreground border-b border-border">
          {t("adminPipeline.newCase")}
        </DialogTitle>
        <div className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {t("adminPipeline.pipelineStage")}
            </label>
            <Select
              value={stage}
              onValueChange={(v) => handleStageChange(v as PipelineStage)}
            >
              <SelectTrigger data-testid="new-case-stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {stageLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isProspectStage ? (
              <FieldHint>{t("adminPipeline.newCaseProspectStageHint")}</FieldHint>
            ) : (
              <FieldHint>{t("adminPipeline.newCaseNewClientHint")}</FieldHint>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              {isProspectStage
                ? t("adminPipeline.prospectLabel")
                : t("adminPipeline.clientLabel")}
            </label>
            <ClientSearchPicker
              key={isProspectStage ? "prospects" : "clients"}
              value={selectedClient}
              onChange={handleClientChange}
              excludeProspects={!isProspectStage}
              prospectsOnly={isProspectStage}
              placeholder={
                isProspectStage
                  ? t("adminPipeline.prospectSearchPlaceholder")
                  : t("adminPipeline.clientSearchPlaceholder")
              }
            />
            <FieldHint>
              {isProspectStage
                ? t("adminPipeline.newCaseProspectClientHint")
                : t("adminPipeline.newCaseClientHint")}
            </FieldHint>
          </div>

          {/* Prospect stage: only pick the lead — package, calendar, splits on convert */}
          {!isProspectStage && (
            <div data-testid="new-case-full-fields">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("adminPipeline.packageNotesLabel")}
                </label>
                <Input
                  placeholder={t("adminPipeline.packageNotesPlaceholder")}
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                />
                <FieldHint>{t("adminPipeline.newCasePackageNote")}</FieldHint>
              </div>

              <div className="space-y-2 mt-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t("adminPipeline.paymentScheduleOptional")}
                  </label>
                  <button
                    type="button"
                    onClick={addSplit}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />{" "}
                    {t("adminPipeline.addInstallment")}
                  </button>
                </div>
                {splits.map((s, i) => (
                  <InstallmentDraftFields
                    key={i}
                    draft={s}
                    onChange={(next) =>
                      setSplits((prev) =>
                        prev.map((row, idx) => (idx === i ? next : row)),
                      )
                    }
                    onRemove={() => removeSplit(i)}
                  />
                ))}
                {hasIncompleteSplit && (
                  <FieldHint tone="warning">
                    {t("adminPipeline.splitIncomplete")}
                  </FieldHint>
                )}
              </div>

              <div className="mt-4">
                <RoundCalendarScheduleFields
                  value={roundSchedule}
                  onChange={setRoundSchedule}
                  disabled={loading}
                  compact
                />
              </div>

              <div className="mt-4">
                <FieldHint>{t("adminPipeline.newCaseNoEmail")}</FieldHint>
              </div>
            </div>
          )}
          {isProspectStage && (
            <div data-testid="new-case-prospect-minimal" className="hidden" />
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <Button
            variant="outline"
            onClick={() => {
              resetForm();
              onClose();
            }}
            disabled={loading}
          >
            {t("adminPipeline.convertCancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !selectedClient}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {isProspectStage
              ? t("adminPipeline.createProspectCase")
              : t("adminPipeline.createCase")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminPipeline() {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { pipelineCases, team, pipelineLoading } = useAppSelector((s) => s.admin);
  const { prospects, labels } = useAppSelector((s) => s.prospects);
  const { packages } = useAppSelector((s) => s.packages);
  const [searchParams, setSearchParams] = useSearchParams();

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelCaseId, setPanelCaseId] = useState<number | null>(null);
  const [panelClientId, setPanelClientId] = useState<number | null>(null);

  const [showNewCase, setShowNewCase] = useState(false);
  const [convertingProspect, setConvertingProspect] = useState<Prospect | null>(
    null,
  );

  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(EMPTY_PIPELINE_FILTERS);
  const debouncedSearch = useDebounce(search, 300);

  const [dragging, setDragging] = useState<
    { type: "case"; id: number } | { type: "prospect"; id: number } | null
  >(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<{
    caseId: number;
    from: PipelineStage;
    to: PipelineStage;
    clientName: string;
    openInfoRequests: number;
  } | null>(null);

  const pipelineQuery = useMemo(
    () => buildAdminPipelineQuery(debouncedSearch, filters),
    [debouncedSearch, filters],
  );

  const reloadPipeline = useCallback(() => {
    dispatch(fetchPipeline(pipelineQuery));
  }, [dispatch, pipelineQuery]);

  const activeFilterCount = countActivePipelineFilters(filters);

  useEffect(() => {
    dispatch(fetchLabels());
    dispatch(fetchAdminTeam({}));
    if (packages.length === 0) dispatch(fetchPackages());
  }, [dispatch]);

  useEffect(() => {
    reloadPipeline();
  }, [reloadPipeline]);

  // Auto-open panel when navigated from another page with ?client=ID
  useEffect(() => {
    const clientParam = searchParams.get("client");
    if (!clientParam) return;
    const clientId = Number(clientParam);
    if (isNaN(clientId) || clientId <= 0) return;

    const matchedCase = pipelineCases.find((c) => c.client_id === clientId);
    if (matchedCase) {
      setPanelCaseId(matchedCase.id);
      setPanelClientId(matchedCase.client_id);
      setPanelOpen(true);
      setSearchParams({}, { replace: true });
      return;
    }

    const matchedProspect = prospects.find((p) => p.id === clientId);
    if (matchedProspect) {
      setPanelCaseId(matchedProspect.case_id ?? null);
      setPanelClientId(matchedProspect.id);
      setPanelOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, pipelineCases, prospects, setSearchParams]);

  // Panel
  const openPanel = (caseId: number, clientId: number) => {
    setPanelCaseId(caseId);
    setPanelClientId(clientId);
    setPanelOpen(true);
  };
  const closePanel = () => {
    setPanelOpen(false);
    setPanelCaseId(null);
    setPanelClientId(null);
  };

  // Drag
  const draggingCase =
    dragging?.type === "case"
      ? (pipelineCases.find((c) => c.id === dragging.id) ?? null)
      : null;
  const draggingProspect =
    dragging?.type === "prospect"
      ? (prospects.find((p) => p.id === dragging.id) ?? null)
      : null;

  const canDropOnStage = (stage: string): boolean => {
    if (!dragging) return false;
    if (dragging.type === "case") return isCaseDragAllowed(stage, draggingCase);
    return isProspectDragAllowed(stage);
  };

  const onCaseDragStart = (caseId: number) =>
    setDragging({ type: "case", id: caseId });
  const onProspectDragStart = (id: number) =>
    setDragging({ type: "prospect", id });
  const onDragEnd = () => {
    setDragging(null);
    setDragOverStage(null);
  };
  const onDragOver = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    setDragOverStage(stage);
    e.dataTransfer.dropEffect = canDropOnStage(stage) ? "move" : "none";
  };
  const onDrop = async (e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/plain");
    const [dragType, rawId] = raw.split(":");
    const id = Number(rawId);
    setDragging(null);
    setDragOverStage(null);

    // ── Prospect card → only droppable on New Client (converts the prospect) ──
    if (dragType === "prospect") {
      if (!isProspectDragAllowed(stage)) return;
      const prospect = prospects.find((p) => p.id === id);
      if (prospect) setConvertingProspect(prospect);
      return;
    }

    // ── Case card → any real stage change ──
    const kase = pipelineCases.find((c) => c.id === id);
    if (!kase || !isCaseDragAllowed(stage, kase)) {
      if (stage === "docs_ready")
        setStageError(
          "Cannot move to Docs Verified — all required tasks must be approved first.",
        );
      return;
    }
    const openInfo =
      (kase.info_requests_open ?? 0) +
      (kase.info_requests_pending_review ?? 0);
    setStageError(null);
    setPendingDrop({
      caseId: id,
      from: kase.pipeline_stage,
      to: stage,
      clientName: `${kase.first_name} ${kase.last_name}`,
      openInfoRequests: openInfo,
    });
  };

  const confirmPendingDrop = async () => {
    if (!pendingDrop) return;
    await dispatch(
      updateCaseStage({ caseId: pendingDrop.caseId, stage: pendingDrop.to }),
    );
    reloadPipeline();
    setPendingDrop(null);
  };

  // Grouped
  const grouped = COLUMNS.reduce<Record<string, CreditRepairCase[]>>(
    (acc, c) => {
      acc[c.stage] = pipelineCases.filter(
        (cl) => cl.pipeline_stage === c.stage,
      );
      return acc;
    },
    {},
  );

  return (
    <div className="flex flex-col space-y-5">
      <AdminPageHeader
        icon={Workflow}
        title={t("adminPipeline.title")}
        description={t("adminPipeline.description")}
        badge={
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent bg-accent/10 border border-accent/20 px-2.5 py-1 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5" /> AES-256
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNewCase(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-primary hover:bg-primary/90 px-3 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> {t("adminPipeline.newCase")}
            </button>
            <button
              onClick={reloadPipeline}
              disabled={pipelineLoading}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-card border border-border hover:border-border/80 px-3 py-2 rounded-lg transition-colors disabled:opacity-60"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${pipelineLoading ? "animate-spin" : ""}`}
              />{" "}
              {t("adminPipeline.refresh")}
            </button>
          </div>
        }
      />

      <PipelineFilterBar
        search={search}
        onSearchChange={setSearch}
        debouncedSearch={debouncedSearch}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((v) => !v)}
        filters={filters}
        onFiltersChange={setFilters}
        activeFilterCount={activeFilterCount}
        caseCount={pipelineCases.length}
        prospectCount={prospects.length}
        packages={packages}
        team={team}
        labels={labels}
        showEmptyState={
          (activeFilterCount > 0 || !!debouncedSearch) &&
          pipelineCases.length === 0 &&
          prospects.length === 0
        }
      />

      {stageError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {stageError}
          <button
            onClick={() => setStageError(null)}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Kanban — skeleton on initial load and Refresh */}
      {pipelineLoading ? (
        <PipelineBoardSkeleton />
      ) : (
      <div className="table-scroll pb-4 -mx-1 px-1 max-w-full">
        <div className="flex gap-3 w-max min-w-full pr-2">
          {/* ── Prospect column (virtual — pre-conversion leads) ── */}
          {(() => {
            const isDragTarget = dragOverStage === "prospect";
            const canDrop = dragging ? canDropOnStage("prospect") : false;
            return (
              <div
                onDragOver={(e) => onDragOver(e, "prospect")}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={(e) => onDrop(e, "prospect" as PipelineStage)}
                className={[
                  "w-[min(280px,calc(100vw-2.5rem))] sm:w-[270px] shrink-0 flex flex-col rounded-2xl border-t-[3px] border-t-accent overflow-hidden transition-all duration-200",
                  isDragTarget && canDrop
                    ? "shadow-xl shadow-accent/15 md:scale-[1.015] ring-1 ring-accent/30"
                    : isDragTarget && !canDrop
                      ? "ring-1 ring-destructive/40 shadow-lg shadow-destructive/10"
                      : "shadow-sm",
                  "bg-card border border-border",
                ].join(" ")}
              >
                <div className="px-3.5 py-2.5 border-b border-border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <UserPlus className="w-3 h-3 text-accent" />
                      <h3 className="font-bold text-[11px] uppercase tracking-[0.1em] text-accent">
                        Prospect
                      </h3>
                    </div>
                    <span
                      className={`min-w-[20px] h-5 flex items-center justify-center text-[10px] font-bold px-1.5 rounded-md ${
                        prospects.length > 0
                          ? "bg-accent/10 text-accent"
                          : "text-muted-foreground/40 bg-muted"
                      }`}
                    >
                      {prospects.length}
                    </span>
                  </div>
                </div>
                <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-230px)] min-h-[120px] bg-muted/30">
                  {prospects.map((p) => (
                    <ProspectKanbanCard
                      key={p.id}
                      prospect={p}
                      onDragStart={() => onProspectDragStart(p.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => {
                        if (p.case_id) {
                          openPanel(p.case_id, p.id);
                          return;
                        }
                        // Lead without a prospect-stage case yet — open client panel
                        setPanelCaseId(null);
                        setPanelClientId(p.id);
                        setPanelOpen(true);
                      }}
                    />
                  ))}
                  {prospects.length === 0 && (
                    <div className="h-20 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border/40">
                      {isDragTarget && canDrop ? (
                        <>
                          <ArrowDown className="w-3.5 h-3.5 text-accent/50" />
                          <span className="text-[10px] text-accent/50 font-medium">
                            Drop here
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40 font-medium">
                          No prospects
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {COLUMNS.map((col) => {
            const colCases = grouped[col.stage] ?? [];
            const isDragTarget = dragOverStage === col.stage;
            const canDrop = canDropOnStage(col.stage);
            const prospectDropTarget =
              col.stage === "new_client" && dragging?.type === "prospect";
            return (
              <div
                key={col.stage}
                onDragOver={(e) => onDragOver(e, col.stage)}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={(e) => onDrop(e, col.stage as PipelineStage)}
                className={[
                  "w-[min(280px,calc(100vw-2.5rem))] sm:w-[270px] shrink-0 flex flex-col rounded-2xl border-t-[3px] overflow-hidden transition-all duration-200",
                  col.topBorder,
                  isDragTarget && canDrop
                    ? prospectDropTarget
                      ? "shadow-xl shadow-accent/20 md:scale-[1.015] ring-1 ring-accent/40"
                      : "shadow-xl shadow-primary/15 md:scale-[1.015] ring-1 ring-primary/30"
                    : isDragTarget && !canDrop
                      ? "ring-1 ring-destructive/40 shadow-lg shadow-destructive/10"
                      : "shadow-sm",
                  "bg-card border border-border",
                ].join(" ")}
              >
                {/* Column header */}
                <div className="px-3.5 py-2.5 border-b border-border">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <h3
                        className={`font-bold text-[11px] uppercase tracking-[0.1em] ${col.accent}`}
                      >
                        {col.label}
                      </h3>
                      {col.stage === "docs_ready" &&
                        draggingCase &&
                        !canDrop && (
                          <Lock className="w-3 h-3 text-destructive" />
                        )}
                    </div>
                    <span
                      className={`min-w-[20px] h-5 flex items-center justify-center text-[10px] font-bold px-1.5 rounded-md ${
                        colCases.length > 0
                          ? col.countBg
                          : "text-muted-foreground/40 bg-muted"
                      }`}
                    >
                      {colCases.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-230px)] min-h-[120px] bg-muted/30">
                  {prospectDropTarget && (
                    <div className="rounded-xl border border-dashed border-accent/50 bg-accent/5 px-3 py-2.5 text-center">
                      <p className="text-[11px] font-semibold text-accent">
                        {t("adminPipeline.dropProspectToConvert")}
                      </p>
                    </div>
                  )}
                  {colCases.map((c) => (
                    <KanbanCard
                      key={c.id}
                      client={c}
                      onDragStart={() => onCaseDragStart(c.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => openPanel(c.id, c.client_id)}
                    />
                  ))}
                  {colCases.length === 0 && !prospectDropTarget && (
                    <div className="h-20 flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border/40">
                      {isDragTarget && canDrop ? (
                        <>
                          <ArrowDown className="w-3.5 h-3.5 text-primary/50" />
                          <span className="text-[10px] text-primary/50 font-medium">
                            Drop here
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40 font-medium">
                          Empty
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      <ClientPanelSheet
        open={panelOpen}
        caseId={panelCaseId}
        clientId={panelClientId}
        onClose={closePanel}
        onCaseUpdated={reloadPipeline}
        onConvertProspect={(prospect) => {
          setConvertingProspect(prospect);
        }}
      />

      {/* New Case Modal */}
      <NewCaseModal
        open={showNewCase}
        onClose={() => setShowNewCase(false)}
        onCreated={reloadPipeline}
      />

      {/* Convert Prospect Modal */}
      <ConvertProspectDialog
        prospect={convertingProspect}
        onClose={() => setConvertingProspect(null)}
        onConverted={() => {
          setConvertingProspect(null);
          closePanel();
          reloadPipeline();
        }}
      />

      {/* Stage change confirm (drag & drop) */}
      <AlertDialog
        open={!!pendingDrop}
        onOpenChange={(o) => !o && setPendingDrop(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("adminPipeline.stageConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {pendingDrop &&
                buildStageChangeConfirmMessage({
                  from: pendingDrop.from,
                  to: pendingDrop.to,
                  clientName: pendingDrop.clientName,
                  openInfoRequests: pendingDrop.openInfoRequests,
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDrop(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmPendingDrop}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

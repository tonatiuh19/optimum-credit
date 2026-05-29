import { useEffect, useState } from "react";
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
  Trash2,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPipeline,
  updateCaseStage,
  createAdminCase,
} from "@/store/slices/adminSlice";
import type {
  CreditRepairCase,
  PipelineStage,
  AdminClientListItem,
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
import { useToast } from "@/hooks/use-toast";
import { ClientPanelSheet } from "@/components/admin/ClientPanelSheet";

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
function isDragAllowed(targetStage: string, client: CreditRepairCase | null) {
  if (!client) return false;
  if (targetStage === "docs_ready") return canMoveToDocsReady(client);
  return true;
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
        e.dataTransfer.setData("text/plain", String(client.id));
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
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
              {client.package_name || "No package"}
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
                  <span className="text-destructive font-medium">
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

// ─── NewCaseModal ──────────────────────────────────────────────────────────────

interface SplitRow {
  label: string;
  amount: string;
  due_date: string;
}

function NewCaseModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();

  const [selectedClient, setSelectedClient] =
    useState<AdminClientListItem | null>(null);
  const [packageName, setPackageName] = useState("");
  const [stage, setStage] = useState<PipelineStage>("new_client");
  const [splits, setSplits] = useState<SplitRow[]>([]);
  const [loading, setLoading] = useState(false);

  const addSplit = () =>
    setSplits((prev) => [
      ...prev,
      { label: `Installment ${prev.length + 1}`, amount: "", due_date: "" },
    ]);

  const removeSplit = (i: number) =>
    setSplits((prev) => prev.filter((_, idx) => idx !== i));

  const updateSplit = (i: number, field: keyof SplitRow, val: string) =>
    setSplits((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, [field]: val } : s)),
    );

  const handleSubmit = async () => {
    if (!selectedClient) {
      toast({ title: "Select a client", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await dispatch(
        createAdminCase({
          client_id: selectedClient.id,
          notes: packageName || undefined,
          pipeline_stage: stage,
          splits: splits
            .filter((s) => s.amount && s.due_date)
            .map((s) => ({
              label: s.label,
              amount_cents: Math.round(parseFloat(s.amount) * 100),
              due_date: s.due_date,
              send_payment_link: false,
              reminder_flow_id: null,
            })),
        }),
      ).unwrap();
      toast({ title: "Case created!" });
      dispatch(fetchPipeline());
      onClose();
      setSelectedClient(null);
      setPackageName("");
      setStage("new_client");
      setSplits([]);
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message ?? "Could not create case",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const STAGES: PipelineStage[] = [
    "new_client",
    "docs_ready",
    "round_1",
    "round_2",
    "round_3",
    "completed",
    "cancelled",
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg w-full bg-card border-border p-0 gap-0 overflow-hidden [&>button:last-child]:hidden">
        <DialogTitle className="px-6 pt-6 pb-4 text-base font-bold text-foreground border-b border-border">
          New Case
        </DialogTitle>
        <div className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
          {/* Client picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              Client
            </label>
            <ClientSearchPicker
              value={selectedClient}
              onChange={setSelectedClient}
            />
          </div>

          {/* Package */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              Package / Notes (optional)
            </label>
            <Input
              placeholder="e.g. Credit Repair — 6 month"
              value={packageName}
              onChange={(e) => setPackageName(e.target.value)}
            />
          </div>

          {/* Stage */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">
              Pipeline Stage
            </label>
            <Select
              value={stage}
              onValueChange={(v) => setStage(v as PipelineStage)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (c) => c.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Splits */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground">
                Payment Schedule (optional)
              </label>
              <button
                onClick={addSplit}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add installment
              </button>
            </div>
            {splits.map((s, i) => (
              <div key={i} className="flex gap-2 items-start">
                <Input
                  placeholder="Label"
                  value={s.label}
                  onChange={(e) => updateSplit(i, "label", e.target.value)}
                  className="flex-1 text-xs h-8"
                />
                <Input
                  placeholder="$"
                  type="number"
                  value={s.amount}
                  onChange={(e) => updateSplit(i, "amount", e.target.value)}
                  className="w-20 text-xs h-8"
                />
                <Input
                  type="date"
                  value={s.due_date}
                  onChange={(e) => updateSplit(i, "due_date", e.target.value)}
                  className="w-36 text-xs h-8"
                />
                <button
                  onClick={() => removeSplit(i)}
                  className="text-muted-foreground hover:text-destructive mt-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Create Case
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminPipeline() {
  const dispatch = useAppDispatch();
  const { pipelineCases } = useAppSelector((s) => s.admin);
  const [searchParams, setSearchParams] = useSearchParams();

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelCaseId, setPanelCaseId] = useState<number | null>(null);
  const [panelClientId, setPanelClientId] = useState<number | null>(null);

  const [showNewCase, setShowNewCase] = useState(false);

  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchPipeline());
  }, [dispatch]);

  // Auto-open panel when navigated from another page with ?client=ID
  useEffect(() => {
    const clientParam = searchParams.get("client");
    if (clientParam && pipelineCases.length > 0) {
      const clientId = Number(clientParam);
      if (!isNaN(clientId) && clientId > 0) {
        const matchedCase = pipelineCases.find((c) => c.client_id === clientId);
        if (matchedCase) {
          setPanelCaseId(matchedCase.id);
          setPanelClientId(matchedCase.client_id);
          setPanelOpen(true);
          setSearchParams({}, { replace: true });
        }
      }
    }
  }, [searchParams, pipelineCases, setSearchParams]);

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
  const draggingCase = pipelineCases.find((c) => c.id === draggingId) ?? null;
  const onDragStart = (caseId: number) => setDraggingId(caseId);
  const onDragEnd = () => {
    setDraggingId(null);
    setDragOverStage(null);
  };
  const onDragOver = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    setDragOverStage(stage);
    e.dataTransfer.dropEffect = isDragAllowed(stage, draggingCase)
      ? "move"
      : "none";
  };
  const onDrop = async (e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    const kase = pipelineCases.find((c) => c.id === id);
    setDraggingId(null);
    setDragOverStage(null);
    if (!kase || !isDragAllowed(stage, kase)) {
      if (stage === "docs_ready")
        setStageError(
          "Cannot move to Docs Verified — all required tasks must be approved first.",
        );
      return;
    }
    setStageError(null);
    await dispatch(updateCaseStage({ caseId: id, stage }));
    dispatch(fetchPipeline());
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
        title="Pipeline"
        description="Click a card to review client details and documents. Drag to move between stages."
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
              <Plus className="w-3.5 h-3.5" /> New Case
            </button>
            <button
              onClick={() => dispatch(fetchPipeline())}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-card border border-border hover:border-border/80 px-3 py-2 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
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

      {/* Kanban */}
      <div className="table-scroll pb-4 -mx-1 px-1 max-w-full">
        <div className="flex gap-3 w-max min-w-full pr-2">
          {COLUMNS.map((col) => {
            const colCases = grouped[col.stage] ?? [];
            const isDragTarget = dragOverStage === col.stage;
            const canDrop = isDragAllowed(col.stage, draggingCase);
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
                    ? "shadow-xl shadow-primary/15 md:scale-[1.015] ring-1 ring-primary/30"
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
                  {colCases.map((c) => (
                    <KanbanCard
                      key={c.id}
                      client={c}
                      onDragStart={() => onDragStart(c.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => openPanel(c.id, c.client_id)}
                    />
                  ))}
                  {colCases.length === 0 && (
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

      <ClientPanelSheet
        open={panelOpen}
        caseId={panelCaseId}
        clientId={panelClientId}
        onClose={closePanel}
        onCaseUpdated={() => dispatch(fetchPipeline())}
      />

      {/* New Case Modal */}
      <NewCaseModal open={showNewCase} onClose={() => setShowNewCase(false)} />
    </div>
  );
}

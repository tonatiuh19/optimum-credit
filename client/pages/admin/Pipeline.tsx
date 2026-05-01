import { useEffect, useState, useCallback } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Workflow,
  CheckCircle2,
  X,
  Eye,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Download,
  Lock,
  CreditCard,
  Phone,
  Mail,
  Calendar,
  Clock,
  ArrowRight,
  ArrowDown,
  RefreshCw,
  ScanLine,
  Hash,
  Home,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPipeline,
  updateClientStage,
  fetchPanelClient,
  clearPanelClient,
  reviewDocument,
} from "@/store/slices/adminSlice";
import type { AdminClientListItem, PipelineStage } from "@shared/api";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";

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

const REQUIRED_DOCS: {
  type: string;
  label: string;
  icon: LucideIcon;
}[] = [
  { type: "id_front", label: "Gov ID — Front", icon: CreditCard },
  { type: "id_back", label: "Gov ID — Back", icon: ScanLine },
  { type: "ssn_card", label: "Social Security Card", icon: Hash },
  { type: "proof_of_address", label: "Proof of Address", icon: Home },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(d: string) {
  return Math.floor(
    (Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24),
  );
}
function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function canMoveToDocsReady(c: AdminClientListItem) {
  return (c.docs_approved ?? 0) >= 4 && (c.docs_pending ?? 0) === 0;
}
function isDragAllowed(
  targetStage: string,
  client: AdminClientListItem | null,
) {
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
  client: AdminClientListItem;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const isPaid = client.status === "onboarding" || client.status === "active";
  const docsApproved = client.docs_approved ?? 0;
  const docsPending = client.docs_pending ?? 0;
  const docsRejected = client.docs_rejected ?? 0;
  const docsTotal = client.docs_total ?? 0;
  const days = daysSince(client.created_at);
  const initials =
    `${client.first_name?.[0] ?? ""}${client.last_name?.[0] ?? ""}`.toUpperCase();
  const pct = Math.min((docsApproved / 4) * 100, 100);

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
            docsApproved >= 4
              ? "bg-accent"
              : docsRejected > 0
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
            <div className="font-semibold text-[13px] text-foreground leading-tight truncate">
              {client.first_name} {client.last_name}
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

        {/* Docs progress */}
        {docsTotal > 0 ? (
          <div className="mb-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground font-medium">
                {docsApproved}/4 docs
              </span>
              <div className="flex gap-2">
                {docsPending > 0 && (
                  <span className="text-primary font-medium">
                    {docsPending} pending
                  </span>
                )}
                {docsRejected > 0 && (
                  <span className="text-destructive font-medium">
                    {docsRejected} rejected
                  </span>
                )}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  docsApproved >= 4
                    ? "bg-accent"
                    : docsRejected > 0
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
            Awaiting documents
          </div>
        )}

        {/* Footer row */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-medium">
            {days === 0 ? "Today" : `${days}d ago`}
          </span>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-primary font-semibold flex items-center gap-0.5">
            Open <ArrowRight className="w-2.5 h-2.5" />
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── DocTaskCard ──────────────────────────────────────────────────────────────

function DocTaskCard({
  docType,
  doc,
  isRejecting,
  rejectReason,
  actionLoading,
  onApprove,
  onStartReject,
  onCancelReject,
  onRejectReasonChange,
  onConfirmReject,
  onPreview,
}: {
  docType: { type: string; label: string; icon: LucideIcon };
  doc: any | null;
  isRejecting: boolean;
  rejectReason: string;
  actionLoading: boolean;
  onApprove: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onRejectReasonChange: (v: string) => void;
  onConfirmReject: () => void;
  onPreview: () => void;
}) {
  const status: "missing" | "pending" | "approved" | "rejected" =
    doc?.review_status ?? "missing";
  const borderBg: Record<string, string> = {
    approved: "border-accent/30 bg-accent/[0.04]",
    pending: "border-primary/25 bg-primary/[0.03]",
    rejected: "border-destructive/30 bg-destructive/[0.04]",
    missing: "border-border bg-muted/20",
  };
  const statusBadge: Record<string, React.ReactNode> = {
    approved: (
      <Badge className="bg-accent/15 text-accent border border-accent/30 text-[10px] gap-0.5">
        <CheckCircle2 className="w-2.5 h-2.5" /> Approved
      </Badge>
    ),
    pending: (
      <Badge className="bg-primary/10 text-primary border border-primary/25 text-[10px] gap-0.5">
        <Clock className="w-2.5 h-2.5" /> Pending
      </Badge>
    ),
    rejected: (
      <Badge className="bg-destructive/10 text-destructive border border-destructive/25 text-[10px] gap-0.5">
        <X className="w-2.5 h-2.5" /> Rejected
      </Badge>
    ),
    missing: (
      <Badge className="bg-muted text-muted-foreground border border-border text-[10px]">
        Missing
      </Badge>
    ),
  };

  const DocIcon = docType.icon;
  return (
    <div
      className={`rounded-xl border ${borderBg[status]} p-3.5 transition-colors`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-muted/80 border border-border/60 flex items-center justify-center shrink-0">
            <DocIcon className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <div>
            <div className="font-semibold text-sm">{docType.label}</div>
            {doc && (
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {doc.file_name} · {formatBytes(doc.file_size)}
              </div>
            )}
          </div>
        </div>
        {statusBadge[status]}
      </div>
      {status === "rejected" && doc?.rejection_reason && (
        <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 px-2.5 py-2 rounded-lg mb-2 leading-relaxed">
          <span className="font-semibold">Reason: </span>
          {doc.rejection_reason}
        </div>
      )}
      {status === "missing" && (
        <p className="text-[11px] text-muted-foreground italic">
          Awaiting upload from client
        </p>
      )}
      {status === "rejected" && (
        <p className="text-[11px] text-muted-foreground italic">
          Waiting for client to re-upload
        </p>
      )}
      {status === "approved" && (
        <button
          onClick={onPreview}
          className="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
        >
          <Eye className="w-3 h-3" /> Preview file
        </button>
      )}
      {status === "pending" && !isRejecting && (
        <div className="flex items-center gap-2">
          <button
            onClick={onPreview}
            className="text-[11px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors mr-auto"
          >
            <Eye className="w-3 h-3" /> Preview
          </button>
          <Button
            onClick={onApprove}
            disabled={actionLoading}
            size="sm"
            className="h-7 px-3 text-xs bg-accent hover:bg-accent/90 text-white gap-1"
          >
            {actionLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3 h-3" />
            )}
            Approve
          </Button>
          <Button
            onClick={onStartReject}
            disabled={actionLoading}
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs border-destructive/30 text-destructive hover:bg-destructive/10 gap-1"
          >
            <X className="w-3 h-3" /> Reject
          </Button>
        </div>
      )}
      {status === "pending" && isRejecting && (
        <div className="space-y-2 mt-1">
          <Textarea
            rows={2}
            placeholder="Rejection reason (e.g. image blurry, expired…)"
            value={rejectReason}
            onChange={(e) => onRejectReasonChange(e.target.value)}
            className="bg-border/30 border-input text-xs resize-none"
          />
          <div className="flex justify-end gap-2">
            <Button
              onClick={onCancelReject}
              variant="outline"
              size="sm"
              className="h-7 text-xs border-border"
            >
              Cancel
            </Button>
            <Button
              onClick={onConfirmReject}
              disabled={actionLoading || !rejectReason.trim()}
              size="sm"
              className="h-7 text-xs bg-destructive hover:bg-destructive/90 text-white gap-1"
            >
              {actionLoading && <Loader2 className="w-3 h-3 animate-spin" />}{" "}
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── OverviewTab ──────────────────────────────────────────────────────────────

function OverviewTab({ client, payments }: { client: any; payments: any[] }) {
  return (
    <div className="space-y-4">
      <div className="bg-muted/40 rounded-xl p-4 space-y-2.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Contact
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-foreground/80">
            <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            {client.email}
          </div>
          {client.phone && (
            <div className="flex items-center gap-2 text-foreground/80">
              <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              {client.phone}
            </div>
          )}
          <div className="flex items-center gap-2 text-foreground/80">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            Joined {fmtDate(client.created_at)}
          </div>
        </div>
      </div>
      <div className="bg-muted/40 rounded-xl p-4 space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Package
        </h3>
        <div className="font-semibold text-sm">
          {client.package_name || "—"}
        </div>
        {client.package_price_cents && (
          <div className="text-muted-foreground text-sm">
            ${(Number(client.package_price_cents) / 100).toFixed(2)} / mo
          </div>
        )}
      </div>
      {payments.length > 0 && (
        <div className="bg-muted/40 rounded-xl p-4 space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Payments
          </h3>
          <div className="space-y-2">
            {payments.slice(0, 5).map((p: any) => (
              <div
                key={p.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-foreground/80 font-medium">
                  ${(Number(p.amount_cents) / 100).toFixed(2)}
                </span>
                <span
                  className={`text-xs ${p.status === "succeeded" ? "text-accent" : "text-primary"}`}
                >
                  {p.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {p.paid_at ? fmtDate(p.paid_at) : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HistoryTab ───────────────────────────────────────────────────────────────

function HistoryTab({ history }: { history: any[] }) {
  if (history.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No stage changes recorded yet.
      </p>
    );
  return (
    <div>
      {history.map((h: any, i: number) => (
        <div key={h.id} className="flex gap-3">
          <div className="flex flex-col items-center pt-1">
            <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
            {i < history.length - 1 && (
              <div className="w-px flex-1 bg-border my-1" />
            )}
          </div>
          <div className="pb-4">
            <div className="text-xs font-medium">
              <span className="text-muted-foreground">
                {h.from_stage?.replace(/_/g, " ") || "—"}
              </span>
              <span className="mx-1.5 text-muted-foreground/40">→</span>
              <span className="text-primary">
                {h.to_stage?.replace(/_/g, " ")}
              </span>
            </div>
            {h.notes && (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {h.notes}
              </div>
            )}
            <div className="text-[10px] text-muted-foreground mt-1">
              {fmtDate(h.created_at)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AdminPipeline() {
  const dispatch = useAppDispatch();
  const { pipelineClients, panelClient, panelLoading } = useAppSelector(
    (s) => s.admin,
  );

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelClientId, setPanelClientId] = useState<number | null>(null);
  const [panelTab, setPanelTab] = useState<
    "overview" | "documents" | "history"
  >("documents");

  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);

  const [rejectingDocId, setRejectingDocId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    dispatch(fetchPipeline());
  }, [dispatch]);

  // Panel
  const openPanel = (clientId: number) => {
    setPanelClientId(clientId);
    setPanelTab("documents");
    setPanelOpen(true);
    dispatch(fetchPanelClient(clientId));
  };
  const closePanel = () => {
    setPanelOpen(false);
    setPanelClientId(null);
    dispatch(clearPanelClient());
    closePreview();
  };

  // Drag
  const draggingClient =
    pipelineClients.find((c) => c.id === draggingId) ?? null;
  const onDragStart = (clientId: number) => setDraggingId(clientId);
  const onDragEnd = () => {
    setDraggingId(null);
    setDragOverStage(null);
  };
  const onDragOver = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    setDragOverStage(stage);
    e.dataTransfer.dropEffect = isDragAllowed(stage, draggingClient)
      ? "move"
      : "none";
  };
  const onDrop = async (e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    const client = pipelineClients.find((c) => c.id === id);
    setDraggingId(null);
    setDragOverStage(null);
    if (!client || !isDragAllowed(stage, client)) {
      if (stage === "docs_ready")
        setStageError(
          "Cannot move to Docs Verified — all 4 documents must be approved first.",
        );
      return;
    }
    setStageError(null);
    await dispatch(updateClientStage({ clientId: id, stage }));
    dispatch(fetchPipeline());
  };

  // Doc actions
  const handleApproveDoc = async (docId: number) => {
    setActionLoadingId(docId);
    await dispatch(reviewDocument({ id: docId, decision: "approved" }));
    setActionLoadingId(null);
    setRejectingDocId(null);
    if (panelClientId) {
      dispatch(fetchPanelClient(panelClientId));
      dispatch(fetchPipeline());
    }
  };
  const handleRejectDoc = async (docId: number) => {
    if (!rejectReason.trim()) return;
    setActionLoadingId(docId);
    await dispatch(
      reviewDocument({ id: docId, decision: "rejected", reason: rejectReason }),
    );
    setActionLoadingId(null);
    setRejectingDocId(null);
    setRejectReason("");
    if (panelClientId) dispatch(fetchPanelClient(panelClientId));
  };

  // File preview
  const openPreview = useCallback(async (doc: any) => {
    setPreviewDoc(doc);
    setPreviewLoading(true);
    setPreviewUrl(null);
    try {
      const resp = await api.get(`/admin/documents/${doc.id}/file`, {
        responseType: "blob",
      });
      setPreviewUrl(URL.createObjectURL(resp.data as Blob));
    } catch {
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);
  const closePreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewDoc(null);
    setPreviewUrl(null);
  };

  // Grouped
  const grouped = COLUMNS.reduce<Record<string, AdminClientListItem[]>>(
    (acc, c) => {
      acc[c.stage] = pipelineClients.filter(
        (cl) => cl.pipeline_stage === c.stage,
      );
      return acc;
    },
    {},
  );

  // Panel data
  const pd = panelClient;
  const panelDocs: any[] = pd?.documents ?? [];
  const panelPayments: any[] = pd?.payments ?? [];
  const panelHistory: any[] = pd?.pipeline_history ?? [];
  const approvedCount = panelDocs.filter(
    (d) => d.review_status === "approved",
  ).length;
  const latestDocByType = (type: string) =>
    panelDocs
      .filter((d) => d.doc_type === type)
      .sort(
        (a, b) =>
          new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime(),
      )[0] ?? null;

  const isPreviewImage = previewDoc?.mime_type?.startsWith("image/");
  const isPreviewPdf = previewDoc?.mime_type === "application/pdf";

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
          <button
            onClick={() => dispatch(fetchPipeline())}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-card border border-border hover:border-border/80 px-3 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
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
      <div className="overflow-x-auto pb-4 -mx-1 px-1">
        <div className="flex gap-3 min-w-max">
          {COLUMNS.map((col) => {
            const colClients = grouped[col.stage] ?? [];
            const isDragTarget = dragOverStage === col.stage;
            const canDrop = isDragAllowed(col.stage, draggingClient);
            return (
              <div
                key={col.stage}
                onDragOver={(e) => onDragOver(e, col.stage)}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={(e) => onDrop(e, col.stage as PipelineStage)}
                className={[
                  "w-[270px] flex flex-col rounded-2xl border-t-[3px] overflow-hidden transition-all duration-200",
                  col.topBorder,
                  isDragTarget && canDrop
                    ? "shadow-xl shadow-primary/15 scale-[1.015] ring-1 ring-primary/30"
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
                        draggingClient &&
                        !canDrop && (
                          <Lock className="w-3 h-3 text-destructive" />
                        )}
                    </div>
                    <span
                      className={`min-w-[20px] h-5 flex items-center justify-center text-[10px] font-bold px-1.5 rounded-md ${
                        colClients.length > 0
                          ? col.countBg
                          : "text-muted-foreground/40 bg-muted"
                      }`}
                    >
                      {colClients.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-230px)] min-h-[120px] bg-muted/30">
                  {colClients.map((c) => (
                    <KanbanCard
                      key={c.id}
                      client={c}
                      onDragStart={() => onDragStart(c.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => openPanel(c.id)}
                    />
                  ))}
                  {colClients.length === 0 && (
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

      {/* Client detail Sheet */}
      <Sheet open={panelOpen} onOpenChange={(o) => !o && closePanel()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[520px] bg-background border-l border-border p-0 flex flex-col [&>button:first-of-type]:hidden"
        >
          <SheetTitle className="sr-only">Client Detail</SheetTitle>
          {panelLoading || (!pd && panelOpen) ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : pd ? (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Panel header */}
              <div className="px-6 pt-5 pb-4 bg-card border-b border-border shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold truncate">
                      {pd.client.first_name} {pd.client.last_name}
                    </h2>
                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                      {pd.client.email}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {/* Explicit close button */}
                    <button
                      onClick={closePanel}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      aria-label="Close panel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    {(pd.client.status === "onboarding" ||
                      pd.client.status === "active") && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-accent/15 text-accent border border-accent/30 px-2 py-0.5 rounded-full">
                        <CreditCard className="w-2.5 h-2.5" /> Paid
                      </span>
                    )}
                    <span className="inline-flex text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full uppercase tracking-wide">
                      {pd.client.pipeline_stage?.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border shrink-0 bg-muted/30">
                {(["overview", "documents", "history"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setPanelTab(tab)}
                    className={[
                      "flex-1 py-3 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2",
                      panelTab === tab
                        ? "text-primary border-primary"
                        : "text-muted-foreground border-transparent hover:text-foreground",
                    ].join(" ")}
                  >
                    {tab === "documents"
                      ? `Docs (${approvedCount}/4)`
                      : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Tab body */}
              <div className="flex-1 overflow-y-auto p-5">
                {panelTab === "overview" && (
                  <OverviewTab client={pd.client} payments={panelPayments} />
                )}

                {panelTab === "documents" && (
                  <div className="space-y-3">
                    {REQUIRED_DOCS.map((rd) => {
                      const doc = latestDocByType(rd.type);
                      return (
                        <DocTaskCard
                          key={rd.type}
                          docType={rd}
                          doc={doc}
                          isRejecting={rejectingDocId === doc?.id}
                          rejectReason={rejectReason}
                          actionLoading={actionLoadingId === doc?.id}
                          onApprove={() => doc && handleApproveDoc(doc.id)}
                          onStartReject={() => {
                            if (doc) {
                              setRejectingDocId(doc.id);
                              setRejectReason("");
                            }
                          }}
                          onCancelReject={() => {
                            setRejectingDocId(null);
                            setRejectReason("");
                          }}
                          onRejectReasonChange={setRejectReason}
                          onConfirmReject={() => doc && handleRejectDoc(doc.id)}
                          onPreview={() => doc && openPreview(doc)}
                        />
                      );
                    })}
                    <div className="mt-2 rounded-xl bg-primary/[0.06] border border-primary/15 p-3 text-[11px] text-muted-foreground leading-relaxed">
                      Approving all 4 documents auto-advances the client to{" "}
                      <span className="text-primary font-semibold">
                        Docs Verified
                      </span>
                      . Dragging to that stage is blocked until all docs are
                      approved.
                    </div>
                  </div>
                )}

                {panelTab === "history" && (
                  <HistoryTab history={panelHistory} />
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* File preview Dialog */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => !o && closePreview()}>
        <DialogContent className="max-w-3xl w-full bg-card border-border p-0 gap-0 overflow-hidden max-h-[90vh]">
          <DialogTitle className="sr-only">File Preview</DialogTitle>
          {previewDoc && (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ShieldCheck className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {previewDoc.file_name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(previewDoc.file_size)}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {previewUrl && (
                    <a
                      href={previewUrl}
                      download={previewDoc.file_name}
                      className="inline-flex items-center gap-1.5 text-xs text-foreground/80 hover:text-foreground bg-muted hover:bg-muted/80 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" /> Download
                    </a>
                  )}
                  <button
                    onClick={closePreview}
                    className="w-7 h-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 bg-muted/40 flex items-center justify-center p-4 min-h-[300px]">
                {previewLoading && (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">
                      Decrypting document…
                    </p>
                  </div>
                )}
                {!previewLoading && previewUrl && isPreviewImage && (
                  <img
                    src={previewUrl}
                    alt={previewDoc.file_name}
                    className="max-w-full max-h-[500px] object-contain rounded-lg shadow-xl"
                  />
                )}
                {!previewLoading && previewUrl && isPreviewPdf && (
                  <iframe
                    src={previewUrl}
                    className="w-full h-[500px] rounded-lg"
                    title={previewDoc.file_name}
                  />
                )}
                {!previewLoading && !previewUrl && (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <AlertCircle className="w-8 h-8" />
                    <p className="text-sm">Preview unavailable</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

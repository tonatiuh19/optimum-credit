import { useEffect, useState, useCallback, useRef } from "react";
import {
  CheckCircle2,
  X,
  Eye,
  ExternalLink,
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
  FileText,
  Upload,
  Info,
  Hash,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPanelCase,
  clearPanelClient,
  uploadRoundReportPdf,
  deleteRoundReportPdf,
  fetchCaseSplits,
  markSplitPaid,
} from "@/store/slices/adminSlice";
import {
  fetchClientTaskCompletions,
  reviewTaskCompletion,
} from "@/store/slices/adminTasksSlice";
import type { OnboardingTaskType, PaymentSplit } from "@shared/api";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";
import { LangBadge } from "@/components/ui/lang-badge";
import { useToast } from "@/hooks/use-toast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_TYPE_LABELS: Record<OnboardingTaskType, string> = {
  upload: "Document Upload",
  sign_document: "Document Signing",
  form: "Form",
};

const ROUND_STAGES = [
  "round_1",
  "round_2",
  "round_3",
  "round_4",
  "round_5",
  "completed",
];

function isRoundActive(roundNumber: number, pipelineStage: string): boolean {
  const stageIndex = ROUND_STAGES.indexOf(pipelineStage);
  if (stageIndex === -1) return false;
  return stageIndex >= roundNumber - 1;
}

// ─── TaskCompletionCard ───────────────────────────────────────────────────────

function TaskCompletionCard({
  task,
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
  task: any;
  isRejecting: boolean;
  rejectReason: string;
  actionLoading: boolean;
  onApprove: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onRejectReasonChange: (v: string) => void;
  onConfirmReject: () => void;
  onPreview?: () => void;
}) {
  const adminStatus: "pending" | "approved" | "rejected" =
    task.admin_review_status ?? "pending";
  const isSubmitted = task.completion_status === "completed";

  const borderBg: Record<string, string> = {
    approved: "border-accent/30 bg-accent/[0.04]",
    pending: "border-primary/25 bg-primary/[0.03]",
    rejected: "border-destructive/30 bg-destructive/[0.04]",
  };
  const statusBadge: Record<string, React.ReactNode> = {
    approved: (
      <Badge className="bg-accent/15 text-accent border border-accent/30 text-[10px] gap-0.5">
        <CheckCircle2 className="w-2.5 h-2.5" /> Approved
      </Badge>
    ),
    pending: (
      <Badge className="bg-primary/10 text-primary border border-primary/25 text-[10px] gap-0.5">
        <Clock className="w-2.5 h-2.5" /> Pending Review
      </Badge>
    ),
    rejected: (
      <Badge className="bg-destructive/10 text-destructive border border-destructive/25 text-[10px] gap-0.5">
        <X className="w-2.5 h-2.5" /> Rejected
      </Badge>
    ),
  };

  if (!isSubmitted) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-3.5 transition-colors">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">
              {task.title_en ?? task.slug}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {TASK_TYPE_LABELS[task.task_type as OnboardingTaskType] ??
                task.task_type}
            </div>
          </div>
          <Badge className="bg-muted text-muted-foreground border border-border text-[10px] shrink-0">
            Not submitted
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border ${borderBg[adminStatus]} p-3.5 transition-colors`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">
            {task.title_en ?? task.slug}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {TASK_TYPE_LABELS[task.task_type as OnboardingTaskType] ??
              task.task_type}
            {task.file_name && ` · ${task.file_name}`}
            {task.signature_name && ` · Signed by ${task.signature_name}`}
          </div>
        </div>
        {statusBadge[adminStatus]}
      </div>

      {adminStatus === "rejected" && task.admin_notes && (
        <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 px-2.5 py-2 rounded-lg mb-2 leading-relaxed">
          <span className="font-semibold">Reason: </span>
          {task.admin_notes}
        </div>
      )}

      {/* File preview button for upload tasks */}
      {task.task_type === "upload" && task.file_name && onPreview && (
        <button
          onClick={onPreview}
          className="w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-border bg-muted/40 hover:bg-muted/70 hover:border-primary/30 transition-all text-xs font-medium text-foreground/80 hover:text-primary group"
        >
          <Eye className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
          <span className="truncate">{task.file_name}</span>
        </button>
      )}

      {/* Action buttons */}
      {!isRejecting && adminStatus !== "approved" && (
        <div className="flex items-center gap-2">
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
      {isRejecting && (
        <div className="space-y-2 mt-1">
          <Textarea
            rows={2}
            placeholder="Rejection reason…"
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

// ─── RoundPdfRow ──────────────────────────────────────────────────────────────

function RoundPdfRow({
  pdf,
  onView,
  onDelete,
  deleting,
}: {
  pdf: any;
  onView: (pdf: any) => void;
  onDelete: (pdf: any) => void;
  deleting: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/60 group hover:border-primary/20 transition-all">
      <div className="w-7 h-7 rounded-lg bg-destructive/10 border border-destructive/15 flex items-center justify-center shrink-0">
        <FileText className="w-3.5 h-3.5 text-destructive" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium truncate text-foreground">
          {pdf.file_name}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {new Date(pdf.uploaded_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onView(pdf)}
          className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 bg-primary/8 hover:bg-primary/12 border border-primary/15 px-2 py-1 rounded-md transition-colors"
        >
          <Eye className="w-3 h-3" /> View
        </button>
        <button
          onClick={() => onDelete(pdf)}
          disabled={deleting}
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
        >
          {deleting ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <X className="w-3 h-3" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── ReportsTab ───────────────────────────────────────────────────────────────

function ReportsTab({
  reports,
  pipelineStage,
  clientId,
  onPdfUploaded,
}: {
  reports: any[];
  pipelineStage: string;
  clientId: number;
  onPdfUploaded: (roundNumber: number) => void;
}) {
  const dispatch = useAppDispatch();
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [uploading, setUploading] = useState<Record<number, boolean>>({});
  const [uploadError, setUploadError] = useState<Record<number, string>>({});
  const [deleting, setDeleting] = useState<Record<number, boolean>>({});
  const [drag, setDrag] = useState<Record<number, boolean>>({});
  const [pendingFile, setPendingFile] = useState<Record<number, File | null>>(
    {},
  );
  const [previewPdf, setPreviewPdf] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const inRounds = ROUND_STAGES.includes(pipelineStage);

  const getReport = (round: number) =>
    reports.find((r: any) => r.round_number === round);

  const getPdfs = (round: number): any[] => getReport(round)?.pdfs ?? [];

  const handleFilePick = (round: number, file: File | null) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setUploadError((p) => ({
        ...p,
        [round]: "Only PDF files are accepted.",
      }));
      return;
    }
    setUploadError((p) => ({ ...p, [round]: "" }));
    setPendingFile((p) => ({ ...p, [round]: file }));
  };

  const handleConfirmUpload = async (round: number) => {
    const file = pendingFile[round];
    if (!file) return;
    setUploading((p) => ({ ...p, [round]: true }));
    setUploadError((p) => ({ ...p, [round]: "" }));
    try {
      await dispatch(
        uploadRoundReportPdf({ clientId, roundNumber: round, file }),
      ).unwrap();
      setPendingFile((p) => ({ ...p, [round]: null }));
      onPdfUploaded(round);
    } catch {
      setUploadError((p) => ({
        ...p,
        [round]: "Upload failed. Please try again.",
      }));
    } finally {
      setUploading((p) => ({ ...p, [round]: false }));
    }
  };

  const handleDelete = async (pdf: any) => {
    const round = pdf.round_number as number;
    setDeleting((p) => ({ ...p, [pdf.id]: true }));
    try {
      await dispatch(
        deleteRoundReportPdf({ pdfId: pdf.id, roundNumber: round }),
      ).unwrap();
    } catch {
      // silent
    } finally {
      setDeleting((p) => ({ ...p, [pdf.id]: false }));
    }
  };

  const openPdfPreview = async (pdf: any) => {
    setPreviewPdf(pdf);
    setPreviewLoading(true);
    setPreviewUrl(null);
    try {
      const resp = await api.get(`/admin/round-report-pdfs/${pdf.id}`, {
        responseType: "blob",
      });
      setPreviewUrl(URL.createObjectURL(resp.data as Blob));
    } catch {
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePdfPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewPdf(null);
    setPreviewUrl(null);
  };

  return (
    <div className="space-y-3">
      {!inRounds && (
        <div className="flex items-start gap-2.5 rounded-xl bg-primary/[0.06] border border-primary/15 p-3">
          <Info className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            PDF reports will be available to upload once this client enters{" "}
            <span className="font-semibold text-primary">Round 1</span>. Each
            round unlocks as the client progresses through the pipeline.
          </p>
        </div>
      )}

      {[1, 2, 3, 4, 5].map((round) => {
        const active = isRoundActive(round, pipelineStage);
        const report = getReport(round);
        const pdfs = getPdfs(round);
        const isUploading = uploading[round];
        const isDragging = drag[round];
        const pending = pendingFile[round];
        const error = uploadError[round];

        return (
          <div
            key={round}
            className={[
              "rounded-xl border p-4 transition-all",
              active
                ? "bg-card border-border"
                : "bg-muted/20 border-border/40 opacity-50",
            ].join(" ")}
          >
            {/* Round header */}
            <div className="flex items-center gap-3 mb-3">
              <div
                className={[
                  "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold",
                  active
                    ? pdfs.length > 0
                      ? "bg-accent/10 text-accent"
                      : "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                ].join(" ")}
              >
                R{round}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">
                    Round {round} Reports
                  </span>
                  {!active && (
                    <Lock className="w-3 h-3 text-muted-foreground" />
                  )}
                  {pdfs.length > 0 && (
                    <span className="text-[9px] font-bold bg-accent/10 text-accent border border-accent/25 px-1.5 py-0.5 rounded-full">
                      {pdfs.length} PDF{pdfs.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {report && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                    {report.score_before != null && (
                      <span>
                        Score: {report.score_before} →{" "}
                        {report.score_after ?? "—"}
                      </span>
                    )}
                    {report.items_removed > 0 && (
                      <span className="text-accent font-medium">
                        {report.items_removed} removed
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {active && (
              <div className="space-y-2">
                {/* PDF list */}
                {pdfs.length > 0 && (
                  <div className="space-y-1.5">
                    {pdfs.map((pdf: any) => (
                      <RoundPdfRow
                        key={pdf.id}
                        pdf={pdf}
                        onView={openPdfPreview}
                        onDelete={handleDelete}
                        deleting={!!deleting[pdf.id]}
                      />
                    ))}
                  </div>
                )}

                {/* Pending file preview (confirm before upload) */}
                {pending && (
                  <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-primary/30 bg-primary/[0.05] animate-in fade-in slide-in-from-bottom-1 duration-200">
                    <div className="w-7 h-7 rounded-lg bg-destructive/10 border border-destructive/15 flex items-center justify-center shrink-0">
                      <FileText className="w-3.5 h-3.5 text-destructive" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium truncate">
                        {pending.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {pending.size < 1024 * 1024
                          ? `${(pending.size / 1024).toFixed(1)} KB`
                          : `${(pending.size / (1024 * 1024)).toFixed(1)} MB`}{" "}
                        · PDF
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() =>
                          setPendingFile((p) => ({ ...p, [round]: null }))
                        }
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleConfirmUpload(round)}
                        disabled={isUploading}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold bg-accent hover:bg-accent/90 text-white px-2.5 py-1 rounded-md transition-colors disabled:opacity-60"
                      >
                        {isUploading ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Upload className="w-3 h-3" />
                        )}
                        Upload
                      </button>
                    </div>
                  </div>
                )}

                {/* Drag-drop zone */}
                {!pending && (
                  <div
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setDrag((p) => ({ ...p, [round]: true }));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDrag((p) => ({ ...p, [round]: true }));
                    }}
                    onDragLeave={() =>
                      setDrag((p) => ({ ...p, [round]: false }))
                    }
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag((p) => ({ ...p, [round]: false }));
                      handleFilePick(round, e.dataTransfer.files[0] ?? null);
                    }}
                    onClick={() => fileInputRefs.current[round]?.click()}
                    className={[
                      "flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-4 cursor-pointer transition-all",
                      isDragging
                        ? "border-primary/50 bg-primary/[0.06]"
                        : "border-border/50 bg-muted/20 hover:border-primary/30 hover:bg-primary/[0.04]",
                    ].join(" ")}
                  >
                    <Upload
                      className={`w-4 h-4 ${
                        isDragging ? "text-primary" : "text-muted-foreground/60"
                      } transition-colors`}
                    />
                    <p className="text-[11px] text-muted-foreground text-center">
                      {pdfs.length > 0
                        ? "Add another PDF"
                        : "Drop PDF here or click to upload"}
                    </p>
                  </div>
                )}

                <input
                  ref={(el) => {
                    fileInputRefs.current[round] = el;
                  }}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    handleFilePick(round, e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />

                {error && (
                  <p className="text-[11px] text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    {error}
                  </p>
                )}
              </div>
            )}

            {!active && pdfs.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                {ROUND_STAGES.includes(pipelineStage)
                  ? "Awaiting this round"
                  : "Client not yet in rounds"}
              </p>
            )}
          </div>
        );
      })}

      {/* PDF Preview Dialog */}
      <Dialog open={!!previewPdf} onOpenChange={(o) => !o && closePdfPreview()}>
        <DialogContent className="max-w-3xl w-full bg-card border-border p-0 gap-0 overflow-hidden max-h-[90vh] [&>button:last-child]:hidden">
          <DialogTitle className="sr-only">PDF Preview</DialogTitle>
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5">
                <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-sm font-medium truncate max-w-[200px]">
                  {previewPdf?.file_name ?? "Round Report PDF"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {previewUrl && (
                  <a
                    href={previewUrl}
                    download={previewPdf?.file_name}
                    className="inline-flex items-center gap-1.5 text-xs text-foreground/80 hover:text-foreground bg-muted hover:bg-muted/80 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </a>
                )}
                <DialogClose
                  onClick={closePdfPreview}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="w-4 h-4" />
                </DialogClose>
              </div>
            </div>
            <div className="flex-1 bg-muted/40 flex items-center justify-center p-4 min-h-[400px]">
              {previewLoading && (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Loading PDF…</p>
                </div>
              )}
              {!previewLoading && previewUrl && (
                <iframe
                  src={previewUrl}
                  title="Round Report PDF"
                  className="w-full h-full rounded-lg border border-border min-h-[400px]"
                  style={{ minHeight: "400px" }}
                />
              )}
              {!previewLoading && !previewUrl && (
                <p className="text-sm text-muted-foreground">
                  Could not load PDF.
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
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

// ─── PaymentScheduleTab ────────────────────────────────────────────────────────

function PaymentScheduleTab({ caseId }: { caseId: number }) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { caseSplits, caseSplitsLoading } = useAppSelector((s) => s.admin);

  useEffect(() => {
    dispatch(fetchCaseSplits(caseId));
  }, [caseId, dispatch]);

  const fmtMoney = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(cents / 100);

  const handleMarkPaid = async (split: PaymentSplit) => {
    try {
      await dispatch(markSplitPaid({ caseId, splitId: split.id })).unwrap();
      toast({ title: "Marked as paid" });
      dispatch(fetchCaseSplits(caseId));
    } catch {
      toast({
        title: "Error",
        description: "Could not mark split as paid",
        variant: "destructive",
      });
    }
  };

  if (caseSplitsLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (caseSplits.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No payment schedule for this case.
      </p>
    );
  }

  const total = caseSplits.reduce((s, sp) => s + sp.amount_cents, 0);
  const paid = caseSplits
    .filter((sp) => sp.status === "paid")
    .reduce((s, sp) => s + sp.amount_cents, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 rounded-xl px-3 py-2">
        <span>
          {caseSplits.filter((s) => s.status === "paid").length} of{" "}
          {caseSplits.length} paid
        </span>
        <span className="font-semibold text-foreground">
          {fmtMoney(paid)} / {fmtMoney(total)}
        </span>
      </div>
      {caseSplits.map((sp) => {
        const isOverdue =
          sp.status === "pending" && new Date(sp.due_date) < new Date();
        const eff: string = isOverdue ? "overdue" : sp.status;
        const badgeClass =
          eff === "paid"
            ? "bg-accent/10 text-accent border-accent/30"
            : eff === "overdue"
              ? "bg-destructive/10 text-destructive border-destructive/30"
              : eff === "cancelled"
                ? "bg-muted text-muted-foreground border-border"
                : "bg-yellow-500/10 text-yellow-700 border-yellow-300";

        return (
          <div
            key={sp.id}
            className="flex items-center justify-between bg-card border border-border rounded-xl px-3 py-2.5"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{sp.label}</p>
              <p className="text-xs text-muted-foreground">
                Due{" "}
                {new Date(sp.due_date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badgeClass}`}
              >
                {eff.charAt(0).toUpperCase() + eff.slice(1)}
              </span>
              <span className="text-sm font-bold">
                {fmtMoney(sp.amount_cents)}
              </span>
              {sp.status === "pending" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px] px-2"
                  onClick={() => handleMarkPaid(sp)}
                >
                  Paid
                </Button>
              )}
            </div>
          </div>
        );
      })}
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

// ─── ClientPanelSheet ─────────────────────────────────────────────────────────

export interface ClientPanelSheetProps {
  open: boolean;
  caseId: number | null;
  clientId: number | null;
  onClose: () => void;
  onCaseUpdated: () => void;
}

export function ClientPanelSheet({
  open,
  caseId,
  clientId,
  onClose,
  onCaseUpdated,
}: ClientPanelSheetProps) {
  const dispatch = useAppDispatch();
  const { panelClient: pd, panelLoading } = useAppSelector((s) => s.admin);
  const {
    clientCompletions,
    clientCompletionsLoading,
    saving: taskSaving,
  } = useAppSelector((s) => s.adminTasks);

  const [panelTab, setPanelTab] = useState<
    "overview" | "tasks" | "reports" | "history" | "schedule"
  >("tasks");
  const [rejectingTaskId, setRejectingTaskId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Fetch panel data when opening
  useEffect(() => {
    if (!open) return;
    if (caseId) dispatch(fetchPanelCase(caseId));
    if (clientId) dispatch(fetchClientTaskCompletions(clientId));
    setPanelTab("tasks");
  }, [open, caseId, clientId, dispatch]);

  // Clean up when panel closes
  const closePreview = useCallback(() => {
    setPreviewUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    setPreviewDoc(null);
  }, []);

  useEffect(() => {
    if (!open) {
      closePreview();
      dispatch(clearPanelClient());
    }
  }, [open, closePreview, dispatch]);

  // Derived panel data
  const panelCompletions: any[] = clientId
    ? (clientCompletions[clientId] ?? pd?.documents ?? [])
    : (pd?.documents ?? []);
  const panelPayments: any[] = pd?.payments ?? [];
  const panelHistory: any[] = pd?.pipeline_history ?? [];
  const panelReports: any[] = pd?.reports ?? [];
  const approvedCount = panelCompletions.filter(
    (c) => c.admin_review_status === "approved",
  ).length;
  const requiredCount = panelCompletions.filter(
    (c) => Number(c.is_required) === 1,
  ).length;

  // Task review handlers
  const handleApproveTask = async (completionId: number) => {
    if (!clientId) return;
    setActionLoadingId(completionId);
    await dispatch(
      reviewTaskCompletion({
        completionId,
        admin_review_status: "approved",
        clientId,
      }),
    );
    setActionLoadingId(null);
    setRejectingTaskId(null);
    if (caseId) {
      dispatch(fetchPanelCase(caseId));
      onCaseUpdated();
    }
  };

  const handleRejectTask = async (completionId: number) => {
    if (!clientId || !rejectReason.trim()) return;
    setActionLoadingId(completionId);
    await dispatch(
      reviewTaskCompletion({
        completionId,
        admin_review_status: "rejected",
        admin_notes: rejectReason,
        clientId,
      }),
    );
    setActionLoadingId(null);
    setRejectingTaskId(null);
    setRejectReason("");
    if (caseId) {
      dispatch(fetchPanelCase(caseId));
      onCaseUpdated();
    }
  };

  // Document file preview handlers
  const openPreview = useCallback(async (completion: any) => {
    setPreviewDoc(completion);
    setPreviewLoading(true);
    setPreviewUrl(null);
    try {
      const resp = await api.get(
        `/admin/task-completions/${completion.id}/file`,
        { responseType: "blob" },
      );
      setPreviewUrl(URL.createObjectURL(resp.data as Blob));
    } catch {
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const isPreviewImage = previewDoc?.file_mime?.startsWith("image/");
  const isPreviewPdf = previewDoc?.file_mime === "application/pdf";

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[520px] bg-background border-l border-border p-0 flex flex-col [&>button:first-of-type]:hidden"
        >
          <SheetTitle className="sr-only">Client Detail</SheetTitle>
          {panelLoading || (!pd && open) ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : pd ? (
            <div className="flex flex-col h-full overflow-hidden">
              {/* Panel header */}
              <div className="px-6 pt-5 pb-4 bg-card border-b border-border shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h2 className="text-xl font-bold truncate">
                        {pd.client.first_name} {pd.client.last_name}
                      </h2>
                      <LangBadge lang={pd.client.preferred_language} />
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold bg-primary/10 text-primary border border-primary/25 px-2 py-0.5 rounded-md shrink-0">
                        <Hash className="w-3 h-3" />
                        {pd.case_info?.case_number ?? ""}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {pd.client.email}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <button
                      onClick={onClose}
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
                {(
                  [
                    "overview",
                    "tasks",
                    "reports",
                    "history",
                    "schedule",
                  ] as const
                ).map((tab) => (
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
                    {tab === "tasks"
                      ? `Tasks (${approvedCount}/${requiredCount})`
                      : tab === "schedule"
                        ? "Schedule"
                        : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Tab body */}
              <div className="flex-1 overflow-y-auto p-5">
                {panelTab === "overview" && (
                  <OverviewTab client={pd.client} payments={panelPayments} />
                )}

                {panelTab === "tasks" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-[11px] text-muted-foreground font-medium">
                        Client tasks
                      </span>
                      <span className="font-mono text-[10px] font-bold text-primary/70 bg-primary/8 border border-primary/15 px-1.5 py-0.5 rounded">
                        {pd.case_info?.case_number ?? ""}
                      </span>
                    </div>
                    {clientCompletionsLoading &&
                    panelCompletions.length === 0 ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : panelCompletions.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        No task templates configured.
                      </p>
                    ) : (
                      panelCompletions.map((completion: any) => (
                        <TaskCompletionCard
                          key={completion.id ?? completion.task_template_id}
                          task={completion}
                          isRejecting={rejectingTaskId === completion.id}
                          rejectReason={rejectReason}
                          actionLoading={
                            actionLoadingId === completion.id || taskSaving
                          }
                          onApprove={() =>
                            completion.id && handleApproveTask(completion.id)
                          }
                          onStartReject={() => {
                            if (completion.id) {
                              setRejectingTaskId(completion.id);
                              setRejectReason("");
                            }
                          }}
                          onCancelReject={() => {
                            setRejectingTaskId(null);
                            setRejectReason("");
                          }}
                          onRejectReasonChange={setRejectReason}
                          onConfirmReject={() =>
                            completion.id && handleRejectTask(completion.id)
                          }
                          onPreview={
                            completion.task_type === "upload" &&
                            completion.file_name
                              ? () => openPreview(completion)
                              : undefined
                          }
                        />
                      ))
                    )}
                    <div className="mt-2 rounded-xl bg-primary/[0.06] border border-primary/15 p-3 text-[11px] text-muted-foreground leading-relaxed">
                      Approving all required tasks auto-advances the client to{" "}
                      <span className="text-primary font-semibold">
                        Docs Verified
                      </span>
                      . Dragging to that stage is blocked until all required
                      tasks are approved.
                    </div>
                  </div>
                )}

                {panelTab === "history" && (
                  <HistoryTab history={panelHistory} />
                )}

                {panelTab === "schedule" && caseId && (
                  <PaymentScheduleTab caseId={caseId} />
                )}

                {panelTab === "reports" && clientId && (
                  <ReportsTab
                    reports={panelReports}
                    pipelineStage={
                      pd?.case_info?.pipeline_stage ??
                      pd?.client?.pipeline_stage ??
                      ""
                    }
                    clientId={clientId}
                    onPdfUploaded={() => {
                      if (caseId) dispatch(fetchPanelCase(caseId));
                    }}
                  />
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Document file preview Dialog */}
      <Dialog open={!!previewDoc} onOpenChange={(o) => !o && closePreview()}>
        <DialogContent className="max-w-3xl w-full bg-card border-border p-0 gap-0 overflow-hidden max-h-[90vh] [&>button:last-child]:hidden">
          <DialogTitle className="sr-only">File Preview</DialogTitle>
          {previewDoc && (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ShieldCheck className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {previewDoc.file_name}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {previewUrl && (
                    <>
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-foreground/80 hover:text-foreground bg-muted hover:bg-muted/80 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open in tab
                      </a>
                      <a
                        href={previewUrl}
                        download={previewDoc.file_name}
                        className="inline-flex items-center gap-1.5 text-xs text-foreground/80 hover:text-foreground bg-muted hover:bg-muted/80 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" /> Download
                      </a>
                    </>
                  )}
                  <DialogClose
                    onClick={closePreview}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </DialogClose>
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
    </>
  );
}

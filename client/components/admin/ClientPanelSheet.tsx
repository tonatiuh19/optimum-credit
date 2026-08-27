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
  Info,
  Hash,
  Upload,
  Bell,
  RotateCcw,
  UserPlus,
  Sparkles,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPanelCase,
  fetchPanelClient,
  clearPanelClient,
  deleteRoundReportPdf,
  fetchCaseSplits,
  createCaseSplit,
  fetchCaseDocuments,
  fetchCaseRoundSchedule,
  saveCaseRoundSchedule,
  sendCaseRoundCalendar,
} from "@/store/slices/adminSlice";
import {
  fetchCaseTaskCompletions,
  fetchClientTaskCompletions,
  reviewTaskCompletion,
  sendTaskReminder,
  reopenTaskCompletion,
} from "@/store/slices/adminTasksSlice";
import type { OnboardingTaskType, Prospect, RoundScheduleInput } from "@shared/api";
import AdminSplitActions from "@/components/admin/AdminSplitActions";
import { AdminAskCaseButton } from "@/components/admin/AdminAskDrawer";
import { ClientPanelConversationButton } from "@/components/admin/ClientPanelConversationButton";
import InstallmentDraftFields, {
  emptyInstallmentDraft,
  draftToCreateSplitPayload,
  type InstallmentDraft,
} from "@/components/admin/InstallmentDraftFields";
import RoundCalendarScheduleFields, {
  emptyRoundScheduleInput,
} from "@/components/admin/RoundCalendarScheduleFields";
import { useTranslation } from "react-i18next";
import ReopenTaskDialog from "@/components/admin/ReopenTaskDialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";
import { LangBadge } from "@/components/ui/lang-badge";
import { useToast } from "@/hooks/use-toast";
import OfGReportWizard, {
  suggestReportRound,
} from "@/components/admin/OfgReportWizard";
import { InfoRequestsTab } from "@/components/admin/InfoRequestsTab";
import { ClientLabelsEditor } from "@/components/admin/ClientLabelsEditor";
import AdminCaseDocUploadDialog from "@/components/admin/AdminCaseDocUploadDialog";
import NoEmailWarning from "@/components/admin/NoEmailWarning";
import {
  taskSlugToDocType,
  buildReopenToastParts,
  isProspectLead,
} from "@/lib/pipelineFilters";

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
  remindLoading,
  reopenLoading,
  onApprove,
  onStartReject,
  onCancelReject,
  onRejectReasonChange,
  onConfirmReject,
  onPreview,
  onRemind,
  onReopen,
  onAdminUpload,
}: {
  task: any;
  isRejecting: boolean;
  rejectReason: string;
  actionLoading: boolean;
  remindLoading?: boolean;
  reopenLoading?: boolean;
  onApprove: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onRejectReasonChange: (v: string) => void;
  onConfirmReject: () => void;
  onPreview?: () => void;
  onRemind?: () => void;
  onReopen?: () => void;
  onAdminUpload?: () => void;
}) {
  const { t } = useTranslation();
  const adminStatus: "pending" | "approved" | "rejected" =
    task.admin_review_status ?? "pending";
  const isSubmitted = task.completion_status === "completed";
  const showRemind =
    !!onRemind &&
    (adminStatus === "approved"
      ? false
      : !isSubmitted || adminStatus === "rejected");
  const showReopen = !!onReopen && adminStatus === "approved";
  const showAdminUpload =
    !!onAdminUpload &&
    task.task_type === "upload" &&
    adminStatus !== "approved";

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
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm truncate">
              {task.title_en ?? task.slug}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {TASK_TYPE_LABELS[task.task_type as OnboardingTaskType] ??
                task.task_type}
            </div>
            {typeof task.admin_notes === "string" &&
              task.admin_notes.startsWith("Reopened") && (
                <div className="text-[11px] text-muted-foreground bg-muted/60 border border-border px-2.5 py-1.5 rounded-lg mt-2 leading-relaxed">
                  {task.admin_notes}
                </div>
              )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            <Badge className="bg-muted text-muted-foreground border border-border text-[10px]">
              {t("adminHelpers.taskNotSubmitted")}
            </Badge>
            {showAdminUpload && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[11px] gap-1"
                onClick={onAdminUpload}
              >
                <Upload className="w-3 h-3" />
                {t("adminHelpers.uploadForTask")}
              </Button>
            )}
            {showRemind && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[11px] gap-1 border-primary/30 text-primary hover:bg-primary/10"
                disabled={remindLoading}
                onClick={onRemind}
              >
                {remindLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Bell className="w-3 h-3" />
                )}
                {t("adminHelpers.remindTask")}
              </Button>
            )}
          </div>
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
      <div className="flex items-center gap-2 flex-wrap">
        {!isRejecting && adminStatus !== "approved" && (
          <>
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
              className="h-7 px-3 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              <X className="w-3 h-3" />
              Reject
            </Button>
          </>
        )}
        {showReopen && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-[11px] gap-1.5"
            disabled={reopenLoading}
            onClick={onReopen}
          >
            {reopenLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RotateCcw className="w-3 h-3" />
            )}
            {t("adminHelpers.reopenTask")}
          </Button>
        )}
        {showAdminUpload && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-[11px] gap-1"
            onClick={onAdminUpload}
          >
            <Upload className="w-3 h-3" />
            {t("adminHelpers.uploadForTask")}
          </Button>
        )}
        {showRemind && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-[11px] gap-1.5 ml-auto"
            disabled={remindLoading}
            onClick={onRemind}
          >
            {remindLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Bell className="w-3 h-3" />
            )}
            {t("adminHelpers.remindTask")}
          </Button>
        )}
      </div>

      {isRejecting && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={rejectReason}
            onChange={(e) => onRejectReasonChange(e.target.value)}
            placeholder="Rejection reason (required)"
            className="min-h-[72px] text-xs"
          />
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onCancelReject}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-destructive hover:bg-destructive/90 text-white"
              disabled={!rejectReason.trim() || actionLoading}
              onClick={onConfirmReject}
            >
              Confirm reject
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

function parseReportDatesFromSummary(
  summaryMd?: string | null,
): { before?: string; after?: string } | null {
  if (!summaryMd) return null;
  const m = summaryMd.match(
    /Report dates:\s*\*?\*?([0-9]{4}-[0-9]{2}-[0-9]{2})\*?\*?\s*→\s*\*?\*?([0-9]{4}-[0-9]{2}-[0-9]{2})/i,
  );
  if (!m) return null;
  return { before: m[1], after: m[2] };
}

function ReportsTab({
  reports,
  pipelineStage,
  caseId,
  clientFirstName,
  onPdfUploaded,
}: {
  reports: any[];
  pipelineStage: string;
  caseId: number;
  clientFirstName: string;
  onPdfUploaded: (roundNumber: number) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleting, setDeleting] = useState<Record<number, boolean>>({});
  const [previewPdf, setPreviewPdf] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const inRounds = ROUND_STAGES.includes(pipelineStage);
  const suggestedRound = suggestReportRound(pipelineStage, reports);

  const getReport = (round: number) =>
    reports.find((r: any) => r.round_number === round);

  const getPdfs = (round: number): any[] => getReport(round)?.pdfs ?? [];

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
      <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
        <div>
          <p className="text-sm font-semibold">{t("reportWizard.panelTitle")}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {t("reportWizard.panelBlurb")}
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0"
          onClick={() => setWizardOpen(true)}
          disabled={!inRounds && pipelineStage !== "docs_ready"}
        >
          {t("reportWizard.generate")}
        </Button>
      </div>

      {/* Round timeline strip */}
      <div className="rounded-xl border border-border bg-card p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
          {t("reports.timelineTitle")}
        </p>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {[1, 2, 3, 4, 5].map((round) => {
            const active = isRoundActive(round, pipelineStage);
            const report = getReport(round);
            const pdfs = getPdfs(round);
            const dates = parseReportDatesFromSummary(report?.summary_md);
            return (
              <div
                key={round}
                className={[
                  "min-w-[72px] flex-1 rounded-lg border px-2 py-2 text-center",
                  pdfs.length > 0
                    ? "border-accent/30 bg-accent/[0.06]"
                    : active
                      ? "border-border bg-background"
                      : "border-border/40 bg-muted/20 opacity-60",
                ].join(" ")}
              >
                <div className="text-xs font-bold">R{round}</div>
                {report?.score_after != null ? (
                  <div className="text-[10px] text-accent font-semibold mt-0.5">
                    {report.score_after}
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    —
                  </div>
                )}
                {dates?.after && (
                  <div className="text-[9px] text-muted-foreground mt-0.5 truncate">
                    {dates.after}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <OfGReportWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        caseId={caseId}
        clientFirstName={clientFirstName}
        suggestedRound={suggestedRound}
        onPublished={() => {
          onPdfUploaded(suggestedRound);
          setWizardOpen(false);
        }}
      />

      {!inRounds && pipelineStage !== "docs_ready" && (
        <div className="flex items-start gap-2.5 rounded-xl bg-primary/[0.06] border border-primary/15 p-3">
          <Info className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("reportWizard.roundsLockedHint")}
          </p>
        </div>
      )}

      {[1, 2, 3, 4, 5].map((round) => {
        const active = isRoundActive(round, pipelineStage);
        const report = getReport(round);
        const pdfs = getPdfs(round);

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
                    {t("reportWizard.roundReportsTitle", { n: round })}
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
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2">
                    {report.score_before != null && (
                      <span>
                        {t("reportWizard.scoreLabel", {
                          before: report.score_before,
                          after: report.score_after ?? "—",
                        })}
                      </span>
                    )}
                    {report.items_removed > 0 && (
                      <span className="text-accent font-medium">
                        {t("reportWizard.itemsRemovedBadge", {
                          count: report.items_removed,
                        })}
                      </span>
                    )}
                    {(() => {
                      const dates = parseReportDatesFromSummary(
                        report.summary_md,
                      );
                      if (!dates?.before || !dates?.after) return null;
                      return (
                        <span>
                          {dates.before} → {dates.after}
                        </span>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>

            {active && (
              <div className="space-y-2">
                {pdfs.length > 0 ? (
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
                ) : (
                  <p className="text-[11px] text-muted-foreground rounded-lg border border-dashed border-border/60 px-3 py-2">
                    {t("reportWizard.noReportYet")}
                  </p>
                )}
              </div>
            )}

            {!active && pdfs.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                {ROUND_STAGES.includes(pipelineStage)
                  ? t("reportWizard.awaitingRound")
                  : t("reportWizard.notInRounds")}
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
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <ClientLabelsEditor clientId={client.id} initialLabels={client.labels} />
      <div className="bg-muted/40 rounded-xl p-4 space-y-2.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Contact
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-foreground/80">
            <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            {client.email ? (
              client.email
            ) : (
              <span className="italic text-muted-foreground/70">
                {t("adminHelpers.noEmailShort")}
              </span>
            )}
          </div>
          {client.phone && (
            <div className="flex items-center gap-2 text-foreground/80">
              <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              {client.phone}
            </div>
          )}
          {!client.email && (
            <NoEmailWarning hasPhone={!!client.phone} className="mt-2" />
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

// ─── Round calendar (case schedule) ───────────────────────────────────────────

function RoundCalendarPanel({ caseId }: { caseId: number }) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RoundScheduleInput>(emptyRoundScheduleInput());
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await dispatch(fetchCaseRoundSchedule(caseId));
      if (cancelled) return;
      if (fetchCaseRoundSchedule.fulfilled.match(res) && res.payload) {
        const s = res.payload;
        setDraft({
          round_1_date: s.round_1_date,
          round_2_date: s.round_2_date,
          round_3_date: s.round_3_date,
          round_4_date: s.round_4_date,
          round_5_date: s.round_5_date,
          interval_days: s.interval_days,
          send_calendar: false,
        });
        setLastSentAt(s.last_sent_at);
      } else {
        setDraft(emptyRoundScheduleInput());
        setLastSentAt(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [caseId, dispatch]);

  const handleSave = async (alsoSend: boolean) => {
    setSaving(true);
    try {
      const res = await dispatch(
        saveCaseRoundSchedule({
          caseId,
          schedule: { ...draft, send_calendar: alsoSend },
        }),
      ).unwrap();
      toast({
        title: alsoSend
          ? t("adminPipeline.roundCalendarSent")
          : t("adminPipeline.roundCalendarSaved"),
        description:
          alsoSend && res.sent_to?.length
            ? res.sent_to.join(", ")
            : undefined,
      });
      if (res.schedule?.last_sent_at) setLastSentAt(res.schedule.last_sent_at);
      setDraft((d) => ({ ...d, send_calendar: false }));
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message ?? "Could not save schedule",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResend = async () => {
    setSending(true);
    try {
      const res = await dispatch(sendCaseRoundCalendar(caseId)).unwrap();
      toast({
        title: t("adminPipeline.roundCalendarSent"),
        description: res.sent_to?.join(", "),
      });
      setLastSentAt(new Date().toISOString());
    } catch (e: any) {
      toast({
        title: "Error",
        description: e?.message ?? "Could not send calendar",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <RoundCalendarScheduleFields
        value={draft}
        onChange={setDraft}
        disabled={saving || sending}
      />
      {lastSentAt && (
        <p className="text-[11px] text-muted-foreground">
          {t("adminPipeline.roundCalendarLastSent", {
            when: new Date(lastSentAt).toLocaleString(),
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving || sending}
          onClick={() => void handleSave(!!draft.send_calendar)}
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
          ) : null}
          {t("adminPipeline.roundCalendarSave")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={saving || sending}
          onClick={() => void handleResend()}
          className="gap-1.5"
        >
          {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {t("adminPipeline.roundCalendarResend")}
        </Button>
      </div>
    </div>
  );
}

// ─── PaymentScheduleTab ────────────────────────────────────────────────────────

function PaymentScheduleTab({ caseId }: { caseId: number }) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { caseSplits, caseSplitsLoading } = useAppSelector((s) => s.admin);
  const [draft, setDraft] = useState<InstallmentDraft | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    dispatch(fetchCaseSplits(caseId));
  }, [caseId, dispatch]);

  const fmtMoney = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(cents / 100);

  const refresh = () => dispatch(fetchCaseSplits(caseId));

  const handleAdd = async () => {
    if (!draft || !draft.amount || !draft.due_date) {
      toast({
        title: "Amount and due date required",
        variant: "destructive",
      });
      return;
    }
    setAdding(true);
    try {
      await dispatch(
        createCaseSplit({
          caseId,
          split: draftToCreateSplitPayload(draft),
        }),
      ).unwrap();
      toast({ title: "Installment added" });
      setDraft(null);
      refresh();
    } catch {
      toast({
        title: "Error",
        description: "Could not add installment",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  if (caseSplitsLoading && caseSplits.length === 0) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
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
          {fmtMoney(paid)} / {fmtMoney(total || 0)}
        </span>
      </div>

      {caseSplits.length === 0 && !draft && (
        <p className="text-sm text-muted-foreground py-2">
          No payment schedule for this case.
        </p>
      )}

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
                : "bg-secondary text-secondary-foreground border-border";
        const hasLink = !!(sp.payment_link || sp.payment_token);

        return (
          <div
            key={sp.id}
            className="flex items-center justify-between gap-2 bg-card border border-border rounded-xl px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {sp.label}
              </p>
              <p className="text-xs text-muted-foreground">
                Due{" "}
                {new Date(sp.due_date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {" · "}
                {hasLink
                  ? t("adminPipeline.hasPayLink")
                  : sp.status === "paid"
                    ? t("adminPipeline.modePaid")
                    : t("adminPipeline.modeManual")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${badgeClass}`}
              >
                {eff.charAt(0).toUpperCase() + eff.slice(1)}
              </span>
              <span className="text-sm font-bold">{fmtMoney(sp.amount_cents)}</span>
              <AdminSplitActions split={sp} onDone={refresh} />
            </div>
          </div>
        );
      })}

      {draft ? (
        <div className="space-y-2">
          <InstallmentDraftFields
            draft={draft}
            onChange={setDraft}
            hideRemove
          />
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDraft(null)}
              disabled={adding}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleAdd} disabled={adding}>
              {adding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : null}
              {t("adminPipeline.addInstallment")}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDraft(emptyInstallmentDraft(caseSplits.length + 1))}
          className="text-xs text-primary hover:underline font-semibold"
        >
          + {t("adminPipeline.addInstallment")}
        </button>
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

// ─── ClientPanelSheet ─────────────────────────────────────────────────────────

export interface ClientPanelSheetProps {
  open: boolean;
  caseId: number | null;
  clientId: number | null;
  onClose: () => void;
  onCaseUpdated: () => void;
  /** Open convert confirmation for a prospect lead (Pipeline wires ConvertProspectDialog). */
  onConvertProspect?: (prospect: Prospect) => void;
}

export function ClientPanelSheet({
  open,
  caseId,
  clientId,
  onClose,
  onCaseUpdated,
  onConvertProspect,
}: ClientPanelSheetProps) {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { panelClient: pd, panelLoading, caseDocuments, caseDocumentsLoading } =
    useAppSelector((s) => s.admin);
  const {
    clientCompletions,
    caseCompletions,
    caseCompletionsLoading,
    clientCompletionsLoading,
    saving: taskSaving,
  } = useAppSelector((s) => s.adminTasks);

  const [panelTab, setPanelTab] = useState<
    "overview" | "tasks" | "requests" | "reports" | "history" | "schedule"
  >("tasks");
  const prospectTabInitialized = useRef(false);
  const [rejectingTaskId, setRejectingTaskId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadPrefillDocType, setUploadPrefillDocType] = useState<
    string | null
  >(null);
  const [remindTarget, setRemindTarget] = useState<any | null>(null);
  const [remindSending, setRemindSending] = useState(false);
  const [reopenTarget, setReopenTarget] = useState<any | null>(null);
  const [reopenNotify, setReopenNotify] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenSending, setReopenSending] = useState(false);
  const { toast } = useToast();

  // Fetch panel data when opening
  useEffect(() => {
    if (!open) return;
    prospectTabInitialized.current = false;
    if (caseId) {
      dispatch(fetchPanelCase(caseId));
      dispatch(fetchCaseTaskCompletions(caseId));
      dispatch(fetchCaseDocuments(caseId));
      setPanelTab("tasks");
    } else if (clientId) {
      dispatch(fetchPanelClient(clientId));
      dispatch(fetchClientTaskCompletions(clientId));
      setPanelTab("overview");
    }
  }, [open, caseId, clientId, dispatch]);

  // Prospects land on Overview (tasks aren't assigned until convert)
  useEffect(() => {
    if (!open || !pd || prospectTabInitialized.current) return;
    if (isProspectLead(pd.client)) {
      setPanelTab("overview");
      prospectTabInitialized.current = true;
    } else if (caseId) {
      prospectTabInitialized.current = true;
    }
  }, [open, caseId, clientId, pd]);

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
  const panelCompletions: any[] = caseId
    ? (caseCompletions[caseId] ?? pd?.documents ?? [])
    : clientId
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
    if (!clientId || !caseId) return;
    setActionLoadingId(completionId);
    await dispatch(
      reviewTaskCompletion({
        completionId,
        admin_review_status: "approved",
        clientId,
        caseId,
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
    if (!clientId || !caseId || !rejectReason.trim()) return;
    setActionLoadingId(completionId);
    await dispatch(
      reviewTaskCompletion({
        completionId,
        admin_review_status: "rejected",
        admin_notes: rejectReason,
        clientId,
        caseId,
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

  const handleConfirmRemind = async () => {
    const templateId = Number(
      remindTarget?.template_id ?? remindTarget?.task_template_id,
    );
    if (!caseId || !templateId) return;
    setRemindSending(true);
    const res = await dispatch(
      sendTaskReminder({
        caseId,
        templateId,
      }),
    );
    setRemindSending(false);
    if (sendTaskReminder.fulfilled.match(res)) {
      const p = res.payload;
      toast({
        title: t("adminHelpers.remindTaskToastTitle"),
        description: t("adminHelpers.remindTaskToastBody", {
          task: p.task_title,
          email: p.emailed,
          hours: p.expires_hours,
        }),
      });
      setRemindTarget(null);
      return;
    }
    toast({
      title: t("adminHelpers.remindTaskFailed"),
      description: String(res.payload || "Please try again"),
      variant: "destructive",
    });
  };

  const openAdminUploadForTask = (completion: any) => {
    setUploadPrefillDocType(taskSlugToDocType(completion?.slug));
    setUploadDialogOpen(true);
  };

  const handleConfirmReopen = async () => {
    const completionId = Number(reopenTarget?.id);
    if (!caseId || !completionId) return;
    setReopenSending(true);
    const taskLabel =
      reopenTarget?.title_en ||
      reopenTarget?.slug ||
      t("adminHelpers.remindTaskFallback");
    const reopenTaskType = reopenTarget?.task_type;
    const reopenSlug = reopenTarget?.slug as string | undefined;
    const notifyWasOn = reopenNotify;
    const res = await dispatch(
      reopenTaskCompletion({
        completionId,
        caseId,
        notify_client: reopenNotify,
        reason: reopenReason.trim() || undefined,
      }),
    );
    setReopenSending(false);
    if (reopenTaskCompletion.fulfilled.match(res)) {
      const p = res.payload;
      const parts = buildReopenToastParts({
        taskLabel,
        notified: p.notified,
        emailed: p.emailed,
        stageRolledBack: p.stage_rolled_back,
        notifyError: p.notify_error,
        body: t("adminHelpers.reopenTaskToastBody", { task: taskLabel }),
        notifiedText: p.emailed
          ? t("adminHelpers.reopenTaskToastNotified", { email: p.emailed })
          : "",
        silentText: t("adminHelpers.reopenTaskToastSilent"),
        rolledBackText: t("adminHelpers.reopenTaskToastRolledBack"),
        notifyErrorText: t("adminHelpers.reopenTaskToastNotifyFailed"),
      });
      toast({
        title: t("adminHelpers.reopenTaskToastTitle"),
        description: parts.join(" "),
      });
      setReopenTarget(null);
      setReopenNotify(false);
      setReopenReason("");
      dispatch(fetchPanelCase(caseId));
      onCaseUpdated();
      // Smart: if admin is not emailing the client, open upload for this task
      const docType = taskSlugToDocType(reopenSlug);
      if (!notifyWasOn && reopenTaskType === "upload" && docType) {
        setUploadPrefillDocType(docType);
        setUploadDialogOpen(true);
      }
      return;
    }
    toast({
      title: t("adminHelpers.reopenTaskFailed"),
      description: String(res.payload || "Please try again"),
      variant: "destructive",
    });
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

  const openCaseDocPreview = useCallback(async (doc: {
    id: number;
    file_name: string;
    mime_type?: string;
  }) => {
    setPreviewDoc({
      file_name: doc.file_name,
      file_mime: doc.mime_type,
    });
    setPreviewLoading(true);
    setPreviewUrl(null);
    try {
      const resp = await api.get(`/admin/client-documents/${doc.id}/file`, {
        responseType: "blob",
      });
      setPreviewUrl(URL.createObjectURL(resp.data as Blob));
    } catch {
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const isPreviewImage = previewDoc?.file_mime?.startsWith("image/");
  const isPreviewPdf = previewDoc?.file_mime === "application/pdf";
  const isProspect = isProspectLead(pd?.client, {
    hasEnrolledCase: Boolean(
      pd?.case_info &&
        pd.case_info.status === "active" &&
        pd.case_info.pipeline_stage &&
        pd.case_info.pipeline_stage !== "prospect",
    ),
  });
  const resolvedCaseId = caseId ?? pd?.case_info?.id ?? null;

  const handleConvertClick = () => {
    if (!pd?.client || !onConvertProspect) return;
    onConvertProspect({
      id: Number(pd.client.id),
      first_name: String(pd.client.first_name ?? ""),
      last_name: String(pd.client.last_name ?? ""),
      email: String(pd.client.email ?? ""),
      phone: pd.client.phone ?? null,
      preferred_language: pd.client.preferred_language ?? null,
      case_id: resolvedCaseId,
      case_number: pd.case_info?.case_number ?? null,
      created_at: String(pd.client.created_at ?? new Date().toISOString()),
    });
  };

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
                      {pd.case_info?.case_number ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold bg-primary/10 text-primary border border-primary/25 px-2 py-0.5 rounded-md shrink-0">
                          <Hash className="w-3 h-3" />
                          {pd.case_info.case_number}
                        </span>
                      ) : isProspect ? (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-bold bg-accent/15 text-accent border border-accent/30 px-2 py-0.5 rounded-full shrink-0"
                          data-testid="panel-prospect-badge"
                        >
                          <UserPlus className="w-2.5 h-2.5" />
                          {t("adminPipeline.panelProspectBadge")}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {pd.client.email || t("adminHelpers.noEmailShort")}
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
                    <AdminAskCaseButton
                      caseId={pd.case_info?.id ?? caseId}
                      caseNumber={pd.case_info?.case_number ?? null}
                      clientId={pd.client?.id ?? clientId}
                    />
                    <ClientPanelConversationButton
                      clientId={pd.client?.id ?? clientId}
                    />
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

              {isProspect && (
                <div
                  className="mx-5 mt-4 rounded-xl border border-accent/30 bg-accent/5 px-3.5 py-3"
                  data-testid="panel-prospect-banner"
                >
                  <div className="flex items-start gap-3">
                    <UserPlus className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {t("adminPipeline.panelProspectBannerTitle")}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {resolvedCaseId
                            ? t("adminPipeline.panelProspectBannerBodyWithCase")
                            : t("adminPipeline.panelProspectBannerBody")}
                        </p>
                      </div>
                      {onConvertProspect && (
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={handleConvertClick}
                          data-testid="panel-prospect-convert"
                        >
                          <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                          {t("adminPipeline.panelProspectConvertCta")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {(pd.sibling_cases?.length ?? 0) > 0 && (
                <div className="mx-5 mt-4 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Duplicate active case detected</p>
                      <p className="mt-1 text-destructive/90 leading-relaxed">
                        This client has other active cases (
                        {pd.sibling_cases
                          ?.map((s: { case_number: string }) => s.case_number)
                          .join(", ")}
                        ). Onboarding tasks are scoped to{" "}
                        {pd.case_info?.case_number}. Cancel extra cases to avoid
                        pipeline confusion.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div className="flex border-b border-border shrink-0 bg-muted/30 overflow-x-auto">
                {(
                  [
                    "overview",
                    "tasks",
                    "requests",
                    "reports",
                    "history",
                    "schedule",
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setPanelTab(tab)}
                    className={[
                      "flex-1 min-w-[4.5rem] py-3 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2",
                      panelTab === tab
                        ? "text-primary border-primary"
                        : "text-muted-foreground border-transparent hover:text-foreground",
                    ].join(" ")}
                  >
                    {tab === "tasks"
                      ? `Tasks (${approvedCount}/${requiredCount})`
                      : tab === "schedule"
                        ? "Schedule"
                        : tab === "requests"
                          ? "Requests"
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
                    {isProspect ? (
                      <div
                        className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center space-y-3"
                        data-testid="panel-prospect-tasks-empty"
                      >
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {t("adminPipeline.panelProspectTasksEmpty")}
                        </p>
                        {onConvertProspect && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleConvertClick}
                          >
                            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                            {t("adminPipeline.panelProspectConvertCta")}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <>
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-[11px] text-muted-foreground font-medium">
                        Case onboarding tasks
                      </span>
                      <span className="font-mono text-[10px] font-bold text-primary/70 bg-primary/8 border border-primary/15 px-1.5 py-0.5 rounded">
                        {pd.case_info?.case_number ?? ""}
                      </span>
                    </div>
                    {(caseCompletionsLoading || clientCompletionsLoading) &&
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
                          remindLoading={
                            remindSending &&
                            (remindTarget?.template_id ??
                              remindTarget?.task_template_id) ===
                              (completion.template_id ??
                                completion.task_template_id)
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
                          onRemind={
                            caseId &&
                            (completion.template_id ||
                              completion.task_template_id)
                              ? () => setRemindTarget(completion)
                              : undefined
                          }
                          onReopen={
                            caseId && completion.id
                              ? () => {
                                  setReopenTarget(completion);
                                  setReopenNotify(false);
                                  setReopenReason("");
                                }
                              : undefined
                          }
                          onAdminUpload={
                            caseId &&
                            completion.task_type === "upload" &&
                            taskSlugToDocType(completion.slug)
                              ? () => openAdminUploadForTask(completion)
                              : undefined
                          }
                          reopenLoading={
                            reopenSending &&
                            reopenTarget?.id === completion.id
                          }
                        />
                      ))
                    )}

                    {caseId && (
                      <div className="mt-4 pt-4 border-t border-border space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground font-medium">
                            {t("adminHelpers.caseDocuments")}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px] gap-1.5"
                            onClick={() => {
                              setUploadPrefillDocType(null);
                              setUploadDialogOpen(true);
                            }}
                          >
                            <Upload className="w-3 h-3" />
                            {t("adminHelpers.uploadCaseDocs")}
                          </Button>
                        </div>
                        {caseDocumentsLoading && caseDocuments.length === 0 ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : caseDocuments.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2 text-center">
                            {t("adminHelpers.caseDocumentsEmpty")}
                          </p>
                        ) : (
                          <ul className="space-y-1.5">
                            {caseDocuments.map((doc: any) => {
                              const uploader =
                                doc.uploaded_by_first_name ||
                                doc.uploaded_by_last_name
                                  ? `${doc.uploaded_by_first_name ?? ""} ${doc.uploaded_by_last_name ?? ""}`.trim()
                                  : t("adminHelpers.uploadedByClient");
                              return (
                                <li
                                  key={doc.id}
                                  className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2"
                                >
                                  <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs font-medium truncate">
                                      {doc.file_name}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground mt-0.5">
                                      {t(`adminHelpers.docTypes.${doc.doc_type}`, {
                                        defaultValue: doc.doc_type,
                                      })}
                                      {" · "}
                                      {t("adminHelpers.uploadedBy")} {uploader}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => openCaseDocPreview(doc)}
                                    className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline shrink-0"
                                  >
                                    <Eye className="w-3 h-3" />
                                    {t("adminHelpers.viewDocument")}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}

                    <div className="mt-2 rounded-xl bg-primary/[0.06] border border-primary/15 p-3 text-[11px] text-muted-foreground leading-relaxed">
                      Approving all required tasks auto-advances the client to{" "}
                      <span className="text-primary font-semibold">
                        Docs Verified
                      </span>
                      . Dragging to that stage is blocked until all required
                      tasks are approved.
                    </div>
                      </>
                    )}
                  </div>
                )}

                {panelTab === "requests" &&
                  (resolvedCaseId ? (
                  <InfoRequestsTab
                    caseId={resolvedCaseId}
                    onChanged={() => {
                      onCaseUpdated();
                    }}
                  />
                  ) : (
                    <p
                      className="text-sm text-muted-foreground py-8 text-center"
                      data-testid="panel-prospect-needs-case"
                    >
                      {t("adminPipeline.panelProspectNeedsCase")}
                    </p>
                  ))}

                {panelTab === "history" && (
                  <HistoryTab history={panelHistory} />
                )}

                {panelTab === "schedule" &&
                  (resolvedCaseId ? (
                  <div className="space-y-6">
                    <RoundCalendarPanel caseId={resolvedCaseId} />
                    {!isProspect && (
                      <PaymentScheduleTab caseId={resolvedCaseId} />
                    )}
                  </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      {t("adminPipeline.panelProspectNeedsCase")}
                    </p>
                  ))}

                {panelTab === "reports" &&
                  (clientId && resolvedCaseId && !isProspect ? (
                  <ReportsTab
                    reports={panelReports}
                    pipelineStage={
                      pd?.case_info?.pipeline_stage ??
                      pd?.client?.pipeline_stage ??
                      ""
                    }
                    caseId={resolvedCaseId}
                    clientFirstName={String(pd.client.first_name || "Client")}
                    onPdfUploaded={() => {
                      if (resolvedCaseId)
                        dispatch(fetchPanelCase(resolvedCaseId));
                    }}
                  />
                  ) : (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      {isProspect
                        ? t("adminPipeline.panelProspectReportsEmpty")
                        : t("adminPipeline.panelProspectNeedsCase")}
                    </p>
                  ))}
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

      {caseId && (
        <AdminCaseDocUploadDialog
          open={uploadDialogOpen}
          onOpenChange={(open) => {
            setUploadDialogOpen(open);
            if (!open) setUploadPrefillDocType(null);
          }}
          caseId={caseId}
          initialDocType={uploadPrefillDocType}
          onSuccess={() => {
            dispatch(fetchCaseDocuments(caseId));
            dispatch(fetchCaseTaskCompletions(caseId));
            dispatch(fetchPanelCase(caseId));
            onCaseUpdated();
          }}
        />
      )}

      <AlertDialog
        open={!!remindTarget}
        onOpenChange={(v) => {
          if (!v && !remindSending) setRemindTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("adminHelpers.remindTaskConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminHelpers.remindTaskConfirmBody", {
                task:
                  remindTarget?.title_en ||
                  remindTarget?.slug ||
                  t("adminHelpers.remindTaskFallback"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remindSending}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remindSending}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmRemind();
              }}
              className="gap-1.5"
            >
              {remindSending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Bell className="w-3.5 h-3.5" />
              )}
              {t("adminHelpers.remindTaskConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReopenTaskDialog
        open={!!reopenTarget}
        task={reopenTarget}
        pipelineStage={
          pd?.case_info?.pipeline_stage ?? pd?.client?.pipeline_stage ?? null
        }
        notifyClient={reopenNotify}
        reason={reopenReason}
        sending={reopenSending}
        onOpenChange={(open) => {
          if (!open && !reopenSending) {
            setReopenTarget(null);
            setReopenNotify(false);
            setReopenReason("");
          }
        }}
        onNotifyChange={setReopenNotify}
        onReasonChange={setReopenReason}
        onConfirm={() => void handleConfirmReopen()}
        onCancel={() => {
          setReopenTarget(null);
          setReopenNotify(false);
          setReopenReason("");
        }}
      />
    </>
  );
}

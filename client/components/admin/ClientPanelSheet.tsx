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
  Pencil,
  Check,
  Trash2,
  Send,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPanelCase,
  fetchPanelClient,
  fetchPipeline,
  clearPanelClient,
  previewRoundReportReset,
  updateCaseExtendedRounds,
  confirmRoundReportReset,
  resendRoundReportPdf,
  fetchCaseSplits,
  createCaseSplit,
  fetchCaseDocuments,
  deleteCaseDocument,
  fetchCaseRoundSchedule,
  saveCaseRoundSchedule,
  sendCaseRoundCalendar,
  fetchClientReferrers,
  replaceClientReferrers,
  updateAdminClient,
  type RoundReportResetPreview,
} from "@/store/slices/adminSlice";
import {
  fetchCaseTaskCompletions,
  fetchClientTaskCompletions,
  reviewTaskCompletion,
  sendTaskReminder,
  reopenTaskCompletion,
} from "@/store/slices/adminTasksSlice";
import type {
  OnboardingTaskType,
  Prospect,
  ReferralCategory,
  RoundScheduleInput,
} from "@shared/api";
import AdminSplitActions from "@/components/admin/AdminSplitActions";
import { AdminAskCaseButton } from "@/components/admin/AdminAskDrawer";
import { ClientPanelConversationButton } from "@/components/admin/ClientPanelConversationButton";
import { ContactPhoneActions } from "@/components/admin/ContactPhoneActions";
import ClientReferrersEditor, {
  emptyReferrerSlots,
  linksToReferrerSlots,
  referrerSlotsToApiPayload,
  type ClientReferrerSlotDraft,
} from "@/components/admin/ClientReferrersEditor";
import ClientCmsCredentialsCard from "@/components/admin/ClientCmsCredentialsCard";
import InstallmentDraftFields, {
  emptyInstallmentDraft,
  draftToCreateSplitPayload,
  type InstallmentDraft,
} from "@/components/admin/InstallmentDraftFields";
import RoundCalendarScheduleFields, {
  emptyRoundScheduleInput,
} from "@/components/admin/RoundCalendarScheduleFields";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import api from "@/lib/api";
import { LangBadge } from "@/components/ui/lang-badge";
import { useToast } from "@/hooks/use-toast";
import { ClientStatusNotesCard } from "@/components/admin/ClientStatusNotesCard";
import { ClientHoldBadge } from "@/components/admin/ClientHoldBadge";
import { LeadTemperatureCard } from "@/components/admin/LeadTemperatureCard";
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
import { isReportRoundActive } from "@/lib/pipelineStage";
import {
  ABSOLUTE_MAX_ROUNDS,
  clampMaxRounds,
  DEFAULT_MAX_ROUNDS,
  extendedRoundsLegend,
  roundOptionsForMax,
} from "@/lib/extendedRounds";
import ProspectCreditAnalysisSection from "@/components/credit/ProspectCreditAnalysisSection";
import ClientPreSaleAnalysisCard from "@/components/credit/ClientPreSaleAnalysisCard";
import { clearAdminCreditAnalysis } from "@/store/slices/creditAnalysisSlice";

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
  onResend,
  resending,
}: {
  pdf: any;
  onView: (pdf: any) => void;
  onResend: (pdf: any) => void;
  resending: boolean;
}) {
  const { t } = useTranslation();
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
      <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => onResend(pdf)}
          disabled={resending}
          title={t("reportWizard.resendRoundTitle")}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-accent hover:text-accent/90 bg-accent/10 hover:bg-accent/15 border border-accent/25 px-2 py-1 rounded-md transition-colors disabled:opacity-50"
          data-testid="resend-round-pdf"
        >
          {resending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Send className="w-3 h-3" />
          )}
          {t("reportWizard.resendRound")}
        </button>
        <button
          type="button"
          onClick={() => onView(pdf)}
          className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 bg-primary/8 hover:bg-primary/12 border border-primary/15 px-2 py-1 rounded-md transition-colors"
        >
          <Eye className="w-3 h-3" /> {t("reportWizard.viewPdf")}
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
  wizardSessions,
  pipelineStage,
  caseId,
  clientId,
  clientFirstName,
  preferredLanguage,
  maxRounds: maxRoundsProp,
  nextDisputeTargetDate,
  reportCompareMode: reportCompareModeProp,
  onPdfUploaded,
  onExtendedRoundsSaved,
}: {
  reports: any[];
  wizardSessions: Array<{
    id: number;
    round_number: number;
    status: string;
  }>;
  pipelineStage: string;
  caseId: number;
  clientId: number;
  clientFirstName: string;
  preferredLanguage?: "en" | "es" | null;
  maxRounds?: number;
  nextDisputeTargetDate?: string | null;
  reportCompareMode?: "baseline" | "chain";
  onPdfUploaded: (roundNumber: number) => void;
  onExtendedRoundsSaved?: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { user } = useAppSelector((s) => s.adminAuth);
  const canResetRound =
    user?.role === "admin" || user?.role === "super_admin";
  const maxRounds = clampMaxRounds(maxRoundsProp ?? DEFAULT_MAX_ROUNDS);
  const roundList = roundOptionsForMax(maxRounds);
  const compareMode: "baseline" | "chain" =
    reportCompareModeProp === "chain" ? "chain" : "baseline";
  const [maxRoundsDraft, setMaxRoundsDraft] = useState(String(maxRounds));
  const [compareModeDraft, setCompareModeDraft] = useState<"baseline" | "chain">(
    compareMode,
  );
  const [nextDateDraft, setNextDateDraft] = useState(
    nextDisputeTargetDate || "",
  );
  const [savingExtended, setSavingExtended] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [resending, setResending] = useState<Record<number, boolean>>({});
  const [resendConfirmPdf, setResendConfirmPdf] = useState<any | null>(null);
  const [previewPdf, setPreviewPdf] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [resetRound, setResetRound] = useState<number | null>(null);
  const [resetPreview, setResetPreview] =
    useState<RoundReportResetPreview | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);

  const inRounds = ROUND_STAGES.includes(pipelineStage);
  const highestPublished = reports.reduce((h, r) => {
    const n = Number(r?.round_number);
    return Number.isFinite(n) && n > h ? n : h;
  }, 0);
  const suggestedRound = suggestReportRound(
    pipelineStage,
    reports,
    maxRounds,
  );

  useEffect(() => {
    setMaxRoundsDraft(String(maxRounds));
    setCompareModeDraft(compareMode);
    setNextDateDraft(nextDisputeTargetDate || "");
  }, [maxRounds, compareMode, nextDisputeTargetDate, caseId]);

  const saveExtendedRounds = async () => {
    const nextMax = clampMaxRounds(Number(maxRoundsDraft));
    setSavingExtended(true);
    try {
      const result = await dispatch(
        updateCaseExtendedRounds({
          caseId,
          max_rounds: nextMax,
          next_dispute_target_date: nextDateDraft.trim()
            ? nextDateDraft.trim()
            : null,
          report_compare_mode: compareModeDraft,
        }),
      ).unwrap();
      toast({
        title: result.case.reopened_to_round_5
          ? t("reportWizard.extendedRoundsReopened")
          : t("reportWizard.extendedRoundsSaved"),
      });
      onExtendedRoundsSaved?.();
      // Refresh board so Completed → Round 5 reopen moves the card immediately.
      void dispatch(fetchPipeline(undefined));
    } catch (err) {
      toast({
        variant: "destructive",
        title: t("reportWizard.extendedRoundsSaveFailed"),
        description: typeof err === "string" ? err : undefined,
      });
    } finally {
      setSavingExtended(false);
    }
  };

  const getReport = (round: number) =>
    reports.find((r: any) => r.round_number === round);

  const getPdfs = (round: number): any[] => getReport(round)?.pdfs ?? [];

  const getSessions = (round: number) =>
    wizardSessions.filter((s) => Number(s.round_number) === round);

  const hasResettableData = (round: number) =>
    !!(getReport(round) || getPdfs(round).length > 0 || getSessions(round).length > 0);

  const openResetDialog = async (round: number) => {
    setResetRound(round);
    setResetPreview(null);
    setResetLoading(true);
    try {
      const result = await dispatch(
        previewRoundReportReset({ clientId, roundNumber: round }),
      ).unwrap();
      setResetPreview(result.preview || null);
    } catch (err) {
      setResetRound(null);
      toast({
        variant: "destructive",
        title: t("reportWizard.resetRoundErrorTitle"),
        description:
          typeof err === "string" ? err : t("reportWizard.resetRoundErrorBody"),
      });
    } finally {
      setResetLoading(false);
    }
  };

  const handleResetConfirm = async () => {
    if (resetRound == null || resetConfirming) return;
    const roundBeingReset = resetRound;
    setResetConfirming(true);
    try {
      await dispatch(
        confirmRoundReportReset({
          clientId,
          roundNumber: roundBeingReset,
        }),
      ).unwrap();
      setResetRound(null);
      setResetPreview(null);
      toast({
        title: t("reportWizard.resetRoundSuccessTitle"),
        description: t("reportWizard.resetRoundSuccessBody", {
          round: roundBeingReset,
        }),
      });
      dispatch(fetchPanelClient(clientId));
      dispatch(fetchPanelCase(caseId));
      onPdfUploaded(roundBeingReset);
    } catch (err) {
      toast({
        variant: "destructive",
        title: t("reportWizard.resetRoundErrorTitle"),
        description:
          typeof err === "string" ? err : t("reportWizard.resetRoundErrorBody"),
      });
    } finally {
      setResetConfirming(false);
    }
  };

  const handleResendConfirm = async () => {
    const pdf = resendConfirmPdf;
    if (!pdf || resending[pdf.id]) return;
    setResending((p) => ({ ...p, [pdf.id]: true }));
    try {
      const result = await dispatch(
        resendRoundReportPdf({ pdfId: pdf.id }),
      ).unwrap();
      setResendConfirmPdf(null);
      toast({
        title: t("reportWizard.resendRoundSuccessTitle"),
        description: t("reportWizard.resendRoundSuccessBody", {
          round: result.round_number,
          partners: result.partners_emailed,
        }),
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: t("reportWizard.resendRoundErrorTitle"),
        description:
          typeof err === "string" ? err : t("reportWizard.resendRoundErrorBody"),
      });
    } finally {
      setResending((p) => ({ ...p, [pdf.id]: false }));
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
          <p className="text-sm font-semibold">
            {t("reportWizard.panelTitle")}
          </p>
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
          {roundList.map((round) => {
            const active = isReportRoundActive(
              round,
              pipelineStage,
              maxRounds,
              highestPublished,
            );
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
        clientPreferredLanguage={preferredLanguage === "es" ? "es" : "en"}
        suggestedRound={suggestedRound}
        maxRounds={maxRounds}
        compareMode={compareMode}
        onPublished={() => {
          onPdfUploaded(suggestedRound);
          setWizardOpen(false);
        }}
      />

      <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-foreground">
            {t("reportWizard.extendedRoundsTitle")}
          </p>
          {extendedRoundsLegend({
            maxRounds,
            highestPublished,
          }) ? (
            <span className="text-[10px] font-bold bg-secondary text-secondary-foreground border border-border px-1.5 py-0.5 rounded-full">
              {extendedRoundsLegend({
                maxRounds,
                highestPublished,
              })}
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {t("reportWizard.extendedRoundsHint")}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">
              {t("reportWizard.maxRoundsLabel")}
            </label>
            <Select
              value={maxRoundsDraft}
              onValueChange={setMaxRoundsDraft}
            >
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from(
                  { length: ABSOLUTE_MAX_ROUNDS - DEFAULT_MAX_ROUNDS + 1 },
                  (_, i) => DEFAULT_MAX_ROUNDS + i,
                ).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === DEFAULT_MAX_ROUNDS
                      ? t("reportWizard.maxRoundsStandard", { n })
                      : t("reportWizard.maxRoundsSpecial", { n })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">
              {t("reportWizard.compareModeLabel")}
            </label>
            <Select
              value={compareModeDraft}
              onValueChange={(v) =>
                setCompareModeDraft(v === "chain" ? "chain" : "baseline")
              }
            >
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="baseline">
                  {t("reportWizard.compareModeBaseline")}
                </SelectItem>
                <SelectItem value="chain">
                  {t("reportWizard.compareModeChain")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
              {t("reportWizard.compareModeHint")}
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="text-[11px] font-medium text-muted-foreground">
              {t("reportWizard.nextDisputeDateLabel")}
            </label>
            <Input
              type="date"
              className="mt-1 h-9"
              value={nextDateDraft}
              onChange={(e) => setNextDateDraft(e.target.value)}
            />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={savingExtended}
          onClick={() => void saveExtendedRounds()}
        >
          {savingExtended ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : null}
          {t("reportWizard.extendedRoundsSave")}
        </Button>
      </div>

      {!inRounds && pipelineStage !== "docs_ready" && (
        <div className="flex items-start gap-2.5 rounded-xl bg-primary/[0.06] border border-primary/15 p-3">
          <Info className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("reportWizard.roundsLockedHint")}
          </p>
        </div>
      )}

      {roundList.map((round) => {
        const active = isReportRoundActive(
          round,
          pipelineStage,
          maxRounds,
          highestPublished,
        );
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
                <div className="flex items-center gap-2 flex-wrap">
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
                  {!report &&
                    pdfs.length === 0 &&
                    getSessions(round).length > 0 && (
                      <span className="text-[9px] font-bold bg-primary/10 text-primary border border-primary/25 px-1.5 py-0.5 rounded-full">
                        {t("reportWizard.wizardSessionBadge", {
                          status: getSessions(round)[0]?.status || "draft",
                        })}
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
              {canResetRound && hasResettableData(round) && (
                <button
                  type="button"
                  onClick={() => void openResetDialog(round)}
                  className="inline-flex items-center gap-1 shrink-0 text-[10px] font-semibold text-destructive hover:text-destructive/90 bg-destructive/10 hover:bg-destructive/15 border border-destructive/25 px-2 py-1 rounded-md transition-colors"
                  data-testid={`reset-round-${round}`}
                >
                  <RotateCcw className="w-3 h-3" />
                  {t("reportWizard.resetRound")}
                </button>
              )}
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
                        onResend={(pdf) => setResendConfirmPdf(pdf)}
                        resending={!!resending[pdf.id]}
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

      <AlertDialog
        open={!!resendConfirmPdf}
        onOpenChange={(o) => {
          if (!o && !(resendConfirmPdf && resending[resendConfirmPdf.id])) {
            setResendConfirmPdf(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("reportWizard.resendRoundConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("reportWizard.resendRoundConfirmBody", {
                round: resendConfirmPdf?.round_number ?? "",
                file: resendConfirmPdf?.file_name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={
                !!(resendConfirmPdf && resending[resendConfirmPdf.id])
              }
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !!(resendConfirmPdf && resending[resendConfirmPdf.id])
              }
              onClick={(e) => {
                e.preventDefault();
                void handleResendConfirm();
              }}
            >
              {resendConfirmPdf && resending[resendConfirmPdf.id] ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              {t("reportWizard.resendRoundConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={resetRound != null}
        onOpenChange={(o) => {
          if (!o && !resetConfirming && !resetLoading) {
            setResetRound(null);
            setResetPreview(null);
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("reportWizard.resetRoundConfirmTitle", {
                round: resetRound ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {resetLoading && (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("reportWizard.resetRoundLoading")}
                  </div>
                )}
                {!resetLoading && resetPreview && (
                  <>
                    <p>{t("reportWizard.resetRoundConfirmIntro")}</p>
                    <ul className="list-disc pl-4 space-y-1 text-foreground/90">
                      <li>
                        {t("reportWizard.resetRoundCheckRounds", {
                          rounds: resetPreview.rounds_with_data.join(", "),
                        })}
                      </li>
                      <li>
                        {t("reportWizard.resetRoundCheckPipeline", {
                          from: resetPreview.pipeline.from || "—",
                          to: resetPreview.pipeline.to || "—",
                        })}
                      </li>
                      <li>
                        {t("reportWizard.resetRoundCheckCounts", {
                          reports: resetPreview.report_ids.length,
                          pdfs: resetPreview.pdf_ids.length,
                          sessions: resetPreview.session_ids.length,
                        })}
                      </li>
                      {(resetPreview.staged_pdf_ids?.length || 0) > 0 && (
                        <li>
                          {t("reportWizard.resetRoundCheckStaged", {
                            count: resetPreview.staged_pdf_ids!.length,
                          })}
                        </li>
                      )}
                    </ul>
                    {(resetPreview.warnings || []).length > 0 &&
                      (resetPreview.warnings || []).map((w) => (
                      <p
                        key={w}
                        className="text-[12px] text-destructive/90 leading-relaxed"
                      >
                        {t("reportWizard.resetRoundEmailWarning")}
                      </p>
                    ))}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetConfirming || resetLoading}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={resetConfirming || resetLoading || !resetPreview}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleResetConfirm();
              }}
              data-testid="reset-round-confirm"
            >
              {resetConfirming ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              {t("reportWizard.resetRoundConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { user } = useAppSelector((s) => s.adminAuth);
  const isAffiliate = user?.role === "affiliate";
  const { clientReferrersLoading, clientReferrersSaving } = useAppSelector(
    (s) => s.admin,
  );
  const [referrerSlots, setReferrerSlots] = useState<ClientReferrerSlotDraft[]>(
    () => emptyReferrerSlots(1),
  );
  const [referralCategory, setReferralCategory] = useState<
    ReferralCategory | ""
  >("");
  const [partnersLoaded, setPartnersLoaded] = useState(false);
  const [contactEditing, setContactEditing] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactDraft, setContactDraft] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    preferred_language: "en" as "en" | "es",
  });

  useEffect(() => {
    setContactEditing(false);
    setContactDraft({
      first_name: String(client?.first_name || ""),
      last_name: String(client?.last_name || ""),
      email: String(client?.email || ""),
      phone: String(client?.phone || ""),
      preferred_language: client?.preferred_language === "es" ? "es" : "en",
    });
  }, [
    client?.id,
    client?.first_name,
    client?.last_name,
    client?.email,
    client?.phone,
    client?.preferred_language,
  ]);

  const startContactEdit = () => {
    setContactDraft({
      first_name: String(client?.first_name || ""),
      last_name: String(client?.last_name || ""),
      email: String(client?.email || ""),
      phone: String(client?.phone || ""),
      preferred_language: client?.preferred_language === "es" ? "es" : "en",
    });
    setContactEditing(true);
  };

  const handleSaveContact = async () => {
    if (!client?.id) return;
    const first = contactDraft.first_name.trim();
    const last = contactDraft.last_name.trim();
    const email = contactDraft.email.trim().toLowerCase();
    const phone = contactDraft.phone.trim();
    if (!first || !last) {
      toast({
        title: t("adminPipeline.contactSaveError"),
        description: t("adminPipeline.contactNameRequired"),
        variant: "destructive",
      });
      return;
    }
    if (!email && !phone) {
      toast({
        title: t("adminPipeline.contactSaveError"),
        description: t("adminPipeline.contactEmailOrPhoneRequired"),
        variant: "destructive",
      });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({
        title: t("adminPipeline.contactSaveError"),
        description: t("adminPipeline.contactEmailInvalid"),
        variant: "destructive",
      });
      return;
    }
    setContactSaving(true);
    try {
      const res = await dispatch(
        updateAdminClient({
          id: Number(client.id),
          first_name: first,
          last_name: last,
          email: email || null,
          phone: phone || null,
          ...(isAffiliate
            ? {}
            : { preferred_language: contactDraft.preferred_language }),
        }),
      );
      if (!updateAdminClient.fulfilled.match(res)) {
        toast({
          title: t("adminPipeline.contactSaveError"),
          description: String(res.payload || ""),
          variant: "destructive",
        });
        return;
      }
      setContactEditing(false);
      toast({ title: t("adminPipeline.contactSaveSuccess") });
      await dispatch(fetchPanelClient(Number(client.id)));
    } finally {
      setContactSaving(false);
    }
  };

  useEffect(() => {
    if (isAffiliate) return;
    setReferralCategory(
      (client?.referral_category as ReferralCategory | null) ?? "",
    );
    setPartnersLoaded(false);
    let cancelled = false;
    (async () => {
      if (!client?.id) return;
      const res = await dispatch(
        fetchClientReferrers({ clientId: Number(client.id) }),
      );
      if (cancelled) return;
      if (fetchClientReferrers.fulfilled.match(res) && res.payload.length) {
        setReferrerSlots(linksToReferrerSlots(res.payload));
      } else if (client.referrer_id) {
        setReferrerSlots([
          {
            referrer_id: Number(client.referrer_id),
            first_name: "",
            last_name: "",
            email: "",
            phone: "",
            notify_on_round: true,
          },
        ]);
      } else {
        setReferrerSlots(emptyReferrerSlots(1));
      }
      setPartnersLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    client?.id,
    client?.referral_category,
    client?.referrer_id,
    dispatch,
    isAffiliate,
  ]);

  const handleSavePartners = async () => {
    if (!client?.id) return;
    const referrers = referralCategory
      ? referrerSlotsToApiPayload(referrerSlots, referralCategory)
      : [];
    const catRes = await dispatch(
      updateAdminClient({
        id: Number(client.id),
        referral_category: referralCategory || null,
      }),
    );
    if (!updateAdminClient.fulfilled.match(catRes)) {
      toast({
        title: t("adminPipeline.partnersSaveError"),
        description: String(catRes.payload || ""),
        variant: "destructive",
      });
      return;
    }
    const res = await dispatch(
      replaceClientReferrers({
        clientId: Number(client.id),
        referrers,
      }),
    );
    if (!replaceClientReferrers.fulfilled.match(res)) {
      toast({
        title: t("adminPipeline.partnersSaveError"),
        description: String(res.payload || ""),
        variant: "destructive",
      });
      return;
    }
    setReferrerSlots(linksToReferrerSlots(res.payload));
    toast({ title: t("adminPipeline.partnersSaveSuccess") });
  };

  return (
    <div className="space-y-4">
      {client?.id && isProspectLead(client) && <LeadTemperatureCard client={client} />}
      {client?.id && !isProspectLead(client) && (
        <ClientPreSaleAnalysisCard clientId={Number(client.id)} />
      )}
      <ClientLabelsEditor clientId={client.id} initialLabels={client.labels} />
      {!isAffiliate && client?.id && (
        <ClientStatusNotesCard
          clientId={Number(client.id)}
          status={String(client.status || "")}
          adminNotes={client.admin_notes}
        />
      )}
      <div className="bg-muted/40 rounded-xl p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("adminPipeline.contactHeading")}
          </h3>
          {!contactEditing ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs gap-1.5"
              onClick={startContactEdit}
              data-testid="panel-edit-contact"
            >
              <Pencil className="w-3.5 h-3.5" />
              {t("adminPipeline.contactEdit")}
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={contactSaving}
                onClick={() => setContactEditing(false)}
              >
                <X className="w-3 h-3 mr-1" />
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={contactSaving}
                onClick={() => void handleSaveContact()}
              >
                {contactSaving ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Check className="w-3 h-3 mr-1" />
                )}
                {t("common.save")}
              </Button>
            </div>
          )}
        </div>
        {contactEditing ? (
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                value={contactDraft.first_name}
                onChange={(e) =>
                  setContactDraft((d) => ({
                    ...d,
                    first_name: e.target.value,
                  }))
                }
                placeholder={t("adminPipeline.contactFirstName")}
                disabled={contactSaving}
              />
              <Input
                value={contactDraft.last_name}
                onChange={(e) =>
                  setContactDraft((d) => ({
                    ...d,
                    last_name: e.target.value,
                  }))
                }
                placeholder={t("adminPipeline.contactLastName")}
                disabled={contactSaving}
              />
            </div>
            <Input
              type="email"
              value={contactDraft.email}
              onChange={(e) =>
                setContactDraft((d) => ({ ...d, email: e.target.value }))
              }
              placeholder={t("adminPipeline.contactEmail")}
              disabled={contactSaving}
            />
            <Input
              value={contactDraft.phone}
              onChange={(e) =>
                setContactDraft((d) => ({ ...d, phone: e.target.value }))
              }
              placeholder={t("adminPipeline.contactPhone")}
              disabled={contactSaving}
            />
            {!isAffiliate && (
              <Select
                value={contactDraft.preferred_language}
                onValueChange={(v) =>
                  setContactDraft((d) => ({
                    ...d,
                    preferred_language: v === "es" ? "es" : "en",
                  }))
                }
                disabled={contactSaving}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("adminPipeline.contactLanguage")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">
                    {t("adminPipeline.contactLanguageEn")}
                  </SelectItem>
                  <SelectItem value="es">
                    {t("adminPipeline.contactLanguageEs")}
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            {!contactDraft.email.trim() && (
              <NoEmailWarning
                hasPhone={!!contactDraft.phone.trim()}
                className="mt-1"
              />
            )}
          </div>
        ) : (
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
                <ContactPhoneActions
                  phone={client.phone}
                  clientId={Number(client.id)}
                  clientName={`${client.first_name || ""} ${client.last_name || ""}`.trim()}
                />
              </div>
            )}
            <div className="flex items-center gap-2 text-foreground/80">
              <LangBadge lang={client.preferred_language} />
              <span className="text-xs text-muted-foreground">
                {client.preferred_language === "es"
                  ? t("adminPipeline.contactLanguageEs")
                  : t("adminPipeline.contactLanguageEn")}
              </span>
            </div>
            {!client.email && (
              <NoEmailWarning hasPhone={!!client.phone} className="mt-2" />
            )}
            <div className="flex items-center gap-2 text-foreground/80">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              {t("adminPipeline.contactJoined", {
                date: fmtDate(client.created_at),
              })}
            </div>
          </div>
        )}
      </div>

      {!isAffiliate && (
        <>
          <ClientCmsCredentialsCard clientId={Number(client.id)} />

          <div className="space-y-3">
            {clientReferrersLoading && !partnersLoaded ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <ClientReferrersEditor
                value={referrerSlots}
                onChange={setReferrerSlots}
                referralCategory={referralCategory}
                onCategoryChange={setReferralCategory}
                disabled={clientReferrersSaving}
              />
            )}
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto"
              disabled={clientReferrersSaving || clientReferrersLoading}
              onClick={() => void handleSavePartners()}
            >
              {clientReferrersSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : null}
              {t("adminPipeline.partnersSave")}
            </Button>
          </div>
        </>
      )}

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
  const [draft, setDraft] = useState<RoundScheduleInput>(
    emptyRoundScheduleInput(),
  );
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
          alsoSend && res.sent_to?.length ? res.sent_to.join(", ") : undefined,
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
              <span className="text-sm font-bold">
                {fmtMoney(sp.amount_cents)}
              </span>
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
  const {
    panelClient: pd,
    panelLoading,
    caseDocuments,
    caseDocumentsLoading,
  } = useAppSelector((s) => s.admin);
  const {
    clientCompletions,
    caseCompletions,
    caseCompletionsLoading,
    clientCompletionsLoading,
    saving: taskSaving,
  } = useAppSelector((s) => s.adminTasks);

  const [panelTab, setPanelTab] = useState<
    | "overview"
    | "analysis"
    | "tasks"
    | "requests"
    | "reports"
    | "history"
    | "schedule"
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
  const [deleteDocTarget, setDeleteDocTarget] = useState<{
    id: number;
    file_name: string;
  } | null>(null);
  const [deleteDocSending, setDeleteDocSending] = useState(false);
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
      dispatch(clearAdminCreditAnalysis());
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
  const panelWizardSessions: Array<{
    id: number;
    round_number: number;
    status: string;
  }> = pd?.wizard_sessions ?? [];
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

  const openCaseDocPreview = useCallback(
    async (doc: { id: number; file_name: string; mime_type?: string }) => {
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
    },
    [],
  );

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
  const resolvedClientId =
    clientId ?? (pd?.client?.id ? Number(pd.client.id) : null);

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
          className="w-full sm:max-w-3xl lg:max-w-4xl bg-background border-l border-border p-0 flex flex-col [&>button:first-of-type]:hidden"
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
                      <ClientHoldBadge status={pd.client.status} />
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
                      <p className="font-semibold">
                        Duplicate active case detected
                      </p>
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
                    ...(isProspect ? (["analysis"] as const) : []),
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
                          : tab === "analysis"
                            ? t("prospectAnalysis.tab")
                            : tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Tab body */}
              <div className="flex-1 overflow-y-auto p-5">
                {panelTab === "overview" && (
                  <OverviewTab client={pd.client} payments={panelPayments} />
                )}

                {panelTab === "analysis" && isProspect && resolvedClientId && (
                  <ProspectCreditAnalysisSection
                    variant="admin"
                    clientId={resolvedClientId}
                    prefilled={{
                      first_name: pd.client?.first_name,
                      last_name: pd.client?.last_name,
                      email: pd.client?.email,
                      preferred_language: pd.client?.preferred_language,
                    }}
                  />
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
                                completion.id &&
                                handleApproveTask(completion.id)
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
                            {caseDocumentsLoading &&
                            caseDocuments.length === 0 ? (
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
                                          {t(
                                            `adminHelpers.docTypes.${doc.doc_type}`,
                                            {
                                              defaultValue: doc.doc_type,
                                            },
                                          )}
                                          {" · "}
                                          {t("adminHelpers.uploadedBy")}{" "}
                                          {uploader}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openCaseDocPreview(doc)
                                          }
                                          className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                                        >
                                          <Eye className="w-3 h-3" />
                                          {t("adminHelpers.viewDocument")}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setDeleteDocTarget({
                                              id: Number(doc.id),
                                              file_name: String(
                                                doc.file_name || "",
                                              ),
                                            })
                                          }
                                          className="inline-flex items-center gap-1 text-[10px] text-destructive hover:underline"
                                          data-testid="case-doc-delete"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                          {t("adminHelpers.deleteDocument")}
                                        </button>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        )}

                        <div className="mt-2 rounded-xl bg-primary/[0.06] border border-primary/15 p-3 text-[11px] text-muted-foreground leading-relaxed">
                          Approving all required tasks auto-advances the client
                          to{" "}
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
                      wizardSessions={panelWizardSessions}
                      pipelineStage={
                        pd?.case_info?.pipeline_stage ??
                        pd?.client?.pipeline_stage ??
                        ""
                      }
                      caseId={resolvedCaseId}
                      clientId={clientId}
                      clientFirstName={String(pd.client.first_name || "Client")}
                      preferredLanguage={
                        pd.client.preferred_language === "es" ? "es" : "en"
                      }
                      maxRounds={
                        Number(pd?.case_info?.max_rounds) || DEFAULT_MAX_ROUNDS
                      }
                      nextDisputeTargetDate={
                        pd?.case_info?.next_dispute_target_date ?? null
                      }
                      reportCompareMode={
                        pd?.case_info?.report_compare_mode === "chain"
                          ? "chain"
                          : "baseline"
                      }
                      onPdfUploaded={() => {
                        if (resolvedCaseId)
                          dispatch(fetchPanelCase(resolvedCaseId));
                      }}
                      onExtendedRoundsSaved={() => {
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
        open={!!deleteDocTarget}
        onOpenChange={(v) => {
          if (!v && !deleteDocSending) setDeleteDocTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("adminHelpers.deleteDocumentTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminHelpers.deleteDocumentBody", {
                name: deleteDocTarget?.file_name || "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDocSending}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteDocSending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!deleteDocTarget || !caseId) return;
                setDeleteDocSending(true);
                try {
                  await dispatch(
                    deleteCaseDocument({
                      id: deleteDocTarget.id,
                      caseId,
                    }),
                  ).unwrap();
                  dispatch(fetchCaseTaskCompletions(caseId));
                  dispatch(fetchPanelCase(caseId));
                  onCaseUpdated();
                  toast({ title: t("adminHelpers.deleteDocumentSuccess") });
                  setDeleteDocTarget(null);
                } catch (err: any) {
                  toast({
                    title: t("adminHelpers.deleteDocumentFailed"),
                    description: String(err || ""),
                    variant: "destructive",
                  });
                } finally {
                  setDeleteDocSending(false);
                }
              }}
            >
              {deleteDocSending
                ? t("common.deleting", { defaultValue: "Deleting…" })
                : t("adminHelpers.deleteDocument")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

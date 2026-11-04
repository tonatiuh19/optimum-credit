import { EnhancedCreditAnalysisSummary } from "@/components/credit/EnhancedCreditAnalysisSummary";
import { CreditAnalysisLenderContextCard } from "@/components/credit/CreditAnalysisLenderContextCard";
import { CreditAnalysisReviewCard } from "@/components/credit/CreditAnalysisReviewCard";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, CheckCircle2, AlertTriangle, Mail, RefreshCw, Download, Languages, Loader2, ShieldCheck } from "lucide-react";
import type { CreditAnalysisResult } from "@shared/api";
import { creditAnalysisReportLabels, resolveCreditAnalysisReportLang } from "@/lib/creditAnalysisReportLabels";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  downloadEnhancedCreditAnalysisPdf,
  fetchCreditAnalysisEnhancedStatus,
  fetchPublicEnhancedStatus,
  downloadPublicEnhancedPdf,
} from "@/store/slices/creditAnalysisSlice";

// Direct read ~1 min (batch fallback a few min): poll often, give up ~15 min.
const ENHANCED_POLL_MS = 5_000;
const ENHANCED_POLL_MAX = 180;

export interface CreditAnalysisResultPanelProps {
  result: CreditAnalysisResult;
  onStartOver?: () => void;
  /** Public marketing page shows register CTA; admin/portal omit it. */
  showRegisterCta?: boolean;
  /** Kept for callers (PDF name comes from the server). */
  clientName?: string;
  /** Staff views: admin endpoints (lender context, staff PDF). Otherwise public token. */
  staffEnhancedPdf?: boolean;
}

/**
 * Credit Analysis result — new engine only (account-by-account read). While
 * it reads: progress; when ready: its summary + PDF; failed / no read: say so.
 */
export default function CreditAnalysisResultPanel({
  result,
  onStartOver,
  showRegisterCta = false,
  staffEnhancedPdf = false,
}: CreditAnalysisResultPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const analysisId = Number(result.id) || 0;
  // staff = admin endpoints; public = public form / client portal by token;
  // none = no read on file for this analysis (cannot render anything).
  const publicToken = !staffEnhancedPdf && result.public_token ? result.public_token : undefined;
  const engineMode: "staff" | "public" | "none" =
    analysisId <= 0 ? "none" : staffEnhancedPdf ? "staff" : publicToken ? "public" : "none";
  const enhancedStatus = useAppSelector((s) =>
    engineMode !== "none" ? s.creditAnalysis.enhancedStatusById[analysisId] : undefined,
  );
  const enhancedDownloading = useAppSelector(
    (s) => !!analysisId && s.creditAnalysis.enhancedDownloadingId === analysisId,
  );

  useEffect(() => {
    if (engineMode === "none") return;
    let polls = 0;
    let timer: number | undefined;
    const check = async () => {
      let st: string | null = null;
      let reviewing = false;
      if (engineMode === "public" && publicToken) {
        const res = await dispatch(fetchPublicEnhancedStatus({ analysisId, token: publicToken }));
        st = fetchPublicEnhancedStatus.fulfilled.match(res) ? res.payload.status : null;
      } else {
        const res = await dispatch(fetchCreditAnalysisEnhancedStatus(analysisId));
        st = fetchCreditAnalysisEnhancedStatus.fulfilled.match(res) ? res.payload.status : null;
        // Staff: keep polling while the automatic review (self-check + Claude audit) runs.
        const rv = fetchCreditAnalysisEnhancedStatus.fulfilled.match(res) ? res.payload.review?.status : null;
        reviewing = rv === "pending" || rv === "running";
      }
      if ((st === "queued" || st === "submitted" || reviewing || (st === null && result.enhanced_pending)) && polls++ < ENHANCED_POLL_MAX) {
        timer = window.setTimeout(check, ENHANCED_POLL_MS);
      }
    };
    void check();
    return () => window.clearTimeout(timer);
  }, [engineMode, publicToken, analysisId, result.enhanced_pending, dispatch]);

  const reportLang = resolveCreditAnalysisReportLang(result);
  const L = creditAnalysisReportLabels(reportLang);

  const reading =
    engineMode !== "none" &&
    (enhancedStatus === "queued" || enhancedStatus === "submitted" || (enhancedStatus == null && !!result.enhanced_pending));
  const ready = engineMode !== "none" && enhancedStatus === "ready";
  const failed = engineMode !== "none" && enhancedStatus === "failed";
  // Public view: the analysis is held for staff review (never shown before it is released).
  const inReview = engineMode === "public" && enhancedStatus === "review";
  const unavailable = engineMode === "none" || (!reading && !ready && !failed && !inReview && enhancedStatus === null);

  const handleDownloadPdf = () => {
    if (!ready) return;
    void (async () => {
      const res =
        engineMode === "public" && publicToken
          ? await dispatch(downloadPublicEnhancedPdf({ analysisId, token: publicToken, lang: reportLang }))
          : await dispatch(downloadEnhancedCreditAnalysisPdf({ analysisId, lang: reportLang }));
      if (downloadEnhancedCreditAnalysisPdf.fulfilled.match(res) || downloadPublicEnhancedPdf.fulfilled.match(res)) {
        const url = URL.createObjectURL(res.payload.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.payload.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } else {
        toast({ title: t("creditAnalysis.enhancedDownloadError"), variant: "destructive" });
      }
    })();
  };

  return (
    <div className="animate-fade-up space-y-6">
      <div className="text-center space-y-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border text-accent bg-accent/10 border-accent/25">
          <CheckCircle2 className="w-3.5 h-3.5" /> {L.resultBadge}
        </span>
        <h2 className="text-2xl md:text-3xl font-bold text-foreground">{L.resultHeading}</h2>
        <p className="text-muted-foreground max-w-lg mx-auto">{L.resultSubheading}</p>
        {result.email_sent && (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-full">
            <Mail className="w-3 h-3" /> {t("creditAnalysis.emailSentNotice")}
          </p>
        )}
        {result.email_skipped_no_address && (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted border border-border px-3 py-1 rounded-full">
            <Mail className="w-3 h-3" /> {t("prospectAnalysis.emailSkippedNoAddress")}
          </p>
        )}
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted border border-border px-3 py-1 rounded-full">
          <Languages className="w-3 h-3" />
          {t("creditAnalysis.reportLanguage")}:{" "}
          {reportLang === "es" ? t("creditAnalysis.reportLanguageEs") : t("creditAnalysis.reportLanguageEn")}
        </p>
      </div>

      {engineMode === "staff" && <CreditAnalysisLenderContextCard analysisId={analysisId} />}
      {engineMode === "staff" && ready && <CreditAnalysisReviewCard analysisId={analysisId} />}

      <div className="flex flex-col sm:flex-row flex-wrap gap-2 justify-center">
        {(reading || ready) && (
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!ready || enhancedDownloading}
            className="btn-primary h-11 px-6 flex items-center justify-center gap-2 disabled:opacity-60"
            data-testid="credit-analysis-download"
          >
            {enhancedDownloading || reading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {t("creditAnalysis.downloadPdf")}
          </button>
        )}
        {showRegisterCta && (
          <Link to="/register" className="btn-primary h-11 px-6 flex items-center justify-center gap-2">
            {t("creditAnalysis.ctaRegister")} <ArrowRight className="w-4 h-4" />
          </Link>
        )}
        {onStartOver && (
          <button
            type="button"
            onClick={onStartOver}
            className="btn-secondary h-11 px-6 flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> {t("creditAnalysis.startOver")}
          </button>
        )}
      </div>

      {inReview ? (
        <div className="card-base p-6 flex flex-col items-center gap-3 text-center animate-in fade-in" data-testid="credit-analysis-in-review">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <p className="text-sm font-semibold text-foreground">{t("creditAnalysis.review.publicTitle")}</p>
          <p className="text-xs text-muted-foreground max-w-sm">{t("creditAnalysis.review.publicBody")}</p>
        </div>
      ) : reading ? (
        <div className="card-base p-6 flex flex-col items-center gap-3 text-center animate-in fade-in" data-testid="credit-analysis-reading">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm font-semibold text-foreground">{t("creditAnalysis.enhanced.readingTitle")}</p>
          <p className="text-xs text-muted-foreground max-w-sm">{t("creditAnalysis.enhanced.readingBody")}</p>
        </div>
      ) : ready ? (
        <EnhancedCreditAnalysisSummary analysisId={analysisId} publicToken={publicToken} />
      ) : failed || unavailable ? (
        <div
          className="card-base p-6 flex gap-3 items-start border-destructive/30 bg-destructive/5 animate-in fade-in"
          data-testid="credit-analysis-read-failed"
        >
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">{t("creditAnalysis.enhanced.failedTitle")}</p>
            <p className="text-sm text-muted-foreground">
              {engineMode === "staff" ? t("creditAnalysis.enhanced.failedStaff") : t("creditAnalysis.enhanced.failedPublic")}
            </p>
          </div>
        </div>
      ) : null}

      {ready && result.suggested_labels.length > 0 && (
        <div className="card-base p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4">{L.labelsHeading}</h3>
          <div className="flex flex-wrap gap-2">
            {result.suggested_labels.map((slug) => (
              <span
                key={slug}
                className="text-xs font-medium bg-primary/10 text-primary border border-primary/20 px-3 py-1 rounded-full"
              >
                {slug.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

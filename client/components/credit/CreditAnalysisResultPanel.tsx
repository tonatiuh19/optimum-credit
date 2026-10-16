import { CreditAnalysisLenderContextCard } from "@/components/credit/CreditAnalysisLenderContextCard";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Mail,
  RefreshCw,
  Download,
  Languages,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { CreditAnalysisResult } from "@shared/api";
import { creditAnalysisPdfFileName } from "@/lib/creditAnalysisDownload";
import { printCreditAnalysisResult } from "@/lib/creditAnalysisPdfDocument";
import {
  creditAnalysisReportLabels,
  resolveCreditAnalysisReportLang,
} from "@/lib/creditAnalysisReportLabels";
import { parseCreditAnalysisView } from "@/lib/creditAnalysisResultModel";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  downloadEnhancedCreditAnalysisPdf,
  fetchCreditAnalysisEnhancedStatus,
} from "@/store/slices/creditAnalysisSlice";

/** Re-check a pending enhanced read every 20s for up to 15 minutes. */
const ENHANCED_POLL_MS = 20_000;
const ENHANCED_POLL_MAX = 45;

function ScoreGauge({
  label,
  score,
  band,
}: {
  label: string;
  score: number | null | undefined;
  band?: string | null;
}) {
  const hasScore = typeof score === "number" && score > 0;
  const pct = hasScore ? Math.min(Math.max((score - 300) / (850 - 300), 0), 1) : 0;
  const color = !hasScore
    ? "text-muted-foreground border-border"
    : score >= 720
      ? "text-accent border-accent/50"
      : score >= 640
        ? "text-primary border-primary/50"
        : "text-destructive border-destructive/50";

  return (
    <div className="flex flex-col items-center gap-2 flex-1 min-w-[90px]">
      <div
        className={`w-20 h-20 rounded-full border-4 flex items-center justify-center bg-card ${color}`}
      >
        <span className="text-lg font-extrabold">{hasScore ? score : "—"}</span>
      </div>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {band ? (
        <span className="text-[10px] font-bold uppercase tracking-wide text-accent">
          {band}
        </span>
      ) : null}
      {hasScore && (
        <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-current rounded-full transition-all duration-700"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PriorityChip({ priority }: { priority: string }) {
  const p = priority.toUpperCase();
  const cls =
    p === "CRITICAL"
      ? "bg-destructive/10 text-destructive border-destructive/25"
      : p === "HIGH"
        ? "bg-destructive/5 text-destructive border-destructive/20"
        : p === "MEDIUM"
          ? "bg-secondary text-foreground border-border"
          : "bg-primary/5 text-primary border-primary/20";
  return (
    <span
      className={`inline-flex text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border ${cls}`}
    >
      {priority}
    </span>
  );
}

export interface CreditAnalysisResultPanelProps {
  result: CreditAnalysisResult;
  onStartOver?: () => void;
  /** Public marketing page shows register CTA; admin/portal omit it. */
  showRegisterCta?: boolean;
  /** Used for PDF filename / header subtitle */
  clientName?: string;
  /**
   * Staff views only: when the background enhanced read is ready, Download
   * PDF serves the enhanced report; otherwise it behaves exactly as before.
   */
  staffEnhancedPdf?: boolean;
}

function resolveReportLanguage(result: CreditAnalysisResult): "en" | "es" {
  return resolveCreditAnalysisReportLang(result);
}

export default function CreditAnalysisResultPanel({
  result,
  onStartOver,
  showRegisterCta = false,
  clientName,
  staffEnhancedPdf = false,
}: CreditAnalysisResultPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const analysisId = Number(result.id) || 0;
  const enhancedStatus = useAppSelector((s) =>
    staffEnhancedPdf && analysisId
      ? s.creditAnalysis.enhancedStatusById[analysisId]
      : undefined,
  );
  const enhancedDownloading = useAppSelector(
    (s) => !!analysisId && s.creditAnalysis.enhancedDownloadingId === analysisId,
  );

  useEffect(() => {
    if (!staffEnhancedPdf || !analysisId) return;
    let polls = 0;
    let timer: number | undefined;
    const check = async () => {
      const res = await dispatch(fetchCreditAnalysisEnhancedStatus(analysisId));
      const st = fetchCreditAnalysisEnhancedStatus.fulfilled.match(res)
        ? res.payload.status
        : null;
      if ((st === "queued" || st === "submitted") && polls++ < ENHANCED_POLL_MAX) {
        timer = window.setTimeout(check, ENHANCED_POLL_MS);
      }
    };
    void check();
    return () => window.clearTimeout(timer);
  }, [staffEnhancedPdf, analysisId, dispatch]);
  const reportLang = resolveReportLanguage(result);
  const L = creditAnalysisReportLabels(reportLang);
  const view = parseCreditAnalysisView(result, {
    today: L.timelineToday,
    d30: L.timeline30,
    d60: L.timeline60,
    d90: L.timeline90,
    target: L.timelineTarget,
  });

  const handleDownloadPdf = () => {
    // Enhanced report ready → download it; anything else → today's PDF.
    if (staffEnhancedPdf && enhancedStatus === "ready" && analysisId) {
      void (async () => {
        const res = await dispatch(
          downloadEnhancedCreditAnalysisPdf({ analysisId, lang: reportLang }),
        );
        if (downloadEnhancedCreditAnalysisPdf.fulfilled.match(res)) {
          const url = URL.createObjectURL(res.payload.blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = res.payload.fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
        } else {
          toast({
            title: t("creditAnalysis.enhancedDownloadError"),
            variant: "destructive",
          });
        }
      })();
      return;
    }
    if (view.weakExtraction && !result.scores) {
      toast({
        title: t("creditAnalysis.downloadPdfUnavailable"),
        variant: "destructive",
      });
      return;
    }
    try {
      printCreditAnalysisResult({
        result,
        clientName,
        fileName: creditAnalysisPdfFileName({
          firstName: clientName?.split(" ")[0],
          lastName: clientName?.split(" ").slice(1).join(" "),
          generatedAt: result.generated_at,
        }),
      });
    } catch (e: unknown) {
      const blocked =
        e instanceof Error && e.message === "popup_blocked";
      toast({
        title: blocked
          ? t("creditAnalysis.popupBlocked")
          : t("creditAnalysis.downloadPdfError"),
        variant: "destructive",
      });
    }
  };

  const weakExtraction = view.weakExtraction;
  const mid = view.mid;
  const goal = view.goal;
  const fhaStatus = view.fhaStatus;
  const programTierLabel = view.programTierLabel;
  const timeline = view.timeline;
  const negRows = view.negRows;
  const actions = view.actions;
  const fsRows = view.fsRows;
  const utilRows = view.utilRows;

  return (
    <div className="animate-fade-up space-y-6">
      <div className="text-center space-y-3">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${
              weakExtraction
                ? "text-destructive bg-destructive/10 border-destructive/25"
                : "text-accent bg-accent/10 border-accent/25"
            }`}
          >
            {weakExtraction ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5" />{" "}
                {t("creditAnalysis.extractionWeakBadge")}
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" /> {L.resultBadge}
              </>
            )}
          </span>
          {result.claude_enhanced ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border text-primary bg-primary/10 border-primary/25">
              {t("creditAnalysis.claudeEnhancedBadge")}
            </span>
          ) : null}
        </div>
        <h2 className="text-2xl md:text-3xl font-bold text-foreground">
          {weakExtraction
            ? t("creditAnalysis.extractionWeakHeading")
            : L.resultHeading}
        </h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          {weakExtraction
            ? t("creditAnalysis.extractionWeakBody")
            : L.resultSubheading}
        </p>
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
          {reportLang === "es"
            ? t("creditAnalysis.reportLanguageEs")
            : t("creditAnalysis.reportLanguageEn")}
        </p>
      </div>

      {staffEnhancedPdf && !weakExtraction && enhancedStatus && enhancedStatus !== "failed" && (
        <p
          className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground animate-in fade-in"
          data-testid="credit-analysis-enhanced-status"
        >
          {enhancedStatus === "ready" ? (
            <>
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              {t("creditAnalysis.enhancedReady")}
            </>
          ) : (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t("creditAnalysis.enhancedPreparing")}
            </>
          )}
        </p>
      )}
      {staffEnhancedPdf && analysisId > 0 && !weakExtraction && (
        <CreditAnalysisLenderContextCard analysisId={analysisId} />
      )}
      {(onStartOver || showRegisterCta || !weakExtraction) && (
        <div className="flex flex-col sm:flex-row flex-wrap gap-2 justify-center">
          {!weakExtraction && (
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="btn-primary h-11 px-6 flex items-center justify-center gap-2"
            >
              {enhancedDownloading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {t("creditAnalysis.downloadPdf")}
            </button>
          )}
          {showRegisterCta && (
            <Link
              to="/register"
              className="btn-primary h-11 px-6 flex items-center justify-center gap-2"
            >
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
      )}

      {!weakExtraction && (
        <p className="text-center text-xs text-muted-foreground -mt-2">
          {t("creditAnalysis.downloadPdfHint")}
        </p>
      )}

      {weakExtraction && (
        <div className="card-base p-4 border-destructive/30 bg-destructive/5 flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t("creditAnalysis.extractionWeakTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("creditAnalysis.extractionWeakHint")}
            </p>
          </div>
        </div>
      )}

      {result.scores && !weakExtraction && (
        <div className="card-base p-6 space-y-5">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {L.scoresHeading}
          </h3>
          <div className="flex gap-4 justify-center flex-wrap">
            <ScoreGauge
              label={L.transunion}
              score={result.scores.transunion}
              band={view.scoreBands.tu || null}
            />
            <ScoreGauge
              label={L.experian}
              score={result.scores.experian}
              band={view.scoreBands.ex || null}
            />
            <ScoreGauge
              label={L.equifax}
              score={result.scores.equifax}
              band={view.scoreBands.eq || null}
            />
          </div>
          {(mid != null || goal != null || fhaStatus) && (
            <div className="rounded-xl border border-border bg-secondary/60 p-4 space-y-2">
              <div className="flex flex-wrap gap-4 justify-center text-center">
                {mid != null && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {L.midScore}
                    </p>
                    <p className="text-2xl font-extrabold text-foreground">{mid}</p>
                  </div>
                )}
                {goal != null && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {L.goalScore}
                    </p>
                    <p className="text-2xl font-extrabold text-accent">{goal}</p>
                  </div>
                )}
              </div>
              {fhaStatus && (
                <p className="text-sm text-center text-foreground">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground mr-2">
                    {L.lendingStatus}
                  </span>
                  {fhaStatus}
                </p>
              )}
              {programTierLabel && (
                <p className="text-sm text-center text-foreground">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground mr-2">
                    {L.programTierHeading}
                  </span>
                  {programTierLabel}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {result.scores && !weakExtraction && timeline.some((x) => x.v != null) && (
        <div className="card-base p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4">
            {L.timelineHeading}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {timeline.map((x) => (
              <div
                key={x.key}
                className="rounded-lg border border-border bg-card px-3 py-3 text-center"
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {x.label}
                </p>
                <p
                  className={`text-xl font-extrabold mt-1 ${
                    x.key === "target" ? "text-accent" : "text-foreground"
                  }`}
                >
                  {x.v ?? "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-base p-6">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4">
          {L.negativesHeading}
        </h3>
        {negRows.length > 0 ? (
          <ul className="space-y-2.5">
            {negRows.map((n, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3"
              >
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{n.account}</p>
                    {n.round && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border border-primary/25 bg-primary/10 text-primary">
                        {L.round} {n.round}
                      </span>
                    )}
                    {n.priority && <PriorityChip priority={n.priority} />}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {n.type}
                    {n.bureaus ? ` · ${n.bureaus}` : ""}
                  </p>
                  {n.basis && (
                    <p className="text-xs text-foreground/80 leading-relaxed">{n.basis}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : view.fallbackNegatives.length > 0 ? (
          <ul className="space-y-2.5">
            {view.fallbackNegatives.map((n, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3"
              >
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {n.creditor || n.type}
                  </p>
                  {n.detail && (
                    <p className="text-xs text-muted-foreground mt-0.5">{n.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : weakExtraction ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            {t("creditAnalysis.extractionWeakNegatives")}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-accent">
            <CheckCircle2 className="w-4 h-4" /> {L.noNegatives}
          </p>
        )}
      </div>

      {!weakExtraction && utilRows.length > 0 && (
        <div className="card-base p-6 space-y-4 overflow-x-auto">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {L.utilizationHeading}
          </h3>
          {view.utilNote && (
            <p className="text-sm text-muted-foreground">{view.utilNote}</p>
          )}
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="py-2 pr-2">{L.utilAccount}</th>
                <th className="py-2 pr-2 text-right">{L.utilLimit}</th>
                <th className="py-2 pr-2 text-right">{L.utilBalance}</th>
                <th className="py-2 pr-2 text-right">{L.utilPercent}</th>
                <th className="py-2 pr-2 text-right">{L.utilPay30}</th>
                <th className="py-2 text-right">{L.utilPay10}</th>
              </tr>
            </thead>
            <tbody>
              {utilRows.map((u) => (
                <tr key={u.account} className="border-b border-border/60">
                  <td className="py-2.5 pr-2 font-medium">{u.account}</td>
                  <td className="py-2.5 pr-2 text-right text-muted-foreground">{u.limit}</td>
                  <td className="py-2.5 pr-2 text-right text-muted-foreground">{u.balance}</td>
                  <td className="py-2.5 pr-2 text-right font-semibold">{u.percent}</td>
                  <td className="py-2.5 pr-2 text-right text-muted-foreground">{u.pay30}</td>
                  <td className="py-2.5 text-right text-muted-foreground">{u.pay10}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fsRows.length > 0 && !weakExtraction && (
        <div className="card-base p-6 space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {L.fileStrengthHeading}
            </h3>
            <p className="text-sm font-extrabold text-foreground">
              {view.fileStrengthScore ?? 0}/100
              {view.fileStrengthRating ? ` · ${view.fileStrengthRating}` : ""}
            </p>
          </div>
          <ul className="space-y-2">
            {fsRows.map(([label, value]) => (
              <li
                key={label}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 rounded-lg border border-border px-3 py-2"
              >
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="text-xs text-muted-foreground">{value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {actions.length > 0 && !weakExtraction && (
        <div className="card-base p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4">
            {L.actionPlanHeading}
          </h3>
          <ol className="space-y-3">
            {actions.map((a, i) => (
              <li
                key={i}
                className="rounded-xl border border-border overflow-hidden"
              >
                <div className="bg-primary text-accent text-[11px] font-bold tracking-wide px-3 py-1.5">
                  {a.time}
                </div>
                <div className="px-3 py-2.5 space-y-1">
                  <p className="text-sm font-semibold text-foreground">{a.action}</p>
                  <p className="text-xs text-muted-foreground">{a.reason}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {view.clientMessage && !weakExtraction && (
        <div className="card-base p-6 border-l-4 border-l-accent">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
            {L.clientMessageHeading}
          </h3>
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {view.clientMessage}
          </p>
        </div>
      )}

      {result.suggested_labels && result.suggested_labels.length > 0 && (
        <div className="card-base p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4">
            {L.labelsHeading}
          </h3>
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

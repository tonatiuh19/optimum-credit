import { ReportReviewFlags } from "@/components/admin/ReportReviewFlags";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Upload,
  FileText,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  ExternalLink,
  Eye,
  RefreshCw,
  Info,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearReportWizard,
  clearWizardSession,
  createReportWizardSession,
  downloadReportWizardSourcePdf,
  fetchReportWizardBeforeContext,
  fetchReportWizardDrafts,
  fetchReportWizardSession,
  finalizeReportWizard,
  previewReportWizard,
  reExtractReportWizard,
  enhanceReportWizardNarrative,
  saveReportWizardReview,
  setReviewedData,
  wizardStepForStatus,
} from "@/store/slices/reportWizardSlice";
import type { OfGReportData } from "@shared/api";
import FieldHint from "@/components/admin/FieldHint";
import { fetchClientReferrers } from "@/store/slices/adminSlice";
import {
  clampMaxRounds,
  DEFAULT_MAX_ROUNDS,
  roundOptionsForMax,
  suggestReportRoundExtended,
} from "@/lib/extendedRounds";

type BureauCode = "TU" | "EX" | "EQ";
const ALL_BUREAUS: BureauCode[] = ["TU", "EX", "EQ"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: number;
  clientFirstName: string;
  /** Auto Spanish report locale from client preferred_language (César: ES auto). */
  clientPreferredLanguage?: "en" | "es" | null;
  suggestedRound: number;
  /** Case max_rounds (5–12). Controls round dropdown. */
  maxRounds?: number;
  /** baseline (default) = vs enrollment; chain = vs prior After. */
  compareMode?: "baseline" | "chain";
  onPublished: () => void;
}

const ROUND_STAGES = [
  "round_1",
  "round_2",
  "round_3",
  "round_4",
  "round_5",
];

function suggestRound(
  pipelineStage: string,
  reports: { round_number: number; pdfs?: unknown[] }[],
  maxRounds: number = DEFAULT_MAX_ROUNDS,
): number {
  const max = clampMaxRounds(maxRounds);
  for (let r = 1; r <= max; r++) {
    const rep = reports.find((x) => x.round_number === r);
    const hasPdf = (rep?.pdfs?.length ?? 0) > 0;
    if (!hasPdf) return r;
  }
  return max;
}

export function suggestReportRound(
  pipelineStage: string,
  reports: { round_number: number; pdfs?: unknown[] }[],
  maxRounds: number = DEFAULT_MAX_ROUNDS,
): number {
  if (
    !ROUND_STAGES.includes(pipelineStage) &&
    pipelineStage !== "docs_ready" &&
    pipelineStage !== "completed"
  ) {
    return 1;
  }
  if (clampMaxRounds(maxRounds) > DEFAULT_MAX_ROUNDS) {
    return suggestReportRoundExtended(pipelineStage, reports, maxRounds);
  }
  return suggestRound(pipelineStage, reports, maxRounds);
}

function fmtDraftDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OfGReportWizard({
  open,
  onOpenChange,
  caseId,
  clientFirstName,
  maxRounds: maxRoundsProp,
  clientPreferredLanguage,
  suggestedRound,
  compareMode = "baseline",
  onPublished,
}: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const maxRounds = clampMaxRounds(maxRoundsProp ?? DEFAULT_MAX_ROUNDS);
  const roundChoices = roundOptionsForMax(maxRounds);
  const {
    session,
    drafts,
    beforeContext,
    loading,
    loadingDrafts,
    loadingSession,
    loadingBeforeContext,
    downloadingSource,
    publishing,
    previewing,
    reExtracting,
    enhancing,
    previewUrl,
    previewFlags,
    error,
  } = useAppSelector((s) => s.reportWizard);

  const [step, setStep] = useState(1);
  const [publishAlerts, setPublishAlerts] = useState<
    Array<{ type: string; severity: string; title: string; detail: string }>
  >([]);
  const [publishPartnersEmailed, setPublishPartnersEmailed] = useState<
    number | null
  >(null);
  const [publishPartnersPdfFailed, setPublishPartnersPdfFailed] =
    useState(false);
  const [roundNumber, setRoundNumber] = useState(suggestedRound);
  const [beforePdf, setBeforePdf] = useState<File | null>(null);
  const [afterPdf, setAfterPdf] = useState<File | null>(null);
  const [reusePriorBefore, setReusePriorBefore] = useState(true);
  const [overrideBeforeUpload, setOverrideBeforeUpload] = useState(false);
  const [highlightWin, setHighlightWin] = useState("");
  const [tradelineRec, setTradelineRec] = useState(false);
  const [fundingNote, setFundingNote] = useState(false);
  const [spanish, setSpanish] = useState(false);
  const [enhanceWithClaude, setEnhanceWithClaude] = useState(true);
  const [complianceOk, setComplianceOk] = useState(false);
  const [scoreAnomalyOk, setScoreAnomalyOk] = useState(false);
  const [notifyPartners, setNotifyPartners] = useState(true);

  const clientReferrers = useAppSelector((s) => s.admin.clientReferrers);
  const clientReferrersLoading = useAppSelector(
    (s) => s.admin.clientReferrersLoading,
  );
  const partnersWithEmail = useMemo(
    () =>
      clientReferrers.filter((r) => {
        const email = String(r.referrer?.email || "").trim();
        return email.includes("@");
      }).length,
    [clientReferrers],
  );
  const partnersLinked = clientReferrers.length;

  const confidenceBadge = (score?: number) => {
    if (!score || score < 0.5) {
      return {
        label: t("reportWizard.confidenceLow"),
        className: "text-destructive bg-destructive/10",
      };
    }
    if (score < 0.8) {
      return {
        label: t("reportWizard.confidenceReview"),
        className: "text-muted-foreground bg-muted",
      };
    }
    return {
      label: t("reportWizard.confidenceHigh"),
      className: "text-accent bg-accent/10",
    };
  };

  const reviewData: OfGReportData | null = useMemo(() => {
    if (!session) return null;
    return session.reviewed_json ?? session.extracted_json ?? null;
  }, [session]);

  const confidence = session?.extraction_meta?.confidence as
    | Record<string, number>
    | undefined;

  useEffect(() => {
    if (!open) {
      dispatch(clearReportWizard());
      return;
    }
    setRoundNumber(suggestedRound);
    setStep(1);
    setComplianceOk(false);
    setScoreAnomalyOk(false);
    setNotifyPartners(true);
    setPublishPartnersEmailed(null);
    setPublishPartnersPdfFailed(false);
    setPublishAlerts([]);
    setBeforePdf(null);
    setAfterPdf(null);
    setReusePriorBefore(true);
    setOverrideBeforeUpload(false);
    setHighlightWin("");
    setTradelineRec(false);
    setFundingNote(false);
    setSpanish(clientPreferredLanguage === "es");
    dispatch(fetchReportWizardDrafts(caseId));
  }, [open, suggestedRound, caseId, dispatch, clientPreferredLanguage]);

  useEffect(() => {
    if (!open) return;
    dispatch(fetchReportWizardBeforeContext({ caseId, roundNumber }));
    setReusePriorBefore(true);
    setOverrideBeforeUpload(false);
    setBeforePdf(null);
  }, [open, caseId, roundNumber, dispatch]);

  useEffect(() => {
    if (!open || step !== 4) return;
    const cid = Number(session?.client_id || 0);
    if (cid > 0) dispatch(fetchClientReferrers({ clientId: cid }));
  }, [open, step, session?.client_id, dispatch]);

  const canReusePrior =
    !loadingBeforeContext &&
    !!beforeContext?.can_reuse &&
    !!beforeContext.prior_session_id &&
    reusePriorBefore &&
    !overrideBeforeUpload;

  const beforeReady = canReusePrior || !!beforePdf;
  const canContinueUpload =
    !loadingBeforeContext && beforeReady && !!afterPdf;

  // After a fresh extract lands in review, advance from upload/extract steps.
  // Do not bounce Start-over (step 1 with cleared session).
  useEffect(() => {
    if (!session) return;
    if (session.status === "review" && (step === 1 || step === 2)) {
      setStep(3);
    }
  }, [session?.id, session?.status, step]);

  const handleStartOver = () => {
    dispatch(clearWizardSession());
    setStep(1);
    setComplianceOk(false);
    setScoreAnomalyOk(false);
    setNotifyPartners(true);
    setPublishPartnersEmailed(null);
    setPublishPartnersPdfFailed(false);
    setPublishAlerts([]);
    setBeforePdf(null);
    setAfterPdf(null);
    setReusePriorBefore(true);
    setOverrideBeforeUpload(false);
    dispatch(fetchReportWizardDrafts(caseId));
    dispatch(fetchReportWizardBeforeContext({ caseId, roundNumber }));
  };

  const applySessionOptions = (s: typeof session) => {
    if (!s?.options_json) return;
    const opts = s.options_json;
    setHighlightWin(opts.highlight_win ?? "");
    setTradelineRec(!!opts.tradeline_rec);
    setFundingNote(!!opts.funding_note);
    setSpanish(!!opts.spanish);
    setEnhanceWithClaude(opts.enhance_with_claude !== false);
  };

  const handleResumeDraft = async (sessionId: number) => {
    const result = await dispatch(fetchReportWizardSession(sessionId));
    if (fetchReportWizardSession.fulfilled.match(result)) {
      setRoundNumber(result.payload.round_number);
      applySessionOptions(result.payload);
      setStep(wizardStepForStatus(result.payload.status));
      setComplianceOk(false);
    }
  };

  const handleExtract = async () => {
    if (loadingBeforeContext) return;
    if (!afterPdf) return;
    if (!canReusePrior && !beforePdf) return;
    const result = await dispatch(
      createReportWizardSession({
        caseId,
        roundNumber,
        beforePdf: canReusePrior ? null : beforePdf,
        afterPdf,
        reuseBeforeSessionId: canReusePrior
          ? beforeContext?.prior_session_id
          : null,
        options: {
          highlight_win: highlightWin.trim() || undefined,
          tradeline_rec: tradelineRec,
          funding_note: fundingNote,
          spanish,
          enhance_with_claude: enhanceWithClaude,
        },
      }),
    );
    if (createReportWizardSession.fulfilled.match(result)) {
      setStep(3);
    }
  };

  const scoreAnomalyWarnings = useMemo(() => {
    if (!reviewData) return [] as string[];
    const out: string[] = [];
    for (const bureau of ["transunion", "experian", "equifax"] as const) {
      const s = reviewData.bureauScores[bureau];
      if (s.before > 0 && s.after > 0 && s.after < s.before - 150) {
        out.push(
          t("reportWizard.scoreDropWarning", {
            bureau: t(`reportWizard.${bureau === "transunion" ? "transunion" : bureau === "experian" ? "experian" : "equifax"}`),
            before: s.before,
            after: s.after,
            drop: s.before - s.after,
          }),
        );
      }
    }
    return out;
  }, [reviewData, t]);

  const handleReExtract = async () => {
    if (!session?.id) return;
    const result = await dispatch(
      reExtractReportWizard({
        sessionId: session.id,
        enhanceWithClaude,
      }),
    );
    if (reExtractReportWizard.fulfilled.match(result)) {
      setComplianceOk(false);
      setScoreAnomalyOk(false);
    }
  };

  const handleEnhanceClaude = async () => {
    if (!session?.id || !reviewData) return;
    const result = await dispatch(
      enhanceReportWizardNarrative({
        sessionId: session.id,
        reviewedJson: reviewData,
      }),
    );
    if (enhanceReportWizardNarrative.fulfilled.match(result)) {
      setComplianceOk(false);
      setScoreAnomalyOk(false);
    }
  };

  const claudeNarrative =
    session?.extraction_meta &&
    (session.extraction_meta as Record<string, unknown>).claude_narrative ===
      true;

  const handlePreview = async () => {
    if (!session?.id || !reviewData) return;
    await dispatch(
      saveReportWizardReview({ sessionId: session.id, reviewedJson: reviewData }),
    );
    const result = await dispatch(
      previewReportWizard({ sessionId: session.id, reviewedJson: reviewData }),
    );
    if (previewReportWizard.fulfilled.match(result)) {
      setStep(4);
    }
  };

  const handlePublish = async () => {
    if (!session?.id || !reviewData || !complianceOk) return;
    if (scoreAnomalyWarnings.length > 0 && !scoreAnomalyOk) return;
    await dispatch(
      saveReportWizardReview({ sessionId: session.id, reviewedJson: reviewData }),
    );
    const result = await dispatch(
      finalizeReportWizard({
        sessionId: session.id,
        acknowledgeScoreAnomalies:
          scoreAnomalyWarnings.length > 0 && scoreAnomalyOk,
        notifyPartners,
      }),
    );
    if (finalizeReportWizard.fulfilled.match(result)) {
      const alerts = result.payload.alerts || [];
      setPublishAlerts(alerts);
      setPublishPartnersEmailed(
        typeof result.payload.partners_emailed === "number"
          ? result.payload.partners_emailed
          : notifyPartners
            ? 0
            : null,
      );
      setPublishPartnersPdfFailed(!!result.payload.partners_pdf_load_failed);
      setStep(5);
      onPublished();
    }
  };

  const updateScore = (
    bureau: "transunion" | "experian" | "equifax",
    field: "before" | "after",
    value: string,
  ) => {
    if (!reviewData) return;
    const num = Number(value) || 0;
    const next: OfGReportData = {
      ...reviewData,
      bureauScores: {
        ...reviewData.bureauScores,
        [bureau]: {
          ...reviewData.bureauScores[bureau],
          [field]: num,
        },
      },
    };
    const calcMiddle = (key: "before" | "after") => {
      const scores = [
        next.bureauScores.transunion[key],
        next.bureauScores.experian[key],
        next.bureauScores.equifax[key],
      ].filter((n) => n > 0);
      scores.sort((a, b) => a - b);
      return scores.length ? scores[Math.floor(scores.length / 2)] : 0;
    };
    next.middleScore = {
      before: calcMiddle("before"),
      after: calcMiddle("after"),
    };
    dispatch(setReviewedData(next));
  };

  const updateWinsText = (text: string) => {
    if (!reviewData) return;
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const byLabel = new Map(
      reviewData.wins.map((w) => [w.itemRemoved.toLowerCase(), w]),
    );
    const wins = lines.map((itemRemoved) => {
      const prev = byLabel.get(itemRemoved.toLowerCase());
      return {
        itemRemoved,
        bureaus: prev?.bureaus?.length ? prev.bureaus : [],
        impact: prev?.impact ?? "",
        status: prev?.status ?? "Removed",
        highlighted: prev?.highlighted,
      };
    });
    const mode = reviewData.compareMode === "chain" ? "chain" : "baseline";
    dispatch(
      setReviewedData({
        ...reviewData,
        wins,
        ...(mode === "chain"
          ? { winsThisRound: wins }
          : { winsSinceEnrollment: wins }),
      }),
    );
  };

  const updateTargetsText = (text: string) => {
    if (!reviewData) return;
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const byLabel = new Map(
      reviewData.targets.map((t) => [t.item.toLowerCase(), t]),
    );
    const targets = lines.map((item) => {
      const prev = byLabel.get(item.toLowerCase());
      return {
        item,
        bureaus: prev?.bureaus?.length ? prev.bureaus : [],
        detail: prev?.detail ?? "",
        priority: prev?.priority ?? ("medium" as const),
      };
    });
    const mode = reviewData.compareMode === "chain" ? "chain" : "baseline";
    dispatch(
      setReviewedData({
        ...reviewData,
        targets,
        ...(mode === "chain"
          ? { targetsThisRound: targets }
          : { targetsSinceEnrollment: targets }),
      }),
    );
  };

  const toggleWinBureau = (index: number, bureau: BureauCode) => {
    if (!reviewData) return;
    const wins = reviewData.wins.map((w, i) => {
      if (i !== index) return w;
      const has = w.bureaus?.includes(bureau);
      const next = has
        ? (w.bureaus || []).filter((b) => b !== bureau)
        : [...(w.bureaus || []), bureau];
      return { ...w, bureaus: next as BureauCode[] };
    });
    const mode = reviewData.compareMode === "chain" ? "chain" : "baseline";
    dispatch(
      setReviewedData({
        ...reviewData,
        wins,
        ...(mode === "chain"
          ? { winsThisRound: wins }
          : { winsSinceEnrollment: wins }),
      }),
    );
  };

  const toggleTargetBureau = (index: number, bureau: BureauCode) => {
    if (!reviewData) return;
    const targets = reviewData.targets.map((tgt, i) => {
      if (i !== index) return tgt;
      const has = tgt.bureaus?.includes(bureau);
      const next = has
        ? (tgt.bureaus || []).filter((b) => b !== bureau)
        : [...(tgt.bureaus || []), bureau];
      return { ...tgt, bureaus: next as BureauCode[] };
    });
    const mode = reviewData.compareMode === "chain" ? "chain" : "baseline";
    dispatch(
      setReviewedData({
        ...reviewData,
        targets,
        ...(mode === "chain"
          ? { targetsThisRound: targets }
          : { targetsSinceEnrollment: targets }),
      }),
    );
  };

  const updateReportDate = (field: "before" | "after", value: string) => {
    if (!reviewData) return;
    dispatch(
      setReviewedData({
        ...reviewData,
        reportDate: {
          before: reviewData.reportDate?.before ?? "",
          after: reviewData.reportDate?.after ?? "",
          [field]: value,
        },
      }),
    );
  };

  const openSourcePdf = async (role: "before" | "after") => {
    if (!session?.id) return;
    const result = await dispatch(
      downloadReportWizardSourcePdf({ sessionId: session.id, role }),
    );
    if (downloadReportWizardSourcePdf.fulfilled.match(result)) {
      window.open(result.payload, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(result.payload), 60_000);
    }
  };

  const close = () => {
    dispatch(clearReportWizard());
    onOpenChange(false);
  };

  const bureauLabels = [
    ["reportWizard.transunion", "transunion"],
    ["reportWizard.experian", "experian"],
    ["reportWizard.equifax", "equifax"],
  ] as const;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {t("reportWizard.title", { name: clientFirstName })}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            {(loadingDrafts || loadingSession) && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                {t("reportWizard.loadingDrafts")}
              </p>
            )}

            {drafts.length > 0 && !session && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                <p className="text-sm font-medium">{t("reportWizard.resumeDraft")}</p>
                <div className="flex flex-wrap gap-2">
                  {drafts.map((d) => (
                    <Button
                      key={d.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loadingSession}
                      onClick={() => handleResumeDraft(d.id)}
                    >
                      {t("reportWizard.resumeDraftBtn", {
                        round: d.round_number,
                        status: d.status,
                        date: fmtDraftDate(d.updated_at),
                      })}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {t("reportWizard.uploadIntro")}
            </p>
            <FieldHint>
              {compareMode === "chain"
                ? t("reportWizard.compareModeChain")
                : t("reportWizard.compareModeBaseline")}
              {" — "}
              {t("reportWizard.compareModeHint")}
            </FieldHint>
            <div>
              <Label>{t("reportWizard.round")}</Label>
              <select
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={roundNumber}
                onChange={(e) => setRoundNumber(Number(e.target.value))}
              >
                {roundChoices.map((r) => (
                  <option key={r} value={r}>
                    {t("reportWizard.roundN", { n: r })}
                  </option>
                ))}
              </select>
              {roundNumber !== suggestedRound && (
                <FieldHint tone="warning">
                  {t("adminHelpers.roundOverrideWarn")}
                </FieldHint>
              )}
            </div>

            {loadingBeforeContext ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t("reportWizard.loadingBeforeContext")}
              </div>
            ) : beforeContext?.source === "prior_round" &&
              beforeContext.can_reuse ? (
              <div className="rounded-xl border border-accent/25 bg-accent/[0.06] p-3 space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t("reportWizard.reusePriorTitle", {
                        round: beforeContext.prior_round,
                      })}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {t("reportWizard.reusePriorBody", {
                        file: beforeContext.file_name || t("reportWizard.afterPdf"),
                        date: beforeContext.report_date_after || "—",
                        score:
                          beforeContext.score_after ??
                          beforeContext.middle_score_after ??
                          "—",
                      })}
                    </p>
                  </div>
                </div>
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <Checkbox
                    className="mt-0.5"
                    checked={reusePriorBefore && !overrideBeforeUpload}
                    onCheckedChange={(v) => {
                      const on = !!v;
                      setReusePriorBefore(on);
                      setOverrideBeforeUpload(!on);
                      if (on) setBeforePdf(null);
                    }}
                  />
                  <span className="text-foreground">
                    {t("reportWizard.reusePriorCheckbox")}
                  </span>
                </label>
                {(overrideBeforeUpload || !reusePriorBefore) && (
                  <PdfDrop
                    label={t("reportWizard.beforeReportOverride")}
                    hint={t("reportWizard.beforeReportOverrideHint")}
                    chooseLabel={t("reportWizard.choosePdf")}
                    file={beforePdf}
                    onFile={setBeforePdf}
                  />
                )}
              </div>
            ) : beforeContext?.source === "enrollment" &&
              beforeContext.can_reuse ? (
              <div className="rounded-xl border border-accent/25 bg-accent/[0.06] p-3 space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t("reportWizard.beforeReportEnrollment")}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {t("reportWizard.reuseEnrollmentHint", {
                        file:
                          beforeContext.file_name ||
                          t("reportWizard.beforeReportEnrollment"),
                        date: beforeContext.report_date_after || "—",
                        score:
                          beforeContext.score_after ??
                          beforeContext.middle_score_after ??
                          "—",
                      })}
                    </p>
                  </div>
                </div>
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <Checkbox
                    className="mt-0.5"
                    checked={reusePriorBefore && !overrideBeforeUpload}
                    onCheckedChange={(v) => {
                      const on = !!v;
                      setReusePriorBefore(on);
                      setOverrideBeforeUpload(!on);
                      if (on) setBeforePdf(null);
                    }}
                  />
                  <span className="text-foreground">
                    {t("reportWizard.reuseEnrollmentCheckbox")}
                  </span>
                </label>
                {(overrideBeforeUpload || !reusePriorBefore) && (
                  <PdfDrop
                    label={t("reportWizard.beforeReportOverride")}
                    hint={t("reportWizard.beforeReportEnrollmentHint")}
                    chooseLabel={t("reportWizard.choosePdf")}
                    file={beforePdf}
                    onFile={setBeforePdf}
                  />
                )}
              </div>
            ) : beforeContext?.source === "none" ? (
              <FieldHint tone="warning">
                {t("reportWizard.noPriorRound", {
                  round: beforeContext.prior_round ?? roundNumber - 1,
                })}
              </FieldHint>
            ) : (
              <FieldHint>{t("reportWizard.round1EnrollmentHint")}</FieldHint>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              {!(
                beforeContext?.can_reuse &&
                (beforeContext.source === "prior_round" ||
                  beforeContext.source === "enrollment")
              ) && (
                  <PdfDrop
                    label={
                      roundNumber === 1 || compareMode === "baseline"
                        ? t("reportWizard.beforeReportEnrollment")
                        : t("reportWizard.beforeReport")
                    }
                    hint={
                      roundNumber === 1 || compareMode === "baseline"
                        ? t("reportWizard.beforeReportEnrollmentHint")
                        : t("reportWizard.beforeReportHint")
                    }
                    chooseLabel={t("reportWizard.choosePdf")}
                    file={beforePdf}
                    onFile={setBeforePdf}
                  />
                )}
              <PdfDrop
                label={t("reportWizard.afterReport")}
                hint={t("reportWizard.afterReportHint")}
                chooseLabel={t("reportWizard.choosePdf")}
                file={afterPdf}
                onFile={setAfterPdf}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("reportWizard.highlightWin")}</Label>
              <Input
                value={highlightWin}
                onChange={(e) => setHighlightWin(e.target.value)}
                placeholder={t("reportWizard.highlightPlaceholder")}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("reportWizard.highlightHint")}
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3 sm:p-4 space-y-4">
              <p className="text-xs font-medium text-foreground">
                {t("reportWizard.optionsHeading")}
              </p>

              <div className="space-y-3">
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <Checkbox
                    className="mt-0.5"
                    checked={tradelineRec}
                    onCheckedChange={(v) => setTradelineRec(!!v)}
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      {t("reportWizard.tradelineRec")}
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {t("reportWizard.tradelineRecHint")}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <Checkbox
                    className="mt-0.5"
                    checked={fundingNote}
                    onCheckedChange={(v) => setFundingNote(!!v)}
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      {t("reportWizard.fundingNote")}
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {t("reportWizard.fundingNoteHint")}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <Checkbox
                    className="mt-0.5"
                    checked={spanish}
                    onCheckedChange={(v) => setSpanish(!!v)}
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      {t("reportWizard.spanishLocale")}
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {t("reportWizard.spanishLocaleHint")}
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <Checkbox
                    className="mt-0.5"
                    checked={enhanceWithClaude}
                    onCheckedChange={(v) => setEnhanceWithClaude(!!v)}
                  />
                  <span>
                    <span className="font-medium text-foreground">
                      {t("reportWizard.enhanceOnExtract")}
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {t("reportWizard.enhanceOnExtractHint")}
                    </span>
                  </span>
                </label>
              </div>

              {/* Legend — what each checkbox means */}
              <div className="rounded-lg border border-primary/15 bg-primary/[0.04] p-3 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Info className="w-3.5 h-3.5 text-primary shrink-0" />
                  {t("reportWizard.optionsLegendTitle")}
                </div>
                <dl className="space-y-2.5 text-[11px] leading-snug">
                  <div className="grid gap-0.5 sm:grid-cols-[minmax(0,9.5rem)_1fr] sm:gap-3">
                    <dt className="font-medium text-foreground">
                      {t("reportWizard.tradelineRec")}
                    </dt>
                    <dd className="text-muted-foreground">
                      {t("reportWizard.tradelineRecLegend")}
                    </dd>
                  </div>
                  <div className="grid gap-0.5 sm:grid-cols-[minmax(0,9.5rem)_1fr] sm:gap-3">
                    <dt className="font-medium text-foreground">
                      {t("reportWizard.fundingNote")}
                    </dt>
                    <dd className="text-muted-foreground">
                      {t("reportWizard.fundingNoteLegend")}
                    </dd>
                  </div>
                  <div className="grid gap-0.5 sm:grid-cols-[minmax(0,9.5rem)_1fr] sm:gap-3">
                    <dt className="font-medium text-foreground">
                      {t("reportWizard.spanishLocale")}
                    </dt>
                    <dd className="text-muted-foreground">
                      {t("reportWizard.spanishLocaleLegend")}
                    </dd>
                  </div>
                  <div className="grid gap-0.5 sm:grid-cols-[minmax(0,9.5rem)_1fr] sm:gap-3">
                    <dt className="font-medium text-foreground">
                      {t("reportWizard.enhanceOnExtract")}
                    </dt>
                    <dd className="text-muted-foreground">
                      {t("reportWizard.enhanceOnExtractLegend")}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => setStep(2)}
                disabled={!canContinueUpload}
              >
                {t("reportWizard.continue")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 text-center py-6">
            {loading ? (
              <>
                <Loader2 className="w-10 h-10 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground">
                  {t("reportWizard.extracting")}
                </p>
              </>
            ) : (
              <>
                <FileText className="w-10 h-10 mx-auto text-primary" />
                <p className="text-sm">
                  {canReusePrior && beforeContext?.source === "enrollment"
                    ? t("reportWizard.readyExtract", {
                        before: t("reportWizard.beforeReportEnrollment"),
                        after: afterPdf?.name,
                      })
                    : canReusePrior
                      ? t("reportWizard.readyExtractReuse", {
                          prior: beforeContext?.prior_round,
                          after: afterPdf?.name,
                        })
                      : t("reportWizard.readyExtract", {
                          before: beforePdf?.name,
                          after: afterPdf?.name,
                        })}
                </p>
                <div className="flex justify-center gap-2">
                  <Button variant="outline" onClick={() => setStep(1)}>
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    {t("reportWizard.back")}
                  </Button>
                  <Button onClick={handleExtract} disabled={loading}>
                    {t("reportWizard.runExtraction")}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && !reviewData && (
          <div className="space-y-4 text-center py-8">
            <p className="text-sm text-muted-foreground">
              {session?.error_message || t("reportWizard.reviewEmpty")}
            </p>
            <div className="flex justify-center gap-2">
              {session?.id ? (
                <Button
                  variant="outline"
                  onClick={handleReExtract}
                  disabled={reExtracting}
                >
                  {reExtracting ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  {t("reportWizard.reExtract")}
                </Button>
              ) : null}
              <Button variant="outline" onClick={handleStartOver}>
                {t("reportWizard.startOver")}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && reviewData && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={downloadingSource === "before"}
                onClick={() => openSourcePdf("before")}
              >
                {downloadingSource === "before" ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <ExternalLink className="w-3.5 h-3.5 mr-1" />
                )}
                {t("reportWizard.beforePdf")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={downloadingSource === "after"}
                onClick={() => openSourcePdf("after")}
              >
                {downloadingSource === "after" ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <ExternalLink className="w-3.5 h-3.5 mr-1" />
                )}
                {t("reportWizard.afterPdf")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleEnhanceClaude}
                disabled={enhancing || !reviewData}
                data-testid="report-wizard-enhance-claude"
              >
                {enhancing ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 mr-1" />
                )}
                {t("reportWizard.enhanceClaude")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReExtract}
                disabled={reExtracting}
              >
                {reExtracting ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                )}
                {t("reportWizard.reExtract")}
              </Button>
            </div>
            {claudeNarrative && (
              <div
                className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-[11px] text-foreground leading-snug"
                data-testid="report-wizard-claude-banner"
              >
                <p className="font-semibold text-primary flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  {t("reportWizard.claudeDraftTitle")}
                </p>
                <p className="text-muted-foreground mt-0.5">
                  {t("reportWizard.claudeDraftBody")}
                </p>
              </div>
            )}
            {(() => {
              const warns = Array.isArray(
                (session?.extraction_meta as Record<string, unknown> | undefined)
                  ?.extraction_warnings,
              )
                ? ((session!.extraction_meta as Record<string, unknown>)
                    .extraction_warnings as string[])
                : [];
              if (!warns.length) return null;
              const parts: string[] = [];
              if (warns.some((w) => w.includes("date_not_found"))) {
                parts.push(t("reportWizard.extractWarnDates"));
              }
              if (warns.some((w) => w.includes("tu_ex_identical"))) {
                parts.push(t("reportWizard.extractWarnScores"));
              }
              if (warns.some((w) => w.startsWith("mixed_providers"))) {
                parts.push(t("reportWizard.extractWarnMixedProviders"));
              }
              if (!parts.length) return null;
              return (
                <FieldHint tone="warning">
                  {parts.join(" ")}
                </FieldHint>
              );
            })()}
            <p className="text-sm text-muted-foreground">
              {t("reportWizard.reviewIntro")}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("reportWizard.reportDateBefore")}</Label>
                <Input
                  type="date"
                  className="mt-1 h-9 text-xs"
                  value={reviewData.reportDate?.before ?? ""}
                  onChange={(e) => updateReportDate("before", e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">{t("reportWizard.reportDateAfter")}</Label>
                <Input
                  type="date"
                  className="mt-1 h-9 text-xs"
                  value={reviewData.reportDate?.after ?? ""}
                  onChange={(e) => updateReportDate("after", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {bureauLabels.map(([labelKey, key]) => {
                const badge = confidenceBadge(confidence?.[key]);
                return (
                  <div key={key} className="rounded-lg border border-border p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold">{t(labelKey)}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <div className="flex gap-1 items-center">
                      <Input
                        type="number"
                        className="h-8 text-xs"
                        value={reviewData.bureauScores[key].before || ""}
                        onChange={(e) =>
                          updateScore(key, "before", e.target.value)
                        }
                        placeholder={t("reportWizard.before")}
                      />
                      <span>→</span>
                      <Input
                        type="number"
                        className="h-8 text-xs"
                        value={reviewData.bureauScores[key].after || ""}
                        onChange={(e) =>
                          updateScore(key, "after", e.target.value)
                        }
                        placeholder={t("reportWizard.after")}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-sm">
              {t("reportWizard.middleScore")}:{" "}
              <strong>
                {reviewData.middleScore.before} → {reviewData.middleScore.after}
              </strong>
              {" · "}
              {t("reportWizard.fileStrength")}:{" "}
              <strong>{reviewData.fileStrengthScore}/100</strong>
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("reportWizard.winsLabel")}</Label>
                <textarea
                  rows={4}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  value={reviewData.wins.map((w) => w.itemRemoved).join("\n")}
                  onChange={(e) => updateWinsText(e.target.value)}
                />
                {reviewData.wins.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {reviewData.wins.map((w, i) => (
                      <li
                        key={`${w.itemRemoved}-${i}`}
                        className="flex flex-wrap items-center gap-1.5 text-[11px]"
                      >
                        <span className="text-foreground truncate max-w-[70%]">
                          {w.itemRemoved}
                        </span>
                        <span className="inline-flex gap-0.5">
                          {ALL_BUREAUS.map((b) => (
                            <button
                              key={b}
                              type="button"
                              title={t("reportWizard.toggleBureau", { bureau: b })}
                              onClick={() => toggleWinBureau(i, b)}
                              className={[
                                "px-1 py-0.5 rounded font-semibold transition-colors",
                                w.bureaus?.includes(b)
                                  ? "bg-accent/15 text-accent"
                                  : "bg-muted text-muted-foreground/50",
                              ].join(" ")}
                            >
                              {b}
                            </button>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <FieldHint>{t("adminHelpers.winsTargetsHint")}</FieldHint>
              </div>
              <div>
                <Label className="text-xs">{t("reportWizard.targetsLabel")}</Label>
                <textarea
                  rows={4}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  value={reviewData.targets.map((item) => item.item).join("\n")}
                  onChange={(e) => updateTargetsText(e.target.value)}
                />
                {reviewData.targets.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {reviewData.targets.map((tgt, i) => (
                      <li
                        key={`${tgt.item}-${i}`}
                        className="flex flex-wrap items-center gap-1.5 text-[11px]"
                      >
                        <span className="text-muted-foreground truncate max-w-[70%]">
                          {tgt.item}
                        </span>
                        <span className="inline-flex gap-0.5">
                          {ALL_BUREAUS.map((b) => (
                            <button
                              key={b}
                              type="button"
                              title={t("reportWizard.toggleBureau", { bureau: b })}
                              onClick={() => toggleTargetBureau(i, b)}
                              className={[
                                "px-1 py-0.5 rounded font-semibold transition-colors",
                                tgt.bureaus?.includes(b)
                                  ? "bg-primary/15 text-primary"
                                  : "bg-muted text-muted-foreground/50",
                              ].join(" ")}
                            >
                              {b}
                            </button>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <FieldHint>{t("adminHelpers.winsTargetsHint")}</FieldHint>
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("reportWizard.actionPlanLabel")}</Label>
              <textarea
                rows={4}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                value={(reviewData.actionPlan || [])
                  .map(
                    (a) =>
                      `${a.step}. [${a.owner}] ${a.description}`,
                  )
                  .join("\n")}
                onChange={(e) => {
                  if (!reviewData) return;
                  const lines = e.target.value
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean);
                  const actionPlan = lines.map((line, i) => {
                    const m = line.match(
                      /^\d+\.\s*\[(ofg|client)\]\s*(.+)$/i,
                    );
                    if (m) {
                      return {
                        step: i + 1,
                        owner: m[1].toLowerCase() === "client" ? "client" as const : "ofg" as const,
                        description: m[2].trim(),
                      };
                    }
                    return {
                      step: i + 1,
                      owner: "ofg" as const,
                      description: line.replace(/^\d+\.\s*/, "").trim(),
                    };
                  });
                  dispatch(
                    setReviewedData({
                      ...reviewData,
                      actionPlan,
                    }),
                  );
                }}
              />
              <FieldHint>{t("reportWizard.actionPlanHint")}</FieldHint>
            </div>
            {scoreAnomalyWarnings.length > 0 && (
              <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 space-y-2">
                <p className="text-xs font-semibold text-destructive">
                  {t("reportWizard.scoreAnomalyTitle")}
                </p>
                <ul className="space-y-1.5 text-[11px] text-muted-foreground leading-snug list-disc pl-4">
                  {scoreAnomalyWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {t("reportWizard.scoreAnomalyHint")}
                </p>
              </div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={complianceOk}
                onCheckedChange={(v) => setComplianceOk(!!v)}
                className="mt-0.5"
              />
              <span>{t("reportWizard.complianceAttestation")}</span>
            </label>
            <div className="flex justify-between">
              <Button variant="outline" onClick={handleStartOver}>
                {t("reportWizard.startOver")}
              </Button>
              <Button
                onClick={handlePreview}
                disabled={!complianceOk || previewing}
              >
                {previewing ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Eye className="w-4 h-4 mr-2" />
                )}
                {t("reportWizard.previewPdf")}
              </Button>
            </div>
          </div>
        )}

        {step === 4 && previewUrl && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("reportWizard.previewIntro")}
            </p>
            <ReportReviewFlags flags={previewFlags} />
            <iframe
              src={previewUrl}
              title={t("reportWizard.previewTitle")}
              className="w-full h-[420px] rounded-lg border border-border"
            />
            {scoreAnomalyWarnings.length > 0 && (
              <label className="flex items-start gap-2 text-sm rounded-xl border border-border/70 bg-muted/30 p-3">
                <Checkbox
                  checked={scoreAnomalyOk}
                  onCheckedChange={(v) => setScoreAnomalyOk(!!v)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-foreground block">
                    {t("reportWizard.scoreAnomalyAckTitle")}
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    {t("reportWizard.scoreAnomalyAckBody")}
                  </span>
                </span>
              </label>
            )}
            <FieldHint>{t("adminHelpers.publishReportHint")}</FieldHint>
            <label className="flex items-start gap-2 text-sm rounded-xl border border-border/70 bg-muted/30 p-3">
              <Checkbox
                checked={notifyPartners}
                onCheckedChange={(v) => setNotifyPartners(!!v)}
                className="mt-0.5"
                data-testid="notify-partners-checkbox"
              />
              <span>
                <span className="font-medium text-foreground block">
                  {t("reportWizard.notifyPartnersLabel")}
                </span>
                <span className="text-[11px] text-muted-foreground leading-snug">
                  {t("reportWizard.notifyPartnersHint")}
                </span>
              </span>
            </label>
            {notifyPartners &&
              !clientReferrersLoading &&
              partnersWithEmail === 0 && (
              <div
                className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5"
                data-testid="notify-partners-warning"
              >
                <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {partnersLinked > 0
                    ? t("reportWizard.notifyPartnersNoEmail")
                    : t("reportWizard.notifyPartnersNoneLinked")}
                </p>
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(3)}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                {t("reportWizard.backToReview")}
              </Button>
              <Button
                onClick={handlePublish}
                disabled={
                  publishing ||
                  (scoreAnomalyWarnings.length > 0 && !scoreAnomalyOk)
                }
              >
                {publishing ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                {t("reportWizard.publishToPortal")}
              </Button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="text-center py-8 space-y-3">
            <CheckCircle2 className="w-12 h-12 text-accent mx-auto" />
            <p className="font-semibold">{t("reportWizard.publishedTitle")}</p>
            <p className="text-sm text-muted-foreground">
              {t("reportWizard.publishedBody", { round: roundNumber })}
            </p>
            {publishPartnersEmailed != null && (
              <p
                className="text-[11px] text-muted-foreground"
                data-testid="publish-partners-emailed"
              >
                {t("reportWizard.publishedPartnersBody", {
                  count: publishPartnersEmailed,
                })}
              </p>
            )}
            {publishPartnersPdfFailed && (
              <div
                className="mx-auto max-w-md flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-left"
                data-testid="publish-partners-pdf-failed"
              >
                <Info className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-[11px] text-foreground/90 leading-snug">
                  {t("reportWizard.publishedPartnersPdfFailed")}
                </p>
              </div>
            )}
            {publishAlerts.length > 0 && (
              <div
                className="text-left mx-auto max-w-md rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 space-y-1.5"
                data-testid="report-publish-alerts"
              >
                <p className="text-xs font-semibold text-destructive">
                  {t("reportWizard.publishAlertsTitle", {
                    count: publishAlerts.length,
                  })}
                </p>
                <ul className="space-y-1">
                  {publishAlerts.slice(0, 6).map((a, i) => (
                    <li
                      key={`${a.type}-${i}`}
                      className="text-[11px] text-foreground/90 leading-snug"
                    >
                      <span className="font-medium">{a.title}</span>
                      {a.detail ? ` — ${a.detail}` : ""}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-muted-foreground">
                  {t("reportWizard.publishAlertsNotify")}
                </p>
              </div>
            )}
            <Button onClick={close}>{t("reportWizard.done")}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PdfDrop({
  label,
  hint,
  chooseLabel,
  file,
  onFile,
}: {
  label: string;
  hint?: string;
  chooseLabel: string;
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="border-2 border-dashed border-border rounded-xl p-4 text-center hover:border-primary/40 transition-colors"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f?.type === "application/pdf") onFile(f);
      }}
    >
      <Upload className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
      <p className="text-xs font-medium mb-1">{label}</p>
      {hint && (
        <p className="text-[10px] text-muted-foreground mb-2 leading-snug px-1">
          {hint}
        </p>
      )}
      {file ? (
        <div className="space-y-1.5">
          <p className="text-[10px] text-accent truncate">{file.name}</p>
          <div className="flex items-center justify-center gap-2">
            <label className="text-[10px] text-primary cursor-pointer underline">
              {t("reportWizard.replacePdf")}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              className="text-[10px] text-muted-foreground underline"
              onClick={() => onFile(null)}
            >
              {t("reportWizard.clearPdf")}
            </button>
          </div>
        </div>
      ) : (
        <label className="text-[10px] text-primary cursor-pointer underline">
          {chooseLabel}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
        </label>
      )}
    </div>
  );
}

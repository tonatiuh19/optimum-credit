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
  createReportWizardSession,
  downloadReportWizardSourcePdf,
  fetchReportWizardDrafts,
  fetchReportWizardSession,
  finalizeReportWizard,
  previewReportWizard,
  reExtractReportWizard,
  saveReportWizardReview,
  setReviewedData,
  wizardStepForStatus,
} from "@/store/slices/reportWizardSlice";
import type { OfGReportData } from "@shared/api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: number;
  clientFirstName: string;
  suggestedRound: number;
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
): number {
  for (let r = 1; r <= 5; r++) {
    const rep = reports.find((x) => x.round_number === r);
    const hasPdf = (rep?.pdfs?.length ?? 0) > 0;
    if (!hasPdf) return r;
  }
  return 5;
}

export function suggestReportRound(
  pipelineStage: string,
  reports: { round_number: number; pdfs?: unknown[] }[],
): number {
  if (!ROUND_STAGES.includes(pipelineStage) && pipelineStage !== "docs_ready") {
    return 1;
  }
  return suggestRound(pipelineStage, reports);
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
  suggestedRound,
  onPublished,
}: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    session,
    drafts,
    loading,
    loadingDrafts,
    loadingSession,
    downloadingSource,
    publishing,
    previewing,
    reExtracting,
    previewUrl,
    error,
  } = useAppSelector((s) => s.reportWizard);

  const [step, setStep] = useState(1);
  const [roundNumber, setRoundNumber] = useState(suggestedRound);
  const [beforePdf, setBeforePdf] = useState<File | null>(null);
  const [afterPdf, setAfterPdf] = useState<File | null>(null);
  const [highlightWin, setHighlightWin] = useState("");
  const [tradelineRec, setTradelineRec] = useState(false);
  const [fundingNote, setFundingNote] = useState(false);
  const [spanish, setSpanish] = useState(false);
  const [complianceOk, setComplianceOk] = useState(false);
  const [scoreAnomalyOk, setScoreAnomalyOk] = useState(false);

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
    setBeforePdf(null);
    setAfterPdf(null);
    dispatch(fetchReportWizardDrafts(caseId));
  }, [open, suggestedRound, caseId, dispatch]);

  useEffect(() => {
    if (session?.status === "review" && step === 1) setStep(3);
  }, [session?.status, step]);

  const applySessionOptions = (s: typeof session) => {
    if (!s?.options_json) return;
    const opts = s.options_json;
    setHighlightWin(opts.highlight_win ?? "");
    setTradelineRec(!!opts.tradeline_rec);
    setFundingNote(!!opts.funding_note);
    setSpanish(!!opts.spanish);
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
    if (!beforePdf || !afterPdf) return;
    const result = await dispatch(
      createReportWizardSession({
        caseId,
        roundNumber,
        beforePdf,
        afterPdf,
        options: {
          highlight_win: highlightWin.trim() || undefined,
          tradeline_rec: tradelineRec,
          funding_note: fundingNote,
          spanish,
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
    const result = await dispatch(reExtractReportWizard(session.id));
    if (reExtractReportWizard.fulfilled.match(result)) {
      setComplianceOk(false);
      setScoreAnomalyOk(false);
    }
  };

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
      }),
    );
    if (finalizeReportWizard.fulfilled.match(result)) {
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
    dispatch(
      setReviewedData({
        ...reviewData,
        wins: lines.map((itemRemoved) => ({
          itemRemoved,
          bureaus: ["TU", "EX", "EQ"] as const,
          impact: "",
          status: "Removed",
        })),
      }),
    );
  };

  const updateTargetsText = (text: string) => {
    if (!reviewData) return;
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    dispatch(
      setReviewedData({
        ...reviewData,
        targets: lines.map((item) => ({
          item,
          bureaus: ["TU", "EX", "EQ"] as const,
          detail: "",
          priority: "medium" as const,
        })),
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
            <div>
              <Label>{t("reportWizard.round")}</Label>
              <select
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={roundNumber}
                onChange={(e) => setRoundNumber(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>
                    {t("reportWizard.roundN", { n: r })}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <PdfDrop
                label={t("reportWizard.beforeReport")}
                hint={t("reportWizard.beforeReportHint")}
                chooseLabel={t("reportWizard.choosePdf")}
                file={beforePdf}
                onFile={setBeforePdf}
              />
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
                </dl>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => setStep(2)}
                disabled={!beforePdf || !afterPdf}
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
                  {t("reportWizard.readyExtract", {
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
            <p className="text-sm text-muted-foreground">
              {t("reportWizard.reviewIntro")}
            </p>
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
              </div>
              <div>
                <Label className="text-xs">{t("reportWizard.targetsLabel")}</Label>
                <textarea
                  rows={4}
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                  value={reviewData.targets.map((item) => item.item).join("\n")}
                  onChange={(e) => updateTargetsText(e.target.value)}
                />
              </div>
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
              <Button variant="outline" onClick={() => setStep(1)}>
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
              >                {publishing ? (
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
        <p className="text-[10px] text-accent truncate">{file.name}</p>
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

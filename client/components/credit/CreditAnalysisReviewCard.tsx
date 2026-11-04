import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { reviewCreditAnalysis } from "@/store/slices/creditAnalysisSlice";

/**
 * Staff review gate for a Credit Analysis (Spec v2.1 §11 + Claude audit):
 * shows the automatic check while it runs, then what did not reconcile with
 * the report and the auditor's findings, with Approve (release to the client)
 * and Re-run. Renders nothing for legacy / already-released analyses.
 */
export function CreditAnalysisReviewCard({ analysisId }: { analysisId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const review = useAppSelector((s) => s.creditAnalysis.reviewById[analysisId]);
  const acting = useAppSelector((s) => s.creditAnalysis.reviewActingId === analysisId);
  if (!review) return null;

  const act = async (action: "approve" | "rerun") => {
    const res = await dispatch(reviewCreditAnalysis({ analysisId, action }));
    if (reviewCreditAnalysis.rejected.match(res)) {
      toast({ title: String(res.payload || t("creditAnalysis.review.error")), variant: "destructive" });
    } else {
      toast({ title: action === "approve" ? t("creditAnalysis.review.approvedToast") : t("creditAnalysis.review.rerunToast") });
    }
  };

  if (review.status === "pending" || review.status === "running") {
    return (
      <div className="card-base p-4 flex items-center gap-3 animate-in fade-in" data-testid="credit-review-checking">
        <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
        <div>
          <p className="text-sm font-semibold text-foreground">{t("creditAnalysis.review.checkingTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("creditAnalysis.review.checkingBody")}</p>
        </div>
      </div>
    );
  }

  if (review.status === "passed" || review.status === "approved") {
    return (
      <p className="flex items-center justify-center gap-1.5 text-xs text-accent" data-testid="credit-review-released">
        <ShieldCheck className="w-3.5 h-3.5" />
        {review.status === "approved" ? t("creditAnalysis.review.approved") : t("creditAnalysis.review.passed")}
        {review.findings?.reconciledAdded ? ` · ${t("creditAnalysis.review.reconciled", { count: review.findings.reconciledAdded })}` : ""}
      </p>
    );
  }

  const f = review.findings;
  const mismatches = (f?.selfCheck?.items ?? []).filter((i) => !i.ok);
  const blocking = (f?.audit ?? []).filter((a) => a.severity === "blocking");
  const notes = (f?.audit ?? []).filter((a) => a.severity === "note");
  return (
    <div className="card-base p-4 border-warning/40 bg-warning/10 space-y-3 animate-in fade-in" data-testid="credit-review-needs">
      <div className="flex gap-3 items-start">
        <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{t("creditAnalysis.review.needsTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("creditAnalysis.review.needsBody")}</p>
        </div>
      </div>
      {(mismatches.length > 0 || blocking.length > 0 || notes.length > 0 || f?.error) && (
        <ul className="text-xs text-foreground space-y-1 pl-8 list-disc">
          {mismatches.map((i) => (
            <li key={i.key}>{t("creditAnalysis.enhanced.selfCheckRow", { label: i.label, expected: i.expected ?? "--", actual: i.actual })}</li>
          ))}
          {blocking.map((a, k) => (
            <li key={`b${k}`} className="text-destructive">{a.detail}</li>
          ))}
          {notes.map((a, k) => (
            <li key={`n${k}`} className="text-muted-foreground">{a.detail}</li>
          ))}
          {f?.error && <li className="text-muted-foreground">{t("creditAnalysis.review.auditorError")}</li>}
        </ul>
      )}
      <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
        <Button type="button" variant="outline" size="sm" disabled={acting} onClick={() => void act("rerun")} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> {t("creditAnalysis.review.rerun")}
        </Button>
        <Button type="button" size="sm" disabled={acting} onClick={() => void act("approve")} className="gap-1.5" data-testid="credit-review-approve">
          {acting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} {t("creditAnalysis.review.approve")}
        </Button>
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Home, Landmark, Loader2, Sparkles } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchEnhancedCreditAnalysis, fetchPublicEnhancedAnalysis } from "@/store/slices/creditAnalysisSlice";
import { cn } from "@/lib/utils";

const BUREAUS = ["TU", "EX", "EQ"] as const;
const BUREAU_NAME = { TU: "TransUnion", EX: "Experian", EQ: "Equifax" } as const;

/**
 * Staff on-screen Credit Analysis from the new engine (account-by-account
 * read): per-bureau scores with printed ratings, escrow / lender context,
 * negatives by dispute round, projections, file strength and program.
 * Same data as the enhanced Download PDF.
 */
export function EnhancedCreditAnalysisSummary({
  analysisId,
  publicToken,
}: {
  analysisId: number;
  /** Public form / client portal: read by secure token (no staff context). */
  publicToken?: string;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const a = useAppSelector((s) => s.creditAnalysis.enhancedById[analysisId]);
  // Refetch when the agent context (escrow / lender) changes.
  const ctx = useAppSelector((s) => s.creditAnalysis.contextById[analysisId]);

  useEffect(() => {
    if (publicToken) void dispatch(fetchPublicEnhancedAnalysis({ analysisId, token: publicToken }));
    else void dispatch(fetchEnhancedCreditAnalysis(analysisId));
  }, [analysisId, publicToken, ctx, dispatch]);

  if (!a) {
    return (
      <div className="card-base p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> {t("creditAnalysis.enhanced.loading")}
      </div>
    );
  }

  const last = a.projections[a.projections.length - 1];
  const rounds = [1, 2, 3, 4] as const;

  return (
    <div className="space-y-4 animate-fade-up" data-testid="enhanced-analysis-summary">
      <p className="flex items-center justify-center gap-1.5 text-xs text-accent">
        <Sparkles className="w-3.5 h-3.5" /> {t("creditAnalysis.enhanced.source")}
      </p>

      {!publicToken && a.selfCheck && !a.selfCheck.ok && (
        <div className="card-base p-4 border-warning/40 bg-warning/10 flex gap-3 items-start" data-testid="analysis-self-check">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("creditAnalysis.enhanced.selfCheckTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("creditAnalysis.enhanced.selfCheckBody")}</p>
            <ul className="text-xs text-foreground list-disc pl-4">
              {a.selfCheck.items
                .filter((i) => !i.ok)
                .map((i) => (
                  <li key={i.key}>
                    {t("creditAnalysis.enhanced.selfCheckRow", { label: i.label, expected: i.expected ?? "--", actual: i.actual })}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {a.escrow.active && (
        <div className="card-base p-4 border-destructive/30 bg-destructive/5 flex gap-3 items-start">
          <Home className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-destructive">{t("creditAnalysis.enhanced.escrowTitle")}</p>
            <p className="text-xs text-foreground">{t("creditAnalysis.enhanced.escrowBody")}</p>
          </div>
        </div>
      )}

      <div className="card-base p-6 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {BUREAUS.map((b) => (
            <div key={b} className="rounded-xl border border-border bg-secondary/40 p-3 text-center">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{BUREAU_NAME[b]}</p>
              <p className="text-2xl font-bold text-foreground">{a.scores[b] ?? "--"}</p>
              <p className="text-xs text-muted-foreground">{a.scoreRatings[b] ?? ""}</p>
              {a.vantageScores?.[b] ? (
                <p className="text-[10px] text-muted-foreground">{t("creditAnalysis.enhanced.vantage", { score: a.vantageScores[b] })}</p>
              ) : null}
            </div>
          ))}
        </div>
        {a.middleScore != null && (
          <p className="text-sm font-semibold text-foreground text-center">
            {t("creditAnalysis.enhanced.middle", { score: a.middleScore })}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground text-center">
          {t("creditAnalysis.enhanced.model", { model: a.scoreModel || "VantageScore" })}
        </p>
        {a.lender?.score ? (
          <p className="flex items-center justify-center gap-1.5 text-xs text-foreground">
            <Landmark className="w-3.5 h-3.5 text-primary" />
            {t("creditAnalysis.enhanced.lender", {
              model: a.lender.model || "FICO",
              score: a.lender.score,
              target: a.lender.target ?? "--",
            })}
          </p>
        ) : null}
      </div>

      <div className="card-base p-6 space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          {t("creditAnalysis.enhanced.negatives", { count: a.negatives.length })}
        </h3>
        {a.negatives.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-accent">
            <CheckCircle2 className="w-4 h-4" /> {t("creditAnalysis.enhanced.noNegatives")}
          </p>
        ) : (
          <ul className="space-y-2">
            {a.negatives.map((n, i) => (
              <li key={i} className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    {n.creditor}
                    {n.mask ? <span className="text-xs text-muted-foreground"> …{n.mask}</span> : null}{" "}
                    <span className="text-xs text-muted-foreground">
                      · {n.bureausNotItemized ? t("creditAnalysis.enhanced.notItemized") : n.bureaus.join(", ")}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{n.status}</p>
                </div>
                <span
                  className={cn(
                    "ml-auto shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full",
                    n.hold ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary",
                  )}
                >
                  {n.hold ? t("creditAnalysis.enhanced.hold") : `R${n.round}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {rounds.map((r) => {
            // Spec v2.1: R1 = disputable inquiries + personal-info variances; positives are never targets.
            const count =
              r === 1
                ? (a.inquiries
                    ? a.inquiries.filter((q) => q.action === "dispute").length
                    : a.inquiryClusters.reduce((s, c) => s + c.count, 0)) + (a.identityFlags.length ? 1 : 0)
                : a.negatives.filter((n) => n.round === r && !n.hold).length;
            return (
              <span key={r} className="text-[11px] px-2 py-1 rounded-lg border border-border bg-secondary/40 text-muted-foreground">
                {t(`creditAnalysis.enhanced.round${r}`, { count })}
              </span>
            );
          })}
        </div>
      </div>

      {(a.informational ?? []).length > 0 && (
        <div className="card-base p-4 space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("creditAnalysis.enhanced.informational")}</p>
          <ul className="space-y-1">
            {a.informational!.map((i, k) => (
              <li key={k} className="text-xs text-foreground">
                <span className="font-medium">{i.creditor}</span> <span className="text-muted-foreground">— {i.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card-base p-4 text-center">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("creditAnalysis.enhanced.projected")}</p>
          <p className="text-sm font-semibold text-foreground">
            {last?.middle != null ? `${last.middle}+` : null}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {BUREAUS.map((b) => (last?.scores[b] != null ? `${b} ${last.scores[b]}+` : null)).filter(Boolean).join(" · ") || "--"}
          </p>
        </div>
        <div className="card-base p-4 text-center">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("creditAnalysis.enhanced.strength")}</p>
          <p className="text-sm font-semibold text-foreground">
            {a.fileStrength.current} → {a.fileStrength.postRepair} / 100
          </p>
        </div>
        <div className="card-base p-4 text-center">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("creditAnalysis.enhanced.program")}</p>
          <p className="text-sm font-semibold text-foreground">{t(`creditAnalysis.enhanced.tier_${a.programTier}`)}</p>
        </div>
      </div>
    </div>
  );
}

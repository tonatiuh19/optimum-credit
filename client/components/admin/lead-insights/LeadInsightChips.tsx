import { Flame, Home, Target } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Prospect } from "@shared/api";
import { READINESS_CLASS, fmtUsd, heatClass } from "./leadInsightsUi";

/** Compact credit-insight chips on a prospect card (hidden until a report is read). */
export function LeadInsightChips({ prospect }: { prospect: Prospect }) {
  const { t } = useTranslation();
  if (prospect.insight_heat_score == null) return null;
  const heat = Number(prospect.insight_heat_score);
  const middle = prospect.insight_middle_score;
  const target = prospect.insight_target_score;
  const activeLoan = prospect.insight_active_loan_file === true || Number(prospect.insight_active_loan_file) === 1;
  return (
    <div className="flex flex-wrap items-center gap-1 mb-2" data-testid="lead-insight-chips">
      <span
        title={t("leadInsights.heatTitle", { score: heat })}
        className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${heatClass(heat)}`}
      >
        <Flame className="w-2.5 h-2.5" />
        {heat}
      </span>
      {prospect.insight_readiness && (
        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${READINESS_CLASS[prospect.insight_readiness]}`}>
          {t(`leadInsights.readiness.${prospect.insight_readiness}`)}
        </span>
      )}
      {middle != null && target != null && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
          <Target className="w-2.5 h-2.5 text-muted-foreground" />
          {t("leadInsights.middleToTarget", { middle, target })}
        </span>
      )}
      {activeLoan && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
          <Home className="w-2.5 h-2.5" />
          {t("leadInsights.activeLoan")}
        </span>
      )}
      {!!prospect.insight_est_value_usd && (
        <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
          {t("leadInsights.value", { value: fmtUsd(prospect.insight_est_value_usd) })}
        </span>
      )}
    </div>
  );
}

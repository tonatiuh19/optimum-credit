import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Handshake, Link2, RefreshCw, Trophy } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { backfillLeadInsights, fetchPartnerLeaderboard } from "@/store/slices/leadInsightsSlice";
import { useToast } from "@/hooks/use-toast";
import { fmtUsd } from "./leadInsightsUi";

const RANGES = [30, 90, 180, 365] as const;

/** Referral partners ranked by leads → conversions, with open pipeline value. */
export function PartnerLeaderboardCard() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const [days, setDays] = useState<number>(90);
  const { leaderboard, leaderboardLoading, backfilling } = useAppSelector((s) => s.leadInsights);

  useEffect(() => {
    dispatch(fetchPartnerLeaderboard(days));
  }, [dispatch, days]);

  const runBackfill = async () => {
    const r = await dispatch(backfillLeadInsights());
    if (backfillLeadInsights.fulfilled.match(r)) {
      toast({ title: t("leadInsights.leaderboard.backfillDone", { built: r.payload.built, scanned: r.payload.scanned }) });
      dispatch(fetchPartnerLeaderboard(days));
    } else toast({ title: String(r.payload ?? ""), variant: "destructive" });
  };

  const rows = leaderboard?.partners ?? [];
  const top = Math.max(1, ...rows.map((r) => r.leads));
  return (
    <div className="bg-card rounded-2xl border border-border p-4 sm:p-6 space-y-4" data-testid="partner-leaderboard">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            {t("leadInsights.leaderboard.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("leadInsights.leaderboard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-background">
            {RANGES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`px-2 py-1 text-[11px] rounded-md transition-colors ${days === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t("leadInsights.leaderboard.days", { count: d })}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={runBackfill}
            disabled={backfilling}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${backfilling ? "animate-spin" : ""}`} />
            {backfilling ? t("leadInsights.leaderboard.backfilling") : t("leadInsights.leaderboard.backfill")}
          </button>
        </div>
      </div>

      {leaderboardLoading && !leaderboard ? (
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("leadInsights.leaderboard.empty")}</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground text-left">
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">{t("leadInsights.leaderboard.partner")}</th>
                <th className="px-2 py-1.5">{t("leadInsights.leaderboard.leads")}</th>
                <th className="px-2 py-1.5">{t("leadInsights.leaderboard.hot")}</th>
                <th className="px-2 py-1.5">{t("leadInsights.leaderboard.converted")}</th>
                <th className="px-2 py-1.5">{t("leadInsights.leaderboard.avgMiddle")}</th>
                <th className="px-2 py-1.5 text-right">{t("leadInsights.leaderboard.pipeline")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={r.referrer_id} className="border-t border-border hover:bg-muted/40 transition-colors">
                  <td className="px-2 py-2 font-bold text-muted-foreground tabular-nums">{k + 1}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium">{r.name}</div>
                    {r.company && <div className="text-[11px] text-muted-foreground">{r.company}</div>}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums font-semibold w-6">{r.leads}</span>
                      <div className="h-1.5 flex-1 min-w-[40px] rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-primary transition-all duration-500" style={{ width: `${(r.leads / top) * 100}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2 tabular-nums text-destructive font-semibold">{r.hot}</td>
                  <td className="px-2 py-2 tabular-nums">
                    <span className="font-semibold text-accent">{r.converted}</span>
                    <span className="text-[11px] text-muted-foreground"> · {r.conversion_pct}%</span>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{r.avg_middle ?? "--"}</td>
                  <td className="px-2 py-2 tabular-nums text-right font-semibold">${fmtUsd(r.open_pipeline_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!!leaderboard?.unlinked_requesters.length && (
        <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3">
          <div className="text-xs font-semibold flex items-center gap-1.5 text-primary">
            <Link2 className="w-3.5 h-3.5" />
            {t("leadInsights.leaderboard.unlinked")}
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">{t("leadInsights.leaderboard.unlinkedHint")}</p>
          <div className="flex flex-wrap gap-1.5">
            {leaderboard.unlinked_requesters.map((u) => (
              <span key={u.name} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px]">
                <Handshake className="w-3 h-3 text-muted-foreground" />
                {u.name}
                <span className="font-semibold tabular-nums">{u.leads}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

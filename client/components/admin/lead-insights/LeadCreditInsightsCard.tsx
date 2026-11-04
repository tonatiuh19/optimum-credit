import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Flame, Home, Lightbulb, Sparkles, TrendingUp, Zap } from "lucide-react";
import type { LeadCreditInsightsData, LeadCreditInsightsRow } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLeadInsights } from "@/store/slices/leadInsightsSlice";
import { READINESS_CLASS, fmtUsd, heatClass } from "./leadInsightsUi";

const SCALE_MIN = 300;
const SCALE_MAX = 850;
const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100))}%`;

/** Lead credit insights in the client panel: latest read + score history. */
export function LeadCreditInsightsCard({ clientId }: { clientId: number }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const data = useAppSelector((s) => s.leadInsights.byClient[clientId]);
  const loading = useAppSelector((s) => !!s.leadInsights.loading[clientId]);

  useEffect(() => {
    dispatch(fetchLeadInsights(clientId));
  }, [dispatch, clientId]);

  if (!data && loading) return <div className="h-40 rounded-2xl border border-border bg-card animate-pulse" />;
  if (!data?.latest) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card p-4 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{t("leadInsights.title")}</span> — {t("leadInsights.empty")}
      </section>
    );
  }
  const i = data.latest.insights;
  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-300" data-testid="lead-credit-insights">
      <Header i={i} reportDate={data.latest.report_date} />
      <div className="p-4 space-y-4">
        <TargetBar i={i} />
        <Metrics i={i} />
        <QuickWinsAndAction i={i} />
        <Extras i={i} />
        <History rows={data.history} />
        <p className="text-[10px] text-muted-foreground">{t("leadInsights.estimate")}</p>
      </div>
    </section>
  );
}

function Header({ i, reportDate }: { i: LeadCreditInsightsData; reportDate: string | null }) {
  const { t } = useTranslation();
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-primary/5 via-transparent to-accent/5 border-b border-border">
      <div className="relative w-12 h-12 shrink-0" title={t("leadInsights.heatTitle", { score: i.heatScore })}>
        <svg viewBox="0 0 44 44" className="w-12 h-12 -rotate-90">
          <circle cx="22" cy="22" r={r} className="stroke-muted fill-none" strokeWidth="5" />
          <circle
            cx="22" cy="22" r={r}
            className={`fill-none transition-all duration-700 ${i.heatScore >= 70 ? "stroke-destructive" : i.heatScore >= 40 ? "stroke-primary" : "stroke-muted-foreground"}`}
            strokeWidth="5" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - i.heatScore / 100)}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums">{i.heatScore}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h3 className="text-sm font-semibold">{t("leadInsights.title")}</h3>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${READINESS_CLASS[i.readiness]}`}>
            {t(`leadInsights.readiness.${i.readiness}`)}
          </span>
          {i.activeLoanFile && (
            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
              <Home className="w-3 h-3" />
              {i.source?.requestedBy ? t("leadInsights.activeLoanBy", { name: i.source.requestedBy }) : t("leadInsights.activeLoan")}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground truncate">
          {t("leadInsights.subtitle")}
          {reportDate ? ` · ${reportDate}` : ""}
          {i.source?.vendor ? ` · ${i.source.vendor}${i.source.reportId ? ` #${i.source.reportId}` : ""}` : ""}
        </p>
        {i.heatReasons.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {i.heatReasons.map((r) => (
              <span key={r} className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] ${heatClass(i.heatScore)}`}>
                <Flame className="w-2.5 h-2.5" />
                {t(`leadInsights.reason.${r}`)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TargetBar({ i }: { i: LeadCreditInsightsData }) {
  const { t } = useTranslation();
  if (i.middleScore == null) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1.5">
        <span className="font-semibold tabular-nums">{t("leadInsights.middleToTarget", { middle: i.middleScore, target: i.targetScore })}</span>
        <span className="text-muted-foreground">
          {i.pointsToTarget > 0 ? t("leadInsights.pointsNeeded", { count: i.pointsToTarget, target: i.targetScore }) : t("leadInsights.atTarget", { target: i.targetScore })}
        </span>
      </div>
      <div className="relative h-2.5 rounded-full bg-muted overflow-visible">
        {i.projectedMiddle != null && i.projectedMiddle > i.middleScore && (
          <div className="absolute inset-y-0 rounded-full bg-accent/30 transition-all duration-700" style={{ left: pct(i.middleScore), width: `calc(${pct(i.projectedMiddle)} - ${pct(i.middleScore)})` }} />
        )}
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-700" style={{ width: pct(i.middleScore) }} />
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-foreground/70" style={{ left: pct(i.targetScore) }} title={String(i.targetScore)} />
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
        <TrendingUp className="w-3 h-3 text-accent" />
        {t("leadInsights.projected")}: <span className="font-semibold text-foreground tabular-nums">{i.projectedMiddle ?? "--"}</span>
        <span>·</span>
        {i.roundToTarget ? t("leadInsights.reachesIn", { target: i.targetScore, round: i.roundToTarget }) : i.pointsToTarget > 0 ? t("leadInsights.notWithin") : ""}
      </p>
    </div>
  );
}

function Metrics({ i }: { i: LeadCreditInsightsData }) {
  const { t } = useTranslation();
  const tiles: Array<{ label: string; value: string; sub?: string; tone?: string }> = [
    {
      label: t("leadInsights.negatives"),
      value: String(i.negatives.total),
      sub: t("leadInsights.negDetail", { collections: i.negatives.collections, chargeOffs: i.negatives.chargeOffs, lates: i.negatives.lates }),
      tone: i.negatives.total ? "text-destructive" : "text-accent",
    },
    { label: t("leadInsights.derogBalance"), value: `$${fmtUsd(i.derogBalance)}` },
    {
      label: t("leadInsights.utilization"),
      value: i.utilizationPct == null ? "--" : `${i.utilizationPct}%`,
      sub: i.noOpenCard ? t("leadInsights.noOpenCard") : undefined,
      tone: (i.utilizationPct ?? 0) > 30 ? "text-destructive" : undefined,
    },
    {
      label: t("leadInsights.inquiries"),
      value: String(i.inquiries.last120d),
      sub: `${t("leadInsights.inquiriesDetail", { d120: i.inquiries.last120d, d12m: i.inquiries.last12m })}${i.inquiries.sameDayMax > 1 ? ` · ${t("leadInsights.sameDay", { count: i.inquiries.sameDayMax })}` : ""}`,
    },
    { label: t("leadInsights.fileStrength"), value: `${i.fileStrength.now} → ${i.fileStrength.projected}` },
    {
      label: t("leadInsights.estValue"),
      value: `$${fmtUsd(i.estValueUsd)}`,
      sub: `${t(`leadInsights.tier.${i.programTier}`)}${i.tradelineRecommended ? ` ${t("leadInsights.plusAu")}` : ""}`,
      tone: "text-accent",
    },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {tiles.map((x) => (
        <div key={x.label} className="rounded-xl border border-border bg-background p-2.5 hover:border-primary/30 transition-colors">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{x.label}</div>
          <div className={`text-base font-bold tabular-nums ${x.tone ?? "text-foreground"}`}>{x.value}</div>
          {x.sub && <div className="text-[10px] text-muted-foreground leading-tight">{x.sub}</div>}
        </div>
      ))}
      {i.newAccount90d && (
        <div className="col-span-2 sm:col-span-3 text-[11px] text-muted-foreground flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-primary" />
          {t("leadInsights.newAccount")}: <span className="font-medium text-foreground">{i.newAccount90d.creditor}</span> ({i.newAccount90d.opened})
        </div>
      )}
    </div>
  );
}

function QuickWinsAndAction({ i }: { i: LeadCreditInsightsData }) {
  const { t } = useTranslation();
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
        <div className="text-[11px] font-semibold text-accent flex items-center gap-1 mb-1.5">
          <Zap className="w-3.5 h-3.5" />
          {t("leadInsights.quickWins")} · {i.quickWinsTotal}
        </div>
        {i.quickWins.length ? (
          <ul className="space-y-0.5">
            {i.quickWins.map((q) => (
              <li key={q.key} className="text-[11px] flex justify-between gap-2">
                <span>{t(`leadInsights.quickWin.${q.key}`)}</span>
                <span className="font-semibold tabular-nums">{q.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted-foreground">—</p>
        )}
      </div>
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-col">
        <div className="text-[11px] font-semibold text-primary flex items-center gap-1 mb-1.5">
          <Lightbulb className="w-3.5 h-3.5" />
          {t("leadInsights.nextAction")}
        </div>
        <p className="text-xs font-medium flex items-start gap-1">
          <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
          {t(`leadInsights.action.${i.nextAction}`)}
        </p>
      </div>
    </div>
  );
}

function Extras({ i }: { i: LeadCreditInsightsData }) {
  const { t } = useTranslation();
  const rows: Array<[string, string]> = [];
  if (i.scoreFactors.length) rows.push([t("leadInsights.scoreFactors"), i.scoreFactors.join(" · ")]);
  if (i.oldestAccountMonths != null) rows.push([t("leadInsights.oldest"), `${t("leadInsights.months", { count: i.oldestAccountMonths })}${i.thinFile ? ` · ${t("leadInsights.thinFile")}` : ""}`]);
  if (i.studentLoanBalance > 0) rows.push([t("leadInsights.student"), `$${fmtUsd(i.studentLoanBalance)}`]);
  if (i.medicalCollections.count > 0) rows.push([t("leadInsights.medical"), t("leadInsights.medicalDetail", { count: i.medicalCollections.count, balance: fmtUsd(i.medicalCollections.balance) })]);
  if (i.addressCount > 0) rows.push([t("leadInsights.addresses"), t("leadInsights.addressesDetail", { count: i.addressCount, states: i.statesSeen.join(", ") || "--" })]);
  if (i.lenderSimulation) rows.push([t("leadInsights.lenderSim"), i.lenderSimulation]);
  if (!rows.length) return null;
  return (
    <details className="group rounded-xl border border-border">
      <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors">
        {t("leadInsights.more")}
      </summary>
      <dl className="px-3 pb-3 space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[110px_1fr] gap-2 text-[11px]">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-foreground break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function History({ rows }: { rows: LeadCreditInsightsRow[] }) {
  const { t } = useTranslation();
  const points = useMemo(
    () => [...rows].reverse().filter((r) => r.insights.middleScore != null).map((r) => ({ d: r.report_date ?? r.created_at.slice(0, 10), v: r.insights.middleScore as number })),
    [rows],
  );
  if (points.length < 2) return <p className="text-[11px] text-muted-foreground">{t("leadInsights.historyEmpty")}</p>;
  const W = 280;
  const H = 56;
  const lo = Math.min(...points.map((p) => p.v)) - 10;
  const hi = Math.max(...points.map((p) => p.v)) + 10;
  const xy = points.map((p, k) => [(k / (points.length - 1)) * (W - 8) + 4, H - 4 - ((p.v - lo) / Math.max(1, hi - lo)) * (H - 8)] as const);
  return (
    <div>
      <div className="text-[11px] font-semibold text-muted-foreground mb-1">{t("leadInsights.history")}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14">
        <polyline points={xy.map(([x, y]) => `${x},${y}`).join(" ")} className="fill-none stroke-primary" strokeWidth="2" strokeLinejoin="round" />
        {xy.map(([x, y], k) => (
          <circle key={k} cx={x} cy={y} r="3" className="fill-background stroke-primary" strokeWidth="2">
            <title>{`${points[k].d}: ${points[k].v}`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{points[0].d} · {points[0].v}</span>
        <span>{points[points.length - 1].d} · {points[points.length - 1].v}</span>
      </div>
    </div>
  );
}

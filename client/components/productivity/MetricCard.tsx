import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ChevronDown, CircleDashed, Lock, MessageSquareOff, XCircle } from "lucide-react";
import { LEVEL_META, scoreTone } from "@/lib/productivity";
import type { ProductivityMetric } from "@/store/slices/productivitySlice";

/** One graded metric: score bar, progress vs target, lock / not-graded states, evidence list. */
export function MetricCard({ m, index = 0 }: { m: ProductivityMetric; index?: number }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const LevelIcon = LEVEL_META[m.tier].icon;
  const progress =
    m.kind === "zero"
      ? t("productivity.progress.zero", { count: m.done })
      : m.kind === "count"
        ? t("productivity.progress.count", { done: m.done, target: m.target })
        : m.total != null
          ? t("productivity.progress.ratio", { done: m.done, total: m.total })
          : "";
  const time = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }) : "";

  if (m.locked) {
    return (
      <div
        className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-muted/40 p-4 animate-in fade-in slide-in-from-bottom-1"
        style={{ animationDelay: `${index * 40}ms`, animationFillMode: "both" }}
        data-testid={`metric-${m.key}`}
      >
        <div className="flex items-start gap-3 opacity-60 blur-[0.5px] select-none">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{t(`productivity.metrics.${m.key}.title`)}</p>
            <p className="text-xs text-muted-foreground">{t(`productivity.metrics.${m.key}.target`)}</p>
          </div>
          <span className="text-xs font-semibold text-muted-foreground">{t("productivity.points", { count: m.weight })}</span>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-foreground">
          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${LEVEL_META[m.tier].chip}`}>
            <Lock className="w-3.5 h-3.5" />
          </span>
          {t("productivity.unlocksAt", { level: t(`productivity.levels.${m.tier}`) })}
          <LevelIcon className={`w-4 h-4 ${LEVEL_META[m.tier].tone}`} />
        </div>
      </div>
    );
  }

  const graded = m.score != null;
  return (
    <div
      className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 animate-in fade-in slide-in-from-bottom-1"
      style={{ animationDelay: `${index * 40}ms`, animationFillMode: "both" }}
      data-testid={`metric-${m.key}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{t(`productivity.metrics.${m.key}.title`)}</p>
          <p className="text-xs text-muted-foreground">{t(`productivity.metrics.${m.key}.target`)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold tabular-nums leading-none text-foreground">{graded ? Math.round(m.score!) : "—"}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("productivity.points", { count: m.weight })}</p>
        </div>
      </div>

      <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${scoreTone(m.score)} transition-[width] duration-700 ease-out`}
          style={{ width: `${graded ? Math.max(4, m.score!) : 0}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        {graded ? (
          <span className="text-muted-foreground">{progress}</span>
        ) : m.reason === "slack_not_connected" ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <MessageSquareOff className="w-3.5 h-3.5" /> {t("productivity.slackNotConnected")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <CircleDashed className="w-3.5 h-3.5" /> {t("productivity.nothingPending")}
          </span>
        )}
        {m.evidence.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
            aria-expanded={open}
          >
            {t("productivity.details", { count: m.evidence.length })}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {open && (
        <ul className="mt-3 space-y-1.5 border-t border-border pt-3 animate-in fade-in slide-in-from-top-1" data-testid={`evidence-${m.key}`}>
          {m.evidence.map((e, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              {e.done ? <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
              <span className="truncate text-foreground flex-1 min-w-0">{e.label}</span>
              {e.at && <span className="text-muted-foreground tabular-nums shrink-0">{time(e.at)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

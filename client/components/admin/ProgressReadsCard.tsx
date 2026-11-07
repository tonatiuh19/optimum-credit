import { useEffect } from "react";
import { NextStep } from "@/components/admin/report-approval/NextStep";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, FileSearch, Gauge, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchWizardReads, setReportWizardScoreUpdate, type WizardReadState } from "@/store/slices/reportWizardSlice";

const POLL_MS = 10_000;

/** 75 → "1:15" (time the read has been running). */
function formatElapsed(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  return `${m}:${String(Math.max(0, Math.round(sec)) % 60).padStart(2, "0")}`;
}

function Row({ label, s, date }: { label: string; s: WizardReadState | undefined; date: string | null }) {
  const { t } = useTranslation();
  const status = s?.status ?? "missing";
  const Icon = status === "ready" ? CheckCircle2 : status === "failed" ? AlertTriangle : Loader2;
  const tone = status === "ready" ? "text-accent" : status === "failed" ? "text-destructive" : "text-primary";
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className={`w-4 h-4 shrink-0 mt-px ${tone} ${status === "queued" || status === "reading" ? "animate-spin" : ""}`} />
      <div className="min-w-0">
        <p className="text-foreground">
          <span className="font-semibold">{label}</span> · {t(`reportWizard.reads.status.${status}`)}
          {s?.reused ? ` · ${t("reportWizard.reads.reused")}` : ""}
          {date ? ` · ${t("reportWizard.reads.reportDate", { date })}` : ""}
          {(status === "queued" || status === "reading") && s?.elapsedSec != null ? ` · ${formatElapsed(s.elapsedSec)}` : ""}
        </p>
        {status === "ready" && s?.mode === "reused" && <p className="text-muted-foreground">{t("reportWizard.reads.mode.reused")}</p>}
        {status === "reading" && s?.mode === "batch" && <p className="text-muted-foreground">{t("reportWizard.reads.mode.batch")}</p>}
        {s?.error && <p className="text-destructive">{s.error}</p>}
      </div>
    </div>
  );
}

/**
 * Progress Report Engine v1 (PR-P0-1): Preview / Publish need both
 * account-level reads. Polls until ready; shows failures and identical-pull
 * blocks. The parent disables Preview / Publish while `ready` is false.
 */
export function ProgressReadsCard({ sessionId, onStartOver }: { sessionId: number; onStartOver?: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const reads = useAppSelector((s) => s.reportWizard.reads);
  const switching = useAppSelector((s) => s.reportWizard.switchingScoreUpdate);
  const switchScoreUpdate = (enabled: boolean) => void dispatch(setReportWizardScoreUpdate({ sessionId, enabled }));
  // Keep polling until both sides settle: one failed side must not freeze the other at "reading…".
  const settled = (s: WizardReadState) => s.status === "ready" || s.status === "failed";
  const done = !!reads && (reads.ready || !!reads.blocked_data_integrity || (settled(reads.reads.before) && settled(reads.reads.after)));

  useEffect(() => {
    void dispatch(fetchWizardReads(sessionId));
  }, [dispatch, sessionId]);
  useEffect(() => {
    if (done) return;
    const id = window.setInterval(() => void dispatch(fetchWizardReads(sessionId)), POLL_MS);
    return () => window.clearInterval(id);
  }, [dispatch, sessionId, done]);

  const incomplete = (["before", "after"] as const).filter((side) => reads?.reads[side].code === "incomplete_print");
  // Score update mode (Oct 28, 2026): incomplete print → scores + verified inquiries only.
  if (reads?.score_update) {
    const fullAvailable = incomplete.length === 0 && settled(reads.reads.before) && settled(reads.reads.after);
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 space-y-2 animate-in fade-in" data-testid="progress-reads-score-update" role="status">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Gauge className="w-4 h-4 text-primary shrink-0" />
          {t("reportWizard.scoreUpdate.modeTitle")}
          {reads.ready && <CheckCircle2 className="w-4 h-4 text-accent shrink-0" aria-hidden />}
        </p>
        <p className="text-xs text-foreground">{fullAvailable ? t("reportWizard.scoreUpdate.modeFullAvailable") : t("reportWizard.scoreUpdate.modeBody")}</p>
        {!fullAvailable && <p className="text-xs text-muted-foreground">{t("reportWizard.scoreUpdate.nextRoundNote")}</p>}
        {!reads.ready && !fullAvailable && (
          <>
            <Row label={t("reportWizard.reads.before")} s={reads.reads.before} date={reads.report_dates.before ?? null} />
            <Row label={t("reportWizard.reads.after")} s={reads.reads.after} date={reads.report_dates.after ?? null} />
          </>
        )}
        <Button type="button" size="sm" variant="outline" disabled={switching} onClick={() => switchScoreUpdate(false)} className="gap-1.5" data-testid="score-update-switch-full">
          {switching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowLeftRight className="w-3.5 h-3.5" />} {t("reportWizard.scoreUpdate.switchToFull")}
        </Button>
      </div>
    );
  }
  if (incomplete.length) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-3 space-y-2.5 animate-in fade-in" data-testid="progress-reads-incomplete" role="alert">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldAlert className="w-4 h-4 text-destructive shrink-0" />
          {t("reportWizard.reads.incomplete.title", {
            which: incomplete.map((s) => t(`reportWizard.reads.${s}`)).join(" + "),
          })}
        </p>
        <p className="text-xs text-foreground">{t("reportWizard.reads.incomplete.body")}</p>
        <NextStep input={{ reads: { incompletePrint: true, scoreUpdateAvailable: !!reads?.score_update_available } }} />
        <ol className="list-decimal pl-5 space-y-1 text-xs text-foreground">
          {(["open", "wait", "save", "upload"] as const).map((k) => (
            <li key={k}>{t(`reportWizard.reads.incomplete.steps.${k}`)}</li>
          ))}
        </ol>
        <div className="flex flex-col sm:flex-row gap-2">
          {onStartOver && (
            <Button type="button" size="sm" variant="destructive" onClick={onStartOver} className="gap-1.5" data-testid="progress-reads-start-over">
              <RotateCcw className="w-3.5 h-3.5" /> {t("reportWizard.reads.incomplete.cta")}
            </Button>
          )}
          {reads?.score_update_available && (
            <Button type="button" size="sm" disabled={switching} onClick={() => switchScoreUpdate(true)} className="gap-1.5" data-testid="score-update-enable">
              {switching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gauge className="w-3.5 h-3.5" />} {t("reportWizard.scoreUpdate.readsCta")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (reads?.ready) {
    return (
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-xs text-accent" data-testid="progress-reads-ready">
          <CheckCircle2 className="w-3.5 h-3.5" /> {t("reportWizard.reads.ready")}
        </p>
        <NextStep input={{ reads: { ready: true } }} />
      </div>
    );
  }
  const blocked = reads?.blocked_data_integrity;
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 space-y-2 ${blocked ? "border-destructive/40 bg-destructive/10" : "border-primary/25 bg-primary/5"}`}
      data-testid="progress-reads-card"
      role="status"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {blocked ? <ShieldAlert className="w-4 h-4 text-destructive" /> : <FileSearch className="w-4 h-4 text-primary" />}
        {blocked ? t("reportWizard.reads.blockedTitle") : t("reportWizard.reads.title")}
      </p>
      <NextStep
        input={{
          reads: {
            blockedSameFile: !!blocked,
            failed: reads?.reads.before.status === "failed" || reads?.reads.after.status === "failed",
          },
        }}
      />
      {blocked ? (
        <p className="text-xs text-foreground">{t("reportWizard.reads.blockedBody", { reason: blocked })}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("reportWizard.reads.body")}</p>
          <p className="text-xs text-muted-foreground">{t("reportWizard.reads.background")}</p>
          <Row label={t("reportWizard.reads.before")} s={reads?.reads.before} date={reads?.report_dates.before ?? null} />
          <Row label={t("reportWizard.reads.after")} s={reads?.reads.after} date={reads?.report_dates.after ?? null} />
        </>
      )}
    </div>
  );
}

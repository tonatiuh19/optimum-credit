import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import { CalendarOff, Flame, Loader2, Lock, RefreshCw, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addProductivityDayOff,
  fetchProductivityAccess,
  fetchProductivityDaysOff,
  fetchProductivityScorecard,
  fetchProductivityTeam,
  removeProductivityDayOff,
  type ProductivityScorecard,
} from "@/store/slices/productivitySlice";
import { GradeRing } from "@/components/productivity/GradeRing";
import { MetricCard } from "@/components/productivity/MetricCard";
import { Confetti } from "@/components/productivity/Confetti";
import { Sparkline } from "@/components/admin/dashboard/Sparkline";
import { ALL_BADGES, BADGE_META, LEVEL_META, gradeTone } from "@/lib/productivity";

const REFRESH_MS = 5 * 60_000;

function LevelProgress({ card }: { card: ProductivityScorecard }) {
  const { t } = useTranslation();
  const { level, progress } = card.level;
  const Icon = LEVEL_META[level].icon;
  const next = level === "bronze" ? "silver" : "gold";
  return (
    <div className="rounded-2xl bg-primary-foreground/10 p-3 min-w-0" data-testid="level-progress">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <Icon className="w-4 h-4" /> {t(`productivity.levels.${level}`)}
      </p>
      {progress ? (
        <>
          <div className="mt-2 flex gap-1" aria-hidden>
            {Array.from({ length: progress.needed }, (_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i < progress.days ? "bg-accent" : "bg-primary-foreground/20"}`} />
            ))}
          </div>
          <p className="mt-1.5 text-[11px] opacity-85">
            {t("productivity.levelNext", { days: progress.days, needed: progress.needed, level: t(`productivity.levels.${next}`) })}
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-[11px] opacity-85">{t("productivity.levelMax")}</p>
      )}
    </div>
  );
}

function DaysOffPanel() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { daysOff, team } = useAppSelector((s) => s.productivity);
  useEffect(() => {
    void dispatch(fetchProductivityDaysOff());
  }, [dispatch]);
  const schema = Yup.object({
    admin_id: Yup.number().required(t("productivity.daysOff.required")).min(1, t("productivity.daysOff.required")),
    day: Yup.string().required(t("productivity.daysOff.required")).matches(/^\d{4}-\d{2}-\d{2}$/),
    reason: Yup.string().max(120),
  });
  const formik = useFormik({
    initialValues: { admin_id: team[0]?.admin_id ?? 0, day: "", reason: "" },
    enableReinitialize: true,
    validationSchema: schema,
    onSubmit: async (v, { resetForm }) => {
      const r = await dispatch(addProductivityDayOff({ admin_id: Number(v.admin_id), day: v.day, reason: v.reason || undefined }));
      if (addProductivityDayOff.rejected.match(r)) toast({ title: String(r.payload), variant: "destructive" });
      else {
        toast({ title: t("productivity.daysOff.saved") });
        resetForm();
      }
    },
  });
  return (
    <section className="card-base p-4 sm:p-5 space-y-3" data-testid="days-off-panel">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <CalendarOff className="w-4 h-4 text-primary" /> {t("productivity.daysOff.title")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("productivity.daysOff.hint")}</p>
      <form onSubmit={formik.handleSubmit} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] gap-2">
        <select
          name="admin_id"
          value={formik.values.admin_id}
          onChange={formik.handleChange}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          aria-label={t("productivity.daysOff.person")}
        >
          {team.map((m) => (
            <option key={m.admin_id} value={m.admin_id}>
              {m.name}
            </option>
          ))}
        </select>
        <Input type="date" name="day" value={formik.values.day} onChange={formik.handleChange} aria-label={t("productivity.daysOff.day")} />
        <Input name="reason" value={formik.values.reason} onChange={formik.handleChange} placeholder={t("productivity.daysOff.reason")} />
        <Button type="submit" disabled={formik.isSubmitting}>
          {formik.isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("productivity.daysOff.add")}
        </Button>
      </form>
      {formik.submitCount > 0 && formik.errors.day && <p className="text-xs text-destructive">{formik.errors.day}</p>}
      {daysOff.length > 0 && (
        <ul className="divide-y divide-border">
          {daysOff.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="font-medium text-foreground tabular-nums">{d.day}</span>
              <span className="text-muted-foreground truncate flex-1 min-w-0">
                {d.name}
                {d.reason ? ` · ${d.reason}` : ""}
              </span>
              <Button variant="ghost" size="icon" aria-label={t("productivity.daysOff.remove")} onClick={() => void dispatch(removeProductivityDayOff(d.id))}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** GF-8 Scorecard: live daily grade, level gates, streaks & badges; managers see the team. */
export default function AdminProductivity() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { access, card, cardAdminId, loading, error, team, teamLoading } = useAppSelector((s) => s.productivity);
  const isManager = !!access?.isManager;

  useEffect(() => {
    void dispatch(fetchProductivityAccess());
  }, [dispatch]);
  useEffect(() => {
    if (!access) return;
    if (access.isManager) void dispatch(fetchProductivityTeam());
  }, [dispatch, access]);
  // Own card for scored staff; managers start on the first team member.
  const selected = access?.scored && cardAdminId == null ? undefined : (cardAdminId ?? team[0]?.admin_id);
  useEffect(() => {
    if (!access?.canView) return;
    if (!access.scored && selected == null) return;
    void dispatch(fetchProductivityScorecard(selected));
    const id = window.setInterval(() => void dispatch(fetchProductivityScorecard(selected)), REFRESH_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, access?.canView, access?.scored, selected]);

  const today = card?.today;
  const graded = today?.metrics.filter((m) => !m.locked) ?? [];
  const locked = today?.metrics.filter((m) => m.locked) ?? [];
  const earned = useMemo(() => new Set(card?.badges.map((b) => b.key) ?? []), [card]);
  const historyValues = (card?.history ?? []).map((h) => h.total).filter((v): v is number => v != null);
  const dateLabel = today
    ? new Date(`${today.date}T12:00:00Z`).toLocaleDateString(i18n.language, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
    : "";

  if (access && !access.canView) {
    return (
      <div className="card-base p-8 text-center text-sm text-muted-foreground" data-testid="productivity-no-access">
        <Lock className="w-6 h-6 mx-auto mb-2" />
        {t("productivity.noAccess")}
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in" data-testid="productivity-page">
      {isManager && team.length > 0 && (
        <section className="space-y-2" data-testid="team-strip">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Users className="w-4 h-4 text-primary" /> {t("productivity.team")}
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
            {team.map((m) => {
              const tone = gradeTone(m.today.grade);
              const active = (cardAdminId ?? team[0]?.admin_id) === m.admin_id;
              return (
                <button
                  key={m.admin_id}
                  type="button"
                  onClick={() => void dispatch(fetchProductivityScorecard(m.admin_id))}
                  className={`snap-start shrink-0 flex items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-all ${
                    active ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card hover:border-primary/40"
                  }`}
                  aria-pressed={active}
                >
                  <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-lg font-black ${tone.bg} ${tone.text}`}>
                    {m.today.grade ?? "—"}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{m.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {t(`productivity.profiles.${m.profile}`)} · {m.today.total != null ? m.today.total.toFixed(1) : t(`productivity.status.${m.today.status}`)}
                      {m.streak > 0 ? ` · 🔥${m.streak}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
            {teamLoading && <Loader2 className="w-5 h-5 animate-spin text-primary self-center" />}
          </div>
        </section>
      )}

      {!card && (loading || !access) ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : error && !card ? (
        <div className="card-base p-6 text-sm text-destructive">{error}</div>
      ) : card && today ? (
        <>
          {/* ── Hero ── */}
          <header className="relative overflow-hidden rounded-2xl p-5 sm:p-6 text-primary-foreground bg-gradient-to-br from-primary via-primary/95 to-primary/80 shadow-lg">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,hsl(var(--accent)/0.28),transparent_55%)]" />
            <div className="relative flex flex-col sm:flex-row gap-5 sm:items-center">
              <div className="relative flex items-center gap-4">
                <div className="rounded-full bg-card p-1.5 shadow-md">
                  <GradeRing total={today.total} grade={today.grade} label={t("productivity.ringLabel", { grade: today.grade ?? "—" })} sublabel={t(`productivity.status.${today.status}`)} />
                </div>
                {today.grade === "A" && <Confetti />}
                <div className="sm:hidden min-w-0">
                  <p className="text-[11px] uppercase tracking-widest text-accent">{dateLabel}</p>
                  <h1 className="text-xl font-bold leading-tight">{today.name}</h1>
                </div>
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                <div className="hidden sm:block">
                  <p className="text-[11px] uppercase tracking-widest text-accent">{dateLabel}</p>
                  <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{today.name}</h1>
                </div>
                <p className="text-sm opacity-90">
                  {today.status === "graded" ? t(`productivity.cheer.${today.grade}`) : t(`productivity.status.${today.status}`)} ·{" "}
                  <span className="opacity-80">{t("productivity.liveHint")}</span>
                </p>
                <div className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-2">
                  <LevelProgress card={card} />
                  <div className="rounded-2xl bg-primary-foreground/10 p-3" data-testid="streak">
                    <p className="flex items-center gap-1.5 text-xs font-semibold">
                      <Flame className={`w-4 h-4 ${card.streak > 0 ? "text-accent animate-scorecard-flicker" : "opacity-60"}`} />
                      {t("productivity.streak")}
                    </p>
                    <p className="mt-1 text-2xl font-black tabular-nums">{card.streak}</p>
                    <p className="text-[11px] opacity-85">{t("productivity.streakHint")}</p>
                  </div>
                  <div className="rounded-2xl bg-primary-foreground/10 p-3" data-testid="week-average">
                    <p className="text-xs font-semibold">{t("productivity.week")}</p>
                    <p className="mt-1 text-2xl font-black tabular-nums">
                      {card.week.grade ?? "—"}
                      {card.week.average != null && <span className="ml-1.5 text-sm font-semibold opacity-80">{card.week.average.toFixed(1)}</span>}
                    </p>
                    {historyValues.length > 1 && <Sparkline values={historyValues} label={t("productivity.trend")} className="text-accent" />}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-0 right-0 text-primary-foreground hover:bg-primary-foreground/10"
                onClick={() => void dispatch(fetchProductivityScorecard(cardAdminId ?? undefined))}
                aria-label={t("productivity.refresh")}
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </header>

          {!card.slack_connected && (
            <p className="text-xs text-muted-foreground">{t("productivity.slackSetupHint")}</p>
          )}

          {/* ── Metrics ── */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="metrics">
            {graded.map((m, i) => (
              <MetricCard key={m.key} m={m} index={i} />
            ))}
            {locked.map((m, i) => (
              <MetricCard key={m.key} m={m} index={graded.length + i} />
            ))}
          </section>

          {/* ── Badges ── */}
          <section className="card-base p-4 sm:p-5" data-testid="badges">
            <h2 className="text-sm font-semibold text-foreground">{t("productivity.badges.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("productivity.badges.hint", { earned: earned.size, total: ALL_BADGES.length })}</p>
            <div className="mt-3 grid grid-cols-3 min-[480px]:grid-cols-5 gap-3">
              {ALL_BADGES.map((key) => {
                const Icon = BADGE_META[key];
                const has = earned.has(key);
                return (
                  <div key={key} className="flex flex-col items-center text-center gap-1.5 group" title={t(`productivity.badges.items.${key}.hint`)}>
                    <span
                      className={`relative inline-flex items-center justify-center w-12 h-12 rounded-2xl transition-transform duration-300 ${
                        has ? "bg-gradient-to-br from-accent to-primary text-primary-foreground shadow-md group-hover:scale-110 group-hover:-rotate-6" : "bg-muted text-muted-foreground/60"
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      {!has && <Lock className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-card p-0.5 text-muted-foreground" />}
                    </span>
                    <span className={`text-[11px] leading-tight ${has ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                      {t(`productivity.badges.items.${key}.title`)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {isManager && <DaysOffPanel />}
        </>
      ) : null}
    </div>
  );
}

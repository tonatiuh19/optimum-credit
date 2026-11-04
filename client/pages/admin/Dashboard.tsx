import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  CreditCard,
  DollarSign,
  FileCheck2,
  FileSignature,
  FileText,
  Inbox,
  ShieldCheck,
  KanbanSquare,
  LifeBuoy,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Sparkline } from "@/components/admin/dashboard/Sparkline";
import { HBars } from "@/components/admin/dashboard/HBars";
import { ScorecardWidget } from "@/components/productivity/ScorecardWidget";
import { ReportApprovalQueue } from "@/components/admin/report-approval/ReportApprovalQueue";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminDashboard } from "@/store/slices/adminSlice";
import type { AdminDashboardActivity, AdminDashboardInboxItem } from "@shared/api";

const INBOX_ICON: Record<AdminDashboardInboxItem["key"], LucideIcon> = {
  reports_approval: ShieldCheck,
  tasks_overdue: CheckSquare,
  analyses_review: BrainCircuit,
  conversations_unread: MessageSquare,
  docs_review: FileCheck2,
  rounds_due: Target,
  tickets_open: LifeBuoy,
  payments_pending: CreditCard,
};
const TONE: Record<AdminDashboardInboxItem["tone"], string> = {
  alert: "bg-destructive/10 text-destructive border-destructive/25",
  warn: "bg-warning/15 text-warning border-warning/30",
  info: "bg-primary/10 text-primary border-primary/20",
};
const ACT_ICON: Record<AdminDashboardActivity["kind"], LucideIcon> = {
  client: UserPlus,
  contract: FileSignature,
  document: FileText,
  report: TrendingUp,
  analysis: BrainCircuit,
  payment: DollarSign,
};
const FUNNEL = ["prospect", "new_client", "docs_ready", "round_1", "round_2", "round_3", "round_4", "round_5", "completed"] as const;

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * Staff command center: what needs you now, today's agenda, pulse, money
 * (super admins), trends and recent activity. Everyone / Mine scope; manual
 * refresh. One column on mobile (priority order), two on desktop.
 */
export default function AdminDashboard() {
  const dispatch = useAppDispatch();
  const { t, i18n } = useTranslation();
  const { dashboard, dashboardLoaded, dashboardRefreshing } = useAppSelector((s) => s.admin);
  const me = useAppSelector((s) => s.adminAuth.user);
  const [mine, setMine] = useState(false);

  const load = useCallback(() => void dispatch(fetchAdminDashboard({ mine })), [dispatch, mine]);
  useEffect(() => {
    load();
  }, [load]);

  const s = dashboard.stats;
  const weeks = dashboard.pulse?.weeks ?? [];
  const totalNeeds = dashboard.inbox.reduce((n, i) => n + i.count, 0);
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? "adminDashboard.cc.morning" : hour < 18 ? "adminDashboard.cc.afternoon" : "adminDashboard.cc.evening", {
    name: me?.first_name ?? "",
  });
  const sum = (k: "new_clients" | "enrolled" | "completed" | "revenue_cents") => weeks.reduce((n, w) => n + w[k], 0);
  const rel = useMemo(() => new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" }), [i18n.language]);
  const ago = (iso: string) => {
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 3600) return rel.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rel.format(Math.round(diff / 3600), "hour");
    return rel.format(Math.round(diff / 86400), "day");
  };
  const weekLabel = (ymd: string) =>
    new Date(`${ymd}T12:00:00Z`).toLocaleDateString(i18n.language, { month: "short", day: "numeric", timeZone: "UTC" });

  // Affiliates only have Pipeline / Clients (scoped server-side); no scope switch.
  const isAffiliate = me?.role === "affiliate";
  const allActions: Array<{ to: string; icon: LucideIcon; label: string }> = [
    { to: "/admin/clients", icon: Users, label: t("adminDashboard.cc.qa.clients") },
    { to: "/admin/pipeline", icon: KanbanSquare, label: t("adminDashboard.cc.qa.pipeline") },
    { to: "/admin/conversations", icon: MessageSquare, label: t("adminDashboard.cc.qa.conversations") },
    { to: "/admin/documents", icon: FileCheck2, label: t("adminDashboard.cc.qa.documents") },
    { to: "/admin/my-tasks", icon: CheckSquare, label: t("adminDashboard.cc.qa.tasks") },
    { to: "/admin/calendar", icon: CalendarDays, label: t("adminDashboard.cc.qa.calendar") },
    ...(dashboard.is_super ? [{ to: "/admin/payments", icon: CreditCard, label: t("adminDashboard.cc.qa.payments") }] : []),
  ];
  const actions = isAffiliate ? allActions.filter((a) => a.to === "/admin/clients" || a.to === "/admin/pipeline") : allActions;

  const stageCount = (k: string) => Number(dashboard.stages.find((r) => r.pipeline_stage === k)?.count ?? 0);

  return (
    <div className="space-y-4 animate-in fade-in" data-testid="admin-dashboard">
      {/* ── Hero ── */}
      <header className="relative overflow-hidden rounded-2xl p-5 sm:p-6 text-primary-foreground bg-gradient-to-br from-primary via-primary/95 to-primary/80 shadow-lg">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,hsl(var(--accent)/0.28),transparent_55%)]" />
        <div className="relative grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-accent">
              {new Intl.DateTimeFormat(i18n.language, { weekday: "long", month: "long", day: "numeric" }).format(new Date())}
            </p>
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold leading-tight break-words">{greeting}</h1>
            <p className="mt-1 text-sm opacity-85">
              {!dashboardLoaded
                ? t("adminDashboard.cc.loading")
                : totalNeeds
                  ? t("adminDashboard.cc.summary", { count: totalNeeds })
                  : t("adminDashboard.cc.allClear")}
            </p>
          </div>
          <div className="order-first sm:order-none flex items-start justify-between sm:justify-end gap-2">
            {!isAffiliate && (
            <div className="inline-flex rounded-full bg-primary-foreground/10 p-1" role="radiogroup" aria-label={t("adminDashboard.cc.scope")}>
              {[false, true].map((m) => (
                <button
                  key={String(m)}
                  type="button"
                  role="radio"
                  aria-checked={mine === m}
                  onClick={() => setMine(m)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    mine === m ? "bg-accent text-accent-foreground shadow" : "text-primary-foreground/80 hover:text-primary-foreground"
                  }`}
                  data-testid={m ? "dashboard-scope-mine" : "dashboard-scope-everyone"}
                >
                  {t(m ? "adminDashboard.cc.mine" : "adminDashboard.cc.everyone")}
                </button>
              ))}
            </div>
            )}
            <button
              type="button"
              onClick={load}
              aria-label={t("adminDashboard.cc.refresh")}
              title={t("adminDashboard.cc.refresh")}
              className="grid place-items-center w-8 h-8 rounded-full border border-primary-foreground/25 hover:bg-primary-foreground/10 transition-colors"
              data-testid="dashboard-refresh"
            >
              <RefreshCw className={`w-4 h-4 ${dashboardRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
          <nav className="col-span-full grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2" aria-label={t("adminDashboard.cc.quickActions")}>
            {actions.map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="flex items-center gap-2 min-w-0 rounded-xl border border-primary-foreground/15 bg-primary-foreground/10 px-3 py-2.5 text-sm font-semibold hover:bg-primary-foreground/20 hover:-translate-y-0.5 transition-all"
              >
                <a.icon className="w-4 h-4 shrink-0 text-accent" />
                <span className="truncate">{a.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {!isAffiliate && <ReportApprovalQueue />}
      {!isAffiliate && <ScorecardWidget />}

      {/* ── Grid: one column in priority order on mobile, two columns on desktop ── */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          {/* Needs you */}
          <Card order="order-1" icon={Sparkles} title={t("adminDashboard.cc.needsYou")} testId="dashboard-inbox">
            {!dashboardLoaded ? (
              <Skeleton rows={4} />
            ) : dashboard.inbox.length ? (
              <ul className="space-y-1.5">
                {dashboard.inbox.map((i) => {
                  const Icon = INBOX_ICON[i.key] ?? Inbox;
                  return (
                    <li key={i.key}>
                      <Link to={i.to} className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/50 transition-colors">
                        <span className={`grid place-items-center w-9 h-9 rounded-xl border shrink-0 ${TONE[i.tone]}`}>
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-foreground truncate">
                            {t(`adminDashboard.cc.inbox.${i.key}`, { count: i.count })}
                          </span>
                          <span className="block text-xs text-muted-foreground truncate">{t(`adminDashboard.cc.inboxHint.${i.key}`)}</span>
                        </span>
                        <span className={`min-w-[2rem] text-center rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums ${TONE[i.tone]}`}>
                          {i.count}
                        </span>
                        <ArrowRight className="w-4 h-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
                <CheckCircle2 className="w-5 h-5 text-accent" /> {t("adminDashboard.cc.allClearLong")}
              </p>
            )}
          </Card>

          {/* Pulse */}
          <Card order="order-3" icon={TrendingUp} title={t("adminDashboard.cc.pulse")} testId="dashboard-pulse">
            <div className="grid grid-cols-2 gap-3">
              <Kpi label={t("adminDashboard.cc.kpi.active")} value={s?.active_clients ?? "—"} hint={t("adminDashboard.cc.kpi.activeHint")} />
              <Kpi
                label={t("adminDashboard.cc.kpi.new")}
                value={dashboardLoaded ? sum("new_clients") : "—"}
                hint={t("adminDashboard.cc.last8w")}
                spark={weeks.map((w) => w.new_clients)}
              />
              <Kpi
                label={t("adminDashboard.cc.kpi.enrolled")}
                value={dashboardLoaded ? sum("enrolled") : "—"}
                hint={t("adminDashboard.cc.last8w")}
                spark={weeks.map((w) => w.enrolled)}
                accent
              />
              <Kpi
                label={t("adminDashboard.cc.kpi.completed")}
                value={dashboardLoaded ? sum("completed") : "—"}
                hint={t("adminDashboard.cc.completedTotal", { count: Number(s?.completed_clients ?? 0) })}
                spark={weeks.map((w) => w.completed)}
                accent
              />
            </div>
            {s?.avg_score_improvement != null && Number(s.avg_score_improvement) > 0 && (
              <p className="mt-3 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-foreground">
                <TrendingUp className="w-4 h-4 text-accent shrink-0" />
                {t("adminDashboard.cc.avgImprovement")} <b className="text-accent">+{s.avg_score_improvement} pts</b>
              </p>
            )}
          </Card>

          {/* Trends */}
          <Card order="order-5" icon={Activity} title={t("adminDashboard.cc.trends")} testId="dashboard-trends">
            {weeks.length > 0 && (
              <div className="h-48 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeks.map((w) => ({ ...w, label: weekLabel(w.week) }))} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={28} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                    <Bar dataKey="new_clients" name={t("adminDashboard.cc.kpi.new")} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="enrolled" name={t("adminDashboard.cc.kpi.enrolled")} fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="completed" name={t("adminDashboard.cc.kpi.completed")} fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <h3 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("adminDashboard.cc.funnel")}</h3>
            <HBars rows={FUNNEL.map((k) => ({ label: t(`adminDashboard.cc.stage.${k}`), value: stageCount(k) }))} />
            <Link to="/admin/pipeline" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
              {t("adminDashboard.cc.openPipeline")} <ArrowRight className="w-3 h-3" />
            </Link>
          </Card>
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-4">
          {/* Today */}
          <Card order="order-2" icon={CalendarClock} title={t("adminDashboard.cc.today")} testId="dashboard-today">
            {!dashboardLoaded ? (
              <Skeleton rows={3} />
            ) : (
              <div className="space-y-4">
                <div>
                  <SubHead title={t("adminDashboard.myTasksTitle")} to="/admin/my-tasks" cta={t("adminDashboard.viewMyTasks")} />
                  {dashboard.my_work_tasks.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">{t("adminDashboard.myTasksEmpty")}</p>
                  ) : (
                    <ol className="space-y-1">
                      {dashboard.my_work_tasks.slice(0, 5).map((task) => {
                        const d = task.days_until;
                        const when =
                          d == null
                            ? t("adminDashboard.noDueDate")
                            : d < 0
                              ? t("adminDashboard.cc.daysLate", { n: Math.abs(d) })
                              : d === 0
                                ? t("adminDashboard.today")
                                : d === 1
                                  ? t("adminDashboard.tomorrow")
                                  : t("adminDashboard.inDays", { n: d });
                        return (
                          <li key={task.id}>
                            <Link
                              to={task.client_id ? `/admin/pipeline?client=${task.client_id}` : "/admin/my-tasks"}
                              className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors"
                            >
                              <span className={`text-[11px] font-bold tabular-nums ${task.overdue ? "text-destructive" : "text-primary"}`}>{when}</span>
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-foreground truncate">{task.title}</span>
                                <span className="block text-[11px] text-muted-foreground truncate">
                                  {t(`myTasks.priority.${task.priority}`)}
                                  {task.client_first_name ? ` · ${task.client_first_name} ${task.client_last_name || ""}` : ""}
                                </span>
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
                <div>
                  <SubHead title={t("adminDashboard.upcomingRoundsTitle")} to="/admin/calendar" cta={t("adminDashboard.viewCalendar")} />
                  {dashboard.upcoming_rounds.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">{t("adminDashboard.upcomingRoundsEmpty")}</p>
                  ) : (
                    <ol className="space-y-1">
                      {dashboard.upcoming_rounds.slice(0, 6).map((r) => (
                        <li key={r.id}>
                          <Link
                            to={`/admin/pipeline?client=${r.client_id}`}
                            className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors"
                          >
                            <span className={`text-[11px] font-bold tabular-nums ${r.kind === "extended" ? "text-accent" : "text-primary"}`}>
                              {r.days_until === 0
                                ? t("adminDashboard.today")
                                : r.days_until === 1
                                  ? t("adminDashboard.tomorrow")
                                  : t("adminDashboard.inDays", { n: r.days_until })}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-foreground truncate">
                                {r.first_name} {r.last_name}
                              </span>
                              <span className="block text-[11px] text-muted-foreground truncate">
                                {r.case_number ?? "—"} ·{" "}
                                {r.kind === "extended"
                                  ? t("adminCalendar.extendedRoundN", { n: r.round_number })
                                  : t("adminCalendar.roundN", { n: r.round_number })}
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Money (super admins) */}
          {dashboard.is_super && (
            <Card order="order-4" icon={DollarSign} title={t("adminDashboard.cc.money")} testId="dashboard-money">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t("adminDashboard.cc.revenue30d")}</p>
                  <p className="text-3xl font-bold tabular-nums text-foreground">{money(Number(s?.revenue_cents_30d ?? 0))}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("adminDashboard.cc.revenue8w", { amount: money(sum("revenue_cents")) })}
                  </p>
                </div>
                <Sparkline values={weeks.map((w) => w.revenue_cents)} label={t("adminDashboard.cc.revenue30d")} className="text-accent" />
              </div>
              <h3 className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("adminDashboard.cc.recentPayments")}</h3>
              {dashboard.recent_payments.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">{t("adminDashboard.cc.noPayments")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {dashboard.recent_payments.map((p) => (
                    <li key={p.id}>
                      <Link to="/admin/payments" className="flex items-center justify-between gap-3 py-2 hover:bg-muted/30 rounded-lg px-1 transition-colors">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground truncate">
                            {p.first_name} {p.last_name}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">{ago(p.paid_at ?? p.created_at)}</span>
                        </span>
                        <span className="text-sm font-bold tabular-nums text-accent">{money(Number(p.amount_cents))}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* Activity */}
          <Card order="order-6" icon={Activity} title={t("adminDashboard.cc.activity")} testId="dashboard-activity">
            {!dashboardLoaded ? (
              <Skeleton rows={5} />
            ) : dashboard.activity.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4">{t("adminDashboard.cc.noActivity")}</p>
            ) : (
              <ol className="relative space-y-0.5 before:absolute before:left-[1.05rem] before:top-2 before:bottom-2 before:w-px before:bg-border">
                {dashboard.activity.map((a, i) => {
                  const Icon = ACT_ICON[a.kind] ?? Activity;
                  return (
                    <li key={`${a.kind}-${a.at}-${i}`}>
                      <Link to={`/admin/clients/${a.client_id}`} className="relative flex items-start gap-3 rounded-lg px-1 py-1.5 hover:bg-muted/40 transition-colors">
                        <span className="relative z-10 grid place-items-center w-7 h-7 rounded-full bg-card border border-border shrink-0">
                          <Icon className={`w-3.5 h-3.5 ${a.kind === "payment" ? "text-accent" : "text-primary"}`} />
                        </span>
                        <span className="min-w-0 pt-0.5">
                          <span className="block text-xs text-foreground leading-snug">
                            {t(`adminDashboard.cc.act.${a.kind}`, {
                              name: a.name || "—",
                              detail: a.kind === "payment" ? money(Number(a.detail ?? 0)) : (a.detail ?? ""),
                            })}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">{ago(a.at)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ order, icon: Icon, title, testId, children }: { order: string; icon: LucideIcon; title: string; testId: string; children: ReactNode }) {
  return (
    <section className={`${order} lg:order-none card-base p-4 sm:p-5 min-w-0`} data-testid={testId}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-primary/10">
          <Icon className="w-4 h-4 text-primary" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SubHead({ title, to, cta }: { title: string; to: string; cta: string }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <Link to={to} className="text-[11px] font-semibold text-primary inline-flex items-center gap-1">
        {cta} <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

function Kpi({ label, value, hint, spark, accent }: { label: string; value: number | string; hint: string; spark?: number[]; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border p-3 min-w-0">
      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      <div className="flex items-end justify-between gap-2">
        <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
        {spark && spark.length > 0 && <Sparkline values={spark} label={label} className={accent ? "text-accent" : "text-primary"} />}
      </div>
      <p className="text-[10px] text-muted-foreground truncate">{hint}</p>
    </div>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 rounded-lg bg-muted animate-pulse" />
      ))}
    </div>
  );
}

import { useEffect } from "react";
import { Link } from "react-router-dom";
import ClientPageHeader from "@/components/ClientPageHeader";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileText,
  LifeBuoy,
  PlayCircle,
  Sparkles,
  TrendingUp,
  User,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchDashboard, fetchPortalTasks } from "@/store/slices/portalSlice";

const STAGE_ORDER = [
  "new_client",
  "docs_ready",
  "round_1",
  "round_2",
  "round_3",
  "round_4",
  "round_5",
  "completed",
];

export default function Dashboard() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { dashboard, loading, tasks } = useAppSelector((s) => s.portal);
  const { user } = useAppSelector((s) => s.clientAuth);

  const STAGE_LABELS: Record<string, string> = {
    new_client: t("dashboard.stages.new_client"),
    docs_ready: t("dashboard.stages.docs_ready"),
    round_1: t("dashboard.stages.round_1"),
    round_2: t("dashboard.stages.round_2"),
    round_3: t("dashboard.stages.round_3"),
    round_4: t("dashboard.stages.round_4"),
    round_5: t("dashboard.stages.round_5"),
    completed: t("dashboard.stages.completed"),
    cancelled: t("dashboard.stages.cancelled"),
  };

  useEffect(() => {
    dispatch(fetchDashboard());
    dispatch(fetchPortalTasks());
  }, [dispatch]);

  const pendingTasks = tasks.filter(
    (t) => (t as any).completion_status !== "completed",
  ).length;
  const totalTasks = tasks.length;
  const taskProgressPct =
    totalTasks > 0
      ? Math.round(((totalTasks - pendingTasks) / totalTasks) * 100)
      : 0;

  const stage =
    dashboard?.client?.pipeline_stage || user?.pipeline_stage || "new_client";
  const stageIdx = STAGE_ORDER.indexOf(stage);
  const reports = dashboard?.reports || [];
  const latest = reports[0];
  const docsApproved = (dashboard?.documents || []).filter(
    (d: any) => d.review_status === "approved",
  ).length;
  const smartCreditConnected =
    !!user?.smart_credit_connected_at ||
    !!dashboard?.client?.smart_credit_connected_at;

  return (
    <div className="space-y-8">
      <ClientPageHeader
        title={t("dashboard.title", { name: user?.first_name || "" })}
        description={t("dashboard.description")}
      />

      {loading && !dashboard ? (
        <div className="grid sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-card rounded-2xl border border-border p-5 h-24 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <>
          {/* Pipeline progress */}
          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">
                {t("dashboard.yourProgress")}
              </h2>
              <div className="flex items-center gap-2">
                {dashboard?.active_case?.case_number && (
                  <span className="font-mono text-[11px] font-bold text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded">
                    {dashboard.active_case.case_number}
                  </span>
                )}
                <span className="text-xs font-semibold uppercase tracking-wide bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                  {STAGE_LABELS[stage] || stage}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {STAGE_ORDER.map((s, i) => (
                <div key={s} className="flex flex-col items-center gap-1.5">
                  <div
                    className={`w-full h-2 rounded-full transition-all duration-500 ${
                      i < stageIdx
                        ? "bg-accent"
                        : i === stageIdx
                          ? "bg-primary"
                          : "bg-secondary"
                    }`}
                  />
                  <span
                    className={`text-[10px] text-center leading-tight ${
                      i <= stageIdx
                        ? "text-foreground font-medium"
                        : "text-muted-foreground"
                    }`}
                  >
                    {STAGE_LABELS[s].split(" ")[0]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid sm:grid-cols-3 gap-4">
            <StatCard
              icon={TrendingUp}
              label={t("dashboard.itemsRemoved")}
              value={String(
                reports.reduce(
                  (acc: number, r: any) => acc + (r.items_removed || 0),
                  0,
                ),
              )}
              tint="from-accent/10 to-transparent"
              color="text-accent"
            />
            <StatCard
              icon={FileText}
              label={t("dashboard.docsApproved")}
              value={`${docsApproved}/4`}
              tint="from-primary/10 to-transparent"
              color="text-primary"
            />
            <StatCard
              icon={Sparkles}
              label={t("dashboard.latestScore")}
              value={latest?.score_after ? String(latest.score_after) : "—"}
              tint="from-yellow-500/10 to-transparent"
              color="text-yellow-600"
            />
          </div>

          {/* Onboarding Tasks widget */}
          {totalTasks > 0 && (
            <Link
              to="/portal/tasks"
              className="block bg-card rounded-2xl border border-border p-5 shadow-sm hover:border-primary/30 hover:shadow-md transition-all group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-primary" />
                  <h2 className="font-semibold">{t("tasks.heading")}</h2>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("tasks.progress", {
                      completed: totalTasks - pendingTasks,
                      total: totalTasks,
                    })}
                  </span>
                  <span
                    className={
                      taskProgressPct === 100
                        ? "text-accent font-bold"
                        : "text-primary font-bold"
                    }
                  >
                    {taskProgressPct}%
                  </span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      taskProgressPct === 100 ? "bg-accent" : "bg-primary"
                    }`}
                    style={{ width: `${taskProgressPct}%` }}
                  />
                </div>
                {pendingTasks > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {pendingTasks} task{pendingTasks !== 1 ? "s" : ""} remaining
                  </p>
                )}
                {pendingTasks === 0 && (
                  <p className="text-xs text-accent flex items-center gap-1 font-medium">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("tasks.allDone")}
                  </p>
                )}
              </div>
            </Link>
          )}

          {/* Onboarding checklist */}
          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">
              {t("dashboard.getStarted")}
            </h2>
            <ul className="space-y-2">
              {[
                {
                  label: t("dashboard.uploadDocuments"),
                  done: docsApproved >= 4,
                  to: "/portal/documents",
                },
                {
                  label: t("dashboard.connectSmartCredit"),
                  done: smartCreditConnected,
                  to: "/portal/profile",
                },
              ].map((item) => (
                <li key={item.label}>
                  <Link
                    to={item.to}
                    className="flex items-center gap-3 p-3 -mx-3 rounded-xl hover:bg-secondary/60 transition-colors"
                  >
                    {item.done ? (
                      <CheckCircle2 className="w-5 h-5 text-accent shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}
                    <span
                      className={`flex-1 text-sm ${
                        item.done
                          ? "line-through text-muted-foreground"
                          : "font-medium"
                      }`}
                    >
                      {item.label}
                    </span>
                    {!item.done && (
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Latest report */}
          {latest && (
            <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  Round {latest.round_number} Report
                </h2>
                <Link
                  to="/portal/reports"
                  className="text-sm text-primary font-medium inline-flex items-center gap-1 hover:underline"
                >
                  All reports <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <ReportStat
                  label="Items Removed"
                  value={latest.items_removed || 0}
                  accent
                />
                <ReportStat
                  label="Items Disputed"
                  value={latest.items_disputed || 0}
                />
                <ReportStat
                  label="Score Before"
                  value={latest.score_before || "—"}
                />
                <ReportStat
                  label="Score After"
                  value={latest.score_after || "—"}
                  accent
                />
              </div>
            </div>
          )}

          {/* Quick links */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <QuickLink
              to="/portal/documents"
              icon={FileText}
              title="My Documents"
              desc="Upload & track docs"
            />
            <QuickLink
              to="/portal/reports"
              icon={TrendingUp}
              title="Progress Reports"
              desc="Round-by-round results"
            />
            <QuickLink
              to="/portal/videos"
              icon={PlayCircle}
              title="Education"
              desc="Learn credit strategies"
            />
            <QuickLink
              to="/portal/support"
              icon={LifeBuoy}
              title="Support"
              desc="Get help from our team"
            />
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tint,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tint: string;
  color: string;
}) {
  return (
    <div
      className={`bg-gradient-to-br ${tint} bg-card rounded-2xl border border-border p-5 shadow-sm`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}

function ReportStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground tracking-wide">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${accent ? "text-accent" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  title,
  desc,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="group bg-card rounded-2xl border border-border p-5 shadow-sm hover:border-primary/30 hover:shadow-md transition-all flex items-start gap-4"
    >
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-sm">{title}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </Link>
  );
}

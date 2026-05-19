import { useEffect } from "react";
import { Link } from "react-router-dom";
import ClientPageHeader from "@/components/ClientPageHeader";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  FileText,
  LifeBuoy,
  PlayCircle,
  Sparkles,
  TrendingUp,
  User,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchDashboard } from "@/store/slices/portalSlice";

const STAGE_LABELS: Record<string, string> = {
  new_client: "New Client",
  docs_ready: "Docs Verified",
  round_1: "Round 1",
  round_2: "Round 2",
  round_3: "Round 3",
  round_4: "Round 4",
  round_5: "Round 5",
  completed: "Complete",
  cancelled: "Cancelled",
};

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
  const dispatch = useAppDispatch();
  const { dashboard, loading } = useAppSelector((s) => s.portal);
  const { user } = useAppSelector((s) => s.clientAuth);

  useEffect(() => {
    dispatch(fetchDashboard());
  }, [dispatch]);

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

  const onboardingTodos = [
    {
      label: "Upload your documents",
      done: docsApproved >= 4,
      to: "/portal/documents",
    },
    {
      label: "Connect Smart Credit monitoring",
      done: smartCreditConnected,
      to: "/portal/profile",
    },
  ];

  return (
    <div className="space-y-8">
      <ClientPageHeader
        title={`Welcome back, ${user?.first_name || "there"}!`}
        description="Here's a snapshot of your credit repair journey."
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
              <h2 className="text-lg font-semibold">Your Progress</h2>
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
              label="Items Removed"
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
              label="Documents Approved"
              value={`${docsApproved}/4`}
              tint="from-primary/10 to-transparent"
              color="text-primary"
            />
            <StatCard
              icon={Sparkles}
              label="Latest Credit Score"
              value={latest?.score_after ? String(latest.score_after) : "—"}
              tint="from-yellow-500/10 to-transparent"
              color="text-yellow-600"
            />
          </div>

          {/* Onboarding checklist */}
          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Get started</h2>
            <ul className="space-y-2">
              {onboardingTodos.map((t) => (
                <li key={t.label}>
                  <Link
                    to={t.to}
                    className="flex items-center gap-3 p-3 -mx-3 rounded-xl hover:bg-secondary/60 transition-colors"
                  >
                    {t.done ? (
                      <CheckCircle2 className="w-5 h-5 text-accent shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}
                    <span
                      className={`flex-1 text-sm ${
                        t.done
                          ? "line-through text-muted-foreground"
                          : "font-medium"
                      }`}
                    >
                      {t.label}
                    </span>
                    {!t.done && (
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

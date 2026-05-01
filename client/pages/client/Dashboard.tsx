import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  FileText,
  ScrollText,
  Sparkles,
  TrendingUp,
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

  const onboardingTodos = [
    {
      label: "Sign service agreement",
      done:
        !!user?.contract_signed_at || !!dashboard?.client?.contract_signed_at,
      to: "/portal/contract",
    },
    {
      label: "Upload your documents",
      done: docsApproved >= 4,
      to: "/portal/documents",
    },
    {
      label: "Connect Smart Credit",
      done:
        !!user?.smart_credit_connected_at ||
        !!dashboard?.client?.smart_credit_connected_at,
      to: "/portal/profile",
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl md:text-4xl font-bold">
          Welcome back, {user?.first_name || "there"}!
        </h1>
        <p className="text-muted-foreground mt-2">
          Here's a snapshot of your credit repair journey.
        </p>
      </div>

      {loading && !dashboard ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* Pipeline progress */}
          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Your Progress</h2>
              <span className="text-xs font-semibold uppercase tracking-wide bg-primary/10 text-primary px-2 py-1 rounded-full">
                {STAGE_LABELS[stage] || stage}
              </span>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
              {STAGE_ORDER.map((s, i) => (
                <div key={s} className="flex flex-col items-center gap-1">
                  <div
                    className={`w-full h-2 rounded-full ${
                      i <= stageIdx ? "bg-primary" : "bg-secondary"
                    }`}
                  />
                  <span
                    className={`text-[10px] sm:text-xs text-center ${
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
              tint="from-accent/10 to-accent/0"
              color="text-accent"
            />
            <StatCard
              icon={FileText}
              label="Documents Approved"
              value={`${docsApproved}/4`}
              tint="from-primary/10 to-primary/0"
              color="text-primary"
            />
            <StatCard
              icon={Sparkles}
              label="Latest Score"
              value={latest?.score_after ? String(latest.score_after) : "—"}
              tint="from-yellow-100 to-yellow-50"
              color="text-yellow-600"
            />
          </div>

          {/* Onboarding checklist */}
          <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Get started</h2>
            <ul className="space-y-3">
              {onboardingTodos.map((t) => (
                <li key={t.label}>
                  <Link
                    to={t.to}
                    className="flex items-center gap-3 p-3 -mx-3 rounded-lg hover:bg-secondary/60 transition-colors"
                  >
                    {t.done ? (
                      <CheckCircle2 className="w-5 h-5 text-accent shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}
                    <span
                      className={`flex-1 ${
                        t.done
                          ? "line-through text-muted-foreground"
                          : "font-medium"
                      }`}
                    >
                      {t.label}
                    </span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
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
                  className="text-sm text-primary font-medium inline-flex items-center"
                >
                  All reports <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs uppercase">
                    Items Removed
                  </div>
                  <div className="text-2xl font-bold mt-1">
                    {latest.items_removed || 0}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase">
                    Items Disputed
                  </div>
                  <div className="text-2xl font-bold mt-1">
                    {latest.items_disputed || 0}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase">
                    Score Before
                  </div>
                  <div className="text-2xl font-bold mt-1">
                    {latest.score_before || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase">
                    Score After
                  </div>
                  <div className="text-2xl font-bold mt-1 text-accent">
                    {latest.score_after || "—"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Quick links */}
          <div className="grid sm:grid-cols-2 gap-4">
            <QuickLink
              to="/portal/documents"
              icon={FileText}
              title="Upload documents"
              desc="ID, SSN, and proof of address"
            />
            <QuickLink
              to="/portal/contract"
              icon={ScrollText}
              title="Service agreement"
              desc="Review and e-sign"
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
  icon: any;
  label: string;
  value: string;
  tint: string;
  color: string;
}) {
  return (
    <div
      className={`bg-gradient-to-br ${tint} bg-card rounded-2xl border border-border p-5 shadow-sm`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div className="text-3xl font-bold mt-2">{value}</div>
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
  icon: any;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="group bg-card rounded-2xl border border-border p-5 shadow-sm hover:border-primary/30 hover:shadow-md transition-all flex items-start gap-4"
    >
      <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
    </Link>
  );
}

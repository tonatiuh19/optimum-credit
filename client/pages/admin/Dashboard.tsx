import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  DollarSign,
  FileCheck2,
  LayoutDashboard,
  TrendingUp,
  Users,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminDashboard } from "@/store/slices/adminSlice";

export default function AdminDashboard() {
  const dispatch = useAppDispatch();
  const { dashboard } = useAppSelector((s) => s.admin);

  useEffect(() => {
    dispatch(fetchAdminDashboard());
  }, [dispatch]);

  const s = dashboard.stats;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        description="Operational overview at a glance."
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          icon={Users}
          label="Active clients"
          value={s?.active_clients ?? "—"}
          tint="from-blue-500/20"
        />
        <Stat
          icon={TrendingUp}
          label="New (30d)"
          value={s?.new_clients_30d ?? "—"}
          tint="from-accent/20"
        />
        <Stat
          icon={FileCheck2}
          label="Pending docs"
          value={s?.pending_doc_reviews ?? "—"}
          tint="from-yellow-500/20"
        />
        <Stat
          icon={DollarSign}
          label="Revenue (30d)"
          value={
            s?.revenue_cents_30d
              ? `$${(Number(s.revenue_cents_30d) / 100).toLocaleString()}`
              : "—"
          }
          tint="from-violet-500/20"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-2xl border border-border p-6">
          <h2 className="font-semibold mb-4">Pipeline distribution</h2>
          <div className="space-y-3">
            {dashboard.stages.map((row) => (
              <div key={row.pipeline_stage} className="flex items-center gap-3">
                <span className="text-sm capitalize w-32 text-muted-foreground">
                  {row.pipeline_stage.replace(/_/g, " ")}
                </span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{
                      width: `${Math.min(
                        100,
                        (Number(row.count) /
                          Math.max(1, Number(s?.active_clients) || 1)) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
                <span className="text-sm font-semibold w-10 text-right">
                  {row.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Recent clients</h2>
            <Link
              to="/admin/clients"
              className="text-sm text-primary inline-flex items-center"
            >
              View all <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          <div className="space-y-2">
            {dashboard.recent_clients.map((c) => (
              <Link
                key={c.id}
                to={`/admin/clients/${c.id}`}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5"
              >
                <div>
                  <div className="font-medium text-sm">
                    {c.first_name} {c.last_name}
                  </div>
                  <div className="text-xs text-slate-400">{c.email}</div>
                </div>
                <span className="text-xs uppercase tracking-wide bg-white/5 px-2 py-1 rounded">
                  {c.pipeline_stage.replace(/_/g, " ")}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tint,
}: {
  icon: any;
  label: string;
  value: any;
  tint: string;
}) {
  return (
    <div
      className={`bg-card rounded-2xl border border-border p-5 overflow-hidden relative`}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${tint} to-transparent opacity-40 pointer-events-none`}
      />
      <div className="relative flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div className="text-3xl font-bold mt-2">{value}</div>
    </div>
  );
}

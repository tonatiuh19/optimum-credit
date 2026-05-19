import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  DollarSign,
  FileCheck2,
  FileText,
  LayoutDashboard,
  MessageSquare,
  TrendingUp,
  Users,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminDashboard } from "@/store/slices/adminSlice";
import type { AdminDashboardTicket, AdminDashboardPayment } from "@shared/api";

export default function AdminDashboard() {
  const dispatch = useAppDispatch();
  const { dashboard } = useAppSelector((s) => s.admin);

  useEffect(() => {
    dispatch(fetchAdminDashboard());
  }, [dispatch]);

  const s = dashboard.stats;

  const fmtMoney = (cents: number) =>
    `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;

  const priorityColor: Record<string, string> = {
    urgent: "text-destructive bg-destructive/10",
    high: "text-orange-400 bg-orange-400/10",
    normal: "text-muted-foreground bg-muted",
    low: "text-muted-foreground bg-muted",
  };

  const ticketStatusLabel: Record<string, string> = {
    open: "Open",
    in_progress: "In Progress",
    waiting_client: "Waiting",
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        description="Operational overview at a glance."
      />

      {/* ── Stat cards ── */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          icon={Users}
          label="Active clients"
          value={s?.active_clients ?? "—"}
          tint="from-blue-500/20"
        />
        <Stat
          icon={TrendingUp}
          label="New this month"
          value={s?.new_clients_30d ?? "—"}
          tint="from-accent/20"
        />
        <Stat
          icon={CheckCircle2}
          label="Completed"
          value={s?.completed_clients ?? "—"}
          tint="from-emerald-500/20"
        />
        <Stat
          icon={DollarSign}
          label="Revenue (30d)"
          value={
            s?.revenue_cents_30d != null
              ? fmtMoney(Number(s.revenue_cents_30d))
              : "—"
          }
          tint="from-violet-500/20"
        />
      </div>

      {/* ── Action-needed row ── */}
      <div className="grid sm:grid-cols-3 gap-4">
        <ActionCard
          icon={FileCheck2}
          label="Pending doc reviews"
          value={s?.pending_doc_reviews ?? "—"}
          to="/admin/documents"
          urgent={(s?.pending_doc_reviews ?? 0) > 0}
        />
        <ActionCard
          icon={MessageSquare}
          label="Open support tickets"
          value={s?.open_tickets ?? "—"}
          to="/admin/tickets"
          urgent={(s?.open_tickets ?? 0) > 0}
        />
        <ActionCard
          icon={CreditCard}
          label="Pending payments"
          value={s?.pending_payments ?? "—"}
          to="/admin/payments"
          urgent={(s?.pending_payments ?? 0) > 0}
        />
      </div>

      {/* ── Score improvement banner ── */}
      {s?.avg_score_improvement != null &&
        Number(s.avg_score_improvement) > 0 && (
          <div className="bg-accent/10 border border-accent/30 rounded-2xl p-4 flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-accent shrink-0" />
            <p className="text-sm font-medium">
              Average credit score improvement across all clients:{" "}
              <span className="text-accent font-bold">
                +{s.avg_score_improvement} pts
              </span>
            </p>
          </div>
        )}

      {/* ── Main panels ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Pipeline distribution */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Pipeline distribution</h2>
            <Link
              to="/admin/pipeline"
              className="text-xs text-primary inline-flex items-center gap-1"
            >
              View <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-3">
            {dashboard.stages.map((row) => (
              <div key={row.pipeline_stage} className="flex items-center gap-3">
                <span className="text-xs capitalize w-28 text-muted-foreground truncate">
                  {row.pipeline_stage.replace(/_/g, " ")}
                </span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
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
                <span className="text-xs font-semibold w-8 text-right tabular-nums">
                  {row.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent open tickets */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Open tickets</h2>
            <Link
              to="/admin/tickets"
              className="text-xs text-primary inline-flex items-center gap-1"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {dashboard.recent_tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
              <CheckCircle2 className="w-8 h-8 text-accent/60" />
              <span>No open tickets</span>
            </div>
          ) : (
            <div className="space-y-2">
              {dashboard.recent_tickets.map((t: AdminDashboardTicket) => (
                <Link
                  key={t.id}
                  to="/admin/tickets"
                  className="flex items-start gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <span
                    className={`mt-0.5 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded shrink-0 ${priorityColor[t.priority] || priorityColor.normal}`}
                  >
                    {t.priority}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {t.subject}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t.first_name} {t.last_name} ·{" "}
                      {ticketStatusLabel[t.status] ?? t.status}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent payments */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Recent payments</h2>
            <Link
              to="/admin/payments"
              className="text-xs text-primary inline-flex items-center gap-1"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {dashboard.recent_payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
              <DollarSign className="w-8 h-8 text-muted-foreground/40" />
              <span>No payments yet</span>
            </div>
          ) : (
            <div className="space-y-2">
              {dashboard.recent_payments.map((p: AdminDashboardPayment) => (
                <Link
                  key={p.id}
                  to="/admin/payments"
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {p.first_name} {p.last_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.paid_at
                        ? new Date(p.paid_at).toLocaleDateString()
                        : new Date(p.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="text-sm font-bold text-accent">
                    {fmtMoney(Number(p.amount_cents))}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Recent clients ── */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Recently joined clients</h2>
          <Link
            to="/admin/clients"
            className="text-sm text-primary inline-flex items-center gap-1"
          >
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {dashboard.recent_clients.map((c) => (
            <Link
              key={c.id}
              to={`/admin/clients/${c.id}`}
              className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-border"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">
                  {c.first_name} {c.last_name}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {c.email}
                </div>
              </div>
              <span className="text-xs uppercase tracking-wide bg-white/5 px-2 py-1 rounded ml-2 shrink-0">
                {c.pipeline_stage.replace(/_/g, " ")}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Quick actions ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Quick actions
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: Users, label: "Manage clients", to: "/admin/clients" },
            {
              icon: FileText,
              label: "Review documents",
              to: "/admin/documents",
            },
            {
              icon: MessageSquare,
              label: "Support tickets",
              to: "/admin/tickets",
            },
            { icon: CreditCard, label: "Payments", to: "/admin/payments" },
          ].map(({ icon: Icon, label, to }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary/40 hover:bg-primary/5 transition-all group"
            >
              <Icon className="w-5 h-5 text-primary/60 group-hover:text-primary transition-colors" />
              <span className="text-sm font-medium">{label}</span>
              <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground group-hover:text-primary transition-colors" />
            </Link>
          ))}
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
    <div className="bg-card rounded-2xl border border-border p-5 overflow-hidden relative">
      <div
        className={`absolute inset-0 bg-gradient-to-br ${tint} to-transparent opacity-40 pointer-events-none`}
      />
      <div className="relative flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div className="text-3xl font-bold mt-2 relative">{value}</div>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  label,
  value,
  to,
  urgent,
}: {
  icon: any;
  label: string;
  value: any;
  to: string;
  urgent: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-4 p-4 rounded-2xl border transition-all hover:scale-[1.01] ${
        urgent
          ? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
          : "border-border bg-card hover:bg-white/5"
      }`}
    >
      <div
        className={`p-2 rounded-lg ${urgent ? "bg-destructive/10" : "bg-primary/10"}`}
      >
        {urgent ? (
          <AlertCircle className="w-5 h-5 text-destructive" />
        ) : (
          <Icon className="w-5 h-5 text-primary" />
        )}
      </div>
      <div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
      <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground" />
    </Link>
  );
}

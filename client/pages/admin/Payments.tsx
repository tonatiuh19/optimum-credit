import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  CreditCard,
  TrendingUp,
  Clock,
  XCircle,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  DollarSign,
  Wallet,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Workflow,
  User,
  Tag,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Copy,
  BadgePercent,
  Minus,
  CalendarDays,
  Hash,
  ShieldAlert,
  Loader2,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAdminPayments,
  fetchAdminCoupons,
  createAdminCoupon,
  updateAdminCoupon,
  deleteAdminCoupon,
} from "@/store/slices/adminSlice";
import type {
  Coupon,
  CouponDiscountType,
  Payment,
  PaymentStatus,
  PipelineStage,
} from "@shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebounce } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_CONFIG: Record<
  PaymentStatus,
  { label: string; className: string; icon: React.ElementType }
> = {
  succeeded: {
    label: "Succeeded",
    className: "bg-accent/15 text-accent border-accent/30",
    icon: CheckCircle2,
  },
  pending: {
    label: "Pending",
    className: "bg-yellow-500/10 text-yellow-600 border-yellow-400/30",
    icon: Clock,
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/10 text-destructive border-destructive/30",
    icon: XCircle,
  },
  refunded: {
    label: "Refunded",
    className: "bg-muted text-muted-foreground border-border",
    icon: RefreshCw,
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground border-border",
    icon: XCircle,
  },
};

const PIPELINE_LABELS: Record<PipelineStage, string> = {
  new_client: "New Client",
  docs_ready: "Docs Verified",
  round_1: "Round 1",
  round_2: "Round 2",
  round_3: "Round 3",
  round_4: "Round 4",
  round_5: "Round 5",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PIPELINE_COLORS: Record<PipelineStage, string> = {
  new_client: "bg-primary/10 text-primary",
  docs_ready: "bg-accent/10 text-accent",
  round_1: "bg-blue-500/10 text-blue-500",
  round_2: "bg-blue-600/10 text-blue-600",
  round_3: "bg-violet-500/10 text-violet-500",
  round_4: "bg-violet-600/10 text-violet-600",
  round_5: "bg-purple-500/10 text-purple-500",
  completed: "bg-accent/15 text-accent",
  cancelled: "bg-muted text-muted-foreground",
};

const PROVIDER_LABELS: Record<string, string> = {
  authorize_net: "Authorize.net",
  stripe: "Stripe",
  manual: "Manual",
};

// ─── Summary card ────────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  gradient,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  gradient: string;
}) {
  return (
    <div
      className={`relative bg-card border border-border rounded-2xl p-5 overflow-hidden`}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-40 pointer-events-none`}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            {label}
          </p>
          <p className="text-2xl font-bold text-foreground truncate">{value}</p>
          {sub && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>
          )}
        </div>
        <div className="shrink-0 w-10 h-10 rounded-xl bg-background/60 border border-border flex items-center justify-center">
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}

// ─── Payment row ─────────────────────────────────────────────────────────────

function PaymentRow({ payment }: { payment: Payment }) {
  const statusCfg = STATUS_CONFIG[payment.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = statusCfg.icon;
  const stage = payment.client_pipeline_stage;

  return (
    <tr className="border-b border-border/60 hover:bg-muted/30 transition-colors group">
      {/* Amount + status */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              payment.status === "succeeded"
                ? "bg-accent/15"
                : payment.status === "failed"
                  ? "bg-destructive/10"
                  : "bg-muted"
            }`}
          >
            <StatusIcon
              className={`w-4 h-4 ${
                payment.status === "succeeded"
                  ? "text-accent"
                  : payment.status === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground"
              }`}
            />
          </div>
          <div>
            <div className="font-semibold text-foreground text-sm">
              {fmt(payment.amount_cents)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {payment.currency}
            </div>
          </div>
        </div>
      </td>

      {/* Client */}
      <td className="px-4 py-3.5">
        <Link
          to={`/admin/clients/${payment.client_id}`}
          className="group/link flex items-start gap-2 hover:no-underline"
        >
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-bold text-primary">
            {(payment.client_first_name?.[0] ?? "") +
              (payment.client_last_name?.[0] ?? "")}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground group-hover/link:text-primary transition-colors flex items-center gap-1">
              {payment.client_first_name} {payment.client_last_name}
              <ExternalLink className="w-3 h-3 opacity-0 group-hover/link:opacity-60 transition-opacity" />
            </div>
            <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">
              {payment.client_email}
            </div>
          </div>
        </Link>
      </td>

      {/* Package */}
      <td className="px-4 py-3.5 hidden md:table-cell">
        {payment.package_name ? (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-muted text-xs font-medium text-foreground border border-border">
            {payment.package_name}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Pipeline stage */}
      <td className="px-4 py-3.5 hidden lg:table-cell">
        {stage ? (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${
              PIPELINE_COLORS[stage] ?? "bg-muted text-muted-foreground"
            }`}
          >
            <Workflow className="w-3 h-3" />
            {PIPELINE_LABELS[stage] ?? stage}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Provider */}
      <td className="px-4 py-3.5 hidden xl:table-cell">
        <span className="text-xs text-muted-foreground">
          {PROVIDER_LABELS[payment.provider] ?? payment.provider}
        </span>
      </td>

      {/* Status badge */}
      <td className="px-4 py-3.5">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusCfg.className}`}
        >
          <StatusIcon className="w-3 h-3" />
          {statusCfg.label}
        </span>
      </td>

      {/* Transaction ID */}
      <td className="px-4 py-3.5 hidden xl:table-cell">
        {payment.provider_transaction_id ? (
          <span className="font-mono text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {payment.provider_transaction_id.slice(0, 16)}…
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* Date */}
      <td className="px-4 py-3.5 text-right">
        <div className="text-xs text-muted-foreground">
          {payment.paid_at
            ? fmtDate(payment.paid_at)
            : fmtDate(payment.created_at)}
        </div>
        {payment.paid_at && (
          <div className="text-[10px] text-muted-foreground/60 mt-0.5">
            {new Date(payment.paid_at).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Transactions tab ────────────────────────────────────────────────────────

function TransactionsTab() {
  const dispatch = useAppDispatch();
  const {
    payments,
    paymentsSummary: summary,
    paymentsPagination: pagination,
    loading,
  } = useAppSelector((s) => s.admin);

  const [statusFilter, setStatusFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [searchRaw, setSearchRaw] = useState("");
  const [page, setPage] = useState(1);

  const search = useDebounce(searchRaw, 350);

  const load = useCallback(() => {
    dispatch(
      fetchAdminPayments({
        status: statusFilter === "all" ? undefined : statusFilter,
        provider: providerFilter === "all" ? undefined : providerFilter,
        search: search || undefined,
        page,
        limit: 50,
      }),
    );
  }, [dispatch, statusFilter, providerFilter, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, providerFilter, search]);

  const totalRevenue = summary?.total_revenue_cents ?? 0;
  const revenue30d = summary?.revenue_30d_cents ?? 0;
  const revenue7d = summary?.revenue_7d_cents ?? 0;

  return (
    <div className="space-y-5">
      {/* ── Summary cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={DollarSign}
          label="Total Revenue"
          value={fmt(totalRevenue)}
          sub={`${summary?.succeeded_count ?? 0} succeeded`}
          gradient="from-accent/20 to-transparent"
        />
        <SummaryCard
          icon={TrendingUp}
          label="Last 30 Days"
          value={fmt(revenue30d)}
          sub={`Last 7d: ${fmt(revenue7d)}`}
          gradient="from-primary/20 to-transparent"
        />
        <SummaryCard
          icon={Clock}
          label="Pending"
          value={String(summary?.pending_count ?? 0)}
          sub="Awaiting confirmation"
          gradient="from-yellow-500/15 to-transparent"
        />
        <SummaryCard
          icon={AlertCircle}
          label="Failed / Refunded"
          value={String(
            (summary?.failed_count ?? 0) + (summary?.refunded_count ?? 0),
          )}
          sub={`${summary?.failed_count ?? 0} failed · ${summary?.refunded_count ?? 0} refunded`}
          gradient="from-destructive/10 to-transparent"
        />
      </div>

      {/* ── Filters ────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-border/60">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by name, email or transaction ID…"
              className="pl-9"
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="succeeded">Succeeded</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-[160px]">
                <Wallet className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                <SelectItem value="authorize_net">Authorize.net</SelectItem>
                <SelectItem value="stripe">Stripe</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={load}
              disabled={loading}
              className="shrink-0"
            >
              <RefreshCw
                className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>

        {/* ── Table ──────────────────────────────────────────────── */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Client
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                  Package
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                  Pipeline Stage
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">
                  Provider
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">
                  Transaction ID
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Date
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && payments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <RefreshCw className="w-6 h-6 animate-spin" />
                      <span className="text-sm">Loading payments…</span>
                    </div>
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <CreditCard className="w-8 h-8 opacity-30" />
                      <div>
                        <p className="text-sm font-medium">No payments found</p>
                        <p className="text-xs mt-1 opacity-70">
                          Try adjusting your filters
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                payments.map((p) => <PaymentRow key={p.id} payment={p} />)
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ─────────────────────────────────────────── */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/60">
            <p className="text-xs text-muted-foreground">
              Showing{" "}
              <span className="font-medium text-foreground">
                {(pagination.page - 1) * pagination.limit + 1}–
                {Math.min(pagination.page * pagination.limit, pagination.total)}
              </span>{" "}
              of{" "}
              <span className="font-medium text-foreground">
                {pagination.total}
              </span>{" "}
              transactions
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground px-1">
                {page} / {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Pipeline × Revenue breakdown ──────────────────────────── */}
      <PipelineBreakdown payments={payments} />
    </div>
  );
}

// ─── Pipeline × Revenue breakdown ────────────────────────────────────────────

function PipelineBreakdown({ payments }: { payments: Payment[] }) {
  const succeeded = payments.filter((p) => p.status === "succeeded");
  if (succeeded.length === 0) return null;

  // Group by pipeline stage
  const stageMap = new Map<
    string,
    { count: number; revenue: number; clients: Set<number> }
  >();

  for (const p of succeeded) {
    const stage = p.client_pipeline_stage ?? "unknown";
    const prev = stageMap.get(stage) ?? {
      count: 0,
      revenue: 0,
      clients: new Set(),
    };
    prev.count += 1;
    prev.revenue += p.amount_cents;
    prev.clients.add(p.client_id);
    stageMap.set(stage, prev);
  }

  const total = succeeded.reduce((s, p) => s + p.amount_cents, 0);
  const entries = Array.from(stageMap.entries()).sort(
    (a, b) => b[1].revenue - a[1].revenue,
  );

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {/* Stage breakdown */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Workflow className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Revenue by Pipeline Stage</h3>
        </div>
        <div className="space-y-3">
          {entries.map(([stage, data]) => {
            const pct = total > 0 ? (data.revenue / total) * 100 : 0;
            const colorClass =
              PIPELINE_COLORS[stage as PipelineStage] ??
              "bg-muted text-muted-foreground";
            return (
              <div key={stage}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-md font-medium ${colorClass}`}
                    >
                      {PIPELINE_LABELS[stage as PipelineStage] ?? stage}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {data.clients.size} client
                      {data.clients.size !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <span className="text-sm font-semibold">
                    {fmt(data.revenue)}
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top clients by spend */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <User className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Top Clients by Revenue</h3>
        </div>
        <TopClients payments={succeeded} />
      </div>
    </div>
  );
}

function TopClients({ payments }: { payments: Payment[] }) {
  const clientMap = new Map<
    number,
    { name: string; email: string; revenue: number; stage: string | null }
  >();

  for (const p of payments) {
    const prev = clientMap.get(p.client_id) ?? {
      name: `${p.client_first_name ?? ""} ${p.client_last_name ?? ""}`.trim(),
      email: p.client_email ?? "",
      revenue: 0,
      stage: p.client_pipeline_stage ?? null,
    };
    prev.revenue += p.amount_cents;
    clientMap.set(p.client_id, prev);
  }

  const top = Array.from(clientMap.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 6);

  if (top.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No data yet
      </p>
    );
  }

  const maxRevenue = top[0][1].revenue;

  return (
    <div className="space-y-2.5">
      {top.map(([id, data]) => (
        <div key={id} className="flex items-center gap-3 group">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-[11px] font-bold text-primary">
            {data.name
              .split(" ")
              .map((n) => n[0] ?? "")
              .join("")
              .slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <Link
                to={`/admin/clients/${id}`}
                className="text-xs font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
              >
                {data.name || "Unknown"}
                <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
              </Link>
              <span className="text-xs font-semibold ml-2 shrink-0">
                {fmt(data.revenue)}
              </span>
            </div>
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{
                  width: `${maxRevenue > 0 ? (data.revenue / maxRevenue) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Coupon form state ────────────────────────────────────────────────────────

interface CouponFormState {
  code: string;
  description: string;
  discount_type: CouponDiscountType;
  discount_value: string;
  min_amount_cents: string;
  max_uses: string;
  valid_from: string;
  expires_at: string;
  is_active: boolean;
}

const EMPTY_FORM: CouponFormState = {
  code: "",
  description: "",
  discount_type: "percentage",
  discount_value: "",
  min_amount_cents: "0",
  max_uses: "",
  valid_from: "",
  expires_at: "",
  is_active: true,
};

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function couponToForm(c: Coupon): CouponFormState {
  return {
    code: c.code,
    description: c.description ?? "",
    discount_type: c.discount_type,
    discount_value: String(c.discount_value),
    min_amount_cents: String((c.min_amount_cents ?? 0) / 100),
    max_uses: c.max_uses != null ? String(c.max_uses) : "",
    valid_from: toLocalInput(c.valid_from),
    expires_at: toLocalInput(c.expires_at),
    is_active: Boolean(c.is_active),
  };
}

// ─── Coupon create/edit modal ─────────────────────────────────────────────────

function CouponModal({
  open,
  editing,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing: Coupon | null;
  saving: boolean;
  onClose: () => void;
  onSubmit: (form: CouponFormState) => void;
}) {
  const [form, setForm] = useState<CouponFormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<
    Partial<Record<keyof CouponFormState, string>>
  >({});

  useEffect(() => {
    if (open) {
      setForm(editing ? couponToForm(editing) : EMPTY_FORM);
      setErrors({});
    }
  }, [open, editing]);

  const set = (key: keyof CouponFormState, val: string | boolean) =>
    setForm((f) => ({ ...f, [key]: val }));

  const validate = (): boolean => {
    const e: Partial<Record<keyof CouponFormState, string>> = {};
    if (!form.code.trim()) e.code = "Code is required";
    const val = Number(form.discount_value);
    if (!form.discount_value || isNaN(val) || val <= 0)
      e.discount_value = "Must be greater than 0";
    if (form.discount_type === "percentage" && val > 100)
      e.discount_value = "Percentage cannot exceed 100";
    if (form.min_amount_cents && isNaN(Number(form.min_amount_cents)))
      e.min_amount_cents = "Invalid amount";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2 text-base font-semibold">
          <Tag className="w-4 h-4 text-primary" />
          {editing ? "Edit Coupon" : "Create Coupon"}
        </DialogTitle>

        <form onSubmit={handleSubmit} className="space-y-4 mt-1">
          {/* Code */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Coupon Code *
            </label>
            <Input
              placeholder="e.g. SAVE20"
              value={form.code}
              onChange={(e) =>
                set(
                  "code",
                  e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
                )
              }
              className={errors.code ? "border-destructive" : ""}
            />
            {errors.code && (
              <p className="text-xs text-destructive">{errors.code}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Description
            </label>
            <Textarea
              placeholder="Internal note about this coupon…"
              rows={2}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className="resize-none"
            />
          </div>

          {/* Discount type + value */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Discount Type *
              </label>
              <Select
                value={form.discount_type}
                onValueChange={(v) =>
                  set("discount_type", v as CouponDiscountType)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">
                    <span className="flex items-center gap-1.5">
                      <BadgePercent className="w-3.5 h-3.5" /> Percentage
                    </span>
                  </SelectItem>
                  <SelectItem value="fixed">
                    <span className="flex items-center gap-1.5">
                      <Minus className="w-3.5 h-3.5" /> Fixed Amount ($)
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {form.discount_type === "percentage"
                  ? "Percentage %"
                  : "Amount ($)"}{" "}
                *
              </label>
              <Input
                type="number"
                min="0"
                max={form.discount_type === "percentage" ? "100" : undefined}
                step={form.discount_type === "percentage" ? "1" : "0.01"}
                placeholder={
                  form.discount_type === "percentage" ? "20" : "50.00"
                }
                value={form.discount_value}
                onChange={(e) => set("discount_value", e.target.value)}
                className={errors.discount_value ? "border-destructive" : ""}
              />
              {errors.discount_value && (
                <p className="text-xs text-destructive">
                  {errors.discount_value}
                </p>
              )}
            </div>
          </div>

          {/* Min amount + Max uses */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Min. Order ($)
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={form.min_amount_cents}
                onChange={(e) => set("min_amount_cents", e.target.value)}
                className={errors.min_amount_cents ? "border-destructive" : ""}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Max Uses (blank = unlimited)
              </label>
              <Input
                type="number"
                min="1"
                step="1"
                placeholder="Unlimited"
                value={form.max_uses}
                onChange={(e) => set("max_uses", e.target.value)}
              />
            </div>
          </div>

          {/* Valid from + Expires */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Valid From
              </label>
              <Input
                type="datetime-local"
                value={form.valid_from}
                onChange={(e) => set("valid_from", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Expires At
              </label>
              <Input
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) => set("expires_at", e.target.value)}
              />
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between bg-muted/40 rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">
                Inactive coupons cannot be redeemed
              </p>
            </div>
            <button
              type="button"
              onClick={() => set("is_active", !form.is_active)}
              className="text-primary hover:opacity-80 transition-opacity"
            >
              {form.is_active ? (
                <ToggleRight className="w-8 h-8" />
              ) : (
                <ToggleLeft className="w-8 h-8 text-muted-foreground" />
              )}
            </button>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editing ? "Save Changes" : "Create Coupon"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Coupon table row ─────────────────────────────────────────────────────────

function CouponRow({
  coupon,
  onEdit,
  onToggle,
  onDelete,
}: {
  coupon: Coupon;
  onEdit: (c: Coupon) => void;
  onToggle: (c: Coupon) => void;
  onDelete: (c: Coupon) => void;
}) {
  const { toast } = useToast();

  const copyCode = () => {
    navigator.clipboard
      .writeText(coupon.code)
      .then(() =>
        toast({
          title: "Copied!",
          description: `${coupon.code} copied to clipboard`,
        }),
      );
  };

  const isExpired =
    !!coupon.expires_at && new Date(coupon.expires_at) < new Date();
  const usagePct =
    coupon.max_uses != null
      ? Math.round((coupon.uses_count / coupon.max_uses) * 100)
      : null;

  return (
    <tr className="border-b border-border/60 hover:bg-muted/30 transition-colors group">
      {/* Code */}
      <td className="px-4 py-3.5">
        <button
          onClick={copyCode}
          className="font-mono text-sm font-bold text-foreground bg-muted px-2.5 py-1 rounded-lg border border-border hover:border-primary/40 transition-colors flex items-center gap-1.5 group/copy"
        >
          {coupon.code}
          <Copy className="w-3 h-3 text-muted-foreground opacity-0 group-hover/copy:opacity-100 transition-opacity" />
        </button>
        {coupon.description && (
          <p className="text-[11px] text-muted-foreground mt-1 max-w-[200px] truncate">
            {coupon.description}
          </p>
        )}
      </td>

      {/* Discount */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          {coupon.discount_type === "percentage" ? (
            <BadgePercent className="w-4 h-4 text-primary shrink-0" />
          ) : (
            <Minus className="w-4 h-4 text-primary shrink-0" />
          )}
          <span className="font-semibold text-sm">
            {coupon.discount_type === "percentage"
              ? `${coupon.discount_value}%`
              : new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                }).format(coupon.discount_value / 100)}
          </span>
          <span className="text-xs text-muted-foreground">
            {coupon.discount_type === "percentage" ? "off" : "flat"}
          </span>
        </div>
        {coupon.min_amount_cents > 0 && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Min.{" "}
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
            }).format(coupon.min_amount_cents / 100)}
          </p>
        )}
      </td>

      {/* Uses */}
      <td className="px-4 py-3.5 hidden sm:table-cell">
        <div className="flex items-center gap-2">
          <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {coupon.uses_count}
              {coupon.max_uses != null ? ` / ${coupon.max_uses}` : ""}
            </div>
            {usagePct !== null && (
              <div className="mt-1 h-1 w-20 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${usagePct >= 90 ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${Math.min(usagePct, 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Validity */}
      <td className="px-4 py-3.5 hidden md:table-cell">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="w-3.5 h-3.5 shrink-0" />
          <div>
            {coupon.valid_from ? (
              <div>
                {new Date(coupon.valid_from).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                →
              </div>
            ) : null}
            <div>
              {coupon.expires_at ? (
                <span
                  className={isExpired ? "text-destructive font-medium" : ""}
                >
                  {isExpired ? "Expired " : "Until "}
                  {new Date(coupon.expires_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              ) : (
                "No expiry"
              )}
            </div>
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="px-4 py-3.5">
        {coupon.is_active && !isExpired ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-accent/15 text-accent border-accent/30">
            <CheckCircle2 className="w-3 h-3" /> Active
          </span>
        ) : isExpired ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-muted text-muted-foreground border-border">
            <Clock className="w-3 h-3" /> Expired
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-muted text-muted-foreground border-border">
            <XCircle className="w-3 h-3" /> Inactive
          </span>
        )}
      </td>

      {/* Created by */}
      <td className="px-4 py-3.5 hidden lg:table-cell">
        <span className="text-xs text-muted-foreground">
          {coupon.created_by_name ?? "—"}
        </span>
        <div className="text-[10px] text-muted-foreground/60 mt-0.5">
          {coupon.created_at
            ? new Date(coupon.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            : "—"}
        </div>
      </td>

      {/* Actions */}
      <td className="px-4 py-3.5 text-right">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onToggle(coupon)}
            title={coupon.is_active ? "Deactivate" : "Activate"}
          >
            {coupon.is_active ? (
              <ToggleRight className="w-4 h-4 text-accent" />
            ) : (
              <ToggleLeft className="w-4 h-4 text-muted-foreground" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onEdit(coupon)}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(coupon)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── Coupons tab ──────────────────────────────────────────────────────────────

function CouponsTab() {
  const dispatch = useAppDispatch();
  const { coupons, couponsSaving } = useAppSelector((s) => s.admin);
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive" | "expired"
  >("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Coupon | null>(null);

  useEffect(() => {
    dispatch(fetchAdminCoupons());
  }, [dispatch]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (c: Coupon) => {
    setEditing(c);
    setModalOpen(true);
  };

  const handleSubmit = async (form: CouponFormState) => {
    const toIso = (localDt: string) =>
      localDt ? new Date(localDt).toISOString() : null;

    const payload = {
      code: form.code.toUpperCase(),
      description: form.description || undefined,
      discount_type: form.discount_type,
      discount_value:
        form.discount_type === "percentage"
          ? Number(form.discount_value)
          : Math.round(Number(form.discount_value) * 100),
      min_amount_cents: Math.round(Number(form.min_amount_cents || 0) * 100),
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      valid_from: toIso(form.valid_from),
      expires_at: toIso(form.expires_at),
      is_active: form.is_active ? 1 : 0,
    };

    try {
      if (editing) {
        await dispatch(
          updateAdminCoupon({ id: editing.id, ...payload }),
        ).unwrap();
        toast({
          title: "Coupon updated",
          description: `${payload.code} saved successfully.`,
        });
      } else {
        await dispatch(
          createAdminCoupon(payload as Parameters<typeof createAdminCoupon>[0]),
        ).unwrap();
        toast({
          title: "Coupon created",
          description: `${payload.code} is now active.`,
        });
      }
      setModalOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save coupon";
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const handleToggle = async (coupon: Coupon) => {
    try {
      await dispatch(
        updateAdminCoupon({
          id: coupon.id,
          is_active: coupon.is_active ? 0 : 1,
        }),
      ).unwrap();
      toast({
        title: coupon.is_active ? "Coupon deactivated" : "Coupon activated",
        description: coupon.code,
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to update coupon status",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await dispatch(deleteAdminCoupon({ id: deleteTarget.id })).unwrap();
      toast({ title: "Coupon deleted", description: deleteTarget.code });
      setDeleteTarget(null);
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete coupon",
        variant: "destructive",
      });
    }
  };

  const now = new Date();
  const filtered = coupons.filter((c) => {
    if (
      search &&
      !c.code.toLowerCase().includes(search.toLowerCase()) &&
      !(c.description ?? "").toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    if (statusFilter === "active")
      return c.is_active && (!c.expires_at || new Date(c.expires_at) >= now);
    if (statusFilter === "inactive") return !c.is_active;
    if (statusFilter === "expired")
      return !!c.expires_at && new Date(c.expires_at) < now;
    return true;
  });

  const activeCoupons = coupons.filter(
    (c) => c.is_active && (!c.expires_at || new Date(c.expires_at) >= now),
  ).length;
  const totalUses = coupons.reduce((s, c) => s + c.uses_count, 0);

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <SummaryCard
          icon={Tag}
          label="Total Coupons"
          value={String(coupons.length)}
          sub={`${activeCoupons} active`}
          gradient="from-primary/15 to-transparent"
        />
        <SummaryCard
          icon={Hash}
          label="Total Redemptions"
          value={String(totalUses)}
          sub="Across all coupons"
          gradient="from-accent/15 to-transparent"
        />
        <SummaryCard
          icon={ShieldAlert}
          label="Expired / Inactive"
          value={String(coupons.length - activeCoupons)}
          sub="Needs attention"
          gradient="from-muted to-transparent"
        />
      </div>

      {/* Coupon table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-border/60">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search code or description…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
            >
              <SelectTrigger className="w-[140px]">
                <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={openCreate} className="gap-1.5 shrink-0">
              <Plus className="w-4 h-4" /> New Coupon
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Code
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Discount
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                  Uses
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                  Validity
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                  Created By
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Tag className="w-8 h-8 opacity-30" />
                      <div>
                        <p className="text-sm font-medium">No coupons found</p>
                        <p className="text-xs mt-1 opacity-70">
                          Create your first coupon to offer discounts
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={openCreate}
                        className="mt-2 gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" /> Create Coupon
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <CouponRow
                    key={c.id}
                    coupon={c}
                    onEdit={openEdit}
                    onToggle={handleToggle}
                    onDelete={setDeleteTarget}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit modal */}
      <CouponModal
        open={modalOpen}
        editing={editing}
        saving={couponsSaving}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete coupon?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono font-bold">{deleteTarget?.code}</span>{" "}
              will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminPayments() {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={CreditCard}
        title="Payments"
        description="Transactions, revenue analytics, and promotional coupons."
      />

      <Tabs defaultValue="transactions" className="space-y-5">
        <TabsList className="bg-card border border-border p-1 rounded-xl h-auto gap-1">
          <TabsTrigger
            value="transactions"
            className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm flex items-center gap-2 px-4 py-2"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Transactions
          </TabsTrigger>
          <TabsTrigger
            value="coupons"
            className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm flex items-center gap-2 px-4 py-2"
          >
            <Tag className="w-3.5 h-3.5" />
            Coupons
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transactions" className="mt-0">
          <TransactionsTab />
        </TabsContent>
        <TabsContent value="coupons" className="mt-0">
          <CouponsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

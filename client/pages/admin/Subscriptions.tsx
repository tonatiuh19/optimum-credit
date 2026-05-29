import { useCallback, useEffect, useState, type ElementType } from "react";
import { Link } from "react-router-dom";
import {
  Repeat,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Shield,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminSubscriptions } from "@/store/slices/adminSlice";
import type {
  AdminSubscriptionListItem,
  SubscriptionStatus,
} from "@shared/api";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";

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

const STATUS_CONFIG: Record<
  SubscriptionStatus,
  { label: string; className: string; icon: ElementType }
> = {
  active: {
    label: "Active",
    className: "bg-accent/15 text-accent border-accent/30",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground border-border",
    icon: XCircle,
  },
  suspended: {
    label: "Suspended",
    className: "bg-yellow-500/10 text-yellow-600 border-yellow-400/30",
    icon: AlertCircle,
  },
  expired: {
    label: "Expired",
    className: "bg-destructive/10 text-destructive border-destructive/30",
    icon: Clock,
  },
};

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  gradient,
}: {
  icon: ElementType;
  label: string;
  value: string;
  sub?: string;
  gradient: string;
}) {
  return (
    <div
      className={`bg-card border border-border rounded-2xl p-4 bg-gradient-to-br ${gradient}`}
    >
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function SubscriptionRow({ sub }: { sub: AdminSubscriptionListItem }) {
  const cfg = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.active;
  const StatusIcon = cfg.icon;
  const clientName = `${sub.client_first_name} ${sub.client_last_name}`.trim();

  return (
    <tr className="border-b border-border/60 hover:bg-muted/30 transition-colors">
      <td className="p-3">
        <Link
          to={`/admin/clients/${sub.client_id}`}
          className="font-medium text-foreground hover:text-primary transition-colors"
        >
          {clientName}
        </Link>
        <p className="text-xs text-muted-foreground mt-0.5">{sub.client_email}</p>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-medium">{sub.package_name}</span>
        </div>
      </td>
      <td className="p-3 text-sm font-semibold">{fmt(sub.amount_cents)}/mo</td>
      <td className="p-3">
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.className}`}
        >
          <StatusIcon className="w-3 h-3" />
          {cfg.label}
        </span>
      </td>
      <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
        {fmtDate(sub.started_at)}
      </td>
      <td className="p-3 text-sm text-muted-foreground hidden lg:table-cell">
        {sub.status === "active"
          ? fmtDate(sub.next_billing_at)
          : fmtDate(sub.cancelled_at)}
      </td>
      <td className="p-3 text-xs font-mono text-muted-foreground hidden xl:table-cell max-w-[140px] truncate">
        {sub.anet_subscription_id}
      </td>
      <td className="p-3 text-right">
        <Link
          to={`/admin/clients/${sub.client_id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          View <ExternalLink className="w-3 h-3" />
        </Link>
      </td>
    </tr>
  );
}

export default function AdminSubscriptions() {
  const dispatch = useAppDispatch();
  const {
    subscriptions,
    subscriptionsSummary: summary,
    subscriptionsPagination: pagination,
    subscriptionsLoading: loading,
  } = useAppSelector((s) => s.admin);

  const [statusFilter, setStatusFilter] = useState("all");
  const [searchRaw, setSearchRaw] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounce(searchRaw, 350);

  const load = useCallback(() => {
    dispatch(
      fetchAdminSubscriptions({
        status: statusFilter === "all" ? undefined : statusFilter,
        search: search || undefined,
        page,
        limit: 50,
      }),
    );
  }, [dispatch, statusFilter, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, search]);

  const mrr = summary?.mrr_cents ?? 0;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Repeat}
        title="Subscriptions"
        description="Peace of Mind and other recurring client subscriptions (Authorize.net ARB)."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={CheckCircle2}
          label="Active"
          value={String(summary?.active_count ?? 0)}
          sub={`MRR: ${fmt(mrr)}`}
          gradient="from-accent/20 to-transparent"
        />
        <SummaryCard
          icon={XCircle}
          label="Cancelled"
          value={String(summary?.cancelled_count ?? 0)}
          gradient="from-muted/50 to-transparent"
        />
        <SummaryCard
          icon={AlertCircle}
          label="Suspended"
          value={String(summary?.suspended_count ?? 0)}
          gradient="from-yellow-500/15 to-transparent"
        />
        <SummaryCard
          icon={Repeat}
          label="Total"
          value={String(summary?.total_count ?? 0)}
          sub={`${summary?.expired_count ?? 0} expired`}
          gradient="from-primary/20 to-transparent"
        />
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-border/60">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by client name, email, or subscription ID…"
              className="pl-9"
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[160px] shrink-0">
              <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading && subscriptions.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            Loading subscriptions…
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            No subscriptions match your filters.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left p-3 font-semibold">Client</th>
                  <th className="text-left p-3 font-semibold">Plan</th>
                  <th className="text-left p-3 font-semibold">Amount</th>
                  <th className="text-left p-3 font-semibold">Status</th>
                  <th className="text-left p-3 font-semibold hidden md:table-cell">
                    Started
                  </th>
                  <th className="text-left p-3 font-semibold hidden lg:table-cell">
                    Next / Ended
                  </th>
                  <th className="text-left p-3 font-semibold hidden xl:table-cell">
                    ARB ID
                  </th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <SubscriptionRow key={sub.id} sub={sub} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/60">
            <p className="text-xs text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages} ·{" "}
              {pagination.total} total
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-2 rounded-lg border border-border hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-2 rounded-lg border border-border hover:bg-muted disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

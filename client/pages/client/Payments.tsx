import { useEffect } from "react";
import {
  CreditCard,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Tag,
  BadgePercent,
  Receipt,
  CalendarClock,
  AlertCircle,
  ExternalLink,
  Ban,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import ClientPageHeader from "@/components/ClientPageHeader";
import PeaceOfMindSubscribe from "@/components/PeaceOfMindSubscribe";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchClientPayments,
  fetchClientPaymentSplits,
} from "@/store/slices/portalSlice";
import type {
  ClientPayment,
  ClientPaymentSplit,
  PaymentStatus,
  PaymentSplitStatus,
} from "@shared/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    label: "Paid",
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

// ─── Payment card ──────────────────────────────────────────────────────────────

function PaymentCard({ payment }: { payment: ClientPayment }) {
  const cfg = STATUS_CONFIG[payment.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;
  const hasDiscount =
    payment.discount_cents > 0 && payment.original_amount_cents != null;

  return (
    <div className="bg-card border border-border rounded-2xl p-5 hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between gap-3">
        {/* Left: icon + info */}
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              payment.status === "succeeded"
                ? "bg-accent/15"
                : payment.status === "failed"
                  ? "bg-destructive/10"
                  : "bg-muted"
            }`}
          >
            <CreditCard
              className={`w-5 h-5 ${
                payment.status === "succeeded"
                  ? "text-accent"
                  : payment.status === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground"
              }`}
            />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-foreground text-sm">
              {payment.package_name ?? "Credit Repair Service"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {payment.paid_at
                ? fmtDateTime(payment.paid_at)
                : fmtDate(payment.created_at)}
            </p>
          </div>
        </div>

        {/* Right: amount + badge */}
        <div className="text-right shrink-0">
          <p className="text-lg font-bold text-foreground">
            {fmt(payment.amount_cents)}
          </p>
          {hasDiscount && (
            <p className="text-xs line-through text-muted-foreground/60 leading-tight">
              {fmt(payment.original_amount_cents!)}
            </p>
          )}
          <span
            className={`inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.className}`}
          >
            <StatusIcon className="w-3 h-3" />
            {cfg.label}
          </span>
        </div>
      </div>

      {payment.tradeline_items && payment.tradeline_items.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Tradelines
          </p>
          {payment.tradeline_items.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-2 text-xs"
            >
              <span className="text-foreground">{item.product_name}</span>
              <span className="text-muted-foreground shrink-0">
                {fmt(item.price_cents)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Coupon badge */}
      {payment.coupon_code && (
        <div className="mt-3 pt-3 border-t border-border/60 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-primary/5 border border-primary/20 rounded-lg px-2.5 py-1">
            <Tag className="w-3 h-3 text-primary shrink-0" />
            <span className="font-mono text-xs font-semibold text-primary">
              {payment.coupon_code}
            </span>
          </div>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <BadgePercent className="w-3 h-3" />
            Saved {fmt(payment.discount_cents)}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="bg-card border border-border rounded-2xl py-20 flex flex-col items-center gap-3 text-muted-foreground">
      <Receipt className="w-10 h-10 opacity-20" />
      <div className="text-center">
        <p className="text-sm font-medium">No payments yet</p>
        <p className="text-xs mt-1 opacity-70">
          Your payment history will appear here once a charge is processed.
        </p>
      </div>
    </div>
  );
}

// ─── Split status config ──────────────────────────────────────────────────────

const SPLIT_STATUS: Record<
  PaymentSplitStatus,
  { label: string; className: string; icon: React.ElementType }
> = {
  pending: {
    label: "Upcoming",
    className: "bg-yellow-500/10 text-yellow-700 border-yellow-400/30",
    icon: Clock,
  },
  paid: {
    label: "Paid",
    className: "bg-accent/15 text-accent border-accent/30",
    icon: CheckCircle2,
  },
  overdue: {
    label: "Overdue",
    className: "bg-destructive/10 text-destructive border-destructive/30",
    icon: AlertCircle,
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground border-border",
    icon: Ban,
  },
};

// ─── Split card ───────────────────────────────────────────────────────────────

function SplitCard({ split }: { split: ClientPaymentSplit }) {
  const cfg = SPLIT_STATUS[split.status] ?? SPLIT_STATUS.pending;
  const StatusIcon = cfg.icon;
  const isOverdue =
    split.status === "pending" && new Date(split.due_date) < new Date();
  const effectiveCfg = isOverdue ? SPLIT_STATUS.overdue : cfg;
  const EffectiveIcon = effectiveCfg.icon;

  return (
    <div className="bg-card border border-border rounded-2xl p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              split.status === "paid"
                ? "bg-accent/15"
                : isOverdue || split.status === "overdue"
                  ? "bg-destructive/10"
                  : "bg-muted"
            }`}
          >
            <CalendarClock
              className={`w-5 h-5 ${
                split.status === "paid"
                  ? "text-accent"
                  : isOverdue || split.status === "overdue"
                    ? "text-destructive"
                    : "text-muted-foreground"
              }`}
            />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-foreground text-sm">
              {split.label}
            </p>
            {split.case_number && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Case {split.case_number}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {split.status === "paid" && split.paid_at
                ? `Paid ${fmtDate(split.paid_at)}`
                : `Due ${fmtDate(split.due_date)}`}
            </p>
          </div>
        </div>

        <div className="text-right shrink-0 flex flex-col items-end gap-2">
          <p className="text-lg font-bold text-foreground">
            {fmt(split.amount_cents)}
          </p>
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${effectiveCfg.className}`}
          >
            <EffectiveIcon className="w-3 h-3" />
            {isOverdue ? "Overdue" : effectiveCfg.label}
          </span>
          {(split.status === "pending" || isOverdue) && split.payment_token && (
            <a
              href={`/pay/${split.payment_token}`}
              className="inline-flex items-center gap-1.5 bg-accent text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-accent/90 transition-colors"
            >
              Pay Now
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientPayments() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { payments, paymentsLoading, splits, splitsLoading } = useAppSelector(
    (s) => s.portal,
  );

  useEffect(() => {
    dispatch(fetchClientPayments());
    dispatch(fetchClientPaymentSplits());
  }, [dispatch]);

  const succeeded = payments.filter((p) => p.status === "succeeded");
  const totalPaid = succeeded.reduce((sum, p) => sum + p.amount_cents, 0);
  const totalSaved = succeeded.reduce(
    (sum, p) => sum + (p.discount_cents ?? 0),
    0,
  );

  const pendingSplits = splits.filter(
    (s) => s.status === "pending" || s.status === "overdue",
  );
  const totalDue = pendingSplits.reduce((sum, s) => sum + s.amount_cents, 0);

  return (
    <div className="space-y-8">
      <ClientPageHeader
        icon={CreditCard}
        title={t("payments.pageTitle")}
        description={t("payments.pageDesc")}
      />

      <PeaceOfMindSubscribe />

      {/* Summary strip */}
      {!paymentsLoading && (payments.length > 0 || splits.length > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="relative bg-card border border-border rounded-2xl p-5 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-accent/15 to-transparent pointer-events-none" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              {t("payments.totalPaid")}
            </p>
            <p className="text-2xl font-bold text-foreground">
              {fmt(totalPaid)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {succeeded.length} transaction{succeeded.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="relative bg-card border border-border rounded-2xl p-5 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              {t("payments.allTransactions")}
            </p>
            <p className="text-2xl font-bold text-foreground">
              {payments.length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {payments.filter((p) => p.status === "pending").length} pending
            </p>
          </div>

          {totalSaved > 0 ? (
            <div className="relative bg-card border border-border rounded-2xl p-5 overflow-hidden col-span-2 sm:col-span-1">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                {t("payments.totalSaved")}
              </p>
              <p className="text-2xl font-bold text-foreground">
                {fmt(totalSaved)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("payments.savedViaCoupons")}
              </p>
            </div>
          ) : totalDue > 0 ? (
            <div className="relative bg-card border border-border rounded-2xl p-5 overflow-hidden col-span-2 sm:col-span-1">
              <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/10 to-transparent pointer-events-none" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                {t("payments.amountDue")}
              </p>
              <p className="text-2xl font-bold text-foreground">
                {fmt(totalDue)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {pendingSplits.length} installment
                {pendingSplits.length !== 1 ? "s" : ""} remaining
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* Payment Schedule */}
      {(splitsLoading || splits.length > 0) && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <CalendarClock className="w-5 h-5 text-primary" />
            <h2 className="text-base font-bold text-foreground">
              {t("payments.paymentSchedule")}
            </h2>
          </div>
          {splitsLoading ? (
            <div className="space-y-3">
              {[...Array(2)].map((_, i) => (
                <div
                  key={i}
                  className="bg-card border border-border rounded-2xl p-5 animate-pulse h-24"
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {splits.map((s) => (
                <SplitCard key={s.id} split={s} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Payment History */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Receipt className="w-5 h-5 text-primary" />
          <h2 className="text-base font-bold text-foreground">
            {t("payments.paymentHistory")}
          </h2>
        </div>
        {paymentsLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="bg-card border border-border rounded-2xl p-5 animate-pulse h-24"
              />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {payments.map((p) => (
              <PaymentCard key={p.id} payment={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

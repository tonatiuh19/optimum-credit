import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import {
  AlertTriangle,
  Bot,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ExternalLink,
  FileText,
  Loader2,
  Plug,
  Receipt,
  RefreshCw,
  Save,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AdminPageHeader from "@/components/AdminPageHeader";
import { BillingPaymentMethodCard } from "@/components/billing/BillingPaymentMethodCard";
import { BillingPricingTable } from "@/components/billing/BillingPricingTable";
import { PlatformDetails } from "@/components/billing/PlatformDetails";
import { OperatingSuiteCard, isSuiteAction } from "@/components/billing/OperatingSuiteCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchBillingAccess,
  fetchBillingInvoices,
  fetchBillingPlatform,
  fetchBillingPrices,
  fetchBillingSummary,
  openBillingPortal,
  retryBillingInvoice,
  saveBillingCustomerEmail,
  saveBillingPrice,
  type BillingPrice,
} from "@/store/slices/billingSlice";

const usd = (v: number, digits = 2) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) });
const unitUsd = (v: number) => usd(v, v > 0 && v < 1 ? 4 : 2);
const num = (v: number) => v.toLocaleString("en-US");

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function StatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone =
    status === "paid"
      ? "bg-accent/15 text-accent"
      : status === "failed" || status === "uncollectible"
        ? "bg-destructive/15 text-destructive"
        : status === "void"
          ? "bg-muted text-muted-foreground"
          : "bg-primary/10 text-primary";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      {t(`billing.status.${status}`, { defaultValue: status })}
    </span>
  );
}

function StatTile({ icon: Icon, label, value, hint }: { icon: typeof Bot; label: string; value: string; hint: string }) {
  return (
    <div className="card-base p-4 flex gap-3 items-start animate-in fade-in slide-in-from-bottom-1">
      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold text-foreground tabular-nums">{value}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function PriceRow({ p }: { p: BillingPrice }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const saving = useAppSelector((s) => s.billing.savingAction === p.action);
  const [price, setPrice] = useState(String(p.unit_price_usd));
  useEffect(() => setPrice(String(p.unit_price_usd)), [p.unit_price_usd]);
  const dirty = Number(price) !== p.unit_price_usd;

  const save = async (patch: { unit_price_usd?: number; billable?: boolean }) => {
    const res = await dispatch(saveBillingPrice({ action: p.action, ...patch }));
    toast(
      saveBillingPrice.rejected.match(res)
        ? { title: String(res.payload || t("billing.saveError")), variant: "destructive" }
        : { title: t("billing.priceSaved") },
    );
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-[1.6fr_1fr_1fr_1.2fr_auto] gap-2 sm:gap-3 items-center py-3 border-b border-border last:border-0">
      <div className="col-span-2 sm:col-span-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{t(`billing.actions.${p.action}`, { defaultValue: p.action })}</p>
        <p className="text-[11px] text-muted-foreground">
          {t(`billing.units.${p.unit}`, { defaultValue: p.unit })} · {t("billing.calls30d", { count: p.calls_30d })}
        </p>
      </div>
      <div className="text-xs">
        <p className="text-muted-foreground">{t("billing.measuredCost")}</p>
        <p className="font-medium text-foreground tabular-nums">{p.avg_cost_usd != null ? unitUsd(p.avg_cost_usd) : "—"}</p>
      </div>
      <div className="text-xs">
        <p className="text-muted-foreground">{t("billing.suggested", { markup: p.markup })}</p>
        <p className="font-medium text-foreground tabular-nums">{p.suggested_price_usd != null ? unitUsd(p.suggested_price_usd) : "—"}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">$</span>
        <Input
          type="number"
          min={0}
          step="0.0001"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="h-8 text-sm tabular-nums"
          aria-label={t("billing.priceAria", { action: t(`billing.actions.${p.action}`, { defaultValue: p.action }) })}
        />
        <Button
          type="button"
          size="icon"
          variant={dirty ? "default" : "ghost"}
          className="h-8 w-8 shrink-0"
          disabled={!dirty || saving || !(Number(price) >= 0)}
          onClick={() => void save({ unit_price_usd: Number(price) })}
          aria-label={t("billing.save")}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        </Button>
      </div>
      <label className="flex items-center gap-2 justify-end text-xs text-muted-foreground">
        {t("billing.billable")}
        <Switch checked={p.billable} disabled={saving} onCheckedChange={(v) => void save({ billable: v })} />
      </label>
    </div>
  );
}

export default function AdminBilling() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { canView, isOwner, summary, prices, invoices, platform, loading, error, portalBusy, retryingMonth } = useAppSelector((s) => s.billing);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (canView === null) dispatch(fetchBillingAccess());
  }, [dispatch, canView]);

  useEffect(() => {
    if (!canView) return;
    if (isOwner) dispatch(fetchBillingPrices());
    dispatch(fetchBillingInvoices());
  }, [dispatch, canView, isOwner]);

  useEffect(() => {
    if (!canView) return;
    dispatch(fetchBillingSummary(month));
    dispatch(fetchBillingPlatform(month));
  }, [dispatch, canView, month]);

  useEffect(() => {
    setEmail(summary?.customer_email ?? "");
  }, [summary?.customer_email]);

  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  }, [month]);

  if (canView === false) return <Navigate to="/admin" replace />;
  if (canView === null) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const usage = summary?.usage;
  const suitePlan = (summary?.plan ?? []).filter((p) => isSuiteAction(p.action));
  const mcpCalls = usage?.mcp_by_tool.reduce((s, r) => s + r.calls, 0) ?? 0;

  const portal = async () => {
    const res = await dispatch(openBillingPortal());
    if (openBillingPortal.fulfilled.match(res)) window.location.href = res.payload;
    else toast({ title: String(res.payload || t("billing.portalError")), variant: "destructive" });
  };

  const retry = async (m: string) => {
    const res = await dispatch(retryBillingInvoice(m));
    toast(
      retryBillingInvoice.rejected.match(res)
        ? { title: String(res.payload || t("billing.retryError")), variant: "destructive" }
        : { title: t("billing.retryDone") },
    );
  };

  const saveEmail = async () => {
    const res = await dispatch(saveBillingCustomerEmail(email.trim()));
    toast(
      saveBillingCustomerEmail.rejected.match(res)
        ? { title: String(res.payload || t("billing.saveError")), variant: "destructive" }
        : { title: t("billing.emailSaved") },
    );
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Receipt}
        title={t("billing.title")}
        description={t("billing.subtitle")}
        actions={
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={portalBusy || !summary?.stripe_configured} onClick={() => void portal()}>
            {portalBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            {t("billing.managePayment")}
          </Button>
        }
      />

      {summary && !summary.stripe_configured && (
        <div className="card-base p-4 flex gap-3 items-start border-warning/40 bg-warning/10" data-testid="billing-stripe-missing">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <p className="text-sm text-foreground">{t("billing.stripeMissing")}</p>
        </div>
      )}

      {/* Payment method first: the one action Cesar needs on this page */}
      {summary?.stripe_configured && <BillingPaymentMethodCard />}

      {/* Month picker */}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="icon" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label={t("billing.prevMonth")}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <p className="text-sm font-semibold text-foreground capitalize">{monthLabel}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={month >= currentMonth}
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          aria-label={t("billing.nextMonth")}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Invoice estimate */}
      <div className="card-base p-5 sm:p-6 bg-gradient-to-br from-primary/10 via-card to-accent/10 animate-in fade-in" data-testid="billing-estimate">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {month === currentMonth ? t("billing.estimateTitle") : t("billing.invoiceTitle")}
            </p>
            <p className="text-4xl font-bold text-foreground tabular-nums mt-1">
              {loading && !summary ? <Loader2 className="w-7 h-7 animate-spin text-primary" /> : usd(summary?.total_usd ?? 0)}
            </p>
            {summary?.projection && (
              <p className="text-sm text-primary font-medium tabular-nums">
                {t("billing.projectedInline", { amount: usd(summary.projection.total_usd) })}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {summary?.billing_start_at
                ? t("billing.startedOn", { date: new Date(summary.billing_start_at).toLocaleDateString() })
                : t("billing.notStarted")}
            </p>
          </div>
          {summary?.invoice ? <StatusChip status={summary.invoice.status} /> : month === currentMonth ? <StatusChip status="in_progress" /> : null}
        </div>
      </div>

      <OperatingSuiteCard services={suitePlan} />

      {summary && (
        <BillingPricingTable monthLabel={monthLabel} lines={summary.lines} totalUsd={summary.total_usd} projection={summary.projection} />
      )}


      {/* Usage tiles */}
      <div className={`grid grid-cols-1 gap-3 ${isOwner ? "sm:grid-cols-2" : ""}`}>
        <StatTile icon={Plug} label={t("billing.mcpCalls")} value={num(mcpCalls)} hint={t("billing.billedHint")} />
        {isOwner && (
          <StatTile icon={Bot} label={t("billing.claudeCost")} value={usd(usage?.ai_total_cost_usd ?? 0)} hint={t("billing.ownerOnlyHint")} />
        )}
      </div>

      {/* Daily chart */}
      {usage && usage.daily.length > 0 && (
        <div className="card-base p-4">
          <p className="text-sm font-semibold text-foreground mb-3">{t("billing.dailyTitle")}</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={usage.daily.map((d) => ({ ...d, day: d.date.slice(8) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={36} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(_, p) => String(p?.[0]?.payload?.date ?? "")}
                />
                <Bar dataKey="mcp_calls" name={t("billing.mcpCalls")} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Claude usage (owner only — OFG's key, not billed) */}
        {isOwner && (
        <div className="card-base p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-foreground">{t("billing.claudeTitle")}</p>
            <span className="text-[11px] text-muted-foreground">{t("billing.ownerOnlyHint")}</span>
          </div>
          {usage?.ai.length ? (
            <div className="divide-y divide-border">
              {usage.ai.map((r) => (
                <div key={r.action} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="text-foreground truncate">{t(`billing.actions.${r.action}`, { defaultValue: r.action })}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {t("billing.aiRowHint", { calls: num(r.calls), input: num(r.input_tokens), output: num(r.output_tokens) })}
                    </p>
                  </div>
                  <p className="tabular-nums text-foreground">{usd(r.cost_usd)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-4">{t("billing.noUsage")}</p>
          )}
        </div>
        )}

        {/* By staff */}
        <div className="card-base p-4">
          <p className="text-sm font-semibold text-foreground mb-2">{t("billing.byStaffTitle")}</p>
          {usage?.by_admin.length ? (
            <div className="divide-y divide-border">
              {usage.by_admin.map((r) => (
                <div key={r.admin_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <p className="text-foreground truncate">{r.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums text-right">
                    {isOwner
                      ? t("billing.staffRow", { mcp: num(r.mcp_calls), ai: num(r.ai_calls), cost: usd(r.ai_cost_usd) })
                      : t("billing.staffRowMcp", { mcp: num(r.mcp_calls) })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-4">{t("billing.noUsage")}</p>
          )}
        </div>

        {/* MCP tools */}
        <div className="card-base p-4">
          <p className="text-sm font-semibold text-foreground mb-2">{t("billing.mcpToolsTitle")}</p>
          {usage?.mcp_by_tool.length ? (
            <div className="space-y-2">
              {usage.mcp_by_tool.map((r) => (
                <div key={r.tool} className="text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="font-mono text-foreground truncate">{r.tool}</span>
                    <span className="tabular-nums text-muted-foreground">{num(r.calls)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-700" style={{ width: `${Math.max(2, (r.calls / (usage.mcp_by_tool[0]?.calls || 1)) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-4">{t("billing.noUsage")}</p>
          )}
        </div>
      </div>

      {/* Price list (platform owner) */}
      {isOwner && (
      <div className="card-base p-4">
        <p className="text-sm font-semibold text-foreground">{t("billing.pricesTitle")}</p>
        <p className="text-xs text-muted-foreground mb-2">{t("billing.pricesHint")}</p>
        {prices.map((p) => (
          <PriceRow key={p.action} p={p} />
        ))}
      </div>
      )}

      <PlatformDetails platform={platform} />

      {/* Invoices */}
      <div className="card-base p-4">
        <p className="text-sm font-semibold text-foreground mb-2">{t("billing.invoicesTitle")}</p>
        {invoices.length ? (
          <div className="divide-y divide-border">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-medium text-foreground">{inv.period_month}</span>
                  <StatusChip status={inv.status} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums font-semibold text-foreground">{usd(inv.total_usd)}</span>
                  {inv.hosted_invoice_url && (
                    <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      {t("billing.view")} <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {inv.invoice_pdf_url && (
                    <a href={inv.invoice_pdf_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                      PDF
                    </a>
                  )}
                  {inv.status === "failed" && inv.period_month && (
                    <Button type="button" size="sm" variant="outline" className="h-7 gap-1" disabled={retryingMonth === inv.period_month} onClick={() => void retry(inv.period_month!)}>
                      {retryingMonth === inv.period_month ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      {t("billing.retry")}
                    </Button>
                  )}
                </div>
                {inv.error_message && <p className="w-full text-[11px] text-destructive">{inv.error_message}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-4">{t("billing.noInvoices")}</p>
        )}
      </div>

      {/* Billing email */}
      <div className="card-base p-4 space-y-2">
        <p className="text-sm font-semibold text-foreground">{t("billing.emailTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("billing.emailHint")}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="sm:max-w-sm" aria-label={t("billing.emailTitle")} />
          <Button type="button" size="sm" disabled={!email.trim() || email.trim() === (summary?.customer_email ?? "")} onClick={() => void saveEmail()}>
            {t("billing.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

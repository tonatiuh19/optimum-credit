import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
import type { BillingLine } from "@/store/slices/billingSlice";
import { isSuiteAction } from "@/components/billing/OperatingSuiteCard";

const usd = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 1 ? 4 : 2 });
const num = (v: number) => v.toLocaleString("en-US");

/**
 * Invoice-style pricing table for a month: item · unit · quantity · rate ·
 * amount, with the total so far and (current month) a month-end projection.
 */
export function BillingPricingTable({
  monthLabel,
  lines,
  totalUsd,
  projection,
}: {
  monthLabel: string;
  lines: BillingLine[];
  totalUsd: number;
  projection: { lines: BillingLine[]; total_usd: number } | null;
}) {
  const { t } = useTranslation();
  const projected = new Map((projection?.lines ?? []).map((l) => [l.action, l]));
  const suite = lines.filter((l) => isSuiteAction(l.action));
  const usage = lines.filter((l) => !isSuiteAction(l.action));
  const suiteTotal = Math.round(suite.reduce((s, l) => s + l.amount_usd, 0) * 100) / 100;
  const groups: Array<{ key: string; title: string; rows: BillingLine[]; subtotal?: number }> = [
    ...(suite.length ? [{ key: "suite", title: t("billing.table.suiteGroup"), rows: suite, subtotal: suiteTotal }] : []),
    ...(usage.length ? [{ key: "usage", title: t("billing.table.usageGroup"), rows: usage }] : []),
  ];

  const qtyLabel = (l: BillingLine) =>
    l.unit === "month"
      ? l.billed_days === l.days_in_month
        ? t("billing.table.fullMonth", { days: l.days_in_month })
        : t("billing.table.days", { days: l.billed_days, total: l.days_in_month })
      : num(l.quantity);

  return (
    <div className="card-base overflow-hidden animate-in fade-in" data-testid="billing-pricing-table">
      <div className="px-4 sm:px-5 pt-4 pb-3 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("billing.table.title", { month: monthLabel })}</p>
          <p className="text-xs text-muted-foreground">{t("billing.table.hint")}</p>
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="px-5 pb-5 text-xs text-muted-foreground">{t("billing.table.empty")}</p>
      ) : (
        <>
          {/* Desktop table */}
          <table className="hidden sm:table w-full text-sm">
            <thead>
              <tr className="border-y border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left font-medium px-5 py-2">{t("billing.table.item")}</th>
                <th className="text-left font-medium px-3 py-2">{t("billing.table.unit")}</th>
                <th className="text-right font-medium px-3 py-2">{t("billing.table.qty")}</th>
                <th className="text-right font-medium px-3 py-2">{t("billing.table.rate")}</th>
                <th className="text-right font-medium px-5 py-2">{t("billing.table.amount")}</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                <tr className="bg-primary/5">
                  <td colSpan={5} className="px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary">{g.title}</td>
                </tr>
                {g.rows.map((l) => (
                  <tr key={l.action} className="border-b border-border hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3 pl-8">
                      <p className="font-medium text-foreground">{t(`billing.actions.${l.action}`, { defaultValue: l.action })}</p>
                      <p className="text-[11px] text-muted-foreground">{t(`billing.table.desc.${l.action}`, { defaultValue: "" })}</p>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{t(`billing.units.${l.unit}`, { defaultValue: l.unit })}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-foreground">{qtyLabel(l)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-foreground">{usd(l.unit_price_usd)}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold text-foreground">{usd(l.amount_usd)}</td>
                  </tr>
                ))}
                {g.subtotal != null && (
                  <tr className="border-b border-border">
                    <td colSpan={4} className="px-5 py-2 text-right text-xs font-semibold text-muted-foreground">{t("billing.table.suiteSubtotal")}</td>
                    <td className="px-5 py-2 text-right tabular-nums font-bold text-foreground">{usd(g.subtotal)}</td>
                  </tr>
                )}
              </tbody>
            ))}
          </table>

          {/* Mobile cards */}
          <div className="sm:hidden border-y border-border">
            {groups.map((g) => (
              <div key={g.key} className="divide-y divide-border">
                <p className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary bg-primary/5">{g.title}</p>
            {g.rows.map((l) => (
              <div key={l.action} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{t(`billing.actions.${l.action}`, { defaultValue: l.action })}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {qtyLabel(l)} × {usd(l.unit_price_usd)} {t(`billing.units.${l.unit}`, { defaultValue: l.unit })}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-foreground">{usd(l.amount_usd)}</p>
              </div>
            ))}
                {g.subtotal != null && (
                  <div className="px-4 py-2 flex justify-between text-xs font-semibold">
                    <span className="text-muted-foreground">{t("billing.table.suiteSubtotal")}</span>
                    <span className="tabular-nums text-foreground">{usd(g.subtotal)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="px-4 sm:px-5 py-4 space-y-2 bg-muted/20">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-foreground">{t("billing.table.totalSoFar")}</span>
              <span className="text-lg font-bold tabular-nums text-foreground" data-testid="billing-total-so-far">{usd(totalUsd)}</span>
            </div>
            {projection && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-1.5" data-testid="billing-projection">
                <div className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-primary">
                    <TrendingUp className="w-4 h-4" /> {t("billing.table.projected")}
                  </span>
                  <span className="text-lg font-bold tabular-nums text-primary">{usd(projection.total_usd)}</span>
                </div>
                {lines
                  .filter((l) => l.unit !== "month" && projected.get(l.action))
                  .map((l) => (
                    <p key={l.action} className="text-[11px] text-muted-foreground tabular-nums">
                      {t("billing.table.projectedRow", {
                        item: t(`billing.actions.${l.action}`, { defaultValue: l.action }),
                        qty: num(projected.get(l.action)!.quantity),
                        amount: usd(projected.get(l.action)!.amount_usd),
                      })}
                    </p>
                  ))}
                <p className="text-[11px] text-muted-foreground">{t("billing.table.projectedHint")}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

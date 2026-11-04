import { useTranslation } from "react-i18next";
import { BrainCircuit, CheckCircle2, Cloud, Headset, MessagesSquare, ShieldCheck, Sparkles, Workflow } from "lucide-react";

/** Suite service lines (billing_prices.service = 'suite'); copy lives in billing.suite.services.<action>. */
const SUITE_ICONS: Record<string, typeof Cloud> = {
  suite_credit_intelligence: BrainCircuit,
  suite_communications_hub: MessagesSquare,
  suite_crm_automations: Workflow,
  suite_cloud_infrastructure: Cloud,
  suite_security_compliance: ShieldCheck,
  suite_managed_support: Headset,
};

const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Rate-card weights per sub-item (same order as billing.suite.services.<action>.features).
 * At the current service prices they are the exact sub-item amounts; if a
 * service total changes, sub-items rescale proportionally (see splitWeighted).
 */
export const SUITE_SUBITEM_WEIGHTS: Record<string, number[]> = {
  suite_credit_intelligence: [55.03, 36.48, 33.93, 26.91],
  suite_communications_hub: [34.54, 31.69, 27.35, 16.22],
  suite_crm_automations: [33.68, 23.36, 22.82, 14.79],
  suite_cloud_infrastructure: [31.33, 29.78, 17.47, 16.82],
  suite_security_compliance: [16.88, 12.34, 14.59, 11.14],
  suite_managed_support: [24.75, 26.4, 15.87, 7.83],
};

/**
 * Split an amount by weights in cents (largest remainder), always summing to
 * the amount exactly. Falls back to an even split without valid weights.
 */
export function splitWeighted(amountUsd: number, weights: number[] | undefined, parts: number): number[] {
  if (!weights || weights.length !== parts || weights.some((w) => !(w > 0))) return splitEvenly(amountUsd, parts);
  const cents = Math.round(amountUsd * 100);
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (cents * w) / sum);
  const out = exact.map(Math.floor);
  let left = cents - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]] += 1;
  return out.map((c) => c / 100);
}

/** Even split of a service amount across its sub-items, in cents, always summing to the amount. */
export function splitEvenly(amountUsd: number, parts: number): number[] {
  if (parts <= 0) return [];
  const cents = Math.round(amountUsd * 100);
  const base = Math.floor(cents / parts);
  return Array.from({ length: parts }, (_, i) => (base + (i < cents - base * parts ? 1 : 0)) / 100);
}

export function isSuiteAction(action: string): boolean {
  return action.startsWith("suite_");
}

/**
 * The monthly subscription presented as the services it pays for: each line
 * with its amount, share of the fee and what it includes.
 */
export function OperatingSuiteCard({ services }: { services: Array<{ action: string; unit_price_usd: number }> }) {
  const { t } = useTranslation();
  if (!services.length) return null;

  return (
    <div className="card-base overflow-hidden animate-in fade-in" data-testid="billing-suite">
      <div className="relative px-5 sm:px-6 py-5 bg-gradient-to-br from-primary via-primary/90 to-accent text-primary-foreground overflow-hidden">
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest opacity-80">
              <Sparkles className="w-3.5 h-3.5" /> {t("billing.suite.eyebrow")}
            </p>
            <p className="text-2xl sm:text-3xl font-bold mt-1">{t("billing.suite.name")}</p>
            <p className="text-sm opacity-85 mt-1 max-w-xl">{t("billing.suite.tagline")}</p>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-px bg-border">
        {services.map((s) => {
          const Icon = SUITE_ICONS[s.action] ?? Cloud;
          const raw = t(`billing.suite.services.${s.action}.features`, { returnObjects: true }) as unknown;
          const features = Array.isArray(raw) ? (raw as string[]) : [];
          const prices = splitWeighted(s.unit_price_usd, SUITE_SUBITEM_WEIGHTS[s.action], features.length);
          return (
            <div key={s.action} className="bg-card p-4 sm:p-5 flex flex-col gap-3 group hover:bg-muted/20 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <p className="text-lg font-bold tabular-nums text-foreground">{usd(s.unit_price_usd)}</p>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{t(`billing.actions.${s.action}`)}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t(`billing.suite.services.${s.action}.summary`)}</p>
              </div>
              {features.length > 0 && (
                <ul className="divide-y divide-border/60 border-t border-border/60" data-testid="billing-suite-subitems">
                  {features.map((f, i) => (
                    <li key={f} className="flex items-start justify-between gap-3 py-1.5 text-[11px]">
                      <span className="flex gap-1.5 text-foreground/80 min-w-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0 mt-px" /> {f}
                      </span>
                      <span className="tabular-nums font-medium text-foreground shrink-0">{usd(prices[i])}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { ArrowRight, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CreditPackage } from "@shared/api";
import {
  formatPackageDollars,
  isMonthlyPackage,
  packageFeatures,
} from "@/lib/packageDisplay";

export interface PlanOptionCardProps {
  pkg: CreditPackage;
  selected: boolean;
  onSelect: () => void;
  index?: number;
  /** Register flow vs marketing homepage */
  mode?: "register" | "marketing";
}

export function PlanOptionCardSkeleton() {
  return (
    <div className="flex flex-col h-full min-h-[400px] rounded-2xl border-2 border-border bg-card p-6 animate-pulse">
      <div className="h-6 bg-muted rounded-md w-2/3 mb-2" />
      <div className="h-4 bg-muted rounded-md w-full mb-6" />
      <div className="h-10 bg-muted rounded-md w-1/2 mb-6" />
      <div className="flex-1 space-y-2.5 border-t border-border/50 pt-5">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-3 bg-muted rounded-md"
            style={{ width: `${92 - i * 8}%` }}
          />
        ))}
      </div>
      <div className="h-4 bg-muted rounded-md w-20 mt-5 pt-4" />
    </div>
  );
}

export default function PlanOptionCard({
  pkg,
  selected,
  onSelect,
  index = 0,
  mode = "register",
}: PlanOptionCardProps) {
  const { t } = useTranslation();
  const features = packageFeatures(pkg);
  const monthly = isMonthlyPackage(pkg);
  const isTradeline = pkg.checkout_type === "tradeline_picker";

  const ctaLabel = selected
    ? t("register.selected")
    : mode === "marketing"
      ? t("packages.selectPlan")
      : t("register.select");

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex flex-col h-full min-h-[400px] w-full text-left rounded-2xl border-2 overflow-hidden transition-all duration-300 animate-fade-up focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        selected
          ? "border-primary bg-gradient-to-b from-primary/[0.12] to-card shadow-[0_0_48px_-12px_hsl(var(--primary)/0.45)] z-10 max-md:scale-100 md:scale-[1.01]"
          : "border-border/70 bg-card/80 hover:border-primary/35 hover:shadow-xl hover:-translate-y-1 hover:bg-card"
      }`}
      style={{
        animationDelay: `${index * 0.07}s`,
        animationFillMode: "both",
      }}
    >
      {selected && (
        <div
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent"
          aria-hidden
        />
      )}

      <div className="flex flex-col flex-1 p-6 md:p-7">
        <h3 className="text-xl font-bold tracking-tight text-foreground">
          {pkg.name}
        </h3>
        {pkg.subtitle && (
          <p className="text-sm text-muted-foreground mt-1.5 min-h-[2.5rem] leading-snug line-clamp-2">
            {pkg.subtitle}
          </p>
        )}

        <div className="mt-5 min-h-[5.5rem] flex flex-col justify-end shrink-0">
          {isTradeline ? (
            <div className="rounded-xl border border-dashed border-primary/25 bg-primary/[0.04] px-4 py-3">
              <p className="text-base font-semibold text-foreground leading-snug">
                {t("register.tradelineCustomPricing")}
              </p>
            </div>
          ) : (
            <>
              {pkg.compare_price_cents != null &&
                pkg.compare_price_cents > pkg.price_cents && (
                  <p className="text-sm text-muted-foreground/80 line-through tabular-nums">
                    ${formatPackageDollars(pkg.compare_price_cents)}
                  </p>
                )}
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-4xl font-bold tabular-nums tracking-tight">
                  ${formatPackageDollars(pkg.price_cents)}
                </span>
                <span className="text-sm text-muted-foreground font-medium pb-1">
                  {monthly
                    ? t("packages.perMonth")
                    : mode === "marketing"
                      ? t("packages.onePayment")
                      : t("register.oneTime")}
                </span>
              </div>
            </>
          )}
        </div>

        <ul className="mt-5 flex-1 space-y-2.5 text-sm border-t border-border/60 pt-5 min-h-[140px]">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2.5 leading-snug">
              <span
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                  selected ? "bg-primary/20" : "bg-accent/15"
                }`}
              >
                <Check
                  className={`w-2.5 h-2.5 ${selected ? "text-primary" : "text-accent"}`}
                  strokeWidth={3}
                />
              </span>
              <span className="text-muted-foreground group-hover:text-foreground/90 transition-colors">
                {f}
              </span>
            </li>
          ))}
        </ul>

        <div
          className={`mt-auto pt-4 border-t border-border/50 flex items-center justify-between gap-2 text-sm font-semibold shrink-0 ${
            selected
              ? "text-primary"
              : "text-muted-foreground group-hover:text-primary"
          }`}
        >
          <span>{ctaLabel}</span>
          <ArrowRight
            className={`w-4 h-4 transition-transform duration-300 ${
              selected ? "translate-x-0.5" : "group-hover:translate-x-1"
            }`}
          />
        </div>
      </div>
    </button>
  );
}

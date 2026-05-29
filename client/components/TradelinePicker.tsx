import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TradelineProduct } from "@shared/api";
import { formatPackageDollars } from "@/lib/packageDisplay";

interface Props {
  products: TradelineProduct[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  loading?: boolean;
}

export default function TradelinePicker({
  products,
  selectedIds,
  onChange,
  loading,
}: Props) {
  const { t } = useTranslation();

  const toggle = (id: number) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-xl border border-border bg-card animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center sm:text-left">
        <h3 className="text-lg font-bold text-foreground tracking-tight">
          {t("register.tradelinePickerTitle")}
        </h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          {t("register.tradelinePickerHint")}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-stretch">
        {products.map((p) => {
          const checked = selectedIds.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              className={`flex flex-col h-full text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                checked
                  ? "border-primary bg-gradient-to-b from-primary/10 to-card shadow-[0_0_24px_-8px_hsl(var(--primary)/0.4)]"
                  : "border-border/70 bg-card hover:border-primary/35 hover:shadow-md hover:-translate-y-0.5"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40"
                  }`}
                >
                  {checked && <Check className="w-3.5 h-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-foreground">{p.name}</div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {p.details}
                  </p>
                  <div className="mt-2 flex items-baseline gap-2">
                    {p.compare_price_cents != null &&
                      p.compare_price_cents > p.price_cents && (
                        <span className="text-xs text-muted-foreground line-through">
                          ${formatPackageDollars(p.compare_price_cents)}
                        </span>
                      )}
                    <span className="text-lg font-bold text-foreground">
                      ${formatPackageDollars(p.price_cents)}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {selectedIds.length > 0 && (
        <p className="text-sm font-medium text-primary text-right">
          {t("register.tradelineSelectedTotal", {
            count: selectedIds.length,
            total: formatPackageDollars(
              products
                .filter((p) => selectedIds.includes(p.id))
                .reduce((s, p) => s + p.price_cents, 0),
            ),
          })}
        </p>
      )}
    </div>
  );
}

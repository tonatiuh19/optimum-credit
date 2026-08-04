import { cn } from "@/lib/utils";

export interface EnumLegendItem {
  value: string;
  label: string;
  description: string;
}

/**
 * Role-permissions-style legend for admin enum selects.
 * Highlights the currently selected value when `value` is set.
 */
export default function EnumLegend({
  items,
  value,
  title,
  className,
}: {
  items: EnumLegendItem[];
  value?: string | null;
  title?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-muted/30 px-3 py-2.5 space-y-2 mt-1.5",
        className,
      )}
    >
      {title && (
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
      )}
      <ul className="space-y-1.5">
        {items.map((item) => {
          const active = value != null && value === item.value;
          return (
            <li
              key={item.value}
              className={cn(
                "text-[11px] leading-snug",
                active ? "text-foreground" : "text-muted-foreground/70",
              )}
            >
              <span
                className={cn(
                  "font-semibold",
                  active && "text-primary",
                )}
              >
                {item.label}
              </span>
              <span className="text-muted-foreground"> — {item.description}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

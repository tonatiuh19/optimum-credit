/** Labeled horizontal bars (funnel / distribution), animated, theme tokens only. */
export function HBars({
  rows,
  format = (v) => v.toLocaleString(),
  tone = "primary",
}: {
  rows: Array<{ label: string; value: number; hint?: string }>;
  format?: (v: number) => string;
  tone?: "primary" | "accent";
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3">
          <span className="text-xs text-muted-foreground truncate" title={r.label}>
            {r.label}
          </span>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${tone === "accent" ? "bg-accent" : "bg-primary"}`}
              style={{ width: `${Math.max(r.value ? 3 : 0, (r.value / max) * 100)}%` }}
            />
          </div>
          <span className="text-xs font-semibold tabular-nums text-foreground text-right">
            {format(r.value)}
            {r.hint ? <span className="ml-1 font-normal text-muted-foreground">{r.hint}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

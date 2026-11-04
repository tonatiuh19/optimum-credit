/** Tiny inline trend line (SVG, theme-colored via currentColor). */
export function Sparkline({ values, label, className = "text-primary" }: { values: number[]; label: string; className?: string }) {
  const w = 96;
  const h = 28;
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 2 - (v / max) * (h - 4)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`w-24 h-7 ${className}`} role="img" aria-label={label} preserveAspectRatio="none">
      <path d={area} fill="currentColor" opacity={0.12} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.25} fill="currentColor" />
    </svg>
  );
}

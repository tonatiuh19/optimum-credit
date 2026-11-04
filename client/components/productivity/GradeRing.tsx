import { useEffect, useState } from "react";
import { gradeTone } from "@/lib/productivity";
import type { ProductivityGrade } from "@/store/slices/productivitySlice";

/** Animated score ring with the letter grade in the middle. */
export function GradeRing({
  total,
  grade,
  size = 132,
  label,
  sublabel,
}: {
  total: number | null;
  grade: ProductivityGrade | null;
  size?: number;
  label: string;
  sublabel?: string;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setShown(total ?? 0));
    return () => window.cancelAnimationFrame(id);
  }, [total]);
  const stroke = Math.max(8, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = gradeTone(grade);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label} data-testid="grade-ring">
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90 w-full h-full">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={`${tone.ring} transition-[stroke-dashoffset] duration-1000 ease-out`}
          strokeDasharray={c}
          strokeDashoffset={c - (Math.min(100, shown) / 100) * c}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-black leading-none ${tone.text}`} style={{ fontSize: size * 0.34 }}>
          {grade ?? "—"}
        </span>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums mt-0.5">{total != null ? total.toFixed(1) : sublabel}</span>
      </div>
    </div>
  );
}

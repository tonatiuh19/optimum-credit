import { useTranslation } from "react-i18next";
import type { LeadTemperatureColor } from "@shared/api";
import { cn } from "@/lib/utils";

/** Traffic light: green = Hot, yellow = Warm, red = Cold (prospects only). */
export const LEAD_TEMPERATURE_TONE: Record<
  LeadTemperatureColor,
  { dot: string; pill: string }
> = {
  hot: { dot: "bg-accent", pill: "border-accent/30 bg-accent/10 text-accent" },
  warm: { dot: "bg-warning", pill: "border-warning/30 bg-warning/10 text-warning" },
  cold: {
    dot: "bg-destructive",
    pill: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

/** Compact traffic-light pill; renders nothing when there is no color. */
export function LeadTemperatureBadge({
  temperature,
  className,
  title,
}: {
  temperature: LeadTemperatureColor | null | undefined;
  className?: string;
  title?: string;
}) {
  const { t } = useTranslation();
  if (!temperature) return null;
  const tone = LEAD_TEMPERATURE_TONE[temperature];
  return (
    <span
      title={title ?? t(`adminPipeline.leadTemp.hint.${temperature}`)}
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide animate-in fade-in zoom-in-95",
        tone.pill,
        className,
      )}
      data-testid={`lead-temp-${temperature}`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot, temperature === "hot" && "animate-pulse")} />
      {t(`adminPipeline.leadTemp.color.${temperature}`)}
    </span>
  );
}

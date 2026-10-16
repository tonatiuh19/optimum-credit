import { useTranslation } from "react-i18next";
import { Ban, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact badge for clients whose automations are on hold (paused / blocked).
 * Renders nothing for any other status. Used on pipeline cards + panel header.
 */
export function ClientHoldBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  if (status !== "paused" && status !== "blocked") return null;
  const blocked = status === "blocked";
  const Icon = blocked ? Ban : PauseCircle;
  return (
    <span
      title={t(`adminHelpers.clientStatus.${status}`)}
      className={cn(
        "inline-flex items-center gap-0.5 shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide animate-in fade-in zoom-in-95",
        blocked
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-muted text-muted-foreground",
        className,
      )}
      data-testid={`client-hold-badge-${status}`}
    >
      <Icon className="w-2.5 h-2.5" />
      {t(`adminPipeline.clientStatus.${status}`)}
    </span>
  );
}

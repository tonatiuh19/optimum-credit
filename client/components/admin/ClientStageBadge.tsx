import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * Pipeline stage pill. Extended OFG rounds (6–12) are stored on `round_5`, so
 * pass `effectiveRound` to show the real round with an "Extended" tag.
 */
export function ClientStageBadge({
  stage,
  effectiveRound,
  className,
}: {
  stage: string;
  effectiveRound?: number | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const extended = stage === "round_5" && Number(effectiveRound) > 5;
  const label = extended
    ? t("adminClients.stageBadge.round", { n: effectiveRound })
    : stage.replace(/_/g, " ");

  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span
        className={cn(
          "text-xs uppercase tracking-wide px-2 py-1 rounded-full border",
          extended
            ? "bg-accent/10 text-accent border-accent/30"
            : "bg-primary/10 text-primary border-primary/20",
        )}
        data-testid="client-stage-badge"
      >
        {label}
      </span>
      {extended && (
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-accent/15 text-accent"
          title={t("adminClients.stageBadge.extendedHint")}
        >
          {t("adminClients.stageBadge.extended")}
        </span>
      )}
    </span>
  );
}

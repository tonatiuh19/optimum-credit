import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCheck,
  Clock,
  Inbox,
  Loader2,
  Send,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type StatusMeta = {
  icon: LucideIcon;
  tone: "neutral" | "ok" | "warn" | "bad";
  i18nKey: string;
};

const STATUS_META: Record<string, StatusMeta> = {
  accepted: { icon: Clock, tone: "neutral", i18nKey: "accepted" },
  queued: { icon: Clock, tone: "neutral", i18nKey: "queued" },
  sending: { icon: Loader2, tone: "neutral", i18nKey: "sending" },
  sent: { icon: Check, tone: "ok", i18nKey: "sent" },
  delivered: { icon: CheckCheck, tone: "ok", i18nKey: "delivered" },
  received: { icon: Inbox, tone: "ok", i18nKey: "received" },
  undelivered: { icon: AlertTriangle, tone: "warn", i18nKey: "undelivered" },
  failed: { icon: XCircle, tone: "bad", i18nKey: "failed" },
  canceled: { icon: Ban, tone: "warn", i18nKey: "canceled" },
  cancelled: { icon: Ban, tone: "warn", i18nKey: "canceled" },
};

export function ConversationMessageStatus({
  status,
  errorMessage,
  outbound,
  className,
}: {
  status?: string | null;
  errorMessage?: string | null;
  outbound?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const raw = String(status || "").trim().toLowerCase();
  if (!raw && !errorMessage) return null;

  const meta = STATUS_META[raw] || {
    icon: Send,
    tone: "neutral" as const,
    i18nKey: "",
  };
  const Icon = meta.icon;
  const label = meta.i18nKey
    ? t(`conversations.status.${meta.i18nKey}`)
    : raw;
  const tip = [label, errorMessage].filter(Boolean).join(" — ");

  const iconTone = outbound
    ? "text-primary-foreground"
    : meta.tone === "bad"
      ? "text-destructive"
      : meta.tone === "ok"
        ? "text-accent"
        : "text-muted-foreground";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-0.5 rounded-sm max-w-full",
              "cursor-default focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              className,
            )}
            aria-label={tip}
          >
            <Icon
              className={cn(
                "w-3.5 h-3.5 shrink-0",
                meta.i18nKey === "sending" && "animate-spin",
                iconTone,
              )}
              aria-hidden
            />
            {errorMessage ? (
              <span
                className={cn(
                  "truncate max-w-[10rem] text-left",
                  outbound ? "opacity-80" : "text-destructive",
                )}
              >
                {errorMessage}
              </span>
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="text-xs font-medium flex items-center gap-1.5"
        >
          <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span>{tip}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

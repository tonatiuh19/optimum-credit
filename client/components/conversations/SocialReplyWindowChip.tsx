import { Clock, Lock, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SocialReplyWindowState } from "@/lib/socialReplyWindow";
import { formatWindowLeft } from "@/lib/socialReplyWindow";
import { cn } from "@/lib/utils";

/** Meta reply window for the open Social thread: time left, Human Agent, or closed. */
export function SocialReplyWindowChip({ state, className }: { state: SocialReplyWindowState; className?: string }) {
  const { t } = useTranslation();
  const left = state.msLeft != null ? formatWindowLeft(state.msLeft) : null;
  const time = left ? t(`conversations.social.window.${left.unit}`, { count: left.count }) : "";
  const closed = state.window === "closed";
  const Icon = closed ? Lock : state.window === "human_agent" ? UserRound : Clock;
  const text = closed
    ? t("conversations.social.window.closed")
    : t(state.window === "human_agent" ? "conversations.social.window.humanAgent" : "conversations.social.window.standard", { time });
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium animate-in fade-in-0 duration-300",
        closed
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : state.window === "human_agent"
            ? "border-primary/20 bg-primary/5 text-primary"
            : "border-accent/30 bg-accent/10 text-foreground",
        className,
      )}
      title={t(`conversations.social.window.${closed ? "closedHint" : state.window === "human_agent" ? "humanAgentHint" : "standardHint"}`)}
      data-testid="social-reply-window"
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {text}
    </span>
  );
}

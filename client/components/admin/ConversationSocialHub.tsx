import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Instagram,
  Lock,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type SocialDmMode =
  | "disabled"
  | "needs_credentials"
  | "ready"
  | "live";

interface Props {
  mode?: SocialDmMode | string | null;
  className?: string;
}

/**
 * Locked / pre-launch panel for Social DMs inside Conversations.
 * Unlocks visually when `mode === "live"` (credentials + SOCIAL_DM_INBOX_ENABLED).
 */
export default function ConversationSocialHub({ mode, className }: Props) {
  const { t } = useTranslation();
  const live = mode === "live";
  const needsCreds = mode === "needs_credentials" || mode === "ready";

  const steps = [
    {
      key: "flag",
      done: mode === "ready" || mode === "live" || needsCreds,
      label: t("conversations.social.stepFlag"),
    },
    {
      key: "meta",
      done: mode === "ready" || mode === "live",
      label: t("conversations.social.stepMeta"),
    },
    {
      key: "webhook",
      done: mode === "live",
      label: t("conversations.social.stepWebhook"),
    },
  ] as const;

  return (
    <div
      className={cn(
        "flex-1 flex flex-col items-center justify-center p-6 sm:p-10 text-center relative overflow-hidden",
        className,
      )}
      data-testid="conversations-social-hub"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(var(--primary)/0.08),_transparent_55%)]"
      />
      <div className="relative max-w-md w-full space-y-5">
        <div className="mx-auto flex items-center justify-center gap-2">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            {live ? (
              <MessageCircle className="w-5 h-5 text-primary" />
            ) : (
              <Lock className="w-5 h-5 text-primary" />
            )}
          </div>
          <div className="flex -space-x-2">
            <span className="w-9 h-9 rounded-full bg-muted border border-border flex items-center justify-center">
              <Instagram className="w-4 h-4 text-foreground" />
            </span>
            <span className="w-9 h-9 rounded-full bg-primary/15 border border-border flex items-center justify-center text-[11px] font-bold text-primary">
              f
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="w-3 h-3 text-primary" />
            {live
              ? t("conversations.social.badgeLive")
              : t("conversations.social.badgeSoon")}
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            {live
              ? t("conversations.social.liveTitle")
              : t("conversations.social.soonTitle")}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {live
              ? t("conversations.social.liveBody")
              : t("conversations.social.soonBody")}
          </p>
        </div>

        <ul className="text-left rounded-2xl border border-border bg-card/80 divide-y divide-border overflow-hidden">
          {steps.map((s) => (
            <li
              key={s.key}
              className="flex items-start gap-3 px-4 py-3 text-sm"
            >
              <CheckCircle2
                className={cn(
                  "w-4 h-4 mt-0.5 shrink-0",
                  s.done ? "text-accent" : "text-muted-foreground/40",
                )}
              />
              <span
                className={cn(
                  s.done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-muted-foreground">
          {t("conversations.social.hintEnv")}
        </p>
      </div>
    </div>
  );
}

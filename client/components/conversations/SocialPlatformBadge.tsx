import { Facebook, Instagram } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface SocialPlatformBadgeProps {
  platform: "instagram" | "messenger";
  username?: string | null;
  className?: string;
}

/** Instagram / Facebook marker for a contact row: platform icon + @username when known. */
export function SocialPlatformBadge({ platform, username, className }: SocialPlatformBadgeProps) {
  const { t } = useTranslation();
  const Icon = platform === "instagram" ? Instagram : Facebook;
  const label = t(`conversations.channels.${platform}`);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold",
        platform === "instagram" ? "bg-accent/15 text-foreground" : "bg-primary/10 text-primary",
        className,
      )}
      title={username ? `${label} · @${username}` : label}
      data-testid="social-platform-badge"
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate normal-case">{username ? `@${username}` : label}</span>
    </span>
  );
}

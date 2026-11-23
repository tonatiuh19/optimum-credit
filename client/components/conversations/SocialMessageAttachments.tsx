import { AtSign, ExternalLink, File, Film, Image as ImageIcon, Mic, Reply, Share2, Smile, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type SocialAttachment = { type: string; url: string | null };

const ICONS: Record<string, LucideIcon> = {
  image: ImageIcon,
  video: Film,
  ig_reel: Film,
  reel: Film,
  audio: Mic,
  file: File,
  share: Share2,
  story_mention: AtSign,
  story_reply: Reply,
  sticker: Smile,
  unsupported: TriangleAlert,
};
const KNOWN = new Set(Object.keys(ICONS));

/** Attachments saved in a Meta message's metadata (webhook or past-DM import). */
export function socialMessageAttachments(metadata: unknown): SocialAttachment[] {
  let m: unknown = metadata;
  if (typeof m === "string") {
    try {
      m = JSON.parse(m);
    } catch {
      return [];
    }
  }
  const list = (m as { attachments?: unknown } | null)?.attachments;
  if (!Array.isArray(list)) return [];
  return list
    .filter((a): a is { type: unknown; url?: unknown } => !!a && typeof a === "object")
    .map((a) => ({ type: String(a.type || "file"), url: typeof a.url === "string" && /^https:\/\//.test(a.url) ? a.url : null }));
}

/**
 * Instagram / Facebook content that is not text (story mention, shared post, reel, sticker…):
 * a labelled chip with an Open link, so the bubble is never blank. The image already shown
 * as the message's media is skipped.
 */
export function SocialMessageAttachments({
  metadata,
  mediaShown,
  outbound,
}: {
  metadata: unknown;
  mediaShown: boolean;
  outbound: boolean;
}) {
  const { t } = useTranslation();
  let items = socialMessageAttachments(metadata);
  if (mediaShown) {
    const i = items.findIndex((a) => a.type === "image");
    if (i >= 0) items = items.filter((_, j) => j !== i);
  }
  if (!items.length) return null;
  return (
    <div className="mb-1 flex flex-col gap-1" data-testid="social-message-attachments">
      {items.map((a, i) => {
        const kind = KNOWN.has(a.type) ? a.type : "file";
        const Icon = ICONS[kind];
        return (
          <div
            key={`${a.type}-${i}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs",
              outbound ? "bg-primary-foreground/10" : "bg-background/60",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
            <span className="font-medium">{t(`conversations.social.attachment.${kind}`)}</span>
            {a.url && (
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-0.5 underline-offset-2 opacity-80 hover:underline hover:opacity-100"
              >
                {t("conversations.social.attachment.open")}
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

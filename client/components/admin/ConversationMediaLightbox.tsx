import { useTranslation } from "react-i18next";
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  X,
  ZoomIn,
} from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  classifyConversationMedia,
  type ConversationMediaKind,
} from "@/lib/conversationMedia";

export type { ConversationMediaKind };

export type ConversationMediaPreviewItem = {
  src: string;
  contentType?: string | null;
  /** Optional label for the chrome (filename / “Attachment”). */
  label?: string | null;
};

export { classifyConversationMedia };

type LightboxProps = {
  item: ConversationMediaPreviewItem | null;
  onClose: () => void;
};

/**
 * In-app MMS / attachment lightbox (images, video, PDF, files).
 * Prefer this over target=_blank for Conversations timeline media.
 */
export function ConversationMediaLightbox({ item, onClose }: LightboxProps) {
  const { t } = useTranslation();
  const open = !!item?.src;
  const kind = item
    ? classifyConversationMedia(item.src, item.contentType)
    : "file";
  const label =
    String(item?.label || "").trim() ||
    t("conversations.mediaPreview.attachment");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className={cn(
          "max-w-[min(96vw,1100px)] w-full p-0 gap-0 overflow-hidden border-border/60 bg-[#0b0f1a] text-foreground",
          "max-h-[92vh] shadow-2xl [&>button:last-child]:hidden",
          "data-[state=open]:zoom-in-95",
        )}
      >
        <DialogTitle className="sr-only">
          {t("conversations.mediaPreview.title")}
        </DialogTitle>
        <div className="flex flex-col max-h-[92vh]">
          <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 shrink-0 bg-black/40 backdrop-blur-md">
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-primary px-1.5 py-0.5 rounded bg-primary/15">
                {kind}
              </span>
              <span className="text-sm font-medium truncate text-white/90">
                {label}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {item?.src ? (
                <>
                  <a
                    href={item.src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-white/10 hover:bg-white/15 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t("conversations.mediaPreview.openTab")}
                  </a>
                  <a
                    href={item.src}
                    download
                    className="inline-flex items-center gap-1.5 text-xs text-white/80 hover:text-white bg-white/10 hover:bg-white/15 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t("conversations.mediaPreview.download")}
                  </a>
                </>
              ) : null}
              <DialogClose
                onClick={onClose}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                aria-label={t("conversations.mediaPreview.close")}
              >
                <X className="w-4 h-4" />
              </DialogClose>
            </div>
          </header>

          <div className="relative flex-1 min-h-[280px] max-h-[calc(92vh-3.5rem)] overflow-auto bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.06),_transparent_65%)]">
            {!item ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-white/50" />
              </div>
            ) : kind === "image" ? (
              <div className="flex items-center justify-center p-4 sm:p-8 min-h-[50vh]">
                <img
                  src={item.src}
                  alt=""
                  className="max-h-[78vh] max-w-full w-auto rounded-lg shadow-2xl object-contain animate-in fade-in-0 zoom-in-95 duration-300"
                />
              </div>
            ) : kind === "video" ? (
              <div className="flex items-center justify-center p-4 sm:p-8">
                <video
                  controls
                  autoPlay
                  className="max-h-[78vh] max-w-full rounded-xl shadow-2xl bg-black"
                  preload="metadata"
                >
                  <source
                    src={item.src}
                    type={item.contentType || undefined}
                  />
                </video>
              </div>
            ) : kind === "pdf" ? (
              <iframe
                title={label}
                src={item.src}
                className="w-full h-[min(78vh,820px)] border-0 bg-white"
              />
            ) : kind === "audio" ? (
              <div className="flex flex-col items-center justify-center gap-6 p-10 min-h-[40vh]">
                <div className="w-20 h-20 rounded-3xl bg-primary/20 border border-primary/30 flex items-center justify-center">
                  <FileText className="w-8 h-8 text-primary" />
                </div>
                <audio controls autoPlay className="w-full max-w-md">
                  <source
                    src={item.src}
                    type={item.contentType || undefined}
                  />
                </audio>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 p-10 min-h-[40vh] text-center">
                <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center">
                  <FileText className="w-7 h-7 text-white/80" />
                </div>
                <p className="text-sm text-white/70 max-w-sm">
                  {t("conversations.mediaPreview.fileHint")}
                </p>
                <a
                  href={item.src}
                  download
                  className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition"
                >
                  <Download className="w-4 h-4" />
                  {t("conversations.mediaPreview.download")}
                </a>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ThumbProps = {
  src: string;
  contentType?: string | null;
  onOpen: () => void;
  className?: string;
};

/** Clickable timeline thumbnail that opens the lightbox. */
export function ConversationMediaThumb({
  src,
  contentType,
  onOpen,
  className,
}: ThumbProps) {
  const { t } = useTranslation();
  const kind = classifyConversationMedia(src, contentType);

  if (kind === "image") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group relative block max-w-[260px] w-full text-left rounded-xl overflow-hidden border border-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        aria-label={t("conversations.mediaPreview.openAria")}
      >
        <img
          src={src}
          alt=""
          className="max-h-80 w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          loading="lazy"
        />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/70 text-white text-[10px] font-semibold px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
          <ZoomIn className="w-3 h-3" />
          {t("conversations.mediaPreview.expand")}
        </span>
      </button>
    );
  }

  if (kind === "video") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group relative block max-w-[260px] rounded-xl overflow-hidden border border-border/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        aria-label={t("conversations.mediaPreview.openAria")}
      >
        <video
          className="max-h-80 max-w-[260px] rounded-xl bg-black"
          preload="metadata"
          muted
          playsInline
        >
          <source src={src} type={contentType || undefined} />
        </video>
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/35 transition-colors">
          <span className="rounded-full bg-black/70 text-white text-xs font-semibold px-3 py-1.5 backdrop-blur-sm">
            {t("conversations.mediaPreview.play")}
          </span>
        </span>
      </button>
    );
  }

  if (kind === "audio") {
    return (
      <audio controls preload="metadata" className="w-full max-w-[260px] h-8">
        <source src={src} type={contentType || undefined} />
      </audio>
    );
  }

  // PDF / other files — chip that opens lightbox
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 hover:bg-muted px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
      <span className="truncate max-w-[200px]">
        {kind === "pdf"
          ? t("conversations.mediaPreview.pdfChip")
          : t("conversations.viewAttachment")}
      </span>
      <ZoomIn className="w-3 h-3 text-muted-foreground shrink-0" />
    </button>
  );
}

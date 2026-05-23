import { useEffect, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  FileText,
  GraduationCap,
  Image,
  Play,
  Video,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchVideos } from "@/store/slices/portalSlice";
import type { EducationalVideo } from "@shared/api";

type ContentType = "video" | "pdf" | "image" | "article";
type FilterTab = "all" | ContentType;

const TYPE_META: Record<
  ContentType,
  { label: string; icon: React.ElementType; badge: string; preview: string }
> = {
  video: {
    label: "Video",
    icon: Video,
    badge: "bg-primary/10 text-primary",
    preview: "Watch",
  },
  pdf: {
    label: "PDF",
    icon: FileText,
    badge: "bg-destructive/10 text-destructive",
    preview: "Open PDF",
  },
  image: {
    label: "Image",
    icon: Image,
    badge: "bg-accent/10 text-accent",
    preview: "View",
  },
  article: {
    label: "Article",
    icon: BookOpen,
    badge: "bg-secondary text-secondary-foreground",
    preview: "Read",
  },
};

function getEmbedUrl(url: string): string | null {
  // YouTube
  const ytMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([^&?/]+)/,
  );
  if (ytMatch)
    return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0&modestbranding=1`;
  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  return null;
}

function isDirectVideo(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url);
}

function ContentCard({
  item,
  onImageClick,
}: {
  item: EducationalVideo;
  onImageClick: (url: string) => void;
}) {
  const ctype = (item.content_type ?? "video") as ContentType;
  const meta = TYPE_META[ctype] ?? TYPE_META.video;
  const Icon = meta.icon;
  const contentUrl = item.file_url ?? item.video_url ?? "";
  const embedUrl =
    ctype === "video" && contentUrl ? getEmbedUrl(contentUrl) : null;
  const isDirect = ctype === "video" && contentUrl && isDirectVideo(contentUrl);

  const handleClick = () => {
    if (ctype === "image" && contentUrl) {
      onImageClick(contentUrl);
    } else if (contentUrl) {
      window.open(contentUrl, "_blank", "noreferrer");
    }
  };

  return (
    <div className="group bg-card rounded-2xl border border-border overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5 flex flex-col">
      {/* Preview area */}
      <div className="relative aspect-video bg-muted/40 overflow-hidden">
        {embedUrl ? (
          <iframe
            src={embedUrl}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        ) : isDirect && contentUrl ? (
          <video
            src={contentUrl}
            controls
            className="w-full h-full object-cover"
            preload="metadata"
          />
        ) : ctype === "image" && contentUrl ? (
          <button
            onClick={handleClick}
            className="w-full h-full"
            aria-label={`View image: ${item.title}`}
          >
            <img
              src={contentUrl}
              alt={item.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          </button>
        ) : item.thumbnail_url ? (
          <button
            onClick={handleClick}
            className="w-full h-full relative block"
            aria-label={`Open: ${item.title}`}
          >
            <img
              src={item.thumbnail_url}
              alt={item.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            <div className="absolute inset-0 bg-black/25 group-hover:bg-black/40 transition-colors flex items-center justify-center">
              {ctype === "video" ? (
                <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                  <Play className="w-6 h-6 text-primary fill-primary ml-1" />
                </div>
              ) : (
                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
              )}
            </div>
          </button>
        ) : (
          <button
            onClick={contentUrl ? handleClick : undefined}
            className="w-full h-full flex flex-col items-center justify-center gap-2 hover:bg-muted/60 transition-colors cursor-pointer"
          >
            <div className="w-16 h-16 rounded-2xl bg-card border border-border flex items-center justify-center shadow-sm">
              <Icon className="w-7 h-7 text-muted-foreground" />
            </div>
            <span className="text-xs text-muted-foreground">
              {meta.preview}
            </span>
          </button>
        )}

        {/* Type badge */}
        <span
          className={`absolute top-2 left-2 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full backdrop-blur-sm ${meta.badge}`}
        >
          <Icon className="w-3 h-3" />
          {meta.label}
        </span>

        {/* Language badge */}
        {item.language === "es" && (
          <span className="absolute top-2 right-2 text-xs bg-black/50 text-white px-1.5 py-0.5 rounded-full">
            ES
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-semibold text-sm leading-snug line-clamp-2 text-foreground">
          {item.title}
        </h3>
        {item.description && (
          <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 flex-1">
            {item.description}
          </p>
        )}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          {item.category && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {item.category}
            </span>
          )}
          {contentUrl &&
            (ctype === "pdf" ||
              ctype === "article" ||
              (ctype === "video" && !embedUrl && !isDirect)) && (
              <a
                href={contentUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
              >
                {meta.preview} <ExternalLink className="w-3 h-3" />
              </a>
            )}
        </div>
      </div>
    </div>
  );
}

export default function Videos() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { videos } = useAppSelector((s) => s.portal);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchVideos());
  }, [dispatch]);

  const filtered =
    filter === "all"
      ? videos
      : videos.filter((v) => (v.content_type ?? "video") === filter);

  const hasByType = (t: ContentType) =>
    videos.some((v) => (v.content_type ?? "video") === t);

  return (
    <div className="space-y-8">
      {/* Hero header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-card to-accent/5 rounded-2xl border border-border p-6 md:p-8">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold px-3 py-1 rounded-full mb-3">
            <GraduationCap className="w-3.5 h-3.5" />
            Education Center
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            {t("videos.heading")}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-md">
            {t("videos.subheading")}
          </p>
          <div className="flex gap-3 mt-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Video className="w-3.5 h-3.5 text-primary" />
              {
                videos.filter((v) => (v.content_type ?? "video") === "video")
                  .length
              }{" "}
              videos
            </span>
            <span className="flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-destructive" />
              {videos.filter((v) => v.content_type === "pdf").length} PDFs
            </span>
            <span className="flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5 text-secondary-foreground" />
              {videos.filter((v) => v.content_type === "article").length}{" "}
              articles
            </span>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      {videos.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {(["all", "video", "pdf", "image", "article"] as FilterTab[]).map(
            (t) => {
              if (t !== "all" && !hasByType(t as ContentType)) return null;
              const meta =
                t === "all"
                  ? { label: `All (${videos.length})`, icon: null }
                  : TYPE_META[t as ContentType];
              const Icon = t !== "all" ? (meta as any).icon : null;
              return (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                    filter === t
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  {Icon && <Icon className="w-3.5 h-3.5" />}
                  {t === "all"
                    ? `All (${videos.length})`
                    : `${(meta as any).label} (${videos.filter((v) => (v.content_type ?? "video") === t).length})`}
                </button>
              );
            },
          )}
        </div>
      )}

      {/* Content grid */}
      {videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-card rounded-2xl border border-border text-center">
          <GraduationCap className="w-14 h-14 text-muted-foreground/30 mb-3" />
          <p className="font-semibold text-foreground">Content coming soon</p>
          <p className="text-sm text-muted-foreground mt-1">
            Our team is preparing educational resources for you.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <BookOpen className="w-10 h-10 mb-2 opacity-30" />
          <p>No {filter} content available yet.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((v) => (
            <ContentCard
              key={v.id}
              item={v}
              onImageClick={(url) => setLightbox(url)}
            />
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <X className="w-8 h-8" />
          </button>
          <img
            src={lightbox}
            alt="Preview"
            className="max-w-full max-h-full rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

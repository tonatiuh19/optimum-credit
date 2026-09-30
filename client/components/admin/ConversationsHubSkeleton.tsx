import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

function Shimmer({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-md skeleton-shimmer", className)} aria-hidden />
  );
}

function ContactRowSkeleton({ delayMs }: { delayMs: number }) {
  return (
    <div
      className="p-3.5 border-b border-border/50 space-y-2 animate-in fade-in-0 duration-500"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <Shimmer className="h-4 w-[55%]" />
        <Shimmer className="h-5 w-5 rounded-full shrink-0" />
      </div>
      <Shimmer className="h-3 w-[80%]" />
      <div className="flex gap-1.5">
        <Shimmer className="h-4 w-14 rounded" />
        <Shimmer className="h-4 w-10 rounded" />
      </div>
    </div>
  );
}

function MessageBubbleSkeleton({
  delayMs,
  align,
}: {
  delayMs: number;
  align: "start" | "end";
}) {
  return (
    <div
      className={cn(
        "flex animate-in fade-in-0 duration-500",
        align === "end" ? "justify-end" : "justify-start",
      )}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div
        className={cn(
          "max-w-[75%] space-y-2 p-3 rounded-2xl border border-border/40",
          align === "end" ? "bg-primary/10" : "bg-muted/60",
        )}
      >
        <Shimmer className="h-2.5 w-16" />
        <Shimmer className="h-3.5 w-40 sm:w-52" />
        <Shimmer className="h-3.5 w-28 sm:w-36" />
        <Shimmer className="h-2.5 w-20" />
      </div>
    </div>
  );
}

/** Inbox list rows only (left pane while refreshing empty). */
export function ConversationsContactListSkeleton({
  rows = 6,
}: {
  rows?: number;
}) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <ContactRowSkeleton key={i} delayMs={i * 50} />
      ))}
    </div>
  );
}

/** Timeline message bubbles (right pane while loading empty thread). */
export function ConversationsTimelineSkeleton() {
  const bubbles: Array<"start" | "end"> = [
    "start",
    "end",
    "start",
    "end",
    "start",
  ];
  return (
    <div className="p-4 space-y-3" aria-hidden>
      {bubbles.map((align, i) => (
        <MessageBubbleSkeleton key={i} delayMs={i * 70} align={align} />
      ))}
    </div>
  );
}

/** Full hub layout — initial access / first paint. */
export default function ConversationsHubSkeleton() {
  const { t } = useTranslation();

  return (
    <div
      className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-4 flex-1 min-h-0 lg:min-h-[28rem]"
      aria-busy="true"
      aria-label={t("conversations.loadingHub")}
      data-testid="conversations-hub-skeleton"
    >
      <div className="bg-card rounded-2xl border border-border flex flex-col overflow-hidden min-h-[320px]">
        <div className="p-3 border-b border-border space-y-2 shrink-0">
          <Shimmer className="h-10 w-full rounded-xl" />
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Shimmer key={i} className="h-6 w-14 rounded-lg" />
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ConversationsContactListSkeleton />
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border flex flex-col min-h-[320px] overflow-hidden">
        <div className="p-4 border-b border-border space-y-2 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2 flex-1">
              <Shimmer className="h-5 w-40" />
              <Shimmer className="h-3 w-56" />
            </div>
            <div className="flex gap-2">
              <Shimmer className="h-9 w-24 rounded-lg" />
              <Shimmer className="h-9 w-20 rounded-lg" />
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ConversationsTimelineSkeleton />
        </div>
        <div className="p-3 border-t border-border space-y-2 shrink-0">
          <div className="flex gap-1">
            <Shimmer className="h-7 w-12 rounded-lg" />
            <Shimmer className="h-7 w-14 rounded-lg" />
          </div>
          <Shimmer className="h-20 w-full rounded-xl" />
          <div className="flex justify-end">
            <Shimmer className="h-10 w-24 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

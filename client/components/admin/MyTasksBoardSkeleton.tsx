import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const COLUMN_META = [
  { border: "border-t-muted-foreground/40", cards: 3 },
  { border: "border-t-primary", cards: 2 },
  { border: "border-t-accent", cards: 4 },
] as const;

function Shimmer({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-md skeleton-shimmer", className)} aria-hidden />
  );
}

function TaskCardSkeleton({ delayMs }: { delayMs: number }) {
  return (
    <div
      className="rounded-xl border border-border bg-background p-3 space-y-2.5 animate-in fade-in-0 duration-500"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex items-start gap-2">
        <Shimmer className="w-3.5 h-3.5 mt-0.5 shrink-0 rounded" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <Shimmer className="h-3.5 w-[70%]" />
            <Shimmer className="h-4 w-14 rounded shrink-0" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Shimmer className="h-4 w-12 rounded" />
            <Shimmer className="h-4 w-16 rounded" />
            <Shimmer className="h-4 w-20 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MyTasksBoardSkeleton() {
  const { t } = useTranslation();

  return (
    <div
      className="grid lg:grid-cols-3 gap-4 items-start"
      aria-busy="true"
      aria-label={t("myTasks.loadingBoard")}
    >
      {COLUMN_META.map((col, colIdx) => (
        <div
          key={colIdx}
          className={cn(
            "rounded-2xl border border-border bg-card/60 min-h-[420px] flex flex-col border-t-4",
            col.border,
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
            <div className="flex items-center gap-2">
              <Shimmer className="h-4 w-16" />
              <Shimmer className="h-5 w-7 rounded-full" />
            </div>
            <Shimmer className="h-7 w-7 rounded-lg" />
          </div>
          <div className="p-3 space-y-2 flex-1">
            {Array.from({ length: col.cards }).map((_, i) => (
              <TaskCardSkeleton
                key={i}
                delayMs={colIdx * 80 + i * 60}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

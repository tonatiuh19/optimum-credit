import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const COLUMN_BORDERS = [
  "border-t-accent",
  "border-t-primary",
  "border-t-accent",
  "border-t-primary/70",
  "border-t-primary/60",
  "border-t-primary/50",
  "border-t-primary/40",
  "border-t-accent/70",
] as const;

/** Varied card counts so the board feels alive while loading. */
const COLUMN_CARD_COUNTS = [1, 3, 2, 2, 1, 1, 1, 0] as const;

function ShimmerBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-md skeleton-shimmer", className)}
      aria-hidden
    />
  );
}

function SkeletonCard({ delayMs }: { delayMs: number }) {
  return (
    <div
      className="rounded-xl bg-card border border-border shadow-sm overflow-hidden animate-in fade-in-0 duration-500"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="h-[3px] skeleton-shimmer" />
      <div className="p-3.5 space-y-3">
        <div className="flex items-start gap-2.5">
          <ShimmerBlock className="w-8 h-8 rounded-full shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
            <div className="flex items-center gap-1.5">
              <ShimmerBlock className="h-3.5 w-[55%]" />
              <ShimmerBlock className="h-4 w-8 rounded-full" />
            </div>
            <ShimmerBlock className="h-2.5 w-[40%]" />
          </div>
          <ShimmerBlock className="h-5 w-12 rounded-full shrink-0" />
        </div>
        <div className="space-y-1.5">
          <ShimmerBlock className="h-2.5 w-16" />
          <ShimmerBlock className="h-1.5 w-full rounded-full" />
        </div>
        <ShimmerBlock className="h-2.5 w-24" />
      </div>
    </div>
  );
}

function SkeletonColumn({
  borderClass,
  cardCount,
  columnIndex,
}: {
  borderClass: string;
  cardCount: number;
  columnIndex: number;
}) {
  return (
    <div
      className={cn(
        "w-[min(280px,calc(100vw-2.5rem))] sm:w-[270px] shrink-0 flex flex-col rounded-2xl border-t-[3px] overflow-hidden shadow-sm bg-card border border-border",
        borderClass,
      )}
    >
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-border/60">
        <ShimmerBlock className="h-3 w-24" />
        <ShimmerBlock className="h-5 w-5 rounded-full" />
      </div>
      <div className="flex flex-col gap-2.5 p-2.5 min-h-[140px]">
        {cardCount === 0 ? (
          <div className="flex-1 flex items-center justify-center rounded-xl border border-dashed border-border/80 min-h-[100px]">
            <ShimmerBlock className="h-2.5 w-16" />
          </div>
        ) : (
          Array.from({ length: cardCount }).map((_, i) => (
            <SkeletonCard
              key={i}
              delayMs={columnIndex * 70 + i * 55}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** Kanban-shaped loading placeholder for the admin Pipeline board. */
export default function PipelineBoardSkeleton() {
  const { t } = useTranslation();

  return (
    <div
      className="table-scroll pb-4 -mx-1 px-1 max-w-full"
      role="status"
      aria-busy="true"
      aria-label={t("adminPipeline.loadingBoard")}
      data-testid="pipeline-board-skeleton"
    >
      <div className="flex gap-3 w-max min-w-full pr-2">
        {COLUMN_BORDERS.map((border, i) => (
          <SkeletonColumn
            key={i}
            borderClass={border}
            cardCount={COLUMN_CARD_COUNTS[i] ?? 1}
            columnIndex={i}
          />
        ))}
      </div>
      <span className="sr-only">{t("adminPipeline.loadingBoard")}</span>
    </div>
  );
}

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number;
  className?: string;
  delay?: number;
}

function AnimatedStat({ label, value, className, delay = 0 }: StatCardProps) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (value === 0) {
      setDisplay(0);
      return;
    }
    const duration = 600;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(value * t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    const timeout = window.setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
    };
  }, [value, delay]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: delay / 1000 }}
    >
      <div
        className={cn(
          "rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm",
          className,
        )}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
          {display}
        </p>
      </div>
    </motion.div>
  );
}

interface BulkImportSummaryCardsProps {
  willCreate: number;
  skipped: number;
  errors: number;
  total: number;
}

export default function BulkImportSummaryCards({
  willCreate,
  skipped,
  errors,
  total,
}: BulkImportSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      <AnimatedStat
        label="Ready to import"
        value={willCreate}
        className="bg-accent/10 ring-1 ring-accent/20"
        delay={0}
      />
      <AnimatedStat
        label="Skipped"
        value={skipped}
        className="bg-secondary ring-1 ring-border"
        delay={80}
      />
      <AnimatedStat
        label="Errors"
        value={errors}
        className="bg-destructive/10 ring-1 ring-destructive/20"
        delay={160}
      />
      <AnimatedStat
        label="Total rows"
        value={total}
        className="bg-muted/60 ring-1 ring-border"
        delay={240}
      />
    </div>
  );
}

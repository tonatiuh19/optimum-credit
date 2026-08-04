import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Compact admin field helper — one line under a control. */
export default function FieldHint({
  children,
  className,
  tone = "muted",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "muted" | "warning" | "accent";
}) {
  const toneCls =
    tone === "warning"
      ? "text-destructive border-destructive/25 bg-destructive/5"
      : tone === "accent"
        ? "text-foreground border-primary/20 bg-primary/5"
        : "text-muted-foreground border-border bg-muted/40";

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-[11px] leading-snug rounded-lg border px-2.5 py-1.5 mt-1.5",
        toneCls,
        className,
      )}
    >
      <Info className="w-3 h-3 shrink-0 mt-0.5 opacity-80" />
      <span>{children}</span>
    </p>
  );
}

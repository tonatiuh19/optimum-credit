import type { Label } from "@shared/api";
import { labelColorClasses } from "@/lib/labelColors";

/** Small read-only chip row for source/analysis labels attached to a client, case, or prospect. */
export function LabelChips({
  labels,
  className = "",
  max,
}: {
  labels?: Label[] | null;
  className?: string;
  max?: number;
}) {
  if (!labels || labels.length === 0) return null;
  const shown = typeof max === "number" ? labels.slice(0, max) : labels;
  const extra = typeof max === "number" ? labels.length - shown.length : 0;

  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {shown.map((l) => (
        <span
          key={l.id}
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border leading-tight ${labelColorClasses(l.color)}`}
          title={l.layer === "source" ? "Source label" : "Analysis label"}
        >
          {l.name_en}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5">
          +{extra}
        </span>
      )}
    </div>
  );
}

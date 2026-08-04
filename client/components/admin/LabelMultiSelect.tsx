import { useState } from "react";
import { ChevronDown, Tag } from "lucide-react";
import type { Label } from "@shared/api";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { labelColorClasses } from "@/lib/labelColors";

/** Checkbox popover for selecting a subset of labels (source + analysis), grouped by layer. */
export function LabelMultiSelect({
  labels,
  selected,
  onChange,
  placeholder = "Labels",
}: {
  labels: Label[];
  selected: string[];
  onChange: (slugs: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const sourceLabels = labels.filter((l) => l.layer === "source");
  const analysisLabels = labels.filter((l) => l.layer === "analysis");

  const toggle = (slug: string) => {
    onChange(
      selected.includes(slug)
        ? selected.filter((s) => s !== slug)
        : [...selected, slug],
    );
  };

  const renderGroup = (title: string, group: Label[]) =>
    group.length > 0 && (
      <div className="space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {group.map((l) => (
          <label
            key={l.id}
            className="flex items-center gap-2 py-1 cursor-pointer text-sm"
          >
            <Checkbox
              checked={selected.includes(l.slug)}
              onCheckedChange={() => toggle(l.slug)}
            />
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${labelColorClasses(l.color)}`}
            >
              {l.name_en}
            </span>
          </label>
        ))}
      </div>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg border text-sm font-medium transition-colors ${
            selected.length > 0
              ? "bg-primary text-primary-foreground border-primary"
              : "border-input bg-background text-foreground hover:bg-muted"
          }`}
        >
          <Tag className="w-3.5 h-3.5" />
          {placeholder}
          {selected.length > 0 && (
            <span className="h-5 min-w-5 px-1 rounded-full bg-white/20 text-[11px] font-bold flex items-center justify-center">
              {selected.length}
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 max-h-80 overflow-y-auto space-y-3">
        {labels.length === 0 ? (
          <p className="text-xs text-muted-foreground">No labels yet.</p>
        ) : (
          <>
            {renderGroup("Source", sourceLabels)}
            {renderGroup("Analysis", analysisLabels)}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

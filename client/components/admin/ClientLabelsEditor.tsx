import { useEffect, useState } from "react";
import { Plus, X, Tag } from "lucide-react";
import type { Label } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLabels, setClientLabels } from "@/store/slices/prospectsSlice";
import { labelColorClasses } from "@/lib/labelColors";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** Shows a client's current labels with quick add/remove — used in the client detail panel. */
export function ClientLabelsEditor({
  clientId,
  initialLabels,
}: {
  clientId: number;
  initialLabels?: Label[] | null;
}) {
  const dispatch = useAppDispatch();
  const { labels: catalog } = useAppSelector((s) => s.prospects);
  const [current, setCurrent] = useState<Label[]>(initialLabels ?? []);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCurrent(initialLabels ?? []);
  }, [initialLabels, clientId]);

  useEffect(() => {
    if (catalog.length === 0) dispatch(fetchLabels());
  }, [dispatch, catalog.length]);

  const currentSlugs = new Set(current.map((l) => l.slug));
  const available = catalog.filter((l) => !currentSlugs.has(l.slug));

  const handleAdd = async (slug: string) => {
    setSaving(true);
    try {
      const res = await dispatch(
        setClientLabels({ clientId, add: [slug] }),
      ).unwrap();
      setCurrent(res.labels);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (slug: string) => {
    setSaving(true);
    try {
      const res = await dispatch(
        setClientLabels({ clientId, remove: [slug] }),
      ).unwrap();
      setCurrent(res.labels);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-muted/40 rounded-xl p-4 space-y-2.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Tag className="w-3 h-3" /> Labels
      </h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {current.map((l) => (
          <span
            key={l.id}
            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${labelColorClasses(l.color)}`}
          >
            {l.name_en}
            <button
              type="button"
              onClick={() => handleRemove(l.slug)}
              disabled={saving}
              className="hover:opacity-60"
              aria-label={`Remove ${l.name_en}`}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={saving}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground border border-dashed border-border px-1.5 py-0.5 rounded-full hover:border-primary hover:text-primary transition-colors"
            >
              <Plus className="w-2.5 h-2.5" /> Add
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 max-h-64 overflow-y-auto space-y-1">
            {available.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No more labels to add.
              </p>
            ) : (
              available.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    handleAdd(l.slug);
                    setOpen(false);
                  }}
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-sm"
                >
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${labelColorClasses(l.color)}`}
                  >
                    {l.name_en}
                  </span>
                </button>
              ))
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

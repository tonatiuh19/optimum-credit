import {
  CheckCircle2,
  MinusCircle,
  XCircle,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  filterPreviewRows,
  type BulkImportRowPreview,
  type BulkImportTableFilter,
} from "@shared/bulkImport";

const FILTERS: { id: BulkImportTableFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "skipped", label: "Skipped" },
  { id: "error", label: "Errors" },
];

function StatusIcon({ status }: { status: BulkImportRowPreview["status"] }) {
  if (status === "will_create")
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />;
  if (status === "skipped")
    return <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" />;
  return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
}

interface BulkImportPreviewTableProps {
  rows: BulkImportRowPreview[];
  filter: BulkImportTableFilter;
  search: string;
  counts: { all: number; ready: number; skipped: number; error: number };
  onFilterChange: (f: BulkImportTableFilter) => void;
  onSearchChange: (q: string) => void;
}

export default function BulkImportPreviewTable({
  rows,
  filter,
  search,
  counts,
  onFilterChange,
  onSearchChange,
}: BulkImportPreviewTableProps) {
  const filtered = filterPreviewRows(rows, filter, search);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilterChange(f.id)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {f.label} ({counts[f.id]})
            </button>
          ))}
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, phone…"
            className="pl-9"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="hidden md:block rounded-lg border border-border">
        <ScrollArea className="max-h-[50vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium w-10">#</th>
                <th className="px-3 py-2 font-medium w-8" />
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Status / pkg</th>
                <th className="px-3 py-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.row_number} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.row_number}
                  </td>
                  <td className="px-3 py-2">
                    <StatusIcon status={r.status} />
                  </td>
                  <td className="px-3 py-2 font-medium">{r.display_name}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.email || "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.phone || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.badge ? (
                      <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs">
                        {r.badge}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[14rem] truncate">
                    {r.message || "—"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    No rows match this filter
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>

      <div className="md:hidden space-y-2 max-h-[50vh] overflow-y-auto">
        {filtered.map((r) => (
          <div
            key={r.row_number}
            className="rounded-lg border border-border bg-card p-3 space-y-1"
          >
            <div className="flex items-center gap-2">
              <StatusIcon status={r.status} />
              <span className="font-medium text-sm">{r.display_name}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                #{r.row_number}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{r.email || "No email"}</p>
            {r.message && (
              <p className="text-xs text-muted-foreground">{r.message}</p>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">
            No rows match this filter
          </p>
        )}
      </div>
    </div>
  );
}

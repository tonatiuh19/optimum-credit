import { useEffect, useState, useCallback } from "react";
import {
  Archive,
  X,
  Eye,
  Calendar,
  FileText,
  ShieldCheck,
  AlertCircle,
  Download,
  Loader2,
  Search,
  CheckCircle2,
  Clock,
  ChevronDown,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { DataGrid } from "@/components/ui/data-grid";
import type { DataGridColumn } from "@/components/ui/data-grid";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAllDocuments } from "@/store/slices/adminSlice";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";
import { useDebounce } from "@/hooks/use-debounce";

const DOC_TYPE_LABELS: Record<string, string> = {
  id_front: "Gov ID — Front",
  id_back: "Gov ID — Back",
  ssn_card: "SSN Card",
  proof_of_address: "Proof of Address",
  other: "Other",
};

const DOC_TYPE_COLORS: Record<string, string> = {
  id_front: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  id_back: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  ssn_card: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  proof_of_address: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  other: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; icon: React.ReactNode }
> = {
  pending: {
    label: "Pending",
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    icon: <Clock className="w-3 h-3" />,
  },
  approved: {
    label: "Approved",
    className: "bg-accent/10 text-accent border-accent/20",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  rejected: {
    label: "Rejected",
    className: "bg-red-500/10 text-red-400 border-red-500/20",
    icon: <X className="w-3 h-3" />,
  },
};

interface DocRecord {
  id: number;
  client_id: number;
  doc_type: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  review_status: string;
  rejection_reason?: string;
  uploaded_at: string;
  reviewed_at?: string;
  first_name: string;
  last_name: string;
  email: string;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminDocuments() {
  const dispatch = useAppDispatch();
  const { allDocuments, loading } = useAppSelector((s) => s.admin);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 350);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState("uploaded_at");
  const [sortDir, setSortDir] = useState<"ASC" | "DESC">("DESC");

  const [selected, setSelected] = useState<DocRecord | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  useEffect(() => {
    dispatch(fetchAllDocuments({ search: debouncedSearch || undefined }));
  }, [dispatch, debouncedSearch]);

  const docs = (allDocuments as DocRecord[]).filter((d) => {
    if (statusFilter !== "all" && d.review_status !== statusFilter)
      return false;
    if (typeFilter !== "all" && d.doc_type !== typeFilter) return false;
    return true;
  });

  const counts = (allDocuments as DocRecord[]).reduce(
    (acc, d) => {
      acc[d.review_status] = (acc[d.review_status] || 0) + 1;
      acc.all++;
      return acc;
    },
    { all: 0, pending: 0, approved: 0, rejected: 0 } as Record<string, number>,
  );

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortBy(key);
      setSortDir("ASC");
    }
  };

  const sorted = [...docs].sort((a, b) => {
    const av = (a as any)[sortBy] ?? "";
    const bv = (b as any)[sortBy] ?? "";
    const cmp = String(av).localeCompare(String(bv));
    return sortDir === "ASC" ? cmp : -cmp;
  });

  const loadFile = useCallback(async (doc: DocRecord) => {
    setFileUrl(null);
    setFileLoading(true);
    try {
      const resp = await api.get(`/admin/documents/${doc.id}/file`, {
        responseType: "blob",
      });
      setFileUrl(URL.createObjectURL(resp.data as Blob));
    } catch {
      setFileUrl(null);
    } finally {
      setFileLoading(false);
    }
  }, []);

  const openDoc = useCallback(
    (doc: DocRecord) => {
      setSelected(doc);
      loadFile(doc);
    },
    [loadFile],
  );

  const closeDoc = useCallback(() => {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setSelected(null);
    setFileUrl(null);
  }, [fileUrl]);

  const isImage = selected?.mime_type.startsWith("image/");
  const isPdf = selected?.mime_type === "application/pdf";

  const columns: DataGridColumn<DocRecord>[] = [
    {
      key: "first_name",
      label: "Client",
      sortable: true,
      sticky: true,
      render: (d) => (
        <div>
          <div className="font-medium">
            {d.first_name} {d.last_name}
          </div>
          <div className="text-xs text-muted-foreground">{d.email}</div>
        </div>
      ),
    },
    {
      key: "file_name",
      label: "Document",
      sortable: true,
      wrap: true,
      render: (d) => (
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
            <span className="text-foreground/80 truncate max-w-[160px]">
              {d.file_name}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {formatBytes(d.file_size)}
          </div>
        </div>
      ),
    },
    {
      key: "doc_type",
      label: "Type",
      sortable: true,
      shrink: true,
      render: (d) => (
        <span
          className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
            DOC_TYPE_COLORS[d.doc_type] || DOC_TYPE_COLORS.other
          }`}
        >
          {DOC_TYPE_LABELS[d.doc_type] || d.doc_type}
        </span>
      ),
    },
    {
      key: "uploaded_at",
      label: "Uploaded",
      sortable: true,
      shrink: true,
      render: (d) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(d.uploaded_at)}
        </span>
      ),
    },
    {
      key: "review_status",
      label: "Status",
      sortable: true,
      shrink: true,
      render: (d) => {
        const sc = STATUS_CONFIG[d.review_status] || STATUS_CONFIG.pending;
        return (
          <div>
            <Badge
              variant="outline"
              className={`text-[10px] gap-1 ${sc.className}`}
            >
              {sc.icon}
              {sc.label}
            </Badge>
            {d.review_status === "rejected" && d.rejection_reason && (
              <div
                className="text-[10px] text-red-500 mt-1 max-w-[140px] truncate"
                title={d.rejection_reason}
              >
                {d.rejection_reason}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "_actions",
      label: "",
      shrink: true,
      render: (d) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            openDoc(d);
          }}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <Eye className="w-3.5 h-3.5" /> View
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <AdminPageHeader
        icon={Archive}
        title="Document Archive"
        description="Browse and preview all uploaded client documents. To review pending documents, go to Pipeline."
        badge={
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-accent bg-accent/10 border border-accent/20 px-2.5 py-1 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5" /> AES-256
          </span>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by client name, email or filename…"
            className="pl-9 h-10"
          />
        </div>
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as typeof statusFilter)
            }
            className="h-10 pl-3 pr-8 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
          >
            {(["all", "pending", "approved", "rejected"] as const).map((s) => (
              <option key={s} value={s}>
                {s === "all"
                  ? "All statuses"
                  : s.charAt(0).toUpperCase() + s.slice(1)}
                {counts[s] != null ? ` (${counts[s]})` : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-10 pl-3 pr-8 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
          >
            <option value="all">All types</option>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Document grid */}
      <div className="bg-card rounded-2xl border border-border px-6 py-4">
        <DataGrid
          data={sorted}
          columns={columns}
          rowKey={(d) => d.id}
          isLoading={loading}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          onRowClick={openDoc}
          emptyMessage={
            search || statusFilter !== "all" || typeFilter !== "all"
              ? "Try adjusting your filters."
              : "No documents have been uploaded yet."
          }
        />
      </div>

      {/* View-only preview overlay */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && closeDoc()}>
        <DialogContent className="max-w-3xl w-full bg-card border-border p-0 gap-0 overflow-hidden max-h-[90vh]">
          <DialogTitle className="sr-only">
            {selected
              ? DOC_TYPE_LABELS[selected.doc_type] || selected.doc_type
              : "Document"}
          </DialogTitle>

          {selected && (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`text-xs font-medium px-2 py-0.5 rounded-full border ${DOC_TYPE_COLORS[selected.doc_type] || DOC_TYPE_COLORS.other}`}
                  >
                    {DOC_TYPE_LABELS[selected.doc_type] || selected.doc_type}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">
                      {selected.first_name} {selected.last_name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {selected.email}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {fileUrl && (
                    <a
                      href={fileUrl}
                      download={selected.file_name}
                      className="inline-flex items-center gap-1.5 text-xs text-foreground/80 hover:text-foreground bg-muted hover:bg-muted/80 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" /> Download
                    </a>
                  )}
                  <button
                    onClick={closeDoc}
                    className="w-7 h-7 rounded-lg bg-muted hover:bg-muted/80 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* File preview */}
              <div className="flex-1 bg-muted/40 flex items-center justify-center overflow-hidden min-h-[300px]">
                {fileLoading && (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">
                      Decrypting document…
                    </p>
                  </div>
                )}
                {!fileLoading && fileUrl && isImage && (
                  <img
                    src={fileUrl}
                    alt={selected.file_name}
                    className="max-w-full max-h-[500px] object-contain rounded-lg shadow-xl"
                  />
                )}
                {!fileLoading && fileUrl && isPdf && (
                  <iframe
                    src={fileUrl}
                    className="w-full h-[500px] rounded-lg"
                    title={selected.file_name}
                  />
                )}
                {!fileLoading && !fileUrl && (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <AlertCircle className="w-8 h-8" />
                    <p className="text-sm">Preview unavailable</p>
                  </div>
                )}
              </div>

              {/* Footer: metadata */}
              <div className="px-5 py-3 border-t border-border flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" />
                  Uploaded {formatDate(selected.uploaded_at)}
                </span>
                <span>{formatBytes(selected.file_size)}</span>
                <span className="flex items-center gap-1.5 ml-auto">
                  <ShieldCheck className="w-3 h-3 text-accent" />
                  <span className="text-accent">AES-256 encrypted</span>
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

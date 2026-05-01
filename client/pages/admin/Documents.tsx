import { useEffect, useState, useCallback } from "react";
import {
  Archive,
  X,
  Eye,
  User,
  Calendar,
  FileText,
  ShieldCheck,
  AlertCircle,
  Download,
  Loader2,
  Search,
  CheckCircle2,
  Clock,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAllDocuments } from "@/store/slices/adminSlice";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";

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
  const { allDocuments } = useAppSelector((s) => s.admin);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const [selected, setSelected] = useState<DocRecord | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  useEffect(() => {
    dispatch(fetchAllDocuments({}));
  }, [dispatch]);

  // Client-side filter (all docs already fetched)
  const docs = (allDocuments as DocRecord[]).filter((d) => {
    if (statusFilter !== "all" && d.review_status !== statusFilter)
      return false;
    if (typeFilter !== "all" && d.doc_type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        d.first_name.toLowerCase().includes(q) ||
        d.last_name.toLowerCase().includes(q) ||
        d.email.toLowerCase().includes(q) ||
        d.file_name.toLowerCase().includes(q)
      );
    }
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

      {/* Stats filter chips */}
      <div className="flex flex-wrap gap-2">
        {(["all", "pending", "approved", "rejected"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              statusFilter === s
                ? "bg-primary/15 border-primary/50 text-primary"
                : "bg-muted border-border text-muted-foreground hover:border-primary/30"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}{" "}
            <span className="opacity-60">({counts[s] ?? 0})</span>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-background border border-input text-xs rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:border-primary/50"
          >
            <option value="all">All types</option>
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client name, email or filename…"
          className="pl-9"
        />
      </div>

      {/* Document table */}
      {docs.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="font-semibold text-foreground">No documents found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search || statusFilter !== "all" || typeFilter !== "all"
              ? "Try adjusting your filters."
              : "No documents have been uploaded yet."}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Client
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Document
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                  Type
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">
                  Uploaded
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Status
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {docs.map((d) => {
                const sc =
                  STATUS_CONFIG[d.review_status] || STATUS_CONFIG.pending;
                return (
                  <tr
                    key={d.id}
                    className="hover:bg-muted/30 transition-colors group"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium truncate max-w-[140px]">
                        {d.first_name} {d.last_name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-[140px]">
                        {d.email}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                        <span className="truncate max-w-[160px] text-foreground/80">
                          {d.file_name}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatBytes(d.file_size)}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span
                        className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${DOC_TYPE_COLORS[d.doc_type] || DOC_TYPE_COLORS.other}`}
                      >
                        {DOC_TYPE_LABELS[d.doc_type] || d.doc_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                      {formatDate(d.uploaded_at)}
                    </td>
                    <td className="px-4 py-3">
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
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openDoc(d)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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

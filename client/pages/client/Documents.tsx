import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  FileText,
  Home,
  IdCard,
  Loader2,
  PartyPopper,
  ShieldCheck,
  Lock,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import ClientPageHeader from "@/components/ClientPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchDashboard, uploadDocuments } from "@/store/slices/portalSlice";
import { useToast } from "@/hooks/use-toast";
import api from "@/lib/api";
import type { ClientDocument, DocType } from "@shared/api";

const DOC_TYPES: {
  type: DocType;
  label: string;
  desc: string;
  icon: LucideIcon;
}[] = [
  {
    type: "id_front",
    label: "Government ID — Front",
    desc: "Driver's license or passport (front side)",
    icon: IdCard,
  },
  {
    type: "id_back",
    label: "Government ID — Back",
    desc: "Back of your photo ID",
    icon: CreditCard,
  },
  {
    type: "ssn_card",
    label: "Social Security Card",
    desc: "Clear photo of your SSN card, or a W-2 showing the full number",
    icon: FileText,
  },
  {
    type: "proof_of_address",
    label: "Proof of Address",
    desc: "Utility bill, lease, or bank statement — no older than 3 months",
    icon: Home,
  },
];

export default function Documents() {
  const dispatch = useAppDispatch();
  const { documents } = useAppSelector((s) => s.portal);

  useEffect(() => {
    dispatch(fetchDashboard());
  }, [dispatch]);

  const docsByType = documents.reduce<Record<string, any[]>>((acc, d) => {
    (acc[d.doc_type] = acc[d.doc_type] || []).push(d);
    return acc;
  }, {});

  const approvedTypes = DOC_TYPES.filter((dt) =>
    (docsByType[dt.type] || []).some((i) => i.review_status === "approved"),
  );
  const allApproved = approvedTypes.length === DOC_TYPES.length;

  return (
    <div className="space-y-6">
      <ClientPageHeader
        title="My Documents"
        description="Upload these to verify your identity. Our team reviews each document within 1 business day."
      />

      {/* All approved banner */}
      {allApproved && (
        <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
            <PartyPopper className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className="font-semibold text-accent">All documents approved!</p>
            <p className="text-sm text-accent/80 mt-0.5">
              Your file has been moved to the next stage. Our team will begin
              working on your case.
            </p>
          </div>
        </div>
      )}

      {/* Progress indicator */}
      {!allApproved && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Upload progress</span>
            <span className="text-sm text-muted-foreground">
              {approvedTypes.length} / {DOC_TYPES.length} approved
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{
                width: `${(approvedTypes.length / DOC_TYPES.length) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Document cards */}
      <div className="grid sm:grid-cols-2 gap-4">
        {DOC_TYPES.map((dt) => {
          const items = docsByType[dt.type] || [];
          const approved = items.find(
            (i: ClientDocument) => i.review_status === "approved",
          );
          // pending takes precedence over rejected — a re-upload in review supersedes an old rejection
          const pending = items.find(
            (i: ClientDocument) => i.review_status === "pending",
          );
          const rejected = items.find(
            (i: ClientDocument) => i.review_status === "rejected",
          );
          return (
            <DocCard
              key={dt.type}
              type={dt.type}
              label={dt.label}
              desc={dt.desc}
              icon={dt.icon}
              status={
                approved
                  ? "approved"
                  : pending
                    ? "pending"
                    : rejected
                      ? "rejected"
                      : "missing"
              }
              pendingDoc={pending}
              rejection={rejected?.rejection_reason}
            />
          );
        })}
      </div>

      {/* Security note */}
      <div className="rounded-xl border border-primary/10 bg-primary/5 p-4 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Lock className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Your documents are encrypted
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            All uploaded files are secured with AES-256 encryption. Only
            authorised Optimum Credit staff can access them for review purposes.
            Your data is never shared with third parties.
          </p>
        </div>
      </div>
    </div>
  );
}

function DocCard({
  type,
  label,
  desc,
  icon,
  status,
  pendingDoc,
  rejection,
}: {
  type: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  status: "approved" | "pending" | "rejected" | "missing";
  pendingDoc?: ClientDocument;
  rejection?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [preview, setPreview] = useState<{
    name: string;
    size: string;
    dataUrl: string | null;
    isPdf: boolean;
    file: File;
  } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    const size =
      file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

    if (isPdf) {
      setPreview({ name: file.name, size, dataUrl: null, isPdf: true, file });
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setPreview({
          name: file.name,
          size,
          dataUrl: ev.target?.result as string,
          isPdf: false,
          file,
        });
      };
      reader.readAsDataURL(file);
    }
    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  const clearPreview = () => setPreview(null);

  // Open the already-submitted document in a new tab (decrypted via authenticated endpoint)
  const handleViewSubmitted = async () => {
    if (!pendingDoc) return;
    setViewLoading(true);
    try {
      const response = await import("@/lib/api").then((m) =>
        m.default.get(`/portal/documents/${pendingDoc.id}/file`, {
          responseType: "blob",
        }),
      );
      const url = URL.createObjectURL(response.data as Blob);
      const win = window.open(url, "_blank");
      // Revoke the object URL once the new tab has loaded
      if (win)
        win.addEventListener("load", () => URL.revokeObjectURL(url), {
          once: true,
        });
    } catch {
      toast({
        title: "Could not load file",
        description: "Please try again or contact support.",
        variant: "destructive",
      });
    } finally {
      setViewLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setUploading(true);
    try {
      const dt = new DataTransfer();
      dt.items.add(preview.file);
      await dispatch(
        uploadDocuments({ docType: type, files: dt.files }),
      ).unwrap();
      await dispatch(fetchDashboard());
      toast({
        title: "Document uploaded",
        description: `${preview.name} has been submitted for review.`,
      });
      clearPreview();
    } catch {
      toast({
        title: "Upload failed",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const borderClass = {
    approved: "border-accent/30",
    pending: "border-amber-500/20",
    rejected: "border-destructive/30",
    missing: "border-border",
  }[status];

  const statusBadge = {
    approved: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded-full">
        <CheckCircle2 className="w-3 h-3" /> Approved
      </span>
    ),
    pending: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
        <Clock className="w-3 h-3" /> Under Review
      </span>
    ),
    rejected: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/20 px-2 py-0.5 rounded-full">
        <AlertCircle className="w-3 h-3" /> Action Needed
      </span>
    ),
    missing: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded-full">
        Not uploaded
      </span>
    ),
  }[status];

  const Icon = icon;

  return (
    <div
      className={`bg-card rounded-2xl border ${borderClass} p-5 shadow-sm transition-all duration-200`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-sm leading-tight">{label}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </div>
        </div>
        <div className="shrink-0 ml-2">{statusBadge}</div>
      </div>

      {status === "rejected" && rejection && (
        <div className="text-xs text-destructive bg-destructive/5 border border-destructive/10 px-3 py-2.5 rounded-xl mb-3 leading-relaxed">
          <span className="font-semibold block mb-0.5">
            Why it was rejected:
          </span>
          {rejection}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Preview pane */}
      {preview && (
        <div className="mb-3 rounded-xl border border-border overflow-hidden bg-muted/30 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {preview.isPdf ? (
            <div className="flex items-center gap-3 px-4 py-5">
              <div className="w-12 h-14 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center justify-center shrink-0">
                <FileText className="w-6 h-6 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{preview.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {preview.size} · PDF
                </p>
              </div>
            </div>
          ) : (
            <div className="relative">
              <img
                src={preview.dataUrl!}
                alt="Preview"
                className="w-full max-h-52 object-contain bg-black/5 py-2"
              />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/50 to-transparent px-3 py-2">
                <p className="text-white text-xs font-medium truncate">
                  {preview.name}
                </p>
                <p className="text-white/70 text-[10px]">{preview.size}</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 p-3 border-t border-border">
            <button
              onClick={clearPreview}
              disabled={uploading}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={uploading}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {uploading ? "Uploading…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {/* Upload trigger / approved / pending states */}
      {status === "missing" && !preview && (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-xl border border-dashed border-primary/40 text-primary text-sm font-medium hover:bg-primary/5 active:scale-95 transition-all"
        >
          <Upload className="w-4 h-4" />
          Upload file
        </button>
      )}

      {status === "rejected" && !preview && (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-xl border border-dashed border-primary/40 text-primary text-sm font-medium hover:bg-primary/5 active:scale-95 transition-all"
        >
          <Upload className="w-4 h-4" />
          Re-upload document
        </button>
      )}

      {status === "pending" && !preview && (
        <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Clock className="w-4 h-4 text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700 font-medium truncate">
              {pendingDoc?.file_name ?? "Submitted file"}
            </p>
          </div>
          {pendingDoc && (
            <button
              onClick={handleViewSubmitted}
              disabled={viewLoading}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 hover:text-amber-700 shrink-0 disabled:opacity-60"
            >
              {viewLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              View
            </button>
          )}
        </div>
      )}

      {status === "approved" && (
        <div className="flex items-center justify-center gap-1.5 h-10 text-sm text-accent font-medium">
          <CheckCircle2 className="w-4 h-4" /> Document verified
        </div>
      )}
    </div>
  );
}

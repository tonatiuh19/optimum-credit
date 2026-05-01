import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Upload,
  ShieldCheck,
  Lock,
  PartyPopper,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchDashboard, uploadDocuments } from "@/store/slices/portalSlice";
import type { DocType } from "@shared/api";

const DOC_TYPES: {
  type: DocType;
  label: string;
  desc: string;
  icon: string;
}[] = [
  {
    type: "id_front",
    label: "Government ID — Front",
    desc: "Driver's license or passport (front side)",
    icon: "🪪",
  },
  {
    type: "id_back",
    label: "Government ID — Back",
    desc: "Back of your photo ID",
    icon: "🪪",
  },
  {
    type: "ssn_card",
    label: "Social Security Card",
    desc: "Clear photo of your SSN card, or a W-2 showing the full number",
    icon: "📄",
  },
  {
    type: "proof_of_address",
    label: "Proof of Address",
    desc: "Utility bill, lease, or bank statement — no older than 3 months",
    icon: "🏠",
  },
];

export default function Documents() {
  const dispatch = useAppDispatch();
  const { documents } = useAppSelector((s) => s.portal);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleUpload = async (type: DocType, files: FileList | null) => {
    if (!files || !files.length) return;
    setBusyType(type);
    setError(null);
    const result = await dispatch(uploadDocuments({ docType: type, files }));
    if (uploadDocuments.rejected.match(result)) {
      setError("Upload failed. Please try again.");
    } else {
      await dispatch(fetchDashboard());
    }
    setBusyType(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">My Documents</h1>
        <p className="text-muted-foreground mt-1">
          Upload these to verify your identity. Our team reviews each document
          within 1 business day.
        </p>
      </div>

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

      {error && (
        <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Document cards */}
      <div className="grid sm:grid-cols-2 gap-4">
        {DOC_TYPES.map((dt) => {
          const items = docsByType[dt.type] || [];
          const approved = items.find((i) => i.review_status === "approved");
          const pending = items.find((i) => i.review_status === "pending");
          const rejected = items.find((i) => i.review_status === "rejected");
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
                  : rejected
                    ? "rejected"
                    : pending
                      ? "pending"
                      : "missing"
              }
              rejection={rejected?.rejection_reason}
              busy={busyType === dt.type}
              onUpload={(files) => handleUpload(dt.type, files)}
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
  rejection,
  busy,
  onUpload,
}: {
  type: string;
  label: string;
  desc: string;
  icon: string;
  status: "approved" | "pending" | "rejected" | "missing";
  rejection?: string;
  busy: boolean;
  onUpload: (files: FileList) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div
      className={`bg-card rounded-2xl border ${borderClass} p-5 shadow-sm transition-colors`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-xl shrink-0">
            {icon}
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
        multiple
        className="hidden"
        onChange={(e) => e.target.files && onUpload(e.target.files)}
      />

      {status !== "approved" && (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-xl border border-dashed border-primary/40 text-primary text-sm font-medium hover:bg-primary/5 active:scale-95 transition-all disabled:opacity-50"
        >
          {busy ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              Uploading&hellip;
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              {status === "rejected" ? "Re-upload document" : "Upload file"}
            </>
          )}
        </button>
      )}

      {status === "approved" && (
        <div className="flex items-center justify-center gap-1.5 h-10 text-sm text-accent font-medium">
          <CheckCircle2 className="w-4 h-4" /> Document verified
        </div>
      )}
    </div>
  );
}

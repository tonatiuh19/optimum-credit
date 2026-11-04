import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import { Eye, FileText, Loader2, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { FUNDING_REQUIRED_DOC_SLOTS } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addFundingNote,
  fetchFundingUnderwriting,
  openFundingDocument,
  requestFundingDocument,
  revealFundingSecret,
  uploadFundingDocumentAdmin,
} from "@/store/slices/fundingSlice";
import { cn } from "@/lib/utils";

const reasonSchema = Yup.object({ reason: Yup.string().trim().min(3, "short").max(500).required("required") });
const noteSchema = Yup.object({ text: Yup.string().trim().min(1).max(2000).required("required") });

/**
 * Underwriting tools on a funding application (staff + `underwriter` role):
 * view each document (logged), request a new one (client gets the upload
 * link), upload on the client's behalf, masked SSN/EIN with a logged reveal,
 * and underwriting notes.
 */
export function FundingUnderwritingPanel({ applicationId, locked }: { applicationId: number; locked?: boolean }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const uw = useAppSelector((s) => (s.funding.underwriting?.applicationId === applicationId ? s.funding.underwriting : null));
  const busy = useAppSelector((s) => s.funding.underwritingBusy);
  const [requesting, setRequesting] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadSlot, setUploadSlot] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchFundingUnderwriting(applicationId));
  }, [applicationId, dispatch]);

  const reasonForm = useFormik({
    initialValues: { reason: "" },
    validationSchema: reasonSchema,
    onSubmit: async (v, h) => {
      if (requesting == null) return;
      const r = await dispatch(requestFundingDocument({ id: applicationId, docId: requesting, reason: v.reason.trim() }));
      if (requestFundingDocument.rejected.match(r)) {
        toast({ title: t("adminFunding.uw.requestError"), description: String(r.payload || ""), variant: "destructive" });
        return;
      }
      toast({ title: t("adminFunding.uw.requested") });
      setRequesting(null);
      h.resetForm();
    },
  });

  const noteForm = useFormik({
    initialValues: { text: "" },
    validationSchema: noteSchema,
    onSubmit: async (v, h) => {
      const r = await dispatch(addFundingNote({ id: applicationId, text: v.text.trim() }));
      if (addFundingNote.rejected.match(r)) {
        toast({ title: t("adminFunding.uw.noteError"), variant: "destructive" });
        return;
      }
      h.resetForm();
    },
  });

  const view = async (docId: number, fileName: string) => {
    const r = await dispatch(openFundingDocument({ id: applicationId, docId, fileName }));
    if (openFundingDocument.fulfilled.match(r)) {
      const url = URL.createObjectURL(r.payload.blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      toast({ title: t("adminFunding.uw.openError"), variant: "destructive" });
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !uploadSlot) return;
    const r = await dispatch(uploadFundingDocumentAdmin({ id: applicationId, docType: uploadSlot, file }));
    if (uploadFundingDocumentAdmin.rejected.match(r)) {
      toast({ title: t("adminFunding.uw.uploadError"), description: String(r.payload || ""), variant: "destructive" });
    } else {
      toast({ title: t("adminFunding.uw.uploaded") });
    }
    setUploadSlot(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const reveal = (field: "ssn" | "ein") => void dispatch(revealFundingSecret({ id: applicationId, field }));

  if (!uw) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("adminFunding.uw.loading")}
      </p>
    );
  }

  const bySlot = new Map(uw.documents.map((d) => [d.doc_type, d]));

  return (
    <div className="space-y-5" data-testid="funding-underwriting">
      {/* SSN / EIN */}
      <div className="rounded-xl border border-border p-3 space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5" /> {t("adminFunding.uw.identifiers")}
        </p>
        {(["ssn", "ein"] as const).map((f) => {
          const masked = f === "ssn" ? uw.ssnMasked : uw.einMasked;
          const full = uw.revealed[f];
          return (
            <div key={f} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground uppercase text-xs w-10">{f}</span>
              <span className="font-mono flex-1" data-testid={`funding-${f}`}>
                {full ?? masked ?? "—"}
              </span>
              {masked && !full && (
                <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => reveal(f)}>
                  <Eye className="w-3.5 h-3.5" /> {t("adminFunding.uw.reveal")}
                </Button>
              )}
            </div>
          );
        })}
        <p className="text-[11px] text-muted-foreground">{t("adminFunding.uw.revealLogged")}</p>
      </div>

      {/* Documents */}
      <div className="space-y-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
          data-testid="funding-upload-input"
        />
        {FUNDING_REQUIRED_DOC_SLOTS.map((slot) => {
          const doc = bySlot.get(slot);
          const label = t(`adminFunding.docs.${slot.replace("funding_", "")}`, { defaultValue: slot.replace("funding_", "").replace(/_/g, " ") });
          return (
            <div key={slot} className="rounded-xl border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <FileText className={cn("w-4 h-4 shrink-0", doc ? "text-primary" : "text-muted-foreground")} />
                <span className="text-sm font-medium text-foreground">{label}</span>
                {doc && (
                  <span
                    className={cn(
                      "text-[11px] px-2 py-0.5 rounded-full",
                      doc.review_status === "rejected"
                        ? "bg-destructive/10 text-destructive"
                        : doc.review_status === "approved"
                          ? "bg-accent/10 text-accent"
                          : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {t(`adminFunding.uw.status_${doc.review_status}`)}
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  {doc && (
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => void view(doc.id, doc.file_name)} data-testid={`funding-view-${slot}`}>
                      <Eye className="w-3.5 h-3.5" /> {t("adminFunding.uw.view")}
                    </Button>
                  )}
                  {doc && !locked && (
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => { setRequesting(doc.id); reasonForm.resetForm(); }}>
                      <RotateCcw className="w-3.5 h-3.5" /> {t("adminFunding.uw.requestNew")}
                    </Button>
                  )}
                  {!locked && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      disabled={busy}
                      onClick={() => { setUploadSlot(slot); fileRef.current?.click(); }}
                    >
                      {busy && uploadSlot === slot ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {doc ? t("adminFunding.uw.replace") : t("adminFunding.uw.upload")}
                    </Button>
                  )}
                </div>
              </div>
              {doc?.file_name && <p className="text-[11px] text-muted-foreground truncate">{doc.file_name}</p>}
              {doc?.review_status === "rejected" && doc.rejection_reason && (
                <p className="text-xs text-destructive">{t("adminFunding.uw.requestedReason", { reason: doc.rejection_reason })}</p>
              )}
              {requesting === doc?.id && (
                <form onSubmit={reasonForm.handleSubmit} className="flex flex-col sm:flex-row gap-2 animate-in fade-in">
                  <Input
                    autoFocus
                    placeholder={t("adminFunding.uw.reasonPlaceholder")}
                    {...reasonForm.getFieldProps("reason")}
                    className="h-8 text-xs"
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" className="h-8 text-xs" disabled={busy}>
                      {t("adminFunding.uw.sendRequest")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setRequesting(null)}>
                      {t("adminFunding.uw.cancel")}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
        <p className="text-[11px] text-muted-foreground">{t("adminFunding.uw.requestHint")}</p>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{t("adminFunding.uw.notes")}</h4>
        {uw.notes ? (
          <pre className="whitespace-pre-wrap text-xs text-foreground bg-secondary/40 rounded-lg p-3 max-h-48 overflow-y-auto font-sans">{uw.notes}</pre>
        ) : (
          <p className="text-xs text-muted-foreground">{t("adminFunding.uw.noNotes")}</p>
        )}
        <form onSubmit={noteForm.handleSubmit} className="space-y-2">
          <Textarea rows={2} placeholder={t("adminFunding.uw.notePlaceholder")} {...noteForm.getFieldProps("text")} className="text-sm" />
          <Button type="submit" size="sm" disabled={busy || !noteForm.values.text.trim()}>
            {t("adminFunding.uw.addNote")}
          </Button>
        </form>
      </div>
    </div>
  );
}

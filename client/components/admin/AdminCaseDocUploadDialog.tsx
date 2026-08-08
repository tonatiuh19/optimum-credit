import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloudUpload, FileText, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchCaseDocuments,
  uploadCaseDocuments,
} from "@/store/slices/adminSlice";
import { useToast } from "@/hooks/use-toast";
import FieldHint from "@/components/admin/FieldHint";
import { logger } from "@/utils/logger";

const DOC_TYPES = [
  "id_front",
  "id_back",
  "ssn_card",
  "proof_of_address",
  "other",
] as const;

interface AdminCaseDocUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId?: number | null;
  /** Prefill doc type when opening from a specific upload task */
  initialDocType?: string | null;
  onSuccess?: (caseId: number) => void;
}

export default function AdminCaseDocUploadDialog({
  open,
  onOpenChange,
  caseId: fixedCaseId,
  initialDocType = null,
  onSuccess,
}: AdminCaseDocUploadDialogProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { caseDocumentsUploading } = useAppSelector((s) => s.admin);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [caseIdInput, setCaseIdInput] = useState("");
  const [docType, setDocType] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);

  const resolvedCaseId = fixedCaseId ?? (caseIdInput ? Number(caseIdInput) : 0);
  const showCaseIdField = fixedCaseId == null;

  useEffect(() => {
    if (!open) return;
    const prefill =
      initialDocType &&
      (DOC_TYPES as readonly string[]).includes(initialDocType)
        ? initialDocType
        : "";
    setDocType(prefill);
    setFiles([]);
    if (fixedCaseId != null) {
      setCaseIdInput(String(fixedCaseId));
    } else {
      setCaseIdInput("");
    }
  }, [open, fixedCaseId, initialDocType]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files;
    if (!picked?.length) return;
    setFiles((prev) => [...prev, ...Array.from(picked)]);
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!resolvedCaseId || Number.isNaN(resolvedCaseId)) {
      toast({
        title: t("adminHelpers.uploadFailed"),
        description: t("adminHelpers.selectCaseHint"),
        variant: "destructive",
      });
      return;
    }
    if (!docType) {
      toast({
        title: t("adminHelpers.uploadFailed"),
        description: t("adminHelpers.selectDocType"),
        variant: "destructive",
      });
      return;
    }
    if (files.length === 0) {
      toast({
        title: t("adminHelpers.uploadFailed"),
        description: t("adminHelpers.selectFiles"),
        variant: "destructive",
      });
      return;
    }

    try {
      await dispatch(
        uploadCaseDocuments({
          caseId: resolvedCaseId,
          doc_type: docType,
          files,
        }),
      ).unwrap();
      await dispatch(fetchCaseDocuments(resolvedCaseId));
      toast({
        title: t("adminHelpers.uploadSuccess"),
        description: t("adminHelpers.uploadSuccessHint", {
          count: files.length,
        }),
      });
      logger.info("[AdminCaseDocUpload] uploaded", {
        caseId: resolvedCaseId,
        docType,
        count: files.length,
      });
      onSuccess?.(resolvedCaseId);
      onOpenChange(false);
    } catch (err) {
      logger.error("[AdminCaseDocUpload] failed", err);
      toast({
        title: t("adminHelpers.uploadFailed"),
        description: t("adminHelpers.uploadFailedHint"),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[calc(100%-2rem)] sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudUpload className="h-5 w-5 text-primary shrink-0" />
            {t("adminHelpers.uploadCaseDocsTitle")}
          </DialogTitle>
          <DialogDescription>{t("adminHelpers.uploadCaseDocsHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {showCaseIdField && (
            <div className="space-y-1.5">
              <Label htmlFor="case-doc-case-id">{t("adminHelpers.selectCase")}</Label>
              <Input
                id="case-doc-case-id"
                type="number"
                min={1}
                inputMode="numeric"
                value={caseIdInput}
                onChange={(e) => setCaseIdInput(e.target.value)}
                placeholder="123"
              />
              <FieldHint>{t("adminHelpers.selectCaseHint")}</FieldHint>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="case-doc-type">{t("adminHelpers.docType")}</Label>
            <select
              id="case-doc-type"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full h-10 pl-3 pr-8 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer"
            >
              <option value="">{t("adminHelpers.selectDocType")}</option>
              {DOC_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`adminHelpers.docTypes.${type}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>{t("adminHelpers.selectFiles")}</Label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center gap-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <CloudUpload className="h-4 w-4" />
              {t("adminHelpers.selectFiles")}
            </Button>
            {files.length > 0 && (
              <ul className="space-y-1.5 mt-2">
                {files.map((file, i) => (
                  <li
                    key={`${file.name}-${i}`}
                    className="flex items-center gap-2 text-xs bg-muted/50 border border-border rounded-lg px-2.5 py-2"
                  >
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      aria-label={t("adminHelpers.removeFile")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={caseDocumentsUploading}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={caseDocumentsUploading}
            className="gap-2"
          >
            {caseDocumentsUploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("adminHelpers.uploading")}
              </>
            ) : (
              <>
                <CloudUpload className="h-4 w-4" />
                {t("adminHelpers.uploadCaseDocs")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

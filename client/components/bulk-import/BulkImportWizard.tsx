import { useCallback, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Upload,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  closeBulkImportWizard,
  commitBulkImport,
  downloadBulkImportTemplate,
  setBulkImportCommitOptions,
  setBulkImportSearchQuery,
  setBulkImportStep,
  setBulkImportTableFilter,
  validateBulkImport,
} from "@/store/slices/bulkImportSlice";
import { fetchAdminClients } from "@/store/slices/adminSlice";
import BulkImportSummaryCards from "@/components/bulk-import/BulkImportSummaryCards";
import BulkImportPreviewTable from "@/components/bulk-import/BulkImportPreviewTable";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  BULK_IMPORT_ACK_THRESHOLD,
  buildCommitResultsCsv,
  buildPreviewReportCsv,
  downloadTextFile,
} from "@shared/bulkImport";

const STEP_LABELS = [
  "Get started",
  "Upload",
  "Review",
  "Confirm",
  "Results",
];

export default function BulkImportWizard() {
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ackChecked, setAckChecked] = useState(false);

  const {
    wizardOpen,
    wizardStep,
    entity,
    preview,
    commitResult,
    commitOptions,
    validating,
    committing,
    downloadingTemplate,
    error,
    tableFilter,
    searchQuery,
  } = useAppSelector((s) => s.bulkImport);

  const isActive = wizardOpen && entity === "clients";

  const rowCounts = useMemo(() => {
    const rows = preview?.previewRows ?? [];
    return {
      all: rows.length,
      ready: rows.filter((r) => r.status === "will_create").length,
      skipped: rows.filter((r) => r.status === "skipped").length,
      error: rows.filter((r) => r.status === "error").length,
    };
  }, [preview?.previewRows]);

  const needsAck =
    (preview?.willCreateCount ?? 0) > BULK_IMPORT_ACK_THRESHOLD;
  const canContinueFromReview = (preview?.willCreateCount ?? 0) > 0;
  const canConfirm =
    canContinueFromReview && (!needsAck || ackChecked) && !committing;

  const handleClose = () => {
    dispatch(closeBulkImportWizard());
    setSelectedFile(null);
    setAckChecked(false);
  };

  const processFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith(".csv")) return;
      setSelectedFile(file);
      dispatch(validateBulkImport({ file, entity: "clients" }));
    },
    [dispatch],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleDownloadErrorReport = () => {
    if (!preview?.previewRows?.length) return;
    const csv = buildPreviewReportCsv(preview.previewRows);
    downloadTextFile(
      `import-errors-${preview.fileName ?? "report"}.csv`,
      csv,
    );
  };

  const handleDownloadResults = () => {
    if (!commitResult?.results?.length) return;
    const csv = buildCommitResultsCsv(commitResult.results);
    downloadTextFile(
      `import-results-${preview?.fileName ?? "report"}.csv`,
      csv,
    );
  };

  const handleCommit = async () => {
    if (!preview?.jobId) return;
    try {
      await dispatch(
        commitBulkImport({
          jobId: preview.jobId,
          options: commitOptions,
        }),
      ).unwrap();
      dispatch(fetchAdminClients({}));
    } catch {
      // error is stored in Redux `error` and shown in the banner
    }
  };

  return (
    <Dialog open={isActive} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className={cn(
          "flex max-h-[95vh] flex-col gap-0 overflow-hidden p-0",
          "w-[min(100vw-1rem,48rem)] sm:max-w-3xl",
          "max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:w-full max-md:rounded-none",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 sm:px-6">
          <DialogTitle>Import clients from CSV</DialogTitle>
          <DialogDescription>
            Upload a spreadsheet of clients, review matches, then confirm.
          </DialogDescription>
          <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
            {STEP_LABELS.map((label, i) => (
              <div
                key={label}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                  wizardStep === i
                    ? "bg-primary text-primary-foreground"
                    : wizardStep > i
                      ? "bg-accent/15 text-accent"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {i + 1}. {label}
              </div>
            ))}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {wizardStep === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
                <div className="flex items-center gap-2 font-semibold">
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                  Start with the template
                </div>
                <p className="text-sm text-muted-foreground">
                  Download the Optimum Credit CSV template, fill in your clients,
                  then upload it on the next step. Required columns:{" "}
                  <code className="text-xs">first_name</code>,{" "}
                  <code className="text-xs">last_name</code>,{" "}
                  <code className="text-xs">email</code>.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={downloadingTemplate}
                  onClick={() =>
                    dispatch(downloadBulkImportTemplate("clients"))
                  }
                >
                  {downloadingTemplate ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download template
                </Button>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
                <li>Existing emails are skipped (not overwritten).</li>
                <li>Max 500 rows per file · 5 MB limit.</li>
                <li>Optional: package_slug, status, preferred_language, address.</li>
              </ul>
            </motion.div>
          )}

          {wizardStep === 1 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={cn(
                  "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 transition-colors",
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30",
                )}
              >
                {validating ? (
                  <>
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-sm font-medium">Validating CSV…</p>
                  </>
                ) : (
                  <>
                    <Upload className="h-10 w-10 text-muted-foreground" />
                    <p className="text-sm font-medium text-center">
                      Drag & drop your .csv here
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedFile
                        ? selectedFile.name
                        : "or browse from your computer"}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose file
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) processFile(f);
                      }}
                    />
                  </>
                )}
              </div>
            </motion.div>
          )}

          {wizardStep === 2 && preview && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <BulkImportSummaryCards
                willCreate={preview.willCreateCount}
                skipped={preview.skippedCount}
                errors={preview.errorCount}
                total={preview.rowCount}
              />
              {(preview.errorCount > 0 || preview.skippedCount > 0) && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Skipped and error rows will not be imported.
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleDownloadErrorReport}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    Download report
                  </Button>
                </div>
              )}
              <BulkImportPreviewTable
                rows={preview.previewRows}
                filter={tableFilter}
                search={searchQuery}
                counts={rowCounts}
                onFilterChange={(f) => dispatch(setBulkImportTableFilter(f))}
                onSearchChange={(q) => dispatch(setBulkImportSearchQuery(q))}
              />
            </motion.div>
          )}

          {wizardStep === 3 && preview && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-5"
            >
              <div className="rounded-xl border border-border bg-card p-4 space-y-1">
                <p className="font-semibold">
                  Ready to create {preview.willCreateCount} client
                  {preview.willCreateCount === 1 ? "" : "s"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {preview.skippedCount} skipped · {preview.errorCount} errors
                  (not imported)
                </p>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
                <div>
                  <Label htmlFor="welcome-emails" className="font-medium">
                    Send welcome emails
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Portal invite with magic link for each new client
                  </p>
                </div>
                <Switch
                  id="welcome-emails"
                  checked={!!commitOptions.send_welcome_emails}
                  onCheckedChange={(v) =>
                    dispatch(
                      setBulkImportCommitOptions({ send_welcome_emails: v }),
                    )
                  }
                />
              </div>
              {needsAck && (
                <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm cursor-pointer">
                  <Checkbox
                    checked={ackChecked}
                    onCheckedChange={(v) => setAckChecked(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    I confirm importing {preview.willCreateCount} clients into
                    Optimum Credit.
                  </span>
                </label>
              )}
            </motion.div>
          )}

          {wizardStep === 4 && commitResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4 text-center py-4"
            >
              <CheckCircle2 className="mx-auto h-12 w-12 text-accent" />
              <h3 className="text-lg font-semibold">Import complete</h3>
              <p className="text-sm text-muted-foreground">
                Created {commitResult.created_count ?? 0} · Skipped{" "}
                {commitResult.skipped_count ?? 0} · Errors{" "}
                {commitResult.error_count ?? 0}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadResults}
              >
                <Download className="mr-2 h-4 w-4" />
                Download results CSV
              </Button>
            </motion.div>
          )}
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 border-t border-border px-5 py-3 sm:px-6">
          <Button
            type="button"
            variant="ghost"
            disabled={wizardStep === 0 || wizardStep === 4 || committing}
            onClick={() =>
              dispatch(
                setBulkImportStep(
                  Math.max(0, wizardStep - 1) as 0 | 1 | 2 | 3 | 4,
                ),
              )
            }
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
          <div className="flex gap-2">
            {wizardStep < 4 && (
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
            )}
            {wizardStep === 0 && (
              <Button
                type="button"
                onClick={() => dispatch(setBulkImportStep(1))}
              >
                Continue
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
            {wizardStep === 2 && (
              <Button
                type="button"
                disabled={!canContinueFromReview}
                onClick={() => dispatch(setBulkImportStep(3))}
              >
                Continue
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
            {wizardStep === 3 && (
              <Button
                type="button"
                disabled={!canConfirm}
                onClick={() => void handleCommit()}
              >
                {committing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Confirm import
              </Button>
            )}
            {wizardStep === 4 && (
              <Button type="button" onClick={handleClose}>
                Done
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

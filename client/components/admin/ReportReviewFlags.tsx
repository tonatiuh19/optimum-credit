import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, NotebookPen } from "lucide-react";

/**
 * Progress Report v2 validation flags for the preview step: blocking flags
 * (parse failure, same pull, unverified movement…) need language-owner
 * approval to publish; internal notes go to the client file.
 */
export function ReportReviewFlags({ flags }: { flags: Array<{ code: string; message: string }> }) {
  const { t } = useTranslation();
  const blocking = flags.filter((f) => f.code !== "internal_note");
  const internal = flags.filter((f) => f.code === "internal_note");
  if (!flags.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-accent animate-in fade-in" data-testid="report-flags-clean">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t("reportWizard.reviewFlags.none")}
      </p>
    );
  }
  return (
    <div className="space-y-2 animate-in fade-in" data-testid="report-review-flags">
      {blocking.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 space-y-1.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" />
            {t("reportWizard.reviewFlags.title")}
          </p>
          <ul className="list-disc pl-5 text-xs text-foreground space-y-0.5">
            {blocking.map((f, i) => (
              <li key={`${f.code}-${i}`}>{f.message}</li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">{t("reportWizard.reviewFlags.approver")}</p>
        </div>
      )}
      {internal.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/40 p-3 space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <NotebookPen className="h-3.5 w-3.5" />
            {t("reportWizard.reviewFlags.internal")}
          </p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
            {internal.map((f, i) => (
              <li key={`n-${i}`}>{f.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  Upload,
  FileText,
  X,
  Loader2,
  AlertTriangle,
  Languages,
} from "lucide-react";
import ClientGoalCombobox from "@/components/ClientGoalCombobox";
import CreditAnalysisResultPanel from "@/components/credit/CreditAnalysisResultPanel";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminCreditAnalysis,
  clearPortalCreditAnalysis,
  fetchAdminClientCreditAnalysis,
  fetchPortalCreditAnalysis,
  submitAdminClientCreditAnalysis,
  submitPortalCreditAnalysis,
} from "@/store/slices/creditAnalysisSlice";
import type { CreditAnalysisResult } from "@shared/api";

import {
  CREDIT_ANALYSIS_MAX_FILE_BYTES,
  CREDIT_ANALYSIS_MAX_FILE_MB,
} from "@/lib/creditAnalysisUpload";

export interface ProspectCreditAnalysisSectionProps {
  variant: "admin" | "portal";
  clientId?: number;
  /** When false, show stored analysis only (no upload form). */
  uploadEnabled?: boolean;
  prefilled?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    preferred_language?: string | null;
  };
}

export default function ProspectCreditAnalysisSection({
  variant,
  clientId,
  uploadEnabled = true,
  prefilled,
}: ProspectCreditAnalysisSectionProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    adminResult,
    adminLoading,
    adminSubmitting,
    adminError,
    portalResult,
    portalLoading,
    portalSubmitting,
    portalError,
  } = useAppSelector((s) => s.creditAnalysis);

  const loading = variant === "admin" ? adminLoading : portalLoading;
  const submitting = variant === "admin" ? adminSubmitting : portalSubmitting;
  const error = variant === "admin" ? adminError : portalError;
  const result: CreditAnalysisResult | null =
    variant === "admin" ? adminResult : portalResult;

  const [clientGoal, setClientGoal] = useState("");
  const [notes, setNotes] = useState("");
  const [textLanguage, setTextLanguage] = useState<"en" | "es">(
    prefilled?.preferred_language === "es" ? "es" : "en",
  );
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(true);

  const displayName = useMemo(() => {
    const fn = prefilled?.first_name?.trim() || "";
    const ln = prefilled?.last_name?.trim() || "";
    return [fn, ln].filter(Boolean).join(" ");
  }, [prefilled]);

  useEffect(() => {
    if (variant === "admin" && clientId) {
      dispatch(clearAdminCreditAnalysis());
      dispatch(fetchAdminClientCreditAnalysis(clientId));
    } else if (variant === "portal") {
      dispatch(clearPortalCreditAnalysis());
      dispatch(fetchPortalCreditAnalysis());
    }
  }, [variant, clientId, dispatch]);

  useEffect(() => {
    if (result?.id) setShowForm(false);
  }, [result?.id]);

  const handleFileChange = (f: File | null) => {
    setFileError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (f.type !== "application/pdf") {
      setFileError(t("prospectAnalysis.errPdfOnly"));
      setFile(null);
      return;
    }
    if (f.size > CREDIT_ANALYSIS_MAX_FILE_BYTES) {
      setFileError(t("prospectAnalysis.errFileSize", { mb: CREDIT_ANALYSIS_MAX_FILE_MB }));
      setFile(null);
      return;
    }
    setFile(f);
  };

  const handleStartOver = () => {
    if (variant === "admin") dispatch(clearAdminCreditAnalysis());
    else dispatch(clearPortalCreditAnalysis());
    setShowForm(true);
    setFile(null);
    setFileError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setFileError(t("creditAnalysis.errFile"));
      return;
    }
    const action =
      variant === "admin" && clientId
        ? await dispatch(
            submitAdminClientCreditAnalysis({
              clientId,
              report_file: file,
              client_goal: clientGoal || undefined,
              text_language: textLanguage,
              notes: notes || undefined,
              email_opt_in: emailOptIn,
            }),
          )
        : await dispatch(
            submitPortalCreditAnalysis({
              report_file: file,
              client_goal: clientGoal || undefined,
              text_language: textLanguage,
              notes: notes || undefined,
              email_opt_in: emailOptIn,
            }),
          );

    if (
      submitAdminClientCreditAnalysis.fulfilled.match(action) ||
      submitPortalCreditAnalysis.fulfilled.match(action)
    ) {
      setShowForm(false);
    }
  };

  if (loading && !result) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        {t("prospectAnalysis.loading")}
      </div>
    );
  }

  const canEmail =
    Boolean(prefilled?.email?.trim()) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prefilled!.email!.trim());

  if (!uploadEnabled) {
    if (loading && !result) {
      return (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          {t("prospectAnalysis.loading")}
        </div>
      );
    }
    if (!result) return null;
    return (
      <CreditAnalysisResultPanel
        result={result}
        showRegisterCta={false}
        clientName={displayName || undefined}
      />
    );
  }

  if (result && !showForm) {
    return (
      <CreditAnalysisResultPanel
        result={result}
        onStartOver={handleStartOver}
        showRegisterCta={false}
        clientName={displayName || undefined}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <Languages className="w-3.5 h-3.5" />
            {t("creditAnalysis.language")}
          </label>
          <select
            value={textLanguage}
            onChange={(e) =>
              setTextLanguage(e.target.value === "es" ? "es" : "en")
            }
            className="w-full h-11 px-3.5 rounded-lg border border-input bg-background text-sm font-medium"
          >
            <option value="en">{t("creditAnalysis.reportLanguageEn")}</option>
            <option value="es">{t("creditAnalysis.reportLanguageEs")}</option>
          </select>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("prospectAnalysis.languageHint", {
              lang:
                prefilled?.preferred_language === "es"
                  ? t("creditAnalysis.reportLanguageEs")
                  : t("creditAnalysis.reportLanguageEn"),
            })}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t("prospectAnalysis.heading")}
            </p>
            <p className="text-sm text-muted-foreground">
              {variant === "admin"
                ? t("prospectAnalysis.adminHint")
                : t("prospectAnalysis.portalHint")}
            </p>
            {displayName && (
              <p className="text-xs text-muted-foreground">
                {displayName}
                {prefilled?.email ? ` · ${prefilled.email}` : ""}
              </p>
            )}
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("creditAnalysis.goal")}
          </label>
          <ClientGoalCombobox
            value={clientGoal}
            onChange={setClientGoal}
            placeholder={t("creditAnalysis.goalPlaceholder")}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("creditAnalysis.notes")}
            <span className="font-normal normal-case text-muted-foreground/70">
              {" "}
              {t("creditAnalysis.notesOptional")}
            </span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3.5 py-2.5 rounded-lg border border-input bg-background text-sm resize-y min-h-[72px]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("creditAnalysis.uploadLabel")}
          </label>
          {file ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3">
              <FileText className="w-5 h-5 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleFileChange(null)}
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
                aria-label={t("creditAnalysis.uploadRemove")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label
              className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 px-4 py-8 cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
            >
              <Upload className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {t("creditAnalysis.uploadChoose")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("prospectAnalysis.pdfOnlyHint", { mb: CREDIT_ANALYSIS_MAX_FILE_MB })}
              </span>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) =>
                  handleFileChange(e.target.files?.[0] ?? null)
                }
              />
            </label>
          )}
          {fileError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {fileError}
            </p>
          )}
        </div>

        <label
          className={`flex items-start gap-3 rounded-lg border border-border px-3 py-3 ${
            canEmail ? "cursor-pointer" : "opacity-60"
          }`}
        >
          <Checkbox
            checked={emailOptIn}
            disabled={!canEmail}
            onCheckedChange={(v) => setEmailOptIn(v === true)}
            className="mt-0.5"
          />
          <span className="text-sm text-foreground leading-snug">
            {variant === "portal"
              ? t("prospectAnalysis.emailOptInSelf")
              : t("prospectAnalysis.emailOptIn")}
            {!canEmail && (
              <span className="block text-xs text-muted-foreground mt-1">
                {t("prospectAnalysis.emailOptInNoEmail")}
              </span>
            )}
          </span>
        </label>

        {error && (
          <p className="text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !file}
          className="btn-primary w-full h-12 flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("creditAnalysis.submitting")}
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              {t("prospectAnalysis.runAnalysis")}
            </>
          )}
        </button>
      </form>
    </div>
  );
}

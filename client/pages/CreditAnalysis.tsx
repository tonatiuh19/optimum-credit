import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  Sparkles,
  Upload,
  FileText,
  X,
  Loader2,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Mail,
  RefreshCw,
  User,
  Briefcase,
} from "lucide-react";
import PageMeta from "@/components/PageMeta";
import ClientGoalCombobox from "@/components/ClientGoalCombobox";
import CreditAnalysisResultPanel from "@/components/credit/CreditAnalysisResultPanel";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  submitCreditAnalysis,
  clearCreditAnalysisResult,
} from "@/store/slices/creditAnalysisSlice";
import type { CreditAnalysisMode } from "@shared/api";
import { Checkbox } from "@/components/ui/checkbox";
import { captureAffiliateRef, getAffiliateRef } from "@/lib/affiliateAttribution";
import {
  CREDIT_ANALYSIS_MAX_FILE_BYTES,
  CREDIT_ANALYSIS_MAX_FILE_MB,
} from "@/lib/creditAnalysisUpload";

// ─── Form values ──────────────────────────────────────────────────────────

interface FormValues {
  mode: CreditAnalysisMode;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  client_goal: string;
  text_language: "en" | "es";
  notes: string;
  agent_phone: string;
  rep_name: string;
  email_opt_in: boolean;
  report_file: File | null;
}

// ─── Form field wrapper ───────────────────────────────────────────────────

function Field({
  label,
  optional,
  error,
  children,
}: {
  label: string;
  optional?: string;
  error?: string | false;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">
        {label}{" "}
        {optional && (
          <span className="text-muted-foreground/70 font-normal normal-case">{optional}</span>
        )}
      </label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

const inputCls =
  "w-full h-11 px-3.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow";

// ─── Main page ────────────────────────────────────────────────────────────

export default function CreditAnalysis() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { submitting, error, result } = useAppSelector((s) => s.creditAnalysis);
  const [fileError, setFileError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) captureAffiliateRef(ref);
  }, [searchParams]);

  const schema = useMemo(
    () =>
      Yup.object({
        mode: Yup.string().oneOf(["client", "agent"]).required(),
        first_name: Yup.string().trim().required(t("creditAnalysis.errRequired")),
        last_name: Yup.string().trim().required(t("creditAnalysis.errRequired")),
        email: Yup.string()
          .email(t("creditAnalysis.errEmail"))
          .required(t("creditAnalysis.errRequired")),
        phone: Yup.string().trim().required(t("creditAnalysis.errRequired")),
        client_goal: Yup.string().trim(),
        text_language: Yup.string().oneOf(["en", "es"]).required(),
        notes: Yup.string().trim(),
        agent_phone: Yup.string().when("mode", {
          is: "agent",
          then: (s) => s.trim().required(t("creditAnalysis.errRequired")),
        }),
        rep_name: Yup.string().when("mode", {
          is: "agent",
          then: (s) => s.trim().required(t("creditAnalysis.errRequired")),
        }),
        email_opt_in: Yup.boolean(),
        report_file: Yup.mixed().required(t("creditAnalysis.errFile")),
      }),
    [t],
  );

  const form = useFormik<FormValues>({
    initialValues: {
      mode: "client",
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      client_goal: "",
      text_language: i18n.language?.startsWith("es") ? "es" : "en",
      notes: "",
      agent_phone: "",
      rep_name: "",
      email_opt_in: true,
      report_file: null,
    },
    validationSchema: schema,
    onSubmit: async (values) => {
      if (!values.report_file) {
        setFileError(t("creditAnalysis.errFile"));
        return;
      }
      await dispatch(
        submitCreditAnalysis({
          mode: values.mode,
          first_name: values.first_name,
          last_name: values.last_name,
          email: values.email,
          phone: values.phone,
          client_goal: values.client_goal || undefined,
          text_language: values.text_language,
          notes: values.notes || undefined,
          agent_phone: values.mode === "agent" ? values.agent_phone : undefined,
          rep_name: values.mode === "agent" ? values.rep_name : undefined,
          email_opt_in: values.email_opt_in,
          report_file: values.report_file,
          affiliateCode: getAffiliateRef(),
        }),
      );
    },
  });

  const handleFile = (f: File | null) => {
    setFileError(null);
    if (f) {
      if (f.type !== "application/pdf") {
        setFileError(t("creditAnalysis.errFile"));
        return;
      }
      if (f.size > CREDIT_ANALYSIS_MAX_FILE_BYTES) {
        setFileError(
          t("prospectAnalysis.errFileSize", { mb: CREDIT_ANALYSIS_MAX_FILE_MB }),
        );
        return;
      }
    }
    form.setFieldValue("report_file", f);
  };

  const canEmailOptIn =
    Boolean(form.values.email.trim()) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.values.email.trim());

  const handleStartOver = () => {
    dispatch(clearCreditAnalysisResult());
    form.resetForm();
    setFileError(null);
  };

  return (
    <div className="w-full max-w-[100vw] overflow-x-hidden">
      <PageMeta
        title={t("creditAnalysis.metaTitle")}
        description={t("creditAnalysis.metaDescription")}
        canonical="/credit-analysis"
      />

      {/* Hero band */}
      <section className="relative overflow-hidden bg-background pt-28 pb-10 md:pt-36 md:pb-14">
        <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/[0.08] to-transparent pointer-events-none" />
        <div className="absolute -top-16 -right-16 w-64 h-64 bg-accent/10 rounded-full blur-3xl pointer-events-none animate-float" />
        <div
          className="absolute top-32 -left-16 w-56 h-56 bg-primary/10 rounded-full blur-3xl pointer-events-none animate-float"
          style={{ animationDelay: "1.1s" }}
        />

        <div className="section-inner relative z-10 max-w-3xl mx-auto text-center px-4">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/10 border border-primary/20 px-3 py-1.5 rounded-full mb-4">
            <Sparkles className="w-3.5 h-3.5" /> {t("creditAnalysis.badge")}
          </span>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-foreground leading-tight mb-4">
            {t("creditAnalysis.heading")}
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto">
            {t("creditAnalysis.subheading")}
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="section-container pb-20">
        <div className="section-inner max-w-2xl mx-auto px-4">
          {result ? (
            <CreditAnalysisResultPanel
              result={result}
              onStartOver={handleStartOver}
              showRegisterCta
            />
          ) : (
            <form
              onSubmit={form.handleSubmit}
              className="card-base p-5 md:p-8 space-y-7 animate-fade-up"
            >
              {/* Mode toggle */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block">
                  {t("creditAnalysis.modeLabel")}
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted">
                  {(
                    [
                      { value: "client", label: t("creditAnalysis.modeClient"), icon: User },
                      { value: "agent", label: t("creditAnalysis.modeAgent"), icon: Briefcase },
                    ] as const
                  ).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => form.setFieldValue("mode", value)}
                      className={`flex items-center justify-center gap-1.5 h-10 rounded-lg text-sm font-semibold transition-all ${
                        form.values.mode === value
                          ? "bg-card text-primary shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* About section */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-foreground">
                  {t("creditAnalysis.sectionAbout")}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field
                    label={t("creditAnalysis.firstName")}
                    error={form.touched.first_name && form.errors.first_name}
                  >
                    <input className={inputCls} {...form.getFieldProps("first_name")} />
                  </Field>
                  <Field
                    label={t("creditAnalysis.lastName")}
                    error={form.touched.last_name && form.errors.last_name}
                  >
                    <input className={inputCls} {...form.getFieldProps("last_name")} />
                  </Field>
                  <Field
                    label={t("creditAnalysis.email")}
                    error={form.touched.email && form.errors.email}
                  >
                    <input type="email" className={inputCls} {...form.getFieldProps("email")} />
                  </Field>
                  <Field
                    label={t("creditAnalysis.phone")}
                    error={form.touched.phone && form.errors.phone}
                  >
                    <input type="tel" className={inputCls} {...form.getFieldProps("phone")} />
                  </Field>
                </div>
                <Field
                  label={t("creditAnalysis.goal")}
                  optional={t("creditAnalysis.notesOptional")}
                >
                  <ClientGoalCombobox
                    name="client_goal"
                    value={form.values.client_goal}
                    placeholder={t("creditAnalysis.goalPlaceholder")}
                    onChange={(v) => form.setFieldValue("client_goal", v)}
                    onBlur={() => form.setFieldTouched("client_goal", true)}
                  />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={t("creditAnalysis.language")}>
                    <select
                      className={`${inputCls} appearance-none`}
                      {...form.getFieldProps("text_language")}
                    >
                      <option value="en">English</option>
                      <option value="es">Español</option>
                    </select>
                  </Field>
                </div>
                <Field
                  label={t("creditAnalysis.notes")}
                  optional={t("creditAnalysis.notesOptional")}
                >
                  <textarea
                    rows={3}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder={t("creditAnalysis.notesPlaceholder")}
                    {...form.getFieldProps("notes")}
                  />
                </Field>
              </div>

              {/* Agent-only section */}
              {form.values.mode === "agent" && (
                <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5 text-primary" />
                    {t("creditAnalysis.sectionAgent")}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label={t("creditAnalysis.repName")}
                      error={form.touched.rep_name && form.errors.rep_name}
                    >
                      <input className={inputCls} {...form.getFieldProps("rep_name")} />
                    </Field>
                    <Field
                      label={t("creditAnalysis.agentPhone")}
                      error={form.touched.agent_phone && form.errors.agent_phone}
                    >
                      <input
                        type="tel"
                        className={inputCls}
                        {...form.getFieldProps("agent_phone")}
                      />
                    </Field>
                  </div>
                </div>
              )}

              {/* File upload */}
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-foreground">
                  {t("creditAnalysis.sectionReport")}
                </h3>
                <div
                  className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/40 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleFile(e.dataTransfer.files[0] ?? null);
                  }}
                >
                  <Upload className="w-7 h-7 mx-auto text-primary/60 mb-2" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    {t("creditAnalysis.uploadLabel")}
                  </p>
                  <p className="text-xs text-muted-foreground mb-3">
                    {t("creditAnalysis.uploadHint")}
                  </p>
                  {form.values.report_file ? (
                    <div className="inline-flex items-center gap-2 bg-accent/10 text-accent border border-accent/25 px-3 py-1.5 rounded-lg text-xs font-medium">
                      <FileText className="w-3.5 h-3.5" />
                      <span className="max-w-[220px] truncate">
                        {form.values.report_file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleFile(null)}
                        className="hover:text-destructive"
                        aria-label={t("creditAnalysis.uploadRemove")}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <label className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary cursor-pointer underline underline-offset-2">
                      {t("creditAnalysis.uploadChoose")}
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  )}
                </div>
                {fileError && <p className="text-xs text-destructive">{fileError}</p>}
              </div>

              {/* Email opt-in */}
              <label
                className={`flex items-start gap-2.5 ${canEmailOptIn ? "cursor-pointer" : "opacity-60"}`}
              >
                <Checkbox
                  checked={form.values.email_opt_in}
                  disabled={!canEmailOptIn}
                  onCheckedChange={(v) =>
                    form.setFieldValue("email_opt_in", Boolean(v))
                  }
                  className="mt-0.5"
                />
                <span className="text-sm text-foreground/80">
                  {t("creditAnalysis.emailOptIn")}
                  {!canEmailOptIn && (
                    <span className="block text-xs text-muted-foreground mt-1">
                      {t("prospectAnalysis.emailOptInNoEmail")}
                    </span>
                  )}
                </span>
              </label>

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || form.isSubmitting}
                className="btn-primary w-full h-12 flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> {t("creditAnalysis.submitting")}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" /> {t("creditAnalysis.submit")}
                  </>
                )}
              </button>

              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5 text-accent" /> {t("creditAnalysis.trustNote")}
              </p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

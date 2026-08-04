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
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  submitCreditAnalysis,
  clearCreditAnalysisResult,
} from "@/store/slices/creditAnalysisSlice";
import type { CreditAnalysisMode } from "@shared/api";
import { Checkbox } from "@/components/ui/checkbox";
import { captureAffiliateRef, getAffiliateRef } from "@/lib/affiliateAttribution";

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

const MAX_FILE_MB = 15;

// ─── Score gauge ──────────────────────────────────────────────────────────

function ScoreGauge({
  label,
  score,
  band,
}: {
  label: string;
  score: number | null | undefined;
  band?: string | null;
}) {
  const hasScore = typeof score === "number" && score > 0;
  const pct = hasScore ? Math.min(Math.max((score - 300) / (850 - 300), 0), 1) : 0;
  const color = !hasScore
    ? "text-muted-foreground border-border"
    : score >= 720
      ? "text-accent border-accent/50"
      : score >= 640
        ? "text-primary border-primary/50"
        : "text-destructive border-destructive/50";

  return (
    <div className="flex flex-col items-center gap-2 flex-1 min-w-[90px]">
      <div
        className={`w-20 h-20 rounded-full border-4 flex items-center justify-center bg-card ${color}`}
      >
        <span className="text-lg font-extrabold">{hasScore ? score : "—"}</span>
      </div>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {band ? (
        <span className="text-[10px] font-bold uppercase tracking-wide text-accent">
          {band}
        </span>
      ) : null}
      {hasScore && (
        <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-current rounded-full transition-all duration-700"
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

function analystNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function analystStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function PriorityChip({ priority }: { priority: string }) {
  const p = priority.toUpperCase();
  const cls =
    p === "CRITICAL"
      ? "bg-destructive/10 text-destructive border-destructive/25"
      : p === "HIGH"
        ? "bg-destructive/5 text-destructive border-destructive/20"
        : p === "MEDIUM"
          ? "bg-secondary text-foreground border-border"
          : "bg-primary/5 text-primary border-primary/20";
  return (
    <span
      className={`inline-flex text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border ${cls}`}
    >
      {priority}
    </span>
  );
}

// ─── Result panel ─────────────────────────────────────────────────────────

function AnalysisResultPanel({ onStartOver }: { onStartOver: () => void }) {
  const { t } = useTranslation();
  const { result } = useAppSelector((s) => s.creditAnalysis);
  if (!result) return null;

  const weakExtraction =
    result.extraction_status && result.extraction_status !== "ok";
  const analyst = result.analyst ?? null;
  const mid = analystNum(analyst?.middle_score);
  const goal = analystNum(analyst?.goal_score);
  const fhaStatus = analystStr(analyst?.fha_status);
  const timeline = [
    { key: "today", label: t("creditAnalysis.timelineToday"), v: analystNum(analyst?.score_today) },
    { key: "30", label: t("creditAnalysis.timeline30"), v: analystNum(analyst?.score_30_days) },
    { key: "60", label: t("creditAnalysis.timeline60"), v: analystNum(analyst?.score_60_days) },
    { key: "90", label: t("creditAnalysis.timeline90"), v: analystNum(analyst?.score_90_days) },
    { key: "target", label: t("creditAnalysis.timelineTarget"), v: analystNum(analyst?.score_target) },
  ];
  const negRows = [1, 2, 3, 4, 5]
    .map((i) => ({
      account: analystStr(analyst?.[`neg_${i}_account`]),
      type: analystStr(analyst?.[`neg_${i}_type`]),
      bureaus: analystStr(analyst?.[`neg_${i}_bureaus`]),
      priority: analystStr(analyst?.[`neg_${i}_priority`]),
      basis: analystStr(analyst?.[`neg_${i}_dispute_basis`]),
    }))
    .filter((r) => r.account);
  const actions = [1, 2, 3, 4, 5, 6]
    .map((i) => ({
      time: analystStr(analyst?.[`action_${i}_time`]),
      action: analystStr(analyst?.[`action_${i}_action`]),
      reason: analystStr(analyst?.[`action_${i}_reason`]),
    }))
    .filter((a) => a.action);
  const fsRows = analyst
    ? [
        [analystStr(analyst.fs_label_1), analystStr(analyst.fs_open_revolving)],
        [analystStr(analyst.fs_label_2), analystStr(analyst.fs_installment_mix)],
        [analystStr(analyst.fs_label_3), analystStr(analyst.fs_mortgage)],
        [analystStr(analyst.fs_label_4), analystStr(analyst.fs_account_age)],
        [analystStr(analyst.fs_label_5), analystStr(analyst.fs_post_repair)],
      ].filter(([l]) => l)
    : [];

  return (
    <div className="animate-fade-up space-y-6">
      <div className="text-center space-y-3">
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border ${
            weakExtraction
              ? "text-destructive bg-destructive/10 border-destructive/25"
              : "text-accent bg-accent/10 border-accent/25"
          }`}
        >
          {weakExtraction ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5" />{" "}
              {t("creditAnalysis.extractionWeakBadge")}
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" /> {t("creditAnalysis.resultBadge")}
            </>
          )}
        </span>
        <h2 className="text-2xl md:text-3xl font-bold text-foreground">
          {weakExtraction
            ? t("creditAnalysis.extractionWeakHeading")
            : t("creditAnalysis.resultHeading")}
        </h2>
        <p className="text-muted-foreground max-w-lg mx-auto">
          {weakExtraction
            ? t("creditAnalysis.extractionWeakBody")
            : t("creditAnalysis.resultSubheading")}
        </p>
        {result.email_sent && (
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 px-3 py-1 rounded-full">
            <Mail className="w-3 h-3" /> {t("creditAnalysis.emailSentNotice")}
          </p>
        )}
      </div>

      {weakExtraction && (
        <div className="card-base p-4 border-destructive/30 bg-destructive/5 flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t("creditAnalysis.extractionWeakTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("creditAnalysis.extractionWeakHint")}
            </p>
          </div>
        </div>
      )}

      {/* Scores */}
      {result.scores && !weakExtraction && (
        <div className="card-base p-6 space-y-5">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {t("creditAnalysis.scoresHeading")}
          </h3>
          <div className="flex gap-4 justify-center flex-wrap">
            <ScoreGauge
              label={t("creditAnalysis.transunion")}
              score={result.scores.transunion}
              band={analystStr(analyst?.score_tu_label) || null}
            />
            <ScoreGauge
              label={t("creditAnalysis.experian")}
              score={result.scores.experian}
              band={analystStr(analyst?.score_ex_label) || null}
            />
            <ScoreGauge
              label={t("creditAnalysis.equifax")}
              score={result.scores.equifax}
              band={analystStr(analyst?.score_eq_label) || null}
            />
          </div>
          {(mid != null || goal != null || fhaStatus) && (
            <div className="rounded-xl border border-border bg-secondary/60 p-4 space-y-2">
              <div className="flex flex-wrap gap-4 justify-center text-center">
                {mid != null && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {t("creditAnalysis.midScore")}
                    </p>
                    <p className="text-2xl font-extrabold text-foreground">{mid}</p>
                  </div>
                )}
                {goal != null && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {t("creditAnalysis.goalScore")}
                    </p>
                    <p className="text-2xl font-extrabold text-accent">{goal}</p>
                  </div>
                )}
              </div>
              {fhaStatus && (
                <p className="text-sm text-center text-foreground">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground mr-2">
                    {t("creditAnalysis.lendingStatus")}
                  </span>
                  {fhaStatus}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {analyst && !weakExtraction && timeline.some((x) => x.v != null) && (
        <div className="card-base p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4">
            {t("creditAnalysis.timelineHeading")}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {timeline.map((x) => (
              <div
                key={x.key}
                className="rounded-lg border border-border bg-card px-3 py-3 text-center"
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {x.label}
                </p>
                <p
                  className={`text-xl font-extrabold mt-1 ${
                    x.key === "target" ? "text-accent" : "text-foreground"
                  }`}
                >
                  {x.v ?? "—"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Negatives — prefer prioritized analyst slots when present */}
      <div className="card-base p-6">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4">
          {t("creditAnalysis.negativesHeading")}
        </h3>
        {negRows.length > 0 ? (
          <ul className="space-y-2.5">
            {negRows.map((n, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3"
              >
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{n.account}</p>
                    {n.priority && <PriorityChip priority={n.priority} />}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {n.type}
                    {n.bureaus ? ` · ${n.bureaus}` : ""}
                  </p>
                  {n.basis && (
                    <p className="text-xs text-foreground/80 leading-relaxed">{n.basis}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : result.negatives && result.negatives.length > 0 ? (
          <ul className="space-y-2.5">
            {result.negatives.map((n, i) => (
              <li
                key={i}
                className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3"
              >
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {n.creditor || n.type}
                  </p>
                  {n.detail && (
                    <p className="text-xs text-muted-foreground mt-0.5">{n.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : weakExtraction ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            {t("creditAnalysis.extractionWeakNegatives")}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-accent">
            <CheckCircle2 className="w-4 h-4" /> {t("creditAnalysis.noNegatives")}
          </p>
        )}
      </div>

      {/* File strength */}
      {fsRows.length > 0 && !weakExtraction && (
        <div className="card-base p-6 space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {t("creditAnalysis.fileStrengthHeading")}
            </h3>
            <p className="text-sm font-extrabold text-foreground">
              {analystNum(analyst?.file_strength_score) ?? 0}/100
              {analystStr(analyst?.file_strength_rating)
                ? ` · ${analystStr(analyst?.file_strength_rating)}`
                : ""}
            </p>
          </div>
          <ul className="space-y-2">
            {fsRows.map(([label, value]) => (
              <li
                key={label}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 rounded-lg border border-border px-3 py-2"
              >
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="text-xs text-muted-foreground">{value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action plan */}
      {actions.length > 0 && !weakExtraction && (
        <div className="card-base p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4">
            {t("creditAnalysis.actionPlanHeading")}
          </h3>
          <ol className="space-y-3">
            {actions.map((a, i) => (
              <li
                key={i}
                className="rounded-xl border border-border overflow-hidden"
              >
                <div className="bg-primary text-accent text-[11px] font-bold tracking-wide px-3 py-1.5">
                  {a.time}
                </div>
                <div className="px-3 py-2.5 space-y-1">
                  <p className="text-sm font-semibold text-foreground">{a.action}</p>
                  <p className="text-xs text-muted-foreground">{a.reason}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Client message */}
      {analystStr(analyst?.client_text_message) && !weakExtraction && (
        <div className="card-base p-6 border-l-4 border-l-accent">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-3">
            {t("creditAnalysis.clientMessageHeading")}
          </h3>
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
            {analystStr(analyst?.client_text_message)}
          </p>
        </div>
      )}

      {/* Suggested labels */}
      {result.suggested_labels && result.suggested_labels.length > 0 && (
        <div className="card-base p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground mb-4">
            {t("creditAnalysis.labelsHeading")}
          </h3>
          <div className="flex flex-wrap gap-2">
            {result.suggested_labels.map((slug) => (
              <span
                key={slug}
                className="text-xs font-medium bg-primary/10 text-primary border border-primary/20 px-3 py-1 rounded-full"
              >
                {slug.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Full analysis HTML (email-style narrative) */}
      {result.analysis_html && (
        <div
          className="card-base p-6 prose prose-sm max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: result.analysis_html }}
        />
      )}

      <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
        <Link
          to="/register"
          className="btn-primary h-12 px-8 flex items-center justify-center gap-2"
        >
          {t("creditAnalysis.ctaRegister")} <ArrowRight className="w-4 h-4" />
        </Link>
        <button
          type="button"
          onClick={onStartOver}
          className="btn-secondary h-12 px-8 flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-4 h-4" /> {t("creditAnalysis.startOver")}
        </button>
      </div>
    </div>
  );
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
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        setFileError(t("creditAnalysis.errFile"));
        return;
      }
    }
    form.setFieldValue("report_file", f);
  };

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
            <AnalysisResultPanel onStartOver={handleStartOver} />
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
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox
                  checked={form.values.email_opt_in}
                  onCheckedChange={(v) => form.setFieldValue("email_opt_in", Boolean(v))}
                  className="mt-0.5"
                />
                <span className="text-sm text-foreground/80">
                  {t("creditAnalysis.emailOptIn")}
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

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Loader2,
  Landmark,
  ArrowLeft,
} from "lucide-react";
import PageMeta from "@/components/PageMeta";
import PublicWizardFooter from "@/components/PublicWizardFooter";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearPublicFundingError,
  fetchFundingByToken,
  getStoredFundingToken,
  setStoredFundingToken,
  startFundingApplication,
  submitFundingApplication,
  updateFundingApplication,
  uploadFundingDocument,
} from "@/store/slices/fundingSlice";
import type {
  FundingApplication,
  FundingDocSlot,
  FundingType,
} from "@shared/api";
import { FUNDING_REQUIRED_DOC_SLOTS } from "@shared/api";
import { logger } from "@/utils/logger";

const TOTAL_STEPS = 7; // 0..6
const MAX_FILE_MB = 15;

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
] as const;

type DocFieldKey =
  | "drivers_license"
  | "corp_statement"
  | "bank_m1"
  | "bank_m2"
  | "bank_m3"
  | "bank_m4"
  | "bank_m5"
  | "bank_m6";

const DOC_FIELD_TO_SLOT: Record<DocFieldKey, FundingDocSlot> = {
  drivers_license: "funding_drivers_license",
  corp_statement: "funding_corp_statement",
  bank_m1: "funding_bank_m1",
  bank_m2: "funding_bank_m2",
  bank_m3: "funding_bank_m3",
  bank_m4: "funding_bank_m4",
  bank_m5: "funding_bank_m5",
  bank_m6: "funding_bank_m6",
};

interface FormValues {
  first_name: string;
  last_name: string;
  email: string;
  funding_type: FundingType | "";
  preferred_language: "en" | "es";
  postal_code: string;
  phone: string;
  state: string;
  ein: string;
  llc_name: string;
  llc_address: string;
  ssn: string;
  drivers_license: File | null;
  corp_statement: File | null;
  bank_m1: File | null;
  bank_m2: File | null;
  bank_m3: File | null;
  bank_m4: File | null;
  bank_m5: File | null;
  bank_m6: File | null;
}

const emptyValues: FormValues = {
  first_name: "",
  last_name: "",
  email: "",
  funding_type: "",
  preferred_language: "en",
  postal_code: "",
  phone: "",
  state: "",
  ein: "",
  llc_name: "",
  llc_address: "",
  ssn: "",
  drivers_license: null,
  corp_statement: null,
  bank_m1: null,
  bank_m2: null,
  bank_m3: null,
  bank_m4: null,
  bank_m5: null,
  bank_m6: null,
};

function hasDoc(app: FundingApplication | null, slot: FundingDocSlot) {
  return Boolean(app?.docs_uploaded?.includes(slot));
}

function guessResumeStep(app: FundingApplication): number {
  if (
    app.status === "submitted" ||
    app.status === "under_review" ||
    app.status === "complete" ||
    app.status === "converted"
  ) {
    return 6;
  }
  const uploaded = new Set(app.docs_uploaded || []);
  const missing = FUNDING_REQUIRED_DOC_SLOTS.filter((s) => !uploaded.has(s));
  if (missing.some((s) => s.startsWith("funding_bank_m") && Number(s.slice(-1)) >= 4)) {
    return 5;
  }
  if (missing.some((s) => s.startsWith("funding_bank_m"))) {
    return 4;
  }
  if (
    missing.includes("funding_corp_statement") ||
    !app.has_secrets
  ) {
    return 3;
  }
  if (
    missing.includes("funding_drivers_license") ||
    !app.llc_name ||
    !app.llc_address
  ) {
    return 2;
  }
  if (!app.postal_code || !app.state || !app.phone) {
    return 1;
  }
  return 1;
}

function FileField({
  label,
  hint,
  file,
  alreadyUploaded,
  disabled,
  onChange,
  error,
  uploadedLabel,
  chooseLabel,
}: {
  label: string;
  hint?: string;
  file: File | null;
  alreadyUploaded?: boolean;
  disabled?: boolean;
  onChange: (f: File | null) => void;
  error?: string | false;
  uploadedLabel: string;
  chooseLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-foreground">
        {label}
      </label>
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={`w-full flex items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left transition-colors ${
          error
            ? "border-destructive bg-destructive/5"
            : alreadyUploaded || file
              ? "border-accent/40 bg-accent/5"
              : "border-border bg-secondary/40 hover:border-primary/40"
        } disabled:opacity-50`}
      >
        <FileUp className="w-5 h-5 text-primary shrink-0" />
        <span className="text-sm text-foreground truncate flex-1">
          {file ? file.name : alreadyUploaded ? uploadedLabel : chooseLabel}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (f && f.size > MAX_FILE_MB * 1024 * 1024) {
            onChange(null);
            return;
          }
          onChange(f);
        }}
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | false;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-foreground">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

const inputCls =
  "w-full h-11 px-3.5 rounded-lg border border-input bg-background text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50";

export default function Funding() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    publicApplication,
    publicLoading,
    publicSaving,
    publicUploading,
    publicSubmitting,
    publicError,
  } = useAppSelector((s) => s.funding);

  const [step, setStep] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [submittedOk, setSubmittedOk] = useState(false);
  const busy = publicSaving || publicUploading || publicSubmitting;

  const validationSchema = useMemo(() => {
    const fileOrUploaded = (slot: FundingDocSlot) =>
      Yup.mixed<File | null>().nullable().test("file", t("funding.errors.required"), function (v) {
        if (v instanceof File) return true;
        if (hasDoc(publicApplication, slot)) return true;
        return false;
      });

    switch (step) {
      case 0:
        return Yup.object({
          first_name: Yup.string().trim().required(t("funding.errors.required")),
          last_name: Yup.string().trim().required(t("funding.errors.required")),
          email: Yup.string()
            .email(t("funding.errors.email"))
            .required(t("funding.errors.required")),
          funding_type: Yup.string()
            .oneOf(["credit_card_stacking", "bank_statements"])
            .required(t("funding.errors.required")),
          preferred_language: Yup.string().oneOf(["en", "es"]).required(),
        });
      case 1:
        return Yup.object({
          postal_code: Yup.string().trim().required(t("funding.errors.required")),
          phone: Yup.string().trim().required(t("funding.errors.required")),
          state: Yup.string().trim().required(t("funding.errors.required")),
          ein: Yup.string()
            .trim()
            .test("ein", t("funding.errors.required"), function (v) {
              if (v && v.replace(/\D/g, "").length >= 9) return true;
              if (publicApplication?.has_secrets) return true;
              return false;
            }),
        });
      case 2:
        return Yup.object({
          llc_name: Yup.string().trim().required(t("funding.errors.required")),
          llc_address: Yup.string().trim().required(t("funding.errors.required")),
          drivers_license: fileOrUploaded("funding_drivers_license"),
        });
      case 3:
        return Yup.object({
          ssn: Yup.string()
            .trim()
            .test("ssn", t("funding.errors.required"), function (v) {
              if (v && v.replace(/\D/g, "").length >= 9) return true;
              if (publicApplication?.has_secrets) return true;
              return false;
            }),
          corp_statement: fileOrUploaded("funding_corp_statement"),
        });
      case 4:
        return Yup.object({
          bank_m1: fileOrUploaded("funding_bank_m1"),
          bank_m2: fileOrUploaded("funding_bank_m2"),
          bank_m3: fileOrUploaded("funding_bank_m3"),
        });
      case 5:
        return Yup.object({
          bank_m4: fileOrUploaded("funding_bank_m4"),
          bank_m5: fileOrUploaded("funding_bank_m5"),
          bank_m6: fileOrUploaded("funding_bank_m6"),
        });
      default:
        return Yup.object({});
    }
  }, [step, t, publicApplication]);

  const form = useFormik<FormValues>({
    initialValues: {
      ...emptyValues,
      preferred_language: i18n.language?.startsWith("es") ? "es" : "en",
    },
    enableReinitialize: false,
    validationSchema,
    onSubmit: async () => {
      /* handled by next/submit buttons */
    },
  });

  // Resume from ?token= or sessionStorage
  useEffect(() => {
    const qToken = searchParams.get("token");
    const stored = getStoredFundingToken();
    const token = qToken || stored;
    if (!token) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await dispatch(fetchFundingByToken(token));
      if (cancelled) return;
      if (fetchFundingByToken.fulfilled.match(result)) {
        const app = result.payload;
        form.setValues({
          ...emptyValues,
          first_name: app.first_name || "",
          last_name: app.last_name || "",
          email: app.email || "",
          funding_type: app.funding_type || "",
          preferred_language: app.preferred_language || "en",
          postal_code: app.postal_code || "",
          phone: app.phone || "",
          state: app.state || "",
          llc_name: app.llc_name || "",
          llc_address: app.llc_address || "",
          ein: "",
          ssn: "",
        });
        if (app.preferred_language) {
          void i18n.changeLanguage(app.preferred_language);
        }
        const nextStep = guessResumeStep(app);
        setStep(nextStep);
        if (
          app.status === "submitted" ||
          app.status === "under_review" ||
          app.status === "complete" ||
          app.status === "converted"
        ) {
          setSubmittedOk(true);
        }
        if (qToken && app.public_token) {
          setStoredFundingToken(app.public_token);
        }
        if (!qToken && app.public_token) {
          setSearchParams({ token: app.public_token }, { replace: true });
        }
      } else {
        setStoredFundingToken(null);
        logger.warn("funding resume failed", result.payload);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume once on mount
  }, []);

  useEffect(() => {
    dispatch(clearPublicFundingError());
  }, [step, dispatch]);

  const token =
    publicApplication?.public_token ||
    searchParams.get("token") ||
    getStoredFundingToken();

  const ensureUploads = async (keys: DocFieldKey[]) => {
    if (!token) throw new Error("missing token");
    for (const key of keys) {
      const file = form.values[key];
      const slot = DOC_FIELD_TO_SLOT[key];
      if (file instanceof File) {
        const r = await dispatch(
          uploadFundingDocument({ token, doc_type: slot, file }),
        );
        if (!uploadFundingDocument.fulfilled.match(r)) {
          throw new Error(String(r.payload));
        }
        form.setFieldValue(key, null);
      }
    }
  };

  const goNext = async () => {
    const errors = await form.validateForm();
    // Mark relevant fields touched
    const touched: Record<string, boolean> = {};
    Object.keys(errors).forEach((k) => {
      touched[k] = true;
    });
    form.setTouched({ ...form.touched, ...touched });
    if (Object.keys(errors).length > 0) return;

    try {
      if (step === 0) {
        if (!token) {
          const r = await dispatch(
            startFundingApplication({
              first_name: form.values.first_name.trim(),
              last_name: form.values.last_name.trim(),
              email: form.values.email.trim(),
              phone: form.values.phone.trim() || undefined,
              funding_type: form.values.funding_type as FundingType,
              preferred_language: form.values.preferred_language,
            }),
          );
          if (!startFundingApplication.fulfilled.match(r)) return;
          const app = r.payload;
          if (app.public_token) {
            setSearchParams({ token: app.public_token }, { replace: true });
          }
        } else {
          const r = await dispatch(
            updateFundingApplication({
              token,
              first_name: form.values.first_name.trim(),
              last_name: form.values.last_name.trim(),
              email: form.values.email.trim(),
              funding_type: form.values.funding_type as FundingType,
              preferred_language: form.values.preferred_language,
            }),
          );
          if (!updateFundingApplication.fulfilled.match(r)) return;
        }
        setStep(1);
        return;
      }

      if (!token) return;

      if (step === 1) {
        const payload: Parameters<typeof updateFundingApplication>[0] = {
          token,
          postal_code: form.values.postal_code.trim(),
          phone: form.values.phone.trim(),
          state: form.values.state.trim(),
        };
        if (form.values.ein.trim()) payload.ein = form.values.ein.trim();
        const r = await dispatch(updateFundingApplication(payload));
        if (!updateFundingApplication.fulfilled.match(r)) return;
        setStep(2);
        return;
      }

      if (step === 2) {
        const r = await dispatch(
          updateFundingApplication({
            token,
            llc_name: form.values.llc_name.trim(),
            llc_address: form.values.llc_address.trim(),
          }),
        );
        if (!updateFundingApplication.fulfilled.match(r)) return;
        await ensureUploads(["drivers_license"]);
        setStep(3);
        return;
      }

      if (step === 3) {
        if (form.values.ssn.trim()) {
          const r = await dispatch(
            updateFundingApplication({
              token,
              ssn: form.values.ssn.trim(),
            }),
          );
          if (!updateFundingApplication.fulfilled.match(r)) return;
        }
        await ensureUploads(["corp_statement"]);
        setStep(4);
        return;
      }

      if (step === 4) {
        await ensureUploads(["bank_m1", "bank_m2", "bank_m3"]);
        setStep(5);
        return;
      }

      if (step === 5) {
        await ensureUploads(["bank_m4", "bank_m5", "bank_m6"]);
        setStep(6);
        return;
      }
    } catch (e) {
      logger.error("funding step advance failed", e);
    }
  };

  const goPrev = () => {
    if (step <= 0 || submittedOk) return;
    setStep((s) => Math.max(0, s - 1));
  };

  const handleSubmit = async () => {
    if (!token) return;
    const r = await dispatch(submitFundingApplication(token));
    if (submitFundingApplication.fulfilled.match(r)) {
      setSubmittedOk(true);
    }
  };

  const onLanguageChange = (lang: "en" | "es") => {
    form.setFieldValue("preferred_language", lang);
    void i18n.changeLanguage(lang);
  };

  const stepTitle = t(`funding.steps.${step}.title`);
  const stepHint = t(`funding.steps.${step}.hint`, { defaultValue: "" });

  if (!hydrated || publicLoading) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-primary/5 via-background to-accent/5 flex flex-col w-full max-w-[100vw] overflow-x-hidden">
      <PageMeta
        title={t("funding.metaTitle")}
        description={t("funding.metaDescription")}
      />

      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border/60">
        <div className="container max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center transition-opacity hover:opacity-80"
            aria-label={t("nav.home")}
          >
            <img
              src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_dark.png"
              alt="Optimum Credit"
              className="h-8 w-auto dark:hidden"
            />
            <img
              src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_white.png"
              alt=""
              aria-hidden
              className="h-8 w-auto hidden dark:block"
            />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t("funding.backHome")}
          </Link>
        </div>
      </header>

      <main className="flex-1 container max-w-xl mx-auto px-4 sm:px-6 py-8 md:py-10">
        <div className="flex items-center gap-2 mb-4 text-primary justify-center">
          <Landmark className="w-5 h-5" />
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
            {t("funding.pageTitle")}
          </h1>
        </div>

        {/* Progress */}
        <div className="flex gap-1.5 mb-5 px-1">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="card-base rounded-2xl overflow-hidden shadow-md">
          <div className="px-5 sm:px-7 pt-6 pb-4 border-b border-border">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">
              {t("funding.stepLabel", { current: step + 1, total: TOTAL_STEPS })}
            </p>
            <h2 className="text-xl font-bold text-foreground">{stepTitle}</h2>
              {stepHint ? (
                <p className="text-sm text-muted-foreground mt-1">{stepHint}</p>
              ) : null}
            </div>

            <div className="px-5 sm:px-7 py-5 space-y-4 min-h-[280px]">
              {publicError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {publicError}
                </div>
              ) : null}

              {step === 0 && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label={t("funding.fields.firstName")}
                      error={form.touched.first_name && form.errors.first_name}
                    >
                      <input
                        className={inputCls}
                        {...form.getFieldProps("first_name")}
                      />
                    </Field>
                    <Field
                      label={t("funding.fields.lastName")}
                      error={form.touched.last_name && form.errors.last_name}
                    >
                      <input
                        className={inputCls}
                        {...form.getFieldProps("last_name")}
                      />
                    </Field>
                  </div>
                  <Field
                    label={t("funding.fields.email")}
                    error={form.touched.email && form.errors.email}
                  >
                    <input
                      type="email"
                      className={inputCls}
                      {...form.getFieldProps("email")}
                    />
                  </Field>
                  <Field
                    label={t("funding.fields.fundingType")}
                    error={form.touched.funding_type && form.errors.funding_type}
                  >
                    <select
                      className={`${inputCls} appearance-none`}
                      {...form.getFieldProps("funding_type")}
                    >
                      <option value="">{t("funding.fields.fundingTypePlaceholder")}</option>
                      <option value="credit_card_stacking">
                        {t("funding.types.credit_card_stacking")}
                      </option>
                      <option value="bank_statements">
                        {t("funding.types.bank_statements")}
                      </option>
                    </select>
                  </Field>
                  <Field label={t("funding.fields.language")}>
                    <select
                      className={`${inputCls} appearance-none`}
                      value={form.values.preferred_language}
                      onChange={(e) =>
                        onLanguageChange(e.target.value as "en" | "es")
                      }
                    >
                      <option value="en">English</option>
                      <option value="es">Español</option>
                    </select>
                  </Field>
                </>
              )}

              {step === 1 && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field
                      label={t("funding.fields.postalCode")}
                      error={form.touched.postal_code && form.errors.postal_code}
                    >
                      <input
                        className={inputCls}
                        {...form.getFieldProps("postal_code")}
                      />
                    </Field>
                    <Field
                      label={t("funding.fields.state")}
                      error={form.touched.state && form.errors.state}
                    >
                      <select
                        className={`${inputCls} appearance-none`}
                        {...form.getFieldProps("state")}
                      >
                        <option value="">{t("funding.fields.statePlaceholder")}</option>
                        {US_STATES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field
                    label={t("funding.fields.phone")}
                    error={form.touched.phone && form.errors.phone}
                  >
                    <input
                      type="tel"
                      className={inputCls}
                      {...form.getFieldProps("phone")}
                    />
                  </Field>
                  <Field
                    label={t("funding.fields.ein")}
                    error={form.touched.ein && form.errors.ein}
                  >
                    <input
                      className={inputCls}
                      autoComplete="off"
                      placeholder={
                        publicApplication?.has_secrets
                          ? t("funding.fields.secretOnFile")
                          : "XX-XXXXXXX"
                      }
                      {...form.getFieldProps("ein")}
                    />
                  </Field>
                </>
              )}

              {step === 2 && (
                <>
                  <Field
                    label={t("funding.fields.llcName")}
                    error={form.touched.llc_name && form.errors.llc_name}
                  >
                    <input
                      className={inputCls}
                      {...form.getFieldProps("llc_name")}
                    />
                  </Field>
                  <Field
                    label={t("funding.fields.llcAddress")}
                    error={form.touched.llc_address && form.errors.llc_address}
                  >
                    <textarea
                      rows={3}
                      className={`${inputCls} h-auto py-2.5 resize-none`}
                      {...form.getFieldProps("llc_address")}
                    />
                  </Field>
                  <FileField
                    label={t("funding.docs.drivers_license")}
                    hint={t("funding.docs.drivers_licenseHint")}
                    file={form.values.drivers_license}
                    alreadyUploaded={hasDoc(
                      publicApplication,
                      "funding_drivers_license",
                    )}
                    disabled={busy}
                    uploadedLabel={t("funding.docs.fileUploaded")}
                    chooseLabel={t("funding.docs.chooseFile")}
                    onChange={(f) => form.setFieldValue("drivers_license", f)}
                    error={
                      form.touched.drivers_license &&
                      (form.errors.drivers_license as string | undefined)
                    }
                  />
                </>
              )}

              {step === 3 && (
                <>
                  <Field
                    label={t("funding.fields.ssn")}
                    error={form.touched.ssn && form.errors.ssn}
                  >
                    <input
                      className={inputCls}
                      autoComplete="off"
                      inputMode="numeric"
                      placeholder={
                        publicApplication?.has_secrets
                          ? t("funding.fields.secretOnFile")
                          : "XXX-XX-XXXX"
                      }
                      {...form.getFieldProps("ssn")}
                    />
                  </Field>
                  <FileField
                    label={t("funding.docs.corp_statement")}
                    hint={t("funding.docs.corp_statementHint")}
                    file={form.values.corp_statement}
                    alreadyUploaded={hasDoc(
                      publicApplication,
                      "funding_corp_statement",
                    )}
                    disabled={busy}
                    uploadedLabel={t("funding.docs.fileUploaded")}
                    chooseLabel={t("funding.docs.chooseFile")}
                    onChange={(f) => form.setFieldValue("corp_statement", f)}
                    error={
                      form.touched.corp_statement &&
                      (form.errors.corp_statement as string | undefined)
                    }
                  />
                </>
              )}

              {step === 4 && (
                <div className="space-y-4">
                  {(["bank_m1", "bank_m2", "bank_m3"] as const).map((key, i) => (
                    <FileField
                      key={key}
                      label={t("funding.docs.bankMonth", { month: i + 1 })}
                      file={form.values[key]}
                      alreadyUploaded={hasDoc(
                        publicApplication,
                        DOC_FIELD_TO_SLOT[key],
                      )}
                      disabled={busy}
                      uploadedLabel={t("funding.docs.fileUploaded")}
                      chooseLabel={t("funding.docs.chooseFile")}
                      onChange={(f) => form.setFieldValue(key, f)}
                      error={
                        form.touched[key] &&
                        (form.errors[key] as string | undefined)
                      }
                    />
                  ))}
                </div>
              )}

              {step === 5 && (
                <div className="space-y-4">
                  {(["bank_m4", "bank_m5", "bank_m6"] as const).map((key, i) => (
                    <FileField
                      key={key}
                      label={t("funding.docs.bankMonth", { month: i + 4 })}
                      file={form.values[key]}
                      alreadyUploaded={hasDoc(
                        publicApplication,
                        DOC_FIELD_TO_SLOT[key],
                      )}
                      disabled={busy}
                      uploadedLabel={t("funding.docs.fileUploaded")}
                      chooseLabel={t("funding.docs.chooseFile")}
                      onChange={(f) => form.setFieldValue(key, f)}
                      error={
                        form.touched[key] &&
                        (form.errors[key] as string | undefined)
                      }
                    />
                  ))}
                </div>
              )}

              {step === 6 && (
                <div className="space-y-4 text-center py-4">
                  {submittedOk ? (
                    <>
                      <CheckCircle2 className="w-14 h-14 text-accent mx-auto" />
                      <h3 className="text-lg font-bold text-foreground">
                        {t("funding.confirm.successTitle")}
                      </h3>
                      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                        {t("funding.confirm.successBody")}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {t("funding.confirm.reviewBody")}
                      </p>
                      <ul className="text-left text-sm space-y-1.5 bg-secondary/50 rounded-xl p-4 text-foreground">
                        <li>
                          <span className="text-muted-foreground">
                            {t("funding.fields.name")}:{" "}
                          </span>
                          {form.values.first_name} {form.values.last_name}
                        </li>
                        <li>
                          <span className="text-muted-foreground">
                            {t("funding.fields.email")}:{" "}
                          </span>
                          {form.values.email}
                        </li>
                        <li>
                          <span className="text-muted-foreground">
                            {t("funding.fields.fundingType")}:{" "}
                          </span>
                          {form.values.funding_type
                            ? t(`funding.types.${form.values.funding_type}`)
                            : "—"}
                        </li>
                        <li>
                          <span className="text-muted-foreground">
                            {t("funding.fields.llcName")}:{" "}
                          </span>
                          {form.values.llc_name || "—"}
                        </li>
                      </ul>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleSubmit()}
                        className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {publicSubmitting ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : null}
                        {t("funding.confirm.submit")}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {!submittedOk && (
              <div className="flex items-stretch border-t border-border bg-muted/50 divide-x divide-border">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={step === 0 || busy}
                  className="flex-1 h-14 inline-flex items-center justify-center gap-1.5 text-sm font-bold uppercase tracking-wide text-foreground hover:bg-secondary disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t("funding.nav.prev")}
                </button>
                {step < 6 ? (
                  <button
                    type="button"
                    onClick={() => void goNext()}
                    disabled={busy}
                    className="flex-1 h-14 inline-flex items-center justify-center gap-1.5 text-sm font-bold uppercase tracking-wide text-primary hover:bg-secondary disabled:opacity-50 transition-colors"
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        {t("funding.nav.next")}
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                ) : (
                  <div className="flex-1" />
                )}
              </div>
            )}
          </div>

        <p className="text-center text-xs text-muted-foreground mt-6 px-4 pb-2">
          {t("funding.footerSecure")}
        </p>
      </main>

      <PublicWizardFooter />
    </div>
  );
}

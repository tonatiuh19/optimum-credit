import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
} from "lucide-react";
import PageMeta from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearPublicRegisterLocal,
  fetchPublicEventCompanies,
  fetchPublicEventLanding,
  registerPublicEvent,
} from "@/store/slices/eventMarketingSlice";
import type { EventFormField, EventQrSource, EventSession } from "@shared/api";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/utils";

function pickLabel(
  en: string,
  es: string | null | undefined,
  langEs: boolean,
): string {
  if (langEs && es) return es;
  return en;
}

function formatSessionWhen(startsAt: string, langEs: boolean): string {
  const raw = String(startsAt || "").trim();
  if (!raw) return "";
  // Wall-clock DATETIME from API (America/Los_Angeles) — display as stored.
  const normalized = raw.replace("T", " ").slice(0, 16);
  try {
    const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(langEs ? "es-US" : "en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  } catch {
    /* fall through */
  }
  return normalized;
}

function buildYupSchema(
  fields: EventFormField[],
  t: (k: string) => string,
) {
  const shape: Record<string, Yup.AnySchema> = {};
  for (const f of fields) {
    if (!f.is_active) continue;
    let schema: Yup.AnySchema;
    switch (f.field_type) {
      case "email":
        schema = Yup.string().email(t("common.invalidEmail"));
        break;
      case "phone":
        schema = Yup.string().trim().min(10, t("common.required"));
        break;
      case "checkbox":
        schema = Yup.boolean();
        break;
      case "language":
        schema = Yup.string().oneOf(["en", "es"]);
        break;
      case "textarea":
      case "text":
      case "select":
      default:
        schema = Yup.string().trim();
        break;
    }
    if (f.is_required) {
      if (f.field_type === "checkbox") {
        schema = (schema as Yup.BooleanSchema).oneOf(
          [true],
          t("common.required"),
        );
      } else {
        schema = schema.required(t("common.required"));
      }
    }
    shape[f.field_key] = schema;
  }
  return Yup.object(shape);
}

function initialAnswers(
  fields: EventFormField[],
  preferredLang: "en" | "es",
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    if (!f.is_active) continue;
    if (f.field_type === "checkbox") values[f.field_key] = false;
    else if (f.field_type === "language") values[f.field_key] = preferredLang;
    else values[f.field_key] = "";
  }
  return values;
}

export default function EventLanding() {
  const { companySlug, sessionCode } = useParams<{
    companySlug?: string;
    sessionCode?: string;
  }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    publicCompanies,
    publicLanding,
    publicLoading,
    publicError,
    publicRegistering,
    publicRegisterError,
    publicRegisterResult,
  } = useAppSelector((s) => s.eventMarketing);

  const langEs = i18n.language?.startsWith("es");
  const preferredLang: "en" | "es" = langEs ? "es" : "en";

  const sourceQr: EventQrSource = sessionCode ? "session" : "company";
  const sessionQuery =
    sessionCode || searchParams.get("session") || undefined;

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (!companySlug) {
      dispatch(fetchPublicEventCompanies()).catch((e) =>
        logger.warn("event companies load failed", e),
      );
      return;
    }
    dispatch(
      fetchPublicEventLanding({
        slug: companySlug,
        session: sessionQuery,
      }),
    ).catch((e) => logger.warn("event landing load failed", e));
  }, [dispatch, companySlug, sessionQuery]);

  useEffect(() => {
    if (companySlug) return;
    if (!publicCompanies.length) return;
    navigate(`/e/${publicCompanies[0].slug}`, { replace: true });
  }, [companySlug, publicCompanies, navigate]);

  useEffect(() => {
    if (!publicLanding) return;
    const next =
      publicLanding.selected_session_id ??
      publicLanding.next_session_id ??
      null;
    setSelectedSessionId(next);
  }, [publicLanding]);

  const company = publicLanding?.company ?? null;
  const companies =
    publicLanding?.companies?.length
      ? publicLanding.companies
      : publicCompanies;
  const sessions = useMemo(
    () =>
      (publicLanding?.sessions || []).filter((s) => s.status === "scheduled"),
    [publicLanding?.sessions],
  );
  const formFields = useMemo(
    () =>
      (publicLanding?.form_fields || [])
        .filter((f) => f.is_active)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [publicLanding?.form_fields],
  );

  const selectedSession: EventSession | null = useMemo(() => {
    if (selectedSessionId == null) return null;
    return sessions.find((s) => s.id === selectedSessionId) ?? null;
  }, [sessions, selectedSessionId]);

  const schema = useMemo(
    () => buildYupSchema(formFields, t),
    [formFields, t],
  );

  const form = useFormik({
    enableReinitialize: true,
    initialValues: initialAnswers(formFields, preferredLang),
    validationSchema: schema,
    onSubmit: async (values) => {
      if (!company) return;
      const answers: Record<string, unknown> = {};
      for (const f of formFields) {
        answers[f.field_key] = values[f.field_key];
      }
      await dispatch(
        registerPublicEvent({
          company_slug: company.slug,
          session_id: selectedSessionId,
          source_qr: sourceQr,
          answers,
        }),
      );
    },
  });

  const onCompanyTab = (slug: string) => {
    dispatch(clearPublicRegisterLocal());
    if (slug === company?.slug && !sessionCode) return;
    navigate(`/e/${slug}`);
  };

  const heading = company
    ? pickLabel(
        company.welcome_heading_en,
        company.welcome_heading_es,
        langEs,
      )
    : t("eventMarketing.public.fallbackHeading");
  const body = company
    ? pickLabel(company.welcome_body_en, company.welcome_body_es, langEs)
    : "";

  const mfsnUrl =
    publicRegisterResult?.mfsn_url || publicLanding?.mfsn_url || "";

  return (
    <div className="relative min-h-[100dvh] flex flex-col bg-background">
      <PageMeta
        title={
          company
            ? pickLabel(company.name, company.name_es, langEs)
            : t("eventMarketing.public.metaTitle")
        }
        description={t("eventMarketing.public.metaDescription")}
        titleFull
        noIndex
      />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.07] via-background to-muted/40" />
        <div className="absolute -top-24 right-[-10%] h-[28rem] w-[28rem] rounded-full bg-primary/[0.08] blur-3xl" />
        <div className="absolute bottom-[-10%] left-[-8%] h-[22rem] w-[22rem] rounded-full bg-accent/[0.07] blur-3xl" />
      </div>

      <header className="relative z-10 overflow-hidden border-b border-border/70">
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-primary/[0.08] via-card/90 to-accent/[0.06]"
        />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-2.5 px-4 py-6 sm:py-7">
          <div className="relative rounded-2xl border border-border/60 bg-card/90 px-5 py-3 shadow-sm shadow-primary/10 backdrop-blur-sm">
            <img
              src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_dark.png"
              alt={t("eventMarketing.public.brandName")}
              className="h-9 w-auto sm:h-11 dark:hidden"
            />
            <img
              src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_white.png"
              alt=""
              aria-hidden
              className="hidden h-9 w-auto sm:h-11 dark:block"
            />
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 mx-auto w-full max-w-xl px-4 py-8 sm:py-10 space-y-6">
        {companies.length > 1 && (
          <Tabs
            value={company?.slug || companies[0]?.slug}
            onValueChange={onCompanyTab}
          >
            <TabsList className="w-full flex flex-wrap h-auto gap-1 justify-start">
              {companies.map((c) => (
                <TabsTrigger
                  key={c.id}
                  value={c.slug}
                  className="flex-1 min-w-[7rem]"
                >
                  {pickLabel(c.name, c.name_es, langEs)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {publicLoading && !company ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-7 h-7 animate-spin" />
          </div>
        ) : publicError && !company ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-8 text-center space-y-3">
            <p className="text-sm text-destructive">{publicError}</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/e">{t("eventMarketing.public.tryAgain")}</Link>
            </Button>
          </div>
        ) : !companySlug && publicCompanies.length === 0 ? (
          <div className="rounded-xl border border-border bg-card/80 px-5 py-10 text-center text-sm text-muted-foreground">
            {t("eventMarketing.public.noEvents")}
          </div>
        ) : publicRegisterResult ? (
          <div className="rounded-xl border border-accent/30 bg-accent/[0.04] p-5 sm:p-7 space-y-5 animate-fade-up">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-7 h-7 text-accent shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <h1 className="text-xl font-bold text-foreground">
                  {t("eventMarketing.public.thanksTitle")}
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t("eventMarketing.public.thanksBody")}
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background/80 px-3 py-2.5">
                <Mail className="w-4 h-4 text-primary shrink-0" />
                <span>
                  {publicRegisterResult.email_sent
                    ? t("eventMarketing.public.checkEmail")
                    : t("eventMarketing.public.emailPending")}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background/80 px-3 py-2.5">
                <MessageSquare className="w-4 h-4 text-primary shrink-0" />
                <span>
                  {publicRegisterResult.sms_sent
                    ? t("eventMarketing.public.checkSms")
                    : t("eventMarketing.public.smsPending")}
                </span>
              </div>
            </div>
            {mfsnUrl && company?.offer_free_report && (
              <Button asChild className="w-full">
                <a href={mfsnUrl} target="_blank" rel="noopener noreferrer">
                  {t("eventMarketing.public.getReport")}
                  <ExternalLink className="w-4 h-4 ml-2" />
                </a>
              </Button>
            )}
          </div>
        ) : (
          <>
            <section className="text-center space-y-3 animate-fade-up">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground leading-tight">
                {heading}
              </h1>
              {body && (
                <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                  {body}
                </p>
              )}
            </section>

            {sessions.length > 0 && (
              <section className="rounded-xl border border-border bg-card/80 p-4 space-y-3 backdrop-blur-sm">
                <Label className="text-sm font-medium">
                  {t("eventMarketing.public.pickSession")}
                </Label>
                <Select
                  value={
                    selectedSessionId != null
                      ? String(selectedSessionId)
                      : undefined
                  }
                  onValueChange={(v) => setSelectedSessionId(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("eventMarketing.public.noSession")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {pickLabel(s.title_en, s.title_es, langEs)}
                        {" — "}
                        {formatSessionWhen(s.starts_at, langEs)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedSession && (
                  <p className="text-xs text-muted-foreground">
                    {pickLabel(
                      selectedSession.location_en || "",
                      selectedSession.location_es,
                      langEs,
                    ) || t("eventMarketing.public.locationTbd")}
                  </p>
                )}
              </section>
            )}

            <form
              onSubmit={form.handleSubmit}
              className="rounded-xl border border-border bg-card/90 p-4 sm:p-6 space-y-4 shadow-sm backdrop-blur-sm"
            >
              {formFields.map((field) => (
                <DynamicField
                  key={field.id}
                  field={field}
                  form={form}
                  langEs={langEs}
                />
              ))}

              {(publicRegisterError || form.status) && (
                <p className="text-sm text-destructive">
                  {publicRegisterError || String(form.status)}
                </p>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={publicRegistering || formFields.length === 0}
              >
                {publicRegistering && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {t("eventMarketing.public.submit")}
              </Button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

function DynamicField({
  field,
  form,
  langEs,
}: {
  field: EventFormField;
  form: ReturnType<typeof useFormik<Record<string, unknown>>>;
  langEs: boolean;
}) {
  const { t } = useTranslation();
  const label = pickLabel(field.label_en, field.label_es, langEs);
  const name = field.field_key;
  const touched = Boolean(form.touched[name]);
  const error =
    touched && form.errors[name] ? String(form.errors[name]) : null;
  const value = form.values[name];

  if (field.field_type === "checkbox") {
    return (
      <label className="flex items-start gap-2.5 text-sm text-foreground cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-ring"
          checked={Boolean(value)}
          onChange={(e) => form.setFieldValue(name, e.target.checked)}
          onBlur={() => form.setFieldTouched(name, true)}
        />
        <span>
          {label}
          {field.is_required ? " *" : ""}
        </span>
      </label>
    );
  }

  if (field.field_type === "language") {
    return (
      <div className="space-y-1.5">
        <Label>
          {label}
          {field.is_required ? " *" : ""}
        </Label>
        <Select
          value={String(value || "en")}
          onValueChange={(v) => form.setFieldValue(name, v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">{t("eventMarketing.public.langEn")}</SelectItem>
            <SelectItem value="es">{t("eventMarketing.public.langEs")}</SelectItem>
          </SelectContent>
        </Select>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (field.field_type === "select") {
    const options = field.options_json || [];
    return (
      <div className="space-y-1.5">
        <Label>
          {label}
          {field.is_required ? " *" : ""}
        </Label>
        <Select
          value={String(value || "")}
          onValueChange={(v) => form.setFieldValue(name, v)}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("eventMarketing.public.selectOption")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  if (field.field_type === "textarea") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={name}>
          {label}
          {field.is_required ? " *" : ""}
        </Label>
        <Textarea
          id={name}
          name={name}
          rows={3}
          value={String(value ?? "")}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          className={cn(error && "border-destructive")}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  const inputType =
    field.field_type === "email"
      ? "email"
      : field.field_type === "phone"
        ? "tel"
        : "text";

  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {field.is_required ? " *" : ""}
      </Label>
      <Input
        id={name}
        name={name}
        type={inputType}
        autoComplete={
          field.field_key === "email"
            ? "email"
            : field.field_key === "phone"
              ? "tel"
              : field.field_key === "first_name"
                ? "given-name"
                : field.field_key === "last_name"
                  ? "family-name"
                  : undefined
        }
        value={String(value ?? "")}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        className={cn(error && "border-destructive")}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

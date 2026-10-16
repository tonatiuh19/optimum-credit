import { useFormik } from "formik";
import * as Yup from "yup";
import { Link } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import {
  ShieldCheck,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Mail,
  MessageSquare,
  MapPin,
} from "lucide-react";
import PageMeta from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  submitGetCreditReportLead,
  clearGetCreditReportLead,
} from "@/store/slices/creditAnalysisSlice";
import { GET_CREDIT_REPORT_URLS } from "@/lib/getCreditReportLinks";
import { getCreditReportEventMeta } from "@/lib/getCreditReportEvent";
import { LEGAL_PATHS } from "@/lib/legal";

const schema = Yup.object({
  first_name: Yup.string().trim().required(),
  last_name: Yup.string().trim().required(),
  email: Yup.string().email().required(),
  phone: Yup.string().trim().min(10).required(),
  preferred_language: Yup.string().oneOf(["en", "es"]).required(),
  notes: Yup.string().trim().max(2000),
});

export default function GetCreditReport() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { gcrSubmitting, gcrError, gcrResult } = useAppSelector(
    (s) => s.creditAnalysis,
  );

  const form = useFormik({
    initialValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      preferred_language: (i18n.language?.startsWith("es") ? "es" : "en") as
        | "en"
        | "es",
      notes: "",
    },
    validationSchema: schema,
    onSubmit: async (values) => {
      await dispatch(
        submitGetCreditReportLead({
          first_name: values.first_name.trim(),
          last_name: values.last_name.trim(),
          email: values.email.trim(),
          phone: values.phone.trim(),
          preferred_language: values.preferred_language,
          notes: values.notes.trim() || undefined,
        }),
      );
    },
  });

  const mfsnUrl = gcrResult?.mfsn_url || GET_CREDIT_REPORT_URLS.free;
  const todayEvent = getCreditReportEventMeta();
  const isEs = i18n.language?.startsWith("es");
  const eventPlace = todayEvent
    ? isEs
      ? todayEvent.placeEs
      : todayEvent.placeEn
    : null;
  const eventDetail = todayEvent
    ? isEs
      ? todayEvent.detailEs
      : todayEvent.detailEn
    : null;

  return (
    <div className="w-full max-w-[100vw] overflow-x-hidden">
      <PageMeta
        title={t("getCreditReport.metaTitle")}
        description={t("getCreditReport.metaDescription")}
        canonical="/get-credit-report"
        noIndex
      />

      <section className="relative overflow-hidden bg-background pt-24 pb-4 md:pt-28 md:pb-6">
        <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/[0.08] to-transparent pointer-events-none" />
        <div className="absolute -top-16 -right-16 w-64 h-64 bg-accent/10 rounded-full blur-3xl pointer-events-none animate-float" />
        <div
          className="absolute top-32 -left-16 w-56 h-56 bg-primary/10 rounded-full blur-3xl pointer-events-none animate-float"
          style={{ animationDelay: "1.1s" }}
        />

        <div className="section-inner relative z-10 max-w-3xl mx-auto text-center px-4">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-foreground leading-tight mb-3">
            {t("getCreditReport.heading")}
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto">
            {t("getCreditReport.subheading")}
          </p>
          {todayEvent && eventPlace ? (
            <div className="mt-5 mx-auto max-w-md rounded-2xl border border-primary/20 bg-primary/[0.06] px-4 py-3.5 text-left shadow-sm animate-fade-up">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <MapPin className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                    {t("getCreditReport.eventTonight")}
                  </p>
                  <p className="text-sm font-bold text-foreground leading-snug">
                    {eventPlace}
                  </p>
                  {eventDetail ? (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {eventDetail}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="pb-16 md:pb-20 pt-2 md:pt-4">
        <div className="section-inner max-w-xl mx-auto px-4 space-y-6">
          {gcrResult ? (
            <div className="card-base p-5 md:p-8 space-y-5 animate-fade-up border-accent/30 bg-accent/[0.04]">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-7 h-7 text-accent shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <h2 className="text-lg font-bold text-foreground">
                    {t("getCreditReport.thanksTitle")}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t("getCreditReport.thanksBody")}
                  </p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background/80 px-3 py-2.5">
                  <Mail className="w-4 h-4 text-primary shrink-0" />
                  <span>{t("getCreditReport.checkEmail")}</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background/80 px-3 py-2.5">
                  <MessageSquare className="w-4 h-4 text-primary shrink-0" />
                  <span>{t("getCreditReport.checkSms")}</span>
                </div>
              </div>
              <Button
                asChild
                className="w-full h-12 text-base font-semibold gap-2"
              >
                <a href={mfsnUrl} rel="noopener noreferrer">
                  {t("getCreditReport.openReportNow")}
                  <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground underline hover:text-foreground w-full text-center"
                onClick={() => dispatch(clearGetCreditReportLead())}
              >
                {t("getCreditReport.submitAnother")}
              </button>
            </div>
          ) : (
            <form
              onSubmit={form.handleSubmit}
              className="card-base p-5 md:p-8 space-y-4 animate-fade-up"
            >
              <div className="space-y-1">
                <h2 className="text-base font-bold text-foreground">
                  {t("getCreditReport.formTitle")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("getCreditReport.formHint")}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t("getCreditReport.firstName")}
                  </label>
                  <input
                    className="mt-1 w-full h-11 px-3.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    {...form.getFieldProps("first_name")}
                  />
                  {form.touched.first_name && form.errors.first_name && (
                <p className="text-xs text-destructive mt-1">
                  {t("getCreditReport.fieldRequired")}
                </p>
              )}
            </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t("getCreditReport.lastName")}
                  </label>
                  <input
                    className="mt-1 w-full h-11 px-3.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    {...form.getFieldProps("last_name")}
                  />
              {form.touched.last_name && form.errors.last_name && (
                <p className="text-xs text-destructive mt-1">
                  {t("getCreditReport.fieldRequired")}
                </p>
              )}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("getCreditReport.email")}
                </label>
                <input
                  type="email"
                  className="mt-1 w-full h-11 px-3.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  {...form.getFieldProps("email")}
                />
              {form.touched.email && form.errors.email && (
                <p className="text-xs text-destructive mt-1">
                  {t("getCreditReport.emailInvalid")}
                </p>
              )}
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("getCreditReport.phone")}
                </label>
                <input
                  type="tel"
                  className="mt-1 w-full h-11 px-3.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  {...form.getFieldProps("phone")}
                />
              {form.touched.phone && form.errors.phone && (
                <p className="text-xs text-destructive mt-1">
                  {t("getCreditReport.phoneInvalid")}
                </p>
              )}
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("getCreditReport.language")}
                </label>
                <select
                  className="mt-1 w-full h-11 px-3.5 rounded-lg border border-input bg-background text-sm"
                  {...form.getFieldProps("preferred_language")}
                >
                  <option value="en">{t("getCreditReport.langEn")}</option>
                  <option value="es">{t("getCreditReport.langEs")}</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("getCreditReport.notes")}
                </label>
                <textarea
                  rows={3}
                  className="mt-1 w-full px-3.5 py-2.5 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-y"
                  placeholder={t("getCreditReport.notesPlaceholder")}
                  {...form.getFieldProps("notes")}
                />
              </div>

              {gcrError && (
                <p className="text-sm text-destructive" role="alert">
                  {gcrError}
                </p>
              )}

              <Button
                type="submit"
                disabled={gcrSubmitting}
                className="w-full h-12 text-base font-semibold gap-2"
              >
                {gcrSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("getCreditReport.submitting")}
                  </>
                ) : (
                  t("getCreditReport.submit")
                )}
              </Button>

              <p className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-accent" />
                <span>
                  <Trans
                    i18nKey="getCreditReport.trustNote"
                    components={{
                      privacy: (
                        <Link
                          to={LEGAL_PATHS.privacy}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary font-medium underline underline-offset-2 decoration-primary/40 hover:decoration-primary"
                        />
                      ),
                      terms: (
                        <Link
                          to={LEGAL_PATHS.terms}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary font-medium underline underline-offset-2 decoration-primary/40 hover:decoration-primary"
                        />
                      ),
                    }}
                  />
                </span>
              </p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

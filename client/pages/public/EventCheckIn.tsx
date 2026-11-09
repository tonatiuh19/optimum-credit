import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { CalendarDays, CheckCircle2, Clock, Loader2, MapPin, PartyPopper, UserPlus } from "lucide-react";
import PageMeta from "@/components/PageMeta";
import { EventPublicShell } from "@/components/public/EventPublicShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchPublicCheckIn, resetPublicCheckIn, submitPublicCheckIn } from "@/store/slices/eventMarketingSlice";
import { cn } from "@/lib/utils";

const phoneDigits = (v: string | undefined) => String(v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

/** Door QR page: guests check themselves in, or join on the spot (walk-in). */
export default function EventCheckIn() {
  const { token = "" } = useParams<{ token: string }>();
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { checkInInfo, checkInLoading, checkInError, checkInSubmitting, checkInStatus, checkInSubmitError } =
    useAppSelector((s) => s.eventMarketing);
  const es = i18n.language?.startsWith("es");
  const [useEmail, setUseEmail] = useState(false);
  const [lookup, setLookup] = useState<{ phone?: string; email?: string }>({});

  useEffect(() => {
    if (token) void dispatch(fetchPublicCheckIn(token));
    dispatch(resetPublicCheckIn());
  }, [dispatch, token]);

  const phoneRule = Yup.string()
    .required(t("eventMarketing.checkIn.required"))
    .test("phone", t("eventMarketing.checkIn.invalidPhone"), (v) => phoneDigits(v).length === 10);
  const emailRule = Yup.string().email(t("eventMarketing.checkIn.invalidEmail"));

  const lookupForm = useFormik({
    initialValues: { phone: "", email: "" },
    validationSchema: Yup.object(
      useEmail ? { email: emailRule.required(t("eventMarketing.checkIn.required")) } : { phone: phoneRule },
    ),
    onSubmit: (v) => {
      const body = useEmail ? { email: v.email.trim() } : { phone: v.phone.trim() };
      setLookup(body);
      void dispatch(submitPublicCheckIn({ token, body }));
    },
  });

  const walkInForm = useFormik({
    enableReinitialize: true,
    initialValues: {
      first_name: "",
      last_name: "",
      phone: lookup.phone || "",
      email: lookup.email || "",
      preferred_language: es ? "es" : "en",
    },
    validationSchema: Yup.object({
      first_name: Yup.string().trim().required(t("eventMarketing.checkIn.required")),
      last_name: Yup.string().trim().required(t("eventMarketing.checkIn.required")),
      phone: phoneRule,
      email: emailRule,
    }),
    onSubmit: (v) => {
      void dispatch(submitPublicCheckIn({ token, body: { answers: { ...v, email: v.email.trim() } } }));
    },
  });

  const reset = () => {
    dispatch(resetPublicCheckIn());
    lookupForm.resetForm();
    walkInForm.resetForm();
    setLookup({});
  };

  const s = checkInInfo?.session;
  const when = useMemo(() => {
    if (!s) return "";
    const d = new Date(`${s.starts_at.slice(0, 19)}Z`);
    return d.toLocaleString(es ? "es-US" : "en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }, [s, es]);

  const done = checkInStatus === "checked_in" || checkInStatus === "already_checked_in";

  return (
    <>
      <PageMeta title={t("eventMarketing.checkIn.metaTitle")} description={t("eventMarketing.checkIn.metaTitle")} titleFull noIndex />
      <EventPublicShell>
        {checkInLoading && !checkInInfo ? (
          <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="w-7 h-7 animate-spin" /></div>
        ) : checkInError || !checkInInfo || !s ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-8 text-center text-sm text-destructive">
            {t("eventMarketing.checkIn.notFound")}
          </div>
        ) : (
          <>
            <section className="text-center space-y-2 animate-fade-up">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                {es && checkInInfo.company.name_es ? checkInInfo.company.name_es : checkInInfo.company.name}
              </p>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">{es ? s.title_es : s.title_en}</h1>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1"><CalendarDays className="w-4 h-4" />{when}</span>
                {(es ? s.location_es || s.location_en : s.location_en) && (
                  <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4" />{es ? s.location_es || s.location_en : s.location_en}</span>
                )}
              </div>
            </section>

            {!checkInInfo.window_open ? (
              <div className="rounded-xl border border-border bg-card p-6 text-center space-y-2">
                <Clock className="w-8 h-8 mx-auto text-primary" />
                <h2 className="text-lg font-bold text-foreground">{t("eventMarketing.checkIn.closedTitle")}</h2>
                <p className="text-sm text-muted-foreground">{t("eventMarketing.checkIn.closedBody")}</p>
              </div>
            ) : done ? (
              <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-7 text-center space-y-3 animate-in fade-in zoom-in-95 duration-300" data-testid="checkin-done">
                {checkInStatus === "checked_in" ? (
                  <PartyPopper className="w-12 h-12 mx-auto text-accent animate-bounce" />
                ) : (
                  <CheckCircle2 className="w-12 h-12 mx-auto text-accent" />
                )}
                <h2 className="text-2xl font-bold text-foreground">
                  {checkInStatus === "checked_in" ? t("eventMarketing.checkIn.successTitle") : t("eventMarketing.checkIn.alreadyTitle")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {checkInStatus === "checked_in" ? t("eventMarketing.checkIn.successBody") : t("eventMarketing.checkIn.alreadyBody")}
                </p>
                <Button variant="outline" onClick={reset}>{t("eventMarketing.checkIn.nextPerson")}</Button>
              </div>
            ) : checkInStatus === "needs_registration" ? (
              <form onSubmit={walkInForm.handleSubmit} className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-4 animate-fade-up" noValidate>
                <div className="flex items-start gap-3">
                  <UserPlus className="w-6 h-6 text-primary shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{t("eventMarketing.checkIn.walkInTitle")}</h2>
                    <p className="text-sm text-muted-foreground">{t("eventMarketing.checkIn.walkInBody")}</p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField form={walkInForm} name="first_name" label={t("eventMarketing.checkIn.firstName")} autoComplete="given-name" />
                  <FormField form={walkInForm} name="last_name" label={t("eventMarketing.checkIn.lastName")} autoComplete="family-name" />
                  <FormField form={walkInForm} name="phone" label={t("eventMarketing.checkIn.phone")} type="tel" autoComplete="tel" />
                  <FormField form={walkInForm} name="email" label={t("eventMarketing.checkIn.email")} type="email" autoComplete="email" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("eventMarketing.checkIn.language")}</Label>
                  <div className="flex gap-2">
                    {(["es", "en"] as const).map((l) => (
                      <Button
                        key={l}
                        type="button"
                        size="sm"
                        variant={walkInForm.values.preferred_language === l ? "default" : "outline"}
                        onClick={() => walkInForm.setFieldValue("preferred_language", l)}
                      >
                        {l === "es" ? t("eventMarketing.public.langEs") : t("eventMarketing.public.langEn")}
                      </Button>
                    ))}
                  </div>
                </div>
                {checkInSubmitError && <p className="text-sm text-destructive">{checkInSubmitError}</p>}
                <div className="flex flex-col-reverse sm:flex-row gap-2">
                  <Button type="button" variant="ghost" onClick={reset}>{t("eventMarketing.admin.cancel")}</Button>
                  <Button type="submit" className="flex-1" disabled={checkInSubmitting}>
                    {checkInSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {t("eventMarketing.checkIn.walkInSubmit")}
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={lookupForm.handleSubmit} className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-4 animate-fade-up" noValidate>
                <h2 className="text-lg font-bold text-foreground text-center">{t("eventMarketing.checkIn.title")}</h2>
                {useEmail ? (
                  <FormField form={lookupForm} name="email" label={t("eventMarketing.checkIn.emailLabel")} type="email" autoComplete="email" big />
                ) : (
                  <FormField form={lookupForm} name="phone" label={t("eventMarketing.checkIn.lookupLabel")} hint={t("eventMarketing.checkIn.lookupHint")} type="tel" autoComplete="tel" big />
                )}
                {checkInSubmitError && <p className="text-sm text-destructive">{checkInSubmitError}</p>}
                <Button type="submit" size="lg" className="w-full" disabled={checkInSubmitting}>
                  {checkInSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {t("eventMarketing.checkIn.lookupSubmit")}
                </Button>
                <button
                  type="button"
                  className="block mx-auto text-xs text-primary underline-offset-2 hover:underline"
                  onClick={() => {
                    setUseEmail((u) => !u);
                    lookupForm.setErrors({});
                  }}
                >
                  {useEmail ? t("eventMarketing.checkIn.usePhone") : t("eventMarketing.checkIn.useEmail")}
                </button>
              </form>
            )}
          </>
        )}
      </EventPublicShell>
    </>
  );
}

type AnyFormik = ReturnType<typeof useFormik<any>>;

function FormField({
  form,
  name,
  label,
  hint,
  type = "text",
  autoComplete,
  big,
}: {
  form: AnyFormik;
  name: string;
  label: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  big?: boolean;
}) {
  const error = form.touched[name] && form.errors[name] ? String(form.errors[name]) : null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`ci-${name}`}>{label}</Label>
      <Input
        id={`ci-${name}`}
        name={name}
        type={type}
        inputMode={type === "tel" ? "tel" : undefined}
        autoComplete={autoComplete}
        value={form.values[name] ?? ""}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        className={cn(big && "h-12 text-lg", error && "border-destructive")}
      />
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

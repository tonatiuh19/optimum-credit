import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import LegalConsent from "@/components/LegalConsent";
import PageMeta from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  joinAffiliateInvite,
  resolveAffiliateInvite,
} from "@/store/slices/affiliatesSlice";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/utils";

export default function AffiliateJoin() {
  const { token = "" } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    publicInvite,
    publicInviteLoading,
    publicInviteError,
    publicJoinSubmitting,
  } = useAppSelector((s) => s.affiliates);
  const [doneEmail, setDoneEmail] = useState<string | null>(null);
  const [agreedTerms, setAgreedTerms] = useState(true);
  const [agreedSms, setAgreedSms] = useState(true);
  const [consentError, setConsentError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    dispatch(resolveAffiliateInvite({ token })).catch((e) =>
      logger.warn("invite resolve failed", e),
    );
  }, [dispatch, token]);

  const schema = useMemo(
    () =>
      Yup.object({
        first_name: Yup.string()
          .trim()
          .required(t("common.required")),
        last_name: Yup.string()
          .trim()
          .required(t("common.required")),
        email: Yup.string()
          .email(t("common.invalidEmail"))
          .required(t("common.required")),
        phone: Yup.string(),
      }),
    [t],
  );

  const form = useFormik({
    initialValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
    },
    validationSchema: schema,
    onSubmit: async (values) => {
      if (!agreedTerms || !agreedSms) {
        setConsentError(t("legal.consentRequired"));
        return;
      }
      setConsentError(null);
      const res = await dispatch(
        joinAffiliateInvite({
          token,
          first_name: values.first_name.trim(),
          last_name: values.last_name.trim(),
          email: values.email.trim(),
          phone: values.phone.trim() || null,
          agreed_terms: true,
          agreed_sms: true,
        }),
      );
      if (joinAffiliateInvite.fulfilled.match(res)) {
        setDoneEmail(res.payload.email);
      }
    },
  });

  const planLabel = publicInvite
    ? t(
        `affiliates.admin.plan${
          publicInvite.plan === "sub_affiliate"
            ? "SubAffiliate"
            : publicInvite.plan === "master"
              ? "Master"
              : "Standard"
        }`,
      )
    : "";

  return (
    <div className="relative min-h-[100dvh] flex flex-col bg-background">
      <PageMeta
        title={t("affiliates.join.metaTitle")}
        description={t("affiliates.join.metaDescription")}
        titleFull
        noIndex
      />

      {/* Ambient backdrop — no flat single color */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.07] via-background to-muted/40" />
        <div className="absolute -top-24 right-[-10%] h-[28rem] w-[28rem] rounded-full bg-primary/[0.08] blur-3xl" />
        <div className="absolute bottom-[-10%] left-[-8%] h-[22rem] w-[22rem] rounded-full bg-accent/[0.07] blur-3xl" />
      </div>

      {/* Brand header — real logo, no nav links */}
      <header className="relative z-10 overflow-hidden border-b border-border/70">
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-primary/[0.08] via-card/90 to-accent/[0.06]"
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent"
        />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-2.5 px-4 py-6 sm:py-7">
          <div className="group relative">
            <div
              aria-hidden
              className="absolute -inset-4 rounded-full bg-primary/10 blur-2xl transition-opacity duration-500 group-hover:opacity-100 opacity-70"
            />
            <div className="relative rounded-2xl border border-border/60 bg-card/90 px-5 py-3 shadow-sm shadow-primary/10 backdrop-blur-sm transition-transform duration-300 group-hover:scale-[1.02]">
              <img
                src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_dark.png"
                alt={t("affiliates.join.brandName")}
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
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-px w-6 bg-gradient-to-r from-transparent to-primary/40"
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("affiliates.join.eyebrow")}
            </p>
            <span
              aria-hidden
              className="h-px w-6 bg-gradient-to-l from-transparent to-primary/40"
            />
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-lg flex-1 px-4 py-8 sm:px-6 sm:py-12">
          {publicInviteLoading ? (
            <div className="flex justify-center py-24 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
          ) : publicInviteError && !publicInvite ? (
            <StatusCard
              title={t("affiliates.join.invalidTitle")}
              body={publicInviteError}
              action={
                <Button asChild variant="outline">
                  <Link to="/">{t("affiliates.join.goHome")}</Link>
                </Button>
              }
            />
          ) : doneEmail ? (
            <StatusCard
              icon={
                <CheckCircle2 className="mx-auto h-14 w-14 text-accent" />
              }
              title={t("affiliates.join.successTitle")}
              body={t("affiliates.join.successBody", { email: doneEmail })}
              centered
              action={
                <Button asChild className="w-full">
                  <Link to="/admin/login">{t("affiliates.join.goLogin")}</Link>
                </Button>
              }
            />
          ) : publicInvite && !publicInvite.is_open ? (
            <StatusCard
              title={t("affiliates.join.closedTitle")}
              body={t("affiliates.join.closedBody")}
            />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm shadow-primary/5">
              <div className="border-b border-border/70 bg-gradient-to-r from-primary/[0.06] to-transparent px-5 py-5 sm:px-7 sm:py-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                  {t("affiliates.join.formEyebrow")}
                </p>
                <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground sm:text-[1.65rem]">
                  {t("affiliates.join.title")}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t("affiliates.join.subtitle")}
                </p>
                {publicInvite && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-semibold text-primary">
                      {t("affiliates.join.planLine", { plan: planLabel })}
                    </span>
                    {publicInvite.parent_name ? (
                      <span className="text-[11px] text-muted-foreground">
                        {t("affiliates.join.parentLine", {
                          name: publicInvite.parent_name,
                        })}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              <form
                onSubmit={form.handleSubmit}
                className="space-y-5 px-5 py-5 sm:px-7 sm:py-6"
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    id="aff-join-first"
                    label={t("affiliates.admin.fieldFirstName")}
                    error={
                      form.touched.first_name
                        ? form.errors.first_name
                        : undefined
                    }
                  >
                    <Input
                      id="aff-join-first"
                      autoComplete="given-name"
                      {...form.getFieldProps("first_name")}
                      className={cn(
                        form.touched.first_name &&
                          form.errors.first_name &&
                          "border-destructive",
                      )}
                    />
                  </Field>
                  <Field
                    id="aff-join-last"
                    label={t("affiliates.admin.fieldLastName")}
                    error={
                      form.touched.last_name ? form.errors.last_name : undefined
                    }
                  >
                    <Input
                      id="aff-join-last"
                      autoComplete="family-name"
                      {...form.getFieldProps("last_name")}
                      className={cn(
                        form.touched.last_name &&
                          form.errors.last_name &&
                          "border-destructive",
                      )}
                    />
                  </Field>
                </div>

                <Field
                  id="aff-join-email"
                  label={t("affiliates.admin.fieldEmail")}
                  error={form.touched.email ? form.errors.email : undefined}
                >
                  <Input
                    id="aff-join-email"
                    type="email"
                    autoComplete="email"
                    {...form.getFieldProps("email")}
                    className={cn(
                      form.touched.email &&
                        form.errors.email &&
                        "border-destructive",
                    )}
                  />
                </Field>

                <Field
                  id="aff-join-phone"
                  label={t("affiliates.admin.fieldPhone")}
                >
                  <Input
                    id="aff-join-phone"
                    type="tel"
                    autoComplete="tel"
                    {...form.getFieldProps("phone")}
                  />
                </Field>

                <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3.5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    {t("affiliates.join.consentTitle")}
                  </div>
                  <LegalConsent
                    agreedTerms={agreedTerms}
                    agreedSms={agreedSms}
                    onAgreedTermsChange={(v) => {
                      setAgreedTerms(v);
                      if (v && agreedSms) setConsentError(null);
                    }}
                    onAgreedSmsChange={(v) => {
                      setAgreedSms(v);
                      if (v && agreedTerms) setConsentError(null);
                    }}
                    error={consentError}
                  />
                </div>

                {publicInviteError && (
                  <p className="text-sm text-destructive" role="alert">
                    {publicInviteError}
                  </p>
                )}

                <Button
                  type="submit"
                  className="h-11 w-full text-sm font-semibold"
                  disabled={publicJoinSubmitting}
                >
                  {publicJoinSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t("affiliates.join.submit")}
                </Button>

                <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                  {t("affiliates.join.secureNote")}
                </p>
              </form>
            </div>
          )}
        </div>

        <footer className="relative z-10 border-t border-border/60 bg-card/50 py-4 text-center">
          <p className="px-4 text-[11px] text-muted-foreground">
            {t("affiliates.join.footer", {
              year: new Date().getFullYear(),
            })}
          </p>
        </footer>
      </main>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function StatusCard({
  title,
  body,
  action,
  icon,
  centered,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  centered?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8",
        centered && "text-center",
      )}
    >
      {icon}
      <h1
        className={cn(
          "text-xl font-bold tracking-tight text-foreground",
          icon && "mt-4",
        )}
      >
        {title}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

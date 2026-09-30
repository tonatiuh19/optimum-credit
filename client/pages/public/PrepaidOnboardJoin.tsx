import { useEffect } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import PageMeta from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearPrepaidPublicState,
  fetchPublicPrepaidOnboardInvite,
  redeemPrepaidOnboardInvite,
} from "@/store/slices/prepaidOnboardSlice";
import { applyClientSession, fetchClientMe } from "@/store/slices/clientAuthSlice";
import { logger } from "@/utils/logger";

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PrepaidOnboardJoin() {
  const { t, i18n } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const {
    publicInvite,
    publicLoading,
    publicError,
    redeeming,
    redeemError,
    redeemSuccess,
  } = useAppSelector((s) => s.prepaidOnboard);

  useEffect(() => {
    dispatch(clearPrepaidPublicState());
    if (token) dispatch(fetchPublicPrepaidOnboardInvite(token));
    return () => {
      dispatch(clearPrepaidPublicState());
    };
  }, [token, dispatch]);

  useEffect(() => {
    if (!redeemSuccess) return;
    let cancelled = false;
    (async () => {
      if (redeemSuccess.token) {
        dispatch(
          applyClientSession({
            token: redeemSuccess.token,
            user: {
              id: redeemSuccess.user.id,
              email: redeemSuccess.user.email || "",
              first_name: redeemSuccess.user.first_name,
              last_name: redeemSuccess.user.last_name,
              pipeline_stage: "new_client",
              status: "onboarding",
              created_at: new Date().toISOString(),
            },
          }),
        );
        try {
          await dispatch(fetchClientMe()).unwrap();
        } catch (e) {
          logger.warn("prepaidOnboard", "fetchClientMe after redeem", e);
        }
      }
      if (cancelled) return;
      const dest = redeemSuccess.redirect || "/portal/documents";
      // Absolute onboarding fallback when session mint failed
      if (dest.startsWith("http")) {
        window.location.assign(dest);
        return;
      }
      navigate(dest, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [redeemSuccess, dispatch, navigate]);

  const langLocked = !!publicInvite?.preferred_language;

  const formik = useFormik({
    enableReinitialize: true,
    initialValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      preferred_language:
        (publicInvite?.preferred_language as "en" | "es") ||
        (i18n.language?.startsWith("es") ? "es" : "en"),
    },
    validationSchema: Yup.object({
      first_name: Yup.string().required(t("prepaidOnboard.joinFirstRequired")),
      last_name: Yup.string().required(t("prepaidOnboard.joinLastRequired")),
      email: Yup.string()
        .email(t("prepaidOnboard.joinEmailInvalid"))
        .required(t("prepaidOnboard.joinEmailRequired")),
      phone: Yup.string(),
      preferred_language: Yup.string().oneOf(["en", "es"]),
    }),
    onSubmit: async (values) => {
      if (!token) return;
      try {
        await dispatch(
          redeemPrepaidOnboardInvite({
            token,
            payload: {
              first_name: values.first_name.trim(),
              last_name: values.last_name.trim(),
              email: values.email.trim(),
              phone: values.phone.trim() || null,
              preferred_language: langLocked
                ? publicInvite!.preferred_language!
                : values.preferred_language,
            },
          }),
        ).unwrap();
      } catch (e) {
        logger.error("prepaidOnboard", "redeem failed", e);
      }
    },
  });

  return (
    <div className="w-full max-w-[100vw] overflow-x-hidden min-h-[70vh]">
      <PageMeta
        title={t("prepaidOnboard.metaTitle")}
        description={t("prepaidOnboard.metaDescription")}
        canonical="/join"
        noIndex
      />

      <section className="relative overflow-hidden bg-background pt-24 pb-10 md:pt-28">
        <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/[0.08] to-transparent pointer-events-none" />
        <div className="section-inner relative z-10 max-w-lg mx-auto px-4">
          <div className="text-center mb-8">
            <img
              src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_white.png"
              alt="Optimum Credit"
              className="h-10 w-auto mx-auto mb-4"
            />
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
              {t("prepaidOnboard.joinHeading")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("prepaidOnboard.joinSubheading")}
            </p>
          </div>

          {publicLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : publicError || !publicInvite ? (
            <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
              <p className="text-sm font-semibold text-foreground">
                {t("prepaidOnboard.joinClosedTitle")}
              </p>
              <p className="text-sm text-muted-foreground">
                {publicError || t("prepaidOnboard.joinClosedBody")}
              </p>
              <Button asChild variant="outline">
                <Link to="/portal/login">{t("prepaidOnboard.goLogin")}</Link>
              </Button>
            </div>
          ) : redeemSuccess ? (
            <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
              <ShieldCheck className="w-8 h-8 text-accent mx-auto" />
              <p className="text-sm font-semibold text-foreground">
                {t("prepaidOnboard.joinSuccess", {
                  name: redeemSuccess.user.first_name,
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("prepaidOnboard.joinRedirecting")}
              </p>
              <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto" />
            </div>
          ) : (
            <form
              onSubmit={formik.handleSubmit}
              className="rounded-2xl border border-border bg-card p-6 space-y-4 shadow-sm"
            >
              <div className="rounded-lg bg-accent/10 border border-accent/20 p-3 text-sm">
                <p className="font-semibold text-foreground">
                  {publicInvite.package_name}
                </p>
                <p className="text-muted-foreground mt-1">
                  {t("prepaidOnboard.joinPaidSummary", {
                    label: publicInvite.paid_label,
                    amount: formatMoney(publicInvite.paid_amount_cents),
                  })}
                </p>
                {publicInvite.remaining_count > 0 ? (
                  <p className="text-muted-foreground mt-1">
                    {t("prepaidOnboard.joinRemainingSummary", {
                      count: publicInvite.remaining_count,
                    })}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t("prepaidOnboard.firstName")}
                  </label>
                  <Input
                    name="first_name"
                    value={formik.values.first_name}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    data-testid="join-first-name"
                  />
                  {formik.touched.first_name && formik.errors.first_name ? (
                    <p className="text-xs text-destructive">
                      {formik.errors.first_name}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t("prepaidOnboard.lastName")}
                  </label>
                  <Input
                    name="last_name"
                    value={formik.values.last_name}
                    onChange={formik.handleChange}
                    onBlur={formik.handleBlur}
                    data-testid="join-last-name"
                  />
                  {formik.touched.last_name && formik.errors.last_name ? (
                    <p className="text-xs text-destructive">
                      {formik.errors.last_name}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("prepaidOnboard.email")}
                </label>
                <Input
                  name="email"
                  type="email"
                  value={formik.values.email}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  data-testid="join-email"
                />
                {formik.touched.email && formik.errors.email ? (
                  <p className="text-xs text-destructive">
                    {formik.errors.email}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("prepaidOnboard.phone")}
                </label>
                <Input
                  name="phone"
                  value={formik.values.phone}
                  onChange={formik.handleChange}
                  data-testid="join-phone"
                />
              </div>

              {!langLocked ? (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t("prepaidOnboard.language")}
                  </label>
                  <Select
                    value={formik.values.preferred_language}
                    onValueChange={(v) =>
                      formik.setFieldValue("preferred_language", v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {redeemError ? (
                <p className="text-sm text-destructive">{redeemError}</p>
              ) : null}

              <Button
                type="submit"
                className="w-full"
                disabled={redeeming}
                data-testid="join-submit"
              >
                {redeeming ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                {t("prepaidOnboard.joinSubmit")}
              </Button>
              <p className="text-[11px] text-center text-muted-foreground">
                {t("prepaidOnboard.joinNoCharge")}
              </p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

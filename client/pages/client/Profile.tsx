import { useState } from "react";
import {
  CheckCircle2,
  Globe,
  Mail,
  Phone,
  User,
  Edit2,
  X,
  ShieldCheck,
} from "lucide-react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  submitSmartCredit,
  updateProfile,
  updateLanguage,
} from "@/store/slices/portalSlice";
import { fetchClientMe } from "@/store/slices/clientAuthSlice";
import i18n from "@/i18n";

export default function Profile() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((s) => s.clientAuth);
  const [scSaved, setScSaved] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoSaved, setInfoSaved] = useState(false);

  const scForm = useFormik({
    initialValues: { smart_credit_email: "" },
    validationSchema: Yup.object({
      smart_credit_email: Yup.string()
        .email(t("profile.invalidEmail"))
        .required(t("profile.required")),
    }),
    onSubmit: async (values) => {
      const r = await dispatch(submitSmartCredit(values));
      if (submitSmartCredit.fulfilled.match(r)) {
        setScSaved(true);
        dispatch(fetchClientMe());
      }
    },
  });

  const infoForm = useFormik({
    enableReinitialize: true,
    initialValues: {
      first_name: user?.first_name || "",
      last_name: user?.last_name || "",
      phone: user?.phone || "",
    },
    validationSchema: Yup.object({
      first_name: Yup.string().required(t("profile.required")),
      last_name: Yup.string().required(t("profile.required")),
      phone: Yup.string().optional(),
    }),
    onSubmit: async (values) => {
      const r = await dispatch(updateProfile(values));
      if (updateProfile.fulfilled.match(r)) {
        setInfoSaved(true);
        setEditingInfo(false);
        dispatch(fetchClientMe());
        setTimeout(() => setInfoSaved(false), 3000);
      }
    },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">{t("profile.heading")}</h1>
        <p className="text-muted-foreground mt-1">{t("profile.subheading")}</p>
      </div>

      {/* Account info */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">
            {t("profile.accountInfo")}
          </h2>
          {!editingInfo ? (
            <button
              onClick={() => setEditingInfo(true)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" /> {t("profile.edit")}
            </button>
          ) : (
            <button
              onClick={() => {
                setEditingInfo(false);
                infoForm.resetForm();
              }}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" /> {t("profile.cancel")}
            </button>
          )}
        </div>

        {!editingInfo ? (
          <div className="space-y-3 text-sm">
            <InfoRow
              icon={User}
              label={t("profile.name")}
              value={
                `${user?.first_name || ""} ${user?.last_name || ""}`.trim() ||
                "—"
              }
            />
            <InfoRow
              icon={Mail}
              label={t("profile.email")}
              value={user?.email || "—"}
            />
            <InfoRow
              icon={Phone}
              label={t("profile.phone")}
              value={user?.phone || "—"}
            />
            {infoSaved && (
              <p className="text-xs text-accent flex items-center gap-1.5 pt-1">
                <CheckCircle2 className="w-4 h-4" /> {t("profile.changesSaved")}
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={infoForm.handleSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  {t("profile.firstName")}
                </label>
                <input
                  {...infoForm.getFieldProps("first_name")}
                  className="w-full h-10 px-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
                {infoForm.touched.first_name && infoForm.errors.first_name && (
                  <p className="text-xs text-destructive mt-1">
                    {infoForm.errors.first_name}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  {t("profile.lastName")}
                </label>
                <input
                  {...infoForm.getFieldProps("last_name")}
                  className="w-full h-10 px-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
                {infoForm.touched.last_name && infoForm.errors.last_name && (
                  <p className="text-xs text-destructive mt-1">
                    {infoForm.errors.last_name}
                  </p>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                {t("profile.phoneOptional")}
              </label>
              <input
                {...infoForm.getFieldProps("phone")}
                type="tel"
                placeholder={t("profile.phonePlaceholder")}
                className="w-full h-10 px-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={infoForm.isSubmitting}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {infoForm.isSubmitting
                  ? t("profile.saving")
                  : t("profile.saveChanges")}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Smart Credit */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              {t("profile.smartCreditHeading")}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("profile.smartCreditDesc")}
            </p>
          </div>
        </div>

        {user?.smart_credit_connected_at ? (
          <div className="flex items-center gap-2 text-accent text-sm font-medium bg-accent/10 rounded-xl px-4 py-3">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            {t("profile.connected")}
          </div>
        ) : (
          <form onSubmit={scForm.handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                {t("profile.smartCreditEmail")}
              </label>
              <input
                {...scForm.getFieldProps("smart_credit_email")}
                type="email"
                placeholder={t("profile.smartCreditPlaceholder")}
                className="w-full h-10 px-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              />
              {scForm.touched.smart_credit_email &&
                scForm.errors.smart_credit_email && (
                  <p className="text-xs text-destructive mt-1">
                    {scForm.errors.smart_credit_email}
                  </p>
                )}
            </div>
            <button
              type="submit"
              disabled={scForm.isSubmitting}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {scForm.isSubmitting ? "Connecting…" : "Connect Smart Credit"}
            </button>
            {scSaved && (
              <p className="text-sm text-accent flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Connected successfully
              </p>
            )}
          </form>
        )}
      </div>

      {/* Language Preference */}
      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Globe className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              {t("profile.languagePreference")}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("profile.languageDesc")}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          {(["en", "es"] as const).map((lang) => {
            const isActive = i18n.language === lang;
            return (
              <button
                key={lang}
                onClick={async () => {
                  if (isActive) return;
                  await i18n.changeLanguage(lang);
                  await dispatch(updateLanguage({ language: lang }));
                  dispatch(fetchClientMe());
                }}
                className={`flex-1 h-10 rounded-lg text-sm font-medium border transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                }`}
              >
                {lang === "en" ? t("profile.english") : t("profile.spanish")}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-16 shrink-0">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

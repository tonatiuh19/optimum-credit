import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  Handshake,
  Loader2,
  Copy,
  Check,
  Lock,
  Sparkles,
  MousePointerClick,
  Users,
  Wallet,
  BadgeDollarSign,
  UserPlus,
  Crown,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import FieldHint from "@/components/admin/FieldHint";
import NoEmailWarning from "@/components/admin/NoEmailWarning";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchMyAffiliateProfile,
  updateMyAffiliateProfile,
  subscribeMyAffiliate,
  createAffiliateLead,
  inviteSubAffiliate,
  fetchMyCommissions,
} from "@/store/slices/affiliatesSlice";
import AcceptCardFields, { type AcceptCardHandle } from "@/components/AcceptCardFields";
import type { AffiliateLanding, AffiliateCommissionStatus } from "@shared/api";

function fmtCents(cents: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toAbsoluteUrl(link: string) {
  if (/^https?:\/\//.test(link)) return link;
  if (typeof window === "undefined") return link;
  return `${window.location.origin}${link}`;
}

const COMMISSION_STATUS_CLASS: Record<AffiliateCommissionStatus, string> = {
  pending: "bg-yellow-500/10 text-yellow-700 border-yellow-400/30",
  approved: "bg-primary/10 text-primary border-primary/30",
  paid: "bg-accent/10 text-accent border-accent/30",
  void: "bg-muted text-muted-foreground border-border",
};

// ─── Copyable link row ──────────────────────────────────────────────────────

function CopyRow({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const abs = toAbsoluteUrl(value);

  const handleCopy = () => {
    navigator.clipboard.writeText(abs).then(() => {
      setCopied(true);
      toast({ description: t("affiliates.portal.copied") });
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground truncate font-mono">{abs}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant={copied ? "secondary" : "outline"}
        className="h-8 shrink-0 gap-1.5"
        onClick={handleCopy}
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? t("affiliates.portal.copied") : t("affiliates.portal.copy")}
      </Button>
    </div>
  );
}

// ─── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MousePointerClick;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
        <p className="text-xs text-muted-foreground truncate">{label}</p>
      </div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function AdminAffiliatePortal() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { toast } = useToast();
  const cardRef = useRef<AcceptCardHandle>(null);

  const {
    myProfile,
    myProfileLoading,
    mySubscribing,
    error,
    leadSubmitting,
    inviteSubmitting,
    myCommissions,
    myCommissionsLoading,
    saving,
  } = useAppSelector((s) => s.affiliates);

  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchMyAffiliateProfile());
  }, [dispatch]);

  useEffect(() => {
    if (myProfile?.affiliate.has_portal_access) {
      dispatch(fetchMyCommissions());
    }
  }, [dispatch, myProfile?.affiliate.has_portal_access]);

  const handleSubscribe = async () => {
    setSubscribeError(null);
    if (!cardRef.current) return;
    try {
      const { dataDescriptor, dataValue } = await cardRef.current.tokenize();
      const res = await dispatch(subscribeMyAffiliate({ dataDescriptor, dataValue }));
      if (subscribeMyAffiliate.fulfilled.match(res)) {
        toast({ title: t("affiliates.portal.subscribeSuccess") });
      } else {
        setSubscribeError(String(res.payload || ""));
      }
    } catch (e: any) {
      setSubscribeError(e?.message || "Card tokenization failed");
    }
  };

  const profileForm = useFormik({
    enableReinitialize: true,
    initialValues: {
      default_landing: myProfile?.affiliate.default_landing ?? "credit_analysis",
      bio: myProfile?.affiliate.bio ?? "",
      phone: myProfile?.affiliate.phone ?? "",
    },
    onSubmit: async (vals) => {
      const res = await dispatch(
        updateMyAffiliateProfile({
          default_landing: vals.default_landing as AffiliateLanding,
          bio: vals.bio.trim() || null,
          phone: vals.phone.trim() || null,
        }),
      );
      if (updateMyAffiliateProfile.fulfilled.match(res)) {
        toast({ title: t("affiliates.portal.saveSuccess") });
      }
    },
  });

  const leadSchema = Yup.object({
    first_name: Yup.string().trim().required(t("common.required")),
    last_name: Yup.string().trim().required(t("common.required")),
    email: Yup.string()
      .trim()
      .transform((v, orig) => {
        const raw =
          typeof orig === "string" ? orig.trim() : String(v ?? "").trim();
        return raw === "" ? null : raw;
      })
      .nullable()
      .notRequired()
      .test("email-format", t("common.invalidEmail"), (v) => {
        if (v == null || v === "") return true;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      }),
    phone: Yup.string().trim().nullable(),
  }).test("contact-required", function (values) {
    const email = String(values?.email ?? "").trim();
    const phone = String(values?.phone ?? "").trim();
    if (email || phone) return true;
    return this.createError({
      path: "email",
      message: t("adminHelpers.contactRequired"),
    });
  });

  const leadForm = useFormik({
    initialValues: { first_name: "", last_name: "", email: "", phone: "" },
    validationSchema: leadSchema,
    onSubmit: async (vals, { resetForm }) => {
      const res = await dispatch(
        createAffiliateLead({
          first_name: vals.first_name.trim(),
          last_name: vals.last_name.trim(),
          email: String(vals.email ?? "").trim().toLowerCase() || null,
          phone: String(vals.phone ?? "").trim() || null,
        }),
      );
      if (createAffiliateLead.fulfilled.match(res)) {
        toast({ title: t("affiliates.portal.leadSuccess") });
        resetForm();
      } else {
        toast({ description: String(res.payload || ""), variant: "destructive" });
      }
    },
  });

  const inviteSchema = Yup.object({
    first_name: Yup.string().trim().required(t("common.required")),
    last_name: Yup.string().trim().required(t("common.required")),
    email: Yup.string()
      .email(t("common.invalidEmail"))
      .required(t("common.required")),
    phone: Yup.string().trim(),
  });

  const inviteForm = useFormik({
    initialValues: { first_name: "", last_name: "", email: "", phone: "" },
    validationSchema: inviteSchema,
    onSubmit: async (vals, { resetForm }) => {
      const res = await dispatch(
        inviteSubAffiliate({
          first_name: vals.first_name.trim(),
          last_name: vals.last_name.trim(),
          email: vals.email.trim().toLowerCase(),
          phone: vals.phone.trim() || null,
        }),
      );
      if (inviteSubAffiliate.fulfilled.match(res)) {
        toast({ title: t("affiliates.portal.inviteSuccess") });
        resetForm();
      } else {
        toast({ description: String(res.payload || ""), variant: "destructive" });
      }
    },
  });

  if (myProfileLoading && !myProfile) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!myProfile) {
    return (
      <div className="max-w-lg mx-auto py-16 text-center space-y-3">
        <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-bold text-foreground">
          {t("affiliates.portal.notAffiliateTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("affiliates.portal.notAffiliateBody")}
        </p>
        <Button variant="outline" onClick={() => navigate("/admin/affiliates")}>
          {t("affiliates.portal.backToManager")}
        </Button>
      </div>
    );
  }

  const { affiliate, links, stats } = myProfile;
  const isMaster = affiliate.plan === "master";
  const priceDollars = (affiliate.monthly_price_cents / 100).toFixed(0);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Handshake}
        title={t("affiliates.portal.title")}
        description={t("affiliates.portal.description")}
        badge={
          isMaster && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border bg-primary/10 text-primary border-primary/30">
              <Crown className="w-3 h-3" />
              {t("affiliates.admin.planMaster")}
            </span>
          )
        }
      />

      {!affiliate.has_portal_access ? (
        <div className="bg-card border border-border rounded-2xl overflow-hidden max-w-lg">
          <div className="bg-gradient-to-r from-primary/15 to-accent/10 px-6 py-5 border-b border-border flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-bold text-lg text-foreground">
                {t("affiliates.portal.paywallTitle")}
              </h2>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("affiliates.portal.paywallBody", { price: priceDollars })}
            </p>
            <AcceptCardFields ref={cardRef} disabled={mySubscribing} />
            {(subscribeError || error) && (
              <p className="text-sm text-destructive">{subscribeError || error}</p>
            )}
            <Button
              className="w-full gap-2"
              onClick={handleSubscribe}
              disabled={mySubscribing}
            >
              {mySubscribing && <Loader2 className="w-4 h-4 animate-spin" />}
              {t("affiliates.portal.paywallSubscribeCta")}
            </Button>
            <FieldHint>{t("affiliates.portal.paywallCompNote")}</FieldHint>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              icon={MousePointerClick}
              label={t("affiliates.portal.statsClicks")}
              value={stats.clicks_total}
            />
            <StatCard
              icon={Users}
              label={t("affiliates.portal.statsReferred")}
              value={stats.referred_clients}
            />
            <StatCard
              icon={Wallet}
              label={t("affiliates.portal.statsPending")}
              value={fmtCents(stats.commissions_pending_cents)}
            />
            <StatCard
              icon={BadgeDollarSign}
              label={t("affiliates.portal.statsEarned")}
              value={fmtCents(stats.commissions_earned_cents)}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Copy className="w-4 h-4 text-primary" />
                {t("affiliates.portal.linksTitle")}
              </h2>
              <CopyRow label={t("affiliates.portal.linkDefault")} value={links.short_default} />
              <CopyRow label={t("affiliates.portal.linkAnalysis")} value={links.short_analysis} />
              <CopyRow label={t("affiliates.portal.linkPricing")} value={links.short_pricing} />
              <CopyRow
                label={t("affiliates.portal.linkAnalysisRef")}
                value={links.analysis_ref}
              />
              <CopyRow label={t("affiliates.portal.linkPricingRef")} value={links.pricing_ref} />

              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 mt-2"
                onClick={() => navigate("/admin/pipeline")}
              >
                {t("affiliates.portal.pipelineCta")}
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-bold text-foreground">
                {t("affiliates.portal.profileTitle")}
              </h2>
              <form onSubmit={profileForm.handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {t("affiliates.portal.fieldDefaultLanding")}
                  </label>
                  <Select
                    value={profileForm.values.default_landing}
                    onValueChange={(v) => profileForm.setFieldValue("default_landing", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit_analysis">
                        {t("affiliates.admin.landingAnalysis")}
                      </SelectItem>
                      <SelectItem value="pricing">
                        {t("affiliates.admin.landingPricing")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {t("affiliates.portal.fieldPhone")}
                  </label>
                  <Input type="tel" {...profileForm.getFieldProps("phone")} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {t("affiliates.portal.fieldBio")}
                  </label>
                  <Textarea rows={2} className="resize-none" {...profileForm.getFieldProps("bio")} />
                </div>
                <Button type="submit" size="sm" disabled={saving}>
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />}
                  {t("affiliates.portal.save")}
                </Button>
              </form>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
              <div>
                <h2 className="text-sm font-bold text-foreground">
                  {t("affiliates.portal.leadFormTitle")}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("affiliates.portal.leadFormHint")}
                </p>
              </div>
              <form onSubmit={leadForm.handleSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    placeholder={t("affiliates.admin.fieldFirstName")}
                    {...leadForm.getFieldProps("first_name")}
                  />
                  <Input
                    placeholder={t("affiliates.admin.fieldLastName")}
                    {...leadForm.getFieldProps("last_name")}
                  />
                </div>
                <Input
                  type="email"
                  placeholder={`${t("affiliates.admin.fieldEmail")} (${t("common.optional")})`}
                  {...leadForm.getFieldProps("email")}
                />
                {leadForm.touched.email && leadForm.errors.email && (
                  <p className="text-xs text-destructive">
                    {leadForm.errors.email}
                  </p>
                )}
                <Input
                  type="tel"
                  placeholder={`${t("affiliates.admin.fieldPhone")} (${t("common.optional")})`}
                  {...leadForm.getFieldProps("phone")}
                />
                {!String(leadForm.values.email ?? "").trim() && (
                  <NoEmailWarning
                    hasPhone={!!String(leadForm.values.phone ?? "").trim()}
                  />
                )}
                <Button type="submit" size="sm" className="gap-1.5" disabled={leadSubmitting}>
                  {leadSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserPlus className="w-3.5 h-3.5" />
                  )}
                  {t("affiliates.portal.leadSubmit")}
                </Button>
              </form>
            </div>

            {isMaster ? (
              <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-bold text-foreground">
                    {t("affiliates.portal.inviteSubTitle")}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("affiliates.portal.inviteSubHint")}
                  </p>
                </div>
                <form onSubmit={inviteForm.handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      placeholder={t("affiliates.admin.fieldFirstName")}
                      {...inviteForm.getFieldProps("first_name")}
                    />
                    <Input
                      placeholder={t("affiliates.admin.fieldLastName")}
                      {...inviteForm.getFieldProps("last_name")}
                    />
                  </div>
                  <Input
                    type="email"
                    placeholder={t("affiliates.admin.fieldEmail")}
                    {...inviteForm.getFieldProps("email")}
                  />
                  <Input
                    type="tel"
                    placeholder={t("affiliates.admin.fieldPhone")}
                    {...inviteForm.getFieldProps("phone")}
                  />
                  <Button type="submit" size="sm" className="gap-1.5" disabled={inviteSubmitting}>
                    {inviteSubmitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {t("affiliates.portal.inviteSubmit")}
                  </Button>
                </form>
              </div>
            ) : (
              <div className="bg-muted/30 border border-border rounded-2xl p-5 flex items-center justify-center text-center">
                <p className="text-xs text-muted-foreground">
                  {t("affiliates.portal.masterOnly")}
                </p>
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-foreground">
              {t("affiliates.portal.commissionsTitle")}
            </h2>
            {myCommissionsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : myCommissions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("affiliates.admin.commissionsEmpty")}
              </p>
            ) : (
              <div className="space-y-2">
                {myCommissions.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {fmtCents(c.amount_cents)}
                        </span>
                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded-full border font-semibold ${COMMISSION_STATUS_CLASS[c.status]}`}
                        >
                          {t(
                            `affiliates.admin.commissionStatus${c.status.charAt(0).toUpperCase()}${c.status.slice(1)}`,
                          )}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {c.client_name || "—"} · {fmtDate(c.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

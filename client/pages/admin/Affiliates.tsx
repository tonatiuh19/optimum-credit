import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  Handshake,
  Plus,
  Search,
  Filter,
  Copy,
  Check,
  Loader2,
  Crown,
  Users,
  User,
  ExternalLink,
  Sparkles,
  Link2,
  Wallet,
  BadgeDollarSign,
  ShieldCheck,
  X,
  ChevronRight,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import FieldHint from "@/components/admin/FieldHint";
import AffiliateInviteLinksPanel from "@/components/admin/AffiliateInviteLinksPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDebounce } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAffiliates,
  fetchSuggestions,
  createAffiliate,
  updateAffiliate,
  fetchAffiliateDetail,
  compAffiliate,
  fetchAffiliateCommissions,
  updateCommissionStatus,
  clearSelectedAffiliate,
} from "@/store/slices/affiliatesSlice";
import { slugifyAffiliateName, normalizeAffiliateSlug } from "@shared/affiliate";
import type {
  AffiliateCommissionStatus,
  AffiliateLanding,
  AffiliatePlan,
  AffiliateProfile,
  AffiliateStatus,
  AffiliateSubscriptionStatus,
} from "@shared/api";

// ─── Helpers ────────────────────────────────────────────────────────────────

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

const PLAN_ICON: Record<AffiliatePlan, typeof Crown> = {
  master: Crown,
  standard: User,
  sub_affiliate: Users,
};

const PLAN_CLASS: Record<AffiliatePlan, string> = {
  master: "bg-primary/10 text-primary border-primary/30",
  standard: "bg-muted text-muted-foreground border-border",
  sub_affiliate: "bg-accent/10 text-accent border-accent/30",
};

const STATUS_CLASS: Record<AffiliateStatus, string> = {
  invited: "bg-muted text-muted-foreground border-border",
  active: "bg-accent/10 text-accent border-accent/30",
  inactive: "bg-muted text-muted-foreground border-border",
  suspended: "bg-destructive/10 text-destructive border-destructive/30",
};

const SUB_STATUS_CLASS: Record<AffiliateSubscriptionStatus, string> = {
  none: "bg-muted text-muted-foreground border-border",
  pending: "bg-yellow-500/10 text-yellow-700 border-yellow-400/30",
  active: "bg-accent/10 text-accent border-accent/30",
  past_due: "bg-destructive/10 text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  comped: "bg-primary/10 text-primary border-primary/30",
};

const COMMISSION_STATUS_CLASS: Record<AffiliateCommissionStatus, string> = {
  pending: "bg-yellow-500/10 text-yellow-700 border-yellow-400/30",
  approved: "bg-primary/10 text-primary border-primary/30",
  paid: "bg-accent/10 text-accent border-accent/30",
  void: "bg-muted text-muted-foreground border-border",
};

/** Copy control with “Copied!” tooltip feedback. */
function CopyLinkButton({
  text,
  label,
  iconOnly = false,
}: {
  text: string;
  label?: string;
  iconOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        toast({ description: t("affiliates.admin.linkCopied") });
        setTimeout(() => setCopied(false), 1600);
      },
      () => {
        toast({
          title: t("affiliates.inviteLinks.copyFailed", {
            defaultValue: "Could not copy link",
          }),
          variant: "destructive",
        });
      },
    );
  };

  return (
    <Tooltip open={copied}>
      <TooltipTrigger asChild>
        {iconOnly ? (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={handleCopy}
            aria-label={label || t("affiliates.admin.copyLink")}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-accent" />
            ) : (
              <Link2 className="w-3.5 h-3.5" />
            )}
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={handleCopy}
            aria-label={label || t("affiliates.admin.copyLink")}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-accent" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs font-semibold">
        {t("affiliates.portal.copied")}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Create affiliate dialog ────────────────────────────────────────────────

interface CreateForm {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  plan: AffiliatePlan;
  slug: string;
  default_landing: AffiliateLanding;
  parent_affiliate_id: string;
  comp_subscription: boolean;
  notes: string;
}

const EMPTY_CREATE: CreateForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  plan: "standard",
  slug: "",
  default_landing: "credit_analysis",
  parent_affiliate_id: "",
  comp_subscription: true,
  notes: "",
};

function CreateAffiliateDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { suggestions, saving } = useAppSelector((s) => s.affiliates);
  const [slugTouched, setSlugTouched] = useState(false);

  const schema = useMemo(
    () =>
      Yup.object({
        first_name: Yup.string().trim().required(t("common.required")),
        last_name: Yup.string().trim().required(t("common.required")),
        email: Yup.string().email(t("common.invalidEmail")).required(t("common.required")),
        phone: Yup.string(),
        plan: Yup.string().oneOf(["standard"]).required(),
        slug: Yup.string()
          .matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, numbers, hyphens")
          .min(2)
          .max(64),
        default_landing: Yup.string().oneOf(["credit_analysis", "pricing"]).required(),
        parent_affiliate_id: Yup.string(),
        comp_subscription: Yup.boolean(),
        notes: Yup.string(),
      }),
    [t],
  );

  const form = useFormik<CreateForm>({
    initialValues: EMPTY_CREATE,
    validationSchema: schema,
    onSubmit: async (vals, { resetForm }) => {
      const res = await dispatch(
        createAffiliate({
          email: vals.email.trim().toLowerCase(),
          first_name: vals.first_name.trim(),
          last_name: vals.last_name.trim(),
          phone: vals.phone.trim() || undefined,
          plan: "standard",
          slug: vals.slug.trim() || undefined,
          default_landing: vals.default_landing,
          parent_affiliate_id: undefined,
          comp_subscription: vals.comp_subscription,
          notes: vals.notes.trim() || undefined,
        }),
      );
      if (createAffiliate.fulfilled.match(res)) {
        toast({ title: t("affiliates.admin.createSuccess"), description: vals.email });
        resetForm();
        setSlugTouched(false);
        onClose();
        dispatch(fetchAffiliates());
      } else {
        toast({
          title: t("common.error", { defaultValue: "Error" }),
          description: String(res.payload || ""),
          variant: "destructive",
        });
      }
    },
  });

  useEffect(() => {
    if (open) {
      form.resetForm();
      setSlugTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (slugTouched) return;
    const auto = slugifyAffiliateName(form.values.first_name, form.values.last_name);
    form.setFieldValue("slug", auto, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.values.first_name, form.values.last_name, slugTouched]);

  const planSuggestion = suggestions?.suggestions?.[form.values.plan];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogTitle className="flex items-center gap-2 text-base font-semibold">
          <Handshake className="w-4 h-4 text-primary" />
          {t("affiliates.admin.createTitle")}
        </DialogTitle>
        <p className="text-sm text-muted-foreground -mt-1">
          {t("affiliates.admin.createSubtitle")}
        </p>
        <FieldHint tone="accent">{t("affiliates.admin.createIntro")}</FieldHint>

        <form onSubmit={form.handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("affiliates.admin.fieldFirstName")} *
              </label>
              <Input {...form.getFieldProps("first_name")} />
              {form.touched.first_name && form.errors.first_name && (
                <p className="text-xs text-destructive">{form.errors.first_name}</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("affiliates.admin.fieldLastName")} *
              </label>
              <Input {...form.getFieldProps("last_name")} />
              {form.touched.last_name && form.errors.last_name && (
                <p className="text-xs text-destructive">{form.errors.last_name}</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("affiliates.admin.fieldEmail")} *
            </label>
            <Input type="email" {...form.getFieldProps("email")} />
            {form.touched.email && form.errors.email && (
              <p className="text-xs text-destructive">{form.errors.email}</p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("affiliates.admin.fieldPhone")}
            </label>
            <Input type="tel" {...form.getFieldProps("phone")} />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("affiliates.admin.fieldPlan")}
            </label>
            <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
              <span className="text-sm font-semibold text-foreground">
                {t("affiliates.admin.planStandard")}
              </span>
            </div>
            <FieldHint tone="accent">{t("affiliates.plans.standardOnlyNote")}</FieldHint>
            <FieldHint>{t("affiliates.plans.standardHelp")}</FieldHint>
            {planSuggestion && (
              <FieldHint>
                {t("affiliates.admin.suggestionHintFuture", {
                  plan: t("affiliates.admin.planStandard"),
                  price: (planSuggestion.monthly_price_cents / 100).toFixed(0),
                  rate: (planSuggestion.commission_rate_bps / 100).toFixed(0),
                })}
              </FieldHint>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("affiliates.admin.fieldSlug")}
            </label>
            <Input
              value={form.values.slug}
              onChange={(e) => {
                setSlugTouched(true);
                form.setFieldValue("slug", e.target.value.toLowerCase());
              }}
              onBlur={() =>
                form.setFieldValue("slug", normalizeAffiliateSlug(form.values.slug))
              }
              className={form.errors.slug ? "border-destructive font-mono" : "font-mono"}
            />
            {form.errors.slug && (
              <p className="text-xs text-destructive">{String(form.errors.slug)}</p>
            )}
            <FieldHint>
              {t("affiliates.admin.slugHint", { slug: form.values.slug || "…" })}
            </FieldHint>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("affiliates.admin.fieldLanding")}
            </label>
            <Select
              value={form.values.default_landing}
              onValueChange={(v) => form.setFieldValue("default_landing", v as AffiliateLanding)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="credit_analysis">
                  {t("affiliates.admin.landingAnalysis")}
                </SelectItem>
                <SelectItem value="pricing">{t("affiliates.admin.landingPricing")}</SelectItem>
              </SelectContent>
            </Select>
            <FieldHint>{t("affiliates.admin.landingHint")}</FieldHint>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer rounded-xl border border-border bg-muted/30 p-3">
            <Checkbox
              checked={form.values.comp_subscription}
              onCheckedChange={(v) => form.setFieldValue("comp_subscription", Boolean(v))}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">
                {t("affiliates.admin.fieldCompSubscription")}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {t("affiliates.admin.fieldCompSubscriptionHint")}
              </span>
            </span>
          </label>
          <FieldHint tone="accent">{t("affiliates.admin.compFreeNowHint")}</FieldHint>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("affiliates.admin.fieldNotes")}
            </label>
            <Textarea rows={2} className="resize-none" {...form.getFieldProps("notes")} />
          </div>

          <FieldHint>{t("affiliates.admin.attributionNote")}</FieldHint>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
              disabled={saving}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {t("affiliates.admin.createSubmit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Links panel (shared by detail sheet) ──────────────────────────────────

function LinksPanel({
  links,
}: {
  links: {
    short_default: string;
    short_analysis: string;
    short_pricing: string;
    analysis_ref: string;
    pricing_ref: string;
  };
}) {
  const { t } = useTranslation();
  const rows: Array<{ label: string; value: string }> = [
    { label: t("affiliates.admin.copyDefault"), value: links.short_default },
    { label: t("affiliates.admin.copyAnalysis"), value: links.short_analysis },
    { label: t("affiliates.admin.copyPricing"), value: links.short_pricing },
    { label: t("affiliates.portal.linkAnalysisRef"), value: links.analysis_ref },
    { label: t("affiliates.portal.linkPricingRef"), value: links.pricing_ref },
  ];
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const abs = toAbsoluteUrl(row.value);
        return (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{row.label}</p>
              <p className="text-xs text-muted-foreground truncate font-mono">{abs}</p>
            </div>
            <CopyLinkButton text={abs} label={t("affiliates.admin.copyLink")} />
          </div>
        );
      })}
    </div>
  );
}

// ─── Commissions table (shared) ────────────────────────────────────────────

function CommissionsTable({
  onMark,
  updating,
}: {
  onMark: (id: number, status: AffiliateCommissionStatus) => void;
  updating: boolean;
}) {
  const { t } = useTranslation();
  const { commissions, commissionsLoading } = useAppSelector((s) => s.affiliates);

  const KIND_LABEL: Record<string, string> = {
    enrollment: t("affiliates.admin.commissionKindEnrollment"),
    override: t("affiliates.admin.commissionKindOverride"),
    manual: t("affiliates.admin.commissionKindManual"),
  };
  const STATUS_LABEL: Record<string, string> = {
    pending: t("affiliates.admin.commissionStatusPending"),
    approved: t("affiliates.admin.commissionStatusApproved"),
    paid: t("affiliates.admin.commissionStatusPaid"),
    void: t("affiliates.admin.commissionStatusVoid"),
  };

  if (commissionsLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (commissions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        {t("affiliates.admin.commissionsEmpty")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {commissions.map((c) => (
        <div
          key={c.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {fmtCents(c.amount_cents)}
              </span>
              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
                {KIND_LABEL[c.kind] ?? c.kind}
              </span>
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded-full border font-semibold ${COMMISSION_STATUS_CLASS[c.status]}`}
              >
                {STATUS_LABEL[c.status] ?? c.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {c.client_name || "—"} · {fmtDate(c.created_at)}
            </p>
          </div>
          {c.status !== "paid" && c.status !== "void" && (
            <div className="flex gap-1.5 shrink-0">
              {c.status === "pending" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={updating}
                  onClick={() => onMark(c.id, "approved")}
                >
                  {t("affiliates.admin.markApproved")}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={updating}
                onClick={() => onMark(c.id, "paid")}
              >
                {t("affiliates.admin.markPaid")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive hover:text-destructive"
                disabled={updating}
                onClick={() => onMark(c.id, "void")}
              >
                {t("affiliates.admin.markVoid")}
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Detail sheet ───────────────────────────────────────────────────────────

interface EditForm {
  first_name: string;
  last_name: string;
  phone: string;
  slug: string;
  plan: AffiliatePlan;
  status: AffiliateStatus;
  default_landing: AffiliateLanding;
  monthly_price: string;
  commission_rate: string;
  parent_override_rate: string;
  parent_affiliate_id: string;
  notes: string;
}

function AffiliateDetailSheet({
  id,
  onClose,
}: {
  id: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { selected, selectedLoading, saving } = useAppSelector((s) => s.affiliates);
  const [compTarget, setCompTarget] = useState(false);
  const [commissionUpdating, setCommissionUpdating] = useState(false);

  useEffect(() => {
    if (id) {
      dispatch(fetchAffiliateDetail({ id }));
      dispatch(fetchAffiliateCommissions({ id }));
    } else {
      dispatch(clearSelectedAffiliate());
    }
  }, [id, dispatch]);

  const aff = selected?.affiliate;

  const form = useFormik<EditForm>({
    enableReinitialize: true,
    initialValues: {
      first_name: aff?.first_name ?? "",
      last_name: aff?.last_name ?? "",
      phone: aff?.phone ?? "",
      slug: aff?.slug ?? "",
      plan: aff?.plan ?? "standard",
      status: aff?.status ?? "invited",
      default_landing: aff?.default_landing ?? "credit_analysis",
      monthly_price: aff ? String((aff.monthly_price_cents / 100).toFixed(0)) : "0",
      commission_rate: aff ? String((aff.commission_rate_bps / 100).toFixed(1)) : "0",
      parent_override_rate: aff
        ? String((aff.parent_override_rate_bps / 100).toFixed(1))
        : "0",
      parent_affiliate_id: aff?.parent_affiliate_id ? String(aff.parent_affiliate_id) : "",
      notes: aff?.notes ?? "",
    },
    onSubmit: async (vals) => {
      if (!aff) return;
      const res = await dispatch(
        updateAffiliate({
          id: aff.id,
          first_name: vals.first_name.trim(),
          last_name: vals.last_name.trim(),
          phone: vals.phone.trim() || null,
          slug: normalizeAffiliateSlug(vals.slug),
          plan: vals.plan,
          status: vals.status,
          default_landing: vals.default_landing,
          monthly_price_cents: Math.round(Number(vals.monthly_price || 0) * 100),
          commission_rate_bps: Math.round(Number(vals.commission_rate || 0) * 100),
          parent_override_rate_bps: Math.round(
            Number(vals.parent_override_rate || 0) * 100,
          ),
          parent_affiliate_id:
            vals.plan === "sub_affiliate" && vals.parent_affiliate_id
              ? Number(vals.parent_affiliate_id)
              : null,
          notes: vals.notes.trim() || null,
        }),
      );
      if (updateAffiliate.fulfilled.match(res)) {
        toast({ title: t("affiliates.admin.saveSuccess") });
        dispatch(fetchAffiliates());
      } else {
        toast({
          description: String(res.payload || ""),
          variant: "destructive",
        });
      }
    },
  });

  const handleComp = async () => {
    if (!aff) return;
    const res = await dispatch(compAffiliate({ id: aff.id }));
    setCompTarget(false);
    if (compAffiliate.fulfilled.match(res)) {
      toast({ title: t("affiliates.admin.compSuccess") });
      dispatch(fetchAffiliates());
    }
  };

  const handleMarkCommission = async (
    commissionId: number,
    status: AffiliateCommissionStatus,
  ) => {
    setCommissionUpdating(true);
    const res = await dispatch(
      updateCommissionStatus({ id: commissionId, status: status as any }),
    );
    setCommissionUpdating(false);
    if (updateCommissionStatus.fulfilled.match(res)) {
      toast({ description: t("affiliates.admin.commissionUpdated") });
      dispatch(fetchAffiliates());
    }
  };

  const showCompButton =
    aff && aff.subscription_status !== "active" && aff.subscription_status !== "comped";

  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
        <div className="p-6 pb-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-base font-semibold">
            <Handshake className="w-4 h-4 text-primary" />
            {t("affiliates.admin.detailTitle")}
          </SheetTitle>
          {aff && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-lg font-bold text-foreground">
                {aff.first_name} {aff.last_name}
              </span>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold inline-flex items-center gap-1 ${PLAN_CLASS[aff.plan]}`}
              >
                {t(`affiliates.admin.plan${aff.plan === "sub_affiliate" ? "SubAffiliate" : aff.plan === "master" ? "Master" : "Standard"}`)}
              </span>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${STATUS_CLASS[aff.status]}`}
              >
                {t(`affiliates.admin.status${aff.status.charAt(0).toUpperCase()}${aff.status.slice(1)}`)}
              </span>
            </div>
          )}
          {aff && <p className="text-xs text-muted-foreground mt-1">{aff.email}</p>}
        </div>

        {selectedLoading || !aff ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {showCompButton && (
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 border-primary/30 text-primary hover:bg-primary/5"
                onClick={() => setCompTarget(true)}
              >
                <Sparkles className="w-4 h-4" />
                {t("affiliates.admin.compAction")}
              </Button>
            )}

            <Tabs defaultValue="profile">
              <TabsList className="w-full grid grid-cols-3">
                <TabsTrigger value="profile">{t("affiliates.admin.detailTabProfile")}</TabsTrigger>
                <TabsTrigger value="links">{t("affiliates.admin.detailTabLinks")}</TabsTrigger>
                <TabsTrigger value="commissions">
                  {t("affiliates.admin.detailTabCommissions")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="profile" className="mt-4">
                <form onSubmit={form.handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {t("affiliates.admin.fieldFirstName")}
                      </label>
                      <Input {...form.getFieldProps("first_name")} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {t("affiliates.admin.fieldLastName")}
                      </label>
                      <Input {...form.getFieldProps("last_name")} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {t("affiliates.admin.fieldPhone")}
                    </label>
                    <Input type="tel" {...form.getFieldProps("phone")} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {t("affiliates.admin.fieldSlug")}
                    </label>
                    <Input className="font-mono" {...form.getFieldProps("slug")} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {t("affiliates.admin.fieldPlan")}
                      </label>
                      <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-medium">
                        {t(
                          `affiliates.admin.plan${
                            form.values.plan === "sub_affiliate"
                              ? "SubAffiliate"
                              : form.values.plan === "master"
                                ? "Master"
                                : "Standard"
                          }`,
                        )}
                      </div>
                      <FieldHint>{t("affiliates.plans.standardOnlyNote")}</FieldHint>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {t("affiliates.admin.colStatus")}
                      </label>
                      <Select
                        value={form.values.status}
                        onValueChange={(v) => form.setFieldValue("status", v as AffiliateStatus)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="invited">
                            {t("affiliates.admin.statusInvited")}
                          </SelectItem>
                          <SelectItem value="active">
                            {t("affiliates.admin.statusActive")}
                          </SelectItem>
                          <SelectItem value="inactive">
                            {t("affiliates.admin.statusInactive")}
                          </SelectItem>
                          <SelectItem value="suspended">
                            {t("affiliates.admin.statusSuspended")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {t("affiliates.admin.fieldLanding")}
                    </label>
                    <Select
                      value={form.values.default_landing}
                      onValueChange={(v) =>
                        form.setFieldValue("default_landing", v as AffiliateLanding)
                      }
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

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Price ($/mo)
                      </label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        {...form.getFieldProps("monthly_price")}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Commission %
                      </label>
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        {...form.getFieldProps("commission_rate")}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Override %
                      </label>
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        {...form.getFieldProps("parent_override_rate")}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {t("affiliates.admin.fieldNotes")}
                    </label>
                    <Textarea rows={2} className="resize-none" {...form.getFieldProps("notes")} />
                  </div>

                  <Button type="submit" className="w-full" disabled={saving}>
                    {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    {t("affiliates.admin.saveChanges")}
                  </Button>
                </form>

                {(selected?.sub_affiliates?.length ?? 0) > 0 && (
                  <div className="mt-6 pt-5 border-t border-border">
                    <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
                      {t("affiliates.admin.subAffiliatesTitle")}
                    </h4>
                    <div className="space-y-1.5">
                      {selected!.sub_affiliates.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between text-sm rounded-lg border border-border px-3 py-2"
                        >
                          <span>
                            {s.first_name} {s.last_name}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${STATUS_CLASS[s.status]}`}
                          >
                            {s.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6 pt-5 border-t border-border">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
                    {t("affiliates.admin.referredClientsTitle")}
                  </h4>
                  {(selected?.clients?.length ?? 0) === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t("affiliates.admin.noReferredClients")}
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {selected!.clients.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between text-sm rounded-lg border border-border px-3 py-2"
                        >
                          <span className="truncate">
                            {c.first_name} {c.last_name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {fmtDate(c.created_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="links" className="mt-4">
                {selected && <LinksPanel links={selected.links} />}
              </TabsContent>

              <TabsContent value="commissions" className="mt-4">
                <CommissionsTable onMark={handleMarkCommission} updating={commissionUpdating} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>

      <AlertDialog open={compTarget} onOpenChange={setCompTarget}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("affiliates.admin.compConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("affiliates.admin.compConfirmBody")}
            </AlertDialogDescription>
            <FieldHint tone="accent" className="mt-3">
              {t("affiliates.admin.compFreeNowHint")}
            </FieldHint>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleComp}>
              {t("affiliates.admin.compAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

// ─── Affiliate row ──────────────────────────────────────────────────────────

function AffiliateRow({
  affiliate,
  onView,
}: {
  affiliate: AffiliateProfile;
  onView: (id: number) => void;
}) {
  const { t } = useTranslation();
  const PlanIcon = PLAN_ICON[affiliate.plan];

  return (
    <tr
      className="border-b border-border/60 hover:bg-muted/30 transition-colors cursor-pointer group"
      onClick={() => onView(affiliate.id)}
    >
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-[11px] font-bold text-primary">
            {affiliate.first_name?.[0]}
            {affiliate.last_name?.[0]}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground flex items-center gap-1">
              {affiliate.first_name} {affiliate.last_name}
              <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
            </div>
            <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">
              {affiliate.email}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5 hidden sm:table-cell">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${PLAN_CLASS[affiliate.plan]}`}
        >
          <PlanIcon className="w-3 h-3" />
          {t(
            `affiliates.admin.plan${affiliate.plan === "sub_affiliate" ? "SubAffiliate" : affiliate.plan === "master" ? "Master" : "Standard"}`,
          )}
        </span>
      </td>
      <td className="px-4 py-3.5">
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_CLASS[affiliate.status]}`}
        >
          {t(
            `affiliates.admin.status${affiliate.status.charAt(0).toUpperCase()}${affiliate.status.slice(1)}`,
          )}
        </span>
      </td>
      <td className="px-4 py-3.5 hidden md:table-cell">
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${SUB_STATUS_CLASS[affiliate.subscription_status]}`}
        >
          {t(
            `affiliates.admin.sub${affiliate.subscription_status
              .split("_")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join("")}`,
          )}
        </span>
      </td>
      <td className="px-4 py-3.5 hidden lg:table-cell text-sm text-muted-foreground">
        {affiliate.leads_count ?? affiliate.clients_count ?? 0}
      </td>
      <td className="px-4 py-3.5 hidden lg:table-cell">
        <span className="text-sm font-semibold text-foreground">
          {fmtCents(affiliate.commissions_pending_cents)}
        </span>
        <span className="text-[11px] text-muted-foreground ml-1">pending</span>
      </td>
      <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
        <CopyLinkButton
          text={toAbsoluteUrl(`/r/${affiliate.slug}`)}
          label={t("affiliates.admin.copyLink")}
          iconOnly
        />
      </td>
    </tr>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function AdminAffiliates() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { list, listLoading } = useAppSelector((s) => s.affiliates);

  const [searchRaw, setSearchRaw] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const search = useDebounce(searchRaw, 350);

  useEffect(() => {
    dispatch(fetchSuggestions());
  }, [dispatch]);

  useEffect(() => {
    dispatch(
      fetchAffiliates({
        search: search || undefined,
        plan: planFilter === "all" ? undefined : planFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
    );
  }, [dispatch, search, planFilter, statusFilter]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Handshake}
        title={t("affiliates.admin.title")}
        description={t("affiliates.admin.description")}
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="w-4 h-4" />
            {t("affiliates.admin.newAffiliate")}
          </Button>
        }
      />

      <AffiliateInviteLinksPanel />

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-border/60">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={t("affiliates.admin.searchPlaceholder")}
              className="pl-9"
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("affiliates.admin.allPlans")}</SelectItem>
                <SelectItem value="standard">{t("affiliates.admin.planStandard")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("affiliates.admin.allStatuses")}</SelectItem>
                <SelectItem value="invited">{t("affiliates.admin.statusInvited")}</SelectItem>
                <SelectItem value="active">{t("affiliates.admin.statusActive")}</SelectItem>
                <SelectItem value="inactive">{t("affiliates.admin.statusInactive")}</SelectItem>
                <SelectItem value="suspended">
                  {t("affiliates.admin.statusSuspended")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("affiliates.admin.colAffiliate")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                  {t("affiliates.admin.colPlan")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("affiliates.admin.colStatus")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                  {t("affiliates.admin.colSubscription")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                  {t("affiliates.admin.colLeads")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                  {t("affiliates.admin.colCommissions")}
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {listLoading && list.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Handshake className="w-8 h-8 opacity-30" />
                      <div>
                        <p className="text-sm font-medium">{t("affiliates.admin.empty")}</p>
                        <p className="text-xs mt-1 opacity-70">
                          {t("affiliates.admin.emptyHint")}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => setCreateOpen(true)} className="mt-2 gap-1.5">
                        <Plus className="w-3.5 h-3.5" />
                        {t("affiliates.admin.newAffiliate")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                list.map((a) => (
                  <AffiliateRow key={a.id} affiliate={a} onView={setDetailId} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CreateAffiliateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      <AffiliateDetailSheet
        id={detailId}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}

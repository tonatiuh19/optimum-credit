import { useEffect, useMemo, useRef, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Trash2,
  User,
} from "lucide-react";
import FieldHint from "@/components/admin/FieldHint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createAffiliateInviteLink,
  deleteAffiliateInviteLink,
  fetchAffiliateInviteLinks,
  updateAffiliateInviteLink,
} from "@/store/slices/affiliatesSlice";
import type {
  AffiliateInviteLink,
  AffiliateInviteLinkKind,
  AffiliateInvitePathMode,
} from "@shared/api";
import { normalizeAffiliateSlug, slugifyAffiliateName } from "@shared/affiliate";
import { logger } from "@/utils/logger";

/** Invite signup is Standard-only for now (direct under admin). */
const INVITE_PLAN = "standard" as const;

type InviteRowStatus = "on" | "off" | "exhausted" | "expired";

function shareOrigin(): string {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return window.location.origin;
  }
  if (host.endsWith("ofgllc.com")) {
    return window.location.origin;
  }
  return "https://www.ofgllc.com";
}

/** Prefer browser origin locally; never share *.vercel.app in prod — use ofgllc.com. */
function shareJoinUrl(serverJoinUrl: string): string {
  try {
    const path = new URL(serverJoinUrl).pathname;
    return `${shareOrigin()}${path}`;
  } catch {
    return serverJoinUrl;
  }
}

function inviteRowStatus(link: AffiliateInviteLink): InviteRowStatus {
  const expired =
    !!link.expires_at && new Date(link.expires_at).getTime() <= Date.now();
  const exhausted =
    link.max_uses != null && link.use_count >= link.max_uses;
  if (expired) return "expired";
  if (exhausted) return "exhausted";
  if (!link.is_enabled) return "off";
  return "on";
}

function InviteCopyButton({ url }: { url: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: t("affiliates.admin.linkCopied") });
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast({
        title: t("affiliates.inviteLinks.copyFailed"),
        variant: "destructive",
      });
    }
  };

  return (
    <Tooltip open={copied}>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant={copied ? "secondary" : "outline"}
          className="gap-1.5"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-accent" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copied
            ? t("affiliates.portal.copied")
            : t("affiliates.admin.copyLink")}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs font-semibold">
        {t("affiliates.portal.copied")}
      </TooltipContent>
    </Tooltip>
  );
}

function PathModeFields({
  pathMode,
  slug,
  autoSlug,
  onPathMode,
  onSlug,
  warnAutoRemint = false,
}: {
  pathMode: AffiliateInvitePathMode;
  slug: string;
  autoSlug: string;
  onPathMode: (m: AffiliateInvitePathMode) => void;
  onSlug: (s: string) => void;
  warnAutoRemint?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          {t("affiliates.inviteLinks.pathMode")}
        </label>
        <Select
          value={pathMode}
          onValueChange={(v) => onPathMode(v as AffiliateInvitePathMode)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="token">
              {t("affiliates.inviteLinks.pathToken")}
            </SelectItem>
            <SelectItem value="auto">
              {t("affiliates.inviteLinks.pathAuto")}
            </SelectItem>
            <SelectItem value="custom">
              {t("affiliates.inviteLinks.pathCustom")}
            </SelectItem>
          </SelectContent>
        </Select>
        <FieldHint>
          {pathMode === "auto"
            ? t("affiliates.inviteLinks.pathAutoHint", { slug: autoSlug })
            : pathMode === "custom"
              ? t("affiliates.inviteLinks.pathCustomHint")
              : t("affiliates.inviteLinks.pathTokenHint")}
        </FieldHint>
        {pathMode === "auto" && warnAutoRemint && (
          <FieldHint tone="warning">
            {t("affiliates.inviteLinks.pathAutoRemintWarn")}
          </FieldHint>
        )}
      </div>
      {pathMode === "custom" && (
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {t("affiliates.inviteLinks.slug")}
          </label>
          <Input
            className="font-mono"
            value={slug}
            onChange={(e) => onSlug(e.target.value.toLowerCase())}
            onBlur={() => onSlug(normalizeAffiliateSlug(slug))}
            placeholder={t("affiliates.inviteLinks.slugPlaceholder")}
          />
        </div>
      )}
    </div>
  );
}

function LinkPreview({
  path,
  hint,
}: {
  path: string;
  hint: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        {t("affiliates.inviteLinks.previewLabel")}
      </label>
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-background px-3 py-2.5">
        <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <code className="text-[12px] font-mono text-foreground/80 truncate">
          {`${shareOrigin()}/affiliate/join/${path}`}
        </code>
      </div>
      <FieldHint>{hint}</FieldHint>
    </div>
  );
}

export default function AffiliateInviteLinksPanel() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { inviteLinks, inviteLinksLoading, inviteLinkSaving } = useAppSelector(
    (s) => s.affiliates,
  );
  const adminUser = useAppSelector((s) => s.adminAuth.user);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editPathMode, setEditPathMode] =
    useState<AffiliateInvitePathMode>("token");
  const [editSlug, setEditSlug] = useState("");
  /** Baseline when edit opened — used to avoid reminting path unless changed. */
  const [editBaselineMode, setEditBaselineMode] =
    useState<AffiliateInvitePathMode>("token");
  const [editBaselineSlug, setEditBaselineSlug] = useState("");

  const autoSlug = useMemo(
    () =>
      slugifyAffiliateName(
        adminUser?.first_name || "admin",
        adminUser?.last_name || "invite",
      ),
    [adminUser?.first_name, adminUser?.last_name],
  );

  useEffect(() => {
    dispatch(fetchAffiliateInviteLinks()).catch((e) =>
      logger.warn("invite links load failed", e),
    );
  }, [dispatch]);

  const form = useFormik({
    initialValues: {
      kind: "evergreen" as AffiliateInviteLinkKind,
      label: "",
      path_mode: "token" as AffiliateInvitePathMode,
      slug: "",
    },
    validationSchema: Yup.object({
      kind: Yup.string().oneOf(["evergreen", "one_time"]).required(),
      label: Yup.string(),
      path_mode: Yup.string().oneOf(["token", "auto", "custom"]).required(),
      slug: Yup.string().when("path_mode", {
        is: "custom",
        then: (s) =>
          s
            .required(t("common.required", { defaultValue: "Required" }))
            .min(2)
            .max(64)
            .matches(
              /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
              t("affiliates.inviteLinks.slugInvalid"),
            ),
        otherwise: (s) => s,
      }),
    }),
    onSubmit: async (values, helpers) => {
      const res = await dispatch(
        createAffiliateInviteLink({
          kind: values.kind,
          plan: INVITE_PLAN,
          label: values.label.trim() || null,
          parent_affiliate_id: null,
          path_mode: values.path_mode,
          slug:
            values.path_mode === "custom"
              ? normalizeAffiliateSlug(values.slug)
              : null,
        }),
      );
      if (createAffiliateInviteLink.fulfilled.match(res)) {
        toast({ title: t("affiliates.inviteLinks.created") });
        helpers.resetForm();
        setShowCreate(false);
        try {
          await navigator.clipboard.writeText(
            shareJoinUrl(res.payload.link.join_url),
          );
          toast({ title: t("affiliates.admin.linkCopied") });
        } catch {
          toast({
            title: t("affiliates.inviteLinks.copyFailed"),
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: t("common.error", { defaultValue: "Error" }),
          description: String(res.payload || ""),
          variant: "destructive",
        });
      }
    },
  });

  const previewPath = useMemo(() => {
    if (form.values.path_mode === "auto") return autoSlug;
    if (form.values.path_mode === "custom") {
      const s = normalizeAffiliateSlug(form.values.slug);
      return s || "your-slug";
    }
    return "••••••••";
  }, [form.values.path_mode, form.values.slug, autoSlug]);

  const editPreviewPath = useMemo(() => {
    if (editPathMode === "auto") return autoSlug;
    if (editPathMode === "custom") {
      return normalizeAffiliateSlug(editSlug) || "your-slug";
    }
    return "••••••••";
  }, [editPathMode, editSlug, autoSlug]);

  const toggle = async (id: number, is_enabled: boolean) => {
    const res = await dispatch(updateAffiliateInviteLink({ id, is_enabled }));
    if (updateAffiliateInviteLink.fulfilled.match(res)) {
      toast({
        title: is_enabled
          ? t("affiliates.inviteLinks.enabledToast")
          : t("affiliates.inviteLinks.disabledToast"),
      });
    } else {
      toast({
        title: t("common.error", { defaultValue: "Error" }),
        description: String(res.payload || ""),
        variant: "destructive",
      });
    }
  };

  const startEdit = (link: AffiliateInviteLink) => {
    const mode: AffiliateInvitePathMode = link.slug ? "custom" : "token";
    setEditingId(link.id);
    setEditLabel(link.label || "");
    setEditPathMode(mode);
    setEditSlug(link.slug || "");
    setEditBaselineMode(mode);
    setEditBaselineSlug(link.slug || "");
  };

  const saveEdit = async () => {
    if (editingId == null) return;

    const nextCustom =
      editPathMode === "custom" ? normalizeAffiliateSlug(editSlug) : "";

    let pathPayload: {
      path_mode?: AffiliateInvitePathMode;
      slug?: string | null;
    } = {};

    if (editPathMode === "token") {
      if (editBaselineMode !== "token") {
        pathPayload = { path_mode: "token", slug: null };
      }
    } else if (editPathMode === "custom") {
      if (
        editBaselineMode !== "custom" ||
        nextCustom !== editBaselineSlug
      ) {
        pathPayload = { path_mode: "custom", slug: nextCustom };
      }
    } else if (editPathMode === "auto") {
      // Explicit remint — warned in UI when replacing an existing path
      pathPayload = { path_mode: "auto" };
    }

    const res = await dispatch(
      updateAffiliateInviteLink({
        id: editingId,
        label: editLabel.trim() || null,
        ...pathPayload,
      }),
    );
    if (updateAffiliateInviteLink.fulfilled.match(res)) {
      toast({ title: t("affiliates.inviteLinks.updated") });
      setEditingId(null);
    } else {
      toast({
        title: t("common.error", { defaultValue: "Error" }),
        description: String(res.payload || ""),
        variant: "destructive",
      });
    }
  };

  const confirmDelete = async () => {
    if (deleteId == null) return;
    const res = await dispatch(deleteAffiliateInviteLink(deleteId));
    setDeleteId(null);
    if (deleteAffiliateInviteLink.fulfilled.match(res)) {
      toast({ title: t("affiliates.inviteLinks.deleted") });
    } else {
      toast({
        title: t("common.error", { defaultValue: "Error" }),
        description: String(res.payload || ""),
        variant: "destructive",
      });
    }
  };

  const statusClass: Record<InviteRowStatus, string> = {
    on: "bg-accent/10 text-accent border-accent/30",
    off: "bg-muted text-muted-foreground border-border",
    exhausted: "bg-secondary text-secondary-foreground border-border",
    expired: "bg-destructive/10 text-destructive border-destructive/30",
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-border/60">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            {t("affiliates.inviteLinks.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("affiliates.inviteLinks.subtitle")}
          </p>
          <FieldHint className="mt-2">{t("affiliates.inviteLinks.howItWorks")}</FieldHint>
        </div>
        <Button
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => setShowCreate((v) => !v)}
        >
          <Plus className="w-3.5 h-3.5" />
          {t("affiliates.inviteLinks.newLink")}
        </Button>
      </div>

      {showCreate && (
        <form
          onSubmit={form.handleSubmit}
          className="p-4 border-b border-border/60 bg-muted/20 space-y-3"
        >
          <FieldHint tone="accent">
            {t("affiliates.inviteLinks.createIntro")}
          </FieldHint>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {t("affiliates.inviteLinks.kind")}
            </label>
            <Select
              value={form.values.kind}
              onValueChange={(v) =>
                form.setFieldValue("kind", v as AffiliateInviteLinkKind)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="evergreen">
                  {t("affiliates.inviteLinks.kindEvergreen")}
                </SelectItem>
                <SelectItem value="one_time">
                  {t("affiliates.inviteLinks.kindOneTime")}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldHint>
              {form.values.kind === "one_time"
                ? t("affiliates.inviteLinks.kindOneTimeHint")
                : t("affiliates.inviteLinks.kindEvergreenHint")}
            </FieldHint>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-background px-3 py-2.5">
            <User className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">
                {t("affiliates.admin.planStandard")}
              </div>
              <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
                {t("affiliates.plans.standardHelp")}
              </p>
            </div>
          </div>
          <FieldHint tone="accent">{t("affiliates.plans.freeNowNote")}</FieldHint>

          <PathModeFields
            pathMode={form.values.path_mode}
            slug={form.values.slug}
            autoSlug={autoSlug}
            onPathMode={(m) => form.setFieldValue("path_mode", m)}
            onSlug={(s) => form.setFieldValue("slug", s)}
          />

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              {t("affiliates.inviteLinks.label")}
            </label>
            <Input
              placeholder={t("affiliates.inviteLinks.labelPlaceholder")}
              {...form.getFieldProps("label")}
            />
            <FieldHint>{t("affiliates.inviteLinks.labelHint")}</FieldHint>
          </div>

          <LinkPreview
            path={previewPath}
            hint={
              form.values.path_mode === "token"
                ? t("affiliates.inviteLinks.previewHintToken")
                : form.values.path_mode === "auto"
                  ? t("affiliates.inviteLinks.previewHintAuto")
                  : t("affiliates.inviteLinks.previewHintSlug")
            }
          />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowCreate(false)}
            >
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button type="submit" size="sm" disabled={inviteLinkSaving}>
              {inviteLinkSaving && (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              )}
              {t("affiliates.inviteLinks.createSubmit")}
            </Button>
          </div>
        </form>
      )}

      <div className="divide-y divide-border/60">
        {inviteLinksLoading && inviteLinks.length === 0 ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : inviteLinks.length === 0 ? (
          <div className="px-4 py-6 text-center space-y-1">
            <p className="text-sm text-muted-foreground">
              {t("affiliates.inviteLinks.empty")}
            </p>
            <p className="text-xs text-muted-foreground/80">
              {t("affiliates.inviteLinks.emptyHint")}
            </p>
          </div>
        ) : (
          inviteLinks.map((link) => {
            const status = inviteRowStatus(link);
            const editing = editingId === link.id;
            return (
              <div key={link.id} className="px-4 py-3 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground flex-wrap">
                      <Link2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">
                        {link.label ||
                          link.slug ||
                          t("affiliates.inviteLinks.untitled")}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${statusClass[status]}`}
                      >
                        {t(`affiliates.inviteLinks.status.${status}`)}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate pl-5">
                      {link.kind === "one_time"
                        ? t("affiliates.inviteLinks.kindOneTime")
                        : t("affiliates.inviteLinks.kindEvergreen")}
                      {" · "}
                      {t("affiliates.inviteLinks.uses", {
                        count: link.use_count,
                        max: link.max_uses ?? "∞",
                      })}
                      {link.slug
                        ? ` · /${link.slug}`
                        : ` · ${t("affiliates.inviteLinks.pathTokenShort")}`}
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate pl-5 mt-0.5">
                      {shareJoinUrl(link.join_url)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 pl-5 sm:pl-0 flex-wrap justify-end">
                    <div
                      className="flex items-center gap-1.5"
                      title={t("affiliates.inviteLinks.toggleHint")}
                    >
                      <Switch
                        checked={link.is_enabled}
                        onCheckedChange={(v) => void toggle(link.id, v)}
                        aria-label={t("affiliates.inviteLinks.toggle")}
                      />
                      {link.is_enabled ? (
                        <Power className="w-3.5 h-3.5 text-accent hidden sm:block" />
                      ) : (
                        <PowerOff className="w-3.5 h-3.5 text-muted-foreground hidden sm:block" />
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() =>
                        editing ? setEditingId(null) : startEdit(link)
                      }
                      aria-label={t("affiliates.inviteLinks.edit")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(link.id)}
                      aria-label={t("affiliates.inviteLinks.remove")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                    <InviteCopyButton url={shareJoinUrl(link.join_url)} />
                  </div>
                </div>

                {editing && (
                  <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {t("affiliates.inviteLinks.label")}
                      </label>
                      <Input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        placeholder={t(
                          "affiliates.inviteLinks.labelPlaceholder",
                        )}
                      />
                    </div>
                    <PathModeFields
                      pathMode={editPathMode}
                      slug={editSlug}
                      autoSlug={autoSlug}
                      onPathMode={setEditPathMode}
                      onSlug={setEditSlug}
                      warnAutoRemint={
                        editPathMode === "auto" && editBaselineMode === "custom"
                      }
                    />
                    <LinkPreview
                      path={editPreviewPath}
                      hint={
                        editPathMode === "token"
                          ? t("affiliates.inviteLinks.previewHintToken")
                          : editPathMode === "auto"
                            ? t("affiliates.inviteLinks.previewHintAuto")
                            : t("affiliates.inviteLinks.previewHintSlug")
                      }
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(null)}
                      >
                        {t("common.cancel", { defaultValue: "Cancel" })}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={inviteLinkSaving}
                        onClick={() => void saveEdit()}
                      >
                        {t("affiliates.inviteLinks.saveEdit")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <AlertDialog
        open={deleteId != null}
        onOpenChange={(o) => !o && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("affiliates.inviteLinks.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("affiliates.inviteLinks.deleteBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              {t("affiliates.inviteLinks.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

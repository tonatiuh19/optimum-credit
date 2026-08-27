import { useEffect, useState } from "react";
import {
  Save,
  Settings,
  Tag,
  Scale,
  Loader2,
  ExternalLink,
  Landmark,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AdminPageHeader from "@/components/AdminPageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchSettings, saveSetting } from "@/store/slices/adminSlice";
import {
  fetchAdminLegalDocuments,
  saveLegalDocument,
} from "@/store/slices/legalSlice";
import { fetchAdminPhoneNumbers } from "@/store/slices/conversationsSlice";
import { LEGAL_PATHS } from "@/lib/legal";
import FieldHint from "@/components/admin/FieldHint";
import NotifyExtraEmailsPanel from "@/components/admin/NotifyExtraEmailsPanel";

const FUNDING_SMS_SETTING_KEY = "funding_sms_from_phone_number_id";

export default function AdminSettings() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { settings } = useAppSelector((s) => s.admin);
  const { phoneNumbers, phoneNumbersLoading } = useAppSelector(
    (s) => s.conversations,
  );
  const {
    bySlug,
    list,
    listLoading,
    savingSlug,
    error: legalError,
  } = useAppSelector((s) => s.legal);

  const appVersion =
    settings.find((s) => s.setting_key === "app_version")?.setting_value ??
    null;
  const fundingSmsFromId =
    settings.find((s) => s.setting_key === FUNDING_SMS_SETTING_KEY)
      ?.setting_value ?? "";
  const visibleSettings = settings.filter(
    (s) =>
      s.setting_key !== "app_version" &&
      s.setting_key !== "contract_template_html" &&
      s.setting_key !== FUNDING_SMS_SETTING_KEY,
  );

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [fundingPhoneEdit, setFundingPhoneEdit] = useState<string | null>(null);
  const [fundingPhoneSaving, setFundingPhoneSaving] = useState(false);
  const [legalEdits, setLegalEdits] = useState<
    Record<string, { title: string; content_md: string; source_url: string }>
  >({});

  useEffect(() => {
    dispatch(fetchSettings());
    dispatch(fetchAdminLegalDocuments());
    dispatch(fetchAdminPhoneNumbers());
  }, [dispatch]);

  useEffect(() => {
    const next: typeof legalEdits = {};
    for (const summary of list) {
      const doc = bySlug[summary.slug];
      if (!doc) continue;
      if (legalEdits[summary.slug]) continue;
      next[summary.slug] = {
        title: doc.title,
        content_md: doc.content_md,
        source_url: doc.source_url || "",
      };
    }
    if (Object.keys(next).length) {
      setLegalEdits((p) => ({ ...p, ...next }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once per loaded doc
  }, [list, bySlug]);

  const save = async (k: string) => {
    const v = edits[k];
    if (v === undefined) return;
    await dispatch(saveSetting({ setting_key: k, setting_value: v }));
    setEdits((p) => {
      const next = { ...p };
      delete next[k];
      return next;
    });
    dispatch(fetchSettings());
  };

  const saveFundingPhone = async () => {
    if (fundingPhoneEdit === null) return;
    setFundingPhoneSaving(true);
    try {
      await dispatch(
        saveSetting({
          setting_key: FUNDING_SMS_SETTING_KEY,
          setting_value: fundingPhoneEdit,
        }),
      );
      setFundingPhoneEdit(null);
      dispatch(fetchSettings());
    } finally {
      setFundingPhoneSaving(false);
    }
  };

  const saveLegal = async (slug: string) => {
    const draft = legalEdits[slug];
    if (!draft) return;
    const result = await dispatch(
      saveLegalDocument({
        slug,
        title: draft.title,
        content_md: draft.content_md,
        source_url: draft.source_url || null,
      }),
    );
    if (saveLegalDocument.fulfilled.match(result)) {
      setLegalEdits((p) => ({
        ...p,
        [slug]: {
          title: result.payload.title,
          content_md: result.payload.content_md,
          source_url: result.payload.source_url || "",
        },
      }));
    }
  };

  const previewPath = (slug: string) =>
    slug === "terms" ? LEGAL_PATHS.terms : LEGAL_PATHS.privacy;

  const fundingPhoneValue =
    fundingPhoneEdit !== null ? fundingPhoneEdit : fundingSmsFromId;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Settings}
        title="Settings"
        description="Global app configuration."
      />

      <NotifyExtraEmailsPanel />

      {/* ── Business Funding SMS From ──────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Landmark className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">
              {t("adminSettings.fundingSmsTitle")}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("adminSettings.fundingSmsHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void saveFundingPhone()}
            disabled={
              fundingPhoneEdit === null ||
              fundingPhoneEdit === fundingSmsFromId ||
              fundingPhoneSaving
            }
            className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-40 shrink-0"
          >
            {fundingPhoneSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {t("adminSettings.fundingSmsSave")}
          </button>
        </div>
        {phoneNumbersLoading && phoneNumbers.length === 0 ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <select
            className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground"
            value={fundingPhoneValue}
            onChange={(e) => setFundingPhoneEdit(e.target.value)}
          >
            <option value="">{t("adminSettings.fundingSmsNone")}</option>
            {phoneNumbers
              .filter((n) => n.is_active)
              .map((n) => (
                <option key={n.id} value={String(n.id)}>
                  {n.friendly_name
                    ? `${n.friendly_name} (${n.e164})`
                    : n.e164}
                </option>
              ))}
          </select>
        )}
        <FieldHint>{t("adminSettings.fundingSmsFieldHint")}</FieldHint>
      </div>

      {/* ── App Version ───────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Tag className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-0.5">
            Production Version
          </p>
          <div className="flex items-center gap-3">
            {appVersion ? (
              <span className="font-mono text-xl font-bold text-foreground">
                {appVersion}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground italic">
                Not set — run{" "}
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  npm run deploy:prod
                </code>{" "}
                to deploy and set a version.
              </span>
            )}
            {appVersion && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                Live
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Legal Documents ───────────────────────────────────── */}
      <div className="space-y-3">
        <div className="px-1">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Scale className="w-4 h-4" />
            {t("legal.adminSection")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("legal.adminSectionHint")}
          </p>
        </div>

        {legalError && (
          <p className="text-sm text-destructive px-1">{legalError}</p>
        )}

        {listLoading && list.length === 0 ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="bg-card rounded-2xl border border-border p-4 space-y-3"
              >
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-40 w-full" />
              </div>
            ))}
          </div>
        ) : (
          list.map((summary) => {
            const draft = legalEdits[summary.slug];
            const saving = savingSlug === summary.slug;
            return (
              <div
                key={summary.slug}
                className="bg-card rounded-2xl border border-border p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm text-foreground">
                      {summary.slug}
                    </div>
                    <Link
                      to={previewPath(summary.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                    >
                      Preview <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                  <button
                    type="button"
                    onClick={() => saveLegal(summary.slug)}
                    disabled={!draft || saving}
                    className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {t("legal.adminSave")}
                  </button>
                </div>

                {draft ? (
                  <>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        {t("legal.adminTitle")}
                      </label>
                      <input
                        value={draft.title}
                        onChange={(e) =>
                          setLegalEdits((p) => ({
                            ...p,
                            [summary.slug]: {
                              ...draft,
                              title: e.target.value,
                            },
                          }))
                        }
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        {t("legal.adminSourceUrl")}
                      </label>
                      <input
                        value={draft.source_url}
                        onChange={(e) =>
                          setLegalEdits((p) => ({
                            ...p,
                            [summary.slug]: {
                              ...draft,
                              source_url: e.target.value,
                            },
                          }))
                        }
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">
                        {t("legal.adminContent")}
                      </label>
                      <textarea
                        rows={14}
                        value={draft.content_md}
                        onChange={(e) =>
                          setLegalEdits((p) => ({
                            ...p,
                            [summary.slug]: {
                              ...draft,
                              content_md: e.target.value,
                            },
                          }))
                        }
                        className="w-full p-3 rounded-lg border border-input bg-background text-sm text-foreground font-mono leading-relaxed"
                      />
                      <FieldHint>{t("adminHelpers.markdownHint")}</FieldHint>
                    </div>
                  </>
                ) : (
                  <Skeleton className="h-40 w-full" />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── System Settings ───────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
          System Settings
        </h2>
        <FieldHint className="mt-0 mx-1">
          {t("adminHelpers.settingsSaveWarn")}
        </FieldHint>
        {visibleSettings.map((s) => {
          const val = edits[s.setting_key] ?? s.setting_value ?? "";
          const long = (s.setting_value || "").length > 80;
          return (
            <div
              key={s.setting_key}
              className="bg-card rounded-2xl border border-border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm break-all">
                    {s.setting_key}
                  </div>
                  {s.description ? (
                    <div className="text-xs text-muted-foreground">
                      {s.description}
                    </div>
                  ) : (
                    <FieldHint tone="warning">
                      {t("adminHelpers.settingsNoDescription")}
                    </FieldHint>
                  )}
                </div>
                <button
                  onClick={() => save(s.setting_key)}
                  disabled={edits[s.setting_key] === undefined}
                  className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                >
                  <Save className="w-4 h-4" /> Save
                </button>
              </div>
              {long ? (
                <textarea
                  rows={5}
                  value={val}
                  onChange={(e) =>
                    setEdits((p) => ({ ...p, [s.setting_key]: e.target.value }))
                  }
                  className="w-full p-3 rounded-lg border border-input bg-background text-sm text-foreground font-mono"
                />
              ) : (
                <input
                  value={val}
                  onChange={(e) =>
                    setEdits((p) => ({ ...p, [s.setting_key]: e.target.value }))
                  }
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

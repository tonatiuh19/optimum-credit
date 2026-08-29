import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, KeyRound, Loader2, Lock } from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import {
  fetchClientCmsCredentials,
  saveClientCmsCredentials,
  type ClientCmsCredentialsWrite,
} from "@/store/slices/adminSlice";
import type { ClientCmsCredentialsPublic } from "@shared/api";
import { Button } from "@/components/ui/button";
import FieldHint from "@/components/admin/FieldHint";
import { useToast } from "@/hooks/use-toast";

type FormState = {
  smart_credit_email: string;
  smart_credit_password: string;
  myfreescorenow_email: string;
  myfreescorenow_password: string;
};

const emptyForm = (): FormState => ({
  smart_credit_email: "",
  smart_credit_password: "",
  myfreescorenow_email: "",
  myfreescorenow_password: "",
});

export default function ClientCmsCredentialsCard({
  clientId,
}: {
  clientId: number;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [meta, setMeta] = useState<ClientCmsCredentialsPublic | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [showScPass, setShowScPass] = useState(false);
  const [showMfsnPass, setShowMfsnPass] = useState(false);

  const load = useCallback(
    async (includeSecrets = false) => {
      if (includeSecrets) setRevealing(true);
      else setLoading(true);
      try {
        const res = await dispatch(
          fetchClientCmsCredentials({
            clientId,
            includeSecrets,
          }),
        );
        if (!fetchClientCmsCredentials.fulfilled.match(res)) {
          toast({
            title: t("adminHelpers.cmsLoadError"),
            description: String(res.payload || ""),
            variant: "destructive",
          });
          return;
        }
        const { credentials, secrets } = res.payload;
        setMeta(credentials);
        setForm((prev) => ({
          smart_credit_email:
            secrets?.smart_credit?.email ??
            credentials.smart_credit_email ??
            prev.smart_credit_email,
          myfreescorenow_email:
            secrets?.myfreescorenow?.email ??
            credentials.myfreescorenow_email ??
            prev.myfreescorenow_email,
          smart_credit_password: includeSecrets
            ? secrets?.smart_credit?.password ?? ""
            : prev.smart_credit_password,
          myfreescorenow_password: includeSecrets
            ? secrets?.myfreescorenow?.password ?? ""
            : prev.myfreescorenow_password,
        }));
        if (includeSecrets) setRevealed(true);
      } finally {
        setLoading(false);
        setRevealing(false);
      }
    },
    [clientId, dispatch, t, toast],
  );

  useEffect(() => {
    setRevealed(false);
    setShowScPass(false);
    setShowMfsnPass(false);
    setForm(emptyForm());
    void load(false);
  }, [clientId, load]);

  const handleReveal = () => {
    void load(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: ClientCmsCredentialsWrite = {
        smart_credit: {
          email: form.smart_credit_email.trim() || null,
        },
        myfreescorenow: {
          email: form.myfreescorenow_email.trim() || null,
        },
      };
      // Only send passwords when revealed/edited (avoid wiping vault with empty).
      if (revealed || form.smart_credit_password.trim()) {
        payload.smart_credit!.password =
          form.smart_credit_password.trim() || null;
      }
      if (revealed || form.myfreescorenow_password.trim()) {
        payload.myfreescorenow!.password =
          form.myfreescorenow_password.trim() || null;
      }

      const res = await dispatch(
        saveClientCmsCredentials({ clientId, credentials: payload }),
      );
      if (!saveClientCmsCredentials.fulfilled.match(res)) {
        toast({
          title: t("adminHelpers.cmsSaveError"),
          description: String(res.payload || ""),
          variant: "destructive",
        });
        return;
      }
      setMeta(res.payload);
      if (!revealed) {
        setForm((f) => ({
          ...f,
          smart_credit_password: "",
          myfreescorenow_password: "",
        }));
      }
      toast({ title: t("adminHelpers.cmsSaveSuccess") });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-4 flex justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-border bg-muted/40 p-4 space-y-3"
      data-testid="client-cms-credentials-card"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" />
            {t("adminHelpers.cmsSectionTitle")}
          </h3>
          <FieldHint>{t("adminHelpers.cmsSectionHint")}</FieldHint>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[11px] gap-1.5 shrink-0"
          disabled={revealing || revealed}
          onClick={handleReveal}
        >
          {revealing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : revealed ? (
            <EyeOff className="w-3 h-3" />
          ) : (
            <Eye className="w-3 h-3" />
          )}
          {revealed
            ? t("adminHelpers.cmsPasswordsRevealed")
            : t("adminHelpers.cmsRevealPasswords")}
        </Button>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground">
            {t("adminHelpers.cmsSmartCredit")}
          </p>
          <input
            type="email"
            value={form.smart_credit_email}
            onChange={(e) =>
              setForm((f) => ({ ...f, smart_credit_email: e.target.value }))
            }
            placeholder={t("adminHelpers.cmsEmailPlaceholder")}
            className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <div className="relative">
            <input
              type={showScPass ? "text" : "password"}
              value={form.smart_credit_password}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  smart_credit_password: e.target.value,
                }))
              }
              placeholder={
                meta?.has_smart_credit_password && !revealed
                  ? t("adminHelpers.cmsPasswordStored")
                  : t("adminHelpers.cmsPasswordPlaceholder")
              }
              className="w-full h-9 px-3 pr-9 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowScPass((v) => !v)}
              aria-label={t("adminHelpers.cmsTogglePasswordVisibility")}
            >
              {showScPass ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground">
            {t("adminHelpers.cmsMyFreeScoreNow")}
          </p>
          <input
            type="email"
            value={form.myfreescorenow_email}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                myfreescorenow_email: e.target.value,
              }))
            }
            placeholder={t("adminHelpers.cmsEmailPlaceholder")}
            className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <div className="relative">
            <input
              type={showMfsnPass ? "text" : "password"}
              value={form.myfreescorenow_password}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  myfreescorenow_password: e.target.value,
                }))
              }
              placeholder={
                meta?.has_myfreescorenow_password && !revealed
                  ? t("adminHelpers.cmsPasswordStored")
                  : t("adminHelpers.cmsPasswordPlaceholder")
              }
              className="w-full h-9 px-3 pr-9 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowMfsnPass((v) => !v)}
              aria-label={t("adminHelpers.cmsTogglePasswordVisibility")}
            >
              {showMfsnPass ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Lock className="w-3 h-3" />
          {t("adminHelpers.cmsVaultNote")}
        </p>
        <Button
          type="button"
          size="sm"
          className="h-8 text-xs"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
          ) : null}
          {t("adminHelpers.cmsSave")}
        </Button>
      </div>
    </div>
  );
}

/** Inline CMS fields for create-client form (no clientId yet). */
export function ClientCmsCredentialsFields({
  value,
  onChange,
  disabled,
}: {
  value: FormState;
  onChange: (next: FormState) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="client-cms-credentials-fields">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-1">
          {t("adminHelpers.cmsSectionTitle")}
        </label>
        <FieldHint>{t("adminHelpers.cmsSectionHint")}</FieldHint>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-foreground">
          {t("adminHelpers.cmsSmartCredit")}
        </p>
        <input
          type="email"
          disabled={disabled}
          value={value.smart_credit_email}
          onChange={(e) =>
            onChange({ ...value, smart_credit_email: e.target.value })
          }
          placeholder={t("adminHelpers.cmsEmailPlaceholder")}
          className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        />
        <input
          type="password"
          disabled={disabled}
          value={value.smart_credit_password}
          onChange={(e) =>
            onChange({ ...value, smart_credit_password: e.target.value })
          }
          placeholder={t("adminHelpers.cmsPasswordPlaceholder")}
          className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-foreground">
          {t("adminHelpers.cmsMyFreeScoreNow")}
        </p>
        <input
          type="email"
          disabled={disabled}
          value={value.myfreescorenow_email}
          onChange={(e) =>
            onChange({ ...value, myfreescorenow_email: e.target.value })
          }
          placeholder={t("adminHelpers.cmsEmailPlaceholder")}
          className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        />
        <input
          type="password"
          disabled={disabled}
          value={value.myfreescorenow_password}
          onChange={(e) =>
            onChange({ ...value, myfreescorenow_password: e.target.value })
          }
          placeholder={t("adminHelpers.cmsPasswordPlaceholder")}
          className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        />
      </div>
    </div>
  );
}

export function emptyCmsFormState(): FormState {
  return emptyForm();
}

export function cmsFormToApiPayload(form: FormState) {
  const scEmail = form.smart_credit_email.trim();
  const scPass = form.smart_credit_password.trim();
  const mfsnEmail = form.myfreescorenow_email.trim();
  const mfsnPass = form.myfreescorenow_password.trim();
  if (!scEmail && !scPass && !mfsnEmail && !mfsnPass) return undefined;
  return {
    smart_credit: {
      email: scEmail || null,
      password: scPass || null,
    },
    myfreescorenow: {
      email: mfsnEmail || null,
      password: mfsnPass || null,
    },
  };
}

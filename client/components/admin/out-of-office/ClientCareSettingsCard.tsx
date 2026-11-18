import { useEffect, useMemo, useRef, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { BellRing, Clock, Loader2, MessageSquareText, RotateCcw, Settings2 } from "lucide-react";
import {
  CLIENT_CARE_DEFAULT_SETTINGS,
  CLIENT_CARE_TOKENS,
  type ClientCareKind,
  type ClientCareLang,
  type ClientCareSettings,
  clientCareText,
  clientCareWhen,
  normalizeClientCareSettings,
  returnDayLabel,
  validateClientCareTemplate,
} from "@shared/clientCareTemplate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchClientCareSettings, saveClientCareSettings } from "@/store/slices/clientCareSettingsSlice";
import { fetchOutOfOffice } from "@/store/slices/outOfOfficeSlice";
import { cn } from "@/lib/utils";

const TEMPLATE_KEYS: Array<{ lang: ClientCareLang; kind: ClientCareKind }> = [
  { lang: "en", kind: "message" },
  { lang: "en", kind: "missed_call" },
  { lang: "es", kind: "message" },
  { lang: "es", kind: "missed_call" },
];
const field = (lang: ClientCareLang, kind: ClientCareKind) => `tpl_${lang}_${kind}` as const;
const toForm = (s: ClientCareSettings) => ({
  ...s,
  escalate_admin_ids: s.escalate_admin_ids.map(String),
  tpl_en_message: s.templates.en.message,
  tpl_en_missed_call: s.templates.en.missed_call,
  tpl_es_message: s.templates.es.message,
  tpl_es_missed_call: s.templates.es.missed_call,
});
type FormValues = ReturnType<typeof toForm>;
const fromForm = (v: FormValues): Partial<ClientCareSettings> => ({
  auto_reply_enabled: v.auto_reply_enabled,
  slack_enabled: v.slack_enabled,
  business_days: v.business_days,
  business_start: v.business_start,
  business_end: v.business_end,
  reply_today_until: v.reply_today_until,
  remind_after_min: Number(v.remind_after_min),
  escalate_after_min: Number(v.escalate_after_min),
  auto_reply_gap_hours: Number(v.auto_reply_gap_hours),
  staff_quiet_min: Number(v.staff_quiet_min),
  auto_close_after_days: Number(v.auto_close_after_days),
  escalate_admin_ids: v.escalate_admin_ids.map(Number),
  templates: {
    en: { message: v.tpl_en_message, missed_call: v.tpl_en_missed_call },
    es: { message: v.tpl_es_message, missed_call: v.tpl_es_missed_call },
  },
  when_labels: v.when_labels,
});

/**
 * Client care settings (out-of-office managers from Settings → Permissions edit; everyone can read): auto-reply and missed-call texts in
 * English and Spanish with {placeholders} and [[optional parts]], business hours, reminder / escalation.
 * The preview uses the same renderer as the server, so it is exactly what clients get.
 */
export function ClientCareSettingsCard() {
  const { t, i18n } = useTranslation();
  const es = i18n.language?.startsWith("es");
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const { data, saving } = useAppSelector((s) => s.clientCareSettings);
  const staff = useAppSelector((s) => s.outOfOffice.data?.staff ?? []);
  const [simulateAway, setSimulateAway] = useState(false);
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [focused, setFocused] = useState<string>(field("en", "message"));

  useEffect(() => {
    void dispatch(fetchClientCareSettings());
    void dispatch(fetchOutOfOffice());
  }, [dispatch]);

  const canEdit = !!data?.can_edit;
  const formik = useFormik<FormValues>({
    enableReinitialize: true,
    initialValues: toForm(data?.settings ?? CLIENT_CARE_DEFAULT_SETTINGS),
    validationSchema: Yup.object(
      Object.fromEntries(
        TEMPLATE_KEYS.map(({ lang, kind }) => [
          field(lang, kind),
          Yup.string().test("tpl", "", function (v) {
            const err = validateClientCareTemplate(String(v ?? ""));
            return err ? this.createError({ message: err }) : true;
          }),
        ]),
      ),
    ),
    validate: (v) => {
      const n = normalizeClientCareSettings(fromForm(v), data?.defaults);
      return n.ok ? {} : { business_days: (n as { error: string }).error };
    },
    onSubmit: async (v) => {
      const r = await dispatch(saveClientCareSettings(fromForm(v)));
      if (saveClientCareSettings.rejected.match(r)) toast({ variant: "destructive", title: String(r.payload) });
      else toast({ title: t("clientCareSettings.saved") });
    },
  });

  const preview = useMemo(() => {
    if (!data) return null;
    const n = normalizeClientCareSettings(fromForm(formik.values), data.defaults);
    if (!n.ok) return null;
    const s = n.settings;
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const nowLa = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()));
    return TEMPLATE_KEYS.map(({ lang, kind }) => ({
      key: field(lang, kind),
      text: clientCareText(
        {
          kind,
          lang,
          firstName: "Maria",
          topic: lang === "es" ? "tu reporte de progreso" : "your progress report",
          owner: { name: lang === "es" ? "Ángel" : "Lecca", phone: lang === "es" ? "+19495419309" : "+19497365644" },
          away: simulateAway ? { name: "Cesar", returnsLabel: returnDayLabel("2026-11-25", lang), note: null } : null,
          when: clientCareWhen(nowLa, lang, s),
        },
        s,
      ),
    }));
  }, [data, formik.values, simulateAway]);

  const insertToken = (token: string) => {
    const el = refs.current[focused];
    const key = focused as keyof FormValues;
    const cur = String(formik.values[key] ?? "");
    const at = el?.selectionStart ?? cur.length;
    void formik.setFieldValue(key, `${cur.slice(0, at)}{${token}}${cur.slice(el?.selectionEnd ?? at)}`);
    requestAnimationFrame(() => el?.focus());
  };

  if (!data) {
    return (
      <div className="flex justify-center rounded-2xl border border-border bg-card p-6">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  const v = formik.values;
  const dayNames = (es ? "Dom Lun Mar Mié Jue Vie Sáb" : "Sun Mon Tue Wed Thu Fri Sat").split(" ");
  const num = (k: "remind_after_min" | "escalate_after_min" | "auto_reply_gap_hours" | "staff_quiet_min" | "auto_close_after_days", label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cc-${k}`}>{label}</Label>
      <Input id={`cc-${k}`} type="number" inputMode="numeric" disabled={!canEdit} {...formik.getFieldProps(k)} />
    </div>
  );

  return (
    <section id="client-care-settings" className="space-y-5 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6" data-testid="client-care-settings">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Settings2 className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">{t("clientCareSettings.title")}</h2>
          <p className="text-xs text-muted-foreground">{canEdit ? t("clientCareSettings.description") : t("clientCareSettings.readOnly")}</p>
        </div>
      </div>

      <form onSubmit={formik.handleSubmit} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {(["auto_reply_enabled", "slack_enabled"] as const).map((k) => (
            <label key={k} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm">
              <span>{t(`clientCareSettings.${k}`)}</span>
              <Switch checked={v[k]} disabled={!canEdit} onCheckedChange={(c) => void formik.setFieldValue(k, c)} data-testid={`cc-${k}`} />
            </label>
          ))}
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Clock className="h-4 w-4 text-primary" />
            {t("clientCareSettings.hours")}
          </legend>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("clientCareSettings.days")}>
            {dayNames.map((name, d) => {
              const on = v.business_days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={on}
                  onClick={() => void formik.setFieldValue("business_days", on ? v.business_days.filter((x) => x !== d) : [...v.business_days, d].sort())}
                  className={cn(
                    "h-8 min-w-[3rem] rounded-full border px-3 text-xs font-semibold transition-colors",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted",
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(["business_start", "business_end", "reply_today_until"] as const).map((k) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={`cc-${k}`}>{t(`clientCareSettings.${k}`)}</Label>
                <Input id={`cc-${k}`} type="time" disabled={!canEdit} {...formik.getFieldProps(k)} />
              </div>
            ))}
          </div>
          {formik.errors.business_days && <p className="text-xs text-destructive" data-testid="cc-error">{String(formik.errors.business_days)}</p>}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <BellRing className="h-4 w-4 text-primary" />
            {t("clientCareSettings.follow")}
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {num("remind_after_min", t("clientCareSettings.remindAfter"))}
            {num("escalate_after_min", t("clientCareSettings.escalateAfter"))}
            {num("auto_reply_gap_hours", t("clientCareSettings.gapHours"))}
            {num("staff_quiet_min", t("clientCareSettings.staffQuiet"))}
            {num("auto_close_after_days", t("clientCareSettings.autoCloseDays"))}
          </div>
          <p className="text-xs text-muted-foreground">{t("clientCareSettings.autoCloseHint")}</p>
          <div className="space-y-1.5">
            <Label>{t("clientCareSettings.escalateTo")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {staff.map((s) => {
                const on = v.escalate_admin_ids.includes(String(s.id));
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!canEdit}
                    aria-pressed={on}
                    onClick={() => void formik.setFieldValue("escalate_admin_ids", on ? v.escalate_admin_ids.filter((x) => x !== String(s.id)) : [...v.escalate_admin_ids, String(s.id)])}
                    className={cn(
                      "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                      on ? "border-accent bg-accent/15 text-accent" : "border-border bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <MessageSquareText className="h-4 w-4 text-primary" />
            {t("clientCareSettings.texts")}
          </legend>
          <p className="text-[11px] text-muted-foreground">{t("clientCareSettings.syntax")}</p>
          {canEdit && (
            <div className="flex flex-wrap gap-1.5" aria-label={t("clientCareSettings.insert")}>
              {CLIENT_CARE_TOKENS.map((tok) => (
                <button key={tok} type="button" onClick={() => insertToken(tok)} className="rounded-md border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-foreground hover:bg-muted">
                  {`{${tok}}`}
                </button>
              ))}
            </div>
          )}
          <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={simulateAway} onCheckedChange={setSimulateAway} />
            {t("clientCareSettings.simulateAway")}
          </label>
          <div className="grid gap-4 lg:grid-cols-2">
            {TEMPLATE_KEYS.map(({ lang, kind }) => {
              const key = field(lang, kind);
              const err = formik.errors[key];
              const p = preview?.find((x) => x.key === key)?.text;
              return (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`cc-${key}`}>{t(`clientCareSettings.tpl.${lang}_${kind}`)}</Label>
                  <Textarea
                    id={`cc-${key}`}
                    rows={4}
                    disabled={!canEdit}
                    ref={(el) => {
                      refs.current[key] = el;
                    }}
                    onFocus={() => setFocused(key)}
                    {...formik.getFieldProps(key)}
                    className="font-mono text-xs"
                  />
                  {err ? (
                    <p className="text-xs text-destructive" data-testid={`cc-err-${key}`}>{String(err)}</p>
                  ) : (
                    p && <p className="rounded-lg border border-primary/20 bg-primary/5 p-2 text-xs text-foreground animate-in fade-in" data-testid={`cc-preview-${key}`}>{p}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground">{p ? t("clientCareSettings.chars", { n: p.length }) : ""}</p>
                </div>
              );
            })}
          </div>
        </fieldset>

        {canEdit && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" size="sm" disabled={saving || !formik.dirty || !formik.isValid} className="w-full sm:w-auto" data-testid="cc-save">
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t("clientCareSettings.save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              className="w-full gap-1.5 sm:w-auto"
              onClick={async () => {
                const r = await dispatch(saveClientCareSettings({ reset: true }));
                toast(saveClientCareSettings.rejected.match(r) ? { variant: "destructive", title: String(r.payload) } : { title: t("clientCareSettings.resetDone") });
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("clientCareSettings.reset")}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}

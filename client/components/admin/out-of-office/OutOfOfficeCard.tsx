import { useEffect, useMemo } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { CalendarRange, Loader2, MessageSquareQuote, Palmtree, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { cancelOutOfOffice, fetchOutOfOffice, saveOutOfOffice } from "@/store/slices/outOfOfficeSlice";
import { formatReturnDay, outOfOfficePreview } from "@/components/admin/out-of-office/outOfOfficeFormat";

const todayPacific = () => new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })).toISOString().slice(0, 10);

/**
 * Profile → Out of office: days away, first day back, backups by language. While away, client
 * auto-replies say when you are back and who answers, and Slack #client-care routes to the backups.
 */
export function OutOfOfficeCard() {
  const { t, i18n } = useTranslation();
  const es = i18n.language?.startsWith("es");
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const { data, saving } = useAppSelector((s) => s.outOfOffice);
  const me = useAppSelector((s) => s.adminAuth.user);

  useEffect(() => {
    void dispatch(fetchOutOfOffice());
  }, [dispatch]);

  const staff = data?.staff ?? [];
  const defaultEn = staff.find((s) => s.language_owner_for === "en" && s.id !== me?.id)?.id ?? "";
  const defaultEs = staff.find((s) => s.language_owner_for === "es" && s.id !== me?.id)?.id ?? "";

  const formik = useFormik({
    enableReinitialize: true,
    initialValues: { admin_id: me?.id ?? 0, starts_on: todayPacific(), returns_on: "", backup_en_admin_id: String(defaultEn), backup_es_admin_id: String(defaultEs), note_en: "", note_es: "" },
    validationSchema: Yup.object({
      starts_on: Yup.string().required(t("outOfOffice.required")),
      returns_on: Yup.string()
        .required(t("outOfOffice.required"))
        .test("after", t("outOfOffice.returnAfter"), function (v) {
          return !!v && v > this.parent.starts_on;
        }),
      backup_en_admin_id: Yup.string().test("one", t("outOfOffice.oneBackup"), function (v) {
        return !!v || !!this.parent.backup_es_admin_id;
      }),
    }),
    onSubmit: async (v) => {
      const r = await dispatch(
        saveOutOfOffice({
          admin_id: Number(v.admin_id) || undefined,
          starts_on: v.starts_on,
          returns_on: v.returns_on,
          backup_en_admin_id: v.backup_en_admin_id ? Number(v.backup_en_admin_id) : null,
          backup_es_admin_id: v.backup_es_admin_id ? Number(v.backup_es_admin_id) : null,
          note_en: v.note_en || null,
          note_es: v.note_es || null,
        }),
      );
      if (saveOutOfOffice.rejected.match(r)) toast({ variant: "destructive", title: String(r.payload) });
      else toast({ title: t("outOfOffice.saved") });
    },
  });

  const who = staff.find((s) => s.id === Number(formik.values.admin_id))?.name.split(" ")[0] ?? me?.first_name ?? "";
  const backupEn = staff.find((s) => s.id === Number(formik.values.backup_en_admin_id))?.name.split(" ")[0];
  const backupEs = staff.find((s) => s.id === Number(formik.values.backup_es_admin_id))?.name.split(" ")[0];
  const preview = useMemo(() => {
    if (!formik.values.returns_on) return null;
    const lang: "en" | "es" = es && backupEs ? "es" : backupEn ? "en" : "es";
    const backupName = lang === "es" ? backupEs : backupEn;
    return backupName ? outOfOfficePreview({ lang, awayName: who, returnsLabel: formatReturnDay(formik.values.returns_on, lang === "es"), backupName }) : null;
  }, [formik.values.returns_on, who, backupEn, backupEs, es]);

  const visible = data?.can_manage_others ? data.everyone : data?.mine ?? [];

  return (
    <section id="out-of-office" className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6 space-y-4" data-testid="ooo-card">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Palmtree className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">{t("outOfOffice.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("outOfOffice.description")}</p>
        </div>
      </div>

      {visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{p.name}</span>
                <span className="block text-xs text-muted-foreground">
                  <CalendarRange className="mr-1 inline h-3.5 w-3.5" />
                  {t("outOfOffice.period", { from: p.starts_on, day: formatReturnDay(p.returns_on, es) })}
                  {p.backup_en ? ` · ${t("outOfOffice.bannerEn", { name: p.backup_en.name })}` : ""}
                  {p.backup_es ? ` · ${t("outOfOffice.bannerEs", { name: p.backup_es.name })}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {p.active && <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">{t("outOfOffice.awayNow")}</span>}
                <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-destructive" onClick={() => void dispatch(cancelOutOfOffice(p.id))}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("outOfOffice.cancel")}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={formik.handleSubmit} className="space-y-3">
        {data?.can_manage_others && (
          <div className="space-y-1.5">
            <Label htmlFor="ooo-who">{t("outOfOffice.who")}</Label>
            <select id="ooo-who" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" {...formik.getFieldProps("admin_id")}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ooo-start">{t("outOfOffice.startsOn")}</Label>
            <Input id="ooo-start" type="date" {...formik.getFieldProps("starts_on")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ooo-return">{t("outOfOffice.returnsOn")}</Label>
            <Input id="ooo-return" type="date" min={formik.values.starts_on} {...formik.getFieldProps("returns_on")} />
            {formik.touched.returns_on && formik.errors.returns_on && <p className="text-xs text-destructive">{formik.errors.returns_on}</p>}
          </div>
          {(["backup_en_admin_id", "backup_es_admin_id"] as const).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={`ooo-${k}`}>{t(k === "backup_en_admin_id" ? "outOfOffice.backupEn" : "outOfOffice.backupEs")}</Label>
              <select id={`ooo-${k}`} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" {...formik.getFieldProps(k)}>
                <option value="">{t("outOfOffice.none")}</option>
                {staff.filter((s) => s.id !== Number(formik.values.admin_id)).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        {formik.errors.backup_en_admin_id && <p className="text-xs text-destructive">{formik.errors.backup_en_admin_id}</p>}
        {preview && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs" data-testid="ooo-preview">
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
              <MessageSquareQuote className="h-4 w-4 text-primary" />
              {t("outOfOffice.previewTitle")}
            </p>
            <p className="text-muted-foreground">{preview}</p>
          </div>
        )}
        <Button type="submit" size="sm" disabled={saving} className="w-full gap-1.5 sm:w-auto">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palmtree className="h-3.5 w-3.5" />}
          {t("outOfOffice.save")}
        </Button>
      </form>
    </section>
  );
}

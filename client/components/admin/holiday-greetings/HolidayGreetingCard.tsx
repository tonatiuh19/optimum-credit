import { useEffect, useRef, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { CalendarClock, CheckCircle2, ChevronDown, Image as ImageIcon, Loader2, Send, ShieldCheck, Undo2, Users, X } from "lucide-react";
import type { HolidayGreeting } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { uploadConversationMedia } from "@/store/slices/conversationsSlice";
import {
  fetchHolidayAudience,
  holidayGreetingAction,
  saveHolidayGreeting,
  sendHolidayGreetingTest,
} from "@/store/slices/holidayGreetingsSlice";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<HolidayGreeting["status"], string> = {
  draft: "bg-muted text-muted-foreground border-border",
  approved: "bg-accent/10 text-accent border-accent/30",
  sending: "bg-primary/10 text-primary border-primary/30",
  sent: "bg-accent/10 text-accent border-accent/30",
  skipped: "bg-destructive/10 text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

/**
 * One holiday: EN/ES text with {{first_name}}, optional image, send time (Pacific), audience preview,
 * a test text to yourself, and Approve (Cesar / Alex). Editing an approved text returns it to draft.
 */
export function HolidayGreetingCard({ g, defaultOpen }: { g: HolidayGreeting; defaultOpen?: boolean }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language?.startsWith("es");
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const canApprove = useAppSelector((s) => s.holidayGreetings.canApprove);
  const stopFooter = useAppSelector((s) => s.holidayGreetings.stopFooter);
  const audience = useAppSelector((s) => s.holidayGreetings.audience[g.id]);
  const audienceLoading = useAppSelector((s) => !!s.holidayGreetings.audienceLoading[g.id]);
  const busy = useAppSelector((s) => !!s.holidayGreetings.busy[g.id]);
  const [open, setOpen] = useState(!!defaultOpen);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editable = g.status === "draft" || g.status === "approved";

  useEffect(() => {
    if (open && !audience) void dispatch(fetchHolidayAudience(g.id));
  }, [open, audience, dispatch, g.id]);

  const formik = useFormik({
    enableReinitialize: true,
    initialValues: { body_en: g.body_en, body_es: g.body_es, send_time: g.send_at.slice(11, 16) },
    validationSchema: Yup.object({
      body_en: Yup.string().trim().required(t("holidayGreetings.required")).max(600, t("holidayGreetings.tooLong")),
      body_es: Yup.string().trim().required(t("holidayGreetings.required")).max(600, t("holidayGreetings.tooLong")),
      send_time: Yup.string()
        .matches(/^(0[8-9]|1[0-9]):[0-5][0-9]$/, t("holidayGreetings.timeRange"))
        .required(t("holidayGreetings.timeRange")),
    }),
    onSubmit: async (v) => {
      const r = await dispatch(saveHolidayGreeting({ id: g.id, body_en: v.body_en, body_es: v.body_es, send_time: v.send_time }));
      if (saveHolidayGreeting.rejected.match(r)) toast({ variant: "destructive", title: String(r.payload) });
      else toast({ title: g.status === "approved" ? t("holidayGreetings.savedNeedsApproval") : t("holidayGreetings.saved") });
    },
  });

  const act = async (action: "approve" | "unapprove" | "skip" | "restore") => {
    const r = await dispatch(holidayGreetingAction({ id: g.id, action }));
    if (holidayGreetingAction.rejected.match(r)) toast({ variant: "destructive", title: String(r.payload) });
    else toast({ title: t(`holidayGreetings.done.${action}`) });
  };

  const upload = async (file: File) => {
    setUploading(true);
    const r = await dispatch(uploadConversationMedia(file));
    setUploading(false);
    if (uploadConversationMedia.rejected.match(r)) return toast({ variant: "destructive", title: String(r.payload) });
    const saved = await dispatch(saveHolidayGreeting({ id: g.id, media_url: r.payload.url, media_content_type: r.payload.content_type }));
    if (saveHolidayGreeting.rejected.match(saved)) toast({ variant: "destructive", title: String(saved.payload) });
  };

  const test = async (lang: "en" | "es") => {
    const r = await dispatch(sendHolidayGreetingTest({ id: g.id, lang }));
    toast(sendHolidayGreetingTest.rejected.match(r) ? { variant: "destructive", title: String(r.payload) } : { title: t("holidayGreetings.testSent") });
  };

  const label = es ? g.label.es : g.label.en;
  const dirty = formik.dirty;
  const dateText = new Date(`${g.date}T12:00:00Z`).toLocaleDateString(es ? "es-US" : "en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  return (
    <div className={cn("rounded-2xl border bg-card shadow-sm transition-shadow", open ? "shadow-md" : "hover:shadow-md")} data-testid={`holiday-card-${g.holiday_key}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={open}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <CalendarClock className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-foreground">{label} {g.year}</span>
          <span className="block text-xs text-muted-foreground">
            {dateText} · {g.send_at.slice(11, 16)} {t("holidayGreetings.pacific")}
          </span>
        </span>
        <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", STATUS_TONE[g.status])} data-testid="holiday-status">
          {t(`holidayGreetings.status.${g.status}`)}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <form onSubmit={formik.handleSubmit} className="space-y-4 border-t border-border p-4 animate-in fade-in slide-in-from-top-1">
          {g.status === "approved" && (
            <p className="flex items-start gap-2 rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent">
              <ShieldCheck className="mt-px h-4 w-4 shrink-0" />
              {t("holidayGreetings.approvedBy", { name: g.approved_by ?? "—" })}
            </p>
          )}
          {g.status === "sent" && g.stats && (
            <p className="flex items-start gap-2 rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent" data-testid="holiday-results">
              <CheckCircle2 className="mt-px h-4 w-4 shrink-0" />
              {t("holidayGreetings.results", { sent: g.stats.sent ?? 0, failed: g.stats.failed ?? 0, skipped: g.stats.skipped ?? 0 })}
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {(["body_en", "body_es"] as const).map((k) => (
              <div key={k} className="space-y-1.5">
                <Label htmlFor={`${k}-${g.id}`}>{t(k === "body_en" ? "holidayGreetings.textEn" : "holidayGreetings.textEs")}</Label>
                <Textarea id={`${k}-${g.id}`} rows={5} disabled={!editable} {...formik.getFieldProps(k)} className="text-sm" />
                <p className="text-[11px] text-muted-foreground">
                  {t("holidayGreetings.footerNote", { footer: k === "body_en" ? stopFooter.en : stopFooter.es })} · {formik.values[k].length}/600
                </p>
                {formik.touched[k] && formik.errors[k] && <p className="text-xs text-destructive">{formik.errors[k]}</p>}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{t("holidayGreetings.nameHint", { token: "{{first_name}}", interpolation: { escapeValue: false } })}</p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor={`time-${g.id}`}>{t("holidayGreetings.sendTime")}</Label>
              <Input id={`time-${g.id}`} type="time" min="08:00" max="19:59" disabled={!editable} {...formik.getFieldProps("send_time")} className="w-36" />
              {formik.touched.send_time && formik.errors.send_time && <p className="text-xs text-destructive">{formik.errors.send_time}</p>}
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {g.media_url ? (
                <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 py-1">
                  <img src={g.media_url} alt="" className="h-10 w-10 rounded object-cover" />
                  <span className="text-xs text-muted-foreground">{t("holidayGreetings.imageAttached")}</span>
                  {editable && (
                    <button type="button" aria-label={t("holidayGreetings.removeImage")} onClick={() => void dispatch(saveHolidayGreeting({ id: g.id, media_url: null }))} className="text-muted-foreground hover:text-destructive">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              ) : (
                editable && (
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                    {t("holidayGreetings.addImage")}
                  </Button>
                )
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm" data-testid="holiday-audience">
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
              <Users className="h-4 w-4 text-primary" />
              {t("holidayGreetings.audience")}
            </p>
            {audienceLoading || !audience ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : audience.mode === "preview" ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>
                  <span className="text-base font-bold text-foreground">{audience.count}</span> {t("holidayGreetings.willReceive", { en: audience.by_language.en, es: audience.by_language.es })}
                </p>
                <p>
                  {t("holidayGreetings.notIncluded", {
                    opted: audience.skipped.opted_out,
                    old: audience.skipped.no_recent_text,
                    phone: audience.skipped.no_phone,
                    line: audience.skipped.no_sender_line,
                  })}
                </p>
                <p className="whitespace-pre-line rounded-lg bg-card p-2 text-foreground">{es ? audience.preview.es : audience.preview.en}</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("holidayGreetings.results", { sent: audience.stats.sent, failed: audience.stats.failed, skipped: audience.stats.skipped })}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {editable && (
              <Button type="submit" size="sm" variant="outline" disabled={busy || !dirty} className="w-full sm:w-auto">
                {t("holidayGreetings.save")}
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" className="w-full gap-1.5 sm:w-auto" onClick={() => void test(es ? "es" : "en")}>
              <Send className="h-3.5 w-3.5" />
              {t("holidayGreetings.sendTest")}
            </Button>
            {canApprove && g.status === "draft" && (
              <Button type="button" size="sm" disabled={busy || dirty} onClick={() => void act("approve")} className="w-full gap-1.5 sm:w-auto" data-testid="holiday-approve">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {t("holidayGreetings.approve")}
              </Button>
            )}
            {canApprove && g.status === "approved" && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act("unapprove")} className="w-full gap-1.5 sm:w-auto">
                <Undo2 className="h-3.5 w-3.5" />
                {t("holidayGreetings.unapprove")}
              </Button>
            )}
            {canApprove && (g.status === "draft" || g.status === "approved") && (
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void act("skip")} className="w-full text-destructive sm:w-auto">
                {t("holidayGreetings.skip")}
              </Button>
            )}
            {canApprove && g.status === "skipped" && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act("restore")} className="w-full sm:w-auto">
                {t("holidayGreetings.restore")}
              </Button>
            )}
          </div>
          {canApprove && g.status === "draft" && dirty && <p className="text-[11px] text-muted-foreground">{t("holidayGreetings.saveFirst")}</p>}
          {!canApprove && g.status === "draft" && <p className="text-[11px] text-muted-foreground">{t("holidayGreetings.onlyApprovers")}</p>}
        </form>
      )}
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import { CalendarClock, CheckCircle2, Circle, Loader2, X } from "lucide-react";
import type { LeadTemperatureColor } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch } from "@/store/hooks";
import { fetchPanelClient, updateLeadSignals } from "@/store/slices/adminSlice";
import {
  LEAD_TEMPERATURE_TONE,
  LeadTemperatureBadge,
} from "@/components/admin/LeadTemperatureBadge";
import { cn } from "@/lib/utils";

/** `datetime-local` value (local time) from an ISO/DB date. */
function toLocalInput(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const schema = Yup.object({
  when: Yup.string().required("required"),
});

/**
 * Prospect traffic light (semáforo) on the prospect file: color, why, and the
 * two manual Hot signals (analysis reviewed, call scheduled). The color is
 * computed by the platform; these buttons only add signals.
 */
export function LeadTemperatureCard({
  client,
}: {
  client: {
    id: number;
    lead_temperature?: LeadTemperatureColor | null;
    lead_temperature_reasons?: string | null;
    analysis_reviewed_at?: string | null;
    call_scheduled_at?: string | null;
  };
}) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const temp = client.lead_temperature ?? null;
  const reasons = String(client.lead_temperature_reasons || "")
    .split(",")
    .filter(Boolean);
  const reviewed = !!client.analysis_reviewed_at;
  const scheduled = client.call_scheduled_at ? new Date(client.call_scheduled_at) : null;

  const save = async (body: { analysis_reviewed?: boolean; call_scheduled_at?: string | null }) => {
    const res = await dispatch(updateLeadSignals({ id: client.id, ...body }));
    if (updateLeadSignals.rejected.match(res)) {
      toast({
        title: t("adminPipeline.leadTemp.saveError"),
        description: String(res.payload || ""),
        variant: "destructive",
      });
      return false;
    }
    void dispatch(fetchPanelClient(client.id));
    return true;
  };

  const form = useFormik({
    initialValues: { when: toLocalInput(client.call_scheduled_at) },
    enableReinitialize: true,
    validationSchema: schema,
    onSubmit: async (v) => {
      if (await save({ call_scheduled_at: new Date(v.when).toISOString() })) {
        toast({ title: t("adminPipeline.leadTemp.callSaved") });
      }
    },
  });

  return (
    <div
      className={cn(
        "rounded-xl border p-4 space-y-3 transition-colors duration-300",
        temp ? LEAD_TEMPERATURE_TONE[temp].pill.replace(/text-\S+/, "") : "bg-muted/40 border-border",
      )}
      data-testid="lead-temperature-card"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("adminPipeline.leadTemp.heading")}
        </h3>
        {temp ? (
          <LeadTemperatureBadge temperature={temp} className="text-[10px]" />
        ) : (
          <span className="text-xs text-muted-foreground">{t("adminPipeline.leadTemp.pending")}</span>
        )}
      </div>

      {temp && (
        <p className="text-xs text-foreground">
          <span className="font-medium">{t(`adminPipeline.leadTemp.action.${temp}`)}</span>
          {reasons.length > 0 && (
            <span className="text-muted-foreground">
              {" "}
              · {reasons.map((r) => t(`adminPipeline.leadTemp.reason.${r}`, { defaultValue: r })).join(", ")}
            </span>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={reviewed ? "secondary" : "outline"}
          className="h-8 gap-1.5 text-xs"
          onClick={() => void save({ analysis_reviewed: !reviewed })}
          data-testid="lead-analysis-reviewed"
        >
          {reviewed ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
          ) : (
            <Circle className="h-3.5 w-3.5" />
          )}
          {t("adminPipeline.leadTemp.analysisReviewed")}
        </Button>
      </div>

      <form onSubmit={form.handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <CalendarClock className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="datetime-local"
            className="h-8 pl-8 text-xs"
            {...form.getFieldProps("when")}
            aria-label={t("adminPipeline.leadTemp.callScheduled")}
            data-testid="lead-call-at"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="h-8 text-xs" disabled={form.isSubmitting}>
            {form.isSubmitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            {t("adminPipeline.leadTemp.scheduleCall")}
          </Button>
          {scheduled && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              onClick={() => void save({ call_scheduled_at: null })}
              title={t("adminPipeline.leadTemp.clearCall")}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </form>
      {scheduled && (
        <p className="text-[11px] text-muted-foreground">
          {t("adminPipeline.leadTemp.callOn", {
            when: scheduled.toLocaleString(i18n.language === "es" ? "es-US" : "en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </p>
      )}
      {form.submitCount > 0 && form.errors.when && (
        <p className="text-xs text-destructive">{t("adminPipeline.leadTemp.pickDate")}</p>
      )}
    </div>
  );
}

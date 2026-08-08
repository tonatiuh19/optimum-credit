import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import FieldHint from "@/components/admin/FieldHint";
import type { RoundScheduleDates, RoundScheduleInput } from "@shared/api";

export const DEFAULT_ROUND_INTERVAL_DAYS = 35;

export function buildDefaultRoundScheduleDates(
  start: Date = new Date(),
  intervalDays = DEFAULT_ROUND_INTERVAL_DAYS,
): RoundScheduleDates {
  const base = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const days = Math.max(1, Math.min(120, intervalDays || DEFAULT_ROUND_INTERVAL_DAYS));
  const out: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + days * i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return {
    round_1_date: out[0],
    round_2_date: out[1],
    round_3_date: out[2],
    round_4_date: out[3],
    round_5_date: out[4],
  };
}

export function emptyRoundScheduleInput(
  intervalDays = DEFAULT_ROUND_INTERVAL_DAYS,
): RoundScheduleInput {
  return {
    ...buildDefaultRoundScheduleDates(new Date(), intervalDays),
    interval_days: intervalDays,
    send_calendar: false,
  };
}

const ROUND_KEYS = [
  "round_1_date",
  "round_2_date",
  "round_3_date",
  "round_4_date",
  "round_5_date",
] as const;

interface RoundCalendarScheduleFieldsProps {
  value: RoundScheduleInput;
  onChange: (next: RoundScheduleInput) => void;
  disabled?: boolean;
  /** Compact mode for dialogs */
  compact?: boolean;
}

/** Opt-in round-completion calendar schedule (5 all-day dates + send checkbox). */
export default function RoundCalendarScheduleFields({
  value,
  onChange,
  disabled,
  compact,
}: RoundCalendarScheduleFieldsProps) {
  const { t } = useTranslation();
  const interval = value.interval_days ?? DEFAULT_ROUND_INTERVAL_DAYS;

  const dateFields = useMemo(
    () =>
      ROUND_KEYS.map((key, i) => ({
        key,
        label: t("adminPipeline.roundDateLabel", { n: i + 1 }),
      })),
    [t],
  );

  const setDate = (key: (typeof ROUND_KEYS)[number], date: string) =>
    onChange({ ...value, [key]: date });

  const reseedFromInterval = (nextInterval: number) => {
    const days = Math.max(1, Math.min(120, nextInterval || DEFAULT_ROUND_INTERVAL_DAYS));
    onChange({
      ...value,
      ...buildDefaultRoundScheduleDates(new Date(), days),
      interval_days: days,
    });
  };

  return (
    <div
      className={
        compact
          ? "space-y-3 rounded-xl border border-border bg-muted/20 p-3"
          : "space-y-4 rounded-2xl border border-border bg-muted/20 p-4"
      }
      data-testid="round-calendar-schedule"
    >
      <div className="flex items-start gap-2">
        <CalendarDays className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-foreground">
            {t("adminPipeline.roundCalendarTitle")}
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("adminPipeline.roundCalendarHint")}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Label htmlFor="round-interval" className="text-xs shrink-0">
          {t("adminPipeline.roundIntervalDays")}
        </Label>
        <Input
          id="round-interval"
          type="number"
          min={1}
          max={120}
          disabled={disabled}
          value={interval}
          onChange={(e) => reseedFromInterval(Number(e.target.value))}
          className="h-8 w-20 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {dateFields.map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={key} className="text-[11px] text-muted-foreground">
              {label}
            </Label>
            <Input
              id={key}
              type="date"
              disabled={disabled}
              value={value[key]}
              onChange={(e) => setDate(key, e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        ))}
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-background/80 px-3 py-2.5">
        <Checkbox
          id="send-round-calendar"
          checked={!!value.send_calendar}
          disabled={disabled}
          onCheckedChange={(v) =>
            onChange({ ...value, send_calendar: v === true })
          }
          className="mt-0.5"
          data-testid="send-round-calendar"
        />
        <div className="min-w-0 space-y-0.5">
          <Label
            htmlFor="send-round-calendar"
            className="text-sm font-medium cursor-pointer leading-snug"
          >
            {t("adminPipeline.roundCalendarSend")}
          </Label>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t("adminPipeline.roundCalendarSendHint")}
          </p>
        </div>
      </div>

      {value.send_calendar && (
        <FieldHint tone="accent">{t("adminPipeline.roundCalendarRecipients")}</FieldHint>
      )}
    </div>
  );
}

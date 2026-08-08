import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import RoundCalendarScheduleFields, {
  emptyRoundScheduleInput,
} from "@/components/admin/RoundCalendarScheduleFields";
import type { RoundScheduleInput } from "@shared/api";

export interface PackageOption {
  id: number;
  name: string;
}

export interface ProspectConvertFormValues {
  packageId: string; // "__none__" or numeric string
  notes: string;
  roundSchedule: RoundScheduleInput;
}

export function emptyProspectConvertFormValues(
  intervalDays?: number,
): ProspectConvertFormValues {
  return {
    packageId: "__none__",
    notes: "",
    roundSchedule: emptyRoundScheduleInput(intervalDays),
  };
}

/** Build API payload body for POST /admin/prospects/:id/convert (without id). */
export function buildConvertProspectBody(values: ProspectConvertFormValues): {
  package_id: number | null;
  notes: string | undefined;
  round_schedule: RoundScheduleInput;
} {
  return {
    package_id:
      values.packageId === "__none__" ? null : Number(values.packageId),
    notes: values.notes.trim() || undefined,
    round_schedule: values.roundSchedule,
  };
}

interface ProspectConvertFieldsProps {
  values: ProspectConvertFormValues;
  onChange: (next: ProspectConvertFormValues) => void;
  packages: PackageOption[];
  disabled?: boolean;
  /** Show "lands in New Client" callout */
  showTargetStage?: boolean;
}

/** Shared package / notes / round-calendar fields for prospect → New Client convert. */
export default function ProspectConvertFields({
  values,
  onChange,
  packages,
  disabled,
  showTargetStage = true,
}: ProspectConvertFieldsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4" data-testid="prospect-convert-fields">
      <div className="space-y-1.5">
        <label
          htmlFor="prospect-convert-package"
          className="text-xs font-semibold text-muted-foreground"
        >
          {t("adminPipeline.convertPackage")}
        </label>
        <Select
          value={values.packageId}
          onValueChange={(packageId) => onChange({ ...values, packageId })}
          disabled={disabled}
        >
          <SelectTrigger id="prospect-convert-package" data-testid="prospect-convert-package">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              {t("adminPipeline.convertNoPackage")}
            </SelectItem>
            {packages.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="prospect-convert-notes"
          className="text-xs font-semibold text-muted-foreground"
        >
          {t("adminPipeline.convertNotes")}
        </label>
        <Textarea
          id="prospect-convert-notes"
          data-testid="prospect-convert-notes"
          value={values.notes}
          onChange={(e) => onChange({ ...values, notes: e.target.value })}
          rows={2}
          placeholder={t("adminPipeline.convertNotesPlaceholder")}
          className="resize-none text-sm"
          disabled={disabled}
        />
      </div>

      {showTargetStage && (
        <div
          className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5"
          data-testid="prospect-convert-target"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
            {t("adminPipeline.convertResultLabel")}
          </p>
          <p className="text-sm font-medium text-foreground mt-0.5">
            {t("adminPipeline.convertTargetStage")}
          </p>
        </div>
      )}

      <RoundCalendarScheduleFields
        value={values.roundSchedule}
        onChange={(roundSchedule) => onChange({ ...values, roundSchedule })}
        disabled={disabled}
        compact
      />
    </div>
  );
}

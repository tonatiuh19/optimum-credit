import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** How an installment should be collected when created. */
export type InstallmentCollectionMode = "manual" | "link" | "paid";

export interface InstallmentDraft {
  label: string;
  amount: string;
  due_date: string;
  collection_mode: InstallmentCollectionMode;
}

export function emptyInstallmentDraft(index: number): InstallmentDraft {
  return {
    label: `Installment ${index}`,
    amount: "",
    due_date: "",
    collection_mode: "manual",
  };
}

/** Map draft → API create payload fields. */
export function draftToCreateSplitPayload(draft: InstallmentDraft) {
  const amount_cents = Math.round(parseFloat(draft.amount || "0") * 100);
  const mark_as_paid = draft.collection_mode === "paid";
  const send_payment_link = draft.collection_mode === "link";
  return {
    label: draft.label.trim() || `Installment`,
    amount_cents,
    due_date: draft.due_date,
    send_payment_link,
    reminder_flow_id: null as number | null,
    mark_as_paid,
  };
}

interface InstallmentDraftFieldsProps {
  draft: InstallmentDraft;
  onChange: (next: InstallmentDraft) => void;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
  /** Hide the remove control (single add form). */
  hideRemove?: boolean;
}

/**
 * Shared create-row for installments: label / amount / due date +
 * collection mode (manual | payment link | already paid).
 */
export default function InstallmentDraftFields({
  draft,
  onChange,
  onRemove,
  removeLabel,
  className,
  hideRemove,
}: InstallmentDraftFieldsProps) {
  const { t } = useTranslation();
  const mode = draft.collection_mode;

  const set = <K extends keyof InstallmentDraft>(
    key: K,
    value: InstallmentDraft[K],
  ) => onChange({ ...draft, [key]: value });

  return (
    <div className={cn("space-y-2 rounded-xl border border-border bg-card p-3", className)}>
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder={t("adminPipeline.splitLabel")}
          value={draft.label}
          onChange={(e) => set("label", e.target.value)}
          className="flex-1 min-w-[8rem] text-xs h-8"
        />
        <Input
          placeholder="$"
          type="number"
          min="0"
          step="0.01"
          value={draft.amount}
          onChange={(e) => set("amount", e.target.value)}
          className="w-24 text-xs h-8"
        />
        <Input
          type="date"
          value={draft.due_date}
          onChange={(e) => set("due_date", e.target.value)}
          className="w-36 text-xs h-8"
        />
        {!hideRemove && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            {removeLabel ?? t("adminPipeline.splitRemove")}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {(
          [
            ["manual", t("adminPipeline.modeManual")],
            ["link", t("adminPipeline.modeLink")],
            ["paid", t("adminPipeline.modePaid")],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={cn(
              "flex items-center gap-1.5 text-xs cursor-pointer select-none",
              mode === value ? "text-foreground font-semibold" : "text-muted-foreground",
            )}
          >
            <Checkbox
              checked={mode === value}
              onCheckedChange={(v) => {
                if (v === true) set("collection_mode", value);
              }}
            />
            {label}
          </label>
        ))}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="w-3 h-3 shrink-0 mt-0.5 text-primary" />
        {mode === "paid"
          ? t("adminPipeline.modePaidHint")
          : mode === "link"
            ? t("adminPipeline.modeLinkHint")
            : t("adminPipeline.modeManualHint")}
      </p>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import { Home, Landmark, Loader2 } from "lucide-react";
import type { CreditAnalysisLenderContext } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateCreditAnalysisContext } from "@/store/slices/creditAnalysisSlice";
import { cn } from "@/lib/utils";

type EscrowChoice = "auto" | "on" | "off";

const toChoice = (v: boolean | null | undefined): EscrowChoice => (v === true ? "on" : v === false ? "off" : "auto");
const fromChoice = (c: EscrowChoice): boolean | null => (c === "on" ? true : c === "off" ? false : null);

const score = Yup.number()
  .transform((v, raw) => (raw === "" || raw === null ? null : v))
  .nullable()
  .integer("invalid")
  .min(300, "invalid")
  .max(900, "invalid");

const schema = Yup.object({
  lender_score_model: Yup.string().max(40, "invalid"),
  lender_score: score,
  lender_target_score: score,
});

/**
 * Staff context for the enhanced Credit Analysis PDF: escrow (auto-detects a
 * recent mortgage pull; staff can force on/off) and the lender's own score
 * (usually FICO), which drives the goal and the escrow note in the PDF.
 */
export function CreditAnalysisLenderContextCard({ analysisId }: { analysisId: number }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const ctx = useAppSelector((s) => s.creditAnalysis.contextById[analysisId]) as
    | CreditAnalysisLenderContext
    | undefined;
  const saving = useAppSelector((s) => s.creditAnalysis.contextSavingId === analysisId);

  const save = async (patch: Parameters<typeof updateCreditAnalysisContext>[0]["patch"]) => {
    const res = await dispatch(updateCreditAnalysisContext({ analysisId, patch }));
    if (updateCreditAnalysisContext.rejected.match(res)) {
      toast({ title: t("creditAnalysis.context.saveError"), description: String(res.payload || ""), variant: "destructive" });
      return false;
    }
    toast({ title: t("creditAnalysis.context.saved") });
    return true;
  };

  const form = useFormik({
    initialValues: {
      lender_score_model: ctx?.lender_score_model ?? "",
      lender_score: ctx?.lender_score != null ? String(ctx.lender_score) : "",
      lender_target_score: ctx?.lender_target_score != null ? String(ctx.lender_target_score) : "",
    },
    enableReinitialize: true,
    validationSchema: schema,
    onSubmit: async (v) => {
      await save({
        lender_score_model: v.lender_score_model.trim() || null,
        lender_score: v.lender_score ? Number(v.lender_score) : null,
        lender_target_score: v.lender_target_score ? Number(v.lender_target_score) : null,
      });
    },
  });

  const escrow = toChoice(ctx?.escrow);
  const choices: EscrowChoice[] = ["auto", "on", "off"];

  return (
    <div className="card-base p-4 space-y-4 animate-in fade-in" data-testid="credit-analysis-context">
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Home className="h-3.5 w-3.5" />
          {t("creditAnalysis.context.escrow")}
        </p>
        <div className="inline-flex rounded-lg border border-border p-0.5 bg-secondary/40" role="radiogroup">
          {choices.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={escrow === c}
              disabled={saving}
              onClick={() => escrow !== c && void save({ escrow: fromChoice(c) })}
              className={cn(
                "px-3 py-1.5 text-xs rounded-md transition-all duration-200",
                escrow === c
                  ? c === "on"
                    ? "bg-warning/15 text-warning font-semibold shadow-sm"
                    : "bg-background text-foreground font-semibold shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`escrow-${c}`}
            >
              {t(`creditAnalysis.context.escrow_${c}`)}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{t("creditAnalysis.context.escrowHint")}</p>
      </div>

      <form onSubmit={form.handleSubmit} className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Landmark className="h-3.5 w-3.5" />
          {t("creditAnalysis.context.lender")}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input
            placeholder={t("creditAnalysis.context.modelPlaceholder")}
            aria-label={t("creditAnalysis.context.model")}
            {...form.getFieldProps("lender_score_model")}
          />
          <Input
            inputMode="numeric"
            placeholder={t("creditAnalysis.context.scorePlaceholder")}
            aria-label={t("creditAnalysis.context.score")}
            {...form.getFieldProps("lender_score")}
            data-testid="lender-score"
          />
          <Input
            inputMode="numeric"
            placeholder={t("creditAnalysis.context.targetPlaceholder")}
            aria-label={t("creditAnalysis.context.target")}
            {...form.getFieldProps("lender_target_score")}
          />
        </div>
        {(form.errors.lender_score || form.errors.lender_target_score) && (
          <p className="text-xs text-destructive">{t("creditAnalysis.context.scoreInvalid")}</p>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">{t("creditAnalysis.context.lenderHint")}</p>
          <Button type="submit" size="sm" disabled={saving || !form.dirty}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            {t("creditAnalysis.context.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { ArrowRight, CheckCircle2, Clock, Loader2, ShieldAlert } from "lucide-react";
import { reportNextStep, type ReportNextInput } from "@shared/reportNextStep";

const TONE = {
  info: "border-primary/25 bg-primary/5 text-foreground",
  action: "border-accent/40 bg-accent/10 text-foreground",
  warning: "border-destructive/30 bg-destructive/5 text-foreground",
  done: "border-border bg-muted/40 text-muted-foreground",
} as const;

/**
 * "Next step" line for a progress report: one recommended action from its facts
 * (shared/reportNextStep.ts), the same in the wizard, client panel, approval card and queue.
 */
export function NextStep({ input, compact = false, who }: { input: ReportNextInput; compact?: boolean; who?: string | null }) {
  const { t } = useTranslation();
  const { step, tone } = reportNextStep(input);
  const Icon = tone === "done" ? CheckCircle2 : tone === "warning" ? ShieldAlert : step === "reading" ? Loader2 : tone === "action" ? ArrowRight : Clock;
  const text = t(`reportNextStep.${step}`, { who: who || t("reportNextStep.theApprover") });
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground" data-testid={`next-step-${step}`}>
        <Icon className={`w-3 h-3 shrink-0 ${step === "reading" ? "animate-spin" : ""}`} />
        {text}
      </span>
    );
  }
  return (
    <p className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${TONE[tone]}`} data-testid={`next-step-${step}`} role="status">
      <Icon className={`w-3.5 h-3.5 shrink-0 mt-px ${step === "reading" ? "animate-spin" : ""}`} />
      <span>
        <span className="font-semibold">{t("reportNextStep.label")}</span> {text}
      </span>
    </p>
  );
}

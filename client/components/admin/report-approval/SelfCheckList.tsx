import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ChevronDown, MinusCircle, XCircle } from "lucide-react";
import type { ReportSelfCheck } from "@/store/slices/reportApprovalSlice";

/** Spec v1.1 §9 checks: failures first (named + detail), passes collapsed. */
export function SelfCheckList({ checks }: { checks: ReportSelfCheck[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const failed = checks.filter((c) => c.pass === false);
  const rest = checks.filter((c) => c.pass !== false);
  const Row = ({ c }: { c: ReportSelfCheck }) => {
    const Icon = c.pass === false ? XCircle : c.pass === null ? MinusCircle : CheckCircle2;
    const tone = c.pass === false ? "text-destructive" : c.pass === null ? "text-muted-foreground" : "text-accent";
    return (
      <li className="flex items-start gap-2 text-xs">
        <Icon className={`w-3.5 h-3.5 shrink-0 mt-px ${tone}`} />
        <div className="min-w-0">
          <span className="font-semibold text-foreground">{t(`reportApproval.checks.${c.key}`, { defaultValue: c.key })}</span>
          <span className="text-muted-foreground"> · {c.pass === null ? t("reportApproval.notApplicable") : c.detail}</span>
        </div>
      </li>
    );
  };
  if (!checks.length) return null;
  return (
    <div className="space-y-1.5" data-testid="self-check-list">
      {failed.length > 0 && (
        <ul className="space-y-1.5" data-testid="self-check-failed">
          {failed.map((c) => (
            <Row key={c.key} c={c} />
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
        aria-expanded={open}
      >
        {t("reportApproval.passedCount", { count: rest.filter((c) => c.pass === true).length, total: checks.length })}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="space-y-1.5 animate-in fade-in slide-in-from-top-1">
          {rest.map((c) => (
            <Row key={c.key} c={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

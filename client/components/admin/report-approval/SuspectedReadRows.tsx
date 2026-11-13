import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, Loader2, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch } from "@/store/hooks";
import { excludeReadRow, type ReportSelfCheck, type SuspectedReadRow } from "@/store/slices/reportApprovalSlice";

const rowKey = (r: SuspectedReadRow) => `${r.extraction_id}|${r.bureau}|${r.creditor}|${r.mask ?? ""}|${r.balance ?? ""}|${r.dateOpened ?? ""}`;

/** Suspected rows from every failing check, once each. */
export function collectSuspects(checks: ReportSelfCheck[]): SuspectedReadRow[] {
  const seen = new Map<string, SuspectedReadRow>();
  for (const c of checks) {
    if (c.pass !== false) continue;
    for (const r of c.suspects ?? []) if (!seen.has(rowKey(r))) seen.set(rowKey(r), r);
  }
  return [...seen.values()];
}

/**
 * Held report: rows the AI read that the text reader did not find on the same PDF (a row read twice,
 * a partial row). Staff who can approve mark the ones that are not real accounts; the report re-checks.
 */
export function SuspectedReadRows({
  reportId,
  checks,
  canEdit,
  onChanged,
}: {
  reportId: number;
  checks: ReportSelfCheck[];
  canEdit: boolean;
  /** Called after a save; newReportId is set when the report passed and was replaced. */
  onChanged?: (newReportId: number | null) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const rows = useMemo(() => collectSuspects(checks), [checks]);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  if (!rows.length) return null;

  const money = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US")}`);
  const mark = async (row: SuspectedReadRow) => {
    const k = rowKey(row);
    setBusy(k);
    const res = await dispatch(excludeReadRow({ reportId, row }));
    setBusy(null);
    if (excludeReadRow.rejected.match(res)) {
      toast({ variant: "destructive", title: String(res.payload || t("reportApproval.suspects.error")) });
      return;
    }
    setDone((d) => new Set(d).add(k));
    const { outcome, reason } = res.payload;
    toast({
      title:
        outcome === "ready"
          ? t("reportApproval.suspects.passesNow")
          : outcome === "still_held"
            ? t("reportApproval.suspects.stillHeld")
            : reason === "not_latest_round"
              ? t("reportApproval.suspects.savedNotLatest")
              : t("reportApproval.suspects.saved"),
    });
    onChanged?.(outcome === "ready" && res.payload.round_report_id !== reportId ? res.payload.round_report_id : null);
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2 animate-in fade-in slide-in-from-top-1" data-testid="suspected-read-rows">
      <p className="flex items-start gap-2 text-xs font-semibold text-foreground">
        <ScanSearch className="w-3.5 h-3.5 shrink-0 mt-px text-primary" />
        {t("reportApproval.suspects.title", { count: rows.length })}
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">{t("reportApproval.suspects.hint")}</p>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const k = rowKey(r);
          const marked = done.has(k);
          return (
            <li key={k} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-xs">
                <span className="font-medium text-foreground break-words">{r.creditor}</span>
                {r.mask ? <span className="text-muted-foreground"> …{r.mask}</span> : null}
                <span className="block text-muted-foreground">
                  {t(`reportApproval.suspects.side.${r.side}`)} · {r.bureau} · {money(r.balance)}
                  {r.dateOpened ? ` · ${t("reportApproval.suspects.opened", { date: r.dateOpened })}` : ""}
                  {r.fragment ? ` · ${t("reportApproval.suspects.fragment")}` : ""}
                </span>
              </div>
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!!busy || marked}
                  onClick={() => void mark(r)}
                  className="h-8 gap-1.5 shrink-0 w-full sm:w-auto"
                  data-testid="suspect-exclude"
                >
                  {busy === k ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
                  {marked ? t("reportApproval.suspects.marked") : t("reportApproval.suspects.notReal")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

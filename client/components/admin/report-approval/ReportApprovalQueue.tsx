import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, ShieldAlert, ShieldCheck } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchPendingReportApprovals } from "@/store/slices/reportApprovalSlice";
import { ReportApprovalCard } from "@/components/admin/report-approval/ReportApprovalCard";
import { NextStep } from "@/components/admin/report-approval/NextStep";

/** Dashboard: progress reports published but not sent (Spec v1.1 P0-1). Hidden when empty. */
export function ReportApprovalQueue() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const items = useAppSelector((s) => s.reportApproval.pending);
  const [open, setOpen] = useState<number | null>(null);
  const location = useLocation();
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void dispatch(fetchPendingReportApprovals());
  }, [dispatch]);
  // Inbox link "/admin#report-approvals": scroll here once the list renders (SPA links don't).
  useEffect(() => {
    if (location.hash === "#report-approvals" && items.length) ref.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [location.hash, items.length]);

  if (!items.length) return null;
  return (
    <section ref={ref} id="report-approvals" className="card-base p-4 sm:p-5 space-y-3 scroll-mt-20 animate-in fade-in" data-testid="report-approval-queue">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ShieldCheck className="w-4 h-4 text-primary" />
        {t("reportApproval.queueTitle", { count: items.length })}
      </h2>
      <ul className="divide-y divide-border">
        {items.map((it) => {
          const failed = it.delivery_status === "needs_review";
          return (
            <li key={it.id} className="py-2">
              <button
                type="button"
                onClick={() => setOpen((o) => (o === it.id ? null : it.id))}
                className="w-full flex items-center gap-3 text-left"
                aria-expanded={open === it.id}
              >
                <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${failed ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary"}`}>
                  {failed ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground truncate">
                    {it.client_name} · R{it.round_number} · {it.locale.toUpperCase()}
                    {it.report_kind === "score_update" && (
                      <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-px text-[10px] font-semibold text-primary align-middle" data-testid="approval-score-update-badge">
                        {t("reportWizard.scoreUpdate.modeTitle")}
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-muted-foreground truncate">
                    {failed ? t("reportApproval.failedCount", { count: it.failed_checks.length }) : t("reportApproval.readyToSend")}
                    {it.published_by ? ` · ${it.published_by}` : ""} · {new Date(it.created_at).toLocaleString(i18n.language, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                  <span className="block mt-0.5">
                    <NextStep compact input={{ delivery: { status: it.delivery_status, checks: it.failed_checks, canApprove: it.can_approve } }} />
                  </span>
                </span>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open === it.id ? "rotate-180" : ""}`} />
              </button>
              {open === it.id && (
                <div className="mt-2 animate-in fade-in slide-in-from-top-1">
                  <ReportApprovalCard reportId={it.id} onApproved={() => setOpen(null)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

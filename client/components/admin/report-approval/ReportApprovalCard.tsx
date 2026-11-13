import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import { CheckCircle2, Clock, Loader2, RefreshCw, Send, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { approveRoundReport, fetchReportApproval, rebuildRoundReport, setApprovalAlias } from "@/store/slices/reportApprovalSlice";
import { SelfCheckList } from "@/components/admin/report-approval/SelfCheckList";
import { explainHeldChecks, type HeldReason } from "@shared/heldReport";
import { NextStep } from "@/components/admin/report-approval/NextStep";
import { SuspectedReadRows } from "@/components/admin/report-approval/SuspectedReadRows";

/**
 * Spec v1.1 P0-1: a published progress report waits here. The language owner
 * (or Cesar) clicks Approve & send; a failed self-check needs a release
 * manager's written override. Nothing reaches the client before that.
 */
export function ReportApprovalCard({ reportId, onApproved, onRebuilt }: { reportId: number; onApproved?: () => void; onRebuilt?: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const a = useAppSelector((s) => s.reportApproval.byId[reportId]);
  const approving = useAppSelector((s) => !!s.reportApproval.approving[reportId]);

  useEffect(() => {
    void dispatch(fetchReportApproval(reportId));
  }, [dispatch, reportId]);

  const approve = async (overrideReason?: string) => {
    const r = await dispatch(approveRoundReport({ id: a?.id ?? reportId, overrideReason }));
    if (approveRoundReport.rejected.match(r)) {
      toast({ title: String(r.payload || t("reportApproval.error")), variant: "destructive" });
      return false;
    }
    toast({ title: r.payload.delivery_status === "silent" ? t("reportApproval.releasedSilent") : t("reportApproval.sent") });
    onApproved?.();
    return true;
  };

  const rebuild = async () => {
    const r = await dispatch(rebuildRoundReport(a?.id ?? reportId));
    if (rebuildRoundReport.rejected.match(r)) {
      toast({ title: String(r.payload || t("reportApproval.rebuildError")), variant: "destructive" });
      return;
    }
    toast({ title: t("reportApproval.rebuilt", { round: r.payload.round_number }) });
    onRebuilt?.();
  };

  const formik = useFormik({
    initialValues: { reason: "" },
    validationSchema: Yup.object({ reason: Yup.string().trim().min(10, t("reportApproval.reasonMin")).required(t("reportApproval.reasonMin")) }),
    onSubmit: async (v) => {
      await approve(v.reason.trim());
    },
  });

  if (!a) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
      </div>
    );
  }
  const status = a.delivery_status;
  if (!status || status === "sent" || status === "silent") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-accent" data-testid="report-approval-done">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {status === "silent" ? t("reportApproval.doneSilent", { who: a.approved_by ?? "—" }) : status ? t("reportApproval.doneSent", { who: a.approved_by ?? "—" }) : t("reportApproval.legacy")}
      </p>
    );
  }
  const failed = status === "needs_review";
  // Held: whose problem it is, the reasons in plain words from the actual numbers, and the next step.
  const held = failed ? explainHeldChecks(a.checks) : null;
  const money = (n: number | null) => (n == null ? "—" : `$${n.toLocaleString("en-US")}`);
  const reasonText = (r: HeldReason) =>
    r.kind === "other"
      ? t("reportApproval.heldReason.other", { label: t(`reportApproval.checks.${r.key}`, { defaultValue: r.key }), detail: r.detail })
      : t(`reportApproval.heldReason.${r.kind}`, {
          pull: t(`reportApproval.heldPull.${r.pull ?? "none"}`),
          bureau: t(`reportApproval.heldBureau.${r.bureau ?? "none"}`),
          platform: r.kind === "limits" || r.kind === "balances" ? money(r.platform) : String(r.platform ?? "—"),
          report: r.kind === "limits" || r.kind === "balances" ? money(r.report) : String(r.report ?? "—"),
        });
  return (
    <div
      className={`rounded-xl border px-3 py-3 space-y-2.5 animate-in fade-in ${failed ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}`}
      data-testid="report-approval-card"
      role="status"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {failed ? <ShieldAlert className="w-4 h-4 text-destructive shrink-0" /> : <Clock className="w-4 h-4 text-primary shrink-0" />}
        {held ? t(held.cause === "file" ? "reportApproval.heldFileTitle" : "reportApproval.heldPlatformTitle") : t("reportApproval.pendingTitle")}
      </p>
      <p className="text-xs text-muted-foreground" data-testid="report-held-body">
        {held
          ? t(held.cause === "file" ? "reportApproval.heldFileBody" : "reportApproval.heldPlatformBody")
          : a.options?.notify_client === false
            ? t("reportApproval.pendingBodySilent")
            : t("reportApproval.pendingBody")}
      </p>
      {held && held.reasons.length > 0 && (
        <div className="rounded-lg border border-destructive/20 bg-background/60 px-2.5 py-2 space-y-1" data-testid="report-held-reasons">
          <p className="text-[11px] font-semibold text-foreground">{t("reportApproval.heldReasonsTitle")}</p>
          <ul className="space-y-0.5 list-disc pl-4 text-xs text-muted-foreground">
            {held.reasons.slice(0, 6).map((r, i) => (
              <li key={`${r.key}-${i}`}>{reasonText(r)}</li>
            ))}
          </ul>
        </div>
      )}
      <NextStep input={{ delivery: { status, checks: a.checks, canApprove: a.can_approve, rebuilt: !!a.rebuilt_from } }} />
      {a.rebuilt_from ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-accent" data-testid="report-self-healed">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          {t("reportApproval.selfHealed")}
        </p>
      ) : null}
      <SelfCheckList checks={a.checks} />
      {failed && (
        <SuspectedReadRows
          reportId={a.id ?? reportId}
          checks={a.checks}
          canEdit={a.can_approve}
          onChanged={(newId) => {
            if (!newId) return void dispatch(fetchReportApproval(reportId));
            // Replaced by a report that passes: load it and show it in this card.
            void dispatch(fetchReportApproval(newId)).then((r) => {
              if (fetchReportApproval.fulfilled.match(r)) dispatch(setApprovalAlias({ fromId: reportId, approval: r.payload }));
            });
          }}
        />
      )}
      {!failed && a.can_approve && (
        <Button type="button" size="sm" onClick={() => void approve()} disabled={approving} className="gap-1.5 w-full sm:w-auto" data-testid="report-approve">
          {approving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : a.options?.notify_client === false ? <ShieldCheck className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
          {a.options?.notify_client === false ? t("reportApproval.approveRelease") : t("reportApproval.approveSend")}
        </Button>
      )}
      {!failed && !a.can_approve && <p className="text-[11px] text-muted-foreground">{t("reportApproval.notApprover")}</p>}
      {failed && a.can_override && (
        <form onSubmit={formik.handleSubmit} className="space-y-2" data-testid="report-override-form">
          <Textarea
            name="reason"
            value={formik.values.reason}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            rows={2}
            placeholder={t("reportApproval.reasonPlaceholder")}
            className="text-xs"
          />
          {formik.touched.reason && formik.errors.reason && <p className="text-[11px] text-destructive">{formik.errors.reason}</p>}
          <Button type="submit" size="sm" variant="destructive" disabled={approving || formik.isSubmitting} className="gap-1.5 w-full sm:w-auto">
            {approving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
            {t("reportApproval.override")}
          </Button>
        </form>
      )}
      {failed && !a.can_override && <p className="text-[11px] text-muted-foreground">{t("reportApproval.fixAndRepublish")}</p>}
      {failed && a.can_approve && (
        <div className="space-y-1 border-t border-border/60 pt-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" size="sm" variant="outline" disabled={approving} className="gap-1.5 w-full sm:w-auto" data-testid="report-rebuild">
                {approving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {t("reportApproval.rebuild")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("reportApproval.rebuild")}</AlertDialogTitle>
                <AlertDialogDescription>{t("reportApproval.rebuildConfirm")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel", { defaultValue: "Cancel" })}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void rebuild()} data-testid="report-rebuild-confirm">
                  {t("reportApproval.rebuild")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <p className="text-[11px] text-muted-foreground">{t("reportApproval.rebuildHint")}</p>
        </div>
      )}
    </div>
  );
}

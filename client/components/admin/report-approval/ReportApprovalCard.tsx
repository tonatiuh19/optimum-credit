import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import { CheckCircle2, Clock, Loader2, Send, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { approveRoundReport, fetchReportApproval } from "@/store/slices/reportApprovalSlice";
import { SelfCheckList } from "@/components/admin/report-approval/SelfCheckList";

/**
 * Spec v1.1 P0-1: a published progress report waits here. The language owner
 * (or Cesar / Alex) clicks Approve & send; a failed self-check needs a release
 * manager's written override. Nothing reaches the client before that.
 */
export function ReportApprovalCard({ reportId, onApproved }: { reportId: number; onApproved?: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const a = useAppSelector((s) => s.reportApproval.byId[reportId]);
  const approving = useAppSelector((s) => !!s.reportApproval.approving[reportId]);

  useEffect(() => {
    void dispatch(fetchReportApproval(reportId));
  }, [dispatch, reportId]);

  const approve = async (overrideReason?: string) => {
    const r = await dispatch(approveRoundReport({ id: reportId, overrideReason }));
    if (approveRoundReport.rejected.match(r)) {
      toast({ title: String(r.payload || t("reportApproval.error")), variant: "destructive" });
      return false;
    }
    toast({ title: r.payload.delivery_status === "silent" ? t("reportApproval.releasedSilent") : t("reportApproval.sent") });
    onApproved?.();
    return true;
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
  return (
    <div
      className={`rounded-xl border px-3 py-3 space-y-2.5 animate-in fade-in ${failed ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5"}`}
      data-testid="report-approval-card"
      role="status"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {failed ? <ShieldAlert className="w-4 h-4 text-destructive shrink-0" /> : <Clock className="w-4 h-4 text-primary shrink-0" />}
        {failed ? t("reportApproval.needsReviewTitle") : t("reportApproval.pendingTitle")}
      </p>
      <p className="text-xs text-muted-foreground">
        {failed ? t("reportApproval.needsReviewBody") : a.options?.notify_client === false ? t("reportApproval.pendingBodySilent") : t("reportApproval.pendingBody")}
      </p>
      <SelfCheckList checks={a.checks} />
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
    </div>
  );
}

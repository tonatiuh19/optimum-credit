import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Undo2, XCircle } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppDispatch } from "@/store/hooks";
import {
  cancelEventRegistration,
  checkInEventRegistration,
  undoEventCheckIn,
} from "@/store/slices/eventMarketingSlice";
import { cn } from "@/lib/utils";
import type { EventRegistration } from "@shared/api";

const STATUS_STYLE: Record<EventRegistration["status"], string> = {
  registered: "bg-primary/10 text-primary border-primary/30",
  waitlisted: "bg-secondary text-secondary-foreground border-border",
  cancelled: "bg-muted text-muted-foreground border-border line-through",
};

/** What the person typed on the form (the CRM record may differ and is kept). */
function typedSummary(r: EventRegistration): string {
  const a = r.answers_json || {};
  return [a.first_name, a.last_name, a.phone].filter(Boolean).map(String).join(" · ");
}

export function EventRegistrationRow({ r, saving }: { r: EventRegistration; saving: boolean }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || `#${r.client_id}`;
  const cancelled = r.status === "cancelled";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-3 py-3 flex flex-wrap items-center justify-between gap-2 transition-colors",
        cancelled && "opacity-60",
      )}
      data-testid={`event-reg-${r.id}`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">{name}</span>
          <span className={cn("text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border", STATUS_STYLE[r.status])}>
            {t(`eventMarketing.admin.regStatus.${r.status}`)}
          </span>
          {r.profile_mismatch && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive">
                  <AlertTriangle className="w-3 h-3" />
                  {t("eventMarketing.admin.mismatch")}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                {t("eventMarketing.admin.mismatchHint", { typed: typedSummary(r) })}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="text-xs text-muted-foreground break-all">
          {r.email || "—"}
          {r.phone ? ` · ${r.phone}` : ""}
          {r.session_title_en ? ` · ${r.session_title_en}` : ""}
          {" · "}
          {t(`eventMarketing.source.${r.source_qr}`)}
        </div>
        {r.checked_in_at && (
          <div className="text-xs text-accent inline-flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t("eventMarketing.admin.checkedInAt", { when: String(r.checked_in_at).replace("T", " ").slice(0, 16) })}
            {r.check_in_method ? ` · ${t(`eventMarketing.admin.checkInMethod.${r.check_in_method}`)}` : ""}
          </div>
        )}
      </div>
      {!cancelled && (
        <div className="flex flex-wrap gap-1.5">
          {r.checked_in_at ? (
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => dispatch(undoEventCheckIn(r.id))}>
              <Undo2 className="w-3.5 h-3.5 mr-1" />
              {t("eventMarketing.admin.undoCheckIn")}
            </Button>
          ) : (
            <Button size="sm" disabled={saving} onClick={() => dispatch(checkInEventRegistration(r.id))}>
              {t("eventMarketing.admin.checkIn")}
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-destructive" disabled={saving} aria-label={t("eventMarketing.admin.cancelReg")}>
                <XCircle className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("eventMarketing.admin.cancelReg")}</AlertDialogTitle>
                <AlertDialogDescription>{t("eventMarketing.admin.cancelRegConfirm")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("eventMarketing.admin.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => dispatch(cancelEventRegistration(r.id))}
                >
                  {t("eventMarketing.admin.cancelReg")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}

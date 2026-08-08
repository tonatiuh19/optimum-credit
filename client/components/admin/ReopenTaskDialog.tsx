import { Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import FieldHint from "@/components/admin/FieldHint";

export type ReopenTaskTarget = {
  title_en?: string | null;
  slug?: string | null;
  task_type?: string | null;
  is_required?: number | boolean | null;
};

export function shouldWarnReopenRollback(
  pipelineStage: string | null | undefined,
  task: ReopenTaskTarget | null | undefined,
): boolean {
  const stage = pipelineStage || "";
  if (!stage || stage === "new_client" || stage === "prospect") return false;
  return (
    task?.task_type === "upload" ||
    task?.task_type === "sign_document" ||
    Number(task?.is_required) === 1
  );
}

interface ReopenTaskDialogProps {
  open: boolean;
  task: ReopenTaskTarget | null;
  pipelineStage?: string | null;
  notifyClient: boolean;
  reason: string;
  sending?: boolean;
  onOpenChange: (open: boolean) => void;
  onNotifyChange: (notify: boolean) => void;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ReopenTaskDialog({
  open,
  task,
  pipelineStage,
  notifyClient,
  reason,
  sending = false,
  onOpenChange,
  onNotifyChange,
  onReasonChange,
  onConfirm,
  onCancel,
}: ReopenTaskDialogProps) {
  const { t } = useTranslation();
  const showRollbackHint = shouldWarnReopenRollback(pipelineStage, task);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !sending) onOpenChange(false);
      }}
    >
      <DialogContent className="max-w-md w-[calc(100%-2rem)] sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-primary shrink-0" />
            {t("adminHelpers.reopenTaskTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("adminHelpers.reopenTaskBody", {
              task:
                task?.title_en ||
                task?.slug ||
                t("adminHelpers.remindTaskFallback"),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {showRollbackHint && (
            <div data-testid="reopen-rollback-hint">
              <FieldHint tone="warning">
                {t("adminHelpers.reopenTaskMidPipelineHint")}
              </FieldHint>
            </div>
          )}

          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <Checkbox
              id="reopen-notify-client"
              data-testid="reopen-notify-client"
              checked={notifyClient}
              onCheckedChange={(v) => onNotifyChange(v === true)}
              disabled={sending}
              className="mt-0.5"
            />
            <div className="min-w-0 space-y-0.5">
              <Label
                htmlFor="reopen-notify-client"
                className="text-sm font-medium cursor-pointer leading-snug"
              >
                {t("adminHelpers.reopenTaskNotify")}
              </Label>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t("adminHelpers.reopenTaskNotifyHint")}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reopen-reason">
              {t("adminHelpers.reopenTaskReason")}
            </Label>
            <Textarea
              id="reopen-reason"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder={t("adminHelpers.reopenTaskReasonPlaceholder")}
              className="min-h-[72px] text-sm"
              disabled={sending}
            />
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={sending}
            onClick={onCancel}
          >
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button
            type="button"
            disabled={sending}
            onClick={onConfirm}
            className="gap-1.5"
            data-testid="reopen-confirm"
          >
            {sending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            {t("adminHelpers.reopenTaskConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

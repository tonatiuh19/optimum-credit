import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  Ban,
  Loader2,
  NotebookPen,
  PauseCircle,
  PlayCircle,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch } from "@/store/hooks";
import {
  addAdminClientNote,
  fetchPanelClient,
  setAdminClientPaused,
} from "@/store/slices/adminSlice";
import { cn } from "@/lib/utils";

/** Quick reasons Lecca uses most (i18n keys under adminPipeline.pauseReasons). */
const PAUSE_REASON_KEYS = ["payment", "login", "monitoring"] as const;

const noteSchema = Yup.object({
  note: Yup.string().trim().required("required").max(1500, "tooLong"),
});

const pauseSchema = Yup.object({
  reason: Yup.string().trim().required("required").max(1000, "tooLong"),
});

/** Newest-first lines from clients.admin_notes (one entry per line). */
function splitNotes(raw: unknown): string[] {
  return String(raw || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse();
}

/**
 * Client file status (pause / block / resume with a reason) + append-only
 * staff notes. paused + blocked stop automations; blocked also locks portal.
 * Used in the pipeline client panel Overview tab.
 */
export function ClientStatusNotesCard({
  clientId,
  status,
  adminNotes,
}: {
  clientId: number;
  status: string;
  adminNotes: string | null | undefined;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  // Hold dialog: which status to apply (null = closed).
  const [holdMode, setHoldMode] = useState<"paused" | "blocked" | null>(null);
  const pauseOpen = holdMode !== null;
  const setPauseOpen = (open: boolean) => {
    if (!open) setHoldMode(null);
  };
  const [resuming, setResuming] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const isPaused = status === "paused";
  const isBlocked = status === "blocked";
  const isHeld = isPaused || isBlocked;
  const notes = useMemo(() => splitNotes(adminNotes), [adminNotes]);
  const visibleNotes = showAll ? notes : notes.slice(0, 4);

  const fieldError = (code: string | undefined) =>
    code ? t(`adminPipeline.notesValidation.${code}`) : null;

  const noteForm = useFormik({
    initialValues: { note: "" },
    validationSchema: noteSchema,
    onSubmit: async (values, helpers) => {
      const res = await dispatch(
        addAdminClientNote({ id: clientId, note: values.note.trim() }),
      );
      if (!addAdminClientNote.fulfilled.match(res)) {
        toast({
          title: t("adminPipeline.noteSaveError"),
          description: String(res.payload || ""),
          variant: "destructive",
        });
        return;
      }
      helpers.resetForm();
      toast({ title: t("adminPipeline.noteSaved") });
      void dispatch(fetchPanelClient(clientId));
    },
  });

  const pauseForm = useFormik({
    initialValues: { reason: "" },
    validationSchema: pauseSchema,
    onSubmit: async (values, helpers) => {
      const res = await dispatch(
        setAdminClientPaused({
          id: clientId,
          paused: true,
          reason: values.reason.trim(),
          holdStatus: holdMode ?? "paused",
        }),
      );
      if (!setAdminClientPaused.fulfilled.match(res)) {
        toast({
          title: t("adminPipeline.pauseError"),
          description: String(res.payload || ""),
          variant: "destructive",
        });
        return;
      }
      helpers.resetForm();
      toast({
        title:
          holdMode === "blocked"
            ? t("adminPipeline.blockedToast")
            : t("adminPipeline.pausedToast"),
      });
      setHoldMode(null);
      void dispatch(fetchPanelClient(clientId));
    },
  });

  const handleResume = async () => {
    setResuming(true);
    try {
      const res = await dispatch(
        setAdminClientPaused({ id: clientId, paused: false }),
      );
      if (!setAdminClientPaused.fulfilled.match(res)) {
        toast({
          title: t("adminPipeline.pauseError"),
          description: String(res.payload || ""),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: t("adminPipeline.resumedToast", {
          status: t(`adminPipeline.clientStatus.${res.payload.status}`, {
            defaultValue: res.payload.status,
          }),
        }),
      });
      void dispatch(fetchPanelClient(clientId));
    } finally {
      setResuming(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl p-4 space-y-3 transition-colors duration-300",
        isBlocked
          ? "bg-destructive/5 ring-1 ring-destructive/30"
          : isPaused
            ? "bg-secondary/60 ring-1 ring-border"
            : "bg-muted/40",
      )}
      data-testid="client-status-notes-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("adminPipeline.statusNotesHeading")}
          </h3>
          {isHeld && (
            <Badge
              variant="outline"
              className={cn(
                "gap-1 text-[10px] animate-in fade-in zoom-in-95",
                isBlocked && "border-destructive/30 text-destructive",
              )}
            >
              {isBlocked ? (
                <Ban className="w-3 h-3" />
              ) : (
                <PauseCircle className="w-3 h-3" />
              )}
              {t(`adminPipeline.clientStatus.${status}`)}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
        {isPaused && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => setHoldMode("blocked")}
            data-testid="panel-block-client"
          >
            <Ban className="w-3.5 h-3.5" />
            {t("adminPipeline.blockClient")}
          </Button>
        )}
        {isHeld ? (
          <Button
            type="button"
            size="sm"
            className="h-8 px-2.5 text-xs gap-1.5"
            disabled={resuming}
            onClick={() => void handleResume()}
            data-testid="panel-resume-client"
          >
            {resuming ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PlayCircle className="w-3.5 h-3.5" />
            )}
            {t("adminPipeline.resumeClient")}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs gap-1.5"
              disabled={status === "cancelled"}
              onClick={() => setHoldMode("paused")}
              data-testid="panel-pause-client"
            >
              <PauseCircle className="w-3.5 h-3.5" />
              {t("adminPipeline.pauseClient")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
              disabled={status === "cancelled"}
              onClick={() => setHoldMode("blocked")}
              data-testid="panel-block-client"
            >
              <Ban className="w-3.5 h-3.5" />
              {t("adminPipeline.blockClient")}
            </Button>
          </>
        )}
        </div>
      </div>

      <form onSubmit={noteForm.handleSubmit} className="space-y-2">
        <Textarea
          {...noteForm.getFieldProps("note")}
          rows={2}
          placeholder={t("adminPipeline.notePlaceholder")}
          disabled={noteForm.isSubmitting}
          className="text-sm resize-none"
          data-testid="panel-note-input"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-destructive min-h-[1rem]">
            {noteForm.submitCount > 0 && fieldError(noteForm.errors.note)}
          </p>
          <Button
            type="submit"
            size="sm"
            className="h-8 px-2.5 text-xs gap-1.5"
            disabled={noteForm.isSubmitting || !noteForm.values.note.trim()}
            data-testid="panel-add-note"
          >
            {noteForm.isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <NotebookPen className="w-3.5 h-3.5" />
            )}
            {t("adminPipeline.addNote")}
          </Button>
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <StickyNote className="w-3.5 h-3.5" />
          {t("adminPipeline.notesEmpty")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {visibleNotes.map((line, i) => (
            <li
              key={`${i}-${line.slice(0, 24)}`}
              className="text-xs leading-relaxed text-foreground bg-background/70 rounded-lg px-2.5 py-1.5 break-words animate-in fade-in slide-in-from-top-1"
            >
              {line}
            </li>
          ))}
          {notes.length > 4 && (
            <li>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll
                  ? t("adminPipeline.notesShowLess")
                  : t("adminPipeline.notesShowAll", { count: notes.length })}
              </button>
            </li>
          )}
        </ul>
      )}

      <Dialog
        open={pauseOpen}
        onOpenChange={(open) => {
          setPauseOpen(open);
          if (!open) pauseForm.resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={pauseForm.handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {holdMode === "blocked" ? (
                  <Ban className="w-4 h-4 text-destructive" />
                ) : (
                  <PauseCircle className="w-4 h-4 text-primary" />
                )}
                {holdMode === "blocked"
                  ? t("adminPipeline.blockDialogTitle")
                  : t("adminPipeline.pauseDialogTitle")}
              </DialogTitle>
              <DialogDescription>
                {holdMode === "blocked"
                  ? t("adminPipeline.blockDialogDescription")
                  : t("adminPipeline.pauseDialogDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-1.5">
              {PAUSE_REASON_KEYS.map((key) => {
                const label = t(`adminPipeline.pauseReasons.${key}`);
                const active = pauseForm.values.reason === label;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pauseForm.setFieldValue("reason", label)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-all duration-200",
                      active
                        ? "border-primary bg-primary/10 text-primary scale-[1.02]"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="space-y-1">
              <Textarea
                {...pauseForm.getFieldProps("reason")}
                rows={3}
                placeholder={t("adminPipeline.pauseReasonPlaceholder")}
                disabled={pauseForm.isSubmitting}
                className="text-sm resize-none"
                data-testid="panel-pause-reason"
              />
              <p className="text-xs text-destructive min-h-[1rem]">
                {pauseForm.submitCount > 0 &&
                  fieldError(pauseForm.errors.reason)}
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPauseOpen(false)}
                disabled={pauseForm.isSubmitting}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant={holdMode === "blocked" ? "destructive" : "default"}
                disabled={pauseForm.isSubmitting}
                data-testid="panel-confirm-pause"
              >
                {pauseForm.isSubmitting && (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                )}
                {holdMode === "blocked"
                  ? t("adminPipeline.blockConfirm")
                  : t("adminPipeline.pauseConfirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

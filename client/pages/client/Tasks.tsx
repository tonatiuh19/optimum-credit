import { useEffect, useState, useRef } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  ClipboardList,
  CheckCircle2,
  Circle,
  FileText,
  Upload,
  PenLine,
  ChevronDown,
  ChevronUp,
  Lock,
  CloudUpload,
  X,
  AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPortalTasks,
  completePortalTask,
} from "@/store/slices/portalSlice";
import type { ClientTaskWithStatus, TaskFormField } from "@shared/api";
import ClientPageHeader from "@/components/ClientPageHeader";
import PageMeta from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ── Sign document modal ───────────────────────────────────────────────────────

function SignDocumentModal({
  task,
  lang,
  open,
  saving,
  onClose,
  onSign,
}: {
  task: ClientTaskWithStatus;
  lang: "en" | "es";
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSign: (signatureName: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  const content = lang === "es" ? task.content_html_es : task.content_html_en;
  const title = lang === "es" ? task.title_es : task.title_en;

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setAgreed(false);
      setName("");
      setError("");
      setScrolledToBottom(false);
    }
  }, [open]);

  const handleScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    if (atBottom) setScrolledToBottom(true);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t("tasks.signNameRequired"));
      return;
    }
    if (!agreed) {
      setError(t("tasks.agreeRequired"));
      return;
    }
    setError("");
    await onSign(name.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>{t("tasks.signInstructions")}</DialogDescription>
        </DialogHeader>

        {/* Document body */}
        <div
          ref={contentRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto border rounded-lg bg-muted/20 p-5 text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: content || "" }}
        />

        {!scrolledToBottom && (
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
            <ChevronDown className="h-3.5 w-3.5 animate-bounce" />
            {t("tasks.scrollToRead")}
          </div>
        )}

        {/* Signature */}
        <div className="space-y-3 pt-2 border-t">
          <div className="space-y-1">
            <Label htmlFor="sig-name">
              {t("tasks.fullName")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sig-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              placeholder={t("tasks.fullNamePlaceholder")}
              className="max-w-sm"
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="agree"
              checked={agreed}
              onCheckedChange={(v) => {
                setAgreed(!!v);
                setError("");
              }}
              className="mt-0.5"
            />
            <Label
              htmlFor="agree"
              className="text-sm leading-snug cursor-pointer"
            >
              {t("tasks.agreeCheckbox")}
            </Label>
          </div>
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("tasks.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !scrolledToBottom}
            className="gap-2"
          >
            {saving ? (
              <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
            ) : (
              <PenLine className="h-4 w-4" />
            )}
            {t("tasks.signAndAccept")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Upload modal ──────────────────────────────────────────────────────────────

function UploadModal({
  task,
  lang,
  open,
  saving,
  onClose,
  onUpload,
}: {
  task: ClientTaskWithStatus;
  lang: "en" | "es";
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const config = task.upload_config_json;
  const accept = config?.accept || "image/*,application/pdf";
  const maxMb = config?.max_mb || 10;
  const title = lang === "es" ? task.title_es : task.title_en;
  const desc = lang === "es" ? task.description_es : task.description_en;

  useEffect(() => {
    if (open) setFile(null);
  }, [open]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleSubmit = async () => {
    if (!file) return;
    await onUpload(file);
  };

  const tooLarge = file && file.size > maxMb * 1024 * 1024;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          {desc && <DialogDescription>{desc}</DialogDescription>}
        </DialogHeader>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all",
            drag
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/30",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={handleFile}
          />
          {file ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2">
                <FileText className="h-8 w-8 text-primary" />
              </div>
              <p className="font-medium text-sm truncate max-w-xs mx-auto">
                {file.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
              {tooLarge && (
                <p className="text-xs text-destructive">
                  {t("tasks.fileTooLarge", { max: maxMb })}
                </p>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                }}
              >
                <X className="h-3 w-3" />
                {t("tasks.removeFile")}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <CloudUpload className="h-10 w-10 text-muted-foreground/40 mx-auto" />
              <p className="text-sm font-medium">{t("tasks.dropOrClick")}</p>
              <p className="text-xs text-muted-foreground">
                {t("tasks.maxSize", { max: maxMb })}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("tasks.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!file || !!tooLarge || saving}
            className="gap-2"
          >
            {saving ? (
              <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {t("tasks.uploadFile")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Form modal ────────────────────────────────────────────────────────────────

function FormModal({
  task,
  lang,
  open,
  saving,
  onClose,
  onSubmit,
}: {
  task: ClientTaskWithStatus;
  lang: "en" | "es";
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const fields: TaskFormField[] = task.form_fields_json || [];
  const title = lang === "es" ? task.title_es : task.title_en;
  const desc = lang === "es" ? task.description_es : task.description_en;

  const schema = Yup.object(
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        f.required
          ? f.type === "checkbox"
            ? Yup.boolean().oneOf(
                [true],
                lang === "es" ? "Requerido" : "Required",
              )
            : Yup.string().required(lang === "es" ? "Requerido" : "Required")
          : f.type === "checkbox"
            ? Yup.boolean()
            : Yup.string(),
      ]),
    ),
  );

  const formik = useFormik({
    initialValues: Object.fromEntries(
      fields.map((f) => [f.key, f.type === "checkbox" ? false : ""]),
    ),
    validationSchema: schema,
    enableReinitialize: true,
    onSubmit: async (vals) => {
      await onSubmit(vals as Record<string, unknown>);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          {desc && <DialogDescription>{desc}</DialogDescription>}
        </DialogHeader>

        <form onSubmit={formik.handleSubmit} className="space-y-4 pt-1">
          {fields.map((field) => {
            const label = lang === "es" ? field.label_es : field.label_en;
            const error =
              (formik.touched as any)[field.key] &&
              (formik.errors as any)[field.key];

            return (
              <div key={field.key} className="space-y-1.5">
                {field.type === "checkbox" ? (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={field.key}
                      checked={!!(formik.values as any)[field.key]}
                      onCheckedChange={(v) =>
                        formik.setFieldValue(field.key, !!v)
                      }
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor={field.key}
                      className="text-sm leading-snug cursor-pointer"
                    >
                      {label}
                      {field.required && (
                        <span className="text-destructive ml-1">*</span>
                      )}
                    </Label>
                  </div>
                ) : (
                  <>
                    <Label htmlFor={field.key}>
                      {label}
                      {field.required && (
                        <span className="text-destructive ml-1">*</span>
                      )}
                    </Label>
                    {field.type === "textarea" ? (
                      <Textarea
                        id={field.key}
                        value={(formik.values as any)[field.key] || ""}
                        onChange={formik.handleChange}
                        onBlur={formik.handleBlur}
                        name={field.key}
                        rows={3}
                        className="resize-none text-sm"
                      />
                    ) : field.type === "select" ? (
                      <Select
                        value={(formik.values as any)[field.key] || ""}
                        onValueChange={(v) =>
                          formik.setFieldValue(field.key, v)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              lang === "es" ? "Seleccionar…" : "Select…"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {(field.options || []).map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={field.key}
                        type={field.type === "date" ? "date" : "text"}
                        value={(formik.values as any)[field.key] || ""}
                        onChange={formik.handleChange}
                        onBlur={formik.handleBlur}
                        name={field.key}
                        className="text-sm"
                      />
                    )}
                  </>
                )}
                {error && (
                  <p className="text-xs text-destructive">{String(error)}</p>
                )}
              </div>
            );
          })}

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              {t("tasks.cancel")}
            </Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? (
                <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
              ) : null}
              {t("tasks.submitForm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Task card (client) ────────────────────────────────────────────────────────

function ClientTaskCard({
  task,
  lang,
  onAction,
}: {
  task: ClientTaskWithStatus;
  lang: "en" | "es";
  onAction: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isCompleted = (task as any).completion_status === "completed";
  const title = lang === "es" ? task.title_es : task.title_en;
  const desc = lang === "es" ? task.description_es : task.description_en;

  const TypeIcon =
    task.task_type === "upload"
      ? Upload
      : task.task_type === "sign_document"
        ? PenLine
        : FileText;

  const typeLabel =
    task.task_type === "upload"
      ? t("tasks.typeUpload")
      : task.task_type === "sign_document"
        ? t("tasks.typeSign")
        : t("tasks.typeForm");

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card overflow-hidden transition-all duration-300",
        isCompleted
          ? "border-accent/30 bg-accent/5"
          : "border-border hover:border-primary/30 hover:shadow-sm",
      )}
    >
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-4">
          {/* Status icon */}
          <div className="shrink-0 mt-0.5">
            {isCompleted ? (
              <CheckCircle2 className="h-6 w-6 text-accent" />
            ) : (
              <Circle className="h-6 w-6 text-muted-foreground/40" />
            )}
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <h3
                  className={cn(
                    "font-semibold text-base leading-tight",
                    isCompleted && "line-through text-muted-foreground",
                  )}
                >
                  {title}
                </h3>
                {isCompleted && (task as any).completed_at && (
                  <p className="text-xs text-accent mt-0.5 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("tasks.completedOn", {
                      date: formatDate((task as any).completed_at),
                    })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 gap-1 border-muted-foreground/30"
                >
                  <TypeIcon className="h-2.5 w-2.5" />
                  {typeLabel}
                </Badge>
                {!!task.is_required && !isCompleted && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 border-destructive/40 text-destructive"
                  >
                    {t("tasks.required")}
                  </Badge>
                )}
              </div>
            </div>

            {desc && (
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                {desc}
              </p>
            )}

            {/* Expand / collapse details for completed */}
            {isCompleted && (task as any).signature_name && (
              <button
                type="button"
                onClick={() => setExpanded((x) => !x)}
                className="text-xs text-muted-foreground flex items-center gap-1 mt-2 hover:text-foreground transition-colors"
              >
                {expanded ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {t("tasks.viewDetails")}
              </button>
            )}
            {expanded && (
              <div className="mt-2 p-2 rounded-lg bg-muted/30 text-xs text-muted-foreground space-y-1">
                {(task as any).signature_name && (
                  <p>
                    {t("tasks.signedBy")}:{" "}
                    <strong>{(task as any).signature_name}</strong>
                  </p>
                )}
                {(task as any).file_name && (
                  <p>
                    {t("tasks.file")}:{" "}
                    <strong>{(task as any).file_name}</strong>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Action button */}
          {!isCompleted && (
            <Button onClick={onAction} size="sm" className="shrink-0 gap-1.5">
              <TypeIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {task.task_type === "sign_document"
                  ? t("tasks.review")
                  : task.task_type === "upload"
                    ? t("tasks.upload")
                    : t("tasks.fill")}
              </span>
              <span className="sm:hidden">{t("tasks.start")}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ClientTasks() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { tasks, tasksLoading, tasksSaving } = useAppSelector((s) => s.portal);
  const { user } = useAppSelector((s) => s.clientAuth);
  const lang = (user?.preferred_language || "en") as "en" | "es";
  const { toast } = useToast();

  const [activeTask, setActiveTask] = useState<ClientTaskWithStatus | null>(
    null,
  );
  const [modalType, setModalType] = useState<"sign" | "upload" | "form" | null>(
    null,
  );

  useEffect(() => {
    dispatch(fetchPortalTasks());
  }, [dispatch]);

  const completed = tasks.filter(
    (t) => (t as any).completion_status === "completed",
  ).length;
  const total = tasks.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const openTask = (task: ClientTaskWithStatus) => {
    setActiveTask(task);
    setModalType(
      task.task_type === "sign_document"
        ? "sign"
        : task.task_type === "upload"
          ? "upload"
          : "form",
    );
  };

  const closeModal = () => {
    setActiveTask(null);
    setModalType(null);
  };

  const handleSign = async (signatureName: string) => {
    if (!activeTask) return;
    const res = await dispatch(
      completePortalTask({ taskId: activeTask.id, signatureName }),
    );
    if (res.meta.requestStatus === "fulfilled") {
      toast({ title: t("tasks.taskCompleted") });
      closeModal();
    } else {
      toast({
        title: t("tasks.errorTitle"),
        description: String((res as any).payload ?? ""),
        variant: "destructive",
      });
    }
  };

  const handleUpload = async (file: File) => {
    if (!activeTask) return;
    const res = await dispatch(
      completePortalTask({ taskId: activeTask.id, file }),
    );
    if (res.meta.requestStatus === "fulfilled") {
      toast({ title: t("tasks.taskCompleted") });
      closeModal();
    } else {
      toast({
        title: t("tasks.errorTitle"),
        description: String((res as any).payload ?? ""),
        variant: "destructive",
      });
    }
  };

  const handleFormSubmit = async (formData: Record<string, unknown>) => {
    if (!activeTask) return;
    const res = await dispatch(
      completePortalTask({ taskId: activeTask.id, formData }),
    );
    if (res.meta.requestStatus === "fulfilled") {
      toast({ title: t("tasks.taskCompleted") });
      closeModal();
    } else {
      toast({
        title: t("tasks.errorTitle"),
        description: String((res as any).payload ?? ""),
        variant: "destructive",
      });
    }
  };

  const pending = tasks.filter(
    (t) => (t as any).completion_status !== "completed",
  );
  const done = tasks.filter(
    (t) => (t as any).completion_status === "completed",
  );

  return (
    <>
      <PageMeta
        title={t("tasks.pageTitle")}
        description={t("tasks.subheading")}
      />
      <div className="space-y-8 max-w-2xl mx-auto">
        <ClientPageHeader
          title={t("tasks.heading")}
          description={t("tasks.subheading")}
        />

        {/* Progress */}
        {total > 0 && (
          <div className="bg-card border rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {t("tasks.progress", { completed, total })}
              </span>
              <span
                className={cn(
                  "font-bold tabular-nums",
                  progressPct === 100 ? "text-accent" : "text-primary",
                )}
              >
                {progressPct}%
              </span>
            </div>
            <Progress value={progressPct} className="h-2.5" />
            {progressPct === 100 && (
              <p className="text-sm text-accent flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {t("tasks.allDone")}
              </p>
            )}
          </div>
        )}

        {/* Loading */}
        {tasksLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 rounded-2xl border bg-card animate-pulse"
                style={{ opacity: 1 - i * 0.2 }}
              />
            ))}
          </div>
        )}

        {/* Empty */}
        {!tasksLoading && total === 0 && (
          <div className="text-center py-16 space-y-3">
            <Lock className="h-12 w-12 text-muted-foreground/30 mx-auto" />
            <p className="text-muted-foreground text-sm">{t("tasks.empty")}</p>
          </div>
        )}

        {/* Pending tasks */}
        {!tasksLoading && pending.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t("tasks.pending")} ({pending.length})
            </h2>
            {pending.map((task) => (
              <ClientTaskCard
                key={task.id}
                task={task}
                lang={lang}
                onAction={() => openTask(task)}
              />
            ))}
          </div>
        )}

        {/* Completed tasks */}
        {!tasksLoading && done.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {t("tasks.completed")} ({done.length})
            </h2>
            {done.map((task) => (
              <ClientTaskCard
                key={task.id}
                task={task}
                lang={lang}
                onAction={() => openTask(task)}
              />
            ))}
          </div>
        )}

        {/* Modals */}
        {activeTask && modalType === "sign" && (
          <SignDocumentModal
            task={activeTask}
            lang={lang}
            open={modalType === "sign"}
            saving={tasksSaving}
            onClose={closeModal}
            onSign={handleSign}
          />
        )}
        {activeTask && modalType === "upload" && (
          <UploadModal
            task={activeTask}
            lang={lang}
            open={modalType === "upload"}
            saving={tasksSaving}
            onClose={closeModal}
            onUpload={handleUpload}
          />
        )}
        {activeTask && modalType === "form" && (
          <FormModal
            task={activeTask}
            lang={lang}
            open={modalType === "form"}
            saving={tasksSaving}
            onClose={closeModal}
            onSubmit={handleFormSubmit}
          />
        )}
      </div>
    </>
  );
}

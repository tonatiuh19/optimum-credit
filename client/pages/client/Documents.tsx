import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CreditCard,
  Eye,
  FileText,
  Home,
  IdCard,
  Loader2,
  PartyPopper,
  PenLine,
  ShieldCheck,
  Lock,
  Upload,
  X,
  ChevronDown,
  CloudUpload,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import ClientPageHeader from "@/components/ClientPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPortalTasks,
  completePortalTask,
} from "@/store/slices/portalSlice";
import { useToast } from "@/hooks/use-toast";
import api from "@/lib/api";
import type { ClientTaskWithStatus } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─── Icon map by slug ─────────────────────────────────────────────────────────
const SLUG_ICONS: Record<string, LucideIcon> = {
  id_front: IdCard,
  id_back: CreditCard,
  ssn_card: FileText,
  proof_of_address: Home,
  service_agreement: PenLine,
};

// ─── Sign Document Modal ───────────────────────────────────────────────────────
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
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20)
      setScrolledToBottom(true);
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
        <div className="space-y-3 pt-2 border-t">
          <div className="space-y-1">
            <Label htmlFor="sig-name-doc">
              {t("tasks.fullName")} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="sig-name-doc"
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
              id="agree-doc"
              checked={agreed}
              onCheckedChange={(v) => {
                setAgreed(!!v);
                setError("");
              }}
              className="mt-0.5"
            />
            <Label
              htmlFor="agree-doc"
              className="text-sm leading-snug cursor-pointer"
            >
              {t("tasks.agreeCheckbox")}
            </Label>
          </div>
          {error && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {error}
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

// ─── Upload Task Card ─────────────────────────────────────────────────────────
function UploadTaskCard({
  task,
  lang,
}: {
  task: ClientTaskWithStatus;
  lang: "en" | "es";
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<{
    name: string;
    size: string;
    dataUrl: string | null;
    isPdf: boolean;
    file: File;
  } | null>(null);

  const adminStatus = task.completion?.admin_review_status as
    | "approved"
    | "pending"
    | "rejected"
    | undefined;
  const hasFile = !!task.completion?.file_name;
  // File presence takes priority: no file → always "missing" (show upload zone)
  // regardless of admin_review_status default value set by auto-assign
  const status: "approved" | "pending" | "rejected" | "missing" = !hasFile
    ? "missing"
    : (adminStatus ?? "pending");

  const label = lang === "es" ? task.title_es : task.title_en;
  const desc = lang === "es" ? task.description_es : task.description_en;
  const accept = task.upload_config_json?.accept ?? "image/*,application/pdf";
  const maxMb = task.upload_config_json?.max_mb ?? 10;

  const Icon = SLUG_ICONS[task.slug] ?? FileText;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    const size =
      file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    if (isPdf) {
      setPreview({ name: file.name, size, dataUrl: null, isPdf: true, file });
    } else {
      const reader = new FileReader();
      reader.onload = (ev) =>
        setPreview({
          name: file.name,
          size,
          dataUrl: ev.target?.result as string,
          isPdf: false,
          file,
        });
      reader.readAsDataURL(file);
    }
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    const size =
      file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    if (isPdf) {
      setPreview({ name: file.name, size, dataUrl: null, isPdf: true, file });
    } else {
      const reader = new FileReader();
      reader.onload = (ev) =>
        setPreview({
          name: file.name,
          size,
          dataUrl: ev.target?.result as string,
          isPdf: false,
          file,
        });
      reader.readAsDataURL(file);
    }
  };

  const handleViewFile = async () => {
    setViewLoading(true);
    try {
      const resp = await api.get(`/portal/tasks/${task.id}/file`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(resp.data as Blob);
      const win = window.open(url, "_blank");
      if (win)
        win.addEventListener("load", () => URL.revokeObjectURL(url), {
          once: true,
        });
    } catch {
      toast({ title: t("documents.viewFailed"), variant: "destructive" });
    } finally {
      setViewLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    if (preview.file.size > maxMb * 1024 * 1024) {
      toast({
        title: t("tasks.fileTooLarge", { maxMb }),
        variant: "destructive",
      });
      return;
    }
    setUploading(true);
    try {
      await dispatch(
        completePortalTask({ taskId: task.id, file: preview.file }),
      ).unwrap();
      toast({ title: t("documents.uploadedTitle"), description: preview.name });
      setPreview(null);
    } catch {
      toast({ title: t("documents.uploadFailed"), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const borderClass = {
    approved: "border-accent/30",
    pending: "border-amber-500/20",
    rejected: "border-destructive/30",
    missing: "border-border",
  }[status];

  const statusBadge = {
    approved: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded-full">
        <CheckCircle2 className="w-3 h-3" /> {t("documents.approved")}
      </span>
    ),
    pending: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
        <Clock className="w-3 h-3" /> {t("documents.underReview")}
      </span>
    ),
    rejected: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/20 px-2 py-0.5 rounded-full">
        <AlertCircle className="w-3 h-3" /> {t("documents.actionNeeded")}
      </span>
    ),
    missing: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded-full">
        {t("documents.notUploaded")}
      </span>
    ),
  }[status];

  return (
    <div
      className={`bg-card rounded-2xl border ${borderClass} p-5 shadow-sm transition-all duration-200`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-sm leading-tight">{label}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </div>
        </div>
        <div className="shrink-0 ml-2">{statusBadge}</div>
      </div>

      {status === "rejected" && task.completion?.admin_notes && (
        <div className="text-xs text-destructive bg-destructive/5 border border-destructive/10 px-3 py-2.5 rounded-xl mb-3 leading-relaxed">
          <span className="font-semibold block mb-0.5">
            {t("documents.rejectionReason")}
          </span>
          {task.completion.admin_notes}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Drag-drop preview */}
      {preview && (
        <div className="mb-3 rounded-xl border border-border overflow-hidden bg-muted/30 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {preview.isPdf ? (
            <div className="flex items-center gap-3 px-4 py-5">
              <div className="w-12 h-14 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center justify-center shrink-0">
                <FileText className="w-6 h-6 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{preview.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {preview.size} · PDF
                </p>
              </div>
            </div>
          ) : (
            <div className="relative">
              <img
                src={preview.dataUrl!}
                alt="Preview"
                className="w-full max-h-52 object-contain bg-black/5 py-2"
              />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/50 to-transparent px-3 py-2">
                <p className="text-white text-xs font-medium truncate">
                  {preview.name}
                </p>
                <p className="text-white/70 text-[10px]">{preview.size}</p>
              </div>
            </div>
          )}
          <div className="flex gap-2 p-3 border-t border-border">
            <button
              onClick={() => setPreview(null)}
              disabled={uploading}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-60"
            >
              <X className="w-3.5 h-3.5" /> {t("tasks.cancel")}
            </button>
            <button
              onClick={handleConfirm}
              disabled={uploading}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {uploading ? t("documents.uploading") : t("documents.save")}
            </button>
          </div>
        </div>
      )}

      {/* Drop zone for missing / rejected */}
      {(status === "missing" || status === "rejected") && !preview && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all",
            drag
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40 hover:bg-muted/30",
          )}
        >
          <CloudUpload className="w-7 h-7 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs font-medium text-muted-foreground">
            {t("documents.dragDropOr")}{" "}
            <span className="text-primary">{t("documents.browse")}</span>
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            {t("documents.maxSize", { maxMb })}
          </p>
        </div>
      )}

      {/* Pending — already submitted, show file name + view */}
      {status === "pending" && !preview && (
        <div className="flex items-center justify-between gap-2 mt-2 px-3 py-2.5 rounded-xl bg-muted/40 border border-border">
          <div className="flex items-center gap-2 text-xs text-foreground/70 truncate min-w-0">
            <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">
              {task.completion?.file_name ?? ""}
            </span>
          </div>
          <button
            onClick={handleViewFile}
            disabled={viewLoading}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
          >
            {viewLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
            {t("documents.view")}
          </button>
        </div>
      )}

      {/* Approved */}
      {status === "approved" && !preview && (
        <div className="flex items-center justify-between gap-2 mt-2 px-3 py-2.5 rounded-xl bg-accent/5 border border-accent/20">
          <div className="flex items-center gap-2 text-xs text-foreground/70 truncate min-w-0">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-accent" />
            <span className="truncate font-medium">
              {task.completion?.file_name ?? ""}
            </span>
          </div>
          <button
            onClick={handleViewFile}
            disabled={viewLoading}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
          >
            {viewLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
            {t("documents.view")}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sign Task Card ────────────────────────────────────────────────────────────
function SignTaskCard({
  task,
  lang,
}: {
  task: ClientTaskWithStatus;
  lang: "en" | "es";
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { tasksSaving } = useAppSelector((s) => s.portal);

  const adminStatus = task.completion?.admin_review_status as
    | "approved"
    | "pending"
    | "rejected"
    | undefined;
  const isSigned = task.completion?.status === "completed";
  const status: "approved" | "pending" | "rejected" | "unsigned" = isSigned
    ? (adminStatus ?? "pending")
    : "unsigned";

  const label = lang === "es" ? task.title_es : task.title_en;
  const desc = lang === "es" ? task.description_es : task.description_en;

  const borderClass = {
    approved: "border-accent/30",
    pending: "border-amber-500/20",
    rejected: "border-destructive/30",
    unsigned: "border-border",
  }[status];

  const statusBadge = {
    approved: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded-full">
        <CheckCircle2 className="w-3 h-3" /> {t("tasks.signed")}
      </span>
    ),
    pending: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
        <Clock className="w-3 h-3" /> {t("documents.underReview")}
      </span>
    ),
    rejected: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-destructive/10 text-destructive border border-destructive/20 px-2 py-0.5 rounded-full">
        <AlertCircle className="w-3 h-3" /> {t("documents.actionNeeded")}
      </span>
    ),
    unsigned: (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded-full">
        {t("tasks.notSigned")}
      </span>
    ),
  }[status];

  const handleSign = async (signatureName: string) => {
    try {
      await dispatch(
        completePortalTask({ taskId: task.id, signatureName }),
      ).unwrap();
      setOpen(false);
      toast({ title: t("tasks.signedSuccess") });
    } catch {
      toast({ title: t("tasks.signError"), variant: "destructive" });
    }
  };

  return (
    <>
      <div
        className={`bg-card rounded-2xl border ${borderClass} p-5 shadow-sm transition-all duration-200`}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <PenLine className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm leading-tight">{label}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </div>
          </div>
          <div className="shrink-0 ml-2">{statusBadge}</div>
        </div>

        {isSigned && task.completion?.signature_name && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
            <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" />
            <span>
              {t("tasks.signedBy")}{" "}
              <strong>{task.completion.signature_name}</strong>
              {task.completion.completed_at &&
                ` · ${new Date(task.completion.completed_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`}
            </span>
          </div>
        )}

        {!isSigned && (
          <Button
            onClick={() => setOpen(true)}
            size="sm"
            className="w-full gap-2 mt-1"
          >
            <PenLine className="w-4 h-4" />
            {t("tasks.reviewAndSign")}
          </Button>
        )}
      </div>

      <SignDocumentModal
        task={task}
        lang={lang}
        open={open}
        saving={tasksSaving}
        onClose={() => setOpen(false)}
        onSign={handleSign}
      />
    </>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Documents() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { tasks, tasksLoading } = useAppSelector((s) => s.portal);
  const { dashboard } = useAppSelector((s) => s.portal);
  const lang = (dashboard?.preferred_language ?? "en") as "en" | "es";

  useEffect(() => {
    dispatch(fetchPortalTasks());
  }, [dispatch]);

  const requiredTasks = tasks.filter((t) => Number(t.is_required) === 1);
  const approvedCount = requiredTasks.filter(
    (t) => t.completion?.admin_review_status === "approved",
  ).length;
  const allApproved =
    requiredTasks.length > 0 && approvedCount === requiredTasks.length;

  if (tasksLoading && tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ClientPageHeader
        title={t("documents.title")}
        description={t("documents.description")}
      />

      {/* All approved banner */}
      {allApproved && (
        <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
            <PartyPopper className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className="font-semibold text-accent">
              {t("documents.allApproved")}
            </p>
            <p className="text-sm text-accent/80 mt-0.5">
              {t("documents.allApprovedNote")}
            </p>
          </div>
        </div>
      )}

      {/* Progress */}
      {!allApproved && requiredTasks.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {t("documents.uploadProgress")}
            </span>
            <span className="text-sm text-muted-foreground">
              {t("documents.docsApprovedCount", { count: approvedCount })}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{
                width: `${(approvedCount / requiredTasks.length) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Task cards */}
      <div className="grid sm:grid-cols-2 gap-4">
        {tasks.map((task) => {
          if (task.task_type === "upload") {
            return <UploadTaskCard key={task.id} task={task} lang={lang} />;
          }
          if (task.task_type === "sign_document") {
            return <SignTaskCard key={task.id} task={task} lang={lang} />;
          }
          return null;
        })}
      </div>

      {tasks.length === 0 && !tasksLoading && (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-muted-foreground text-sm">{t("tasks.noTasks")}</p>
        </div>
      )}

      {/* Security note */}
      <div className="rounded-xl border border-primary/10 bg-primary/5 p-4 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Lock className="w-4 h-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-primary" />
            {t("documents.encryptedHeading")}
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {t("documents.encryptedBody")}
          </p>
        </div>
      </div>
    </div>
  );
}

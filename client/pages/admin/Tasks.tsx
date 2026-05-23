import { useEffect, useState } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  ClipboardList,
  Plus,
  Pencil,
  Trash2,
  FileText,
  Upload,
  PenLine,
  Search,
  Shield,
  GripVertical,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  X,
  Check,
  AlertTriangle,
  Zap,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAdminTaskTemplates,
  createTaskTemplate,
  updateTaskTemplate,
  deleteTaskTemplate,
} from "@/store/slices/adminTasksSlice";
import type {
  OnboardingTaskTemplate,
  OnboardingTaskType,
  TaskFormField,
} from "@shared/api";
import AdminPageHeader from "@/components/AdminPageHeader";
import PageMeta from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// ── Type helpers ──────────────────────────────────────────────────────────────

const TASK_TYPE_META: Record<
  OnboardingTaskType,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    description: string;
  }
> = {
  form: {
    label: "Form",
    icon: FileText,
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400",
    description: "Client fills in custom fields",
  },
  upload: {
    label: "Upload",
    icon: Upload,
    color:
      "bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400",
    description: "Client attaches a file or document",
  },
  sign_document: {
    label: "Sign",
    icon: PenLine,
    color: "bg-accent/10 text-accent border-accent/20",
    description: "Client reads and e-signs a document",
  },
};

const FIELD_TYPES = ["text", "textarea", "date", "checkbox", "select"] as const;

// ── Form field builder ────────────────────────────────────────────────────────

function FormFieldRow({
  field,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  field: TaskFormField;
  index: number;
  total: number;
  onChange: (f: TaskFormField) => void;
  onRemove: () => void;
  onMove: (dir: "up" | "down") => void;
}) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg border border-border bg-muted/30">
      <div className="flex flex-col gap-1 mt-1">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMove("up")}
          className="text-muted-foreground hover:text-foreground disabled:opacity-25"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={index === total - 1}
          onClick={() => onMove("down")}
          className="text-muted-foreground hover:text-foreground disabled:opacity-25"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
        <Input
          placeholder="Label (EN)"
          value={field.label_en}
          onChange={(e) => onChange({ ...field, label_en: e.target.value })}
          className="text-sm"
        />
        <Input
          placeholder="Etiqueta (ES)"
          value={field.label_es}
          onChange={(e) => onChange({ ...field, label_es: e.target.value })}
          className="text-sm"
        />
        <Input
          placeholder="Field key (no spaces)"
          value={field.key}
          onChange={(e) =>
            onChange({
              ...field,
              key: e.target.value.toLowerCase().replace(/\s+/g, "_"),
            })
          }
          className="text-sm font-mono"
        />
        <Select
          value={field.type}
          onValueChange={(v) =>
            onChange({ ...field, type: v as TaskFormField["type"] })
          }
        >
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.type === "select" && (
          <div className="col-span-2">
            <Input
              placeholder="Options (comma-separated)"
              value={(field.options || []).join(", ")}
              onChange={(e) =>
                onChange({
                  ...field,
                  options: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="text-sm"
            />
          </div>
        )}
        <div className="col-span-2 flex items-center gap-2">
          <Switch
            id={`req-${index}`}
            checked={field.required}
            onCheckedChange={(v) => onChange({ ...field, required: v })}
            className="scale-75"
          />
          <Label
            htmlFor={`req-${index}`}
            className="text-xs text-muted-foreground"
          >
            Required
          </Label>
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive mt-1 shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Task dialog (create / edit) ───────────────────────────────────────────────

function TaskDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: OnboardingTaskTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dispatch = useAppDispatch();
  const { saving } = useAppSelector((s) => s.adminTasks);
  const { toast } = useToast();

  const [formFields, setFormFields] = useState<TaskFormField[]>([]);
  const [contentTab, setContentTab] = useState<"en" | "es">("en");

  const isNew = !editing;

  const schema = Yup.object({
    slug: Yup.string()
      .required("Required")
      .matches(/^[a-z0-9_]+$/, "Lowercase letters, numbers, underscore only")
      .min(2),
    task_type: Yup.string()
      .oneOf(["form", "upload", "sign_document"])
      .required(),
    title_en: Yup.string().required("Required"),
    title_es: Yup.string().required("Required"),
    description_en: Yup.string(),
    description_es: Yup.string(),
    content_html_en: Yup.string(),
    content_html_es: Yup.string(),
    upload_accept: Yup.string(),
    upload_max_mb: Yup.number().min(1).max(100),
    is_required: Yup.boolean(),
    sort_order: Yup.number().min(0),
    is_active: Yup.boolean(),
    auto_assign: Yup.boolean(),
  });

  const formik = useFormik({
    initialValues: {
      slug: editing?.slug ?? "",
      task_type: (editing?.task_type ?? "form") as OnboardingTaskType,
      title_en: editing?.title_en ?? "",
      title_es: editing?.title_es ?? "",
      description_en: editing?.description_en ?? "",
      description_es: editing?.description_es ?? "",
      content_html_en: editing?.content_html_en ?? "",
      content_html_es: editing?.content_html_es ?? "",
      upload_accept:
        (editing?.upload_config_json as any)?.accept ??
        "image/*,application/pdf",
      upload_max_mb: (editing?.upload_config_json as any)?.max_mb ?? 10,
      is_required: !!(editing?.is_required ?? 1),
      sort_order: editing?.sort_order ?? 0,
      is_active: !!(editing?.is_active ?? 1),
      auto_assign: !!(editing?.auto_assign ?? 1),
    },
    validationSchema: schema,
    enableReinitialize: true,
    onSubmit: async (vals) => {
      const payload: any = {
        slug: vals.slug,
        task_type: vals.task_type,
        title_en: vals.title_en,
        title_es: vals.title_es,
        description_en: vals.description_en || undefined,
        description_es: vals.description_es || undefined,
        is_required: vals.is_required,
        sort_order: vals.sort_order,
        is_active: vals.is_active,
        auto_assign: vals.auto_assign,
      };
      if (vals.task_type === "sign_document") {
        payload.content_html_en = vals.content_html_en;
        payload.content_html_es = vals.content_html_es;
      }
      if (vals.task_type === "form") {
        payload.form_fields_json = formFields;
      }
      if (vals.task_type === "upload") {
        payload.upload_config_json = {
          accept: vals.upload_accept,
          max_mb: Number(vals.upload_max_mb),
        };
      }

      let result: any;
      if (isNew) {
        result = await dispatch(createTaskTemplate(payload));
      } else {
        result = await dispatch(
          updateTaskTemplate({ id: editing!.id, payload }),
        );
      }

      if (result.meta.requestStatus === "fulfilled") {
        toast({ title: isNew ? "Task created" : "Task updated" });
        onSaved();
      } else {
        toast({
          title: "Error",
          description: String(result.payload ?? "Unknown error"),
          variant: "destructive",
        });
      }
    },
  });

  // Sync formFields when editing changes
  useEffect(() => {
    if (editing?.form_fields_json) {
      setFormFields(editing.form_fields_json as TaskFormField[]);
    } else {
      setFormFields([]);
    }
  }, [editing]);

  const addField = () => {
    setFormFields((prev) => [
      ...prev,
      {
        key: `field_${prev.length + 1}`,
        label_en: "",
        label_es: "",
        type: "text",
        required: false,
      },
    ]);
  };

  const updateField = (i: number, f: TaskFormField) =>
    setFormFields((prev) => prev.map((x, idx) => (idx === i ? f : x)));

  const removeField = (i: number) =>
    setFormFields((prev) => prev.filter((_, idx) => idx !== i));

  const moveField = (i: number, dir: "up" | "down") => {
    setFormFields((prev) => {
      const arr = [...prev];
      const j = dir === "up" ? i - 1 : i + 1;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  };

  const taskType = formik.values.task_type;
  const isSystem = !!editing?.is_system;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            {isNew ? "New Task Template" : `Edit: ${editing?.title_en}`}
          </DialogTitle>
          {isSystem && (
            <DialogDescription className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <Shield className="h-3.5 w-3.5" />
              System task — slug and type cannot be changed
            </DialogDescription>
          )}
        </DialogHeader>

        <form onSubmit={formik.handleSubmit} className="space-y-5 pt-2">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>
                Slug <span className="text-destructive">*</span>
              </Label>
              <Input
                {...formik.getFieldProps("slug")}
                placeholder="e.g. id_verification"
                disabled={isSystem}
                className="font-mono text-sm"
              />
              {formik.touched.slug && formik.errors.slug && (
                <p className="text-xs text-destructive">{formik.errors.slug}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>
                Type <span className="text-destructive">*</span>
              </Label>
              <Select
                value={taskType}
                onValueChange={(v) => formik.setFieldValue("task_type", v)}
                disabled={isSystem}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TASK_TYPE_META) as OnboardingTaskType[]).map(
                    (t) => {
                      const meta = TASK_TYPE_META[t];
                      const Icon = meta.icon;
                      return (
                        <SelectItem key={t} value={t}>
                          <div className="flex items-center gap-2">
                            <Icon className="h-3.5 w-3.5" />
                            {meta.label}
                            <span className="text-xs text-muted-foreground">
                              — {meta.description}
                            </span>
                          </div>
                        </SelectItem>
                      );
                    },
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Titles */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>
                Title (EN) <span className="text-destructive">*</span>
              </Label>
              <Input
                {...formik.getFieldProps("title_en")}
                placeholder="Task title in English"
              />
              {formik.touched.title_en && formik.errors.title_en && (
                <p className="text-xs text-destructive">
                  {formik.errors.title_en}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label>
                Título (ES) <span className="text-destructive">*</span>
              </Label>
              <Input
                {...formik.getFieldProps("title_es")}
                placeholder="Título en español"
              />
              {formik.touched.title_es && formik.errors.title_es && (
                <p className="text-xs text-destructive">
                  {formik.errors.title_es}
                </p>
              )}
            </div>
          </div>

          {/* Descriptions */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-muted-foreground">Description (EN)</Label>
              <Textarea
                {...formik.getFieldProps("description_en")}
                placeholder="Short description shown to the client (optional)"
                rows={2}
                className="resize-none text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground">Descripción (ES)</Label>
              <Textarea
                {...formik.getFieldProps("description_es")}
                placeholder="Descripción corta opcional"
                rows={2}
                className="resize-none text-sm"
              />
            </div>
          </div>

          {/* Type-specific config */}
          {taskType === "sign_document" && (
            <div className="space-y-2">
              <Label>Document Content</Label>
              <Tabs
                value={contentTab}
                onValueChange={(v) => setContentTab(v as "en" | "es")}
              >
                <TabsList className="h-8">
                  <TabsTrigger value="en" className="text-xs px-3">
                    English
                  </TabsTrigger>
                  <TabsTrigger value="es" className="text-xs px-3">
                    Español
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="en" className="mt-2">
                  <Textarea
                    {...formik.getFieldProps("content_html_en")}
                    placeholder="<h2>Agreement</h2><p>...</p>"
                    rows={10}
                    className="font-mono text-xs resize-y"
                  />
                </TabsContent>
                <TabsContent value="es" className="mt-2">
                  <Textarea
                    {...formik.getFieldProps("content_html_es")}
                    placeholder="<h2>Acuerdo</h2><p>...</p>"
                    rows={10}
                    className="font-mono text-xs resize-y"
                  />
                </TabsContent>
              </Tabs>
            </div>
          )}

          {taskType === "form" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Form Fields</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addField}
                  className="gap-1.5 h-7 text-xs"
                >
                  <Plus className="h-3 w-3" /> Add Field
                </Button>
              </div>
              {formFields.length === 0 ? (
                <div className="border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
                  No fields yet — add your first field above
                </div>
              ) : (
                <div className="space-y-2">
                  {formFields.map((f, i) => (
                    <FormFieldRow
                      key={i}
                      field={f}
                      index={i}
                      total={formFields.length}
                      onChange={(upd) => updateField(i, upd)}
                      onRemove={() => removeField(i)}
                      onMove={(dir) => moveField(i, dir)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {taskType === "upload" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Accepted File Types</Label>
                <Input
                  {...formik.getFieldProps("upload_accept")}
                  placeholder="image/*,application/pdf"
                  className="text-sm font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  MIME types or wildcards, comma-separated
                </p>
              </div>
              <div className="space-y-1">
                <Label>Max File Size (MB)</Label>
                <Input
                  type="number"
                  {...formik.getFieldProps("upload_max_mb")}
                  min={1}
                  max={100}
                  className="text-sm"
                />
              </div>
            </div>
          )}

          {/* Settings row */}
          <div className="flex items-center gap-6 pt-1">
            <div className="flex items-center gap-2">
              <Switch
                id="is_required"
                checked={formik.values.is_required}
                onCheckedChange={(v) => formik.setFieldValue("is_required", v)}
              />
              <Label htmlFor="is_required" className="text-sm cursor-pointer">
                Required
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="is_active"
                checked={formik.values.is_active}
                onCheckedChange={(v) => formik.setFieldValue("is_active", v)}
              />
              <Label htmlFor="is_active" className="text-sm cursor-pointer">
                Active
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="auto_assign"
                checked={formik.values.auto_assign}
                onCheckedChange={(v) => formik.setFieldValue("auto_assign", v)}
              />
              <Label
                htmlFor="auto_assign"
                className="text-sm cursor-pointer flex items-center gap-1"
              >
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                Auto-assign
              </Label>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Label className="text-sm text-muted-foreground">
                Sort order
              </Label>
              <Input
                type="number"
                {...formik.getFieldProps("sort_order")}
                className="w-20 text-sm text-center"
                min={0}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? (
                <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />
              ) : isNew ? (
                <Plus className="h-4 w-4" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {isNew ? "Create Task" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  task: OnboardingTaskTemplate;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  const meta = TASK_TYPE_META[task.task_type];
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        "group flex items-start gap-4 p-4 rounded-xl border bg-card transition-all duration-200",
        "hover:shadow-md hover:border-primary/20",
        !task.is_active && "opacity-60",
      )}
    >
      {/* Drag handle */}
      <div className="mt-1 text-muted-foreground/40 cursor-grab">
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Type icon */}
      <div
        className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border",
          meta.color,
        )}
      >
        <Icon className="h-5 w-5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <span className="font-semibold text-sm leading-tight">
            {task.title_en}
          </span>
          {task.title_es !== task.title_en && (
            <span className="text-xs text-muted-foreground">
              / {task.title_es}
            </span>
          )}
          {!!task.is_system && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400 gap-1"
            >
              <Shield className="h-2.5 w-2.5" /> System
            </Badge>
          )}
          {!!task.is_required && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-destructive/40 text-destructive gap-1"
            >
              Required
            </Badge>
          )}
          {!!task.auto_assign && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-amber-400/40 text-amber-600 dark:text-amber-400 gap-1"
              title="Auto-assigned on payment"
            >
              <Zap className="h-2.5 w-2.5" /> Auto
            </Badge>
          )}
        </div>
        {task.description_en && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {task.description_en}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <Badge
            className={cn("text-[11px] px-2 py-0 border gap-1", meta.color)}
          >
            <Icon className="h-2.5 w-2.5" />
            {meta.label}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            Sort: {task.sort_order}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onToggleActive}
          title={task.is_active ? "Deactivate" : "Activate"}
        >
          {task.is_active ? (
            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Eye className="h-3.5 w-3.5 text-primary" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onEdit}
          title="Edit task"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {!task.is_system && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onDelete}
            title="Delete task"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminTasks() {
  const dispatch = useAppDispatch();
  const { templates, loading } = useAppSelector((s) => s.adminTasks);
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | OnboardingTaskType>(
    "all",
  );
  const [filterActive, setFilterActive] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OnboardingTaskTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<OnboardingTaskTemplate | null>(null);

  const debouncedSearch = useDebounce(search, 350);

  useEffect(() => {
    dispatch(
      fetchAdminTaskTemplates({
        search: debouncedSearch || undefined,
        type: filterType !== "all" ? filterType : undefined,
        active: filterActive !== "all" ? filterActive : undefined,
      }),
    );
  }, [dispatch, debouncedSearch, filterType, filterActive]);

  const hasFilters =
    search.trim() !== "" || filterType !== "all" || filterActive !== "all";

  const handleToggleActive = async (task: OnboardingTaskTemplate) => {
    const res = await dispatch(
      updateTaskTemplate({
        id: task.id,
        payload: { is_active: !task.is_active },
      }),
    );
    if (res.meta.requestStatus === "fulfilled") {
      toast({ title: task.is_active ? "Task deactivated" : "Task activated" });
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const res = await dispatch(deleteTaskTemplate(deleteTarget.id));
    if (res.meta.requestStatus === "fulfilled") {
      toast({ title: "Task deleted" });
      setDeleteTarget(null);
    } else {
      toast({
        title: "Cannot delete",
        description: String((res as any).payload ?? "Unknown error"),
        variant: "destructive",
      });
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <PageMeta
        title="Task Templates — Admin"
        description="Manage onboarding task templates for clients."
      />
      <div className="space-y-6">
        <AdminPageHeader
          title="Task Templates"
          description="Manage the onboarding checklist clients must complete after payment."
          icon={ClipboardList}
          actions={
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              New Task
            </Button>
          }
        />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={filterType}
            onValueChange={(v) => setFilterType(v as typeof filterType)}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="form">Form</SelectItem>
              <SelectItem value="upload">Upload</SelectItem>
              <SelectItem value="sign_document">Sign</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filterActive}
            onValueChange={(v) => setFilterActive(v as typeof filterActive)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Task list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 rounded-xl border bg-card animate-pulse"
                style={{ opacity: 1 - i * 0.2 }}
              />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
              <ClipboardList className="h-12 w-12 text-muted-foreground/40" />
              <div className="text-center">
                <p className="font-semibold">
                  {hasFilters ? "No tasks match your filters" : "No tasks yet"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {hasFilters
                    ? "Try adjusting your search or filters"
                    : "Create your first onboarding task template"}
                </p>
              </div>
              {!hasFilters && (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                  className="gap-2 mt-2"
                >
                  <Plus className="h-4 w-4" />
                  Create First Task
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {templates.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onEdit={() => {
                  setEditing(task);
                  setDialogOpen(true);
                }}
                onDelete={() => setDeleteTarget(task)}
                onToggleActive={() => handleToggleActive(task)}
              />
            ))}
          </div>
        )}

        {/* Dialog */}
        <TaskDialog
          open={dialogOpen}
          editing={editing}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
        />

        {/* Delete confirm */}
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Delete Task Template
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete{" "}
                <strong>"{deleteTarget?.title_en}"</strong>? This cannot be
                undone. Tasks with existing client completions cannot be deleted
                — deactivate them instead.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDeleteConfirm}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}

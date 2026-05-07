import { useEffect, useState, useCallback } from "react";
import {
  Mailbox,
  Save,
  Zap,
  Mail,
  MessageSquare,
  Bell,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Info,
  Plus,
  Trash2,
  AlertTriangle,
  ShieldAlert,
  Code2,
  Eye,
  LayoutPanelLeft,
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { html } from "@codemirror/lang-html";
import { oneDark } from "@codemirror/theme-one-dark";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchTemplates,
  updateTemplate,
  createTemplate,
  deleteTemplate,
} from "@/store/slices/adminSlice";
import type { CommunicationTemplate } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL_META: Record<
  string,
  { icon: React.ReactNode; color: string; label: string }
> = {
  email: {
    icon: <Mail className="h-3.5 w-3.5" />,
    color: "text-violet-600 bg-violet-50 border-violet-200",
    label: "Email",
  },
  sms: {
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    color: "text-sky-600 bg-sky-50 border-sky-200",
    label: "SMS",
  },
  in_app: {
    icon: <Bell className="h-3.5 w-3.5" />,
    color: "text-amber-600 bg-amber-50 border-amber-200",
    label: "In-App",
  },
};

function VariableTag({ v }: { v: string }) {
  return (
    <code className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-[11px] font-mono border border-primary/20">
      {`{{${v}}}`}
    </code>
  );
}

const isFlowTemplate = (t: CommunicationTemplate) => t.slug.startsWith("flow_");

// ─────────────────────────────────────────────────────────────────────────────
// HTML Editor + Live Preview
// ─────────────────────────────────────────────────────────────────────────────

type EditorView = "split" | "code" | "preview";

function HtmlEditorPreview({
  value,
  onChange,
  minHeight = 300,
}: {
  value: string;
  onChange: (v: string) => void;
  minHeight?: number;
}) {
  const [view, setView] = useState<EditorView>("split");
  const onUpdate = useCallback((v: string) => onChange(v), [onChange]);

  const viewBtn = (v: EditorView, icon: React.ReactNode, label: string) => (
    <button
      key={v}
      onClick={() => setView(v)}
      title={label}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors",
        view === v
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30">
        <span className="text-[10px] font-semibold text-muted-foreground tracking-wide uppercase">
          HTML Editor
        </span>
        <div className="flex items-center gap-0.5">
          {viewBtn("code", <Code2 className="h-3 w-3" />, "Code")}
          {viewBtn("split", <LayoutPanelLeft className="h-3 w-3" />, "Split")}
          {viewBtn("preview", <Eye className="h-3 w-3" />, "Preview")}
        </div>
      </div>

      {/* Panes */}
      <div className={cn("flex", view === "split" ? "divide-x" : "")}>
        {(view === "code" || view === "split") && (
          <div className={view === "split" ? "w-1/2" : "w-full"}>
            <CodeMirror
              value={value}
              height={`${minHeight}px`}
              extensions={[html()]}
              theme={oneDark}
              onChange={onUpdate}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
              }}
            />
          </div>
        )}
        {(view === "preview" || view === "split") && (
          <div
            className={cn(
              "bg-white overflow-auto",
              view === "split" ? "w-1/2" : "w-full",
            )}
            style={{ height: minHeight }}
          >
            <iframe
              srcDoc={
                value ||
                "<p style='color:#999;font-family:sans-serif;padding:16px'>No content yet…</p>"
              }
              sandbox=""
              title="Email preview"
              className="w-full h-full border-0"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Template Dialog
// ─────────────────────────────────────────────────────────────────────────────

function CreateTemplateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const [form, setForm] = useState({
    slug: "",
    name: "",
    channel: "email",
    subject: "",
    body: "",
    variables: "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleCreate = async () => {
    if (!form.slug.trim() || !form.name.trim() || !form.body.trim()) {
      toast({
        title: "Slug, name and body are required",
        variant: "destructive",
      });
      return;
    }
    if (!/^[a-z0-9_]+$/.test(form.slug)) {
      toast({
        title: "Slug must be lowercase letters, numbers and underscores only",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const variables = form.variables
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      await dispatch(
        createTemplate({
          slug: form.slug,
          name: form.name,
          channel: form.channel,
          subject: form.subject || undefined,
          body: form.body,
          variables: variables.length ? variables : undefined,
        }),
      ).unwrap();
      toast({ title: "Template created" });
      onCreated();
      onClose();
      setForm({
        slug: "",
        name: "",
        channel: "email",
        subject: "",
        body: "",
        variables: "",
      });
    } catch (e: any) {
      toast({
        title: e?.response?.data?.error ?? "Failed to create template",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-accent" /> New Template
          </DialogTitle>
          <DialogDescription>
            Create a reusable email or SMS template for automation and flows.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Channel</Label>
              <Select
                value={form.channel}
                onValueChange={(v) => set("channel", v)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Slug</Label>
              <Input
                value={form.slug}
                onChange={(e) =>
                  set(
                    "slug",
                    e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                  )
                }
                placeholder="my_template_slug"
                className="h-9 text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Unique ID. Use <code>flow_</code> prefix for flow templates.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Name</Label>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Human-readable template name"
              className="h-9 text-sm"
            />
          </div>

          {form.channel === "email" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Subject Line</Label>
              <Input
                value={form.subject}
                onChange={(e) => set("subject", e.target.value)}
                placeholder="Email subject (supports {{variables}})"
                className="h-9 text-sm"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Body {form.channel === "email" ? "(HTML)" : "(Plain text)"}
            </Label>
            {form.channel === "email" ? (
              <HtmlEditorPreview
                value={form.body}
                onChange={(v) => set("body", v)}
                minHeight={220}
              />
            ) : (
              <Textarea
                value={form.body}
                onChange={(e) => set("body", e.target.value)}
                placeholder="Hi {{first_name}}, ..."
                className="text-xs min-h-[120px] resize-y font-mono"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Variables{" "}
              <span className="font-normal text-muted-foreground">
                (comma-separated)
              </span>
            </Label>
            <Input
              value={form.variables}
              onChange={(e) => set("variables", e.target.value)}
              placeholder="first_name, portal_url, round_number"
              className="h-9 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              These become available as{" "}
              <code className="text-primary">{`{{variable}}`}</code> tokens.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Creating…" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete Blocked Dialog
// ─────────────────────────────────────────────────────────────────────────────

function DeleteBlockedDialog({
  open,
  flows,
  onClose,
}: {
  open: boolean;
  flows: string[];
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" /> Cannot Delete Template
          </DialogTitle>
          <DialogDescription>
            This template is actively used by reminder flow steps. Deleting it
            would break those flows.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Flows using this template:
          </p>
          <ul className="space-y-1">
            {flows.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm">
                <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-3">
            Remove this template from all flow steps first, then delete it.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({
  t,
  onSaved,
  onDeleted,
}: {
  t: CommunicationTemplate;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(t.subject ?? "");
  const [body, setBody] = useState(t.body ?? "");
  const [isActive, setIsActive] = useState(!!t.is_active);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Flow-edit warning (shown before saving a flow_ template)
  const [showFlowEditWarning, setShowFlowEditWarning] = useState(false);
  // Delete confirm
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Delete blocked by flows
  const [blockedFlows, setBlockedFlows] = useState<string[]>([]);

  useEffect(() => {
    setSubject(t.subject ?? "");
    setBody(t.body ?? "");
    setIsActive(!!t.is_active);
  }, [t.id, t.subject, t.body, t.is_active]);

  const isDirty =
    subject !== (t.subject ?? "") ||
    body !== (t.body ?? "") ||
    isActive !== !!t.is_active;

  const doSave = async () => {
    setSaving(true);
    try {
      await dispatch(
        updateTemplate({ id: t.id, subject, body, is_active: isActive }),
      ).unwrap();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
      toast({ title: "Template saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClick = () => {
    if (isFlowTemplate(t)) {
      setShowFlowEditWarning(true);
    } else {
      doSave();
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    const result = await dispatch(deleteTemplate({ id: t.id }));
    if (deleteTemplate.fulfilled.match(result)) {
      toast({ title: "Template deleted" });
      onDeleted();
    } else if (deleteTemplate.rejected.match(result)) {
      const payload = result.payload as
        | { error: string; flows: string[] }
        | undefined;
      if (payload?.flows?.length) {
        setBlockedFlows(payload.flows);
      } else {
        toast({ title: "Failed to delete template", variant: "destructive" });
      }
    }
  };

  const ch = CHANNEL_META[t.channel] ?? CHANNEL_META.email;
  const vars: string[] = Array.isArray(t.variables_json)
    ? t.variables_json
    : t.variables_json
      ? Object.keys(t.variables_json)
      : [];

  return (
    <>
      <div
        className={cn(
          "rounded-xl border bg-card transition-shadow",
          open && "shadow-md ring-1 ring-primary/10",
        )}
      >
        {/* Header row */}
        <div className="flex items-center">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex-1 flex items-center justify-between px-4 py-3.5 text-left min-w-0"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Badge
                variant="outline"
                className={cn("gap-1 text-[10px] shrink-0", ch.color)}
              >
                {ch.icon} {ch.label}
              </Badge>
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{t.name}</div>
                <div className="text-[11px] text-muted-foreground font-mono">
                  {t.slug}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {isDirty && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-amber-300 text-amber-600 bg-amber-50"
                >
                  unsaved
                </Badge>
              )}
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  isActive
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "text-muted-foreground",
                )}
              >
                {isActive ? "Active" : "Off"}
              </Badge>
              {open ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </button>

          {/* Delete button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
            }}
            className="h-full px-3.5 border-l text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors rounded-r-xl flex items-center"
            title="Delete template"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Expanded body */}
        {open && (
          <div className="px-4 pb-4 border-t pt-4 space-y-4">
            {/* Flow template warning banner */}
            {isFlowTemplate(t) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  This template is used by the <strong>Reminder Flows</strong>{" "}
                  canvas. Edits affect all future flow executions using this
                  slug.
                </span>
              </div>
            )}

            {/* Variables */}
            {vars.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground font-medium">
                  Variables:
                </span>
                {vars.map((v) => (
                  <VariableTag key={v} v={v} />
                ))}
              </div>
            )}

            {/* Subject (email only) */}
            {t.channel === "email" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Subject Line</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject..."
                  className="h-9 text-sm"
                />
              </div>
            )}

            {/* Body */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                {t.channel === "email" ? "Body (HTML)" : "Message Body"}
              </Label>
              {t.channel === "email" ? (
                <HtmlEditorPreview
                  value={body}
                  onChange={setBody}
                  minHeight={300}
                />
              ) : (
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="text-xs min-h-[140px] resize-y font-mono"
                />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  className="scale-90"
                />
                <Label className="text-xs text-muted-foreground">
                  {isActive ? "Active" : "Disabled"}
                </Label>
              </div>
              <Button
                size="sm"
                className="h-8 gap-1.5"
                onClick={handleSaveClick}
                disabled={saving || !isDirty}
              >
                {saved ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />{" "}
                    Saved
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5" />{" "}
                    {saving ? "Saving…" : "Save"}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Flow-edit warning — confirm before saving */}
      <AlertDialog
        open={showFlowEditWarning}
        onOpenChange={(o) => !o && setShowFlowEditWarning(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Edit Flow
              Template?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{t.name}</strong> is used by the Reminder Flows canvas.
              Saving will change the content sent in{" "}
              <strong>all future flow executions</strong> referencing{" "}
              <code className="text-primary text-xs">{t.slug}</code>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowFlowEditWarning(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowFlowEditWarning(false);
                doSave();
              }}
            >
              Save Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={(o) => !o && setShowDeleteConfirm(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{t.name}</strong> will be permanently deleted. This cannot
              be undone.
              {isFlowTemplate(t) && (
                <span className="block mt-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 inline mr-1.5" />
                  This is a flow template. If any reminder flow steps reference{" "}
                  <code>{t.slug}</code>, the delete will be blocked.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete blocked by flows */}
      <DeleteBlockedDialog
        open={blockedFlows.length > 0}
        flows={blockedFlows}
        onClose={() => setBlockedFlows([])}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminTemplates() {
  const dispatch = useAppDispatch();
  const { templates } = useAppSelector((s) => s.admin);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    dispatch(fetchTemplates());
  }, [dispatch]);

  const reload = () => dispatch(fetchTemplates());

  const flowTemplates = templates.filter((t) => t.slug.startsWith("flow_"));
  const generalTemplates = templates.filter((t) => !t.slug.startsWith("flow_"));

  const renderList = (list: CommunicationTemplate[], emptyMsg: string) =>
    list.length === 0 ? (
      <div className="py-14 text-center text-muted-foreground text-sm">
        {emptyMsg}
      </div>
    ) : (
      <div className="space-y-2">
        {list.map((t) => (
          <TemplateCard key={t.id} t={t} onSaved={reload} onDeleted={reload} />
        ))}
      </div>
    );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Mailbox}
        title="Templates"
        description="Edit email and SMS message bodies used across automation and reminder flows."
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Total Templates",
            value: templates.length,
            color: "text-primary",
            bg: "bg-primary/5",
          },
          {
            label: "Email",
            value: templates.filter((t) => t.channel === "email").length,
            color: "text-violet-600",
            bg: "bg-violet-50",
          },
          {
            label: "Flow Templates",
            value: flowTemplates.length,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
          },
          {
            label: "Active",
            value: templates.filter((t) => t.is_active).length,
            color: "text-sky-600",
            bg: "bg-sky-50",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-card rounded-xl border border-border px-4 py-3 flex items-center gap-3"
          >
            <div
              className={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                s.bg,
              )}
            >
              <Mailbox className={cn("h-4 w-4", s.color)} />
            </div>
            <div>
              <div className="text-xl font-bold">{s.value}</div>
              <div className="text-[11px] text-muted-foreground">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="flow">
        <div className="flex items-center justify-between">
          <TabsList className="h-9">
            <TabsTrigger value="flow" className="text-sm gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Flow Templates
              <Badge variant="secondary" className="text-[10px] ml-0.5 px-1.5">
                {flowTemplates.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="general" className="text-sm gap-1.5">
              <Mailbox className="h-3.5 w-3.5" /> General Templates
              <Badge variant="secondary" className="text-[10px] ml-0.5 px-1.5">
                {generalTemplates.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" /> New Template
          </Button>
        </div>

        {/* Flow Templates tab */}
        <TabsContent value="flow" className="mt-4 space-y-4">
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-3.5 flex gap-2.5">
            <Info className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
            <div className="text-sm text-sky-800">
              These templates are used by the <strong>Reminder Flows</strong>{" "}
              canvas editor. Each slug starting with{" "}
              <code className="text-xs bg-sky-100 border border-sky-200 rounded px-1.5 py-0.5">
                flow_
              </code>{" "}
              is selectable in a flow step. Edits affect all future executions.{" "}
              <strong>Deletes are blocked</strong> if the template is in use.
            </div>
          </div>
          {renderList(flowTemplates, "No flow templates found.")}
        </TabsContent>

        {/* General Templates tab */}
        <TabsContent value="general" className="mt-4">
          {renderList(generalTemplates, "No general templates found.")}
        </TabsContent>
      </Tabs>

      <CreateTemplateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
      />
    </div>
  );
}

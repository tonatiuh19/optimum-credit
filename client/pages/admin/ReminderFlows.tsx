import {
  useEffect,
  useState,
  createContext,
  useContext,
  useMemo,
  useCallback,
} from "react";
import React from "react";
import {
  Bell,
  Mail,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  Play,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
  ToggleLeft,
  ToggleRight,
  ArrowDownCircle,
  Activity,
  Users,
  Calendar,
  RefreshCw,
  AlertTriangle,
  Info,
  CalendarClock,
  CheckCheck,
  XCircle,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchReminderFlows,
  fetchReminderFlow,
  createReminderFlow,
  updateReminderFlow,
  toggleReminderFlow,
  deleteReminderFlow,
  addFlowStep,
  updateFlowStep,
  deleteFlowStep,
  triggerFlowForClient,
  fetchFlowTemplates,
  fetchAllExecutions,
  clearSelectedFlow,
} from "@/store/slices/reminderFlowsSlice";
import type { ReminderFlowTriggerEvent, ReminderFlowStep } from "@shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DataGrid, type DataGridColumn } from "@/components/ui/data-grid";
import type { ReminderFlowExecution } from "@shared/api";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Edge,
  BackgroundVariant,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TRIGGER_EVENT_META: Record<
  ReminderFlowTriggerEvent,
  { label: string; description: string; color: string; icon: typeof Zap }
> = {
  payment_confirmed: {
    label: "Payment Confirmed",
    description:
      "Fires when a client's payment succeeds. Starts the new client document upload sequence.",
    color: "text-emerald-600 bg-emerald-50 border-emerald-200",
    icon: Zap,
  },
  docs_ready: {
    label: "Docs Verified",
    description:
      "Fires when all client documents are approved and the client advances to Docs Ready.",
    color: "text-sky-600 bg-sky-50 border-sky-200",
    icon: CheckCircle2,
  },
  round_1_complete: {
    label: "Round 1 Complete",
    description:
      "Fires when admin creates the Round 1 report. Sends monthly progress email.",
    color: "text-violet-600 bg-violet-50 border-violet-200",
    icon: Activity,
  },
  round_2_complete: {
    label: "Round 2 Complete",
    description: "Fires when admin creates the Round 2 report.",
    color: "text-violet-600 bg-violet-50 border-violet-200",
    icon: Activity,
  },
  round_3_complete: {
    label: "Round 3 Complete",
    description: "Fires when admin creates the Round 3 report.",
    color: "text-violet-600 bg-violet-50 border-violet-200",
    icon: Activity,
  },
  round_4_complete: {
    label: "Round 4 Complete",
    description: "Fires when admin creates the Round 4 report.",
    color: "text-violet-600 bg-violet-50 border-violet-200",
    icon: Activity,
  },
  round_5_complete: {
    label: "Round 5 Complete",
    description:
      "Fires when admin creates the Round 5 report. Final progress report.",
    color: "text-violet-600 bg-violet-50 border-violet-200",
    icon: Activity,
  },
  completed: {
    label: "Credit Repair Completed",
    description: "Fires when admin moves the client to the Completed stage.",
    color: "text-amber-600 bg-amber-50 border-amber-200",
    icon: CheckCircle2,
  },
};

const STEP_TYPE_META: Record<
  "send_email" | "internal_alert",
  {
    label: string;
    icon: typeof Mail;
    color: string;
    border: string;
    bg: string;
  }
> = {
  send_email: {
    label: "Send Email",
    icon: Mail,
    color: "text-primary",
    border: "border-primary/30",
    bg: "bg-primary/5",
  },
  internal_alert: {
    label: "Team Alert",
    icon: AlertTriangle,
    color: "text-amber-600",
    border: "border-amber-300",
    bg: "bg-amber-50",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Step Editor Dialog
// ─────────────────────────────────────────────────────────────────────────────

interface StepEditorProps {
  open: boolean;
  step: ReminderFlowStep | null; // null = add new
  flowId: number;
  templates: { slug: string; name: string; subject: string | null }[];
  onClose: () => void;
  onSaved: () => void;
  onDelete?: (id: number) => void;
}

function StepEditorDialog({
  open,
  step,
  flowId,
  templates,
  onClose,
  onSaved,
  onDelete,
}: StepEditorProps) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    step_type: step?.step_type ?? "send_email",
    delay_days: step?.delay_days ?? 0,
    label: step?.label ?? "",
    template_slug: step?.template_slug ?? "",
    subject: step?.subject ?? "",
    body: step?.body ?? "",
  });

  useEffect(() => {
    setForm({
      step_type: step?.step_type ?? "send_email",
      delay_days: step?.delay_days ?? 0,
      label: step?.label ?? "",
      template_slug: step?.template_slug ?? "",
      subject: step?.subject ?? "",
      body: step?.body ?? "",
    });
  }, [step, open]);

  const set = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (step) {
        await dispatch(
          updateFlowStep({
            flowId,
            stepId: step.id,
            step_type: form.step_type,
            delay_days: form.delay_days,
            label: form.label || undefined,
            template_slug: form.template_slug || undefined,
            subject: form.subject || undefined,
            body: form.body || undefined,
          }),
        ).unwrap();
        toast({ title: "Step updated" });
      } else {
        await dispatch(
          addFlowStep({
            flowId,
            step_type: form.step_type,
            delay_days: form.delay_days,
            label: form.label || undefined,
            template_slug: form.template_slug || undefined,
            subject: form.subject || undefined,
            body: form.body || undefined,
          }),
        ).unwrap();
        toast({ title: "Step added" });
      }
      onSaved();
    } catch {
      toast({ title: "Error saving step", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const useTemplate = form.step_type === "send_email" && form.template_slug;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step ? (
              <>
                <Edit2 className="h-4 w-4 text-primary" /> Edit Step
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 text-accent" /> Add Step
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            Configure what this step does and when it fires relative to the flow
            trigger.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step type */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Step Type</Label>
            <Select
              value={form.step_type}
              onValueChange={(v) => set("step_type", v)}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="send_email">
                  <span className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5" /> Send Email
                  </span>
                </SelectItem>
                <SelectItem value="internal_alert">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5" /> Team Alert
                    (Internal)
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Delay */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Delay (days after trigger)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={90}
                value={form.delay_days}
                onChange={(e) => set("delay_days", Number(e.target.value))}
                className="h-9 w-28"
              />
              <span className="text-sm text-muted-foreground">
                {form.delay_days === 0
                  ? "→ Fires immediately"
                  : `→ Fires ${form.delay_days} day${form.delay_days === 1 ? "" : "s"} after trigger`}
              </span>
            </div>
          </div>

          {/* Label */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Step Label</Label>
            <Input
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="e.g. Day 1 — Welcome Email"
              className="h-9"
            />
          </div>

          {/* Email-specific fields */}
          {form.step_type === "send_email" && (
            <>
              {/* Template selection */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Email Template{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional — overrides custom subject/body)
                  </span>
                </Label>
                <Select
                  value={form.template_slug || "__none__"}
                  onValueChange={(v) =>
                    set("template_slug", v === "__none__" ? "" : v)
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Use custom subject/body" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      — No template (use custom below) —
                    </SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.slug} value={t.slug}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {useTemplate && (
                  <p className="text-[11px] text-accent flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Template will be used — custom fields below are ignored.
                  </p>
                )}
              </div>

              {/* Custom subject/body (shown when no template) */}
              {!useTemplate && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Subject</Label>
                    <Input
                      value={form.subject}
                      onChange={(e) => set("subject", e.target.value)}
                      placeholder="Email subject..."
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Body (HTML)</Label>
                    <Textarea
                      value={form.body}
                      onChange={(e) => set("body", e.target.value)}
                      placeholder="Email body HTML... Use {{first_name}}, {{portal_url}}"
                      className="min-h-[100px] font-mono text-xs resize-none"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Variables:{" "}
                      <code className="bg-muted px-1 rounded text-[10px]">
                        {"{{first_name}}"}
                      </code>{" "}
                      <code className="bg-muted px-1 rounded text-[10px]">
                        {"{{portal_url}}"}
                      </code>
                    </p>
                  </div>
                </>
              )}
            </>
          )}

          {/* Internal alert body */}
          {form.step_type === "internal_alert" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Alert Message</Label>
              <Textarea
                value={form.body}
                onChange={(e) => set("body", e.target.value)}
                placeholder="Alert message for your team..."
                className="min-h-[80px] text-sm resize-none"
              />
              <p className="text-[11px] text-muted-foreground">
                This alert is queued internally for your team — not sent to the
                client.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {step && onDelete && (
            <Button
              variant="destructive"
              className="mr-auto"
              onClick={() => {
                onDelete(step.id);
                onClose();
              }}
              disabled={saving}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete Step
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              "Saving..."
            ) : step ? (
              <>
                <Save className="h-3.5 w-3.5 mr-1.5" /> Save Changes
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Step
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Flow Dialog
// ─────────────────────────────────────────────────────────────────────────────

function CreateFlowDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    description: "",
    trigger_event: "payment_confirmed" as ReminderFlowTriggerEvent,
  });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const result = await dispatch(createReminderFlow(form)).unwrap();
      toast({ title: "Flow created" });
      onCreated(result.id);
    } catch {
      toast({ title: "Error creating flow", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-accent" /> New Reminder Flow
          </DialogTitle>
          <DialogDescription>
            Create an automated email flow for a pipeline trigger event.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Flow Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. New Client Welcome Sequence"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Trigger Event</Label>
            <Select
              value={form.trigger_event}
              onValueChange={(v) =>
                setForm((p) => ({
                  ...p,
                  trigger_event: v as ReminderFlowTriggerEvent,
                }))
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  Object.entries(TRIGGER_EVENT_META) as [
                    ReminderFlowTriggerEvent,
                    (typeof TRIGGER_EVENT_META)[ReminderFlowTriggerEvent],
                  ][]
                ).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Description{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              value={form.description}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              placeholder="Brief description of what this flow does..."
              className="min-h-[60px] text-sm resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Creating..." : "Create Flow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual Trigger Dialog
// ─────────────────────────────────────────────────────────────────────────────

function ManualTriggerDialog({
  open,
  flowId,
  flowName,
  onClose,
}: {
  open: boolean;
  flowId: number;
  flowName: string;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const [clientId, setClientId] = useState("");
  const [running, setRunning] = useState(false);

  const handleTrigger = async () => {
    const id = Number(clientId);
    if (!id) {
      toast({ title: "Valid client ID required", variant: "destructive" });
      return;
    }
    setRunning(true);
    try {
      await dispatch(triggerFlowForClient({ flowId, clientId: id })).unwrap();
      toast({
        title: "Flow triggered successfully",
        description: `Emails scheduled for client #${id}`,
      });
      onClose();
    } catch {
      toast({ title: "Trigger failed", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-4 w-4 text-accent" /> Manual Trigger
          </DialogTitle>
          <DialogDescription>
            Run <strong>{flowName}</strong> for a specific client right now.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Client ID</Label>
            <Input
              type="number"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Enter client ID..."
              className="h-9"
            />
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
            This will immediately send Day-0 emails and queue future-day emails
            for the specified client.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button onClick={handleTrigger} disabled={running}>
            {running ? (
              "Triggering..."
            ) : (
              <>
                <Play className="h-3.5 w-3.5 mr-1.5" /> Run Flow
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReactFlow — context (avoids stale closures in node data)
// ─────────────────────────────────────────────────────────────────────────────

interface FlowActions {
  onEditStep: (s: ReminderFlowStep) => void;
  onDeleteStep: (id: number) => void;
  onAddStep: () => void;
}

const FlowActionsContext = createContext<FlowActions>({
  onEditStep: () => {},
  onDeleteStep: () => {},
  onAddStep: () => {},
});

// ─────────────────────────────────────────────────────────────────────────────
// ReactFlow — custom node components
// ─────────────────────────────────────────────────────────────────────────────

const CANVAS_NODE_WIDTH = 280;

function TriggerNode({ data }: NodeProps) {
  const d = data as { label: string; color: string };
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-4 py-2.5 rounded-full border-2 font-semibold text-sm shadow-sm bg-background",
        d.color,
      )}
      style={{ width: CANVAS_NODE_WIDTH }}
    >
      <Zap className="h-4 w-4 shrink-0" />
      <span className="truncate">Trigger: {d.label}</span>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-border !w-2 !h-2"
      />
    </div>
  );
}

function StepNode({ data }: NodeProps) {
  const d = data as {
    step: ReminderFlowStep;
    meta: {
      label: string;
      color: string;
      bg: string;
      border: string;
      icon: any;
    };
  };
  const StepIcon = d.meta?.icon ?? Mail;
  return (
    <div
      className="rounded-xl border-2 border-border bg-card shadow-sm cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
      style={{ width: CANVAS_NODE_WIDTH }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-border !w-2 !h-2"
      />
      <div className="flex items-start gap-3 p-3">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
            d.meta?.bg,
            d.meta?.border,
          )}
        >
          <StepIcon className={cn("h-4 w-4", d.meta?.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn("text-[11px] font-semibold", d.meta?.color)}>
              {d.meta?.label}
            </span>
            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">
              {d.step.delay_days === 0
                ? "Immediately"
                : `Day ${d.step.delay_days}`}
            </span>
          </div>
          <p className="text-sm font-medium text-foreground mt-0.5 truncate">
            {d.step.label || "(no label)"}
          </p>
          {d.step.template_slug && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              Template:{" "}
              <code className="bg-muted px-1 rounded text-[10px]">
                {d.step.template_slug}
              </code>
            </p>
          )}
          {!d.step.template_slug && d.step.subject && (
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {d.step.subject}
            </p>
          )}
        </div>
        <Edit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 mt-0.5" />
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-border !w-2 !h-2"
      />
    </div>
  );
}

function AddStepNode() {
  return (
    <div style={{ width: CANVAS_NODE_WIDTH }}>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-border !w-2 !h-2"
      />
      <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary cursor-pointer transition-colors text-sm font-medium bg-background">
        <Plus className="h-4 w-4" />
        Add Step
      </div>
    </div>
  );
}

const FLOW_NODE_TYPES = {
  trigger: TriggerNode,
  step: StepNode,
  addStep: AddStepNode,
};

const FLOW_EDGE_STYLE = {
  stroke: "hsl(var(--border))",
  strokeWidth: 2,
};

function buildNodesAndEdges(
  steps: ReminderFlowStep[],
  triggerMeta:
    | (typeof TRIGGER_EVENT_META)[keyof typeof TRIGGER_EVENT_META]
    | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const Y_GAP = 130;

  const nodes: Node[] = [
    {
      id: "trigger",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: {
        label: triggerMeta?.label ?? "Trigger",
        color: triggerMeta?.color ?? "",
      },
      draggable: false,
    },
    ...steps.map((step, i) => ({
      id: `step-${step.id}`,
      type: "step" as const,
      position: { x: 0, y: (i + 1) * Y_GAP },
      data: {
        step,
        meta: STEP_TYPE_META[step.step_type as "send_email" | "internal_alert"],
      },
      draggable: false,
    })),
    {
      id: "add-step",
      type: "addStep",
      position: { x: 0, y: (steps.length + 1) * Y_GAP },
      data: {},
      draggable: false,
    },
  ];

  const allIds = ["trigger", ...steps.map((s) => `step-${s.id}`), "add-step"];

  const edges: Edge[] = allIds.slice(0, -1).map((id, i) => ({
    id: `e-${i}`,
    source: id,
    target: allIds[i + 1],
    style: FLOW_EDGE_STYLE,
    markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--border))" },
    animated: i === 0,
  }));

  return { nodes, edges };
}

function FlowCanvas({
  steps,
  triggerMeta,
  onEditStep,
  onAddStep,
}: {
  steps: ReminderFlowStep[];
  triggerMeta:
    | (typeof TRIGGER_EVENT_META)[keyof typeof TRIGGER_EVENT_META]
    | undefined;
  onEditStep: (s: ReminderFlowStep) => void;
  onAddStep: () => void;
}) {
  const { nodes, edges } = buildNodesAndEdges(steps, triggerMeta);
  const [rfNodes, , onNodesChange] = useNodesState(nodes);
  const [rfEdges, , onEdgesChange] = useEdgesState(edges);
  const canvasHeight = Math.max(380, (steps.length + 3) * 130);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "step") {
        const step = (node.data as { step: ReminderFlowStep }).step;
        onEditStep(step);
      } else if (node.type === "addStep") {
        onAddStep();
      }
    },
    [onEditStep, onAddStep],
  );

  return (
    <div
      className="rounded-xl border border-border overflow-hidden bg-muted/20"
      style={{ height: canvasHeight }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={FLOW_NODE_TYPES}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          className="opacity-40"
        />
        <Controls
          showInteractive={false}
          className="bg-background border-border"
        />
      </ReactFlow>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow Detail Panel — steps canvas
// ─────────────────────────────────────────────────────────────────────────────

function FlowDetail() {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { selectedFlow, flowExecutions, flowTemplates } = useAppSelector(
    (s) => s.reminderFlows,
  );

  const [editingStep, setEditingStep] = useState<ReminderFlowStep | null>(null);
  const [addingStep, setAddingStep] = useState(false);
  const [deletingStepId, setDeletingStepId] = useState<number | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(selectedFlow?.name ?? "");
  const [descVal, setDescVal] = useState(selectedFlow?.description ?? "");
  const [savingMeta, setSavingMeta] = useState(false);

  useEffect(() => {
    setNameVal(selectedFlow?.name ?? "");
    setDescVal(selectedFlow?.description ?? "");
  }, [selectedFlow?.id]);

  if (!selectedFlow) return null;

  const triggerMeta =
    TRIGGER_EVENT_META[selectedFlow.trigger_event as ReminderFlowTriggerEvent];
  const TriggerIcon = triggerMeta?.icon ?? Zap;
  const steps = selectedFlow.steps ?? [];

  const handleDeleteStep = async () => {
    if (!deletingStepId) return;
    await dispatch(
      deleteFlowStep({ flowId: selectedFlow.id, stepId: deletingStepId }),
    );
    setDeletingStepId(null);
    toast({ title: "Step removed" });
  };

  const handleSaveMeta = async () => {
    setSavingMeta(true);
    try {
      await dispatch(
        updateReminderFlow({
          id: selectedFlow.id,
          name: nameVal,
          description: descVal,
        }),
      ).unwrap();
      toast({ title: "Flow updated" });
      setEditingName(false);
    } catch {
      toast({ title: "Error saving", variant: "destructive" });
    } finally {
      setSavingMeta(false);
    }
  };

  const handleToggle = async () => {
    await dispatch(toggleReminderFlow(selectedFlow.id));
    toast({
      title: selectedFlow.is_active ? "Flow paused" : "Flow activated",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="space-y-2">
              <Input
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                className="h-9 text-base font-semibold"
                autoFocus
              />
              <Textarea
                value={descVal}
                onChange={(e) => setDescVal(e.target.value)}
                placeholder="Description..."
                className="min-h-[60px] text-sm resize-none"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveMeta}
                  disabled={savingMeta}
                  className="h-7"
                >
                  <Save className="h-3 w-3 mr-1" />
                  {savingMeta ? "Saving..." : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => setEditingName(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="cursor-pointer group"
              onClick={() => setEditingName(true)}
            >
              <h2 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors truncate">
                {selectedFlow.name}
              </h2>
              {selectedFlow.description && (
                <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                  {selectedFlow.description}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                Click to edit name/description
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => setTriggerOpen(true)}
          >
            <Play className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Test</span>
          </Button>
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={handleToggle}
          >
            {selectedFlow.is_active ? (
              <ToggleRight className="h-6 w-6 text-accent" />
            ) : (
              <ToggleLeft className="h-6 w-6 text-muted-foreground" />
            )}
            <span className="text-xs font-medium">
              {selectedFlow.is_active ? "Active" : "Paused"}
            </span>
          </div>
        </div>
      </div>

      {/* Trigger badge */}
      <div
        className={cn(
          "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border",
          triggerMeta?.color,
        )}
      >
        <TriggerIcon className="h-3.5 w-3.5" />
        Trigger: {triggerMeta?.label}
      </div>

      {/* Steps canvas */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">
            Steps ({steps.length})
          </h3>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={() => setAddingStep(true)}
          >
            <Plus className="h-3 w-3" /> Add Step
          </Button>
        </div>

        <ReactFlowProvider>
          <FlowCanvas
            steps={steps}
            triggerMeta={triggerMeta}
            onEditStep={(s) => setEditingStep(s)}
            onAddStep={() => setAddingStep(true)}
          />
        </ReactFlowProvider>
      </div>

      {/* Execution history */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">
          Recent Executions ({flowExecutions.length})
        </h3>
        {flowExecutions.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center rounded-lg border border-dashed">
            No executions yet — this flow hasn't been triggered.
          </div>
        ) : (
          <DataGrid
            data={flowExecutions as ReminderFlowExecution[]}
            columns={EXEC_COLUMNS}
            rowKey={(e) => e.id}
            emptyMessage="No executions yet."
          />
        )}
      </div>

      {/* Dialogs */}
      <StepEditorDialog
        open={!!editingStep}
        step={editingStep}
        flowId={selectedFlow.id}
        templates={flowTemplates}
        onClose={() => setEditingStep(null)}
        onSaved={() => setEditingStep(null)}
        onDelete={(id) => {
          setEditingStep(null);
          setDeletingStepId(id);
        }}
      />
      <StepEditorDialog
        open={addingStep}
        step={null}
        flowId={selectedFlow.id}
        templates={flowTemplates}
        onClose={() => setAddingStep(false)}
        onSaved={() => setAddingStep(false)}
      />
      <ManualTriggerDialog
        open={triggerOpen}
        flowId={selectedFlow.id}
        flowName={selectedFlow.name}
        onClose={() => setTriggerOpen(false)}
      />
      <AlertDialog
        open={!!deletingStepId}
        onOpenChange={(o) => !o && setDeletingStepId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this step?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStep}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Execution helpers
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    completed: {
      label: "Completed",
      cls: "border-emerald-300 bg-emerald-50 text-emerald-700",
      icon: <CheckCheck className="h-3 w-3" />,
    },
    partial: {
      label: "Partial",
      cls: "border-amber-300 bg-amber-50 text-amber-700",
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    failed: {
      label: "Failed",
      cls: "border-red-300 bg-red-50 text-red-700",
      icon: <XCircle className="h-3 w-3" />,
    },
  };
  const s = map[status] ?? map.partial;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", s.cls)}>
      {s.icon} {s.label}
    </Badge>
  );
}

function StepProgress({ exec }: { exec: ReminderFlowExecution }) {
  const total = exec.total_steps ?? exec.steps_executed + exec.steps_scheduled;
  const done = exec.steps_executed;
  if (total === 0)
    return <span className="text-xs text-muted-foreground">—</span>;

  const pct = Math.round((done / total) * 100);
  const allDone = exec.status === "completed" && exec.steps_scheduled === 0;

  return (
    <div className="space-y-1.5 min-w-[140px]">
      {/* bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            allDone ? "bg-emerald-500" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* label */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {done}/{total} steps
        </span>
        {exec.steps_scheduled > 0 && exec.next_step_scheduled_for ? (
          <span className="flex items-center gap-0.5 text-sky-600">
            <CalendarClock className="h-2.5 w-2.5" />
            {new Date(exec.next_step_scheduled_for).toLocaleDateString(
              undefined,
              {
                month: "short",
                day: "numeric",
              },
            )}
          </span>
        ) : allDone ? (
          <span className="text-emerald-600">Done</span>
        ) : null}
      </div>
      {/* next step label */}
      {exec.next_step_label && (
        <div
          className="text-[10px] text-muted-foreground truncate max-w-[180px]"
          title={exec.next_step_label}
        >
          Next: {exec.next_step_label}
        </div>
      )}
    </div>
  );
}

const EXEC_COLUMNS: DataGridColumn<ReminderFlowExecution>[] = [
  {
    key: "client_name",
    label: "Client",
    render: (e) => (
      <div>
        <div className="font-medium text-sm">{e.client_name}</div>
        <div className="text-xs text-muted-foreground">{e.client_email}</div>
      </div>
    ),
  },
  {
    key: "triggered_at",
    label: "Triggered",
    shrink: true,
    render: (e) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {new Date(e.triggered_at).toLocaleString()}
      </span>
    ),
  },
  {
    key: "status",
    label: "Status",
    shrink: true,
    render: (e) => <StatusBadge status={e.status} />,
  },
  {
    key: "progress",
    label: "Progress",
    render: (e) => <StepProgress exec={e} />,
  },
];

const EXEC_COLUMNS_WITH_FLOW: DataGridColumn<ReminderFlowExecution>[] = [
  {
    key: "flow_name",
    label: "Flow",
    render: (e) => (
      <div>
        <div className="font-medium text-sm">{e.flow_name}</div>
        <div className="text-[10px] text-muted-foreground font-mono">
          {e.trigger_event}
        </div>
      </div>
    ),
  },
  ...EXEC_COLUMNS,
];

// ─────────────────────────────────────────────────────────────────────────────
// Flow Card
// ─────────────────────────────────────────────────────────────────────────────

function FlowCard({
  flow,
  selected,
  onSelect,
  onToggle,
  onDelete,
}: {
  flow: any;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const triggerMeta =
    TRIGGER_EVENT_META[flow.trigger_event as ReminderFlowTriggerEvent];
  const TriggerIcon = triggerMeta?.icon ?? Zap;

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all duration-150 hover:shadow-md border-2",
        selected
          ? "border-primary shadow-md shadow-primary/10"
          : "border-border hover:border-primary/30",
      )}
      onClick={onSelect}
    >
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                triggerMeta?.color,
              )}
            >
              <TriggerIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold truncate">
                {flow.name}
              </CardTitle>
              <CardDescription className="text-[11px] truncate">
                {triggerMeta?.label}
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Badge
              variant={flow.is_active ? "default" : "secondary"}
              className={cn(
                "text-[10px] h-5",
                flow.is_active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              {flow.is_active ? "Active" : "Paused"}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {flow.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
            {flow.description}
          </p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Bell className="h-3 w-3" />
              {flow.step_count ?? 0} steps
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              title={flow.is_active ? "Pause flow" : "Activate flow"}
            >
              {flow.is_active ? (
                <ToggleRight className="h-4 w-4 text-accent" />
              ) : (
                <ToggleLeft className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Delete flow"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform",
                selected ? "text-primary rotate-90" : "text-muted-foreground",
              )}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminReminderFlows() {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { flows, selectedFlow, executions, loading } = useAppSelector(
    (s) => s.reminderFlows,
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("flows");

  useEffect(() => {
    dispatch(fetchReminderFlows());
    dispatch(fetchFlowTemplates());
    dispatch(fetchAllExecutions());
  }, [dispatch]);

  const handleSelectFlow = async (id: number) => {
    if (selectedId === id) {
      setSelectedId(null);
      dispatch(clearSelectedFlow());
      return;
    }
    setSelectedId(id);
    dispatch(fetchReminderFlow(id));
  };

  const handleToggle = async (id: number) => {
    await dispatch(toggleReminderFlow(id));
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    await dispatch(deleteReminderFlow(deletingId));
    if (selectedId === deletingId) {
      setSelectedId(null);
      dispatch(clearSelectedFlow());
    }
    setDeletingId(null);
    toast({ title: "Flow deleted" });
  };

  // Summary stats
  const activeCount = flows.filter((f) => f.is_active).length;
  const totalSteps = flows.reduce((acc, f) => acc + (f.step_count ?? 0), 0);
  const recentExec = executions.length;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Bell}
        title="Reminder Flows"
        description="Automated email sequences triggered at each step of the client pipeline."
      />

      {/* Info callout */}
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 flex gap-3">
        <Info className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
        <div className="text-sm text-sky-800">
          <strong>Email-first automation.</strong> All steps currently send via{" "}
          <strong>email (Resend)</strong>. SMS support can be added to each step
          when Twilio is configured. Day-0 emails are sent immediately; future
          days are queued in the notification queue.
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between">
          <TabsList className="h-9">
            <TabsTrigger value="flows" className="text-sm gap-1.5">
              <Bell className="h-3.5 w-3.5" /> Flows
            </TabsTrigger>
            <TabsTrigger value="history" className="text-sm gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Execution History
            </TabsTrigger>
          </TabsList>
          {activeTab === "flows" && (
            <Button
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" /> New Flow
            </Button>
          )}
        </div>

        {/* ── Flows tab ─────────────────────────────────────────────── */}
        <TabsContent value="flows" className="mt-4">
          {loading && flows.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              Loading flows...
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left: flow list */}
              <div className="space-y-3">
                {flows.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 rounded-xl border-2 border-dashed border-border text-center">
                    <Bell className="h-10 w-10 text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-foreground">
                      No reminder flows
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 mb-4">
                      Create your first flow to start automating client emails.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                      className="gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" /> Create Flow
                    </Button>
                  </div>
                ) : (
                  flows.map((flow) => (
                    <FlowCard
                      key={flow.id}
                      flow={flow}
                      selected={selectedId === flow.id}
                      onSelect={() => handleSelectFlow(flow.id)}
                      onToggle={() => handleToggle(flow.id)}
                      onDelete={() => setDeletingId(flow.id)}
                    />
                  ))
                )}
              </div>

              {/* Right: flow detail */}
              <div>
                {selectedFlow && selectedId ? (
                  <div className="rounded-xl border border-border bg-card p-5 sticky top-4">
                    <FlowDetail />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed border-border text-center text-muted-foreground">
                    <Bell className="h-8 w-8 opacity-30 mb-2" />
                    <p className="text-sm">
                      Select a flow to view and edit its steps
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── History tab ────────────────────────────────────────────── */}
        <TabsContent value="history" className="mt-4">
          <DataGrid
            data={executions as ReminderFlowExecution[]}
            columns={EXEC_COLUMNS_WITH_FLOW}
            rowKey={(e) => e.id}
            emptyMessage="No executions recorded yet."
            isLoading={loading && executions.length === 0}
          />
        </TabsContent>
      </Tabs>

      {/* Create Flow Dialog */}
      <CreateFlowDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          setSelectedId(id);
          dispatch(fetchReminderFlow(id));
        }}
      />

      {/* Delete Confirm */}
      <AlertDialog
        open={!!deletingId}
        onOpenChange={(o) => !o && setDeletingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this flow?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the flow and all its steps. Execution
              history will also be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete Flow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

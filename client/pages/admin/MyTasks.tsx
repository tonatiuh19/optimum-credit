import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CheckSquare,
  Loader2,
  Plus,
  RefreshCw,
  Link2,
  Unlink,
  Shield,
  Calendar,
  User,
  GripVertical,
  X,
  Sparkles,
  Lock,
  Briefcase,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createWorkTask,
  deleteWorkTask,
  disconnectHubspot,
  fetchHubspotPermissions,
  fetchHubspotStatus,
  fetchMoreWorkTasks,
  fetchWorkAssignees,
  fetchWorkBadge,
  fetchWorkTasks,
  setHubspotPermission,
  setWorkTasksQuery,
  startHubspotOAuth,
  syncHubspotTasks,
  updateWorkTask,
} from "@/store/slices/workTasksSlice";
import type {
  AdminWorkTask,
  WorkTaskCaseOption,
  WorkTaskPriority,
  WorkTaskStatus,
} from "@shared/api";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { CaseSearchPicker } from "@/components/ui/case-search-picker";
import MyTasksBoardSkeleton from "@/components/admin/MyTasksBoardSkeleton";

const COLUMNS: {
  status: WorkTaskStatus;
  labelKey: string;
  border: string;
}[] = [
  {
    status: "backlog",
    labelKey: "myTasks.columns.backlog",
    border: "border-t-muted-foreground/40",
  },
  {
    status: "doing",
    labelKey: "myTasks.columns.doing",
    border: "border-t-primary",
  },
  {
    status: "done",
    labelKey: "myTasks.columns.done",
    border: "border-t-accent",
  },
];

const PRIORITY_STYLES: Record<WorkTaskPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-secondary text-secondary-foreground",
  high: "bg-primary/15 text-primary",
  urgent: "bg-destructive/15 text-destructive",
};

const PAGE_LIMIT = 20;

function fmtDue(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function AdminMyTasks() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAppSelector((s) => s.adminAuth);
  const {
    tasks,
    columns,
    query,
    assignees,
    loading,
    loadingMore,
    saving,
    syncing,
    hubspot,
    permissions,
    lastSync,
  } = useAppSelector((s) => s.workTasks);

  const isSuperAdmin = user?.role === "super_admin";
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<WorkTaskStatus | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<AdminWorkTask | null>(null);
  const [permOpen, setPermOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(query);
  const debouncedSearch = useDebounce(searchInput, 320);

  const [form, setForm] = useState({
    title: "",
    description: "",
    status: "backlog" as WorkTaskStatus,
    priority: "medium" as WorkTaskPriority,
    due_at: "",
    assignee_admin_id: "" as string,
    labels: "",
  });
  const [linkedCase, setLinkedCase] = useState<WorkTaskCaseOption | null>(null);
  const deepLinkTaskHandled = useRef<number | null>(null);

  useEffect(() => {
    dispatch(fetchWorkAssignees());
    dispatch(fetchWorkBadge());
    dispatch(fetchHubspotStatus());
  }, [dispatch]);

  useEffect(() => {
    dispatch(setWorkTasksQuery(debouncedSearch.trim()));
    void dispatch(
      fetchWorkTasks({ q: debouncedSearch.trim(), limit: PAGE_LIMIT }),
    );
  }, [debouncedSearch, dispatch]);

  // Soft sync on visit when HubSpot is connected + permitted
  useEffect(() => {
    if (!hubspot?.connected || !hubspot.can_extract) return;
    const key = "oc_hubspot_soft_sync";
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < 45_000) return;
    sessionStorage.setItem(key, String(Date.now()));
    void dispatch(syncHubspotTasks()).then(() => {
      dispatch(
        fetchWorkTasks({ q: debouncedSearch.trim(), limit: PAGE_LIMIT }),
      );
      dispatch(fetchWorkBadge());
    });
  }, [hubspot?.connected, hubspot?.can_extract, dispatch, debouncedSearch]);

  useEffect(() => {
    const hs = searchParams.get("hubspot");
    if (!hs) return;
    if (hs === "connected") {
      toast({ title: t("myTasks.hubspot.connected") });
      dispatch(fetchHubspotStatus());
      void dispatch(syncHubspotTasks()).then(() =>
        dispatch(
          fetchWorkTasks({ q: debouncedSearch.trim(), limit: PAGE_LIMIT }),
        ),
      );
    } else if (hs === "error") {
      toast({
        title: t("myTasks.hubspot.connectFailed"),
        description: searchParams.get("reason") || undefined,
        variant: "destructive",
      });
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, dispatch, toast, t, debouncedSearch]);

  const loadMore = (status: WorkTaskStatus) => {
    const col = columns[status];
    if (!col?.has_more || loadingMore) return;
    void dispatch(
      fetchMoreWorkTasks({
        status,
        offset: col.tasks.length,
        q: debouncedSearch.trim(),
        limit: PAGE_LIMIT,
      }),
    );
  };

  const resetForm = (status: WorkTaskStatus = "backlog") => {
    setForm({
      title: "",
      description: "",
      status,
      priority: "medium",
      due_at: "",
      assignee_admin_id: "",
      labels: "",
    });
    setLinkedCase(null);
  };

  const openCreate = (status: WorkTaskStatus = "backlog") => {
    setEditTask(null);
    resetForm(status);
    setCreateOpen(true);
  };

  const openEdit = (task: AdminWorkTask) => {
    setEditTask(task);
    setForm({
      title: task.title,
      description: task.description || "",
      status: task.status,
      priority: task.priority,
      due_at: task.due_at ? task.due_at.slice(0, 10) : "",
      assignee_admin_id: task.assignee_admin_id
        ? String(task.assignee_admin_id)
        : "",
      labels: task.labels.join(", "),
    });
    setLinkedCase(
      task.case_id
        ? {
            case_id: task.case_id,
            case_number: task.case_number,
            client_id: task.client_id ?? 0,
            client_first_name: task.client_name?.trim() || "",
            client_last_name: "",
            client_email: null,
            pipeline_stage: "",
            case_status: "active",
          }
        : null,
    );
    setCreateOpen(true);
  };

  // Calendar / notifications: /admin/my-tasks?task=ID opens the editor.
  useEffect(() => {
    const raw = searchParams.get("task");
    if (!raw) return;
    const taskId = Number(raw);
    if (!Number.isFinite(taskId) || taskId <= 0) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("task");
          return next;
        },
        { replace: true },
      );
      return;
    }
    if (loading) return;

    const found =
      tasks.find((t) => t.id === taskId) ||
      (["backlog", "doing", "done"] as WorkTaskStatus[])
        .flatMap((st) => columns[st]?.tasks ?? [])
        .find((t) => t.id === taskId);

    if (found) {
      if (deepLinkTaskHandled.current !== taskId) {
        deepLinkTaskHandled.current = taskId;
        openEdit(found);
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("task");
          return next;
        },
        { replace: true },
      );
      return;
    }

    if (deepLinkTaskHandled.current === taskId) return;
    deepLinkTaskHandled.current = taskId;
    toast({
      title: t("myTasks.deepLinkNotFound"),
      variant: "destructive",
    });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("task");
        return next;
      },
      { replace: true },
    );
  }, [
    searchParams,
    setSearchParams,
    loading,
    tasks,
    columns,
    toast,
    t,
  ]);

  const saveTask = async () => {
    if (!form.title.trim()) return;
    const labels = form.labels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      priority: form.priority,
      due_at: form.due_at || null,
      assignee_admin_id: form.assignee_admin_id
        ? Number(form.assignee_admin_id)
        : null,
      case_id: linkedCase?.case_id ?? null,
      labels,
    };
    if (editTask) {
      await dispatch(updateWorkTask({ id: editTask.id, ...payload }));
    } else {
      await dispatch(createWorkTask(payload));
    }
    setCreateOpen(false);
    dispatch(fetchWorkBadge());
  };

  const onDrop = async (status: WorkTaskStatus) => {
    if (draggingId == null) return;
    const task = tasks.find((x) => x.id === draggingId);
    setDraggingId(null);
    setDragOver(null);
    if (!task || task.status === status) return;
    await dispatch(updateWorkTask({ id: task.id, status }));
    dispatch(fetchWorkBadge());
  };

  const handleConnect = async () => {
    const result = await dispatch(startHubspotOAuth());
    if (startHubspotOAuth.fulfilled.match(result)) {
      window.location.href = result.payload;
    } else {
      toast({
        title: t("myTasks.hubspot.connectFailed"),
        description: String(result.payload || ""),
        variant: "destructive",
      });
    }
  };

  const handleSync = async () => {
    const result = await dispatch(syncHubspotTasks());
    await dispatch(
      fetchWorkTasks({ q: debouncedSearch.trim(), limit: PAGE_LIMIT }),
    );
    dispatch(fetchWorkBadge());
    if (syncHubspotTasks.fulfilled.match(result)) {
      toast({
        title: t("myTasks.hubspot.synced"),
        description: t("myTasks.hubspot.syncSummary", {
          created: result.payload.created,
          updated: result.payload.updated,
          pushed: result.payload.pushed,
        }),
      });
    }
  };

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon={CheckSquare}
        title={t("myTasks.title")}
        description={t("myTasks.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!hubspot?.oauth_configured ? (
              <button
                type="button"
                disabled
                title={t("myTasks.hubspot.comingSoonHint")}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-border bg-muted/40 text-sm font-medium text-muted-foreground cursor-not-allowed"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                {t("myTasks.hubspot.comingSoon")}
                <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                  {t("myTasks.hubspot.soonBadge")}
                </span>
                <Lock className="w-3 h-3 opacity-60" />
              </button>
            ) : (
              <>
                {isSuperAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPermOpen(true);
                      dispatch(fetchHubspotPermissions());
                    }}
                  >
                    <Shield className="w-4 h-4 mr-1.5" />
                    {t("myTasks.hubspot.permissions")}
                  </Button>
                )}
                {hubspot.can_extract && (
                  <>
                    {hubspot.connected ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={syncing}
                          onClick={() => void handleSync()}
                        >
                          {syncing ? (
                            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4 mr-1.5" />
                          )}
                          {t("myTasks.hubspot.syncNow")}
                        </Button>
                        {hubspot.auth_mode !== "service_key" &&
                          hubspot.auth_mode !== "private_app" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => void dispatch(disconnectHubspot())}
                          >
                            <Unlink className="w-4 h-4 mr-1.5" />
                            {t("myTasks.hubspot.disconnect")}
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleConnect()}
                      >
                        <Link2 className="w-4 h-4 mr-1.5" />
                        {t("myTasks.hubspot.connect")}
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
            <Button type="button" size="sm" onClick={() => openCreate()}>
              <Plus className="w-4 h-4 mr-1.5" />
              {t("myTasks.addTask")}
            </Button>
          </div>
        }
      />

      {lastSync && lastSync.errors.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {lastSync.errors[0]}
        </div>
      )}

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("myTasks.searchPlaceholder")}
          className="pl-9 pr-9 h-10 rounded-xl"
          aria-label={t("myTasks.searchPlaceholder")}
        />
        {searchInput ? (
          <button
            type="button"
            onClick={() => setSearchInput("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label={t("myTasks.clearSearch")}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>

      {loading && tasks.length === 0 ? (
        <MyTasksBoardSkeleton />
      ) : (
        <div
          className={[
            "grid lg:grid-cols-3 gap-4 items-start transition-opacity",
            loading ? "opacity-60" : "",
          ].join(" ")}
        >
          {COLUMNS.map((col) => {
            const page = columns[col.status];
            const colTasks = page?.tasks ?? [];
            const total = page?.total ?? colTasks.length;
            return (
            <div
              key={col.status}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(col.status);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => void onDrop(col.status)}
              className={[
                "rounded-2xl border border-border bg-card/60 min-h-[420px] flex flex-col border-t-4 transition-colors",
                col.border,
                dragOver === col.status ? "bg-primary/5" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">
                    {t(col.labelKey)}
                  </h3>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground tabular-nums">
                    {total}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openCreate(col.status)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title={t("myTasks.addTask")}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="p-3 space-y-2 flex-1">
                {colTasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDraggingId(task.id)}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragOver(null);
                    }}
                    onClick={() => openEdit(task)}
                    className={[
                      "rounded-xl border border-border bg-background p-3 cursor-pointer hover:border-primary/40 transition-all group",
                      draggingId === task.id ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="w-3.5 h-3.5 mt-0.5 text-muted-foreground/50 shrink-0" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug">
                            {task.title}
                          </p>
                          <span
                            className={[
                              "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0",
                              task.source === "hubspot"
                                ? "bg-primary/10 text-primary"
                                : "bg-accent/15 text-accent-foreground",
                            ].join(" ")}
                          >
                            {task.source === "hubspot"
                              ? t("myTasks.source.hubspot")
                              : t("myTasks.source.optimum")}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${PRIORITY_STYLES[task.priority]}`}
                          >
                            {t(`myTasks.priority.${task.priority}`)}
                          </span>
                          {task.due_at && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Calendar className="w-3 h-3" />
                              {fmtDue(task.due_at)}
                            </span>
                          )}
                          {task.assignee_name ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                              <User className="w-3 h-3" />
                              {task.assignee_name}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/70">
                              {t("myTasks.unassigned")}
                            </span>
                          )}
                          {task.case_id && (
                            <Link
                              to={
                                task.client_id
                                  ? `/admin/pipeline?client=${task.client_id}`
                                  : "/admin/pipeline"
                              }
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
                            >
                              <Briefcase className="w-3 h-3" />
                              {task.case_number ||
                                t("myTasks.linkedCaseFallback")}
                            </Link>
                          )}
                        </div>
                        {task.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {task.labels.map((l) => (
                              <span
                                key={l}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                              >
                                {l}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {colTasks.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    {debouncedSearch.trim()
                      ? t("myTasks.emptySearchColumn")
                      : t("myTasks.emptyColumn")}
                  </p>
                )}
                {page?.has_more && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full mt-1"
                    disabled={loadingMore === col.status}
                    onClick={() => loadMore(col.status)}
                  >
                    {loadingMore === col.status ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : null}
                    {t("myTasks.loadMore", {
                      shown: colTasks.length,
                      total,
                    })}
                  </Button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editTask ? t("myTasks.editTask") : t("myTasks.addTask")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder={t("myTasks.form.title")}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <Textarea
              placeholder={t("myTasks.form.description")}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              rows={3}
            />
            <div className="grid grid-cols-2 gap-3">
              <Select
                value={form.status}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, status: v as WorkTaskStatus }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COLUMNS.map((c) => (
                    <SelectItem key={c.status} value={c.status}>
                      {t(c.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={form.priority}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, priority: v as WorkTaskPriority }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["low", "medium", "high", "urgent"] as const).map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`myTasks.priority.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="date"
                value={form.due_at}
                onChange={(e) =>
                  setForm((f) => ({ ...f, due_at: e.target.value }))
                }
              />
              <Select
                value={form.assignee_admin_id || "unassigned"}
                onValueChange={(v) =>
                  setForm((f) => ({
                    ...f,
                    assignee_admin_id: v === "unassigned" ? "" : v,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("myTasks.unassigned")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">
                    {t("myTasks.unassigned")}
                  </SelectItem>
                  {assignees.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.first_name} {a.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {t("myTasks.form.linkCase")}
              </p>
              <CaseSearchPicker value={linkedCase} onChange={setLinkedCase} />
            </div>
            <Input
              placeholder={t("myTasks.form.labels")}
              value={form.labels}
              onChange={(e) =>
                setForm((f) => ({ ...f, labels: e.target.value }))
              }
            />
            <div className="flex justify-between gap-2 pt-2">
              {editTask ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    await dispatch(deleteWorkTask(editTask.id));
                    setCreateOpen(false);
                    dispatch(fetchWorkBadge());
                  }}
                >
                  <X className="w-4 h-4 mr-1" />
                  {t("myTasks.delete")}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                >
                  {t("myTasks.cancel")}
                </Button>
                <Button
                  type="button"
                  disabled={saving || !form.title.trim()}
                  onClick={() => void saveTask()}
                >
                  {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  {t("myTasks.save")}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Super-admin permissions */}
      <Dialog open={permOpen} onOpenChange={setPermOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("myTasks.hubspot.permissionsTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("myTasks.hubspot.permissionsHint")}
          </p>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {permissions.map((p) => (
              <div
                key={p.admin_id}
                className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {p.first_name} {p.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {p.email} · {p.role}
                    {p.connected ? ` · ${t("myTasks.hubspot.connectedBadge")}` : ""}
                  </p>
                </div>
                <Switch
                  checked={p.can_extract}
                  disabled={p.role === "super_admin"}
                  onCheckedChange={(checked) => {
                    void dispatch(
                      setHubspotPermission({
                        adminId: p.admin_id,
                        can_extract: checked,
                      }),
                    );
                  }}
                />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

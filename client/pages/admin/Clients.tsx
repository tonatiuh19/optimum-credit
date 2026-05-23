import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Search,
  Users,
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  Layers,
  SlidersHorizontal,
  X,
  Globe2,
  CalendarDays,
  FileText,
  ChevronDown,
} from "lucide-react";
import { useFormik } from "formik";
import * as Yup from "yup";
import AdminPageHeader from "@/components/AdminPageHeader";
import { DataGrid } from "@/components/ui/data-grid";
import { LangBadge } from "@/components/ui/lang-badge";
import type { DataGridColumn } from "@/components/ui/data-grid";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
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
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAdminClients,
  createAdminClient,
  updateAdminClient,
  deleteAdminClient,
} from "@/store/slices/adminSlice";
import { useDebounce } from "@/hooks/use-debounce";
import type { AdminClientListItem, PipelineStage } from "@shared/api";

function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function BillingCell({ c }: { c: AdminClientListItem }) {
  const splits = c.splits_total ?? 0;
  const paid = c.splits_paid ?? 0;
  const overdue = c.splits_overdue ?? 0;
  const pending = c.splits_pending ?? 0;
  const totalAmt = c.splits_amount_cents ?? 0;
  const paidAmt = c.splits_paid_cents ?? 0;
  const directPaid = c.total_paid_cents ?? 0;

  if (splits > 0) {
    // All splits paid
    if (paid === splits && overdue === 0) {
      return (
        <div className="flex items-center gap-1.5 text-accent">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold leading-tight">Paid in full</p>
            <p className="text-[10px] opacity-70">
              {splits} installment{splits !== 1 ? "s" : ""} · {fmt(totalAmt)}
            </p>
          </div>
        </div>
      );
    }
    // Has overdue
    if (overdue > 0) {
      return (
        <div className="flex items-center gap-1.5 text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold leading-tight">
              {overdue} overdue
            </p>
            <p className="text-[10px] opacity-70">
              {paid}/{splits} paid · {fmt(paidAmt)}/{fmt(totalAmt)}
            </p>
          </div>
        </div>
      );
    }
    // In progress
    const pct = totalAmt > 0 ? Math.round((paidAmt / totalAmt) * 100) : 0;
    return (
      <div className="flex items-center gap-1.5 text-primary min-w-[120px]">
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-semibold leading-tight">
            {paid}/{splits} paid
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="flex-1 h-1 rounded-full bg-primary/15 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {fmt(paidAmt)}/{fmt(totalAmt)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // No split plan — one-time payment
  if (directPaid > 0) {
    return (
      <div className="flex items-center gap-1.5 text-accent">
        <CreditCard className="w-3.5 h-3.5 shrink-0" />
        <div>
          <p className="text-xs font-semibold leading-tight">Paid</p>
          <p className="text-[10px] opacity-70">{fmt(directPaid)}</p>
        </div>
      </div>
    );
  }

  return <span className="text-muted-foreground text-sm">—</span>;
}

const STAGES: (PipelineStage | "all")[] = [
  "all",
  "new_client",
  "docs_ready",
  "round_1",
  "round_2",
  "round_3",
  "round_4",
  "round_5",
  "completed",
  "cancelled",
];

const CLIENT_STATUSES = [
  "pending_payment",
  "onboarding",
  "active",
  "paused",
  "cancelled",
];

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  onboarding: "bg-primary/10 text-primary border-primary/20",
  active: "bg-accent/10 text-accent border-accent/20",
  paused: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
};

const clientSchema = Yup.object({
  first_name: Yup.string().trim().required("First name is required"),
  last_name: Yup.string().trim().required("Last name is required"),
  email: Yup.string().email("Invalid email").required("Email is required"),
  phone: Yup.string().trim(),
  status: Yup.string().oneOf(CLIENT_STATUSES),
  admin_notes: Yup.string().trim(),
});

function ClientFormDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: AdminClientListItem | null;
}) {
  const dispatch = useAppDispatch();
  const { saving } = useAppSelector((s) => s.admin);

  const form = useFormik({
    enableReinitialize: true,
    initialValues: {
      first_name: editing?.first_name ?? "",
      last_name: editing?.last_name ?? "",
      email: editing?.email ?? "",
      phone: editing?.phone ?? "",
      status: editing?.status ?? "pending_payment",
      admin_notes: editing?.admin_notes ?? "",
    },
    validationSchema: clientSchema,
    onSubmit: async (values, helpers) => {
      const payload = {
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        phone: values.phone || undefined,
        status: values.status as any,
        admin_notes: values.admin_notes.trim() || null,
      };
      if (editing) {
        await dispatch(updateAdminClient({ id: editing.id, ...payload }));
      } else {
        await dispatch(createAdminClient(payload));
      }
      helpers.resetForm();
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit client" : "Add new client"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-1">
                First name
              </label>
              <input
                {...form.getFieldProps("first_name")}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {form.touched.first_name && form.errors.first_name && (
                <p className="text-xs text-destructive mt-1">
                  {form.errors.first_name}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-1">
                Last name
              </label>
              <input
                {...form.getFieldProps("last_name")}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {form.touched.last_name && form.errors.last_name && (
                <p className="text-xs text-destructive mt-1">
                  {form.errors.last_name}
                </p>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-1">
              Email
            </label>
            <input
              type="email"
              {...form.getFieldProps("email")}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {form.touched.email && form.errors.email && (
              <p className="text-xs text-destructive mt-1">
                {form.errors.email}
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-1">
              Phone{" "}
              <span className="text-muted-foreground font-normal normal-case">
                (optional)
              </span>
            </label>
            <input
              type="tel"
              {...form.getFieldProps("phone")}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-1">
              Status
            </label>
            <select
              {...form.getFieldProps("status")}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s
                    .replace(/_/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase())}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-1">
              Internal notes{" "}
              <span className="text-muted-foreground font-normal normal-case">
                (admin only)
              </span>
            </label>
            <textarea
              {...form.getFieldProps("admin_notes")}
              rows={3}
              placeholder="Any internal notes about this client…"
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => {
                form.resetForm();
                onClose();
              }}
              className="h-9 px-4 rounded-lg border border-input bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={form.isSubmitting || saving}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {form.isSubmitting
                ? "Saving…"
                : editing
                  ? "Save changes"
                  : "Create client"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminClients() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { clients, loading } = useAppSelector((s) => s.admin);

  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    stage: "all",
    status: "all",
    language: "all",
    billing: "all",
    joined_from: "",
    joined_to: "",
    has_notes: "all",
  });
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"ASC" | "DESC">("DESC");
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] =
    useState<AdminClientListItem | null>(null);
  const [deletingClient, setDeletingClient] =
    useState<AdminClientListItem | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");

  const debouncedSearch = useDebounce(search, 300);

  const activeFilterCount = [
    filters.stage !== "all",
    filters.status !== "all",
    filters.language !== "all",
    filters.billing !== "all",
    filters.joined_from !== "",
    filters.joined_to !== "",
    filters.has_notes !== "all",
  ].filter(Boolean).length;

  const clearFilter = (key: keyof typeof filters) =>
    setFilters((f) => ({
      ...f,
      [key]: key === "joined_from" || key === "joined_to" ? "" : "all",
    }));

  const clearAllFilters = () =>
    setFilters({
      stage: "all",
      status: "all",
      language: "all",
      billing: "all",
      joined_from: "",
      joined_to: "",
      has_notes: "all",
    });

  useEffect(() => {
    dispatch(
      fetchAdminClients({
        search: debouncedSearch || undefined,
        stage: filters.stage === "all" ? undefined : filters.stage,
        status: filters.status === "all" ? undefined : filters.status,
        language: filters.language === "all" ? undefined : filters.language,
        billing: filters.billing === "all" ? undefined : filters.billing,
        joined_from: filters.joined_from || undefined,
        joined_to: filters.joined_to || undefined,
        has_notes: filters.has_notes === "all" ? undefined : filters.has_notes,
      }),
    );
  }, [dispatch, debouncedSearch, filters]);

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortBy(key);
      setSortDir("ASC");
    }
  };

  const handleDelete = async () => {
    if (!deletingClient) return;
    await dispatch(deleteAdminClient({ id: deletingClient.id }));
    setDeletingClient(null);
    setDeleteConfirmInput("");
  };

  const sorted = [...clients].sort((a, b) => {
    const av = (a as any)[sortBy] ?? "";
    const bv = (b as any)[sortBy] ?? "";
    const cmp = String(av).localeCompare(String(bv));
    return sortDir === "ASC" ? cmp : -cmp;
  });

  const columns: DataGridColumn<AdminClientListItem>[] = [
    {
      key: "first_name",
      label: "Name",
      sortable: true,
      sticky: true,
      render: (c) => (
        <div className="flex items-center gap-1.5">
          <Link
            to={`/admin/clients/${c.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium hover:text-primary transition-colors"
          >
            {c.first_name} {c.last_name}
          </Link>
          <LangBadge lang={c.preferred_language} />
        </div>
      ),
    },
    {
      key: "email",
      label: "Email",
      sortable: true,
      render: (c) => <span className="text-muted-foreground">{c.email}</span>,
    },
    {
      key: "package_name",
      label: "Package",
      sortable: true,
      render: (c) => (
        <span className="text-muted-foreground">{c.package_name ?? "—"}</span>
      ),
    },
    {
      key: "pipeline_stage",
      label: "Stage",
      sortable: true,
      shrink: true,
      render: (c) => (
        <span className="text-xs uppercase tracking-wide bg-primary/10 text-primary px-2 py-1 rounded-full border border-primary/20">
          {c.pipeline_stage.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      shrink: true,
      render: (c) => (
        <span
          className={`text-xs font-medium px-2 py-1 rounded-full border ${
            STATUS_COLORS[c.status] ??
            "bg-muted text-muted-foreground border-border"
          }`}
        >
          {c.status.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "splits_total" as any,
      label: "Billing",
      render: (c) => <BillingCell c={c} />,
    },
    {
      key: "created_at",
      label: "Joined",
      sortable: true,
      shrink: true,
      render: (c) => (
        <span className="text-muted-foreground text-sm">
          {new Date(c.created_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      ),
    },
    {
      key: "id" as any,
      label: "",
      shrink: true,
      render: (c) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground"
              aria-label="Client actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setEditingClient(c);
                setShowForm(true);
              }}
            >
              <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                setDeletingClient(c);
              }}
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Users}
        title="Clients"
        description="Manage and search all client accounts."
        actions={
          <button
            onClick={() => {
              setEditingClient(null);
              setShowForm(true);
            }}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add client
          </button>
        }
      />

      {/* ── Search + filter toggle ─────────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or phone…"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex items-center gap-2 h-10 px-4 rounded-lg border text-sm font-medium transition-colors ${
            showFilters || activeFilterCount > 0
              ? "bg-primary text-primary-foreground border-primary"
              : "border-input bg-background text-foreground hover:bg-muted"
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-0.5 h-5 min-w-5 px-1 rounded-full bg-white/20 text-[11px] font-bold flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${showFilters ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* ── Advanced filter panel ──────────────────────────────── */}
      {showFilters && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* Stage */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                Pipeline Stage
              </label>
              <div className="relative">
                <select
                  value={filters.stage}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, stage: e.target.value }))
                  }
                  className="w-full h-9 pl-3 pr-7 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="all">All stages</option>
                  {STAGES.filter((s) => s !== "all").map((s) => (
                    <option key={s} value={s}>
                      {s
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase())}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">
                Account Status
              </label>
              <div className="relative">
                <select
                  value={filters.status}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, status: e.target.value }))
                  }
                  className="w-full h-9 pl-3 pr-7 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="all">All statuses</option>
                  {CLIENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase())}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* Language */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Globe2 className="w-3 h-3" /> Language
              </label>
              <div className="relative">
                <select
                  value={filters.language}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, language: e.target.value }))
                  }
                  className="w-full h-9 pl-3 pr-7 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="all">All languages</option>
                  <option value="en">English (EN)</option>
                  <option value="es">Spanish (ES)</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* Billing */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <CreditCard className="w-3 h-3" /> Billing
              </label>
              <div className="relative">
                <select
                  value={filters.billing}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, billing: e.target.value }))
                  }
                  className="w-full h-9 pl-3 pr-7 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="all">All</option>
                  <option value="split_plan">Split plan</option>
                  <option value="overdue">Has overdue</option>
                  <option value="paid_full">Paid in full</option>
                  <option value="direct_paid">Direct paid</option>
                  <option value="no_payment">No payment</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* Joined from */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <CalendarDays className="w-3 h-3" /> Joined from
              </label>
              <input
                type="date"
                value={filters.joined_from}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, joined_from: e.target.value }))
                }
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Joined to */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <CalendarDays className="w-3 h-3" /> Joined to
              </label>
              <input
                type="date"
                value={filters.joined_to}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, joined_to: e.target.value }))
                }
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {/* Has notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> Internal notes
              </label>
              <div className="relative">
                <select
                  value={filters.has_notes}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, has_notes: e.target.value }))
                  }
                  className="w-full h-9 pl-3 pr-7 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="all">Any</option>
                  <option value="yes">Has notes</option>
                  <option value="no">No notes</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* Clear all */}
            {activeFilterCount > 0 && (
              <div className="flex items-end">
                <button
                  onClick={clearAllFilters}
                  className="h-9 px-4 rounded-lg border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors flex items-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" /> Clear all
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Active filter chips ───────────────────────────────── */}
      {activeFilterCount > 0 &&
        (() => {
          const STAGE_LABELS: Record<string, string> = {
            new_client: "New Client",
            docs_ready: "Docs Ready",
            round_1: "Round 1",
            round_2: "Round 2",
            round_3: "Round 3",
            round_4: "Round 4",
            round_5: "Round 5",
            completed: "Completed",
            cancelled: "Cancelled",
          };
          const BILLING_LABELS: Record<string, string> = {
            split_plan: "Split Plan",
            overdue: "Has Overdue",
            paid_full: "Paid in Full",
            direct_paid: "Direct Paid",
            no_payment: "No Payment",
          };
          const chips: { key: keyof typeof filters; label: string }[] = [];
          if (filters.stage !== "all")
            chips.push({
              key: "stage",
              label: `Stage: ${STAGE_LABELS[filters.stage] ?? filters.stage}`,
            });
          if (filters.status !== "all")
            chips.push({
              key: "status",
              label: `Status: ${filters.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
            });
          if (filters.language !== "all")
            chips.push({
              key: "language",
              label: `Language: ${filters.language === "en" ? "English" : "Spanish"}`,
            });
          if (filters.billing !== "all")
            chips.push({
              key: "billing",
              label: `Billing: ${BILLING_LABELS[filters.billing] ?? filters.billing}`,
            });
          if (filters.joined_from)
            chips.push({
              key: "joined_from",
              label: `From: ${filters.joined_from}`,
            });
          if (filters.joined_to)
            chips.push({ key: "joined_to", label: `To: ${filters.joined_to}` });
          if (filters.has_notes !== "all")
            chips.push({
              key: "has_notes",
              label: filters.has_notes === "yes" ? "Has Notes" : "No Notes",
            });
          return (
            <div className="flex flex-wrap gap-2">
              {chips.map(({ key, label }) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 h-7 pl-3 pr-2 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-medium"
                >
                  {label}
                  <button
                    onClick={() => clearFilter(key)}
                    className="hover:text-primary/60 transition-colors"
                    aria-label={`Remove ${label} filter`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          );
        })()}

      <div className="bg-card rounded-2xl border border-border px-6 py-4">
        <DataGrid
          data={sorted}
          columns={columns}
          rowKey={(c) => c.id}
          isLoading={loading}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          onRowClick={(c) => navigate(`/admin/clients/${c.id}`)}
          emptyMessage="No clients found."
        />
      </div>

      <ClientFormDialog
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingClient(null);
        }}
        editing={editingClient}
      />

      <AlertDialog
        open={!!deletingClient}
        onOpenChange={(v) => {
          if (!v) {
            setDeletingClient(null);
            setDeleteConfirmInput("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete client?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  You are about to permanently delete{" "}
                  <strong>
                    {deletingClient?.first_name} {deletingClient?.last_name}
                  </strong>{" "}
                  ({deletingClient?.email}). This cannot be undone.
                </p>

                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive space-y-1">
                  <p className="font-semibold">
                    ⚠️ The following will be deleted from this system:
                  </p>
                  <ul className="list-disc list-inside space-y-0.5 text-destructive/90">
                    <li>All payments &amp; billing history</li>
                    <li>All documents &amp; contracts</li>
                    <li>All support tickets &amp; conversations</li>
                    <li>All pipeline history &amp; round reports</li>
                    <li>All AI sessions &amp; notifications</li>
                    <li>All login sessions &amp; OTP codes</li>
                  </ul>
                </div>

                {deletingClient?.crc_client_id && (
                  <div className="rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-amber-700 dark:text-amber-400 space-y-1">
                    <p className="font-semibold">
                      ⚠️ Credit Repair Cloud — manual action required
                    </p>
                    <p>
                      This client is synced to CRC (ID:{" "}
                      <code className="font-mono">
                        {deletingClient.crc_client_id}
                      </code>
                      ). Deleting here will <strong>not</strong> remove them
                      from Credit Repair Cloud. You must delete or archive them
                      manually in CRC to keep both systems in sync.
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="text-muted-foreground">
                    Type{" "}
                    <strong className="text-foreground font-mono">
                      {deletingClient?.first_name} {deletingClient?.last_name}
                    </strong>{" "}
                    to confirm:
                  </p>
                  <input
                    type="text"
                    value={deleteConfirmInput}
                    onChange={(e) => setDeleteConfirmInput(e.target.value)}
                    placeholder={`${deletingClient?.first_name} ${deletingClient?.last_name}`}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-destructive focus:ring-offset-2"
                    autoComplete="off"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={
                deleteConfirmInput.trim() !==
                `${deletingClient?.first_name} ${deletingClient?.last_name}`
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Yes, delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

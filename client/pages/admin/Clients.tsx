import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Search,
  Users,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { useFormik } from "formik";
import * as Yup from "yup";
import AdminPageHeader from "@/components/AdminPageHeader";
import { DataGrid } from "@/components/ui/data-grid";
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
import type { AdminClientListItem, PipelineStage } from "@shared/api";

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
    },
    validationSchema: clientSchema,
    onSubmit: async (values, helpers) => {
      const payload = {
        first_name: values.first_name,
        last_name: values.last_name,
        email: values.email,
        phone: values.phone || undefined,
        status: values.status as any,
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
  const [stage, setStage] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"ASC" | "DESC">("DESC");
  const [showForm, setShowForm] = useState(false);
  const [editingClient, setEditingClient] =
    useState<AdminClientListItem | null>(null);
  const [deletingClient, setDeletingClient] =
    useState<AdminClientListItem | null>(null);

  useEffect(() => {
    dispatch(
      fetchAdminClients({
        stage: stage === "all" ? undefined : stage,
        search: search || undefined,
      }),
    );
  }, [dispatch, stage, search]);

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
        <Link
          to={`/admin/clients/${c.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium hover:text-primary transition-colors"
        >
          {c.first_name} {c.last_name}
        </Link>
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
        <div className="relative">
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="h-10 pl-3 pr-8 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s === "all"
                  ? "All stages"
                  : s
                      .replace(/_/g, " ")
                      .replace(/\b\w/g, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
      </div>

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
        onOpenChange={(v) => !v && setDeletingClient(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <strong>
                {deletingClient?.first_name} {deletingClient?.last_name}
              </strong>{" "}
              and all associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  ShieldCheck,
  Headphones,
  Crown,
  Search,
  ChevronDown,
} from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { useFormik } from "formik";
import * as Yup from "yup";
import AdminPageHeader from "@/components/AdminPageHeader";
import { DataGrid } from "@/components/ui/data-grid";
import type { DataGridColumn } from "@/components/ui/data-grid";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAdminTeam,
  createAdminTeamMember,
  updateAdminTeamMember,
  deleteAdminTeamMember,
} from "@/store/slices/adminSlice";
import type { AdminUserListItem } from "@shared/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<
  string,
  { label: string; className: string; Icon: typeof ShieldCheck }
> = {
  super_admin: {
    label: "Super Admin",
    className: "bg-accent/10 text-accent border-accent/30",
    Icon: Crown,
  },
  admin: {
    label: "Admin",
    className: "bg-primary/10 text-primary border-primary/30",
    Icon: ShieldCheck,
  },
  agent: {
    label: "Agent",
    className: "bg-muted text-muted-foreground border-border",
    Icon: Headphones,
  },
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "bg-accent/10 text-accent border-accent/30",
  },
  inactive: {
    label: "Inactive",
    className: "bg-muted text-muted-foreground border-border",
  },
  suspended: {
    label: "Suspended",
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
};

function fmtDate(s?: string | null) {
  if (!s) return "Never";
  return new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const memberSchema = Yup.object({
  email: Yup.string().email("Invalid email").required("Required"),
  first_name: Yup.string().required("Required"),
  last_name: Yup.string().required("Required"),
  phone: Yup.string(),
  role: Yup.string().required("Required"),
  status: Yup.string().required("Required"),
});

type MemberForm = {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: string;
  status: string;
};

// ─── Member dialog ────────────────────────────────────────────────────────────

function MemberDialog({
  open,
  onClose,
  onSubmit,
  initial,
  isEdit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (vals: MemberForm) => Promise<void>;
  initial?: Partial<MemberForm>;
  isEdit?: boolean;
}) {
  const form = useFormik<MemberForm>({
    enableReinitialize: true,
    initialValues: {
      email: initial?.email ?? "",
      first_name: initial?.first_name ?? "",
      last_name: initial?.last_name ?? "",
      phone: initial?.phone ?? "",
      role: initial?.role ?? "admin",
      status: initial?.status ?? "active",
    },
    validationSchema: memberSchema,
    onSubmit: async (vals, { resetForm }) => {
      await onSubmit(vals);
      resetForm();
      onClose();
    },
  });

  const inputClass =
    "w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50";
  const errClass = "text-xs text-destructive mt-0.5";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>
          {isEdit ? "Edit team member" : "Add team member"}
        </DialogTitle>
        <form onSubmit={form.handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                First name
              </label>
              <input
                className={inputClass}
                {...form.getFieldProps("first_name")}
              />
              {form.touched.first_name && form.errors.first_name && (
                <p className={errClass}>{form.errors.first_name}</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Last name
              </label>
              <input
                className={inputClass}
                {...form.getFieldProps("last_name")}
              />
              {form.touched.last_name && form.errors.last_name && (
                <p className={errClass}>{form.errors.last_name}</p>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Email
            </label>
            <input
              className={inputClass}
              type="email"
              disabled={isEdit}
              {...form.getFieldProps("email")}
            />
            {form.touched.email && form.errors.email && (
              <p className={errClass}>{form.errors.email}</p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Phone (optional)
            </label>
            <input
              className={inputClass}
              type="tel"
              {...form.getFieldProps("phone")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Role
              </label>
              <select className={inputClass} {...form.getFieldProps("role")}>
                <option value="super_admin">Super Admin</option>
                <option value="admin">Admin</option>
                <option value="agent">Agent</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Status
              </label>
              <select className={inputClass} {...form.getFieldProps("status")}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>

          {/* Role permission legend */}
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Role permissions
            </p>
            {[
              {
                role: "super_admin",
                label: "Super Admin",
                className: "bg-accent/10 text-accent border-accent/30",
                Icon: Crown,
                perms: [
                  "Full access",
                  "Team management",
                  "Reports & revenue",
                  "Settings",
                  "Document review",
                  "Send round reports",
                ],
              },
              {
                role: "admin",
                label: "Admin",
                className: "bg-primary/10 text-primary border-primary/30",
                Icon: ShieldCheck,
                perms: [
                  "Clients & pipeline",
                  "Conversations & tickets",
                  "Templates & videos",
                ],
              },
              {
                role: "agent",
                label: "Agent",
                className: "bg-muted text-muted-foreground border-border",
                Icon: Headphones,
                perms: [
                  "Clients & pipeline",
                  "Conversations & tickets",
                  "Templates & videos",
                ],
              },
            ].map(({ role, label, className, Icon, perms }) => (
              <div
                key={role}
                className={`rounded-md p-2 transition-all border ${
                  form.values.role === role
                    ? `${className} opacity-100`
                    : "border-transparent opacity-40"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-3 h-3" />
                  <span className="text-xs font-semibold">{label}</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  {perms.join(" · ")}
                </p>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.isSubmitting}>
              {isEdit ? "Save changes" : "Add member"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete confirmation ──────────────────────────────────────────────────────

function DeleteDialog({
  member,
  onClose,
  onConfirm,
}: {
  member: AdminUserListItem | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  return (
    <Dialog open={!!member} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Remove team member</DialogTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Are you sure you want to permanently remove{" "}
          <strong>
            {member?.first_name} {member?.last_name}
          </strong>
          ? This cannot be undone.
        </p>
        <div className="flex gap-2 justify-end mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              await onConfirm();
              setLoading(false);
            }}
          >
            Remove
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminPeople() {
  const dispatch = useAppDispatch();
  const { team, loading } = useAppSelector((s) => s.admin);
  const me = useAppSelector((s) => s.adminAuth.user);
  const isSuperAdmin = me?.role === "super_admin";

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const debouncedSearch = useDebounce(search, 350);

  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"ASC" | "DESC">("DESC");
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUserListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserListItem | null>(
    null,
  );

  const teamParams = {
    search: debouncedSearch || undefined,
    role: roleFilter === "all" ? undefined : roleFilter,
  };

  useEffect(() => {
    dispatch(fetchAdminTeam(teamParams));
  }, [dispatch, debouncedSearch, roleFilter]);

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortBy(key);
      setSortDir("ASC");
    }
  };

  const sorted = [...team].sort((a, b) => {
    const av = (a as any)[sortBy] ?? "";
    const bv = (b as any)[sortBy] ?? "";
    const cmp = String(av).localeCompare(String(bv));
    return sortDir === "ASC" ? cmp : -cmp;
  });

  const columns: DataGridColumn<AdminUserListItem>[] = [
    {
      key: "first_name",
      label: "Name",
      sortable: true,
      sticky: true,
      render: (m) => (
        <div>
          <div className="font-medium">
            {m.first_name} {m.last_name}
          </div>
          <div className="text-xs text-muted-foreground">{m.email}</div>
        </div>
      ),
    },
    {
      key: "role",
      label: "Role",
      sortable: true,
      shrink: true,
      render: (m) => {
        const cfg = ROLE_CONFIG[m.role] ?? ROLE_CONFIG.agent;
        return (
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}
          >
            <cfg.Icon className="w-3 h-3" />
            {cfg.label}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      shrink: true,
      render: (m) => {
        const cfg = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.inactive;
        return (
          <span
            className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}
          >
            {cfg.label}
          </span>
        );
      },
    },
    {
      key: "last_login_at",
      label: "Last login",
      sortable: true,
      shrink: true,
      render: (m) => (
        <span className="text-sm text-muted-foreground">
          {fmtDate(m.last_login_at)}
        </span>
      ),
    },
    {
      key: "created_at",
      label: "Added",
      sortable: true,
      shrink: true,
      render: (m) => (
        <span className="text-sm text-muted-foreground">
          {fmtDate(m.created_at)}
        </span>
      ),
    },
    ...(isSuperAdmin
      ? [
          {
            key: "_actions",
            label: "",
            shrink: true,
            render: (m: AdminUserListItem) => (
              <div className="flex items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditTarget(m);
                  }}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {m.id !== me?.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(m);
                    }}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ),
          } as DataGridColumn<AdminUserListItem>,
        ]
      : []),
  ];

  const handleCreate = async (vals: MemberForm) => {
    await dispatch(createAdminTeamMember(vals));
    dispatch(fetchAdminTeam(teamParams));
  };

  const handleUpdate = async (vals: MemberForm) => {
    if (!editTarget) return;
    await dispatch(
      updateAdminTeamMember({
        id: editTarget.id,
        first_name: vals.first_name,
        last_name: vals.last_name,
        phone: vals.phone,
        role: vals.role,
        status: vals.status,
      }),
    );
    dispatch(fetchAdminTeam(teamParams));
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await dispatch(deleteAdminTeamMember({ id: deleteTarget.id }));
    setDeleteTarget(null);
    dispatch(fetchAdminTeam(teamParams));
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Users}
        title="People"
        description="Manage team members and their access roles."
        actions={
          isSuperAdmin ? (
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add member
            </Button>
          ) : undefined
        }
      />

      {/* Search + role filter */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="relative">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-10 pl-3 pr-8 rounded-lg border border-input bg-background text-sm text-foreground appearance-none focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
          >
            <option value="all">All roles</option>
            {Object.entries(ROLE_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>
                {cfg.label}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
        <div className="ml-auto text-xs text-muted-foreground self-center whitespace-nowrap">
          {team.length} member{team.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Grid */}
      <div className="bg-card rounded-2xl border border-border px-6 py-4">
        <DataGrid
          data={sorted}
          columns={columns}
          rowKey={(m) => m.id}
          isLoading={loading}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          emptyMessage="No team members found."
        />
      </div>

      {/* Add dialog */}
      <MemberDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
      />

      {/* Edit dialog */}
      <MemberDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={handleUpdate}
        initial={editTarget ?? undefined}
        isEdit
      />

      {/* Delete dialog */}
      <DeleteDialog
        member={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

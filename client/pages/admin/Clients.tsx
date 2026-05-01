import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Users } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminClients } from "@/store/slices/adminSlice";
import type { PipelineStage } from "@shared/api";

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

export default function AdminClients() {
  const dispatch = useAppDispatch();
  const { clients } = useAppSelector((s) => s.admin);
  const [stage, setStage] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    dispatch(
      fetchAdminClients({
        stage: stage === "all" ? undefined : stage,
        search: search || undefined,
      }),
    );
  }, [dispatch, stage, search]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Users}
        title="Clients"
        description="Manage and search all client accounts."
      />

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or phone…"
            className="w-full h-11 pl-10 pr-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {STAGES.map((s) => (
            <button
              key={s}
              onClick={() => setStage(s)}
              className={`px-3 h-9 rounded-lg text-xs font-medium uppercase tracking-wide whitespace-nowrap transition-colors ${
                stage === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {s.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
            <tr>
              <th className="text-left p-3 font-semibold">Name</th>
              <th className="text-left p-3 font-semibold hidden md:table-cell">
                Email
              </th>
              <th className="text-left p-3 font-semibold hidden lg:table-cell">
                Package
              </th>
              <th className="text-left p-3 font-semibold">Stage</th>
              <th className="text-left p-3 font-semibold hidden sm:table-cell">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="text-center p-10 text-muted-foreground"
                >
                  No clients
                </td>
              </tr>
            ) : (
              clients.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-border/50 hover:bg-muted/30"
                >
                  <td className="p-3">
                    <Link
                      to={`/admin/clients/${c.id}`}
                      className="font-medium hover:text-primary"
                    >
                      {c.first_name} {c.last_name}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground hidden md:table-cell">
                    {c.email}
                  </td>
                  <td className="p-3 text-muted-foreground hidden lg:table-cell">
                    {c.package_name || "—"}
                  </td>
                  <td className="p-3">
                    <span className="text-xs uppercase tracking-wide bg-primary/10 text-primary px-2 py-1 rounded-full">
                      {c.pipeline_stage.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground hidden sm:table-cell">
                    {c.status}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

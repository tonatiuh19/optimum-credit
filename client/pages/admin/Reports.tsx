import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { DataGrid } from "@/components/ui/data-grid";
import type { DataGridColumn } from "@/components/ui/data-grid";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminReports } from "@/store/slices/adminSlice";

export default function AdminReports() {
  const dispatch = useAppDispatch();
  const { reports } = useAppSelector((s) => s.admin);

  useEffect(() => {
    dispatch(fetchAdminReports());
  }, [dispatch]);

  const totalRev = reports.revenueByMonth.reduce(
    (a: number, b: any) => a + Number(b.total || 0),
    0,
  );
  const totalSignups = reports.signupsByMonth.reduce(
    (a: number, b: any) => a + Number(b.count || 0),
    0,
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={BarChart3}
        title="Reports"
        description="Revenue, signups, and package performance."
      />

      <div className="grid sm:grid-cols-2 gap-4">
        <Card title="Revenue by month">
          <BarChart
            data={reports.revenueByMonth.map((m: any) => ({
              label: m.month,
              value: Number(m.total || 0) / 100,
            }))}
            format={(v) => `$${v.toLocaleString()}`}
          />
          <p className="text-xs text-muted-foreground mt-3">
            Total: ${(totalRev / 100).toLocaleString()}
          </p>
        </Card>
        <Card title="Signups by month">
          <BarChart
            data={reports.signupsByMonth.map((m: any) => ({
              label: m.month,
              value: Number(m.count || 0),
            }))}
          />
          <p className="text-xs text-muted-foreground mt-3">
            Total: {totalSignups}
          </p>
        </Card>
      </div>

      <Card title="Package breakdown">
        <PackageBreakdownGrid data={reports.packageBreakdown} />
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: any }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <h2 className="font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}

function BarChart({
  data,
  format = (v: number) => String(v),
}: {
  data: { label: string; value: number }[];
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0)
    return <div className="text-sm text-muted-foreground">No data.</div>;
  return (
    <div className="flex items-end gap-2 h-40">
      {data.map((d, i) => (
        <div
          key={i}
          className="flex-1 flex flex-col items-center justify-end gap-1"
        >
          <div
            className="w-full bg-gradient-to-t from-primary to-primary-200 rounded-t"
            style={{ height: `${(d.value / max) * 100}%` }}
            title={format(d.value)}
          />
          <span className="text-[10px] text-muted-foreground">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function PackageBreakdownGrid({ data }: { data: any[] }) {
  const [sortBy, setSortBy] = useState("sold");
  const [sortDir, setSortDir] = useState<"ASC" | "DESC">("DESC");

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortBy(key);
      setSortDir("ASC");
    }
  };

  const sorted = [...data].sort((a, b) => {
    const av = Number(a[sortBy] ?? 0);
    const bv = Number(b[sortBy] ?? 0);
    return sortDir === "ASC" ? av - bv : bv - av;
  });

  const columns: DataGridColumn<any>[] = [
    {
      key: "package_name",
      label: "Package",
      sortable: true,
      render: (p) => <span className="font-medium">{p.package_name}</span>,
    },
    {
      key: "sold",
      label: "Sold",
      sortable: true,
      shrink: true,
      render: (p) => (
        <span className="font-semibold text-primary">{p.sold}</span>
      ),
    },
    {
      key: "revenue",
      label: "Revenue",
      sortable: true,
      shrink: true,
      render: (p) => (
        <span className="font-semibold text-accent">
          ${(Number(p.revenue || 0) / 100).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <DataGrid
      data={sorted}
      columns={columns}
      rowKey={(p) => p.package_id ?? p.package_name}
      sortBy={sortBy}
      sortDir={sortDir}
      onSort={handleSort}
      emptyMessage="No package data yet."
      noBleeding
    />
  );
}

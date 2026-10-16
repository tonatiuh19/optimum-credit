/**
 * Pure helpers for Clients CSV export (unit-tested).
 * Keep escape/build in sync with inline copy in api/index.ts.
 */

export const ADMIN_CLIENTS_EXPORT_MAX_ROWS = 20_000;

export type AdminClientExportRow = {
  id: number;
  first_name: string;
  last_name: string;
  status: string;
  pipeline_stage: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string | Date | null;
};

export function csvEscapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function formatClientExportDate(
  value: string | Date | null | undefined,
): string {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 32);
  return d.toISOString().slice(0, 10);
}

export function buildAdminClientsExportCsv(
  rows: AdminClientExportRow[],
): string {
  const headers = [
    "client_id",
    "first_name",
    "last_name",
    "name",
    "status",
    "pipeline_stage",
    "email",
    "phone",
    "created_at",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const first = String(r.first_name || "").trim();
    const last = String(r.last_name || "").trim();
    const name = `${first} ${last}`.trim();
    lines.push(
      [
        r.id,
        first,
        last,
        name,
        r.status || "",
        r.pipeline_stage || "",
        r.email || "",
        r.phone || "",
        formatClientExportDate(r.created_at),
      ]
        .map(csvEscapeCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function clientsExportFilename(now: Date = new Date()): string {
  const ymd = now.toISOString().slice(0, 10);
  return `ofg-clients-${ymd}.csv`;
}

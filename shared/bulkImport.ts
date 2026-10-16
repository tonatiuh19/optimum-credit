/**
 * Client-side helpers for bulk CSV import (UI preview/reports).
 * API parse/validate lives inline in api/index.ts (Vercel serverless).
 */

export type BulkImportRowStatus = "will_create" | "skipped" | "error";
export type BulkImportTableFilter = "all" | "ready" | "skipped" | "error";

export const BULK_IMPORT_ACK_THRESHOLD = 100;
export const BULK_IMPORT_MAX_CLIENT_ROWS = 500;
export const BULK_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface BulkImportRowPreview {
  row_number: number;
  status: BulkImportRowStatus;
  message?: string;
  external_ref?: string | null;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  badge?: string | null;
  conflict_entity_id?: number | null;
}

export function filterPreviewRows(
  rows: BulkImportRowPreview[],
  filter: BulkImportTableFilter,
  search: string,
): BulkImportRowPreview[] {
  let out = rows;
  if (filter === "ready") out = out.filter((r) => r.status === "will_create");
  else if (filter === "skipped")
    out = out.filter((r) => r.status === "skipped");
  else if (filter === "error") out = out.filter((r) => r.status === "error");

  const q = search.trim().toLowerCase();
  if (!q) return out;

  return out.filter((r) => {
    const hay = [
      r.display_name,
      r.email,
      r.phone,
      r.external_ref,
      r.badge,
      r.message,
      String(r.row_number),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function csvEscapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildPreviewReportCsv(rows: BulkImportRowPreview[]): string {
  const headers = [
    "row_number",
    "status",
    "display_name",
    "email",
    "phone",
    "badge",
    "message",
    "external_ref",
    "conflict_entity_id",
  ];
  const lines = [
    headers.join(","),
    ...rows
      .filter((r) => r.status !== "will_create")
      .map((r) =>
        [
          r.row_number,
          r.status,
          r.display_name,
          r.email ?? "",
          r.phone ?? "",
          r.badge ?? "",
          r.message ?? "",
          r.external_ref ?? "",
          r.conflict_entity_id ?? "",
        ]
          .map(csvEscapeCell)
          .join(","),
      ),
  ];
  return lines.join("\n");
}

export interface BulkImportResultCsvRow {
  row_number: number;
  external_ref?: string | null;
  status: string;
  entity_id?: number | null;
  message?: string;
}

export function buildCommitResultsCsv(rows: BulkImportResultCsvRow[]): string {
  const headers = [
    "row_number",
    "status",
    "entity_id",
    "external_ref",
    "message",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.row_number,
        r.status,
        r.entity_id ?? "",
        r.external_ref ?? "",
        r.message ?? "",
      ]
        .map(csvEscapeCell)
        .join(","),
    ),
  ];
  return lines.join("\n");
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

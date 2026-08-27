/**
 * Import GoHighLevel / CRM opportunities export into OFG clients + cases.
 *
 *   npx tsx scripts/import-ghl-opportunities.ts /path/to/opportunities.csv
 *   npx tsx scripts/import-ghl-opportunities.ts /path/to/opportunities.csv --commit
 *
 * Default is dry-run (no writes). Respects GHL `stage` → OFG pipeline_stage.
 */
import "dotenv/config";
import fs from "fs";
import mysql, { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

type PipelineStage =
  | "new_client"
  | "docs_ready"
  | "round_1"
  | "round_2"
  | "round_3"
  | "round_4"
  | "round_5"
  | "completed";

interface MappedRow {
  rowNumber: number;
  oppId: string;
  contactId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  phoneLast10: string | null;
  pipelineStage: PipelineStage;
  clientStatus: "active" | "paused";
  caseStatus: "active" | "on_hold" | "completed";
  packageId: number | null;
  packageSlug: string | null;
  assignedAdminId: number | null;
  adminNotes: string;
  ghlStage: string;
  source: string;
  action: "create" | "skip" | "error";
  message?: string;
  existingClientId?: number;
}

const PACKAGE_BY_VALUE: Record<number, string> = {
  1497: "standard",
  2497: "complex",
  400: "inquiries_removal",
  500: "tradeline",
  50: "peace_of_mind",
};

const ADMIN_BY_ASSIGNEE: Record<string, number> = {
  "cesar gom": 90001,
  "cesar gomez": 90001,
  "lecca credit": 150002,
  "lecca bustamante": 150002,
  "angel alvarez": 120001,
};

const DEFAULT_ADMIN_EN = 150002;
const DEFAULT_ADMIN_ES = 120001;

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && next === "\n")) {
      if (ch === "\r") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const out: Record<string, string> = {};
    headers.forEach((h, idx) => {
      out[h] = (cells[idx] ?? "").trim();
    });
    return out;
  });
}

function normalizePhoneLast10(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function formatPhone(raw: string | null): string | null {
  const last10 = normalizePhoneLast10(raw);
  if (!last10) return raw?.trim() || null;
  return `+1${last10}`;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "Unknown", lastName: "Client" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "—" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function roundFromTags(tags: string): PipelineStage | null {
  const t = tags.toLowerCase();
  for (let n = 5; n >= 1; n--) {
    if (t.includes(`round ${n}`) || t.includes(`round_${n}`)) {
      return `round_${n}` as PipelineStage;
    }
  }
  if (t.includes("docs ready")) return "docs_ready";
  if (t.includes("graduated") || t.includes("completed")) return "completed";
  return null;
}

function mapGhlStage(
  stage: string,
  tags: string,
): {
  pipelineStage: PipelineStage;
  clientStatus: "active" | "paused";
  caseStatus: "active" | "on_hold" | "completed";
} {
  const s = stage.trim().toUpperCase();
  const tagStage = roundFromTags(tags);

  if (s === "GRADUATED") {
    return {
      pipelineStage: "completed",
      clientStatus: "active",
      caseStatus: "completed",
    };
  }
  if (s === "ON HOLD") {
    return {
      pipelineStage: tagStage || "docs_ready",
      clientStatus: "paused",
      caseStatus: "on_hold",
    };
  }
  const roundMatch = s.match(/^ROUND\s+(\d)\s+OUT!?$/);
  if (roundMatch) {
    const n = Number(roundMatch[1]);
    if (n >= 1 && n <= 5) {
      return {
        pipelineStage: `round_${n}` as PipelineStage,
        clientStatus: "active",
        caseStatus: "active",
      };
    }
  }
  if (s.startsWith("DOCS READY")) {
    return {
      pipelineStage: "docs_ready",
      clientStatus: "active",
      caseStatus: "active",
    };
  }
  if (s === "FULL 3 BUREAU SWEEP") {
    return {
      pipelineStage: tagStage || "new_client",
      clientStatus: "active",
      caseStatus: "active",
    };
  }
  if (s === "INVALID LOGINS" || s === "NEEDS NEW REPORT") {
    return {
      pipelineStage: tagStage || "docs_ready",
      clientStatus: "active",
      caseStatus: "active",
    };
  }
  if (s === "TRADELINE") {
    return {
      pipelineStage: tagStage || "docs_ready",
      clientStatus: "active",
      caseStatus: "active",
    };
  }
  if (s === "PREMIUM PLAN" || s === "ADVANCE PLAN") {
    return {
      pipelineStage: "new_client",
      clientStatus: "active",
      caseStatus: "active",
    };
  }
  return {
    pipelineStage: tagStage || "new_client",
    clientStatus: "active",
    caseStatus: "active",
  };
}

function resolvePackage(
  leadValueRaw: string,
  source: string,
  oppName: string,
): { packageId: number | null; packageSlug: string | null } {
  const src = `${source} ${oppName}`.toLowerCase();
  if (src.includes("tradeline")) return { packageSlug: "tradeline", packageId: null };
  if (src.includes("inquir")) return { packageSlug: "inquiries_removal", packageId: null };
  if (src.includes("complex")) return { packageSlug: "complex", packageId: null };
  if (src.includes("peace of mind")) return { packageSlug: "peace_of_mind", packageId: null };
  const val = Number(leadValueRaw);
  if (Number.isFinite(val) && val > 0) {
    const slug = PACKAGE_BY_VALUE[val];
    if (slug) return { packageSlug: slug, packageId: null };
  }
  if (src.includes("standard") || src.includes("full 3 bureau") || src.includes("bureau sweep")) {
    return { packageSlug: "standard", packageId: null };
  }
  return { packageSlug: null, packageId: null };
}

function resolveAssignee(assigned: string, preferredLanguage: "en" | "es"): number {
  const key = assigned.trim().toLowerCase();
  if (key && ADMIN_BY_ASSIGNEE[key]) return ADMIN_BY_ASSIGNEE[key];
  return preferredLanguage === "es" ? DEFAULT_ADMIN_ES : DEFAULT_ADMIN_EN;
}

async function loadPackageIds(pool: Pool): Promise<Map<string, number>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, slug FROM packages`,
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(String(r.slug), Number(r.id));
  return map;
}

async function buildDuplicateMaps(pool: Pool): Promise<{
  byEmail: Map<string, number>;
  byPhone: Map<string, number>;
  byOpp: Map<string, number>;
}> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, phone, admin_notes FROM clients`,
  );
  const byEmail = new Map<string, number>();
  const byPhone = new Map<string, number>();
  const byOpp = new Map<string, number>();
  for (const r of rows) {
    const id = Number(r.id);
    if (r.email) byEmail.set(String(r.email).toLowerCase(), id);
    const p10 = normalizePhoneLast10(String(r.phone || ""));
    if (p10) byPhone.set(p10, id);
    const notes = String(r.admin_notes || "");
    const m = notes.match(/opp_id=([A-Za-z0-9]+)/);
    if (m) byOpp.set(m[1], id);
  }
  return { byEmail, byPhone, byOpp };
}

function mapCsvRow(
  raw: Record<string, string>,
  rowNumber: number,
  pkgMap: Map<string, number>,
): MappedRow {
  const contactName = raw["Contact Name"] || raw["Opportunity name"] || "";
  const { firstName, lastName } = splitName(contactName);
  const email = (raw.email || "").trim().toLowerCase() || null;
  const phone = formatPhone(raw.phone || null);
  const phoneLast10 = normalizePhoneLast10(phone);
  const ghlStage = raw.stage || "";
  const tags = raw.tags || "";
  const source = raw.source || "";
  const oppId = raw["Opportunity ID"] || "";
  const contactId = raw["Contact ID"] || "";
  const assigned = raw.assigned || "";
  const leadValue = raw["Lead Value"] || "0";

  const mapped = mapGhlStage(ghlStage, tags);
  let { packageSlug } = resolvePackage(leadValue, source, raw["Opportunity name"] || "");
  let packageId: number | null = packageSlug ? pkgMap.get(packageSlug) ?? null : null;
  if (packageSlug && !packageId) packageSlug = null;

  const preferredLanguage: "en" | "es" = "en";
  const assignedAdminId = resolveAssignee(assigned, preferredLanguage);

  const noteParts = [
    `[GHL import] opp_id=${oppId || "?"}`,
    contactId ? `contact_id=${contactId}` : null,
    `ghl_stage=${ghlStage.trim()}`,
    source ? `source=${source}` : null,
    tags ? `tags=${tags}` : null,
    raw.Notes ? `notes=${raw.Notes.slice(0, 500)}` : null,
  ].filter(Boolean);

  const row: MappedRow = {
    rowNumber,
    oppId,
    contactId,
    firstName,
    lastName,
    email,
    phone,
    phoneLast10,
    pipelineStage: mapped.pipelineStage,
    clientStatus: mapped.clientStatus,
    caseStatus: mapped.caseStatus,
    packageId,
    packageSlug,
    assignedAdminId,
    adminNotes: noteParts.join("\n"),
    ghlStage,
    source,
    action: "create",
  };

  if (!email && !phone) {
    row.action = "error";
    row.message = "Missing email and phone";
  }
  return row;
}

async function applyDuplicateChecks(
  rows: MappedRow[],
  maps: Awaited<ReturnType<typeof buildDuplicateMaps>>,
): Promise<void> {
  const fileEmails = new Map<string, number>();
  const filePhones = new Map<string, number>();
  for (const row of rows) {
    if (row.action === "error") continue;
    if (row.oppId && maps.byOpp.has(row.oppId)) {
      row.action = "skip";
      row.existingClientId = maps.byOpp.get(row.oppId);
      row.message = "Already imported (opp_id in admin_notes)";
      continue;
    }
    if (row.email) {
      const existing = maps.byEmail.get(row.email);
      if (existing) {
        row.action = "skip";
        row.existingClientId = existing;
        row.message = "Client with email already exists";
        continue;
      }
      if (fileEmails.has(row.email)) {
        row.action = "error";
        row.message = "Duplicate email within CSV";
        continue;
      }
      fileEmails.set(row.email, row.rowNumber);
    }
    if (row.phoneLast10) {
      const existing = maps.byPhone.get(row.phoneLast10);
      if (existing) {
        row.action = "skip";
        row.existingClientId = existing;
        row.message = "Client with phone already exists";
        continue;
      }
      if (filePhones.has(row.phoneLast10)) {
        row.action = "error";
        row.message = "Duplicate phone within CSV";
        continue;
      }
      filePhones.set(row.phoneLast10, row.rowNumber);
    }
  }
}

async function createClientWithCase(
  pool: Pool,
  row: MappedRow,
): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [clientIns] = await conn.query<ResultSetHeader>(
      `INSERT INTO clients
         (first_name, last_name, email, phone, status, pipeline_stage,
          pipeline_stage_changed_at, preferred_language, assigned_admin_id,
          package_id, admin_notes)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), 'en', ?, ?, ?)`,
      [
        row.firstName,
        row.lastName,
        row.email,
        row.phone,
        row.clientStatus,
        row.pipelineStage,
        row.assignedAdminId,
        row.packageId,
        row.adminNotes,
      ],
    );
    const clientId = Number(clientIns.insertId);
    const [caseIns] = await conn.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases
         (client_id, package_id, pipeline_stage, pipeline_stage_changed_at, status, notes)
       VALUES (?, ?, ?, NOW(), ?, ?)`,
      [
        clientId,
        row.packageId,
        row.pipelineStage,
        row.caseStatus,
        `Imported from GHL (${row.ghlStage.trim()})`,
      ],
    );
    const caseId = Number(caseIns.insertId);
    const caseNumber = `CR-${String(caseId).padStart(5, "0")}`;
    await conn.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [caseNumber, caseId],
    );
    await conn.query(
      `INSERT INTO client_pipeline_history
         (client_id, from_stage, to_stage, changed_by_admin_id, notes)
       VALUES (?, 'prospect', ?, NULL, ?)`,
      [
        clientId,
        row.pipelineStage,
        `GHL import row ${row.rowNumber} (${row.ghlStage.trim()})`,
      ],
    );
    await conn.commit();
    return clientId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

function printSummary(rows: MappedRow[]) {
  const byStage = new Map<string, number>();
  const byAction = { create: 0, skip: 0, error: 0 };
  for (const r of rows) {
    byAction[r.action]++;
    if (r.action === "create") {
      byStage.set(r.pipelineStage, (byStage.get(r.pipelineStage) || 0) + 1);
    }
  }
  console.log("\n=== Summary ===");
  console.log(`Total rows: ${rows.length}`);
  console.log(`Will create: ${byAction.create}`);
  console.log(`Skip: ${byAction.skip}`);
  console.log(`Error: ${byAction.error}`);
  console.log("\nCreates by OFG stage:");
  for (const [stage, count] of [...byStage.entries()].sort()) {
    console.log(`  ${stage}: ${count}`);
  }
  const samples = rows.filter((r) => r.action === "create").slice(0, 5);
  if (samples.length) {
    console.log("\nSample creates:");
    for (const s of samples) {
      console.log(
        `  ${s.firstName} ${s.lastName} <${s.email || s.phone}> → ${s.pipelineStage} (${s.ghlStage.trim()})`,
      );
    }
  }
  const errors = rows.filter((r) => r.action === "error").slice(0, 10);
  if (errors.length) {
    console.log("\nErrors (first 10):");
    for (const e of errors) {
      console.log(`  row ${e.rowNumber}: ${e.message}`);
    }
  }
}

async function main() {
  const csvPath = process.argv.find(
    (a) => !a.startsWith("-") && a.endsWith(".csv"),
  );
  const commit = process.argv.includes("--commit");
  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error(
      "Usage: npx tsx scripts/import-ghl-opportunities.ts /path/to/opportunities.csv [--commit]",
    );
    process.exit(1);
  }
  if (!process.env.DB_HOST) {
    console.error("DB_* env vars required (.env)");
    process.exit(1);
  }

  const text = fs.readFileSync(csvPath, "utf8");
  const rawRows = parseCsv(text);
  if (!rawRows.length) {
    console.error("CSV has no data rows");
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: true },
    connectionLimit: 4,
  });

  try {
    const pkgMap = await loadPackageIds(pool);
    const dupMaps = await buildDuplicateMaps(pool);
    const rows = rawRows.map((r, i) => mapCsvRow(r, i + 2, pkgMap));
    await applyDuplicateChecks(rows, dupMaps);

    printSummary(rows);

    if (!commit) {
      console.log("\nDry run — pass --commit to write to the database.");
      return;
    }

    console.log("\nCommitting...");
    let created = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.action !== "create") continue;
      try {
        const clientId = await createClientWithCase(pool, row);
        created++;
        if (created <= 5 || created % 25 === 0) {
          console.log(
            `  ✓ #${created} client ${clientId} — ${row.firstName} ${row.lastName} → ${row.pipelineStage}`,
          );
        }
      } catch (e: any) {
        failed++;
        console.error(
          `  ✗ row ${row.rowNumber} ${row.email || row.phone}: ${e?.message || e}`,
        );
      }
    }
    console.log(`\nDone. Created ${created}, failed ${failed}.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

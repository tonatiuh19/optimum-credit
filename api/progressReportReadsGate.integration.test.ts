/**
 * Progress Report reads gate — end to end through GET /reads, one synthetic
 * wizard session per scenario (no real client data; everything is created and
 * removed by this file). Covers: complete pair, half-loaded Before (vs its own
 * summary), blank-page After, names-only (no balances), print-header date
 * corrected from the report body, identical report dates, a read still in
 * progress, and a failed read.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Bureau, CreditAccount, CreditFile } from "./creditFile";
import { createServer, createSession } from "./index";
import { PV2_SUMMARY_PARSER_VERSION } from "./progressReportV2";
import { createIntegrationTestPool } from "./testDbCleanup";

let pool: Pool;
let app: ReturnType<typeof createServer>;
let token = "";
let adminId = 0;
let clientId = 0;
let caseId = 0;

const B: Bureau[] = ["TU", "EX", "EQ"];
const account = (i: number, balance: number): CreditAccount => ({
  creditor: `LENDER ${i}`,
  mask: String(2000 + i),
  section: "revolving",
  headerStatus: null,
  confident: true,
  bureaus: Object.fromEntries(B.map((b) => [b, { dateOpened: "01/2015", balance, creditLimit: 5000, accountStatus: "Open", paymentStatus: "Current", pastDue: 0, late30: 0, late60: 0, late90: 0, gridMarks: [] }])),
});
const read = (n: number, balance: number, reportDate: string): CreditFile =>
  ({ provider: "smartcredit", reportDate, scores: { TU: 620, EX: 590, EQ: 660 }, accounts: Array.from({ length: n }, (_, i) => account(i, balance)), inquiries: [], publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [] }) as unknown as CreditFile;
/** SmartCredit summary as cached on the read (text_skeleton_json.pullSummary2). */
const summary = (total: number, balances: number, reportDate: string | null) => ({
  parserVersion: PV2_SUMMARY_PARSER_VERSION,
  format: "smartcredit",
  reportDate,
  perBureau: Object.fromEntries(B.map((b) => [b, { totalAccounts: total, openAccounts: 3, closedAccounts: total - 3, balances, publicRecords: 0, inquiries2y: 0 }])),
  revolving: { TU: null, EX: null, EQ: null },
});

type Side = { status?: "ready" | "failed" | "submitted"; file?: CreditFile; skeleton?: Record<string, unknown>; error?: string; sha?: string };
async function scenario(before: Side, after: Side) {
  const [s] = await pool.query<ResultSetHeader>(
    `INSERT INTO report_wizard_sessions (case_id, client_id, round_number, status, options_json, created_by_admin_id) VALUES (?, ?, 2, 'review', '{}', ?)`,
    [caseId, clientId, adminId],
  );
  for (const [purpose, side] of [["progress_before", before], ["progress_after", after]] as const) {
    await pool.query(
      `INSERT INTO credit_file_extractions (client_id, report_wizard_session_id, purpose, file_name, mime_type, file_size, storage_key, enc_iv, enc_tag,
         provider, status, extracted_json, text_skeleton_json, error_message, file_sha256)
       VALUES (?, ?, ?, 'x.pdf', 'application/pdf', 1, 'vitest://reads-gate', '00', '00', 'smartcredit', ?, ?, ?, ?, ?)`,
      [
        clientId,
        s.insertId,
        purpose,
        side.status ?? "ready",
        side.file ? JSON.stringify(side.file) : null,
        JSON.stringify(side.skeleton ?? { provider: "smartcredit", imagePages: 0, totalPages: 12, pullSummary2: null }),
        side.error ?? null,
        side.sha ?? `${purpose}-${s.insertId}`,
      ],
    );
  }
  const r = await request(app).get(`/api/admin/report-wizard/sessions/${s.insertId}/reads`).set("Authorization", `Bearer ${token}`);
  expect(r.status).toBe(200);
  return r.body;
}

beforeAll(async () => {
  pool = createIntegrationTestPool();
  app = createServer();
  const [[a]] = await pool.query<RowDataPacket[]>(`SELECT id, email FROM admins WHERE status = 'active' AND role = 'super_admin' ORDER BY id LIMIT 1`);
  adminId = Number(a.id);
  token = await createSession("admin", adminId, String(a.email), "127.0.0.1", "vitest-reads-gate");
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Reads', 'Gate', ?, 'active', 'round_2')`,
    [`reads-gate-${Date.now()}@example.test`],
  );
  clientId = c.insertId;
  const [k] = await pool.query<ResultSetHeader>(`INSERT INTO credit_repair_cases (client_id, pipeline_stage, status) VALUES (?, 'round_2', 'active')`, [clientId]);
  caseId = k.insertId;
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM credit_file_extractions WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM report_wizard_sessions WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [caseId]);
  await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
  await pool.query(`UPDATE admin_sessions SET is_active = 0 WHERE user_agent = 'vitest-reads-gate'`).catch(() => null);
  await pool.end();
});

/** A complete pull; the After pays balances down (pulls must differ — identical pulls are blocked). */
const complete = (date: string, balance = date.startsWith("06") ? 4000 : 3500): Side => ({
  file: read(12, balance, date),
  skeleton: { provider: "smartcredit", imagePages: 0, totalPages: 20, pullSummary2: summary(12, balance * 12, date) },
});

describe("reads gate scenarios", () => {
  it.each([
    {
      name: "complete Before + After → ready, dates from the report body",
      before: complete("06/19/2026"),
      after: complete("10/22/2026"),
      expectBody: { ready: true, blocked_data_integrity: null, report_dates: { before: "06/19/2026", after: "10/22/2026" } },
    },
    {
      name: "Before half-loaded (fewer accounts than its own summary) → failed incomplete_print with the gap named",
      before: { file: read(11, 4000, "06/19/2026"), skeleton: { provider: "smartcredit", imagePages: 14, totalPages: 32, pullSummary2: summary(32, 48000, "06/19/2026") } },
      after: complete("10/22/2026"),
      expectBody: { ready: false, reads: { before: { status: "failed", code: "incomplete_print" }, after: { status: "ready" } } },
      error: { side: "before", re: /TU 11 of 32, EX 11 of 32, EQ 11 of 32/ },
    },
    {
      name: "After printed with blank account pages (≤3 accounts) → failed incomplete_print",
      before: complete("06/19/2026"),
      after: { file: read(2, 4000, "10/22/2026"), skeleton: { provider: "smartcredit", imagePages: 12, totalPages: 18, pullSummary2: null } },
      expectBody: { ready: false, reads: { after: { status: "failed", code: "incomplete_print" } } },
      error: { side: "after", re: /12 of 18 pages are empty/ },
    },
    {
      name: "account names loaded but no details (balances $0) → failed incomplete_print",
      before: complete("06/19/2026"),
      after: { file: read(12, 0, "10/22/2026"), skeleton: { provider: "smartcredit", imagePages: 0, totalPages: 19, pullSummary2: summary(12, 57000, "10/22/2026") } },
      expectBody: { ready: false, reads: { after: { status: "failed", code: "incomplete_print" } } },
      error: { side: "after", re: /balances \$0 of \$57,000/ },
    },
    {
      name: "AI read the browser print-header date → corrected from the report body, not blocked",
      before: { ...complete("06/19/2026"), file: read(12, 4000, "10/24/2026") },
      after: { ...complete("10/22/2026"), file: read(12, 3500, "10/24/2026") },
      expectBody: { ready: true, blocked_data_integrity: null, report_dates: { before: "06/19/2026", after: "10/22/2026" } },
    },
    {
      name: "same report date on both pulls → blocked (data integrity)",
      before: complete("10/22/2026"),
      after: complete("10/22/2026"),
      expectBody: { ready: false },
      blocked: /same report date \(10\/22\/2026\)/,
    },
    {
      // Nov 10 (owner): bureaus haven't updated yet → allowed as a "No changes yet" report (still needs approval).
      name: "different dates but identical scores and balances on every tradeline → ready, no_changes_yet",
      before: complete("06/19/2026", 4000),
      after: complete("10/22/2026", 4000),
      expectBody: { ready: true, blocked_data_integrity: null, no_changes_yet: true },
    },
    {
      name: "same file uploaded twice → blocked (data integrity)",
      before: { ...complete("06/19/2026"), sha: "same-sha" },
      after: { ...complete("10/22/2026"), sha: "same-sha" },
      expectBody: { ready: false },
      blocked: /same file/,
    },
    {
      name: "After still reading → not ready, nothing blocked",
      before: complete("06/19/2026"),
      after: { status: "submitted" as const },
      expectBody: { ready: false, blocked_data_integrity: null, reads: { before: { status: "ready" }, after: { status: "reading" } } },
    },
    {
      name: "After read failed → failed with its reason (not incomplete_print)",
      before: complete("06/19/2026"),
      after: { status: "failed" as const, error: "Claude error: overloaded" },
      expectBody: { ready: false, reads: { after: { status: "failed", error: "Claude error: overloaded" } } },
    },
  ])("$name", async ({ before, after, expectBody, error, blocked }) => {
    const body = await scenario(before, after);
    expect(body).toMatchObject(expectBody);
    if (error) expect(body.reads[error.side].error).toMatch(error.re);
    if (blocked) expect(body.blocked_data_integrity).toMatch(blocked);
    if (!error && body.reads?.after?.status === "failed" && body.reads.after.code) expect(body.reads.after.code).not.toBe("incomplete_print");
  }, 60_000);
});

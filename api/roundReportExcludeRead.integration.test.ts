/**
 * Nov 12, 2026: staff mark an AI-read row "not a real account" on a held report. Guards (who, which
 * report, which pull, which row), saved on the pull, audited, and the report re-checks. Test client only.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer, createSession } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const LECCA = 150002; // EN language owner
const ANGEL = 120001; // ES owner: not an approver for EN reports

let pool: Pool;
let app: ReturnType<typeof createServer>;
let clientId = 0;
let caseId = 0;
const tokens: Record<number, string> = {};
const read = {
  provider: "smartcredit",
  reportDate: "11/01/2026",
  accounts: [
    { creditor: "LOAN CO", mask: "1", section: "installment", bureaus: { TU: { balance: 355, dateOpened: "10/22/2025", accountStatus: "Open", paymentStatus: "Current" } } },
    { creditor: "LOAN CO", mask: "1", section: "installment", bureaus: { TU: { balance: 355, dateOpened: "10/22/2025", accountStatus: "Open", paymentStatus: "Current" } } },
  ],
  inquiries: [],
};

async function heldRound(round: number, status = "needs_review") {
  const [s] = await pool.query<ResultSetHeader>(
    `INSERT INTO report_wizard_sessions (case_id, client_id, round_number, created_by_admin_id, status) VALUES (?, ?, ?, ?, 'published')`,
    [caseId, clientId, round, LECCA],
  );
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO client_round_reports (client_id, case_id, round_number, score_before, score_after, items_removed, report_locale,
       delivery_status, self_check_json, delivery_options_json, wizard_session_id, pdf_storage_key, pdf_file_name)
     VALUES (?, ?, ?, 600, 620, 1, 'en', ?, '[]', '{}', ?, 'vitest://exclude.pdf', 'exclude.pdf')`,
    [clientId, caseId, round, status, s.insertId],
  );
  const [x] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_file_extractions (client_id, case_id, report_wizard_session_id, purpose, file_name, mime_type, file_size, storage_key, enc_iv, enc_tag, provider, status, extracted_json)
     VALUES (?, ?, ?, 'progress_after', 'after.pdf', 'application/pdf', 1, 'vitest://after.pdf', REPEAT('0',32), REPEAT('0',32), 'smartcredit', 'ready', ?)`,
    [clientId, caseId, s.insertId, JSON.stringify(read)],
  );
  return { reportId: r.insertId, sessionId: s.insertId, extractionId: x.insertId };
}

const exclude = (id: number, admin: number | null, body: Record<string, unknown>) => {
  const req = request(app).post(`/api/admin/round-reports/${id}/exclude-read`);
  return (admin ? req.set("Authorization", `Bearer ${tokens[admin]}`) : req).send(body);
};
const row = (extractionId: number, o: Record<string, unknown> = {}) => ({
  extraction_id: extractionId, bureau: "TU", creditor: "LOAN CO", mask: "1", balance: 355, date_opened: "10/22/2025", ...o,
});

beforeAll(async () => {
  pool = createIntegrationTestPool();
  app = createServer();
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Exclude', 'Read', ?, 'active', 'round_2')`,
    [`exclude-read-${Date.now()}@example.test`],
  );
  clientId = c.insertId;
  const [k] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_repair_cases (case_number, client_id, pipeline_stage, status) VALUES (?, ?, 'round_2', 'active')`,
    [`CR-EX${Date.now()}`.slice(0, 20), clientId],
  );
  caseId = k.insertId;
  for (const id of [LECCA, ANGEL]) tokens[id] = await createSession("admin", id, `exclude-${id}@example.test`, "127.0.0.1", "vitest-exclude-read");
}, 60_000);

afterAll(async () => {
  await pool.query(
    `DELETE FROM audit_logs WHERE action = 'round_report.exclude_read' AND entity_id IN (SELECT id FROM client_round_reports WHERE client_id = ?)`,
    [clientId],
  );
  await pool.query(`DELETE FROM credit_file_read_exclusions WHERE extraction_id IN (SELECT id FROM credit_file_extractions WHERE client_id = ?)`, [clientId]);
  await pool.query(`DELETE FROM credit_file_extractions WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM audit_logs WHERE entity_type = 'client' AND entity_id = ?`, [clientId]);
  await pool.query(`DELETE FROM round_report_pdfs WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM report_wizard_sessions WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM credit_repair_cases WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
  await pool.query(`UPDATE admin_sessions SET is_active = 0 WHERE user_agent = 'vitest-exclude-read'`).catch(() => null);
  await pool.end();
}, 60_000);

describe("mark an AI-read row as not a real account", () => {
  it("guards: login, approver, input, held status, the pull and the row must match", async () => {
    const a = await heldRound(1);
    const other = await heldRound(2);
    expect((await exclude(a.reportId, null, row(a.extractionId))).status).toBe(401);
    expect((await exclude(a.reportId, ANGEL, row(a.extractionId))).status).toBe(403);
    expect((await exclude(a.reportId, LECCA, row(a.extractionId, { bureau: "XX" }))).status).toBe(400);
    expect((await exclude(a.reportId, LECCA, row(a.extractionId, { creditor: "" }))).status).toBe(400);
    expect((await exclude(a.reportId, LECCA, row(a.extractionId, { balance: "abc" }))).status).toBe(400);
    const wrongPull = await exclude(a.reportId, LECCA, row(other.extractionId));
    expect(wrongPull.status).toBe(404);
    expect(wrongPull.body.code).toBe("wrong_pull");
    const noRow = await exclude(a.reportId, LECCA, row(a.extractionId, { creditor: "NOT ON THIS PULL" }));
    expect(noRow.status).toBe(422);
    expect(noRow.body.code).toBe("row_not_found");
    expect((await exclude(999999999, LECCA, row(a.extractionId))).status).toBe(404);
    await pool.query(`UPDATE client_round_reports SET delivery_status = 'pending_approval' WHERE id = ?`, [a.reportId]);
    const notHeld = await exclude(a.reportId, LECCA, row(a.extractionId));
    expect(notHeld.status).toBe(409);
    expect(notHeld.body.code).toBe("not_held");
    const [saved] = await pool.query<RowDataPacket[]>(`SELECT id FROM credit_file_read_exclusions WHERE extraction_id IN (?, ?)`, [a.extractionId, other.extractionId]);
    expect(saved).toHaveLength(0);
  }, 60_000);

  it("saves the row on its pull, audits it and re-checks the report (nothing is sent)", async () => {
    const h = await heldRound(3);
    const res = await exclude(h.reportId, LECCA, row(h.extractionId));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(["ready", "still_held", "skipped", "failed", "current"]).toContain(res.body.outcome);
    const [[x]] = await pool.query<RowDataPacket[]>(
      `SELECT bureau, creditor, mask, balance, date_opened, round_report_id, created_by_admin_id FROM credit_file_read_exclusions WHERE extraction_id = ?`,
      [h.extractionId],
    );
    expect(x).toMatchObject({ bureau: "TU", creditor: "LOAN CO", mask: "1", date_opened: "10/22/2025", round_report_id: h.reportId, created_by_admin_id: LECCA });
    expect(Number(x.balance)).toBe(355);
    const [[a]] = await pool.query<RowDataPacket[]>(`SELECT actor_id FROM audit_logs WHERE action = 'round_report.exclude_read' AND entity_id = ? ORDER BY id DESC LIMIT 1`, [h.reportId]);
    expect(Number(a.actor_id)).toBe(LECCA);
    const [[r]] = await pool.query<RowDataPacket[]>(`SELECT delivery_status FROM client_round_reports WHERE id = ?`, [h.reportId]);
    expect(["needs_review", "pending_approval"]).toContain(String(r?.delivery_status ?? "needs_review"));
  }, 60_000);

  it("never more exclusions than copies: the same row marked again is refused (two staff / double click)", async () => {
    const h = await heldRound(4);
    // The pull lists LOAN CO twice (identical): each copy can be marked once, a third mark is refused.
    expect((await exclude(h.reportId, LECCA, row(h.extractionId))).status).toBe(200);
    await pool.query(`UPDATE client_round_reports SET delivery_status = 'needs_review' WHERE id = ?`, [h.reportId]);
    expect((await exclude(h.reportId, LECCA, row(h.extractionId))).status).toBe(200);
    await pool.query(`UPDATE client_round_reports SET delivery_status = 'needs_review' WHERE id = ?`, [h.reportId]);
    const third = await exclude(h.reportId, LECCA, row(h.extractionId));
    expect(third.status).toBe(409);
    expect(third.body.code).toBe("already_marked");
    const [saved] = await pool.query<RowDataPacket[]>(`SELECT id FROM credit_file_read_exclusions WHERE extraction_id = ?`, [h.extractionId]);
    expect(saved).toHaveLength(2);
  }, 60_000);

  it("a different balance or open date is not the same row (422)", async () => {
    const h = await heldRound(5);
    expect((await exclude(h.reportId, LECCA, row(h.extractionId, { balance: 999 }))).status).toBe(422);
    expect((await exclude(h.reportId, LECCA, row(h.extractionId, { date_opened: "01/01/2020" }))).status).toBe(422);
  }, 60_000);
});

describe("post-deploy re-check runs within a time budget", () => {
  it("stops when the budget is spent and reports how many are left", async () => {
    const { selfHealAllHeldReports } = await import("./index");
    await heldRound(6);
    const out = await selfHealAllHeldReports("deploy", -1);
    expect(out.remaining).toBeGreaterThan(0);
    expect(out.ready + out.still_held + out.current + out.skipped + out.failed).toBe(0);
  }, 60_000);
});

/**
 * Progress Report Engine Spec v1.1 P0-1 + §9: publish never sends. A report
 * waits for the language owner (EN Lecca) or a release manager (Cesar / Alex);
 * a failed self-check needs a release manager's written override. Until
 * approval the client never sees it (portal, PDF routes, download links).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import { createServer, createSession, executeAdminAiTool } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const LECCA = 150002; // EN language owner
const ANGEL = 120001; // ES owner (not an approver for EN reports)
const CESAR = 90001; // release manager

let pool: Pool;
let app: ReturnType<typeof createServer>;
let clientId = 0;
const tokens: Record<number, string> = {};
let clientToken = "";

async function report(round: number, status: string, checks: unknown[] = []) {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO client_round_reports (client_id, round_number, score_before, score_after, items_removed, report_locale,
       delivery_status, self_check_json, delivery_options_json, pdf_storage_key, pdf_file_name)
     VALUES (?, ?, 600, 620, 1, 'en', ?, ?, ?, 'vitest://gate.pdf', 'gate.pdf')`,
    [clientId, round, status, JSON.stringify(checks), JSON.stringify({ notify_client: false, notify_partners: false })],
  );
  await pool.query(
    `INSERT INTO round_report_pdfs (client_id, round_number, round_report_id, file_name, storage_key, storage_provider, encrypted)
     VALUES (?, ?, ?, 'gate.pdf', 'vitest://gate.pdf', 'local', 0)`,
    [clientId, round, r.insertId],
  );
  return r.insertId;
}

const approve = (id: number, admin: number, body: Record<string, unknown> = {}) =>
  request(app).post(`/api/admin/round-reports/${id}/approve`).set("Authorization", `Bearer ${tokens[admin]}`).send(body);

beforeAll(async () => {
  pool = createIntegrationTestPool();
  app = createServer();
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Gate', 'Approval', ?, 'active', 'round_2')`,
    [`gate-approval-${Date.now()}@example.test`],
  );
  clientId = c.insertId;
  for (const id of [LECCA, ANGEL, CESAR]) tokens[id] = await createSession("admin", id, `gate-${id}@example.test`, "127.0.0.1", "vitest-approval-gate");
  clientToken = await createSession("client", clientId, `gate-client@example.test`, "127.0.0.1", "vitest-approval-gate");
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM credit_file_extractions WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM credit_repair_cases WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM audit_logs WHERE entity_type = 'client_round_report' AND entity_id IN (SELECT id FROM client_round_reports WHERE client_id = ?)`, [clientId]);
  await pool.query(`DELETE FROM round_report_download_tokens WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM round_report_pdfs WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
  await pool.query(`UPDATE admin_sessions SET is_active = 0 WHERE user_agent = 'vitest-approval-gate'`).catch(() => null);
  await pool.end();
});

describe("approval gate (P0-1)", () => {
  it("pending report: hidden from the client portal and PDF routes; listed for approval", async () => {
    const id = await report(1, "pending_approval");
    const dash = await request(app).get("/api/portal/dashboard").set("Authorization", `Bearer ${clientToken}`);
    expect(dash.status).toBe(200);
    expect(JSON.stringify(dash.body)).not.toContain(`"round_number":1`);
    const pdf = await request(app).get("/api/portal/round-reports/1/pdf").set("Authorization", `Bearer ${clientToken}`);
    expect(pdf.status).toBe(404);
    const queue = await request(app).get("/api/admin/round-reports/pending-approval").set("Authorization", `Bearer ${tokens[LECCA]}`);
    const mine = queue.body.items.find((x: any) => x.id === id);
    expect(mine).toMatchObject({ delivery_status: "pending_approval", can_approve: true, can_override: false });
  }, 60_000);

  it("the ES owner cannot approve an EN report; the EN owner can, once", async () => {
    const [[r]] = await pool.query<RowDataPacket[]>(`SELECT id FROM client_round_reports WHERE client_id = ? AND round_number = 1`, [clientId]);
    expect((await approve(r.id, ANGEL)).status).toBe(403);
    const ok = await approve(r.id, LECCA);
    expect(ok.status).toBe(200);
    expect(ok.body.delivery_status).toBe("silent"); // notify_client false → portal only, nothing sent
    expect((await approve(r.id, LECCA)).status).toBe(409);
    const [[row]] = await pool.query<RowDataPacket[]>(`SELECT delivery_status, approved_by_admin_id FROM client_round_reports WHERE id = ?`, [r.id]);
    expect(row).toMatchObject({ delivery_status: "silent", approved_by_admin_id: LECCA });
    const dash = await request(app).get("/api/portal/dashboard").set("Authorization", `Bearer ${clientToken}`);
    expect(JSON.stringify(dash.body)).toContain(`"round_number":1`);
  }, 60_000);

  it("failed self-check: the owner cannot send; a release manager needs a written reason (audited)", async () => {
    const id = await report(2, "needs_review", [{ key: "account_totals", pass: false, detail: "Before TU: 11 accounts read, summary 32" }]);
    const owner = await approve(id, LECCA);
    expect(owner.status).toBe(422);
    expect(owner.body.code).toBe("self_check_failed");
    expect((await approve(id, CESAR, { override_reason: "short" })).status).toBe(422);
    const ok = await approve(id, CESAR, { override_reason: "Verified against the PDF by hand; summary row misread" });
    expect(ok.status).toBe(200);
    expect(ok.body.override_reason).toMatch(/Verified against the PDF/);
    const [[a]] = await pool.query<RowDataPacket[]>(
      `SELECT action FROM audit_logs WHERE entity_type = 'client_round_report' AND entity_id = ? ORDER BY id DESC LIMIT 1`,
      [id],
    );
    expect(a.action).toBe("report_wizard.approved_override");
  }, 60_000);
});

describe("MCP / admin AI tools respect the approval gate", () => {
  it("send_round_report refuses a report waiting for approval (dry-run and confirm) and one that failed the self-check", async () => {
    await report(3, "pending_approval");
    for (const confirm of [false, true]) {
      const r: any = await executeAdminAiTool("send_round_report", { client_id: clientId, round_number: 3, confirm, confirm_phrase: confirm ? "CONFIRM" : undefined }, { adminId: CESAR });
      expect(r.ok).toBe(false);
      expect(r.error).toBe("awaiting_approval");
      expect(r.message).toMatch(/waiting for Approve & send/);
    }
    const [[r2]] = await pool.query<RowDataPacket[]>(`SELECT id FROM client_round_reports WHERE client_id = ? AND round_number = 2`, [clientId]);
    await pool.query(`UPDATE client_round_reports SET delivery_status = 'needs_review' WHERE id = ?`, [r2.id]);
    const held: any = await executeAdminAiTool("send_round_report", { client_id: clientId, round_number: 2, confirm: false }, { adminId: CESAR });
    expect(held).toMatchObject({ ok: false, error: "awaiting_approval" });
    expect(held.message).toMatch(/failed the progress-report self-check/);
    const [[sent]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM outbound_message_log WHERE client_id = ? AND round_number IN (2, 3)`, [clientId]);
    expect(Number(sent.n)).toBe(0);
  }, 60_000);

  it("list_progress_reports / get_progress_report expose the approval state (never \"sent\" while waiting)", async () => {
    const [k] = await pool.query<ResultSetHeader>(`INSERT INTO credit_repair_cases (client_id, pipeline_stage, status) VALUES (?, 'round_3', 'active')`, [clientId]);
    await pool.query(`UPDATE client_round_reports SET case_id = ? WHERE client_id = ?`, [k.insertId, clientId]);
    const list: any = await executeAdminAiTool("list_progress_reports", { case_id: k.insertId }, { adminId: CESAR });
    expect(list.ok).toBe(true);
    const byRound = Object.fromEntries(list.data.reports.map((r: any) => [r.round, r.approval]));
    expect(byRound[1]).toMatchObject({ status: "silent", client_visible: true });
    expect(byRound[3]).toMatchObject({ status: "pending_approval", client_visible: false });
    expect(byRound[3].next_step).toMatch(/Not sent to the client/);
    const one: any = await executeAdminAiTool("get_progress_report", { case_id: k.insertId, round: 3 }, { adminId: CESAR });
    expect(one.data.approval).toMatchObject({ status: "pending_approval", client_visible: false });
    expect(list.data.guidance).toMatch(/never tell staff a waiting report was sent/);
  }, 60_000);

  it("get_enhanced_report_status flags a half-loaded progress read as not usable", async () => {
    const thin = { provider: "smartcredit", reportDate: "10/22/2026", scores: { TU: 600, EX: 600, EQ: 600 }, accounts: [], inquiries: [], publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [] };
    await pool.query(
      `INSERT INTO credit_file_extractions (client_id, purpose, file_name, mime_type, file_size, storage_key, enc_iv, enc_tag, provider, status, extracted_json, text_skeleton_json)
       VALUES (?, 'progress_after', 'after.pdf', 'application/pdf', 1, 'vitest://x', '00', '00', 'smartcredit', 'ready', ?, ?)`,
      [clientId, JSON.stringify(thin), JSON.stringify({ ...thin, imagePages: 8, totalPages: 11, pullSummary2: null })],
    );
    const r: any = await executeAdminAiTool("get_enhanced_report_status", { client_id: clientId }, { adminId: CESAR });
    const read = r.data.reads.find((x: any) => x.purpose === "progress_after");
    expect(read).toMatchObject({ status: "ready", usable_for_progress_report: false });
    expect(read.blocked_reason).toMatch(/before SmartCredit finished loading/);
  }, 60_000);
});

describe("approval permission matrix (who × status × override × language)", () => {
  type Row = { who: number; whoName: string; locale: "en" | "es"; status: "pending_approval" | "needs_review" | "sent" | "silent"; reason?: string; http: number };
  const LONG = "Checked every account against the PDF by hand";
  const rows: Row[] = [
    // EN report: Lecca (EN owner) approves pending; Angel (ES owner) cannot; managers can.
    { who: LECCA, whoName: "EN owner", locale: "en", status: "pending_approval", http: 200 },
    { who: ANGEL, whoName: "ES owner", locale: "en", status: "pending_approval", http: 403 },
    { who: CESAR, whoName: "manager", locale: "en", status: "pending_approval", http: 200 },
    // ES report: mirror image.
    { who: ANGEL, whoName: "ES owner", locale: "es", status: "pending_approval", http: 200 },
    { who: LECCA, whoName: "EN owner", locale: "es", status: "pending_approval", http: 403 },
    // Failed self-check: owners never; managers only with a real reason.
    { who: LECCA, whoName: "EN owner", locale: "en", status: "needs_review", reason: LONG, http: 422 },
    { who: CESAR, whoName: "manager", locale: "en", status: "needs_review", http: 422 },
    { who: CESAR, whoName: "manager", locale: "en", status: "needs_review", reason: "too short", http: 422 },
    { who: CESAR, whoName: "manager", locale: "en", status: "needs_review", reason: LONG, http: 200 },
    // Already released: nothing to approve.
    { who: CESAR, whoName: "manager", locale: "en", status: "sent", http: 409 },
    { who: CESAR, whoName: "manager", locale: "en", status: "silent", http: 409 },
  ];
  let round = 10;
  it.each(rows)("$whoName on a $locale report that is $status (reason: $reason) → $http", async ({ who, locale, status, reason, http }) => {
    const r = ++round;
    const id = await report(r, status);
    await pool.query(`UPDATE client_round_reports SET report_locale = ? WHERE id = ?`, [locale, id]);
    const res = await approve(id, who, reason ? { override_reason: reason } : {});
    expect(res.status).toBe(http);
    const [[after]] = await pool.query<RowDataPacket[]>(`SELECT delivery_status, approved_by_admin_id FROM client_round_reports WHERE id = ?`, [id]);
    if (http === 200) {
      // notify_client false in the fixture → released to the portal without messages.
      expect(after).toMatchObject({ delivery_status: "silent", approved_by_admin_id: who });
    } else {
      // A refused approval never changes the report.
      expect(after.delivery_status).toBe(status);
    }
  }, 60_000);

  it("two approvals at the same time: exactly one wins", async () => {
    const id = await report(40, "pending_approval");
    const results = await Promise.all([approve(id, LECCA), approve(id, CESAR)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  }, 60_000);
});

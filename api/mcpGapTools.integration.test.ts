/**
 * MCP gap audit (Nov 10, 2026):
 *  - the static ADMIN_AI_MCP_TOKEN is read-only (writes + sends refused)
 *  - new tools reuse the exact CRM functions: events, report approval / rebuild,
 *    conversation status + assignment, AI stats, document review
 *  - every new write is dry-run first; approve + reject-document ask before sending
 *  - approval permissions match the CRM (language owner or Cesar; override = Cesar + reason)
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  ADMIN_AI_SEND_TOOLS,
  ADMIN_AI_TOOLS,
  ADMIN_AI_WRITE_TOOLS,
  adminAiInputSchemaToZod,
  adminAiToolAnnotations,
  eventSqlDateTime,
  executeAdminAiTool,
  laWallClockAsUtcDate,
} from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool, uniqueTestE164 } from "./testDbCleanup";

const LECCA = 150002; // EN language owner
const ANGEL = 120001; // ES owner — not an approver for EN reports
const CESAR = 90001; // release manager
const RUN = `mcpgap${Date.now()}`;
const OK = { confirm: true, confirm_phrase: "CONFIRM" };

let pool: Pool;
let clientId = 0;
let companyId = 0;
let sessionId = 0;
const extraClients: number[] = [];

const run = (name: string, args: Record<string, unknown>, adminId = CESAR, readOnly = false) =>
  executeAdminAiTool(name, args, { adminId, readOnly }) as Promise<any>;

async function report(round: number, status: string, checks: unknown[] = []) {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO client_round_reports (client_id, round_number, score_before, score_after, items_removed, report_locale,
       delivery_status, self_check_json, delivery_options_json, pdf_storage_key, pdf_file_name)
     VALUES (?, ?, 600, 620, 1, 'en', ?, ?, ?, 'vitest://gap.pdf', 'gap.pdf')`,
    [clientId, round, status, JSON.stringify(checks), JSON.stringify({ notify_client: false, notify_partners: false })],
  );
  await pool.query(
    `INSERT INTO round_report_pdfs (client_id, round_number, round_report_id, file_name, storage_key, storage_provider, encrypted)
     VALUES (?, ?, ?, 'gap.pdf', 'vitest://gap.pdf', 'local', 0)`,
    [clientId, round, r.insertId],
  );
  return r.insertId;
}
const status = async (id: number) =>
  String((await pool.query<RowDataPacket[]>(`SELECT delivery_status FROM client_round_reports WHERE id = ?`, [id]))[0][0].delivery_status);

beforeAll(async () => {
  pool = createIntegrationTestPool();
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Gap', ?, ?, 'active', 'round_2')`,
    [RUN, `${RUN}@example.test`],
  );
  clientId = c.insertId;
  const [co] = await pool.query<ResultSetHeader>(
    `INSERT INTO event_companies (slug, name, label_slug, welcome_heading_en, welcome_heading_es, welcome_body_en, welcome_body_es,
       email_subject_en, email_subject_es, email_body_en, email_body_es, sms_body_en, sms_body_es)
     VALUES (?, 'Vitest Gap School', 'event_marketing', 'h', 'h', 'b', 'b', 's', 's', 'b', 'b', 's', 's')`,
    [`vt-${RUN}`],
  );
  companyId = co.insertId;
  const [se] = await pool.query<ResultSetHeader>(
    `INSERT INTO event_series (company_id, slug, name_en, name_es) VALUES (?, 'n', 'N', 'N')`,
    [companyId],
  );
  const start = eventSqlDateTime(new Date(laWallClockAsUtcDate().getTime() + 48 * 3600_000));
  const [ss] = await pool.query<ResultSetHeader>(
    `INSERT INTO event_sessions (company_id, series_id, short_code, title_en, title_es, starts_at) VALUES (?, ?, ?, 'Gap Night', 'Noche', ?)`,
    [companyId, se.insertId, `${RUN}`.slice(0, 32), start],
  );
  sessionId = ss.insertId;
}, 60_000);

afterAll(async () => {
  if (companyId) await pool.query(`DELETE FROM event_companies WHERE id = ?`, [companyId]);
  const [extra] = await pool.query<RowDataPacket[]>(`SELECT id FROM clients WHERE last_name LIKE ?`, [`%${RUN}%`]);
  for (const r of extra) extraClients.push(Number(r.id));
  await pool.query(`DELETE FROM audit_logs WHERE entity_type = 'client_round_report' AND entity_id IN (SELECT id FROM client_round_reports WHERE client_id = ?)`, [clientId]);
  await pool.query(`DELETE FROM round_report_download_tokens WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM round_report_pdfs WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM client_round_reports WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM client_documents WHERE client_id = ?`, [clientId]);
  await cleanupIntegrationTestClients(pool, { runId: RUN, clientIds: [clientId, ...extraClients] });
  await pool.end();
}, 60_000);

describe("MCP gap tools", () => {
  it("registry: every new tool exists, writes are confirm-gated, client-facing ones ask before sending", () => {
    const names = new Set(ADMIN_AI_TOOLS.map((t) => t.name));
    const writes = ["import_event_signin_sheet", "event_check_in", "approve_round_report", "rebuild_round_report", "set_conversation_status", "assign_conversation", "review_client_document"];
    for (const n of [...writes, "list_events", "get_event_registrations", "get_event_results", "get_conversation_ai_stats"]) expect(names.has(n), n).toBe(true);
    for (const n of writes) {
      expect(ADMIN_AI_WRITE_TOOLS.has(n), n).toBe(true);
      const t = ADMIN_AI_TOOLS.find((x) => x.name === n)!;
      expect(JSON.stringify(t.input_schema), n).toContain("confirm_phrase");
    }
    for (const n of ["approve_round_report", "review_client_document"]) {
      expect(ADMIN_AI_SEND_TOOLS.has(n)).toBe(true);
      expect(adminAiToolAnnotations(n)).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
    for (const n of ["list_events", "get_event_results", "get_conversation_ai_stats"]) expect(ADMIN_AI_WRITE_TOOLS.has(n)).toBe(false);
  });

  it("MCP transport schemas accept what Claude sends (lists of objects, numeric strings, string booleans)", () => {
    const schema = (n: string) => adminAiInputSchemaToZod(ADMIN_AI_TOOLS.find((t) => t.name === n)!.input_schema as Record<string, unknown>);
    const sheet = schema("import_event_signin_sheet").safeParse({
      session_id: "12",
      rows: [{ first_name: "A", last_name: "B", phone: "9095551234", attended: "false", extra: "kept" }],
      confirm: "true",
      confirm_phrase: "CONFIRM",
    });
    expect(sheet.success).toBe(true);
    if (sheet.success) {
      expect(sheet.data.session_id).toBe(12);
      expect(sheet.data.rows[0]).toMatchObject({ first_name: "A", attended: false, extra: "kept" });
      expect(sheet.data.confirm).toBe(true);
    }
    // A row missing a required field is rejected before the tool runs.
    expect(schema("import_event_signin_sheet").safeParse({ session_id: 1, rows: [{ first_name: "A" }] }).success).toBe(false);
    expect(schema("approve_round_report").safeParse({ report_id: "7", override_reason: "x" }).success).toBe(true);
    expect(schema("set_conversation_status").safeParse({ client_id: 1, status: "deleted" }).success).toBe(false);
    expect(schema("review_client_document").safeParse({ document_id: 1, decision: "maybe" }).success).toBe(false);
    // Every tool schema still converts.
    for (const t of ADMIN_AI_TOOLS) expect(() => adminAiInputSchemaToZod(t.input_schema as Record<string, unknown>), t.name).not.toThrow();
  });

  it("master token is read-only: lookups work, every write and send is refused before running", async () => {
    expect((await run("list_events", { company_id: companyId }, CESAR, true)).ok).toBe(true);
    for (const n of ["send_sms", "update_lead_signals", "approve_round_report", "event_check_in", "create_work_task"]) {
      const r = await run(n, { ...OK, report_id: 1, registration_id: 1 }, CESAR, true);
      expect(r, n).toMatchObject({ ok: false, error: "forbidden" });
      expect(r.message).toMatch(/read-only master token/);
    }
  });

  it("events: sign-in sheet dry-run writes nothing; confirm imports; list / registrations / results / check-in agree", async () => {
    const rows = [
      { first_name: "Sheet", last_name: `One${RUN}`, phone: uniqueTestE164(`${RUN}-1`) },
      { first_name: "Sheet", last_name: `Two${RUN}`, phone: uniqueTestE164(`${RUN}-2`), attended: false },
      { first_name: "Bad", last_name: `Phone${RUN}`, phone: "12" },
    ];
    const dry = await run("import_event_signin_sheet", { session_id: sessionId, rows });
    expect(dry).toMatchObject({ ok: true, dry_run: true, preview: { people: 3, marked_attended: 2 } });
    const [[none]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM event_registrations WHERE session_id = ?`, [sessionId]);
    expect(Number(none.n)).toBe(0);
    const done = await run("import_event_signin_sheet", { session_id: sessionId, rows, ...OK });
    expect(done).toMatchObject({ ok: true, data: { imported: 2, failed: 1 } });
    expect(done.data.detail).toBeUndefined();

    const list = await run("list_events", { company_id: companyId });
    const s = list.data.companies[0].sessions[0];
    expect(s).toMatchObject({ id: sessionId, seated: 2, attended: 1, status: "scheduled", has_door_qr: false });

    const regs = await run("get_event_registrations", { session_id: sessionId });
    expect(regs.data.count).toBe(2);
    const notIn = regs.data.registrations.find((r: any) => !r.checked_in_at);
    expect(notIn.check_in_method).toBeNull();

    const ciDry = await run("event_check_in", { registration_id: notIn.registration_id });
    expect(ciDry).toMatchObject({ ok: true, dry_run: true, preview: { action: "check in", already_checked_in: false } });
    expect((await run("event_check_in", { registration_id: notIn.registration_id, ...OK })).ok).toBe(true);
    const results = await run("get_event_results", { company_id: companyId });
    expect(results.data.totals).toMatchObject({ registered: 2, attended: 2, new_contacts: 2 });
    expect((await run("event_check_in", { registration_id: notIn.registration_id, undo: true, ...OK })).data.checked_in).toBe(false);
    expect((await run("get_event_results", { company_id: companyId })).data.totals.attended).toBe(1);

    expect(await run("get_event_registrations", {})).toMatchObject({ ok: false, error: "invalid_args" });
    expect(await run("get_event_results", {})).toMatchObject({ ok: false, error: "invalid_args" });
    expect(await run("event_check_in", { registration_id: 999999999, ...OK })).toMatchObject({ ok: false, error: "not_found" });
    // A cancelled session refuses check-ins (undo still allowed).
    await pool.query(`UPDATE event_sessions SET status = 'cancelled' WHERE id = ?`, [sessionId]);
    expect(await run("event_check_in", { registration_id: notIn.registration_id, ...OK })).toMatchObject({ ok: false, error: "invalid_args" });
    await pool.query(`UPDATE event_sessions SET status = 'scheduled' WHERE id = ?`, [sessionId]);
  });

  it("approve: dry-run explains who can; ES owner refused; EN owner approves once; repeat is refused", async () => {
    const id = await report(1, "pending_approval");
    const dryAngel = await run("approve_round_report", { report_id: id }, ANGEL);
    expect(dryAngel.preview).toMatchObject({ round: 1, you_can: "not approve (language owner or Cesar only)", client_notified: false });
    expect(await run("approve_round_report", { report_id: id, ...OK }, ANGEL)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await status(id)).toBe("pending_approval");
    expect((await run("approve_round_report", { report_id: id }, LECCA)).preview.you_can).toBe("approve");
    const ok = await run("approve_round_report", { report_id: id, ...OK }, LECCA);
    expect(ok).toMatchObject({ ok: true, data: { ok: true, delivery_status: "silent" } });
    expect(await status(id)).toBe("silent");
    const again = await run("approve_round_report", { report_id: id, ...OK }, LECCA);
    expect(again).toMatchObject({ ok: false });
    expect(again.message).toMatch(/Already approved/);
  });

  it("failed self-check: owner cannot send; Cesar needs a 10+ char reason (logged)", async () => {
    const id = await report(2, "needs_review", [{ key: "account_totals", pass: false, detail: "TU 25 vs 23" }]);
    const dry = await run("approve_round_report", { report_id: id }, LECCA);
    expect(dry.preview.failed_checks).toEqual(["account_totals: TU 25 vs 23"]);
    expect(dry.preview.you_can).toMatch(/Cesar only/);
    expect(await run("approve_round_report", { report_id: id, ...OK }, LECCA)).toMatchObject({ ok: false, error: "self_check_failed" });
    expect(await run("approve_round_report", { report_id: id, ...OK, override_reason: "short" }, CESAR)).toMatchObject({ ok: false, error: "self_check_failed" });
    expect(await run("approve_round_report", { report_id: id, ...OK, override_reason: "Totals verified by hand against the PDF" }, CESAR)).toMatchObject({ ok: true });
    const [[log]] = await pool.query<RowDataPacket[]>(
      `SELECT action FROM audit_logs WHERE entity_type = 'client_round_report' AND entity_id = ? ORDER BY id DESC LIMIT 1`,
      [id],
    );
    expect(log.action).toBe("report_wizard.approved_override");
  });

  it("rebuild: refused without a wizard session (same rule as the CRM); unknown report is not_found", async () => {
    const id = await report(3, "needs_review");
    expect(await run("rebuild_round_report", { report_id: id, ...OK }, LECCA)).toMatchObject({ ok: false, error: "no_session" });
    expect(await run("rebuild_round_report", { report_id: 999999999, ...OK })).toMatchObject({ ok: false, error: "not_found" });
  });

  it("documents: reject needs a reason; dry-run shows the client impact; approve updates the review", async () => {
    const [d] = await pool.query<ResultSetHeader>(
      `INSERT INTO client_documents (client_id, doc_type, file_name, file_size, mime_type, storage_provider, storage_key, encrypted, enc_iv, enc_tag, review_status)
       VALUES (?, 'id_front', 'id.jpg', 10, 'image/jpeg', 'local', 'vitest://id.jpg', 0, '', '', 'pending')`,
      [clientId],
    );
    expect(await run("review_client_document", { document_id: d.insertId, decision: "rejected" })).toMatchObject({ ok: false, error: "invalid_args" });
    const dry = await run("review_client_document", { document_id: d.insertId, decision: "rejected", reason: "Blurry photo" });
    expect(dry.preview).toMatchObject({ decision: "rejected", client_is_texted_and_emailed: true, current_status: "pending" });
    const ok = await run("review_client_document", { document_id: d.insertId, decision: "approved", ...OK });
    expect(ok).toMatchObject({ ok: true, data: { ok: true, auto_advanced: false } });
    const [[row]] = await pool.query<RowDataPacket[]>(`SELECT review_status, reviewed_by_admin_id FROM client_documents WHERE id = ?`, [d.insertId]);
    expect(row).toMatchObject({ review_status: "approved", reviewed_by_admin_id: CESAR });
  });

  it("conversations: status + assign are dry-run first and validate input; AI stats come back", async () => {
    expect(await run("set_conversation_status", { client_id: clientId, status: "bogus" })).toMatchObject({ ok: false, error: "invalid_args" });
    const dry = await run("set_conversation_status", { client_id: clientId, status: "closed" });
    expect(dry).toMatchObject({ ok: true, dry_run: true, preview: { action: "set status closed", open_threads: 0 } });
    expect(await run("assign_conversation", { client_id: clientId })).toMatchObject({ ok: false, error: "invalid_args" });
    expect(await run("assign_conversation", { client_id: clientId, admin_id: 999999999 })).toMatchObject({ ok: false, error: "not_found" });
    const stats = await run("get_conversation_ai_stats", { days: 7 });
    if (stats.ok) expect(stats.data).toMatchObject({ days: 7 });
    else expect(stats.error).toBe("forbidden"); // admin without an assigned OFG number
  });
});

/**
 * Admin AI Ask — curated tool executors (no Anthropic calls).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { createSession, executeAdminAiTool, resolveLanguageOwnerAdminId } from "./index";
import { cleanupIntegrationTestClients, createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `ai-tools-${Date.now()}`;
const EMAIL = `${RUN_ID}@example.test`;

let pool: Pool;
let adminId = 0;
let clientId = 0;
let caseId = 0;
let caseNumber = "";
let taskId = 0;

describe("admin AI tools", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = createIntegrationTestPool();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin");
    adminId = Number(admins[0].id);
    // Ensure session helper still works in this suite environment
    await createSession(
      "admin",
      adminId,
      String(admins[0].email),
      "127.0.0.1",
      `vitest-${RUN_ID}`,
    );

    const [c] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, preferred_language, status, pipeline_stage)
       VALUES (?, 'AiTool', ?, 'en', 'active', 'round_2')`,
      [EMAIL, RUN_ID],
    );
    clientId = c.insertId;

    const [cr] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
       VALUES (?, 'round_2', 'active')`,
      [clientId],
    );
    caseId = cr.insertId;
    caseNumber = `CR-AI${caseId}`;
    await pool.query(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [caseNumber, caseId],
    );

    await pool.query(
      `INSERT INTO client_round_reports
         (client_id, case_id, round_number, score_before, score_after,
          items_removed, items_disputed, summary_md, report_locale)
       VALUES (?, ?, 1, 580, 620, 3, 5, 'Round 1 summary for AI tools test', 'en')`,
      [clientId, caseId],
    );

    const [t] = await pool.query<ResultSetHeader>(
      `INSERT INTO admin_work_tasks
         (title, description, status, priority, assignee_admin_id, case_id, created_by_admin_id)
       VALUES (?, 'ai tools fixture', 'backlog', 'medium', ?, ?, ?)`,
      [`AI tools task ${RUN_ID}`, adminId, caseId, adminId],
    );
    taskId = t.insertId;

    await pool.query(
      `INSERT INTO payment_splits
         (case_id, client_id, label, amount_cents, due_date, status)
       VALUES (?, ?, 'AI overdue installment', 15000, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'overdue'),
              (?, ?, 'AI pending installment', 10000, DATE_ADD(CURDATE(), INTERVAL 10 DAY), 'pending')`,
      [caseId, clientId, caseId, clientId],
    );

    await pool.query(
      `INSERT INTO client_documents
         (client_id, case_id, doc_type, file_name, file_size, mime_type,
          storage_provider, storage_key, review_status)
       VALUES (?, ?, 'id_front', 'id-front.png', 1024, 'image/png',
               'local', ?, 'approved')`,
      [clientId, caseId, `vitest/${RUN_ID}/id-front.png`],
    );

    await pool.query(
      `INSERT INTO case_round_schedules
         (case_id, round_1_date, round_2_date, round_3_date, round_4_date, round_5_date,
          interval_days, calendar_uid_ns)
       VALUES (?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 35 DAY),
               DATE_ADD(CURDATE(), INTERVAL 70 DAY),
               DATE_ADD(CURDATE(), INTERVAL 105 DAY),
               DATE_ADD(CURDATE(), INTERVAL 140 DAY),
               35, ?)`,
      [caseId, `vitest-${RUN_ID}`],
    );
  }, 120_000);

  afterAll(async () => {
    if (taskId) {
      await pool.query(`DELETE FROM admin_work_tasks WHERE id = ?`, [taskId]);
    }
    if (caseId) {
      await pool.query(`DELETE FROM case_round_schedules WHERE case_id = ?`, [
        caseId,
      ]);
      await pool.query(`DELETE FROM client_documents WHERE case_id = ?`, [
        caseId,
      ]);
      await pool.query(`DELETE FROM payment_splits WHERE case_id = ?`, [
        caseId,
      ]);
      await pool.query(`DELETE FROM client_round_reports WHERE case_id = ?`, [
        caseId,
      ]);
      await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [
        caseId,
      ]);
    }
    if (clientId) {
      await pool
        .query(
          `DELETE FROM conversation_messages WHERE conversation_id IN (
             SELECT id FROM (SELECT id FROM conversations WHERE client_id = ?) t
           )`,
          [clientId],
        )
        .catch(() => {});
      await pool
        .query(`DELETE FROM conversations WHERE client_id = ?`, [clientId])
        .catch(() => {});
      await pool.query(`DELETE FROM onboarding_tokens WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM client_documents WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM payment_splits WHERE client_id = ?`, [
        clientId,
      ]);
      await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
    }
    await cleanupIntegrationTestClients(pool, {
      runId: RUN_ID,
      clientIds: [clientId],
    });
    await pool?.end();
  });

  it("search_clients finds by case number", async () => {
    const res = await executeAdminAiTool(
      "search_clients",
      { q: caseNumber, limit: 5 },
      { adminId },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const clients = (res.data as any).clients as Array<{ case_number: string }>;
    expect(clients.some((c) => c.case_number === caseNumber)).toBe(true);
    const hit = (res.data as any).clients.find(
      (c: { case_number: string }) => c.case_number === caseNumber,
    );
    expect(hit.href).toContain(`client=${clientId}`);
    expect(hit.href).toContain(`case=${caseId}`);
    expect(hit.on_prospect_board).toBe(false);
    expect(Array.isArray((res.data as any).funding_applications)).toBe(true);
  }, 30_000);

  it("search_clients finds by numeric client id", async () => {
    const res = await executeAdminAiTool(
      "search_clients",
      { q: String(clientId), limit: 5 },
      { adminId },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const clients = (res.data as any).clients as Array<{ id: number }>;
    expect(clients.some((c) => c.id === clientId)).toBe(true);
  }, 30_000);

  it("get_case returns stage and payment badge", async () => {
    const res = await executeAdminAiTool(
      "get_case",
      { case_number: caseNumber },
      { adminId },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.data as any;
    expect(data.case_id).toBe(caseId);
    expect(data.pipeline_stage).toBe("round_2");
    expect(data.payment_badge).toBeTruthy();
  }, 30_000);

  it("pipeline_summary includes round_2 total", async () => {
    const res = await executeAdminAiTool(
      "pipeline_summary",
      { search: RUN_ID },
      { adminId },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const cols = (res.data as any).columns;
    expect(cols.round_2.total).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("list_progress_reports and get_progress_report", async () => {
    const list = await executeAdminAiTool(
      "list_progress_reports",
      { case_id: caseId },
      { adminId },
    );
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect((list.data as any).reports.length).toBeGreaterThanOrEqual(1);

    const one = await executeAdminAiTool(
      "get_progress_report",
      { case_id: caseId, round: 1 },
      { adminId },
    );
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    const data = one.data as any;
    expect(data.score_after).toBe(620);
    expect(data.summary_excerpt).toContain("Round 1");
    expect(data).not.toHaveProperty("pdf_storage_key");
  }, 30_000);

  it("search_work_tasks finds fixture task", async () => {
    const res = await executeAdminAiTool(
      "search_work_tasks",
      { q: RUN_ID, status: "backlog" },
      { adminId },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const tasks = (res.data as any).tasks as Array<{ id: number }>;
    expect(tasks.some((t) => t.id === taskId)).toBe(true);
  }, 30_000);

  it("get_client and list_case_documents", async () => {
    const client = await executeAdminAiTool(
      "get_client",
      { client_id: clientId },
      { adminId },
    );
    expect(client.ok).toBe(true);
    if (!client.ok) return;
    expect((client.data as any).client_id).toBe(clientId);
    expect((client.data as any)).not.toHaveProperty("ssn_last4");
    expect(Array.isArray((client.data as any).referrers)).toBe(true);

    const docs = await executeAdminAiTool(
      "list_case_documents",
      { case_id: caseId },
      { adminId },
    );
    expect(docs.ok).toBe(true);
    if (!docs.ok) return;
    const data = docs.data as any;
    expect(data.documents.some((d: any) => d.doc_type === "id_front")).toBe(
      true,
    );
    expect(
      data.required_checklist.find((c: any) => c.doc_type === "id_front")
        ?.present,
    ).toBe(true);
  }, 30_000);

  it("list_installments and list_clients_owing", async () => {
    const inst = await executeAdminAiTool(
      "list_installments",
      { case_id: caseId, status: "open" },
      { adminId },
    );
    expect(inst.ok).toBe(true);
    if (!inst.ok) return;
    const idata = inst.data as any;
    expect(idata.open_count).toBeGreaterThanOrEqual(2);
    expect(idata.overdue_cents).toBeGreaterThanOrEqual(15000);

    const owing = await executeAdminAiTool(
      "list_clients_owing",
      { mode: "overdue", search: RUN_ID, limit: 10 },
      { adminId },
    );
    expect(owing.ok).toBe(true);
    if (!owing.ok) return;
    const odata = owing.data as any;
    expect(odata.client_count).toBeGreaterThanOrEqual(1);
    expect(
      odata.installments.some((r: any) => r.client_id === clientId),
    ).toBe(true);
  }, 45_000);

  it("list_round_schedule returns fixture dates", async () => {
    const res = await executeAdminAiTool(
      "list_round_schedule",
      { case_number: caseNumber },
      { adminId },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const data = res.data as any;
    expect(data.scheduled).toBe(true);
    expect(data.rounds).toHaveLength(5);
  }, 30_000);

  it("create_prospect dry-run then create with confirm", async () => {
    const phone = `555${String(Date.now()).slice(-7)}`;
    const dry = await executeAdminAiTool(
      "create_prospect",
      {
        first_name: "AiWrite",
        last_name: RUN_ID,
        phone,
        preferred_language: "en",
        referral_category: "realtor_broker",
        referrer_first_name: "Ref",
        referrer_last_name: RUN_ID,
        referrer_phone: "5551112222",
        notes: "intake from test",
      },
      { adminId },
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as any).dry_run).toBe(true);
    expect((dry.data as any).ready).toBe(true);

    const created = await executeAdminAiTool(
      "create_prospect",
      {
        first_name: "AiWrite",
        last_name: RUN_ID,
        phone,
        preferred_language: "en",
        referral_category: "realtor_broker",
        referrer_first_name: "Ref",
        referrer_last_name: RUN_ID,
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const cid = Number((created.data as any).client_id);
    expect(cid).toBeGreaterThan(0);
    // cleanup
    await pool.query(`DELETE FROM clients WHERE id = ?`, [cid]);
    if ((created.data as any).referrer_id) {
      await pool.query(`DELETE FROM referrers WHERE id = ?`, [
        (created.data as any).referrer_id,
      ]);
    }
  }, 60_000);

  it("add_case_note requires confirm then appends", async () => {
    const dry = await executeAdminAiTool(
      "add_case_note",
      {
        client_id: clientId,
        source: "call",
        note: `Called about docs ${RUN_ID}`,
      },
      { adminId },
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as any).dry_run).toBe(true);

    const written = await executeAdminAiTool(
      "add_case_note",
      {
        client_id: clientId,
        source: "call",
        note: `Called about docs ${RUN_ID}`,
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(String((written.data as any).note_appended)).toContain(RUN_ID);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT admin_notes FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    expect(String(rows[0]?.admin_notes || "")).toContain(RUN_ID);
  }, 45_000);

  it("upload_case_document dry-run then uploads to case file", async () => {
    const tinyPngB64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const metaDry = await executeAdminAiTool(
      "upload_case_document",
      {
        client_id: clientId,
        doc_type: "id_front",
        file_name: `atlas-id-${RUN_ID}.png`,
      },
      { adminId },
    );
    expect(metaDry.ok).toBe(true);
    if (!metaDry.ok) return;
    expect((metaDry.data as any).dry_run).toBe(true);
    expect((metaDry.data as any).ready).toBe(false);
    expect((metaDry.data as any).missing_fields).toContain("file_base64");

    const dry = await executeAdminAiTool(
      "upload_case_document",
      {
        client_id: clientId,
        doc_type: "id_front",
        file_name: `atlas-id-${RUN_ID}.png`,
        file_base64: tinyPngB64,
      },
      { adminId },
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as any).dry_run).toBe(true);
    expect((dry.data as any).ready).toBe(true);
    expect((dry.data as any).preview?.file_size_bytes).toBeGreaterThan(0);

    const noPhrase = await executeAdminAiTool(
      "upload_case_document",
      {
        client_id: clientId,
        doc_type: "id_front",
        file_name: `atlas-id-${RUN_ID}.png`,
        file_base64: tinyPngB64,
        confirm: true,
      },
      { adminId },
    );
    expect(noPhrase.ok === false && noPhrase.error).toBe("confirm_required");

    if (!process.env.CDN_UPLOAD_SECRET || !process.env.DOC_ENCRYPTION_KEY) {
      return;
    }

    const uploaded = await executeAdminAiTool(
      "upload_case_document",
      {
        client_id: clientId,
        doc_type: "id_front",
        file_name: `atlas-id-${RUN_ID}.png`,
        file_base64: tinyPngB64,
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;
    expect((uploaded.data as any).uploaded).toBe(true);
    expect(Number((uploaded.data as any).document_id)).toBeGreaterThan(0);
    expect((uploaded.data as any).file_name).toBe(`atlas-id-${RUN_ID}.png`);
    expect((uploaded.data as any).doc_type).toBe("id_front");

    const docId = Number((uploaded.data as any).document_id);
    const [docRows] = await pool.query<RowDataPacket[]>(
      `SELECT id, doc_type, file_name, review_status FROM client_documents WHERE id = ? LIMIT 1`,
      [docId],
    );
    expect(docRows[0]?.doc_type).toBe("id_front");
    expect(String(docRows[0]?.file_name || "")).toContain(RUN_ID);
    await pool.query(`DELETE FROM client_documents WHERE id = ?`, [docId]);
  }, 90_000);

  it("send_email dry-run then send + logs EMAIL case note", async () => {
    const dry = await executeAdminAiTool(
      "send_email",
      {
        client_id: clientId,
        subject: `Docs upload ${RUN_ID}`,
        body: `Please upload your ID and utility bill.\nThanks — OFG`,
        include_doc_upload_link: true,
      },
      { adminId },
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as any).dry_run).toBe(true);
    expect((dry.data as any).ready).toBe(true);
    expect((dry.data as any).preview?.include_doc_upload_link).toBe(true);
    expect((dry.data as any).preview?.to).toBe(EMAIL);

    const [tokensBefore] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM onboarding_tokens WHERE client_id = ?`,
      [clientId],
    );
    const tokenCountBefore = Number(tokensBefore[0]?.c || 0);

    const noPhrase = await executeAdminAiTool(
      "send_email",
      {
        client_id: clientId,
        subject: `Docs upload ${RUN_ID}`,
        body: "Please upload",
        confirm: true,
      },
      { adminId },
    );
    expect(noPhrase.ok === false && noPhrase.error).toBe("confirm_required");

    const [tokensAfterDry] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM onboarding_tokens WHERE client_id = ?`,
      [clientId],
    );
    expect(Number(tokensAfterDry[0]?.c || 0)).toBe(tokenCountBefore);

    const sent = await executeAdminAiTool(
      "send_email",
      {
        client_id: clientId,
        subject: `Docs upload ${RUN_ID}`,
        body: `Please upload your ID and utility bill.\nThanks — OFG`,
        include_doc_upload_link: true,
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect((sent.data as any).sent).toBe(true);
    expect((sent.data as any).to).toBe(EMAIL);
    expect(String((sent.data as any).doc_upload_link || "")).toContain(
      "/portal/onboarding/",
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT admin_notes FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    const notes = String(rows[0]?.admin_notes || "");
    expect(notes).toContain("[EMAIL");
    expect(notes).toContain(`Docs upload ${RUN_ID}`);
    expect(notes).toContain("/portal/onboarding/");
  }, 60_000);

  it("send_email refuses cancelled clients and missing email", async () => {
    const [noEmailIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, phone, status, pipeline_stage, preferred_language)
       VALUES ('NoEmail', ?, '5550001234', 'active', 'new_client', 'en')`,
      [RUN_ID],
    );
    const noEmailId = Number(noEmailIns.insertId);
    const missing = await executeAdminAiTool(
      "send_email",
      {
        client_id: noEmailId,
        subject: "Hi",
        body: "Hello",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(missing.ok === false && missing.error).toBe("no_email");

    const [cancelledIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (email, first_name, last_name, status, pipeline_stage, preferred_language)
       VALUES (?, 'Cancelled', ?, 'cancelled', 'cancelled', 'en')`,
      [`cancelled-${EMAIL}`, RUN_ID],
    );
    const cancelledId = Number(cancelledIns.insertId);
    const cancelled = await executeAdminAiTool(
      "send_email",
      {
        client_id: cancelledId,
        subject: "Hi",
        body: "Hello",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(cancelled.ok === false && cancelled.error).toBe("invalid_args");

    await pool.query(`DELETE FROM clients WHERE id IN (?, ?)`, [
      noEmailId,
      cancelledId,
    ]);
  }, 45_000);

  it("send_email to referrer dry-run then send + logs partner and client notes", async () => {
    const refEmail = `miguel-${RUN_ID}@example.test`;
    const [refIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO referrers
         (category, first_name, last_name, email, phone, company, preferred_language, status)
       VALUES ('realtor_broker', 'Miguel', ?, ?, '5551112222', 'Encore Mortgage', 'en', 'active')`,
      [RUN_ID, refEmail],
    );
    const referrerId = Number(refIns.insertId);
    await pool.query(`UPDATE clients SET referrer_id = ? WHERE id = ?`, [
      referrerId,
      clientId,
    ]);

    const found = await executeAdminAiTool(
      "search_referrers",
      { q: `Miguel ${RUN_ID}` },
      { adminId },
    );
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    const hits = ((found.data as any).referrers || []) as Array<{ id: number }>;
    expect(hits.some((r) => r.id === referrerId)).toBe(true);

    const got = await executeAdminAiTool(
      "get_client",
      { client_id: clientId },
      { adminId },
    );
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(Number((got.data as any).referrer?.id)).toBe(referrerId);
    expect((got.data as any).referrer?.email).toBe(refEmail);
    expect(
      ((got.data as any).referrers || []).some(
        (r: { id: number }) => Number(r.id) === referrerId,
      ),
    ).toBe(true);

    const dry = await executeAdminAiTool(
      "send_email",
      {
        referrer_id: referrerId,
        client_id: clientId,
        subject: `Sofia starting ${RUN_ID}`,
        body: "Confirming Sofia is getting started and documents are coming.",
        include_doc_upload_link: true,
      },
      { adminId },
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as any).ready).toBe(true);
    expect((dry.data as any).preview?.audience).toBe("referrer");
    expect((dry.data as any).preview?.to).toBe(refEmail);
    expect((dry.data as any).preview?.include_doc_upload_link).toBe(false);

    const [tokensBefore] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM onboarding_tokens WHERE client_id = ?`,
      [clientId],
    );
    const tokenCountBefore = Number(tokensBefore[0]?.c || 0);

    const sent = await executeAdminAiTool(
      "send_email",
      {
        referrer_id: referrerId,
        client_id: clientId,
        subject: `Sofia starting ${RUN_ID}`,
        body: "Confirming Sofia is getting started and documents are coming.",
        include_doc_upload_link: true,
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect((sent.data as any).sent).toBe(true);
    expect((sent.data as any).audience).toBe("referrer");
    expect((sent.data as any).to).toBe(refEmail);
    expect((sent.data as any).doc_upload_link).toBeFalsy();
    expect((sent.data as any).referrer_note_appended).toBe(true);
    expect((sent.data as any).client_note_appended).toBe(true);

    const [tokensAfter] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM onboarding_tokens WHERE client_id = ?`,
      [clientId],
    );
    expect(Number(tokensAfter[0]?.c || 0)).toBe(tokenCountBefore);

    const [refRows] = await pool.query<RowDataPacket[]>(
      `SELECT notes FROM referrers WHERE id = ? LIMIT 1`,
      [referrerId],
    );
    expect(String(refRows[0]?.notes || "")).toContain("[EMAIL");
    expect(String(refRows[0]?.notes || "")).toContain(`Sofia starting ${RUN_ID}`);

    const [cRows] = await pool.query<RowDataPacket[]>(
      `SELECT admin_notes FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    expect(String(cRows[0]?.admin_notes || "")).toContain("[EMAIL REFERRER");
    expect(String(cRows[0]?.admin_notes || "")).toContain(refEmail);

    const [noMailIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO referrers
         (category, first_name, last_name, phone, preferred_language, status)
       VALUES ('realtor_broker', 'NoMail', ?, '5553334444', 'en', 'active')`,
      [RUN_ID],
    );
    const noMailId = Number(noMailIns.insertId);
    const missing = await executeAdminAiTool(
      "send_email",
      {
        referrer_id: noMailId,
        subject: "Hi",
        body: "Hello",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(missing.ok === false && missing.error).toBe("no_email");

    await pool.query(`UPDATE clients SET referrer_id = NULL WHERE id = ?`, [
      clientId,
    ]);
    await pool.query(`DELETE FROM referrers WHERE id IN (?, ?)`, [
      referrerId,
      noMailId,
    ]);
  }, 60_000);

  it("create_work_task dry-run then create", async () => {
    const dry = await executeAdminAiTool(
      "create_work_task",
      {
        title: `AI collect ${RUN_ID}`,
        preferred_language: "en",
        case_id: caseId,
        priority: "high",
      },
      { adminId },
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as any).dry_run).toBe(true);
    expect((dry.data as any).ready).toBe(true);
    expect((dry.data as any).preview.push_hubspot).toBe(false);
    expect(String((dry.data as any).preview.hubspot)).toBe(
      "ofg_only_push_hubspot_false",
    );
    // English must resolve via admins.language_owner_for='en' (not first-by-id)
    const enOwnerId = await resolveLanguageOwnerAdminId("en");
    expect(enOwnerId).toBeTruthy();
    expect(Number((dry.data as any).preview?.assignee?.id)).toBe(enOwnerId);

    const created = await executeAdminAiTool(
      "create_work_task",
      {
        title: `AI collect ${RUN_ID}`,
        preferred_language: "en",
        case_id: caseId,
        priority: "high",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const taskIdCreated = Number((created.data as any).task_id);
    expect(taskIdCreated).toBeGreaterThan(0);
    expect((created.data as any).status).toBe("backlog");
    expect((created.data as any).hubspot?.pushed).toBe(false);
    expect(Number((created.data as any).assignee?.id)).toBe(enOwnerId);
    await pool.query(`DELETE FROM admin_work_tasks WHERE id = ?`, [
      taskIdCreated,
    ]);
  }, 60_000);

  it("create_work_task fails when no language_owner_for is set", async () => {
    const enOwnerId = await resolveLanguageOwnerAdminId("en");
    expect(enOwnerId).toBeTruthy();
    await pool.query(
      `UPDATE admins SET language_owner_for = NULL WHERE id = ?`,
      [enOwnerId],
    );
    try {
      const res = await executeAdminAiTool(
        "create_work_task",
        {
          title: `AI no-owner ${RUN_ID}`,
          preferred_language: "en",
          case_id: caseId,
        },
        { adminId },
      );
      expect(res.ok === false && res.error).toBe("no_language_owner");
    } finally {
      await pool.query(
        `UPDATE admins SET language_owner_for = 'en' WHERE id = ?`,
        [enOwnerId],
      );
    }
    expect(await resolveLanguageOwnerAdminId("en")).toBe(enOwnerId);
  }, 30_000);

  it("create_work_task routes Spanish via language_owner_for and keeps HubSpot opt-in", async () => {
    const esOwnerId = await resolveLanguageOwnerAdminId("es");
    expect(esOwnerId).toBeTruthy();

    const dry = await executeAdminAiTool(
      "create_work_task",
      {
        title: `AI es route ${RUN_ID}`,
        preferred_language: "es",
        case_id: caseId,
        push_hubspot: false,
      },
      { adminId },
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(Number((dry.data as any).preview?.assignee?.id)).toBe(esOwnerId);
    expect((dry.data as any).preview.push_hubspot).toBe(false);

    const [ownerRows] = await pool.query<RowDataPacket[]>(
      `SELECT language_owner_for FROM admins WHERE id = ? LIMIT 1`,
      [esOwnerId],
    );
    expect(ownerRows[0]?.language_owner_for).toBe("es");
  }, 30_000);

  it("write tools enforce missing fields, phone, and confirm gates", async () => {
    const missingLang = await executeAdminAiTool(
      "create_prospect",
      {
        first_name: "Gap",
        last_name: RUN_ID,
        phone: "5550001111",
      },
      { adminId },
    );
    expect(missingLang.ok).toBe(true);
    if (!missingLang.ok) return;
    expect((missingLang.data as any).ready).toBe(false);
    expect((missingLang.data as any).missing_fields.join(" ")).toMatch(
      /preferred_language/,
    );

    const shortPhone = await executeAdminAiTool(
      "create_prospect",
      {
        first_name: "Gap",
        last_name: RUN_ID,
        phone: "555",
        preferred_language: "en",
      },
      { adminId },
    );
    expect(shortPhone.ok).toBe(false);
    expect(shortPhone.ok === false && shortPhone.error).toBe("invalid_args");

    const fixturePhone = `555${String(clientId).padStart(7, "0")}`.slice(0, 10);
    await pool.query(`UPDATE clients SET phone = ? WHERE id = ?`, [
      fixturePhone,
      clientId,
    ]);
    const dupDry = await executeAdminAiTool(
      "create_prospect",
      {
        first_name: "Dup",
        last_name: RUN_ID,
        phone: fixturePhone,
        preferred_language: "en",
      },
      { adminId },
    );
    expect(dupDry.ok).toBe(true);
    if (!dupDry.ok) return;
    expect((dupDry.data as any).requires_confirm_duplicate).toBe(true);

    const dupBlocked = await executeAdminAiTool(
      "create_prospect",
      {
        first_name: "Dup",
        last_name: RUN_ID,
        phone: fixturePhone,
        preferred_language: "en",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(dupBlocked.ok).toBe(false);
    expect(dupBlocked.ok === false && dupBlocked.error).toBe("duplicate_phone");

    const noPhrase = await executeAdminAiTool(
      "add_case_note",
      {
        client_id: clientId,
        note: "should not write",
        source: "sms",
        confirm: true,
      },
      { adminId },
    );
    expect(noPhrase.ok).toBe(false);
    expect(noPhrase.ok === false && noPhrase.error).toBe("confirm_required");

    const noTaskLang = await executeAdminAiTool(
      "create_work_task",
      { title: `Need lang ${RUN_ID}` },
      { adminId },
    );
    expect(noTaskLang.ok).toBe(true);
    if (!noTaskLang.ok) return;
    expect((noTaskLang.data as any).ready).toBe(false);

    const noNoteTarget = await executeAdminAiTool(
      "add_case_note",
      { note: "orphan note", source: "sms" },
      { adminId },
    );
    expect(noNoteTarget.ok).toBe(true);
    if (!noNoteTarget.ok) return;
    expect((noNoteTarget.data as any).ready).toBe(false);
  }, 60_000);

  it("rejects unknown tools", async () => {
    const res = await executeAdminAiTool("drop_table", {}, { adminId });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("unknown_tool");
  }, 15_000);

  it("create_work_task rejects missing client_id", async () => {
    const res = await executeAdminAiTool(
      "create_work_task",
      {
        title: `Missing client ${RUN_ID}`,
        preferred_language: "en",
        client_id: 999999999,
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("not_found");
  }, 30_000);

  it("add_case_note dry-run succeeds without confirm (Claude preview path)", async () => {
    const dry = await executeAdminAiTool(
      "add_case_note",
      {
        client_id: clientId,
        note: `Dry-run note ${RUN_ID}`,
        source: "call",
        confirm: false,
      },
      { adminId },
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as any).dry_run).toBe(true);
    expect((dry.data as any).ready).toBe(true);
    expect(String((dry.data as any).preview?.note_to_append || "")).toContain(
      RUN_ID,
    );
  }, 30_000);

  it("upsert_progress_report dry-run then write", async () => {
    const dry = await executeAdminAiTool(
      "upsert_progress_report",
      {
        case_id: caseId,
        round: 1,
        summary_md: `Analysis ${RUN_ID}`,
        score_before: 580,
        score_after: 620,
        file_strength_score: 70,
      },
      { adminId },
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as any).ready).toBe(true);

    const written = await executeAdminAiTool(
      "upsert_progress_report",
      {
        case_id: caseId,
        round: 1,
        summary_md: `Analysis ${RUN_ID}`,
        score_before: 580,
        score_after: 620,
        file_strength_score: 70,
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect((written.data as any).upserted).toBe(true);
    await pool.query(
      `UPDATE client_round_reports SET pdf_storage_key = 'fake/key.pdf' WHERE client_id = ? AND round_number = 1`,
      [clientId],
    );
    const blocked = await executeAdminAiTool(
      "upsert_progress_report",
      {
        case_id: caseId,
        round: 1,
        summary_md: `Overwrite attempt ${RUN_ID}`,
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.error).toBe("published_exists");

    await pool.query(
      `DELETE FROM client_round_reports WHERE client_id = ? AND round_number = 1`,
      [clientId],
    );
  }, 60_000);

  it("upsert_payment_splits dry-run then create; list_clients_owing sees them", async () => {
    const due = new Date();
    due.setDate(due.getDate() - 3);
    const dueStr = due.toISOString().slice(0, 10);
    const splits_json = JSON.stringify([
      {
        label: `AI overdue ${RUN_ID}`,
        amount_cents: 15000,
        due_date: dueStr,
      },
    ]);
    const dry = await executeAdminAiTool(
      "upsert_payment_splits",
      { case_id: caseId, splits_json },
      { adminId },
    );
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as any).ready).toBe(true);
    expect((dry.data as any).preview?.splits?.[0]?.status).toBe("overdue");

    // Seed an open split then ensure dry-run warns without replace_open
    await pool.query(
      `INSERT INTO payment_splits
         (case_id, client_id, label, amount_cents, due_date, status, created_by_admin_id)
       VALUES (?, ?, 'pre-existing', 1000, ?, 'pending', ?)`,
      [caseId, clientId, dueStr, adminId],
    );
    const warnDry = await executeAdminAiTool(
      "upsert_payment_splits",
      { case_id: caseId, splits_json },
      { adminId },
    );
    expect(warnDry.ok).toBe(true);
    if (!warnDry.ok) return;
    expect((warnDry.data as any).preview?.existing_open_splits).toBeGreaterThan(
      0,
    );
    expect(String((warnDry.data as any).preview?.warning || "")).toMatch(
      /DUPLICATE/i,
    );

    const created = await executeAdminAiTool(
      "upsert_payment_splits",
      {
        case_id: caseId,
        splits_json,
        replace_open: true,
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const splitId = Number((created.data as any).split_ids?.[0]);
    expect(splitId).toBeGreaterThan(0);

    const owing = await executeAdminAiTool(
      "list_clients_owing",
      { mode: "overdue", search: RUN_ID, limit: 20 },
      { adminId },
    );
    expect(owing.ok).toBe(true);

    const markPaid = await executeAdminAiTool(
      "update_payment_split",
      {
        split_id: splitId,
        status: "paid",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(markPaid.ok).toBe(true);
    if (!markPaid.ok) return;
    expect((markPaid.data as any).payments_id).toBeTruthy();
    const [payRows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM payments WHERE split_id = ? LIMIT 1`,
      [splitId],
    );
    expect(payRows[0]).toBeTruthy();

    await pool.query(`DELETE FROM payments WHERE split_id = ?`, [splitId]);
    await pool.query(`DELETE FROM payment_splits WHERE id = ?`, [splitId]);
  }, 90_000);

  it("update_payment_split refuses unpay after ledger write", async () => {
    const due = new Date();
    due.setDate(due.getDate() + 7);
    const dueStr = due.toISOString().slice(0, 10);
    const created = await executeAdminAiTool(
      "upsert_payment_splits",
      {
        case_id: caseId,
        splits_json: JSON.stringify([
          {
            label: `Unpay guard ${RUN_ID}`,
            amount_cents: 5000,
            due_date: dueStr,
            status: "pending",
          },
        ]),
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const splitId = Number((created.data as any).split_ids?.[0]);
    const paid = await executeAdminAiTool(
      "update_payment_split",
      {
        split_id: splitId,
        status: "paid",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(paid.ok).toBe(true);
    const unpay = await executeAdminAiTool(
      "update_payment_split",
      {
        split_id: splitId,
        status: "pending",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(unpay.ok).toBe(false);
    expect(unpay.ok === false && unpay.error).toBe("cannot_unpay");
    await pool.query(`DELETE FROM payments WHERE split_id = ?`, [splitId]);
    await pool.query(`DELETE FROM payment_splits WHERE id = ?`, [splitId]);
  }, 90_000);

  it("update_client_status rejects status=prospect after enrolled case", async () => {
    const res = await executeAdminAiTool(
      "update_client_status",
      {
        client_id: clientId,
        status: "prospect",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toBe("invalid_args");
  }, 30_000);

  it("update_client_status can return an unconverted lead to prospect", async () => {
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, phone, status, pipeline_stage, preferred_language)
       VALUES ('AiGhost', ?, '(555) 010-8822', 'pending_payment', 'prospect', 'en')`,
      [RUN_ID],
    );
    const pid = Number(ins.insertId);
    const restored = await executeAdminAiTool(
      "update_client_status",
      {
        client_id: pid,
        status: "prospect",
        notes: "still a lead",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(restored.ok).toBe(true);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
      [pid],
    );
    expect(rows[0]?.status).toBe("prospect");
    expect(rows[0]?.pipeline_stage).toBe("prospect");
    await pool.query(`DELETE FROM clients WHERE id = ?`, [pid]);
  }, 30_000);

  it("update_client_status blocks active/onboarding/pending_payment without enrolled case", async () => {
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, phone, status, pipeline_stage, preferred_language)
       VALUES ('AiNoCase', ?, '5550109911', 'prospect', 'prospect', 'en')`,
      [RUN_ID],
    );
    const pid = Number(ins.insertId);
    for (const status of ["active", "onboarding", "pending_payment"] as const) {
      const res = await executeAdminAiTool(
        "update_client_status",
        {
          client_id: pid,
          status,
          confirm: true,
          confirm_phrase: "CONFIRM",
        },
        { adminId },
      );
      expect(res.ok).toBe(false);
      expect(res.ok === false && res.error).toBe("use_convert_prospect");
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
      [pid],
    );
    expect(rows[0]?.status).toBe("prospect");
    expect(rows[0]?.pipeline_stage).toBe("prospect");
    await pool.query(`DELETE FROM clients WHERE id = ?`, [pid]);
  }, 30_000);

  it("update_client_status allows active after enrolled case exists", async () => {
    const res = await executeAdminAiTool(
      "update_client_status",
      {
        client_id: clientId,
        status: "active",
        notes: "enrolled client status",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(res.ok).toBe(true);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    expect(rows[0]?.status).toBe("active");
  }, 30_000);

  it("update_pipeline_stage cancelled also cancels client status", async () => {
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, phone, status, pipeline_stage, preferred_language)
       VALUES ('AiCancel', ?, '5550008888', 'prospect', 'prospect', 'en')`,
      [RUN_ID],
    );
    const pid = Number(ins.insertId);
    const cancelled = await executeAdminAiTool(
      "update_pipeline_stage",
      {
        client_id: pid,
        stage: "cancelled",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(cancelled.ok).toBe(true);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
      [pid],
    );
    expect(rows[0]?.status).toBe("cancelled");
    expect(rows[0]?.pipeline_stage).toBe("cancelled");
    await pool.query(`DELETE FROM client_pipeline_history WHERE client_id = ?`, [
      pid,
    ]);
    await pool.query(`DELETE FROM clients WHERE id = ?`, [pid]);
  }, 60_000);

  it("update_pipeline_stage blocks prospect without convert", async () => {
    // Fixture client is not prospect — create ephemeral prospect
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, phone, status, pipeline_stage, preferred_language)
       VALUES ('AiStage', ?, '5550009999', 'prospect', 'prospect', 'en')`,
      [RUN_ID],
    );
    const pid = Number(ins.insertId);
    const blocked = await executeAdminAiTool(
      "update_pipeline_stage",
      {
        client_id: pid,
        stage: "new_client",
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.ok === false && blocked.error).toBe("use_convert_prospect");

    const dryConvert = await executeAdminAiTool(
      "preview_convert_prospect",
      { client_id: pid },
      { adminId },
    );
    expect(dryConvert.ok).toBe(true);
    if (!dryConvert.ok) return;
    expect((dryConvert.data as any).ready).toBe(true);
    expect((dryConvert.data as any).dry_run).toBe(true);

    // Preview must not mutate the prospect
    const [stillProspect] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
      [pid],
    );
    expect(stillProspect[0]?.status).toBe("prospect");
    expect(stillProspect[0]?.pipeline_stage).toBe("prospect");

    const dryConvertLegacy = await executeAdminAiTool(
      "convert_prospect",
      { client_id: pid },
      { adminId },
    );
    expect(dryConvertLegacy.ok).toBe(true);
    if (!dryConvertLegacy.ok) return;
    expect((dryConvertLegacy.data as any).ready).toBe(true);

    const noPhrase = await executeAdminAiTool(
      "convert_prospect",
      { client_id: pid, confirm: true },
      { adminId },
    );
    expect(noPhrase.ok === false && noPhrase.error).toBe("confirm_required");

    const enrolledBlocked = await executeAdminAiTool(
      "preview_convert_prospect",
      { client_id: clientId },
      { adminId },
    );
    expect(enrolledBlocked.ok === false && enrolledBlocked.error).toBe(
      "already_converted",
    );

    const [stuck] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, phone, status, pipeline_stage, preferred_language)
       VALUES ('AiStuckActive', ?, '5550007777', 'active', 'prospect', 'en')`,
      [RUN_ID],
    );
    const stuckId = Number(stuck.insertId);
    const stuckPreview = await executeAdminAiTool(
      "preview_convert_prospect",
      { client_id: stuckId },
      { adminId },
    );
    expect(stuckPreview.ok).toBe(true);
    if (stuckPreview.ok) {
      expect((stuckPreview.data as any).ready).toBe(true);
    }
    const stuckConverted = await executeAdminAiTool(
      "convert_prospect",
      {
        client_id: stuckId,
        confirm: true,
        confirm_phrase: "CONFIRM",
      },
      { adminId },
    );
    expect(stuckConverted.ok).toBe(true);
    if (stuckConverted.ok) {
      const stuckCaseId = Number((stuckConverted.data as any).case_id);
      expect(stuckCaseId).toBeGreaterThan(0);
      await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [
        stuckCaseId,
      ]);
    }
    await pool.query(`DELETE FROM client_pipeline_history WHERE client_id = ?`, [
      stuckId,
    ]);
    await pool.query(`DELETE FROM clients WHERE id = ?`, [stuckId]);

    const converted = await executeAdminAiTool(
      "convert_prospect",
      { client_id: pid, confirm: true, confirm_phrase: "CONFIRM" },
      { adminId },
    );
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const newCaseId = Number((converted.data as any).case_id);
    await pool.query(`DELETE FROM credit_repair_cases WHERE id = ?`, [
      newCaseId,
    ]);
    await pool.query(`DELETE FROM client_pipeline_history WHERE client_id = ?`, [
      pid,
    ]);
    await pool.query(`DELETE FROM clients WHERE id = ?`, [pid]);
  }, 90_000);

  it("requires identifiers / query for case and task tools", async () => {
    const noCase = await executeAdminAiTool("get_case", {}, { adminId });
    expect(noCase.ok).toBe(false);
    expect(noCase.ok === false && noCase.error).toBe("invalid_args");

    const noReport = await executeAdminAiTool(
      "list_progress_reports",
      {},
      { adminId },
    );
    expect(noReport.ok).toBe(false);
    expect(noReport.ok === false && noReport.error).toBe("invalid_args");

    const badRound = await executeAdminAiTool(
      "get_progress_report",
      { case_id: caseId, round: 9 },
      { adminId },
    );
    expect(badRound.ok).toBe(false);
    expect(badRound.ok === false && badRound.error).toBe("invalid_args");

    const noTaskQ = await executeAdminAiTool(
      "search_work_tasks",
      {},
      { adminId },
    );
    expect(noTaskQ.ok).toBe(false);
    expect(noTaskQ.ok === false && noTaskQ.error).toBe("invalid_args");

    const missing = await executeAdminAiTool(
      "get_case",
      { case_number: `CR-MISSING-${RUN_ID}` },
      { adminId },
    );
    expect(missing.ok).toBe(false);
    expect(missing.ok === false && missing.error).toBe("not_found");
  }, 30_000);

  it("send_sms dry-run then send + list_sms + logs SMS note", async () => {
    await pool.query(`UPDATE clients SET phone = ? WHERE id = ?`, [
      "+15559876111",
      clientId,
    ]);

    let phoneId = 0;
    let createdPhone = false;
    const [existingPhones] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM admin_phone_numbers
       WHERE assigned_admin_id = ? AND is_active = 1 LIMIT 1`,
      [adminId],
    );
    if (existingPhones[0]) {
      phoneId = Number(existingPhones[0].id);
    } else {
      const e164 = `+1555${String(Date.now()).slice(-7)}`;
      const [pIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO admin_phone_numbers
           (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
         VALUES (?, 'AI tools OFG', ?, 1, JSON_OBJECT('sms', TRUE))`,
        [e164, adminId],
      );
      phoneId = Number(pIns.insertId);
      createdPhone = true;
    }

    try {
      const dry = await executeAdminAiTool(
        "send_sms",
        {
          client_id: clientId,
          body: `AI SMS dry ${RUN_ID}`,
        },
        { adminId },
      );
      expect(dry.ok).toBe(true);
      if (!dry.ok) return;
      expect((dry.data as any).dry_run).toBe(true);
      expect((dry.data as any).ready).toBe(true);
      expect((dry.data as any).preview?.to).toContain("555");
      expect((dry.data as any).preview?.from).toBeTruthy();

      const noPhrase = await executeAdminAiTool(
        "send_sms",
        {
          client_id: clientId,
          body: `AI SMS dry ${RUN_ID}`,
          confirm: true,
        },
        { adminId },
      );
      expect(noPhrase.ok === false && noPhrase.error).toBe("confirm_required");

      const sent = await executeAdminAiTool(
        "send_sms",
        {
          client_id: clientId,
          body: `AI SMS send ${RUN_ID}`,
          confirm: true,
          confirm_phrase: "CONFIRM",
        },
        { adminId },
      );
      expect(sent.ok).toBe(true);
      if (!sent.ok) return;
      expect((sent.data as any).sent).toBe(true);
      expect((sent.data as any).message_id).toBeGreaterThan(0);
      expect((sent.data as any).provider_message_id).toBeTruthy();
      expect((sent.data as any).provider_status).toBeTruthy();
      expect((sent.data as any).sent_at).toBeTruthy();
      expect((sent.data as any).client_note_appended).toBe(true);

      const [notes] = await pool.query<RowDataPacket[]>(
        `SELECT admin_notes FROM clients WHERE id = ? LIMIT 1`,
        [clientId],
      );
      expect(String(notes[0]?.admin_notes || "")).toContain("[SMS");
      expect(String(notes[0]?.admin_notes || "")).toContain(`AI SMS send ${RUN_ID}`);

      const listed = await executeAdminAiTool(
        "list_sms",
        { client_id: clientId, limit: 10 },
        { adminId },
      );
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      const msgs = (listed.data as any).messages as any[];
      expect(msgs.some((m) => String(m.body || "").includes(`AI SMS send ${RUN_ID}`))).toBe(
        true,
      );
    } finally {
      if (createdPhone && phoneId) {
        await pool
          .query(`DELETE FROM conversation_messages WHERE conversation_id IN (
            SELECT id FROM conversations WHERE client_id = ?
          )`, [clientId])
          .catch(() => {});
        await pool
          .query(`DELETE FROM conversations WHERE client_id = ?`, [clientId])
          .catch(() => {});
        await pool
          .query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [phoneId])
          .catch(() => {});
      }
    }
  }, 90_000);

  it("send_sms refuses missing phone and missing OFG number", async () => {
    // Prior send_sms test may have cleaned up a temporary OFG assignment —
    // ensure adminId has a number so we exercise the client no_phone path.
    let ensurePhoneId = 0;
    const [ofgRows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM admin_phone_numbers
       WHERE assigned_admin_id = ? AND is_active = 1 LIMIT 1`,
      [adminId],
    );
    if (ofgRows[0]) {
      ensurePhoneId = Number(ofgRows[0].id);
    } else {
      const e164 = `+1555${String(Date.now()).slice(-7)}`;
      const [pIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO admin_phone_numbers
           (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
         VALUES (?, 'AI tools OFG refuse', ?, 1, JSON_OBJECT('sms', TRUE))`,
        [e164, adminId],
      );
      ensurePhoneId = Number(pIns.insertId);
    }

    const [noPhoneIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage, preferred_language)
       VALUES ('NoPhone', ?, ?, 'active', 'new_client', 'en')`,
      [RUN_ID, `nophone-${RUN_ID}@example.test`],
    );
    const noPhoneId = Number(noPhoneIns.insertId);

    try {
      const missing = await executeAdminAiTool(
        "send_sms",
        { client_id: noPhoneId, body: "hi" },
        { adminId },
      );
      expect(missing.ok === false && missing.error).toBe("no_phone");

      // Ephemeral admin without OFG number
      const [aIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO admins
           (email, first_name, last_name, role, status, preferred_language)
         VALUES (?, 'No', 'Ofg', 'admin', 'active', 'en')`,
        [`no-ofg-${RUN_ID}@example.test`],
      );
      const bareAdminId = Number(aIns.insertId);
      await pool.query(`UPDATE clients SET phone = '+15559876222' WHERE id = ?`, [
        clientId,
      ]);
      const noOfg = await executeAdminAiTool(
        "send_sms",
        { client_id: clientId, body: "hi" },
        { adminId: bareAdminId },
      );
      expect(noOfg.ok === false && noOfg.error).toBe(
        "conversations_number_required",
      );

      await pool.query(`DELETE FROM admins WHERE id = ?`, [bareAdminId]);
    } finally {
      await pool.query(`DELETE FROM clients WHERE id = ?`, [noPhoneId]);
      // Only delete if we created it in this test (friendly_name marker)
      await pool
        .query(
          `DELETE FROM admin_phone_numbers
           WHERE id = ? AND friendly_name = 'AI tools OFG refuse'`,
          [ensurePhoneId],
        )
        .catch(() => {});
    }
  }, 60_000);

  it("ATLAS aliases send_text/get_texts and list_ofg_phone_numbers", async () => {
    await pool.query(`UPDATE clients SET phone = ? WHERE id = ?`, [
      "+15559876111",
      clientId,
    ]);

    let phoneId = 0;
    let createdPhone = false;
    const [existingPhones] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM admin_phone_numbers
       WHERE assigned_admin_id = ? AND is_active = 1 LIMIT 1`,
      [adminId],
    );
    if (existingPhones[0]) {
      phoneId = Number(existingPhones[0].id);
    } else {
      const e164 = `+1555${String(Date.now()).slice(-7)}`;
      const [pIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO admin_phone_numbers
           (e164, friendly_name, assigned_admin_id, is_active, capabilities_json)
         VALUES (?, 'AI tools OFG alias', ?, 1, JSON_OBJECT('sms', TRUE))`,
        [e164, adminId],
      );
      phoneId = Number(pIns.insertId);
      createdPhone = true;
    }

    try {
      const listedViaAlias = await executeAdminAiTool(
        "get_texts",
        { client_id: clientId, limit: 5 },
        { adminId },
      );
      expect(listedViaAlias.ok).toBe(true);

      const listedConversation = await executeAdminAiTool(
        "get_conversation",
        { client_id: clientId, limit: 5 },
        { adminId },
      );
      expect(listedConversation.ok).toBe(true);

      const dryText = await executeAdminAiTool(
        "send_text",
        {
          client_id: clientId,
          message: `AI alias dry ${RUN_ID}`,
        },
        { adminId },
      );
      expect(dryText.ok).toBe(true);
      if (dryText.ok) {
        expect((dryText.data as any).dry_run).toBe(true);
        expect((dryText.data as any).preview?.body).toContain(
          `AI alias dry ${RUN_ID}`,
        );
      }

      const numbers = await executeAdminAiTool(
        "list_ofg_phone_numbers",
        {},
        { adminId },
      );
      expect(numbers.ok).toBe(true);
      if (numbers.ok) {
        expect(typeof (numbers.data as any).twilio_configured).toBe("boolean");
        expect(Array.isArray((numbers.data as any).numbers)).toBe(true);
        expect((numbers.data as any).numbers.length).toBeGreaterThan(0);
      }
    } finally {
      if (createdPhone && phoneId) {
        await pool
          .query(`DELETE FROM admin_phone_numbers WHERE id = ?`, [phoneId])
          .catch(() => {});
      }
    }
  }, 60_000);

  it("ATLAS funding: search + pipeline + create/status/upload/convert", async () => {
    process.env.VITEST = "true";
    const fundingEmail = `funding-mcp-${RUN_ID}@example.test`;
    const tinyPngB64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let fundingAppId = 0;
    let fundingClientId = 0;

    try {
      const summary = await executeAdminAiTool(
        "funding_pipeline_summary",
        {},
        { adminId },
      );
      expect(summary.ok).toBe(true);
      if (!summary.ok) return;
      expect((summary.data as any).columns.awaiting_docs).toBeTruthy();
      expect((summary.data as any).href).toBe("/admin/funding");

      const dryCreate = await executeAdminAiTool(
        "create_funding_application",
        {
          first_name: "Jose",
          last_name: `Pineda${RUN_ID}`,
          email: fundingEmail,
          phone: "9495550199",
          funding_type: "bank_statements",
          preferred_language: "en",
        },
        { adminId },
      );
      expect(dryCreate.ok).toBe(true);
      if (!dryCreate.ok) return;
      expect((dryCreate.data as any).dry_run).toBe(true);
      expect((dryCreate.data as any).ready).toBe(true);

      const created = await executeAdminAiTool(
        "create_funding_application",
        {
          first_name: "Jose",
          last_name: `Pineda${RUN_ID}`,
          email: fundingEmail,
          phone: "9495550199",
          funding_type: "bank_statements",
          preferred_language: "en",
          confirm: true,
          confirm_phrase: "CONFIRM",
        },
        { adminId },
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      fundingAppId = Number((created.data as any).application?.id || 0);
      fundingClientId = Number((created.data as any).client_id || 0);
      expect(fundingAppId).toBeGreaterThan(0);
      expect(fundingClientId).toBeGreaterThan(0);

      const search = await executeAdminAiTool(
        "search_clients",
        { q: `Pineda${RUN_ID}`, limit: 10 },
        { adminId },
      );
      expect(search.ok).toBe(true);
      if (!search.ok) return;
      const fundingHits = (search.data as any).funding_applications as Array<{
        id: number;
        name: string;
      }>;
      expect(fundingHits.some((f) => f.id === fundingAppId)).toBe(true);

      const dual = await executeAdminAiTool(
        "get_client",
        { client_id: fundingClientId },
        { adminId },
      );
      expect(dual.ok).toBe(true);
      if (!dual.ok) return;
      const apps = (dual.data as any).funding_applications as Array<{
        id: number;
      }>;
      expect(apps.some((a) => a.id === fundingAppId)).toBe(true);

      const getOne = await executeAdminAiTool(
        "get_funding_application",
        { funding_application_id: fundingAppId },
        { adminId },
      );
      expect(getOne.ok).toBe(true);

      const dryStatus = await executeAdminAiTool(
        "update_funding_status",
        {
          funding_application_id: fundingAppId,
          status: "under_review",
        },
        { adminId },
      );
      expect(dryStatus.ok).toBe(true);
      if (dryStatus.ok) {
        expect((dryStatus.data as any).dry_run).toBe(true);
      }

      const statusOk = await executeAdminAiTool(
        "update_funding_status",
        {
          funding_application_id: fundingAppId,
          status: "under_review",
          confirm: true,
          confirm_phrase: "CONFIRM",
        },
        { adminId },
      );
      expect(statusOk.ok).toBe(true);

      const dryUpload = await executeAdminAiTool(
        "upload_funding_document",
        {
          funding_application_id: fundingAppId,
          doc_type: "funding_drivers_license",
          file_name: `dl-${RUN_ID}.png`,
          file_base64: tinyPngB64,
        },
        { adminId },
      );
      expect(dryUpload.ok).toBe(true);
      if (dryUpload.ok) {
        expect((dryUpload.data as any).ready).toBe(true);
      }

      const uploaded = await executeAdminAiTool(
        "upload_funding_document",
        {
          funding_application_id: fundingAppId,
          doc_type: "funding_drivers_license",
          file_name: `dl-${RUN_ID}.png`,
          file_base64: tinyPngB64,
          confirm: true,
          confirm_phrase: "CONFIRM",
        },
        { adminId },
      );
      expect(uploaded.ok).toBe(true);
      if (uploaded.ok) {
        expect(
          ((uploaded.data as any).docs_uploaded as string[]).includes(
            "funding_drivers_license",
          ),
        ).toBe(true);
      }

      const dryConvert = await executeAdminAiTool(
        "convert_funding_application",
        { funding_application_id: fundingAppId },
        { adminId },
      );
      expect(dryConvert.ok).toBe(true);
      if (dryConvert.ok) {
        expect((dryConvert.data as any).dry_run).toBe(true);
      }

      const converted = await executeAdminAiTool(
        "convert_funding_application",
        {
          funding_application_id: fundingAppId,
          confirm: true,
          confirm_phrase: "CONFIRM",
        },
        { adminId },
      );
      expect(converted.ok).toBe(true);
      if (converted.ok) {
        expect((converted.data as any).application?.status).toBe("converted");
        expect((converted.data as any).client_id).toBe(fundingClientId);
      }

      const [cRows] = await pool.query<RowDataPacket[]>(
        `SELECT status, pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
        [fundingClientId],
      );
      expect(cRows[0]?.status).toBe("prospect");
    } finally {
      if (fundingAppId) {
        await pool
          .query(
            `DELETE FROM client_documents WHERE funding_application_id = ?`,
            [fundingAppId],
          )
          .catch(() => {});
        await pool
          .query(`DELETE FROM funding_applications WHERE id = ?`, [
            fundingAppId,
          ])
          .catch(() => {});
      }
      if (fundingClientId && fundingClientId !== clientId) {
        await pool
          .query(`DELETE FROM client_labels WHERE client_id = ?`, [
            fundingClientId,
          ])
          .catch(() => {});
        await pool
          .query(`DELETE FROM clients WHERE id = ?`, [fundingClientId])
          .catch(() => {});
      }
    }
  }, 120_000);
});

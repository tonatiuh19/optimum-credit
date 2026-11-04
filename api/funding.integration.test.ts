/**
 * Business Funding public + admin flows (dry-run SMS/email under VITEST).
 * All fixtures use @{RUN_ID}@example.test — swept in afterAll (never left on board).
 */
import "dotenv/config";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { createServer, createSession, __testClearEmailDryRuns, __testGetEmailDryRuns } from "./index";
import { cleanupIntegrationTestFixtures, createIntegrationTestPool } from "./testDbCleanup";

const RUN_ID = `fund-${Date.now().toString(36)}`;
const AGENT_EMAIL = `funding-agent-${RUN_ID}@example.test`;

const applicationIds: number[] = [];
const clientIds: number[] = [];

describe("business funding", () => {
  let pool: Pool;
  let app: ReturnType<typeof createServer>;
  let adminToken = "";
  let agentToken = "";
  let agentId = 0;

  beforeAll(async () => {
    process.env.VITEST = "true";
    pool = createIntegrationTestPool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin for funding tests");
    adminToken = await createSession(
      "admin",
      Number(admins[0].id),
      String(admins[0].email),
      "127.0.0.1",
      `vitest-funding-${RUN_ID}`,
    );

    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins
         (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Fund', 'Agent', 'agent', 'active', 'en')`,
      [AGENT_EMAIL],
    );
    agentId = Number(ins.insertId);
    agentToken = await createSession(
      "admin",
      agentId,
      AGENT_EMAIL,
      "127.0.0.1",
      `vitest-funding-agent-${RUN_ID}`,
    );
  }, 60_000);

  afterAll(async () => {
    if (agentId) {
      await pool
        .query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [agentId])
        .catch(() => {});
      await pool.query(`DELETE FROM admins WHERE id = ?`, [agentId]).catch(
        () => {},
      );
    }
    await cleanupIntegrationTestFixtures(pool, {
      runId: RUN_ID,
      clientIds,
      applicationIds,
    }).catch(() => {});
    await pool?.end();
  }, 90_000);

  it("starts application, patches secrets, uploads docs, converts to prospect", async () => {
    const email = `funding-${RUN_ID}@example.test`;
    const start = await request(app).post("/api/public/funding").send({
      first_name: "Fund",
      last_name: RUN_ID,
      email,
      phone: "5551234567",
      funding_type: "bank_statements",
      preferred_language: "en",
    });
    expect(start.status).toBe(201);
    expect(start.body.application?.public_token).toBeTruthy();
    const publicToken = String(start.body.application.public_token);
    const applicationId = Number(start.body.application.id);
    const clientId = Number(start.body.application.client_id);
    applicationIds.push(applicationId);
    clientIds.push(clientId);
    expect(clientId).toBeGreaterThan(0);

    const [cRows] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM clients WHERE id = ?`,
      [clientId],
    );
    expect(cRows[0].status).toBe("funding");

    const [pros] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM clients c WHERE c.id = ? AND (
        c.status <> 'cancelled'
        AND c.status <> 'funding'
        AND (c.status = 'prospect' OR c.pipeline_stage = 'prospect')
      )`,
      [clientId],
    );
    expect(pros).toHaveLength(0);

    const patch = await request(app)
      .patch(`/api/public/funding/${publicToken}`)
      .send({
        postal_code: "10001",
        state: "NY",
        llc_name: "Test LLC",
        llc_address: "1 Main St",
        ssn: "123456789",
        ein: "123456789",
      });
    expect(patch.status).toBe(200);
    expect(patch.body.application.has_secrets).toBe(true);

    const slots = [
      "funding_drivers_license",
      "funding_corp_statement",
      "funding_bank_m1",
      "funding_bank_m2",
      "funding_bank_m3",
      "funding_bank_m4",
      "funding_bank_m5",
      "funding_bank_m6",
    ];
    for (const doc_type of slots) {
      const up = await request(app)
        .post(`/api/public/funding/${publicToken}/documents`)
        .field("doc_type", doc_type)
        .attach("file", Buffer.from("%PDF-1.4 funding test"), {
          filename: `${doc_type}.pdf`,
          contentType: "application/pdf",
        });
      expect(up.status).toBe(201);
    }

    // Encrypted bytes go to the CDN as ".enc" (CDN rejects encrypted data
    // under the original ".pdf"/".jpeg" name); original name/MIME stay in DB.
    const [docRows] = await pool.query<RowDataPacket[]>(
      `SELECT storage_key, file_name, mime_type FROM client_documents WHERE funding_application_id = ?`,
      [applicationId],
    );
    expect(docRows.length).toBe(slots.length);
    for (const d of docRows) {
      expect(String(d.storage_key)).toMatch(/\.enc$/);
      expect(String(d.file_name)).toMatch(/\.pdf$/);
      expect(String(d.mime_type)).toBe("application/pdf");
    }

    const submit = await request(app).post(
      `/api/public/funding/${publicToken}/submit`,
    );
    expect(submit.status).toBe(200);
    expect(submit.body.application.docs_complete).toBe(true);
    expect(submit.body.application.docs_complete_notified_at).toBeTruthy();

    const list = await request(app)
      .get("/api/admin/funding")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(
      (list.body.applications || []).some(
        (a: any) => Number(a.id) === applicationId,
      ),
    ).toBe(true);

    const convert = await request(app)
      .post(`/api/admin/funding/${applicationId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(convert.status).toBe(200);
    expect(convert.body.application.status).toBe("converted");

    const [after] = await pool.query<RowDataPacket[]>(
      `SELECT status, pipeline_stage FROM clients WHERE id = ?`,
      [clientId],
    );
    expect(after[0].status).toBe("prospect");
    expect(after[0].pipeline_stage).toBe("prospect");

    const [labels] = await pool.query<RowDataPacket[]>(
      `SELECT l.slug FROM client_labels cl
       JOIN labels l ON l.id = cl.label_id
       WHERE cl.client_id = ? AND l.slug = 'funding_convert'`,
      [clientId],
    );
    expect(labels.length).toBeGreaterThan(0);

    const locked = await request(app)
      .post(`/api/public/funding/${publicToken}/documents`)
      .field("doc_type", "funding_bank_m1")
      .attach("file", Buffer.from("%PDF-1.4"), {
        filename: "again.pdf",
        contentType: "application/pdf",
      });
    expect(locked.status).toBe(409);

    const convertAgain = await request(app)
      .post(`/api/admin/funding/${applicationId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(convertAgain.status).toBe(409);
  }, 180_000);

  it("attaches duplicate email to existing client without demoting active", async () => {
    const email = `active-fund-${RUN_ID}@example.test`;
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, phone, preferred_language, status, pipeline_stage)
       VALUES (?, 'Active', ?, '5559998888', 'en', 'active', 'new_client')`,
      [email, RUN_ID],
    );
    const existingId = Number(ins.insertId);
    clientIds.push(existingId);

    const start = await request(app).post("/api/public/funding").send({
      first_name: "Active",
      last_name: RUN_ID,
      email,
      phone: "5551112222",
      funding_type: "credit_card_stacking",
      preferred_language: "es",
    });
    expect(start.status).toBe(201);
    expect(Number(start.body.application.client_id)).toBe(existingId);
    applicationIds.push(Number(start.body.application.id));

    const [c] = await pool.query<RowDataPacket[]>(
      `SELECT status FROM clients WHERE id = ?`,
      [existingId],
    );
    expect(c[0].status).toBe("active");
  }, 60_000);

  it("admin creates manual funding application on the board", async () => {
    const email = `manual-fund-${RUN_ID}@example.test`;
    __testClearEmailDryRuns();
    const create = await request(app)
      .post("/api/admin/funding")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Manual",
        last_name: RUN_ID,
        email,
        phone: "5554443333",
        funding_type: "credit_card_stacking",
        preferred_language: "en",
        status: "under_review",
      });
    expect(create.status).toBe(201);
    expect(create.body.application?.status).toBe("under_review");
    expect(create.body.application?.email).toBe(email);
    expect(create.body.application?.public_token).toBeTruthy();
    const applicationId = Number(create.body.application.id);
    const clientId = Number(create.body.application.client_id);
    applicationIds.push(applicationId);
    clientIds.push(clientId);

    const dry = __testGetEmailDryRuns();
    expect(
      dry.some(
        (m) =>
          m.to === email &&
          /complete your funding application/i.test(String(m.subject || "")),
      ),
    ).toBe(true);
    expect(
      dry.some((m) =>
        /new funding application/i.test(String(m.subject || "")),
      ),
    ).toBe(true);

    const list = await request(app)
      .get("/api/admin/funding")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(
      (list.body.applications || []).some(
        (a: { id: number }) => Number(a.id) === applicationId,
      ),
    ).toBe(true);

    const agentCreate = await request(app)
      .post("/api/admin/funding")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        first_name: "Blocked",
        last_name: RUN_ID,
        email: `blocked-fund-${RUN_ID}@example.test`,
        funding_type: "bank_statements",
        preferred_language: "en",
      });
    expect(agentCreate.status).toBe(403);
  }, 60_000);

  it("admin funding board supports search and column pagination", async () => {
    const email = `search-fund-${RUN_ID}@example.test`;
    const create = await request(app)
      .post("/api/admin/funding")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        first_name: "Searchable",
        last_name: RUN_ID,
        email,
        funding_type: "bank_statements",
        preferred_language: "en",
        status: "submitted",
      });
    expect(create.status).toBe(201);
    applicationIds.push(Number(create.body.application.id));
    clientIds.push(Number(create.body.application.client_id));

    const searchHit = await request(app)
      .get("/api/admin/funding")
      .query({ search: RUN_ID, limit: 5 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(searchHit.status).toBe(200);
    expect(searchHit.body.columns).toBeTruthy();
    expect(searchHit.body.columns.submitted.total).toBeGreaterThan(0);
    expect(
      (searchHit.body.applications || []).some(
        (a: { email: string }) => a.email === email,
      ),
    ).toBe(true);

    const searchMiss = await request(app)
      .get("/api/admin/funding")
      .query({ search: `nope-${RUN_ID}-xyz` })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(searchMiss.status).toBe(200);
    expect(searchMiss.body.columns.submitted.total).toBe(0);

    const colPage = await request(app)
      .get("/api/admin/funding")
      .query({ column: "submitted", offset: 0, limit: 1 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(colPage.status).toBe(200);
    expect(colPage.body.column).toBe("submitted");
    expect(Array.isArray(colPage.body.items)).toBe(true);
    expect(typeof colPage.body.has_more).toBe("boolean");
  }, 60_000);

  it("blocks agent role from admin funding board", async () => {
    const res = await request(app)
      .get("/api/admin/funding")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(res.status).toBe(403);
  });

  it("portal funding returns applications array for client session", async () => {
    const email = `portal-fund-${RUN_ID}@example.test`;
    const start = await request(app).post("/api/public/funding").send({
      first_name: "Portal",
      last_name: RUN_ID,
      email,
      funding_type: "bank_statements",
      preferred_language: "en",
    });
    expect(start.status).toBe(201);
    const cid = Number(start.body.application.client_id);
    const appId = Number(start.body.application.id);
    applicationIds.push(appId);
    clientIds.push(cid);

    const clientToken = await createSession(
      "client",
      cid,
      email,
      "127.0.0.1",
      `vitest-portal-fund-${RUN_ID}`,
    );
    const portal = await request(app)
      .get("/api/portal/funding")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(portal.status).toBe(200);
    expect(Array.isArray(portal.body.applications)).toBe(true);
    expect(
      portal.body.applications.some((a: any) => Number(a.id) === appId),
    ).toBe(true);
  }, 60_000);

  it("underwriter role: funding board only — docs, stages, notes, requests; everything else 403", async () => {
    const uwEmail = `funding-uw-${RUN_ID}@example.test`;
    const [uwIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Under', 'Writer', 'underwriter', 'active', 'en')`,
      [uwEmail],
    );
    const uwId = Number(uwIns.insertId);
    try {
      const uw = await createSession("admin", uwId, uwEmail, "127.0.0.1", `vitest-funding-uw-${RUN_ID}`);
      const auth = (r: request.Test) => r.set("Authorization", `Bearer ${uw}`);

      // Applicant starts, adds SSN/EIN, uploads the license.
      const start = await request(app).post("/api/public/funding").send({
        first_name: "Under", last_name: RUN_ID, email: `funding-uwapp-${RUN_ID}@example.test`,
        phone: "5551234567", funding_type: "bank_statements", preferred_language: "en",
      });
      expect(start.status).toBe(201);
      const token = String(start.body.application.public_token);
      const appId = Number(start.body.application.id);
      applicationIds.push(appId);
      clientIds.push(Number(start.body.application.client_id));
      await request(app).patch(`/api/public/funding/${token}`).send({ ssn: "123456789", ein: "987654321", llc_name: "UW LLC" });
      const up = await request(app)
        .post(`/api/public/funding/${token}/documents`)
        .field("doc_type", "funding_drivers_license")
        .attach("file", Buffer.from("%PDF-1.4 license"), { filename: "license.pdf", contentType: "application/pdf" });
      expect(up.status).toBe(201);
      const docId = Number(up.body.document_id);

      // Allowed: board, detail, docs, masked SSN/EIN.
      expect((await auth(request(app).get("/api/admin/funding"))).status).toBe(200);
      const detail = await auth(request(app).get(`/api/admin/funding/${appId}`));
      expect(detail.status).toBe(200);
      expect(detail.body.documents.map((d: { id: number }) => d.id)).toContain(docId);
      const masked = await auth(request(app).get(`/api/admin/funding/${appId}/sensitive`));
      expect(masked.body).toEqual({ ssn_masked: "***-**-6789", ein_masked: "**-***4321" });
      const reveal = await auth(request(app).post(`/api/admin/funding/${appId}/sensitive/reveal`).send({ field: "ssn" }));
      expect(reveal.body).toEqual({ field: "ssn", value: "123456789" });
      const file = await auth(request(app).get(`/api/admin/funding/${appId}/documents/${docId}/file`));
      expect(file.status).toBe(200);

      // Stage moves, notes, doc request, upload on behalf.
      expect((await auth(request(app).post(`/api/admin/funding/${appId}/status`).send({ status: "under_review" }))).status).toBe(200);
      const note = await auth(request(app).post(`/api/admin/funding/${appId}/notes`).send({ text: "Bank statements look consistent" }));
      expect(note.body.notes).toMatch(/\(underwriter\)\] Bank statements look consistent/);
      const reqDoc = await auth(request(app).post(`/api/admin/funding/${appId}/documents/${docId}/request`).send({ reason: "License is expired" }));
      expect(reqDoc.status).toBe(200);
      const [st] = await pool.query<RowDataPacket[]>(
        `SELECT f.status, d.review_status, d.rejection_reason FROM funding_applications f
         JOIN client_documents d ON d.funding_application_id = f.id WHERE f.id = ? AND d.id = ?`,
        [appId, docId],
      );
      expect(st[0]).toMatchObject({ status: "awaiting_docs", review_status: "rejected", rejection_reason: "License is expired" });
      const behalf = await auth(
        request(app)
          .post(`/api/admin/funding/${appId}/documents`)
          .field("doc_type", "funding_bank_m1")
          .attach("file", Buffer.from("%PDF-1.4 m1"), { filename: "m1.pdf", contentType: "application/pdf" }),
      );
      expect(behalf.status).toBe(201);

      // Audit trail.
      const [logs] = await pool.query<RowDataPacket[]>(
        `SELECT action FROM funding_access_logs WHERE funding_application_id = ? AND admin_id = ? ORDER BY id`,
        [appId, uwId],
      );
      expect(logs.map((l) => l.action)).toEqual(["reveal_ssn", "view_doc", "status_change", "note", "request_doc", "upload_doc"]);

      // Client re-uploads the requested license → underwriter is told.
      __testClearEmailDryRuns();
      const reup = await request(app)
        .post(`/api/public/funding/${token}/documents`)
        .field("doc_type", "funding_drivers_license")
        .attach("file", Buffer.from("%PDF-1.4 new license"), { filename: "license2.pdf", contentType: "application/pdf" });
      expect(reup.status).toBe(201);
      expect(
        __testGetEmailDryRuns().some((e) => String(e.to).toLowerCase() === uwEmail.toLowerCase() && /Requested document received/.test(String(e.subject))),
      ).toBe(true);

      // The LAST upload auto-submits the application — that alone must
      // email the underwriter; an explicit Submit afterwards must not re-alert.
      __testClearEmailDryRuns();
      for (const slot of ["funding_corp_statement", "funding_bank_m2", "funding_bank_m3", "funding_bank_m4", "funding_bank_m5", "funding_bank_m6", "funding_drivers_license"]) {
        const u = await request(app)
          .post(`/api/public/funding/${token}/documents`)
          .field("doc_type", slot)
          .attach("file", Buffer.from("%PDF-1.4 x"), { filename: `${slot}.pdf`, contentType: "application/pdf" });
        expect(u.status, slot).toBe(201);
      }
      const toUw = () => __testGetEmailDryRuns().filter((e) => String(e.to).toLowerCase() === uwEmail.toLowerCase());
      expect(toUw().map((e) => e.subject)).toEqual([expect.stringMatching(/Funding application submitted/)]);
      const submit = await request(app).post(`/api/public/funding/${token}/submit`);
      expect(submit.status).toBe(200);
      expect(toUw()).toHaveLength(1);

      // Conversation media / recordings: never for underwriters.
      const media = await request(app).get("/api/conversations/media").query({ token: uw, url: "https://api.twilio.com/2010-04-01/x.mp3" });
      expect(media.status).toBe(403);

      // Contained: CRM, clients, conversations, team, convert, create → 403.
      for (const [method, path] of [
        ["get", "/api/admin/clients"],
        ["get", "/api/admin/conversations"],
        ["get", "/api/admin/admins"],
        ["get", `/api/admin/clients/${start.body.application.client_id}`],
      ] as const) {
        const r = await auth(request(app)[method](path));
        expect(r.status, path).toBe(403);
      }
      expect((await auth(request(app).post(`/api/admin/funding/${appId}/convert`))).status).toBe(403);
      expect((await auth(request(app).post("/api/admin/funding").send({}))).status).toBe(403);
      // Notes never reach the public funding payload.
      const pub = await request(app).get(`/api/public/funding/${token}`);
      expect(JSON.stringify(pub.body)).not.toMatch(/consistent/);
    } finally {
      await pool.query(`DELETE FROM funding_access_logs WHERE admin_id = ?`, [uwId]).catch(() => {});
      await pool.query(`DELETE FROM admin_sessions WHERE admin_id = ?`, [uwId]).catch(() => {});
      await pool.query(`DELETE FROM admins WHERE id = ?`, [uwId]).catch(() => {});
    }
  }, 90_000);
});

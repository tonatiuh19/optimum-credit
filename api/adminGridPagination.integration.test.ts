/**
 * Admin grid pagination — documents + tickets list endpoints.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Response as SuperTestResponse } from "supertest";
import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { createServer, createSession } from "./index";
import {
  cleanupIntegrationTestFixtures,
  createIntegrationTestPool,
} from "./testDbCleanup";

const RUN_ID = `gridpg-${Date.now()}`;
const CLIENT_EMAIL = `${RUN_ID}@example.test`;

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminToken = "";
let clientId = 0;
let ticketId = 0;
let docCompletionId = 0;

/** One retry for transient TiDB 5xx under parallel suite load. */
async function getAdminDocuments(
  query: Record<string, string | number>,
): Promise<SuperTestResponse> {
  let last: SuperTestResponse | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await request(app)
      .get("/api/admin/documents")
      .query(query)
      .set("Authorization", `Bearer ${adminToken}`);
    if (last.status === 200) return last;
    // eslint-disable-next-line no-console
    console.warn(
      `[adminGridPagination] documents attempt ${attempt + 1} → ${last.status}`,
      last.body,
    );
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return last!;
}

describe("admin grid pagination — documents and tickets", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    pool = createIntegrationTestPool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins
       WHERE status = 'active' AND role IN ('super_admin','admin','agent')
       ORDER BY id ASC LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No admin");
    adminToken = await createSession(
      "admin",
      Number(admins[0].id),
      String(admins[0].email),
      "127.0.0.1",
      "vitest-grid-pagination",
    );

    const [clientIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients
         (email, first_name, last_name, preferred_language, status, pipeline_stage)
       VALUES (?, 'GridPg', ?, 'en', 'onboarding', 'new_client')`,
      [CLIENT_EMAIL, RUN_ID],
    );
    clientId = clientIns.insertId;

    const [ticketIns] = await pool.query<ResultSetHeader>(
      `INSERT INTO support_tickets
         (client_id, subject, body, status, priority, category)
       VALUES (?, ?, 'Body', 'open', 'normal', 'other')`,
      [clientId, `${RUN_ID} ticket subject`],
    );
    ticketId = ticketIns.insertId;

    const [templates] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM onboarding_task_templates
       WHERE task_type = 'upload' AND slug = 'id_front'
       LIMIT 1`,
    );
    const templateId = templates[0] ? Number(templates[0].id) : 0;
    if (templateId) {
      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM credit_repair_cases WHERE client_id = ? LIMIT 1`,
        [clientId],
      );
      let caseId = caseRows[0] ? Number(caseRows[0].id) : 0;
      if (!caseId) {
        const [caseIns] = await pool.query<ResultSetHeader>(
          `INSERT INTO credit_repair_cases (client_id, pipeline_stage, status)
           VALUES (?, 'new_client', 'active')`,
          [clientId],
        );
        caseId = caseIns.insertId;
      }
      const [docIns] = await pool.query<ResultSetHeader>(
        `INSERT INTO client_task_completions
           (client_id, case_id, task_template_id, status, file_name, file_mime,
            admin_review_status, completed_at)
         VALUES (?, ?, ?, 'completed', ?, 'image/png', 'pending', NOW())`,
        [clientId, caseId, templateId, `${RUN_ID}-id-front.png`],
      );
      docCompletionId = docIns.insertId;
    }
  }, 60_000);

  afterAll(async () => {
    try {
      if (ticketId) {
        await pool.query(
          `DELETE FROM support_ticket_replies WHERE ticket_id = ?`,
          [ticketId],
        );
        await pool.query(`DELETE FROM support_tickets WHERE id = ?`, [
          ticketId,
        ]);
      }
      if (docCompletionId) {
        await pool.query(`DELETE FROM client_task_completions WHERE id = ?`, [
          docCompletionId,
        ]);
      }
      if (clientId) {
        await pool.query(
          `DELETE FROM support_tickets WHERE client_id = ?`,
          [clientId],
        );
        await pool.query(
          `DELETE FROM client_task_completions WHERE client_id = ?`,
          [clientId],
        );
      }
      await cleanupIntegrationTestFixtures(pool, {
        runId: RUN_ID,
        clientIds: clientId ? [clientId] : [],
      });
    } catch (err) {
      console.error("[adminGridPagination] cleanup failed:", err);
      // Always attempt email-scoped client purge even if related deletes failed.
      try {
        await cleanupIntegrationTestFixtures(pool, {
          runId: RUN_ID,
          clientIds: clientId ? [clientId] : [],
        });
      } catch (err2) {
        console.error("[adminGridPagination] cleanup retry failed:", err2);
      }
    } finally {
      await pool.end().catch(() => {});
    }
  }, 60_000);

  it("GET /admin/documents returns pagination and filters by status", async () => {
    const all = await getAdminDocuments({
      search: RUN_ID,
      limit: 10,
      page: 1,
    });
    expect(all.status).toBe(200);
    expect(all.body.pagination).toMatchObject({
      page: 1,
      limit: 10,
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
    expect(all.body.status_counts).toMatchObject({
      all: expect.any(Number),
      pending: expect.any(Number),
      approved: expect.any(Number),
      rejected: expect.any(Number),
    });

    const pending = await getAdminDocuments({
      search: RUN_ID,
      status: "pending",
      limit: 50,
    });
    expect(pending.status).toBe(200);
    if (docCompletionId) {
      expect(pending.body.documents.length).toBeGreaterThanOrEqual(1);
      expect(
        pending.body.documents.every(
          (d: { review_status: string }) => d.review_status === "pending",
        ),
      ).toBe(true);
    }
  }, 45_000);

  it("GET /admin/documents page beyond total returns empty with valid pagination", async () => {
    const res = await getAdminDocuments({
      search: RUN_ID,
      page: 999,
      limit: 50,
    });
    expect(res.status).toBe(200);
    expect(res.body.documents).toEqual([]);
    expect(res.body.pagination.page).toBe(999);
  }, 45_000);

  it("GET /admin/tickets returns pagination and status filter", async () => {
    const all = await request(app)
      .get("/api/admin/tickets")
      .query({ search: RUN_ID, limit: 10, page: 1 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(all.status).toBe(200);
    expect(all.body.pagination).toMatchObject({
      page: 1,
      limit: 10,
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
    expect(all.body.tickets.some((t: { id: number }) => t.id === ticketId)).toBe(
      true,
    );

    const closed = await request(app)
      .get("/api/admin/tickets")
      .query({ search: RUN_ID, status: "closed", limit: 50 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(closed.status).toBe(200);
    expect(
      closed.body.tickets.every(
        (t: { status: string }) => t.status === "closed",
      ),
    ).toBe(true);
  }, 30_000);

  it("GET /admin/tickets search matches subject and client name", async () => {
    const bySubject = await request(app)
      .get("/api/admin/tickets")
      .query({ search: "ticket subject", limit: 10 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(bySubject.status).toBe(200);
    expect(
      bySubject.body.tickets.some((t: { id: number }) => t.id === ticketId),
    ).toBe(true);

    const byName = await request(app)
      .get("/api/admin/tickets")
      .query({ search: "GridPg", limit: 10 })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(byName.status).toBe(200);
    expect(
      byName.body.tickets.some((t: { id: number }) => t.id === ticketId),
    ).toBe(true);
  }, 30_000);
});

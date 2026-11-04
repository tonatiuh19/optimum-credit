/**
 * Defense in depth (Oct 27, 2026): an affiliate-scoped account can never run a
 * write tool, even with confirm=true + CONFIRM — every tool in the shared write
 * list is refused before any branch runs. Reads are not blocked by this gate.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, ResultSetHeader } from "mysql2/promise";
import { ADMIN_AI_WRITE_TOOLS, executeAdminAiTool } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const EMAIL = `vitest-aff-write-${Date.now()}@example.test`;
let pool: Pool;
let affiliateAdminId = 0;

describe("affiliate write block", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST) throw new Error("DB_HOST required");
    pool = createIntegrationTestPool();
    // Affiliate role with no affiliates row → fully locked scope
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO admins (email, first_name, last_name, role, status, preferred_language)
       VALUES (?, 'Aff', 'Vitest', 'affiliate', 'active', 'en')`,
      [EMAIL],
    );
    affiliateAdminId = Number(ins.insertId);
  });

  afterAll(async () => {
    if (affiliateAdminId) await pool.query(`DELETE FROM admins WHERE id = ?`, [affiliateAdminId]);
    await pool.end();
  });

  it.each([...ADMIN_AI_WRITE_TOOLS])("%s is refused for affiliates", async (tool) => {
    const res = await executeAdminAiTool(
      tool,
      { client_id: 1, referrer_id: 1, funding_application_id: 1, confirm: true, confirm_phrase: "CONFIRM" },
      { adminId: affiliateAdminId },
    );
    expect(res).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("reads are not caught by the write gate", async () => {
    const res = await executeAdminAiTool("search_admins", { q: "zzzz-none" }, { adminId: affiliateAdminId });
    expect(res.ok === false ? res.error : "ok").not.toBe("forbidden");
  });
});

/**
 * AI escalation alerts: assigned staffer gets bell + email + SMS (dry-run under
 * vitest); unassigned → every active staff member, never affiliates/inactive.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  notifyInboundAiEscalation,
  resolveInboundAiEscalationRecipients,
} from "./index";
import { cleanupIntegrationTestAdmins, createIntegrationTestPool, uniqueTestE164 } from "./testDbCleanup";

const RUN_ID = `aiesc-${Date.now()}`;
let pool: Pool;
const adminIds: number[] = [];

async function seedAdmin(role: string, status: string, withPhone = true): Promise<number> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO admins (email, first_name, last_name, role, status, preferred_language, phone)
     VALUES (?, 'Esc', ?, ?, ?, 'en', ?)`,
    [`${RUN_ID}-${adminIds.length}@example.test`, RUN_ID, role, status,
      withPhone ? uniqueTestE164(`${RUN_ID}-${adminIds.length}`) : null],
  );
  adminIds.push(Number(r.insertId));
  return Number(r.insertId);
}

describe("AI escalation notifications", () => {
  let agent = 0, inactive = 0, affiliate = 0;
  beforeAll(async () => {
    pool = createIntegrationTestPool();
    agent = await seedAdmin("agent", "active");
    inactive = await seedAdmin("agent", "inactive");
    affiliate = await seedAdmin("affiliate", "active");
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM admin_notifications WHERE admin_id IN (?)`, [adminIds]).catch(() => undefined);
    await cleanupIntegrationTestAdmins(pool, adminIds);
    await pool.end();
  }, 60_000);

  it("assigned staffer: only them, on bell + email + SMS", async () => {
    const out = await notifyInboundAiEscalation({
      assignedAdminId: agent,
      fromLabel: "Jane Client",
      summary: "Wants to cancel",
      linkUrl: "/admin/conversations?client=1",
      channel: "sms",
      fallbackFromE164: "+15550001111",
    });
    expect(out).toEqual([{ adminId: agent, inApp: true, email: true, sms: true }]);
    const [n] = await pool.query<RowDataPacket[]>(
      `SELECT title, body FROM admin_notifications WHERE admin_id = ? ORDER BY id DESC LIMIT 1`,
      [agent],
    );
    expect(String(n[0].title)).toContain("AI escalated SMS — Jane Client");
    expect(String(n[0].body)).toContain("Wants to cancel");
  });

  it("unassigned (or inactive assignee): all active staff, never affiliates or inactive", async () => {
    for (const assigned of [null, inactive]) {
      const { recipients, toAll } = await resolveInboundAiEscalationRecipients(assigned);
      const ids = recipients.map((r) => Number(r.id));
      expect(toAll).toBe(true);
      expect(ids).toContain(agent);
      expect(ids).not.toContain(inactive);
      expect(ids).not.toContain(affiliate);
    }
  });

  it("affiliate as assignee is not alerted; falls back to all staff", async () => {
    const { toAll, recipients } = await resolveInboundAiEscalationRecipients(affiliate);
    expect(toAll).toBe(true);
    expect(recipients.map((r) => Number(r.id))).not.toContain(affiliate);
  });
});

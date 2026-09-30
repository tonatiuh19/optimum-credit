/**
 * Admin morning digest cron — auth + Denver window / force path.
 * Self-contained: scopes to one DB admin and clears today's claim so
 * parallel suite load cannot 404 / double-send flake.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer } from "./index";
import { createIntegrationTestPool, VITEST_CRON_SECRET } from "./testDbCleanup";

const RUN_ID = `am-digest-${Date.now()}`;

let app: ReturnType<typeof createServer>;
let pool: Pool;
let prevCron: string | undefined;
let fixtureAdminId = 0;

/** Match api/index.ts denverParts().ymd (America/Denver calendar day). */
function denverYmd(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function clearDigestClaim(adminId: number, ymd: string): Promise<void> {
  await pool.query<ResultSetHeader>(
    `DELETE FROM audit_logs
     WHERE actor_type = 'system'
       AND action = 'morning_digest.sent'
       AND entity_type = 'admin'
       AND entity_id = ?
       AND JSON_UNQUOTE(JSON_EXTRACT(changes_json, '$.denver_ymd')) = ?`,
    [adminId, ymd],
  );
}

describe("admin morning digest cron", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    prevCron = process.env.CRON_SECRET;
    process.env.CRON_SECRET = VITEST_CRON_SECRET;
    pool = createIntegrationTestPool();
    app = createServer();

    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM admins
       WHERE status = 'active'
         AND role IN ('super_admin', 'admin', 'agent')
         AND email IS NOT NULL AND TRIM(email) <> ''
       ORDER BY id ASC
       LIMIT 1`,
    );
    if (!admins[0]) throw new Error("No active admin for morning digest fixture");
    fixtureAdminId = Number(admins[0].id);
  }, 60_000);

  afterAll(async () => {
    if (prevCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCron;
    await pool?.end().catch(() => undefined);
  });

  it("rejects unauthorized; force run returns ok + results", async () => {
    await request(app).get("/api/cron/admin-morning-digest").expect(401);

    const gated = await request(app)
      .get("/api/cron/admin-morning-digest")
      .set("Authorization", `Bearer ${VITEST_CRON_SECRET}`)
      .expect(200);
    expect(gated.body.ok).toBe(true);
    if (gated.body.skipped) {
      expect(gated.body.reason).toBe("outside_denver_weekday_7am_window");
    }

    const ymd = denverYmd();
    await clearDigestClaim(fixtureAdminId, ymd);

    const scoped = `force=1&admin_id=${fixtureAdminId}`;
    const forced = await request(app)
      .get(`/api/cron/admin-morning-digest?${scoped}`)
      .set("Authorization", `Bearer ${VITEST_CRON_SECRET}`)
      .expect(200);
    expect(forced.body.ok).toBe(true);
    expect(Array.isArray(forced.body.results)).toBe(true);
    expect(forced.body.warning).not.toBe("admin_not_found");
    expect(forced.body.results).toHaveLength(1);
    expect(Number(forced.body.results[0].admin_id)).toBe(fixtureAdminId);

    const firstStatus = String(forced.body.results[0].status || "");
    // prefs_off means no claim — second pass stays prefs_off (still not a duplicate send).
    if (firstStatus === "prefs_off") {
      const again = await request(app)
        .get(`/api/cron/admin-morning-digest?${scoped}`)
        .set("Authorization", `Bearer ${VITEST_CRON_SECRET}`)
        .expect(200);
      expect(again.body.results).toHaveLength(1);
      expect(again.body.results[0].status).toBe("prefs_off");
      return;
    }

    // First pass claimed the day (sent / no_channel / error after claim release).
    // Second force without force_resend must not send again when a claim exists.
    if (firstStatus === "sent" || firstStatus === "no_channel") {
      const again = await request(app)
        .get(`/api/cron/admin-morning-digest?${scoped}`)
        .set("Authorization", `Bearer ${VITEST_CRON_SECRET}`)
        .expect(200);
      expect(again.body.ok).toBe(true);
      expect(again.body.results).toHaveLength(1);
      expect(Number(again.body.results[0].admin_id)).toBe(fixtureAdminId);
      expect(again.body.results[0].status).toBe("already_sent");
      expect(again.body.results[0].status).not.toBe("sent");
      return;
    }

    // error / skipped_wall_clock — claim may have been released; just assert 200 + scoped row.
    const again = await request(app)
      .get(`/api/cron/admin-morning-digest?${scoped}`)
      .set("Authorization", `Bearer ${VITEST_CRON_SECRET}`)
      .expect(200);
    expect(again.body.ok).toBe(true);
    expect(again.body.results).toHaveLength(1);
    expect(Number(again.body.results[0].admin_id)).toBe(fixtureAdminId);
  }, 90_000);
});

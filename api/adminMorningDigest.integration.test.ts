/**
 * Admin morning digest cron — auth + Denver window / force path.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";

const RUN_ID = `am-digest-${Date.now()}`;

let app: ReturnType<typeof createServer>;
let prevCron: string | undefined;

describe("admin morning digest cron", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) {
      throw new Error("DB_HOST / JWT_SECRET required");
    }
    prevCron = process.env.CRON_SECRET;
    process.env.CRON_SECRET = `vitest-cron-${RUN_ID}`;
    app = createServer();
  }, 60_000);

  afterAll(() => {
    if (prevCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevCron;
  });

  it("rejects unauthorized; force run returns ok + results", async () => {
    await request(app).get("/api/cron/admin-morning-digest").expect(401);

    const gated = await request(app)
      .get("/api/cron/admin-morning-digest")
      .set("Authorization", `Bearer ${process.env.CRON_SECRET}`)
      .expect(200);
    expect(gated.body.ok).toBe(true);
    // Outside 7am Denver weekdays → skipped; inside window may send
    if (gated.body.skipped) {
      expect(gated.body.reason).toBe("outside_denver_weekday_7am_window");
    }

    const forced = await request(app)
      .get("/api/cron/admin-morning-digest?force=1")
      .set("Authorization", `Bearer ${process.env.CRON_SECRET}`)
      .expect(200);
    expect(forced.body.ok).toBe(true);
    expect(Array.isArray(forced.body.results)).toBe(true);

    // Second force without force_resend must not duplicate-send
    const again = await request(app)
      .get("/api/cron/admin-morning-digest?force=1")
      .set("Authorization", `Bearer ${process.env.CRON_SECRET}`)
      .expect(200);
    expect(again.body.ok).toBe(true);
    const statuses = (again.body.results || []).map(
      (r: { status: string }) => r.status,
    );
    expect(statuses.every((s: string) => s !== "sent")).toBe(true);
  }, 90_000);
});

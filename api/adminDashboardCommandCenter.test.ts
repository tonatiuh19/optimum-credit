/**
 * Admin dashboard command center: "Needs you" inbox, 8-week pulse, activity,
 * Everyone / Mine scope, money only for super admins.
 */
import "dotenv/config";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { buildDashboardInbox, createServer, createSession, weekStartYmd } from "./index";

describe("buildDashboardInbox", () => {
  it("keeps only non-zero rows, alerts first, with links", () => {
    const rows = buildDashboardInbox({ tickets_open: 2, tasks_overdue: 1, docs_review: 0, conversations_unread: 5 });
    expect(rows.map((r) => r.key)).toEqual(["tasks_overdue", "conversations_unread", "tickets_open"]);
    expect(rows[0]).toEqual({ key: "tasks_overdue", tone: "alert", to: "/admin/my-tasks", count: 1 });
  });
  it("empty when nothing is waiting", () => {
    expect(buildDashboardInbox({})).toEqual([]);
  });
});

describe("weekStartYmd", () => {
  it("Monday-start weeks (UTC)", () => {
    expect(weekStartYmd(new Date("2026-10-22T15:00:00Z"))).toBe("2026-10-19"); // Thu → Mon
    expect(weekStartYmd(new Date("2026-10-19T00:00:00Z"))).toBe("2026-10-19"); // Mon
    expect(weekStartYmd(new Date("2026-10-25T23:00:00Z"))).toBe("2026-10-19"); // Sun
  });
});

describe("GET /api/admin/dashboard (command center)", () => {
  let app: ReturnType<typeof createServer>;
  let superTok = "";
  beforeAll(async () => {
    app = createServer();
    superTok = await createSession("admin", 30001, "dash-test@example.com", "127.0.0.1", "vitest-dashboard");
  }, 30_000);

  it("everyone: inbox, 8 pulse weeks, activity, money for super admins; legacy fields kept", async () => {
    const r = await request(app).get("/api/admin/dashboard").set("Authorization", `Bearer ${superTok}`);
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe("everyone");
    expect(r.body.is_super).toBe(true);
    expect(Array.isArray(r.body.inbox)).toBe(true);
    expect(r.body.inbox.every((i: any) => i.count > 0)).toBe(true);
    expect(r.body.pulse.weeks).toHaveLength(8);
    expect(r.body.activity.length).toBeLessThanOrEqual(15);
    for (const k of ["stages", "stats", "recent_clients", "recent_tickets", "recent_payments", "upcoming_rounds", "my_work_tasks"]) {
      expect(r.body).toHaveProperty(k);
    }
    expect(r.body.stats.revenue_cents_30d).not.toBeNull();
  }, 60_000);

  it("mine: scoped counts never exceed everyone's", async () => {
    const all = await request(app).get("/api/admin/dashboard").set("Authorization", `Bearer ${superTok}`);
    const mine = await request(app).get("/api/admin/dashboard?mine=1").set("Authorization", `Bearer ${superTok}`);
    expect(mine.body.scope).toBe("mine");
    const n = (body: any, k: string) => body.inbox.find((i: any) => i.key === k)?.count ?? 0;
    for (const k of ["docs_review", "conversations_unread", "rounds_due", "tickets_open"]) expect(n(mine.body, k)).toBeLessThanOrEqual(n(all.body, k));
    expect(mine.body.upcoming_rounds.length).toBeLessThanOrEqual(all.body.upcoming_rounds.length);
    const s = (body: any) => body.pulse.weeks.reduce((t: number, w: any) => t + w.new_clients, 0);
    expect(s(mine.body)).toBeLessThanOrEqual(s(all.body));
  }, 60_000);
});

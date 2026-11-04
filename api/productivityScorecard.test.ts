/**
 * GF-8 productivity scorecard: per-metric 0–100 vs target, weighted total,
 * grades, level gates (Bronze → Silver → Gold), streaks, badges, Pacific days,
 * and the API access rules (own card; managers see all).
 */
import "dotenv/config";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  PRODUCTIVITY_METRICS,
  addDaysYmd,
  computeProductivityDay,
  createServer,
  createSession,
  isWeekendYmd,
  laWallToUtc,
  laYmd,
  productivityBadgesForDay,
  productivityGrade,
  productivityLevelFromHistory,
  productivityStreak,
  productivityWeekAverage,
  scoreProductivityMetric,
} from "./index";

const def = (profile: "ops" | "sales", key: string) => PRODUCTIVITY_METRICS[profile].find((m) => m.key === key)!;

describe("metric weights", () => {
  it("each profile sums to 100", () => {
    for (const p of ["ops", "sales"] as const) expect(PRODUCTIVITY_METRICS[p].reduce((n, m) => n + m.weight, 0)).toBe(100);
  });
});

describe("scoreProductivityMetric", () => {
  it("ratio vs target share, capped at 100", () => {
    expect(scoreProductivityMetric(def("ops", "daily_list"), { done: 3, total: 4 })).toBe(75);
    // 95% target: 19/20 = 100
    expect(scoreProductivityMetric(def("ops", "rounds_on_time"), { done: 19, total: 20 })).toBe(100);
    expect(scoreProductivityMetric(def("ops", "rounds_on_time"), { done: 9, total: 10 })).toBeCloseTo(94.7, 1);
  });
  it("nothing pending is not graded", () => {
    expect(scoreProductivityMetric(def("ops", "daily_list"), { done: 0, total: null })).toBeNull();
    expect(scoreProductivityMetric(def("ops", "daily_list"), { done: 0, total: 0 })).toBeNull();
  });
  it("count metrics use the (pro-rated) target", () => {
    expect(scoreProductivityMetric(def("sales", "connected_calls"), { done: 3, total: 3 })).toBe(60);
    expect(scoreProductivityMetric(def("sales", "closes"), { done: 1, total: 1, target: 0.8 })).toBe(100);
    expect(scoreProductivityMetric(def("sales", "closes"), { done: 0, total: 0, target: 1.2 })).toBe(0);
  });
  it("zero-target: corrections", () => {
    expect(scoreProductivityMetric(def("ops", "corrections"), { done: 0, total: 1 })).toBe(100);
    expect(scoreProductivityMetric(def("ops", "corrections"), { done: 1, total: 1 })).toBe(0);
  });
  it("Slack not connected is not graded", () => {
    expect(scoreProductivityMetric(def("ops", "slack_report"), { done: 1, total: 1, unavailable: "slack_not_connected" })).toBeNull();
  });
});

describe("computeProductivityDay", () => {
  it("renormalizes over graded, unlocked metrics (Bronze)", () => {
    const d = computeProductivityDay(
      "ops",
      {
        daily_list: { done: 4, total: 4 }, // 100 × 25
        inbound_reply: { done: 1, total: 2 }, // 50 × 15
        rounds_on_time: { done: 0, total: null }, // not graded
        report_partner: { done: 2, total: 2 }, // 100 × 15
        call_notes: { done: 0, total: 3 }, // locked (Silver)
      },
      "bronze",
    );
    expect(d.total).toBeCloseTo((100 * 25 + 50 * 15 + 100 * 15) / 55, 1);
    expect(d.grade).toBe("B");
    const notes = d.metrics.find((m) => m.key === "call_notes")!;
    expect(notes.locked).toBe(true);
    expect(notes.reason).toBe("locked");
    expect(d.metrics.find((m) => m.key === "rounds_on_time")!.reason).toBe("nothing_pending");
  });
  it("Silver unlocks Silver metrics; no graded metric = no grade", () => {
    const d = computeProductivityDay("ops", { call_notes: { done: 0, total: 3 } }, "silver");
    expect(d.metrics.find((m) => m.key === "call_notes")!.locked).toBe(false);
    expect(d.total).toBe(0);
    expect(computeProductivityDay("sales", {}, "gold").total).toBeNull();
  });
});

describe("grades / levels / streaks / badges", () => {
  it("grade bands", () => {
    expect([95, 90, 89.9, 80, 75, 60, 59.9].map(productivityGrade)).toEqual(["A", "A", "B", "B", "C", "D", "F"]);
    expect(productivityGrade(null)).toBeNull();
  });
  it("Silver after 5 graded days averaging B+; Gold after 10 more", () => {
    expect(productivityLevelFromHistory([90, 85, null, 80, 82]).level).toBe("bronze");
    const s = productivityLevelFromHistory([90, 85, null, 80, 82, 88]);
    expect(s.level).toBe("silver");
    expect(s.progress).toEqual({ days: 0, needed: 10, avg: null });
    expect(productivityLevelFromHistory([...Array(5).fill(90), ...Array(10).fill(85)]).level).toBe("gold");
    // A weak window keeps sliding until the last 5 average B+.
    expect(productivityLevelFromHistory([50, 90, 90, 90, 90, 90]).level).toBe("silver");
  });
  it("streak skips ungraded days and breaks below B", () => {
    expect(productivityStreak([70, 85, null, 92, 80])).toBe(3);
    expect(productivityStreak([85, 79])).toBe(0);
  });
  it("badges", () => {
    const day = computeProductivityDay("sales", { connected_calls: { done: 11, total: 11 }, closes: { done: 2, total: 2, target: 2 } }, "bronze");
    const b = productivityBadgesForDay({ total: day.total, metrics: day.metrics, history: [90, 90, 90, 90, 95], level: "silver", weekTotals: [95, 95, 95, 95, 95] });
    expect(b).toEqual(expect.arrayContaining(["first_a", "streak_5", "level_silver", "perfect_week", "closer", "hot_hands"]));
    expect(b).not.toContain("level_gold");
  });
  it("week average ignores ungraded days", () => {
    expect(productivityWeekAverage([90, null, 80])).toBe(85);
    expect(productivityWeekAverage([null])).toBeNull();
  });
});

describe("Pacific day helpers", () => {
  it("4 PM PT across DST", () => {
    expect(laWallToUtc("2026-10-23", 16).toISOString()).toBe("2026-10-23T23:00:00.000Z"); // PDT
    expect(laWallToUtc("2026-11-20", 16).toISOString()).toBe("2026-11-21T00:00:00.000Z"); // PST
    expect(laYmd(new Date("2026-10-24T06:30:00Z"))).toBe("2026-10-23");
  });
  it("weekends / day math", () => {
    expect(isWeekendYmd("2026-10-24")).toBe(true);
    expect(isWeekendYmd("2026-10-23")).toBe(false);
    expect(addDaysYmd("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("API access", () => {
  let app: ReturnType<typeof createServer>;
  let manager: string;
  let lecca: string;
  let other: string;
  beforeAll(async () => {
    app = createServer();
    [manager, lecca, other] = await Promise.all([
      createSession("admin", 90001, "prod-mgr@example.com", "127.0.0.1", "vitest-productivity"),
      createSession("admin", 150002, "prod-ops@example.com", "127.0.0.1", "vitest-productivity"),
      createSession("admin", 120001, "prod-sales@example.com", "127.0.0.1", "vitest-productivity"),
    ]);
  }, 60_000);

  it("scored staff get their own card; not someone else's", async () => {
    const acc = await request(app).get("/api/admin/productivity/access").set("Authorization", `Bearer ${lecca}`);
    expect(acc.body).toEqual({ can_view: true, is_manager: false, scored: true });
    const me = await request(app).get("/api/admin/productivity/me").set("Authorization", `Bearer ${lecca}`);
    expect(me.status).toBe(200);
    expect(me.body.today.profile).toBe("ops");
    expect(me.body.today.metrics).toHaveLength(8);
    const peek = await request(app).get("/api/admin/productivity/me?admin_id=120001").set("Authorization", `Bearer ${lecca}`);
    expect(peek.status).toBe(403);
    const team = await request(app).get("/api/admin/productivity/team").set("Authorization", `Bearer ${other}`);
    expect(team.status).toBe(403);
  }, 120_000);

  it("managers see the team and any card", async () => {
    const team = await request(app).get("/api/admin/productivity/team").set("Authorization", `Bearer ${manager}`);
    expect(team.status).toBe(200);
    expect(team.body.members.map((m: any) => m.admin_id).sort()).toEqual([120001, 150002]);
    const sales = await request(app).get("/api/admin/productivity/me?admin_id=120001").set("Authorization", `Bearer ${manager}`);
    expect(sales.body.today.profile).toBe("sales");
    expect(sales.body.today.metrics.find((m: any) => m.key === "daily_posts").locked).toBe(true);
  }, 120_000);
});

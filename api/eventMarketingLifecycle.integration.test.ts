/**
 * Event marketing lifecycle (Nov 9, 2026). Checks:
 *  - existing CRM people are never overwritten; typed values stay on the registration + mismatch flag
 *  - re-submitting is idempotent (one row, nothing re-sent)
 *  - the last seat cannot be taken twice (row lock), full sessions waitlist, cancel promotes
 *  - door QR self check-in: no names leaked, walk-ins registered, window enforced
 *  - paper sign-in sheet import, results funnel, calendar file
 *  - reminders / auto-complete / attended vs no-show follow-up run once (cron step)
 *  - cancel / reschedule notify registrants
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  createServer,
  createSession,
  eventCheckInWindowOpen,
  eventLifecycleCopy,
  eventProfileMismatch,
  eventSqlDateTime,
  laWallClockAsUtcDate,
  runEventMarketingCronStep,
} from "./index";
import {
  cleanupIntegrationTestClients,
  createIntegrationTestPool,
  uniqueTestE164,
} from "./testDbCleanup";

const RUN = `evlc${Date.now()}`;
let pool: Pool;
let app: ReturnType<typeof createServer>;
let token = "";
let companyId = 0;
let seriesId = 0;
const slug = `vt-${RUN}`.slice(0, 40);
const sessions: Record<string, number> = {};
const clientIds = new Set<number>();
const email = (k: string) => `${k}-${RUN}@example.test`;
const phone = (k: string) => uniqueTestE164(`${RUN}-${k}`);

/** Fixed "now": LA midday two days ahead, so follow-ups are inside 9am–8pm. */
const NOW = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  d.setUTCHours(20, 0, 0, 0);
  return d;
})();
const laAt = (hoursFromNow: number) =>
  eventSqlDateTime(new Date(laWallClockAsUtcDate(NOW).getTime() + hoursFromNow * 3600_000));
const laNowReal = (hoursFromNow: number) =>
  eventSqlDateTime(new Date(laWallClockAsUtcDate().getTime() + hoursFromNow * 3600_000));

let smsLog: string[] = [];
const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
  if (args[0] === "[sms:dry-run]") smsLog.push(`${args[2]}|${String(args[3])}`);
});
const smsTo = (p: string) => smsLog.filter((l) => l.startsWith(`${p}|`) || l.startsWith(`${p.replace("+", "")}|`));

async function addSession(key: string, startsAt: string, endsAt: string | null, capacity: number | null) {
  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO event_sessions (company_id, series_id, short_code, title_en, title_es, starts_at, ends_at, capacity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [companyId, seriesId, `${RUN}-${key}`.slice(0, 32), `Night ${key}`, `Noche ${key}`, startsAt, endsAt, capacity],
  );
  sessions[key] = ins.insertId;
  return ins.insertId;
}

async function register(key: string, sessionKey: string, over: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/public/event-marketing/register")
    .send({
      company_slug: slug,
      session_id: sessions[sessionKey],
      source_qr: "session",
      answers: {
        first_name: `First${key}`,
        last_name: `Last${key}`,
        email: email(key),
        phone: phone(key),
        preferred_language: "en",
        ...over,
      },
    });
  if (res.body?.client_id) clientIds.add(Number(res.body.client_id));
  return res;
}

const regRow = async (key: string, sessionKey: string) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT er.* FROM event_registrations er JOIN clients c ON c.id = er.client_id
     WHERE c.email = ? AND er.session_id = ?`,
    [email(key), sessions[sessionKey]],
  );
  return rows;
};

const admin = (method: "get" | "post" | "patch" | "put" | "delete", url: string) =>
  (request(app) as any)[method](url).set("Authorization", `Bearer ${token}`);

describe("event marketing lifecycle", () => {
  beforeAll(async () => {
    pool = createIntegrationTestPool();
    app = createServer();
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins WHERE status = 'active' AND role IN ('super_admin','admin') ORDER BY id ASC LIMIT 1`,
    );
    token = await createSession("admin", Number(admins[0].id), String(admins[0].email), "127.0.0.1", `vitest-${RUN}`);
    const [c] = await pool.query<ResultSetHeader>(
      `INSERT INTO event_companies (slug, name, label_slug, welcome_heading_en, welcome_heading_es, welcome_body_en, welcome_body_es,
         email_subject_en, email_subject_es, email_body_en, email_body_es, sms_body_en, sms_body_es)
       VALUES (?, 'Vitest School', 'event_marketing', 'Hi', 'Hola', 'b', 'b', 'You are in', 'Listo', 'Hi {{first_name}}', 'Hola {{first_name}}',
         'Registered {{first_name}}', 'Registrado {{first_name}}')`,
      [slug],
    );
    companyId = c.insertId;
    const [s] = await pool.query<ResultSetHeader>(
      `INSERT INTO event_series (company_id, slug, name_en, name_es) VALUES (?, 'night', 'Night', 'Noche')`,
      [companyId],
    );
    seriesId = s.insertId;
    // Real-time sessions (registration + door check-in) …
    await addSession("main", laNowReal(48), laNowReal(50), 1);
    await addSession("race", laNowReal(48), null, 1);
    await addSession("door", laNowReal(1), laNowReal(3), null);
    await addSession("closed", laNowReal(72), null, null);
    // … and NOW-relative sessions for the cron step.
    await addSession("tomorrow", laAt(20), null, null);
    await addSession("past", laAt(-4), laAt(-2), null);
    // Existing CRM person (must never be overwritten).
    const [cl] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (email, first_name, last_name, phone, preferred_language, status, pipeline_stage)
       VALUES (?, 'Realname', 'Crm', ?, 'en', 'prospect', 'prospect')`,
      [email("existing"), phone("existing-crm")],
    );
    clientIds.add(cl.insertId);
  }, 60_000);

  afterAll(async () => {
    logSpy.mockRestore();
    if (companyId) await pool.query(`DELETE FROM event_companies WHERE id = ?`, [companyId]);
    const [extra] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM clients WHERE email LIKE ? OR (email IS NULL AND last_name LIKE ?)`,
      [`%-${RUN}@example.test`, `%${RUN}%`],
    );
    for (const r of extra) clientIds.add(Number(r.id));
    if (clientIds.size) {
      await cleanupIntegrationTestClients(pool, { runId: RUN, clientIds: [...clientIds] });
    }
    await pool.end();
  }, 60_000);

  it("pure helpers: mismatch ignores blank CRM fields; window bounds; copy fits one SMS", () => {
    expect(eventProfileMismatch({ first_name: "", last_name: null, phone: "" }, { firstName: "A", lastName: "B", phone: "5551112222" })).toBe(false);
    expect(eventProfileMismatch({ first_name: "Ana", phone: "(555) 111-2222" }, { firstName: "ana", lastName: "", phone: "+15551112222" })).toBe(false);
    expect(eventProfileMismatch({ first_name: "Ana", phone: "5551112222" }, { firstName: "Ana", lastName: "", phone: "5559998888" })).toBe(true);
    const now = new Date(Date.UTC(2026, 10, 10, 12, 0));
    expect(eventCheckInWindowOpen("2026-11-10 14:00:00", null, now)).toBe(true); // 2h before
    expect(eventCheckInWindowOpen("2026-11-10 16:00:00", null, now)).toBe(false); // 4h before
    expect(eventCheckInWindowOpen("2026-11-10 05:00:00", "2026-11-10 09:00:00", now)).toBe(false); // 3h after end
    const vars = { first_name: "Maximiliano", title: "Family Fun Night — Fontana + Rancho Cucamonga", when: "Thu, Oct 22, 5:00 PM", location: ", 1234 Long Street Name, Rancho Cucamonga, CA", link: "https://www.ofgllc.com/x" };
    for (const lang of ["en", "es"] as const) {
      for (const k of ["waitlisted", "promoted", "reminder_24h", "reminder_2h", "cancelled", "rescheduled", "followup_attended", "followup_no_show"] as const) {
        expect(eventLifecycleCopy(k, lang, vars).text.length).toBeLessThanOrEqual(320);
      }
    }
  });

  it("never overwrites an existing person; flags the mismatch; keeps what was typed", async () => {
    const res = await register("existing", "main", { first_name: "Impostor", phone: phone("attacker") });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: "registered", duplicate: false });
    expect(res.body.calendar_url).toMatch(/calendar\.ics/);
    const [crm] = await pool.query<RowDataPacket[]>(`SELECT first_name, phone FROM clients WHERE email = ?`, [email("existing")]);
    expect(crm[0].first_name).toBe("Realname");
    expect(crm[0].phone).toBe(phone("existing-crm"));
    const rows = await regRow("existing", "main");
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].profile_mismatch)).toBe(1);
    const answers = typeof rows[0].answers_json === "string" ? JSON.parse(rows[0].answers_json) : rows[0].answers_json;
    expect(answers.first_name).toBe("Impostor");
  });

  it("re-submitting is idempotent: one row, nothing re-sent", async () => {
    smsLog = [];
    const res = await register("existing", "main", { first_name: "Impostor", phone: phone("attacker") });
    expect(res.body).toMatchObject({ ok: true, duplicate: true, sms_sent: false, email_sent: false });
    expect(await regRow("existing", "main")).toHaveLength(1);
    expect(smsLog).toHaveLength(0);
  });

  it("full session waitlists with its own text; cancelling a seat promotes the waitlist", async () => {
    smsLog = [];
    const res = await register("wait", "main");
    expect(res.body.status).toBe("waitlisted");
    expect(res.body.calendar_url).toBeNull();
    expect(smsTo(phone("wait")).join(" ")).toMatch(/waitlist/i);
    const seat = await regRow("existing", "main");
    smsLog = [];
    const cancel = await admin("post", `/api/admin/event-marketing/registrations/${seat[0].id}/cancel`);
    expect(cancel.status).toBe(200);
    const promoted = await regRow("wait", "main");
    expect(promoted[0].status).toBe("registered");
    expect(smsTo(phone("wait")).join(" ")).toMatch(/spot opened/i);
  });

  it("a cancelled person who signs up again reuses their row and joins the waitlist when full", async () => {
    const res = await register("existing", "main", { first_name: "Impostor", phone: phone("attacker") });
    expect(res.body).toMatchObject({ ok: true, duplicate: false, status: "waitlisted" });
    const rows = await regRow("existing", "main");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("waitlisted");
  });

  it("five people racing for the last seat: exactly one gets it", async () => {
    const all = await Promise.all(["raceA", "raceB", "raceC", "raceD", "raceE"].map((k) => register(k, "race")));
    expect(all.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(all.map((r) => r.body.status).sort()).toEqual(["registered", "waitlisted", "waitlisted", "waitlisted", "waitlisted"]);
    const [a, b] = all;
    expect([a.status, b.status]).toEqual([200, 200]);
    void a; void b;
    const [cnt] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM event_registrations WHERE session_id = ? AND status = 'registered'`,
      [sessions.race],
    );
    expect(Number(cnt[0].n)).toBe(1);
  });

  it("door QR: checks in by phone without revealing who; walk-ins register; repeat is safe", async () => {
    await register("doorguest", "door");
    const tok = await admin("post", `/api/admin/event-marketing/sessions/${sessions.door}/checkin-token`);
    expect(tok.status).toBe(200);
    expect(tok.body.url).toContain(`/e/checkin/${tok.body.token}`);
    const again = await admin("post", `/api/admin/event-marketing/sessions/${sessions.door}/checkin-token`);
    expect(again.body.token).toBe(tok.body.token);

    const info = await request(app).get(`/api/public/event-marketing/check-in/${tok.body.token}`);
    expect(info.status).toBe(200);
    expect(info.body.window_open).toBe(true);
    expect(JSON.stringify(info.body)).not.toContain(email("doorguest"));

    const hit = await request(app).post(`/api/public/event-marketing/check-in/${tok.body.token}`).send({ phone: phone("doorguest") });
    expect(hit.body).toEqual({ status: "checked_in" });
    const repeat = await request(app).post(`/api/public/event-marketing/check-in/${tok.body.token}`).send({ phone: phone("doorguest") });
    expect(repeat.body).toEqual({ status: "already_checked_in" });
    const row = await regRow("doorguest", "door");
    expect(row[0].check_in_method).toBe("self");

    const unknown = await request(app).post(`/api/public/event-marketing/check-in/${tok.body.token}`).send({ phone: phone("walkin") });
    expect(unknown.body).toEqual({ status: "needs_registration" });
    const walkIn = await request(app)
      .post(`/api/public/event-marketing/check-in/${tok.body.token}`)
      .send({ answers: { first_name: "Walk", last_name: `In${RUN}`, phone: phone("walkin"), email: email("walkin") } });
    expect(walkIn.body).toEqual({ status: "checked_in" });
    const w = await regRow("walkin", "door");
    expect(w).toHaveLength(1);
    expect(w[0].check_in_method).toBe("self");

    const bad = await request(app).post(`/api/public/event-marketing/check-in/not-a-token`).send({ phone: phone("doorguest") });
    expect(bad.status).toBe(404);
  });

  it("door QR is refused outside the session window", async () => {
    const tok = await admin("post", `/api/admin/event-marketing/sessions/${sessions.closed}/checkin-token`);
    const info = await request(app).get(`/api/public/event-marketing/check-in/${tok.body.token}`);
    expect(info.body.window_open).toBe(false);
    const hit = await request(app).post(`/api/public/event-marketing/check-in/${tok.body.token}`).send({ phone: phone("doorguest") });
    expect(hit.status).toBe(409);
  });

  it("paper sign-in sheet import: seats + checks in, flags bad rows, never sends texts", async () => {
    smsLog = [];
    const res = await admin("post", `/api/admin/event-marketing/sessions/${sessions.past}/import`).send({
      rows: [
        { first_name: "Paper", last_name: `One${RUN}`, phone: phone("paper1") },
        { first_name: "Paper", last_name: `Two${RUN}`, phone: phone("paper2"), email: email("paper2"), attended: false },
        { first_name: "Bad", last_name: "Phone", phone: "123" },
        { first_name: "", last_name: "Noname", phone: phone("paper3") },
        { first_name: "Paper", last_name: `One${RUN}`, phone: phone("paper1") },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ imported: 2, duplicates: 1, failed: 2 });
    expect(res.body.results[2].error).toBe("invalid_phone");
    expect(res.body.results[3].error).toBe("name_required");
    expect(smsLog).toHaveLength(0);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT check_in_method, checked_in_at FROM event_registrations WHERE session_id = ? ORDER BY id`,
      [sessions.past],
    );
    expect(rows.map((r) => r.check_in_method)).toEqual(["import", null]);
  });

  it("cron: 24h reminder once, auto-complete, attended vs no-show follow-up once", async () => {
    await register("remind", "tomorrow");
    await pool.query(
      `UPDATE event_registrations SET created_at = NOW() - INTERVAL 2 DAY WHERE session_id = ?`,
      [sessions.tomorrow],
    );
    smsLog = [];
    const scope = { sessionIds: [sessions.tomorrow, sessions.past], now: NOW };
    const first = await runEventMarketingCronStep(scope);
    expect(first.reminders_24h).toBe(1);
    expect(first.completed).toBe(1);
    expect(first.followups).toBe(2);
    expect(smsTo(phone("remind")).join(" ")).toMatch(/tomorrow/i);
    expect(smsTo(phone("paper1")).join(" ")).toMatch(/Thanks for coming/);
    expect(smsTo(phone("paper2")).join(" ")).toMatch(/missed you/);
    const second = await runEventMarketingCronStep(scope);
    expect(second).toEqual({ reminders_24h: 0, reminders_2h: 0, completed: 0, followups: 0 });
  });

  it("reschedule and cancel notify registrants; reschedule re-arms reminders", async () => {
    smsLog = [];
    const moved = await admin("put", `/api/admin/event-marketing/sessions/${sessions.tomorrow}`).send({ starts_at: laAt(30).replace(" ", "T") });
    expect(moved.status).toBe(200);
    expect(moved.body.notified).toBe(1);
    expect(smsTo(phone("remind")).join(" ")).toMatch(/new date/i);
    const r = await regRow("remind", "tomorrow");
    expect(r[0].reminder_24h_sent_at).toBeNull();
    smsLog = [];
    const cancelled = await admin("put", `/api/admin/event-marketing/sessions/${sessions.tomorrow}`).send({ status: "cancelled" });
    expect(cancelled.body.notified).toBe(1);
    expect(smsTo(phone("remind")).join(" ")).toMatch(/we.re sorry/i);
  });

  it("results funnel counts each stage; calendar file is valid", async () => {
    // A client who was already paying before registering is NOT "became a client";
    // a new one who pays afterwards is.
    const [paperRows] = await pool.query<RowDataPacket[]>(
      `SELECT er.client_id, er.created_at FROM event_registrations er WHERE er.session_id = ? ORDER BY er.id`,
      [sessions.past],
    );
    const [oldPayer, newPayer] = paperRows.map((r) => Number(r.client_id));
    await pool.query(
      `INSERT INTO payments (client_id, amount_cents, status, provider, paid_at, created_at)
       VALUES (?, 10000, 'succeeded', 'manual', NOW() - INTERVAL 30 DAY, NOW() - INTERVAL 30 DAY),
              (?, 10000, 'succeeded', 'manual', NOW() + INTERVAL 1 MINUTE, NOW()),
              (?, 25000, 'succeeded', 'manual', NOW() + INTERVAL 1 MINUTE, NOW())`,
      [oldPayer, oldPayer, newPayer],
    );
    const res = await admin("get", `/api/admin/event-marketing/companies/${companyId}/results`);
    expect(res.status).toBe(200);
    const past = res.body.sessions.find((s: any) => s.session_id === sessions.past);
    expect(past).toMatchObject({ registered: 2, attended: 1, no_show: 1, new_contacts: 2, paid_clients: 1, revenue_cents: 25000 });
    expect(res.body.totals).toMatchObject({ paid_clients: 1, revenue_cents: 25000 });
    expect(res.body.totals.attended).toBeGreaterThanOrEqual(2);
    const [s] = await pool.query<RowDataPacket[]>(`SELECT short_code FROM event_sessions WHERE id = ?`, [sessions.main]);
    const ics = await request(app).get(`/api/public/event-marketing/sessions/${s[0].short_code}/calendar.ics?lang=es`);
    expect(ics.status).toBe(200);
    expect(ics.text).toContain("BEGIN:VCALENDAR");
    expect(ics.text).toContain("DTSTART;TZID=America/Los_Angeles:");
    expect(ics.text).toContain("SUMMARY:Noche main");
    expect(ics.text).toContain("BEGIN:VTIMEZONE");
    expect(ics.text.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75)).toBe(true);
    // Unfolding restores the full URL line.
    expect(ics.text.replace(/\r\n /g, "")).toMatch(/URL:https?:\/\/\S+\/e\/vt-/);
  });

  it("admin detail shows status, check-in method and mismatch; undo check-in works", async () => {
    const res = await admin("get", `/api/admin/event-marketing/companies/${companyId}`);
    expect(res.status).toBe(200);
    const regs = res.body.registrations as any[];
    expect(regs.some((r) => r.profile_mismatch === true)).toBe(true);
    expect(regs.some((r) => r.status === "waitlisted")).toBe(true);
    const selfOne = regs.find((r) => r.check_in_method === "self");
    const undo = await admin("delete", `/api/admin/event-marketing/registrations/${selfOne.id}/check-in`);
    expect(undo.body.registration.checked_in_at).toBeNull();
    const door = res.body.sessions.find((s: any) => s.id === sessions.door);
    expect(door.has_checkin_token).toBe(true);
  });
});

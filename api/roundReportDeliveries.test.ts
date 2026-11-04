/**
 * Case panel: progress-report delivery timeline per round (generated → sends
 * to client / partners with live SMS status → PDF link opens).
 */
import "dotenv/config";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { RowDataPacket } from "mysql2/promise";
import { buildReportDeliveryTimeline, createServer, createSession } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const send = (o: Record<string, unknown>) => ({
  round_number: 3,
  created_at: "2026-10-20T17:15:00Z",
  channel: "email",
  recipient_type: "client",
  to_address: "maria@example.com",
  status: "sent",
  error_message: null,
  sms_status: null,
  sms_error: null,
  by: "Lecca B",
  partner_name: null,
  partner_role: null,
  ...o,
});

describe("buildReportDeliveryTimeline", () => {
  const out = buildReportDeliveryTimeline({
    pdfs: [{ round_number: 3, uploaded_at: "2026-10-20T17:14:00Z", by: "Lecca B" }],
    sends: [
      send({}),
      send({ channel: "sms", to_address: "+12135550000", sms_status: "delivered" }),
      send({ recipient_type: "partner", to_address: "john@realty.com", partner_name: "John Doe", partner_role: "realtor_broker" }),
      send({ created_at: "2026-10-22T10:00:00Z", by: "Cesar G" }), // resend to the client email
      send({ channel: "sms", to_address: "+12135550001", sms_status: "undelivered", sms_error: "30003", created_at: "2026-10-22T10:00:01Z" }),
    ],
    opens: [
      { round_number: 3, first_at: "2026-10-20T17:15:00Z", last_used_at: "2026-10-21T01:40:00Z", use_count: 2 },
      { round_number: 3, first_at: "2026-10-22T10:00:00Z", last_used_at: "2026-10-22T10:05:00Z", use_count: 0 },
    ],
  });
  const r = out[3];

  it("summary: recipients, SMS delivered, failures, opens", () => {
    expect(r.summary).toEqual({
      sends: 5,
      failed: 1,
      delivered: 1,
      recipients: 4,
      opened: 2,
      last_opened_at: "2026-10-21T01:40:00.000Z",
      last_sent_at: "2026-10-22T10:00:01.000Z",
    });
  });

  it("events newest first; generated, resend flag, partner name, live SMS status", () => {
    expect(r.events[0]).toMatchObject({ type: "send", channel: "sms", status: "undelivered", error: "30003" });
    expect(r.events.find((e) => e.resend)).toMatchObject({ to: "maria@example.com", by: "Cesar G" });
    expect(r.events.filter((e) => e.resend)).toHaveLength(1);
    expect(r.events.find((e) => e.recipient_type === "partner")).toMatchObject({ recipient_name: "John Doe", recipient_role: "realtor_broker" });
    expect(r.events[r.events.length - 1]).toMatchObject({ type: "generated", by: "Lecca B" });
    expect(r.events.filter((e) => e.type === "opened")).toHaveLength(1); // unused links are not "opened"
  });
});

describe("GET /api/admin/clients/:id/round-report-deliveries", () => {
  let app: ReturnType<typeof createServer>;
  let tok = "";
  let clientId = 0;
  beforeAll(async () => {
    app = createServer();
    tok = await createSession("admin", 30001, "deliv-test@example.com", "127.0.0.1", "vitest-deliveries");
    const pool = createIntegrationTestPool();
    const [[row]] = await pool.query<RowDataPacket[]>(
      `SELECT client_id FROM outbound_message_log WHERE kind = 'round_report' AND client_id IS NOT NULL ORDER BY id DESC LIMIT 1`,
    );
    clientId = Number(row?.client_id ?? 0);
    await pool.end();
  }, 30_000);

  it("returns per-round timelines for a client with sends", async () => {
    expect(clientId).toBeGreaterThan(0);
    const r = await request(app).get(`/api/admin/clients/${clientId}/round-report-deliveries`).set("Authorization", `Bearer ${tok}`);
    expect(r.status).toBe(200);
    const rounds = Object.values(r.body.rounds) as any[];
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds.some((x) => x.summary.sends > 0)).toBe(true);
    for (const x of rounds) for (let i = 1; i < x.events.length; i++) expect(x.events[i - 1].at >= x.events[i].at).toBe(true);
  }, 30_000);

  it("requires auth", async () => {
    expect((await request(app).get(`/api/admin/clients/${clientId}/round-report-deliveries`)).status).toBe(401);
  });
});

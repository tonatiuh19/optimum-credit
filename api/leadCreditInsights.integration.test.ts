/**
 * Lead credit insights end to end (synthetic prospect + two synthetic reads;
 * everything created here is removed): snapshot saved on read, refresh of the
 * same read is idempotent (no repeat alerts), a newer read compares with the
 * older one and bells the assigned staffer, GET /credit-insights returns the
 * history, the pipeline carries insight_* fields and sorts by heat, and the
 * partner leaderboard lists the lender-report "Requested By" name.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Bureau, CreditAccount, CreditFile } from "./creditFile";
import { createServer, createSession, recordLeadCreditInsights } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

let pool: Pool;
let app: ReturnType<typeof createServer>;
let token = "";
let adminId = 0;
/** The assigned staffer is a test admin: tests never put notifications in a real person's bell. */
let staffId = 0;
let clientId = 0;
const extractionIds: number[] = [];
const REQUESTER = `Vitest Requester ${Date.now()}`;

const B: Bureau[] = ["TU", "EX", "EQ"];
const acct = (creditor: string, mask: string, section: CreditAccount["section"], o: Record<string, unknown>): CreditAccount => ({
  creditor, mask, section, headerStatus: null, confident: true, merged: true,
  bureaus: Object.fromEntries(B.map((b) => [b, { dateOpened: "01/2018", balance: 0, creditLimit: 1000, accountStatus: "Open", paymentStatus: "Current", pastDue: 0, late30: 0, late60: 0, late90: 0, gridMarks: [], dateReported: "10/01/2026", ...o }])),
});
const read = (middle: number, reportDate: string, collections: number): CreditFile =>
  ({
    provider: "unknown", reportDate, scores: { TU: middle - 5, EX: middle, EQ: middle + 5 }, reportFormat: "merged",
    lender: { name: "VITEST MORTGAGE", requestedDate: reportDate, requestedBy: REQUESTER, vendor: "Xactus", reportId: "999" },
    accounts: [
      acct("AUTO LENDER", "1", "installment", { accountType: "Auto Loan", balance: 9000, creditLimit: 12000 }),
      acct("CARD A", "2", "revolving", { balance: 600, creditLimit: 1000 }),
      ...Array.from({ length: collections }, (_, k) => acct(`COLLECTOR ${k}`, `9${k}`, "collection", { balance: 300, paymentStatus: "Collection", accountStatus: "Collection" })),
    ],
    inquiries: [{ creditor: "SHOP A", bureau: "EX", date: "09/18/2026", matchedAccount: null }, { creditor: "SHOP B", bureau: "EQ", date: "09/18/2026", matchedAccount: null }],
    publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [],
  }) as unknown as CreditFile;

async function addRead(file: CreditFile, purpose = "analysis"): Promise<number> {
  const [r] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_file_extractions (client_id, purpose, file_name, mime_type, file_size, storage_key, enc_iv, enc_tag, provider, status, extracted_json, file_sha256)
     VALUES (?, ?, 'x.pdf', 'application/pdf', 1, 'vitest://lead-insights', '00', '00', 'unknown', 'ready', ?, ?)`,
    [clientId, purpose, JSON.stringify(file), `lead-insights-${Date.now()}-${Math.random()}`],
  );
  extractionIds.push(r.insertId);
  return r.insertId;
}

beforeAll(async () => {
  pool = createIntegrationTestPool();
  app = createServer();
  const [[a]] = await pool.query<RowDataPacket[]>(`SELECT id, email FROM admins WHERE status = 'active' AND role = 'super_admin' ORDER BY id LIMIT 1`);
  adminId = Number(a.id);
  token = await createSession("admin", adminId, String(a.email), "127.0.0.1", "vitest-lead-insights");
  const [st] = await pool.query<ResultSetHeader>(
    `INSERT INTO admins (email, first_name, last_name, role, status, preferred_language) VALUES (?, 'Staff', 'Vitest', 'admin', 'active', 'en')`,
    [`lead-insights-staff-${Date.now()}@example.test`],
  );
  staffId = st.insertId;
  const [c] = await pool.query<ResultSetHeader>(
    `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage, assigned_admin_id) VALUES ('Insight', 'Vitest', ?, 'prospect', 'prospect', ?)`,
    [`lead-insights-${Date.now()}@example.test`, staffId],
  );
  clientId = c.insertId;
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM admin_notifications WHERE admin_id = ?`, [staffId]);
  await pool.query(`DELETE FROM lead_credit_insights WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM credit_file_extractions WHERE client_id = ?`, [clientId]);
  await pool.query(`DELETE FROM clients WHERE id = ?`, [clientId]);
  await pool.query(`DELETE FROM admins WHERE id = ?`, [staffId]);
  await pool.query(`UPDATE admin_sessions SET is_active = 0 WHERE user_agent = 'vitest-lead-insights'`).catch(() => null);
  await pool.end();
});

describe("lead credit insights end to end", () => {
  it("first read → snapshot saved, no alerts; refresh is idempotent", async () => {
    const id = await addRead(read(570, "08/01/2026", 3));
    const i = await recordLeadCreditInsights(id);
    expect(i).toMatchObject({ middleScore: 570, targetScore: 580, activeLoanFile: true, source: { requestedBy: REQUESTER } });
    await recordLeadCreditInsights(id);
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM lead_credit_insights WHERE client_id = ?`, [clientId]);
    expect(Number(rows[0].n)).toBe(1);
    const [bells] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM admin_notifications WHERE admin_id = ? AND link_url = ?`, [staffId, `/admin/pipeline?client=${clientId}`]);
    expect(Number(bells[0].n)).toBe(0);
  }, 60_000);

  it("newer read → compared with the older one; the assigned staffer gets stage bells", async () => {
    const id = await addRead(read(625, "10/20/2026", 1));
    await recordLeadCreditInsights(id);
    const [bells] = await pool.query<RowDataPacket[]>(
      `SELECT title FROM admin_notifications WHERE admin_id = ? AND link_url = ? ORDER BY id`,
      [staffId, `/admin/pipeline?client=${clientId}`],
    );
    const titles = bells.map((b) => String(b.title)).join(" | ");
    expect(titles).toMatch(/crossed 620 \(570 → 625\)/);
    expect(titles).toMatch(/negative items down from 3 to 1/);
  }, 60_000);

  it("GET /credit-insights → latest + history (newest first)", async () => {
    const r = await request(app).get(`/api/admin/clients/${clientId}/credit-insights`).set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.latest.insights.middleScore).toBe(625);
    expect(r.body.history.map((h: any) => h.insights.middleScore)).toEqual([625, 570]);
  }, 60_000);

  it("pipeline prospects carry insight_* fields and sort by heat", async () => {
    const r = await request(app)
      .get(`/api/admin/pipeline`)
      .query({ search: String(clientId), prospect_sort: "heat", stage: "prospect" })
      .set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    const p = (r.body.prospects ?? []).find((x: any) => Number(x.id) === clientId);
    expect(p).toBeTruthy();
    expect(p).toMatchObject({ insight_middle_score: 625, insight_requested_by: REQUESTER });
    expect(Number(p.insight_heat_score)).toBeGreaterThan(0);
  }, 60_000);

  it("leaderboard lists the unlinked Requested By name", async () => {
    const r = await request(app).get(`/api/admin/referral-partners/leaderboard`).query({ days: 30 }).set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.unlinked_requesters.some((u: any) => u.name === REQUESTER)).toBe(true);
  }, 60_000);

  const bellCount = async () => {
    const [b] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM admin_notifications WHERE admin_id = ? AND link_url = ?`, [staffId, `/admin/pipeline?client=${clientId}`]);
    return Number(b[0].n);
  };

  it.each([
    ["an OLDER report read after the newer one (out of order)", () => read(500, "05/01/2026", 6), "analysis"],
    ["a progress Before upload (old report by design)", () => read(520, "06/15/2026", 5), "progress_before"],
    ["a same-day re-upload of the newest report with different numbers", () => read(700, "10/20/2026", 0), "analysis"],
  ] as Array<[string, () => CreditFile, string]>)("no stage bells for %s", async (_n, file, purpose) => {
    const before = await bellCount();
    await recordLeadCreditInsights(await addRead(file(), purpose));
    expect(await bellCount()).toBe(before);
  }, 60_000);

  it("silent mode (backfill) never bells, even for a newer report", async () => {
    const before = await bellCount();
    await recordLeadCreditInsights(await addRead(read(690, "10/25/2026", 0)), { silent: true });
    expect(await bellCount()).toBe(before);
  }, 60_000);

  it("the card's latest snapshot ignores progress Before reads", async () => {
    await recordLeadCreditInsights(await addRead(read(480, "01/01/2026", 9), "progress_before"));
    const r = await request(app).get(`/api/admin/pipeline`).query({ search: String(clientId), stage: "prospect" }).set("Authorization", `Bearer ${token}`);
    const p = (r.body.prospects ?? []).find((x: any) => Number(x.id) === clientId);
    expect(p.insight_middle_score).not.toBe(480);
  }, 60_000);
});

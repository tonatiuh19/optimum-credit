/**
 * Stripe end-to-end for platform billing — TEST MODE ONLY, opt-in:
 *   STRIPE_E2E=1 npx vitest run api/platformBilling.stripe.e2e.test.ts
 * Uses months 1999-01..04 (never reachable by the live billing cron, which
 * only invoices the previous month) and removes them afterwards.
 */
import "dotenv/config";
import crypto from "crypto";
import axios from "axios";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { createServer, createSession, issueBillingInvoiceForLines } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const KEY = String(process.env.STRIPE_SECRET_KEY || "");
const RUN = process.env.STRIPE_E2E === "1" && KEY.startsWith("sk_test");
const MONTHS = ["1999-01", "1999-02", "1999-03", "1999-04"];
const LINES = [
  { action: "platform_base_fee", unit: "month", quantity: 0.2903, unit_price_usd: 750, amount_usd: 217.74, billed_days: 9, days_in_month: 31 },
  { action: "mcp_tool_call", unit: "call", quantity: 5321, unit_price_usd: 0.01, amount_usd: 53.21 },
];

const stripe = async (method: "GET" | "POST", path: string, params: Record<string, string> = {}) => {
  const body = new URLSearchParams(params).toString();
  const { data } = await axios.request({
    method,
    url: `https://api.stripe.com/v1${path}${method === "GET" && body ? `?${body}` : ""}`,
    data: method === "POST" ? body : undefined,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  return data;
};

let pool: Pool;
let app: ReturnType<typeof createServer>;
let auth: Record<string, string>;
let customer = "";
const issue = (month: string) =>
  issueBillingInvoiceForLines({ month, periodStart: new Date(`${month}-23T00:00:00Z`), periodEnd: new Date(`${month}-28T00:00:00Z`), lines: LINES, totalUsd: 270.95 });
const row = async (month: string) => (await pool.query<RowDataPacket[]>(`SELECT * FROM billing_invoices WHERE period_month = ?`, [month]))[0][0];
const saveCard = async (testPm: string) => {
  const si = await request(app).post("/api/admin/billing/setup-intent").set(auth);
  const conf = await stripe("POST", `/setup_intents/${si.body.client_secret.split("_secret_")[0]}/confirm`, {
    payment_method: testPm,
    return_url: "https://www.ofgllc.com/admin/billing",
  });
  return request(app).post("/api/admin/billing/payment-method").set(auth).send({ payment_method_id: conf.payment_method });
};

describe.skipIf(!RUN)("platform billing × Stripe (test mode)", () => {
  beforeAll(async () => {
    pool = createIntegrationTestPool();
    app = createServer();
    auth = { Authorization: `Bearer ${await createSession("admin", 30001, "stripe-e2e@example.com", "127.0.0.1", "vitest-stripe-e2e")}` };
    await pool.query(`DELETE FROM billing_invoices WHERE period_month IN (?)`, [MONTHS]);
  }, 30_000);

  afterAll(async () => {
    for (const m of MONTHS) {
      const r = await row(m);
      if (r?.stripe_invoice_id) {
        const inv = await stripe("GET", `/invoices/${r.stripe_invoice_id}`);
        if (inv.status === "open") await stripe("POST", `/invoices/${inv.id}/void`);
      }
    }
    await pool.query(`DELETE FROM billing_invoices WHERE period_month IN (?)`, [MONTHS]);
    await pool.end();
  }, 60_000);

  it("1. customer exists (test-mode setting) and is the OFG platform customer", async () => {
    const r = await request(app).get("/api/admin/billing/payment-method").set(auth);
    expect(r.body.configured).toBe(true);
    expect(String(r.body.publishable_key)).toMatch(/^pk_test_/);
    const [[s]] = await pool.query<RowDataPacket[]>(`SELECT setting_value FROM system_settings WHERE setting_key = 'billing_stripe_customer_id_test'`);
    customer = String(s.setting_value);
    const c = await stripe("GET", `/customers/${customer}`);
    expect(c).toMatchObject({ name: "Optimum Financial Group", metadata: { platform: "ofg-platform" } });
  }, 30_000);

  it("2. save a card through SetupIntent → default payment method 4242", async () => {
    const saved = await saveCard("pm_card_visa");
    expect(saved.status).toBe(200);
    expect(saved.body.payment_method).toMatchObject({ brand: "visa", last4: "4242" });
    const c = await stripe("GET", `/customers/${customer}`);
    expect(c.invoice_settings.default_payment_method).toBe(saved.body.payment_method.id);
  }, 30_000);

  it("3. declined + 3-D Secure cards are refused at setup", async () => {
    const si = await request(app).post("/api/admin/billing/setup-intent").set(auth);
    const id = si.body.client_secret.split("_secret_")[0];
    const declined = await stripe("POST", `/setup_intents/${id}/confirm`, { payment_method: "pm_card_chargeDeclined", return_url: "https://x.test" }).catch((e) => e.response.data);
    expect(declined.error?.code).toBe("card_declined");
    const si2 = await request(app).post("/api/admin/billing/setup-intent").set(auth);
    const sca = await stripe("POST", `/setup_intents/${si2.body.client_secret.split("_secret_")[0]}/confirm`, {
      payment_method: "pm_card_authenticationRequired",
      return_url: "https://x.test",
    });
    expect(sca.status).toBe("requires_action");
    // Saving a method from another customer is rejected.
    const other = await stripe("POST", "/payment_methods", { type: "card", "card[token]": "tok_visa" });
    expect((await request(app).post("/api/admin/billing/payment-method").set(auth).send({ payment_method_id: other.id })).status).toBe(400);
  }, 30_000);

  it("4. autopay: invoice charged on the saved card, lines match", async () => {
    expect((await issue("1999-01")).status).toBe("issued");
    const r = await row("1999-01");
    expect(r.status).toBe("paid");
    const inv = await stripe("GET", `/invoices/${r.stripe_invoice_id}`, { "expand[]": "lines" });
    expect(inv).toMatchObject({ status: "paid", collection_method: "charge_automatically", amount_paid: 27095, customer });
    expect(inv.lines.data.map((l: any) => l.amount).sort()).toEqual([21774, 5321]);
  }, 60_000);

  it("8. idempotent: issuing the same month again does nothing", async () => {
    expect((await issue("1999-01")).status).toBe("already_issued");
    const r = await row("1999-01");
    const list = await stripe("GET", "/invoices", { customer, limit: "50" });
    expect(list.data.filter((i: any) => i.metadata?.billing_invoice_id === String(r.id))).toHaveLength(1);
  }, 30_000);

  it("6. failed charge: invoice stays open, error recorded, link emailed", async () => {
    expect((await saveCard("pm_card_chargeCustomerFail")).status).toBe(200);
    expect((await issue("1999-03")).status).toBe("issued");
    const r = await row("1999-03");
    expect(r.status).toBe("open");
    expect(String(r.error_message)).toMatch(/declined/i);
    expect(r.hosted_invoice_url).toMatch(/^https:\/\/invoice\.stripe\.com/);
  }, 60_000);

  it("5. no saved method: invoice emailed, due in 15 days", async () => {
    await stripe("POST", `/customers/${customer}`, { "invoice_settings[default_payment_method]": "" });
    expect((await request(app).get("/api/admin/billing/payment-method").set(auth)).body.payment_method).toBeNull();
    expect((await issue("1999-02")).status).toBe("issued");
    const r = await row("1999-02");
    expect(r.status).toBe("open");
    const inv = await stripe("GET", `/invoices/${r.stripe_invoice_id}`);
    expect(inv.collection_method).toBe("send_invoice");
    expect(Math.round((inv.due_date - inv.status_transitions.finalized_at) / 86400)).toBe(15);
    // Leave the test customer with a working card again.
    await saveCard("pm_card_visa");
  }, 60_000);

  it("9. retry after a partial failure: leftover draft discarded, one invoice issued", async () => {
    await pool.query(
      `INSERT INTO billing_invoices (period_month, period_start, period_end, lines_json, total_usd, status, error_message)
       VALUES ('1999-04', '1999-04-23', '1999-04-28', ?, 270.95, 'failed', 'simulated')`,
      [JSON.stringify(LINES)],
    );
    const r0 = await row("1999-04");
    const orphan = await stripe("POST", "/invoices", { customer, currency: "usd", collection_method: "send_invoice", days_until_due: "15", "metadata[billing_invoice_id]": String(r0.id) });
    await pool.query(`UPDATE billing_invoices SET stripe_invoice_id = ? WHERE id = ?`, [orphan.id, r0.id]);
    expect((await issue("1999-04")).status).toBe("issued");
    const r = await row("1999-04");
    expect(r.stripe_invoice_id).not.toBe(orphan.id);
    expect(r.status).toBe("paid");
    expect((await stripe("GET", `/invoices/${orphan.id}`).catch((e) => e.response.data)).error?.code).toBe("resource_missing");
    const list = await stripe("GET", "/invoices", { customer, limit: "50" });
    expect(list.data.filter((i: any) => i.metadata?.billing_invoice_id === String(r.id) && i.status !== "draft")).toHaveLength(1);
  }, 60_000);

  it("7. webhook: signed events move the app status (paid, void); bad signature refused", async () => {
    const secret = "whsec_e2e_local";
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const r = await row("1999-03");
    const send = (type: string) => {
      const body = JSON.stringify({ type, data: { object: { id: r.stripe_invoice_id } } });
      const t = Math.floor(Date.now() / 1000);
      const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
      return request(app).post("/api/webhooks/stripe").set("Content-Type", "application/json").set("Stripe-Signature", `t=${t},v1=${v1}`).send(body);
    };
    expect((await send("invoice.payment_failed")).status).toBe(200);
    expect((await row("1999-03")).error_message).toBe("Payment failed");
    expect((await send("invoice.paid")).status).toBe(200);
    expect((await row("1999-03")).status).toBe("paid");
    expect((await send("invoice.voided")).status).toBe(200);
    expect((await row("1999-03")).status).toBe("void");
    const bad = await request(app).post("/api/webhooks/stripe").set("Stripe-Signature", "t=1,v1=abc").send({ type: "invoice.paid" });
    expect(bad.status).toBe(400);
  }, 30_000);
});

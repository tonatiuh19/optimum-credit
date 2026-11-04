/**
 * Payment-method reminder (daily until a card is saved) — scenario matrix over
 * the calendar: countdown to the 1st, invoice day, the 15-day due window,
 * overdue, paid-by-link, failed / void invoices, month and year boundaries.
 * Plus invariants every day: SMS fits, link present, never threatening, and
 * the message changes day to day.
 */
import { describe, expect, it } from "vitest";
import { BILLING_INVOICE_DUE_DAYS, billingPaymentMethodAlert, type BillingPmAlertInput } from "./index";

const URL = "https://www.ofgllc.com/admin/billing";
const oct = (o: Partial<BillingPmAlertInput["invoice"]> = {}) =>
  ({ periodMonth: "2026-10", status: "open", totalUsd: 741.1, issuedYmd: "2026-11-01", hostedUrl: "https://invoice.stripe.com/i/x", ...o }) as BillingPmAlertInput["invoice"];
const run = (today: string, invoice: BillingPmAlertInput["invoice"] = null) => billingPaymentMethodAlert({ today, invoice, billingUrl: URL });

describe("stage and wording by day", () => {
  it.each([
    // before the first invoice
    ["12 days out", "2026-10-20", null, "early", /no card is saved for the OFG platform yet\. 12 days until October's invoice.*charges itself on the 1st/],
    ["6 days out (today)", "2026-10-26", null, "countdown", /^6 days until the October OFG invoice\. No card is saved yet; with a card it.s charged automatically on the 1st\./],
    ["2 days out", "2026-10-30", null, "countdown", /^2 days until the October OFG invoice/],
    ["the day before", "2026-10-31", null, "tomorrow", /^The October OFG invoice goes out tomorrow/],
    // invoice issued on the 1st without a card (due in 15 days)
    ["invoice day", "2026-11-01", oct(), "invoice_day", /October OFG platform invoice was issued today.*due in 15 days.*Pay it here: https:\/\/invoice\.stripe\.com/],
    ["4 days after issue", "2026-11-05", oct(), "due_soon", /^October OFG invoice is due in 11 days/],
    ["day before due", "2026-11-15", oct(), "due_tomorrow", /is due tomorrow/],
    ["due date", "2026-11-16", oct(), "due_today", /is due today/],
    ["1 day past due (singular)", "2026-11-17", oct(), "overdue", /is 1 day past due\./],
    ["5 days past due", "2026-11-21", oct(), "overdue", /is 5 days past due.*save a card so it doesn't happen again/],
    // failed / pending charge attempts are still unpaid
    ["Stripe charge failed", "2026-11-03", oct({ status: "failed" }), "due_soon", /due in 13 days/],
    // paid by link, still no card → thank + countdown to the next invoice
    ["paid by link, next invoice 21 days out", "2026-11-10", oct({ status: "paid" }), "early", /^Thanks for paying October! Quick one: no card is saved.*November's invoice/],
    ["paid by link, 4 days before the next one (Nov has 30 days)", "2026-11-27", oct({ status: "paid" }), "countdown", /^Thanks for paying October! 4 days until the November OFG invoice/],
    // voided invoice → back to the countdown
    ["voided invoice", "2026-11-29", oct({ status: "void" }), "countdown", /^2 days until the November OFG invoice/],
    // year boundary
    ["Dec 31 → Jan 1", "2026-12-31", oct({ status: "paid", periodMonth: "2026-11" }), "tomorrow", /^Thanks for paying November! The December OFG invoice goes out tomorrow/],
    ["Feb (28 days) countdown", "2027-02-26", null, "countdown", /^3 days until the February OFG invoice/],
  ])("%s", (_name, today, invoice, stage, re) => {
    const a = run(today as string, invoice as BillingPmAlertInput["invoice"]);
    expect(a.stage).toBe(stage);
    expect(a.text).toMatch(re as RegExp);
  });
});

describe("invariants on every day of a 60-day window", () => {
  const days = Array.from({ length: 60 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 10 + i, 12));
    return d.toISOString().slice(0, 10);
  });
  const scenarios: Array<[string, (d: string) => BillingPmAlertInput["invoice"]]> = [
    ["never invoiced", () => null],
    ["October invoice open from Nov 1", (d) => (d >= "2026-11-01" ? oct() : null)],
    ["October paid on Nov 4", (d) => (d >= "2026-11-04" ? oct({ status: "paid" }) : d >= "2026-11-01" ? oct() : null)],
  ];
  it.each(scenarios)("%s", (_n, invoiceFor) => {
    let prev = "";
    for (const day of days) {
      const a = run(day, invoiceFor(day));
      expect(a.sms.length, day).toBeLessThanOrEqual(320);
      expect(a.sms, day).toContain(URL);
      expect(a.html, day).toContain(URL);
      expect(a.subject.startsWith("OFG platform: "), day).toBe(true);
      // No amounts in any notification.
      expect(`${a.sms} ${a.text} ${a.html} ${a.subject}`, day).not.toMatch(/\$\s?\d|\d+\.\d{2}\b|USD/);
      // Friendly → clear, never threatening.
      expect(a.text, day).not.toMatch(/suspend|terminate|cut off|legal|collections agency|pause/i);
      // Daily countdown: the message changes every day (no copy-paste repeats).
      expect(a.text, day).not.toBe(prev);
      prev = a.text;
    }
  });

  it("due date is 15 days after the issue day", () => {
    expect(BILLING_INVOICE_DUE_DAYS).toBe(15);
    expect(run("2026-11-16", oct()).stage).toBe("due_today");
  });
});

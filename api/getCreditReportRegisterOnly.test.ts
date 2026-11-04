/**
 * /get-credit-report with the free report switched off (Settings → admin
 * switch): the confirmation email / SMS never carry a report link.
 */
import "dotenv/config";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createServer, smsGetCreditReportRegistered, tplGetCreditReportRegistered } from "./index";

const LINK = /myfreescorenow|go\/free-score|https?:\/\//i;

describe("get-credit-report register-only mode", () => {
  it.each(["en", "es"])("email (%s) has no report link and shows the OFG phone", (lang) => {
    const t = tplGetCreditReportRegistered({ firstName: "Ana", lang, eventKind: null });
    const html = JSON.stringify(t);
    expect(html).toContain("(949) 674-0714");
    expect(html).not.toMatch(/myfreescorenow|go\/free-score/i);
  });

  it.each(["en", "es"])("SMS (%s) has no link", (lang) => {
    expect(smsGetCreditReportRegistered({ firstName: "Ana", lang })).not.toMatch(LINK);
  });

  it("config route returns a boolean", async () => {
    const res = await request(createServer()).get("/api/public/get-credit-report-config");
    expect(res.status).toBe(200);
    expect(typeof res.body.free_report_enabled).toBe("boolean");
  }, 30_000);
});

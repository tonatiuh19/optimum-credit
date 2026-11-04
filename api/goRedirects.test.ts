/**
 * OFG redirect links printed on client reports (/go/*): each one lands on its
 * configured page, on both the short path and the /api/public alias.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createServer } from "./index";
import { OFG_ENROLL_TARGETS, OFG_REPORT_CONTACT } from "./ofgCreditAnalysisPdf";

const app = createServer();

describe("/go redirects", () => {
  it.each([
    ["/go/enroll-standard", OFG_ENROLL_TARGETS.standard],
    ["/api/public/go/enroll-standard", OFG_ENROLL_TARGETS.standard],
    ["/go/enroll-complex", OFG_ENROLL_TARGETS.complex],
    ["/api/public/go/enroll-complex", OFG_ENROLL_TARGETS.complex],
  ])("%s → %s", async (path, target) => {
    const r = await request(app).get(path);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(target);
  });
  it("/go/free-score still lands on MyFreeScoreNow", async () => {
    const r = await request(app).get("/go/free-score");
    expect(r.status).toBe(302);
    expect(r.headers.location).toMatch(/^https:\/\/app\.myfreescorenow\.com\//);
  });
  it("reports print the OFG links, never a raw program URL", () => {
    expect(OFG_REPORT_CONTACT.standardUrl).toBe("https://www.ofgllc.com/go/enroll-standard");
    expect(OFG_REPORT_CONTACT.complexUrl).toBe("https://www.ofgllc.com/go/enroll-complex");
    expect(OFG_REPORT_CONTACT.freeScoreUrl).toBe("https://www.ofgllc.com/go/free-score");
    expect(OFG_ENROLL_TARGETS.standard).not.toMatch(/premium-plan-payment/); // that page redirects to /home
  });
});

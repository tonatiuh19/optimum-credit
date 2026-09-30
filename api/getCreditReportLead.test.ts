import { describe, expect, it } from "vitest";
import {
  getCreditReportEventKind,
  getCreditReportEventLabelSlug,
  getCreditReportLabelSlugs,
  laCalendarDateYmd,
  GOLF_TOURNAMENT_LABEL_SLUG,
  LAS_VEGAS_EVENT_LABEL_SLUG,
  GET_CREDIT_REPORT_SOURCE_LABEL,
  MFSN_FREE_SNAPSHOT_URL,
  GET_CREDIT_REPORT_SMS_FROM_E164,
  smsGetCreditReportStaffAlert,
} from "./getCreditReportLead";
import {
  getCreditReportEventKind as indexEventKind,
  getCreditReportLabelSlugs as indexLabelSlugs,
  laCalendarDateYmd as indexLaYmd,
  tplGetCreditReportWelcome,
  smsGetCreditReportWelcome,
  smsGetCreditReportStaffAlert as indexStaffAlert,
} from "./index";

describe("getCreditReportLead event tags", () => {
  it("formats LA calendar date as YYYY-MM-DD", () => {
    // 2026-09-14 15:00 UTC = morning in LA (PDT)
    const ymd = laCalendarDateYmd(new Date("2026-09-14T15:00:00.000Z"));
    expect(ymd).toBe("2026-09-14");
  });

  it("uses LA midnight boundaries (PDT = UTC-7 in September)", () => {
    // 2026-09-14 00:00 America/Los_Angeles
    expect(laCalendarDateYmd(new Date("2026-09-14T07:00:00.000Z"))).toBe(
      "2026-09-14",
    );
    // still Sep 14 LA just before midnight
    expect(laCalendarDateYmd(new Date("2026-09-15T06:59:59.000Z"))).toBe(
      "2026-09-14",
    );
    // Sep 15 00:00 LA
    expect(laCalendarDateYmd(new Date("2026-09-15T07:00:00.000Z"))).toBe(
      "2026-09-15",
    );
  });

  it("tags Golf only on 2026-09-14 LA", () => {
    expect(getCreditReportEventLabelSlug("2026-09-14")).toBe(
      GOLF_TOURNAMENT_LABEL_SLUG,
    );
    expect(getCreditReportEventKind("2026-09-14")).toBe("golf");
    expect(getCreditReportLabelSlugs("2026-09-14")).toEqual([
      GET_CREDIT_REPORT_SOURCE_LABEL,
      GOLF_TOURNAMENT_LABEL_SLUG,
    ]);
  });

  it("tags Las Vegas only on 2026-09-15 LA", () => {
    expect(getCreditReportEventLabelSlug("2026-09-15")).toBe(
      LAS_VEGAS_EVENT_LABEL_SLUG,
    );
    expect(getCreditReportEventKind("2026-09-15")).toBe("vegas");
  });

  it("adds no event tag before/after those days", () => {
    expect(getCreditReportEventLabelSlug("2026-09-13")).toBeNull();
    expect(getCreditReportEventLabelSlug("2026-09-16")).toBeNull();
    expect(getCreditReportLabelSlugs("2026-09-13")).toEqual([
      GET_CREDIT_REPORT_SOURCE_LABEL,
    ]);
  });

  it("stays in sync with inlined api/index.ts helpers", () => {
    expect(indexLaYmd(new Date("2026-09-14T15:00:00.000Z"))).toBe(
      laCalendarDateYmd(new Date("2026-09-14T15:00:00.000Z")),
    );
    expect(indexEventKind("2026-09-14")).toBe("golf");
    expect(indexEventKind("2026-09-15")).toBe("vegas");
    expect(indexEventKind("2026-09-12")).toBeNull();
    expect(indexLabelSlugs("2026-09-14")).toEqual(
      getCreditReportLabelSlugs("2026-09-14"),
    );
  });
});

describe("get-credit-report welcome templates", () => {
  it("email CTA uses direct MFSN URL (not short link)", () => {
    const tpl = tplGetCreditReportWelcome({
      firstName: "Alex",
      mfsnUrl: MFSN_FREE_SNAPSHOT_URL,
      lang: "en",
      eventKind: null,
    });
    expect(tpl.html).toContain(MFSN_FREE_SNAPSHOT_URL);
    expect(tpl.html).not.toContain("/go/free-score");
    expect(tpl.subject.toLowerCase()).toMatch(/free|credit|optimum/);
  });

  it("SMS uses short OFG URL and stays reasonably short", () => {
    const short = "https://www.ofgllc.com/go/free-score";
    const body = smsGetCreditReportWelcome({
      firstName: "Alex",
      shortUrl: short,
      lang: "en",
      eventKind: null,
    });
    expect(body).toContain(short);
    expect(body).not.toContain("myfreescorenow.com");
    expect(body.length).toBeLessThan(320);
  });

  it("event-aware EN/ES subjects and SMS copy", () => {
    const golf = tplGetCreditReportWelcome({
      firstName: "Sam",
      mfsnUrl: MFSN_FREE_SNAPSHOT_URL,
      lang: "en",
      eventKind: "golf",
    });
    expect(golf.subject.toLowerCase()).toMatch(/golf/);
    const vegasEs = tplGetCreditReportWelcome({
      firstName: "Sam",
      mfsnUrl: MFSN_FREE_SNAPSHOT_URL,
      lang: "es",
      eventKind: "vegas",
    });
    expect(vegasEs.subject.toLowerCase()).toMatch(/vegas/);
    expect(
      smsGetCreditReportWelcome({
        firstName: "Sam",
        shortUrl: "https://www.ofgllc.com/go/free-score",
        lang: "es",
        eventKind: "golf",
      }).toLowerCase(),
    ).toMatch(/golf/);
  });

  it("documents César default From constant for prospect SMS only", () => {
    expect(GET_CREDIT_REPORT_SMS_FROM_E164).toBe("+19496740714");
  });
});

describe("get-credit-report staff SMS alert body", () => {
  it("builds a short staff alert with pipeline URL", () => {
    const body = smsGetCreditReportStaffAlert({
      firstName: "Jane",
      lastName: "Doe",
      phone: "+15551234567",
      email: "jane@example.com",
      lang: "en",
      eventKind: "golf",
      pipelineUrl: "https://www.ofgllc.com/admin/pipeline?client=42",
    });
    expect(body).toContain("Jane Doe");
    expect(body).toContain("+15551234567");
    expect(body).toContain("jane@example.com");
    expect(body).toContain("golf");
    expect(body).toContain("/admin/pipeline?client=42");
    expect(body.length).toBeLessThanOrEqual(320);
    expect(
      indexStaffAlert({
        firstName: "Jane",
        lastName: "Doe",
        phone: "+15551234567",
        email: "jane@example.com",
        lang: "es",
        eventKind: null,
        pipelineUrl: "https://www.ofgllc.com/admin/pipeline?client=42",
      }),
    ).toContain(" · ES");
  });
});

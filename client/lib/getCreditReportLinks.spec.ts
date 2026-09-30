import { describe, expect, it } from "vitest";
import {
  FREE_SCORE_SHORT_PATH,
  GET_CREDIT_REPORT_URLS,
  resolveGetCreditReportUrl,
} from "./getCreditReportLinks";

describe("getCreditReportLinks", () => {
  it("maps free and full options to MyFreeScoreNow URLs", () => {
    expect(resolveGetCreditReportUrl("free")).toBe(GET_CREDIT_REPORT_URLS.free);
    expect(resolveGetCreditReportUrl("full")).toBe(GET_CREDIT_REPORT_URLS.full);
    expect(GET_CREDIT_REPORT_URLS.free).toContain("credit-snapshot");
    expect(GET_CREDIT_REPORT_URLS.full).toContain("enroll");
  });

  it("exposes OFG short path for SMS masking", () => {
    expect(FREE_SCORE_SHORT_PATH).toBe("/go/free-score");
  });

  it("returns null for placeholder / unknown", () => {
    expect(resolveGetCreditReportUrl("")).toBeNull();
    expect(resolveGetCreditReportUrl(undefined)).toBeNull();
    expect(resolveGetCreditReportUrl("other")).toBeNull();
  });
});

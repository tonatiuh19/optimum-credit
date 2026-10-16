import { describe, expect, it } from "vitest";
import { FILE, tl } from "./creditAnalysisFixtures";
import { buildCreditAnalysis, findInconsistencies, parseReportDate } from "./creditAnalysisFromFile";

describe("buildCreditAnalysis (Ledesma-style file)", () => {
  const a = buildCreditAnalysis(FILE);

  it("flags the missing bureau (Equifax freeze / not pulled)", () => {
    expect(a.missingBureaus).toEqual(["EQ"]);
    expect(a.warnings.join(" ")).toMatch(/EQ returned no score/);
  });

  it("assigns rounds: collections R2, inconsistent charge-off R3, clean charge-off R4", () => {
    const by = Object.fromEntries(a.negatives.map((n) => [n.creditor, n]));
    expect(by["LEAFY FINANCIAL"].round).toBe(2);
    expect(by["LEAFY FINANCIAL"].legalBasis).toMatch(/FDCPA §809/);
    expect(by["OPPLOANS/FINWISE"].round).toBe(3);
    expect(by["OPPLOANS/FINWISE"].inconsistencies.join(" ")).toMatch(/Last activity/);
    expect(by["OPPLOANS/FINWISE"].inconsistencies.join(" ")).toMatch(/Late counts/);
    expect(by["EAGLE COMMUNITY CU"].round).toBe(4);
  });

  it("puts dispute-remark items on HOLD", () => {
    const j = a.negatives.find((n) => n.creditor === "JEFFERSON CAPITAL")!;
    expect(j.hold).toBe(true);
    expect(a.negatives.find((n) => n.creditor === "LEAFY FINANCIAL")!.hold).toBe(false);
  });

  it("classifies inquiries: ages off soon / permissible / dispute", () => {
    const by = Object.fromEntries(a.inquiries.map((q) => [q.creditor, q]));
    expect(by["AUTO LENDER"]).toMatchObject({ action: "ages_off", agesOff: "10/15/2026" });
    expect(by["CAPITAL ONE"].action).toBe("permissible");
    expect(by["UNKNOWN LENDER"].action).toBe("dispute");
  });

  it("splits utilization incl. vs excl. authorized-user cards", () => {
    expect(a.utilizationOverall.ownCardsOnly).toBeCloseTo(130.3, 0);
    expect(a.utilizationOverall.all).toBeLessThan(5);
    expect(a.utilization[0]).toMatchObject({ account: "CAPITAL ONE", pctUsed: 130.3, payTo30: 90, payTo10: 30 });
  });

  it("projects per bureau without inventing a score for the missing bureau", () => {
    const last = a.projections[a.projections.length - 1].scores;
    expect(last.EQ).toBeNull();
    expect(last.TU!).toBeGreaterThan(511);
    expect(a.projections[0].scores.TU).toBe(511);
  });

  it("scores file strength out of 100 and recommends Standard", () => {
    expect(a.fileStrength.current).toBeLessThan(a.fileStrength.postRepair);
    expect(a.fileStrength.postRepair).toBeLessThanOrEqual(100);
    expect(a.programTier).toBe("standard");
    expect(a.totalDerogatoryBalance).toBe(435 + 979 + 618 + 1219);
  });

  it("builds a per-bureau overview", () => {
    expect(a.overview.TU).toMatchObject({ totalAccounts: 6, negative: 4, positive: 2, hardInquiries: 1 });
    expect(a.overview.TU.oldest).toEqual({ creditor: "CITICARDS CBNA", opened: "11/2005" });
  });
});

describe("helpers", () => {
  it("parses report date formats", () => {
    expect(parseReportDate("10/01/2026")?.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(parseReportDate("06/2021")?.toISOString().slice(0, 7)).toBe("2021-06");
    expect(parseReportDate("bad")).toBeNull();
  });
  it("finds no inconsistencies when bureaus agree", () => {
    expect(findInconsistencies({ TU: tl({ balance: 5 }), EX: tl({ balance: 5 }) })).toEqual([]);
  });
});

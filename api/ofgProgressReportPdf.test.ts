import { describe, expect, it } from "vitest";
import {
  generateOfgProgressReportPdf,
  toPdfSafeText,
} from "./ofgProgressReportPdf";
import type { OfGReportData } from "../shared/api";
import { PDFDocument } from "pdf-lib";

const sample: OfGReportData = {
  client: { firstName: "Jose", lastName: "Demo" },
  reportDate: { before: "2026-03-01", after: "2026-06-15" },
  bureauScores: {
    transunion: { before: 582, after: 641 },
    experian: { before: 590, after: 638 },
    equifax: { before: 575, after: 629 },
  },
  middleScore: { before: 582, after: 638 },
  wins: [
    {
      itemRemoved: "Collection - ABC Medical",
      bureaus: ["TU", "EX"],
      impact: "Removed",
      status: "Deleted",
      highlighted: true,
    },
    {
      itemRemoved: "Late payment - Retail Card",
      bureaus: ["EQ"],
      impact: "Removed",
      status: "Deleted",
    },
  ],
  targets: [
    {
      item: "Charge-off still reporting",
      bureaus: ["TU", "EX", "EQ"],
      detail: "Next dispute cycle",
      priority: "high",
    },
  ],
  utilization: [
    {
      account: "Capital One",
      limit: 2500,
      balance: 1800,
      pctUsed: 72,
      payTo30: 1050,
      payTo10: 1550,
    },
    {
      account: "Discover",
      limit: 4000,
      balance: 800,
      pctUsed: 20,
      payTo30: 0,
      payTo10: 400,
    },
  ],
  positiveAccounts: ["Auto loan - on-time 24 months"],
  actionNeeded: ["Pay Capital One toward 30%"],
  roadmap: {
    currentRound: 2,
    nextRound: 3,
    scoreGoal: 680,
    gapRemaining: 42,
    milestones: ["Clear remaining charge-off", "Lower utilization under 30%"],
  },
  actionPlan: [
    {
      step: 1,
      description: "File Round 2 disputes on remaining items",
      owner: "ofg",
    },
    {
      step: 2,
      description: "Bring Capital One under 30% utilization",
      owner: "client",
    },
  ],
  fileStrengthScore: 68,
  tradelineRecommendation: {
    code: "IH-1",
    projectedImpact: "Projected boost to middle score once established",
  },
  fundingReadinessNote: "On track for funding review after Round 3",
  croaDisclosure:
    "This report is for educational purposes. Credit repair results vary and no specific score outcome is guaranteed.",
  locale: "en",
};

describe("ofgProgressReportPdf", () => {
  it("sanitizes non-WinAnsi glyphs", () => {
    expect(toPdfSafeText("A → B • dash–em")).toContain("->");
    expect(toPdfSafeText("A → B • dash–em")).toContain("*");
  });

  it("strips tabs that previously threw WinAnsi 0x0009", () => {
    expect(toPdfSafeText("Derogatory\tDerogatory\tDerogatory")).toBe(
      "Derogatory Derogatory Derogatory",
    );
  });

  it("builds a PDF even when wins contain tabs", async () => {
    const { buffer } = await generateOfgProgressReportPdf(
      {
        ...sample,
        wins: [
          {
            itemRemoved: "Credit Card\tNegative Closed — Late Payment",
            bureaus: ["TU", "EX"],
            impact: "Removed",
            status: "Deleted",
          },
        ],
        targets: [
          {
            item: "Closed Finance\t— Late Payment",
            bureaus: ["TU", "EX", "EQ"],
            detail: "Next dispute",
            priority: "high",
          },
        ],
      },
      "Brian_tab_safe.pdf",
    );
    expect(buffer.length).toBeGreaterThan(2000);
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBe(3);
  });

  it("builds a 3-page branded PDF with score content", async () => {
    const { buffer, fileName } = await generateOfgProgressReportPdf(
      sample,
      "Jose_OFG_Progress_Report_Jun2026.pdf",
    );
    expect(fileName).toContain("Jose");
    expect(buffer.length).toBeGreaterThan(2000);
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBe(3);
    // Logo must be embedded (not Helvetica text fallback).
    const raw = buffer.toString("latin1");
    expect(raw).toMatch(/\/Subtype\s*\/Image/);
    expect(raw).not.toContain("Optimum Financial Group");
  });

  it("supports Spanish labels", async () => {
    const { buffer } = await generateOfgProgressReportPdf(
      { ...sample, locale: "es" },
      "Jose_es.pdf",
    );
    const pdf = await PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBe(3);
  });
});

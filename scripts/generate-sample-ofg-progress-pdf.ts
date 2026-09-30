/**
 * Writes a sample client-facing progress report PDF for visual QA.
 * Usage: npx tsx scripts/generate-sample-ofg-progress-pdf.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateOfgProgressReportPdf } from "../api/ofgProgressReportPdf";
import type { OfGReportData } from "../shared/api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../docs/demo-round-reports");

const sample: OfGReportData = {
  client: { firstName: "Jose", lastName: "Sample" },
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
      impact: "Removed from file",
      status: "Deleted",
      highlighted: true,
    },
    {
      itemRemoved: "Late payment - Retail Card",
      bureaus: ["EQ"],
      impact: "Removed",
      status: "Deleted",
    },
    {
      itemRemoved: "Hard inquiry - Auto lender",
      bureaus: ["TU"],
      impact: "Removed",
      status: "Deleted",
    },
  ],
  targets: [
    {
      item: "Charge-off still reporting (Round 2 target)",
      bureaus: ["TU", "EX", "EQ"],
      detail: "Next dispute cycle",
      priority: "high",
    },
    {
      item: "Old collection balance dispute",
      bureaus: ["EX"],
      detail: "Awaiting bureau response",
      priority: "medium",
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
    {
      account: "Store Card",
      limit: 1000,
      balance: 450,
      pctUsed: 45,
      payTo30: 150,
      payTo10: 350,
    },
  ],
  positiveAccounts: [
    "Auto loan - on-time 24 months",
    "Mortgage - current",
    "Credit builder - positive history",
  ],
  actionNeeded: ["Pay Capital One toward 30% utilization"],
  roadmap: {
    currentRound: 2,
    nextRound: 3,
    scoreGoal: 680,
    gapRemaining: 42,
    milestones: [
      "Clear remaining charge-off",
      "Lower revolving utilization under 30%",
      "Re-pull after Round 2 bureau responses",
    ],
  },
  actionPlan: [
    {
      step: 1,
      description: "File Round 2 disputes on remaining negatives",
      owner: "ofg",
    },
    {
      step: 2,
      description: "Bring Capital One under 30% utilization",
      owner: "client",
    },
    {
      step: 3,
      description: "Confirm on-time payments across open accounts",
      owner: "client",
    },
    {
      step: 4,
      description: "Prepare Round 3 pull and progress report",
      owner: "ofg",
    },
  ],
  fileStrengthScore: 68,
  tradelineRecommendation: {
    code: "IH-1",
    projectedImpact: "Projected lift to middle score once seasoned",
  },
  fundingReadinessNote: "On track for funding review after Round 3 if utilization stays healthy.",
  croaDisclosure:
    "You have the right to cancel this contract within 5 days. Credit repair results vary by individual file. Optimum Financial Group does not guarantee specific score outcomes. This report summarizes factual changes observed between the before and after credit reports provided for this round.",
  locale: "en",
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { buffer, fileName } = await generateOfgProgressReportPdf(
    sample,
    "Jose_OFG_Progress_Report_SAMPLE_branded.pdf",
  );
  const out = path.join(OUT_DIR, fileName);
  fs.writeFileSync(out, buffer);
  console.log("Wrote", out, `(${buffer.length} bytes)`);

  const es = await generateOfgProgressReportPdf(
    { ...sample, locale: "es" },
    "Jose_OFG_Reporte_Progreso_SAMPLE_branded.pdf",
  );
  const outEs = path.join(OUT_DIR, es.fileName);
  fs.writeFileSync(outEs, es.buffer);
  console.log("Wrote", outEs, `(${es.buffer.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

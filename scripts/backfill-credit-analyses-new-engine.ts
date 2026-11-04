/**
 * New engine only — one-off backfill for Credit Analyses created by the old
 * text engine: public token + new-engine read (from the stored PDF) + rewrite
 * scores / negatives / labels from ready reads. Never emails clients.
 *
 * Usage: npx tsx scripts/backfill-credit-analyses-new-engine.ts [--apply]
 *        (default is a dry run)
 */
import "dotenv/config";
import { backfillCreditAnalysesToNewEngine } from "../api/index";

const apply = process.argv.includes("--apply");
backfillCreditAnalysesToNewEngine({ dryRun: !apply, log: (m) => console.log(m) })
  .then((r) => {
    console.log(apply ? "APPLIED" : "DRY RUN", JSON.stringify(r, null, 2));
    process.exit(r.failed.length ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

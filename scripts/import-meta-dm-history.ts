/**
 * Imports past Facebook / Instagram DMs into Conversations → Social as closed, read threads
 * (no alerts, real timestamps). Idempotent on the Meta message id — safe to re-run, e.g. for
 * Instagram after App Review.
 *
 *   npx tsx scripts/import-meta-dm-history.ts [--days 90] [--platform messenger|instagram] [--apply]
 *
 * Without --apply it is a dry run: reads Meta, writes nothing, prints counts + a sample.
 */
import "dotenv/config";
import { importMetaDmHistory, pool } from "../api/index";

const argv = process.argv.slice(2);
const val = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const days = Number(val("days") || 90);
const platform = val("platform");
const apply = argv.includes("--apply");

async function main() {
  if (!(days > 0)) throw new Error("--days must be a positive number");
  if (platform && platform !== "messenger" && platform !== "instagram") throw new Error("--platform must be messenger or instagram");
  const summary = await importMetaDmHistory({
    days,
    dryRun: !apply,
    platforms: platform ? [platform as "messenger" | "instagram"] : undefined,
  });
  console.log(JSON.stringify(summary, null, 2));
  console.log(apply ? "\nImported." : "\nDry run only: nothing was written. Re-run with --apply to import.");
}

main()
  .catch((e) => {
    console.error("Import failed:", e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

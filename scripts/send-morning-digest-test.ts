/**
 * One-shot: force-send morning digest to a single admin (real Resend, not dry-run).
 * Usage: unset VITEST && npx tsx scripts/send-morning-digest-test.ts
 */
import "dotenv/config";
import request from "supertest";
import { createServer } from "../api/index";

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET missing");
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");
  if (process.env.VITEST === "true") {
    throw new Error("Unset VITEST so Resend actually sends");
  }

  const to = process.argv[2] || "alex@disruptinglabs.com";
  const forceResend = process.argv.includes("--force-resend");
  const app = createServer();
  const res = await request(app)
    .get("/api/cron/admin-morning-digest")
    .query({
      force: "1",
      admin_email: to,
      ...(forceResend ? { force_resend: "1" } : {}),
    })
    .set("Authorization", `Bearer ${secret}`);

  console.log(JSON.stringify({ status: res.status, body: res.body }, null, 2));
  if (res.status >= 400) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

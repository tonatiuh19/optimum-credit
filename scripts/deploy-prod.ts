import "dotenv/config";

import { spawn, spawnSync } from "child_process";
import { createInterface } from "readline/promises";
import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import { checkApiIndexInline } from "./check-api-inline";
import { ask, notify, projectName } from "./deployAsk";
import {
  collectReleaseChanges,
  markSnapshotAnnounced,
  fetchResolvedRequests,
  postReleaseNotesToSlack,
  resolvedRequestsSection,
  writeReleaseNotes,
} from "./releaseNotes";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeVersion(value: string): string {
  return value.trim();
}

function dbConfig() {
  return {
    host: requireEnv("DB_HOST"),
    port: Number(requireEnv("DB_PORT")),
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASSWORD"),
    database: requireEnv("DB_NAME"),
    ssl:
      process.env.DB_SSL === "false" ? undefined : { minVersion: "TLSv1.2" as const },
    // TiDB Serverless drops idle sockets; never hold a conn across vercel --prod.
    enableKeepAlive: true,
    connectTimeout: 20_000,
  };
}

async function withDb<T>(fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await mysql.createConnection(dbConfig());
  try {
    return await fn(conn);
  } finally {
    await conn.end().catch(() => undefined);
  }
}

let testsRunning = false;
let interrupted = false;
/** True once the shared DB is known clean after the last test run (no second purge needed). */
let purged = false;
/** Set when the test run starts: before that there is no test data to purge. */
let testsStarted = false;

/** Removes every test fixture from the shared DB, synchronously (safe inside signal / exit paths). */
function purgeTestData(reason: string) {
  console.log(`\n🧹 ${reason}: purging test data from the shared DB...\n`);
  const r = spawnSync("npm", ["run", "test:cleanup-fixtures"], { stdio: "inherit", env: process.env });
  purged = r.status === 0;
  console.log(purged ? "\n✅ Test data cleaned up.\n" : "\n⚠️ Cleanup failed. Run: npm run test:cleanup-fixtures\n");
}

/** Where the deploy is, for the abort message ("aborted during the tests"). */
let stage = "starting";

/** Failed tests from the last run (written by scripts/vitestProgressReporter.ts). */
function failedTestsSummary(): string {
  try {
    const list = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "node_modules/.cache/dl-test-failures.json"), "utf8")) as string[];
    if (!list.length) return "";
    return `\n${list.slice(0, 5).map((t) => `• ${t}`).join("\n")}${list.length > 5 ? `\n… and ${list.length - 5} more` : ""}`;
  } catch {
    return "";
  }
}

const tgSafe = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Every abort tells the bot why, where and whether test data was cleaned. Never throws; at most ~10s. */
async function notifyAbort(reason: string): Promise<void> {
  const tests = stage === "tests" ? failedTestsSummary() : "";
  const cleanup = testsStarted ? (purged ? "\n🧹 Test data cleaned up." : "\n⚠️ Test data cleanup did not finish: run npm run test:cleanup-fixtures") : "";
  const text = `❌ <b>${tgSafe(projectName)} deploy aborted</b> (during ${tgSafe(stage)})\n${tgSafe(reason).slice(0, 600)}${tgSafe(tests)}${cleanup}\nNothing new went live.`;
  await Promise.race([notify(text), new Promise((r) => setTimeout(r, 10_000))]);
}

/**
 * Ctrl+C during the test run: vitest is killed mid-suite, so its afterAll
 * cleanups never run and test data stays visible to staff in the live admin.
 * Wait for the children to stop, purge test fixtures synchronously, then exit.
 * A second Ctrl+C exits immediately.
 */
function installInterruptCleanup() {
  const onSignal = (signal: NodeJS.Signals) => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log(`\n⛔ ${signal}: deploy aborted (Ctrl+C again to skip the cleanup).`);
    // Any abort purges, so staff never see test data; wait for vitest workers to exit first.
    setTimeout(() => {
      if (testsStarted) purgeTestData("Aborted");
      void notifyAbort(`Stopped by hand (${signal === "SIGINT" ? "Ctrl+C" : signal}).`).finally(() => process.exit(130));
    }, testsRunning ? 1500 : 0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

async function runCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

// ── Git: deploy only what is committed and pushed on main ────────────────────
// `vercel --prod` uploads the working tree, so what goes live must be exactly origin/main.
// The deploy refuses to start (and refuses to upload) with uncommitted or unpushed work.
// `--allow-dirty` lets uncommitted files ship; main, up to date, pushed and no secrets still apply.

/** Never upload these, even if a .gitignore rule goes missing. */
const SECRET_FILE = /(^|\/)(\.env(?!\.example$)(\..*)?|.*\.(pem|key|p12|pfx)|id_rsa.*|.*credentials.*\.json)$/i;

const git = (args: string[]) => captureCommand("git", args).then((o) => o.trim());

const statusFiles = (porcelain: string) =>
  porcelain
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^.* -> /, ""));

/** On main, same commit as origin/main, nothing uncommitted (unless --allow-dirty), no secrets. */
async function assertGitReady(allowDirty: boolean): Promise<void> {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") throw new Error(`Deploys run from main only (you are on "${branch}"). Merge into main first.`);
  // Not trimmed: each porcelain line starts with a 2-letter code that can begin with a space.
  const files = statusFiles(await captureCommand("git", ["status", "--porcelain"]));
  const secrets = files.filter((f) => SECRET_FILE.test(f));
  if (secrets.length) throw new Error(`These look like secrets and must never be uploaded: ${secrets.join(", ")}. Add them to .gitignore first.`);
  if (files.length && !allowDirty) {
    const list = files.slice(0, 10).map((f) => `   ${f}`).join("\n");
    throw new Error(
      `${files.length} uncommitted change(s). Commit and push to main first (or pass --allow-dirty):\n${list}${files.length > 10 ? `\n   … and ${files.length - 10} more` : ""}`,
    );
  }
  if (files.length) console.log(`\n⚠️  --allow-dirty: ${files.length} uncommitted change(s) will ship without being committed.`);
  await runCommand("git", ["fetch", "--quiet", "origin", "main"]);
  const behind = Number(await git(["rev-list", "--count", "HEAD..origin/main"])) || 0;
  if (behind > 0) throw new Error(`main is ${behind} commit(s) behind origin/main. Pull first (git pull --rebase), then deploy.`);
  const ahead = Number(await git(["rev-list", "--count", "origin/main..HEAD"])) || 0;
  if (ahead > 0) throw new Error(`main has ${ahead} commit(s) not pushed to origin. Run git push origin main, then deploy.`);
}

/** Rule-based suggestion from the changed files: type + main areas, e.g. "feat: city, events, deploy (+12 files)". */
function suggestCommitMessage(porcelain: string): string {
  const lines = porcelain.split("\n").filter(Boolean);
  const files = statusFiles(porcelain);
  const added = lines.filter((l) => l.startsWith("??") || l[0] === "A").map((l) => l.slice(3));
  const isDoc = (f: string) => /\.(md|mdc)$/.test(f);
  const isTest = (f: string) => /\.(test|spec)\.tsx?$/.test(f);
  const type = files.every(isDoc)
    ? "docs"
    : files.every((f) => isTest(f) || isDoc(f))
      ? "test"
      : added.some((f) => /^(client\/(pages|components)|database\/migrations)\//.test(f)) || files.includes("api/index.ts")
        ? "feat"
        : files.every((f) => /^(scripts|\.cursor|\.claude)\/|^package(-lock)?\.json$|\.config\.ts$/.test(f) || isDoc(f))
          ? "chore"
          : "fix";
  const area = (f: string) => {
    if (f.startsWith("client/locales/")) return null;
    if (isTest(f) || isDoc(f)) return null;
    const m = f.match(/^client\/(?:pages|components)\/(?:admin\/|portal\/)?([^/.]+)/);
    if (m) return m[1].replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    if (f.startsWith("database/")) return "database";
    if (f.startsWith("scripts/")) return "deploy scripts";
    if (f === "api/index.ts" || f === "api/swagger.yaml") return "api";
    return f.split("/")[0].replace(/^\./, "");
  };
  const counts = new Map<string, number>();
  for (const f of files) {
    const a = area(f);
    if (a) counts.set(a, (counts.get(a) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
  const extra = files.length > 1 ? ` (+${files.length} files)` : "";
  return `${type}: ${top.length ? top.join(", ") : "update"}${extra}`;
}

/**
 * Before the checks: main must match origin/main. Uncommitted or unpushed work is not an error any more:
 * commit + push with the suggested or a custom message, wait while I handle it myself, or abort.
 */
async function resolveGit(allowDirty: boolean): Promise<void> {
  while (true) {
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch !== "main") throw new Error(`Deploys run from main only (you are on "${branch}"). Merge into main first.`);
    await runCommand("git", ["fetch", "--quiet", "origin", "main"]);
    const behind = Number(await git(["rev-list", "--count", "HEAD..origin/main"])) || 0;
    if (behind > 0) throw new Error(`main is ${behind} commit(s) behind origin/main. Pull first (git pull --rebase), then deploy.`);
    const porcelain = await captureCommand("git", ["status", "--porcelain"]);
    const files = statusFiles(porcelain);
    const secrets = files.filter((f) => SECRET_FILE.test(f));
    if (secrets.length) throw new Error(`These look like secrets and must never be committed or uploaded: ${secrets.join(", ")}. Add them to .gitignore first.`);
    const dirty = files.length > 0 && !allowDirty;
    const ahead = Number(await git(["rev-list", "--count", "origin/main..HEAD"])) || 0;
    if (!dirty && !ahead) {
      if (files.length) console.log(`\n⚠️  --allow-dirty: ${files.length} uncommitted change(s) will ship without being committed.`);
      return;
    }

    const suggested = dirty ? suggestCommitMessage(porcelain) : "";
    const what = dirty
      ? `${files.length} uncommitted change(s)${ahead ? ` and ${ahead} unpushed commit(s)` : ""} on main`
      : `${ahead} commit(s) on main not pushed to origin`;
    console.log(`\n📝 ${what}.`);
    const a = await ask(`${what}. Deploys only ship what is on origin/main.`, [
      ...(dirty
        ? [
            { key: "suggested", label: `Commit + push: "${suggested}"` },
            { key: "custom", label: "Commit + push with my own message", text: "Commit message:" },
          ]
        : [{ key: "push", label: `Push ${ahead} commit(s) to origin/main` }]),
      { key: "manual", label: "I'll handle it in the terminal (wait for me)" },
      { key: "abort", label: "Abort the deploy" },
    ]);
    if (a.key === "abort") throw new Error("Deploy cancelled.");
    if (a.key === "manual") {
      await waitForCleanMain();
      continue;
    }
    if (dirty) {
      const message = a.key === "custom" && a.text ? a.text : suggested;
      await runCommand("git", ["add", "-A"]);
      await runCommand("git", ["commit", "--quiet", "-m", message]);
      console.log(`✅ Committed: ${message}`);
    }
    await runCommand("git", ["push", "origin", "main"]);
    console.log("✅ Pushed to origin/main.");
  }
}

/** "I'll handle it": re-check every 5s until main is clean and pushed (Enter re-checks now). */
async function waitForCleanMain(): Promise<void> {
  console.log("\n⏳ Waiting for you: commit and push to main in another terminal tab. Press Enter here to re-check now, or Ctrl+C to abort.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const enter = () => rl.question("").then(() => undefined);
  try {
    let pending = enter();
    while (true) {
      const clean = !(await captureCommand("git", ["status", "--porcelain"])).trim();
      await runCommand("git", ["fetch", "--quiet", "origin", "main"]).catch(() => undefined);
      const ahead = Number(await git(["rev-list", "--count", "origin/main..HEAD"]).catch(() => "1")) || 0;
      if (clean && !ahead) {
        console.log("✅ main is clean and pushed. Continuing...");
        return;
      }
      const tick = await Promise.race([pending.then(() => "enter"), new Promise((r) => setTimeout(() => r("tick"), 5000))]);
      if (tick === "enter") pending = enter();
    }
  } finally {
    rl.close();
  }
}

const bump = (v: string, part: "patch" | "minor" | "major") => {
  const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return part === "major" ? `${maj + 1}.0.0` : part === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
};

/** Suggested patch / minor, a custom one, or typed by me in the terminal. */
async function chooseVersion(current: string | null): Promise<string> {
  const cur = current?.trim() || "";
  console.log(`\n🏷️  Current production version: ${cur || "not set"}`);
  const patch = bump(cur, "patch");
  const minor = bump(cur, "minor");
  const a = await ask(`Release version (now ${cur || "not set"})`, [
    ...(patch ? [{ key: "patch", label: `${patch} (patch, suggested)` }] : []),
    ...(minor ? [{ key: "minor", label: `${minor} (minor)` }] : []),
    { key: "custom", label: "Custom version", text: "Version:" },
    { key: "manual", label: "I'll type it in the terminal (wait for me)" },
    { key: "abort", label: "Abort the deploy" },
  ]);
  if (a.key === "abort") throw new Error("Deploy cancelled.");
  if (a.key === "patch" && patch) return patch;
  if (a.key === "minor" && minor) return minor;
  if (a.key === "custom" && a.text) return normalizeVersion(a.text);
  return promptForVersion(current);
}

/** After the deploy is live: tag the release. A failure only warns (the site is already up). */
async function tagRelease(version: string): Promise<void> {
  const tag = `v${version.replace(/^v/i, "")}`;
  try {
    if (await git(["tag", "--list", tag])) {
      console.log(`ℹ️  Tag ${tag} already exists; not moving it.`);
      return;
    }
    await runCommand("git", ["tag", "-a", tag, "-m", `Production release ${version}`]);
    await runCommand("git", ["push", "origin", tag]);
    console.log(`✅ Tagged and pushed ${tag}.`);
  } catch (e) {
    console.warn(`⚠️  Deploy is live, but tagging failed (${e instanceof Error ? e.message : String(e)}). Run: git tag -a ${tag} -m "Production release ${version}" && git push origin ${tag}`);
  }
}

/**
 * Typecheck + Vercel inline monolith gate + vitest — must pass before prod.
 * Relative runtime imports from api/index.ts → ERR_MODULE_NOT_FOUND on Vercel.
 */
async function runPreDeployChecks() {
  console.log("\n🧪 Pre-deploy checks: api inline + typecheck + tests...\n");

  const inline = checkApiIndexInline();
  console.log(inline.report);
  if (!inline.ok) {
    throw new Error(
      "api/index.ts has relative runtime imports — inline the logic before deploying to Vercel.",
    );
  }

  stage = "typecheck";
  await runCommand("npm", ["run", "typecheck"]);
  console.log("\n✅ Typecheck passed.\n");
  // Tests write fixtures to the shared TiDB: purge test data whether the
  // tests pass, fail, or are interrupted (Ctrl+C → installInterruptCleanup).
  testsRunning = true;
  testsStarted = true;
  purged = false;
  try {
    // On a terminal: one live progress bar (scripts/vitestProgressReporter.ts) instead of every test line.
    const progress = process.stdout.isTTY ? ["--reporter=./scripts/vitestProgressReporter.ts"] : [];
    stage = "tests";
    await runCommand("npx", ["vitest", "--run", ...progress]).catch((e) => {
      throw interrupted ? e : new Error(`Tests failed.${failedTestsSummary() ? "" : ` (${e instanceof Error ? e.message : e})`}`);
    });
    console.log("\n✅ Tests passed. Continuing to deploy...\n");
  } finally {
    testsRunning = false;
    if (!interrupted) purgeTestData("Tests finished");
  }
  if (!purged) throw new Error("Test data cleanup failed, so staff could see test rows. Run npm run test:cleanup-fixtures, then deploy again.");
  stage = "production env check";
  await checkProductionEnv();
}

/**
 * Production env vars that features need at runtime but that nothing else
 * catches before deploy (a missing one only shows up as a 503 in prod).
 */
const REQUIRED_PROD_ENV: Array<{ name: string; why: string; fix: string }> = [
  { name: "DB_HOST", why: "every API call (TiDB)", fix: "Vercel → Settings → Environment Variables → add the TiDB host to Production" },
  { name: "DB_PASSWORD", why: "every API call (TiDB)", fix: "Vercel → Settings → Environment Variables → add the TiDB password to Production" },
  { name: "PUBLIC_APP_URL", why: "links in emails, SMS and in-app notifications (falls back to the Vercel host)", fix: "Vercel → Production env → PUBLIC_APP_URL=https://www.ofgllc.com" },
  { name: "RESEND_API_KEY", why: "all emails (login codes, welcome, reports)", fix: "Email provider dashboard → API keys → add to Vercel Production" },
  { name: "TWILIO_ACCOUNT_SID", why: "SMS and voice calls", fix: "Twilio console → Account info → add to Vercel Production" },
  { name: "TWILIO_AUTH_TOKEN", why: "SMS, voice calls and webhook signatures", fix: "Twilio console → Account info → add to Vercel Production" },
  { name: "ANTHROPIC_API_KEY", why: "credit report reads, AI assistant and inbound AI", fix: "Anthropic console → API keys → add to Vercel Production" },
  { name: "CRON_SECRET", why: "scheduled jobs (notification queue, reminders); without it crons are rejected", fix: "Generate a long random value → add to Vercel Production" },
  { name: "AUTHORIZENET_API_LOGIN_ID", why: "client payments", fix: "Payment gateway → API credentials → add to Vercel Production" },
  { name: "AUTHORIZENET_TRANSACTION_KEY", why: "client payments", fix: "Payment gateway → API credentials → add to Vercel Production" },
];

async function captureCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, env: process.env });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`)),
    );
  });
}

/** Lists Production env names on Vercel; asks before deploying if a required one is missing. */
async function checkProductionEnv() {
  console.log("\n🔐 Checking Vercel production env vars...\n");
  let listing: string;
  try {
    listing = await captureCommand("npx", ["vercel", "env", "ls", "production"]);
  } catch (err) {
    console.log(`⚠️  Could not list Vercel env vars (${(err as Error).message}). Skipping env check.`);
    return;
  }
  const names = new Set(listing.split("\n").map((line) => line.trim().split(/\s+/)[0]).filter((n) => /^[A-Z][A-Z0-9_]*$/.test(n)));
  const missing = REQUIRED_PROD_ENV.filter((v) => !names.has(v.name));
  if (!missing.length) {
    console.log("✅ Required production env vars present.\n");
    return;
  }
  for (const v of missing) {
    console.log(`❌ Missing ${v.name} in Vercel Production — needed for ${v.why}.\n   Fix: ${v.fix}`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("\n❓ Deploy anyway? Those features will return 503 until the var is added. (y/N): ");
    if (answer.trim().toLowerCase() !== "y") throw new Error("Deploy cancelled: missing production env vars.");
  } finally {
    rl.close();
  }
}

async function promptForVersion(
  currentVersion: string | null,
): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const currentLabel = currentVersion?.trim() || "not set";
    console.log(`\n🏷️  Current production version: ${currentLabel}`);

    while (true) {
      const input = await rl.question("✏️  Enter deploy version: ");
      const version = normalizeVersion(input);
      if (!version) {
        console.log("❌ Version cannot be empty.");
        continue;
      }

      const confirm = await rl.question(
        `❓ Deploy version ${version} to production and update app_version after success? (y/N): `,
      );
      if (confirm.trim().toLowerCase() === "y") {
        console.log(`✅ Confirmed. Proceeding with version ${version}...`);
        return version;
      } else {
        console.log(
          "❌ Deploy cancelled. Please enter a new version or Ctrl+C to abort.",
        );
      }
    }
  } finally {
    rl.close();
  }
}

async function readAppVersion(): Promise<string | null> {
  return withDb(async (conn) => {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT setting_value
         FROM system_settings
        WHERE setting_key = 'app_version'
        LIMIT 1`,
    );
    return (rows as mysql.RowDataPacket[])[0]?.setting_value ?? null;
  });
}

async function writeAppVersion(deployVersion: string): Promise<void> {
  await withDb(async (conn) => {
    await conn.execute(
      `INSERT INTO system_settings (
         setting_key,
         setting_value,
         description,
         updated_at
       ) VALUES ('app_version', ?, 'Current deployed application version shown in the admin settings page.', NOW())
       ON DUPLICATE KEY UPDATE
         setting_value = VALUES(setting_value),
         description = VALUES(description),
         updated_at = NOW()`,
      [deployVersion],
    );
  });
}

async function main() {
  // `npm run deploy:stamp-version -- 1.2.12`: only record the version (deploy already live).
  if (process.argv[2] === "--stamp-only") {
    const v = normalizeVersion(process.argv[3] || "");
    if (!v) throw new Error("Usage: npm run deploy:stamp-version -- <version>");
    await writeAppVersion(v);
    console.log(`✅ app_version set to ${v}.`);
    return;
  }
  installInterruptCleanup();
  // Validate DB env early (before long typecheck/deploy).
  dbConfig();

  const cliArgs = process.argv.slice(2);
  const skipChecks =
    cliArgs.includes("--skip-checks") ||
    process.env.SKIP_DEPLOY_CHECKS === "1" ||
    process.env.SKIP_DEPLOY_CHECKS === "true";
  // --allow-dirty: deploy uncommitted files as they are; main, up to date with origin and no secrets still apply.
  const allowDirty = cliArgs.includes("--allow-dirty");
  const filteredArgs = cliArgs.filter((arg) => arg !== "--skip-checks" && arg !== "--allow-dirty");
  const explicitVersion =
    filteredArgs.find((arg) => !arg.startsWith("-")) ?? "";
  const vercelArgs = explicitVersion
    ? filteredArgs.filter(
        (arg, index) => index !== filteredArgs.indexOf(explicitVersion),
      )
    : filteredArgs;

  stage = "git check";
  await resolveGit(allowDirty);
  await notify(`🧪 <b>${projectName} deploy</b>: checks started on <code>${(await git(["rev-parse", "--short", "HEAD"])).slice(0, 12)}</code>.`);

  if (!skipChecks) {
    await runPreDeployChecks();
  } else {
    console.log(
      "\n⚠️  Skipping pre-deploy checks (--skip-checks / SKIP_DEPLOY_CHECKS).\n",
    );
  }

  // Again after the checks: nothing committed, pulled or edited meanwhile slips into the upload.
  stage = "git re-check after the tests";
  await assertGitReady(allowDirty);

  // Short-lived connection — do not hold open across vercel --prod
  // (TiDB Serverless closes idle sockets → "connection is in closed state").
  const currentVersion = await readAppVersion();
  const deployVersion = explicitVersion
    ? normalizeVersion(explicitVersion)
    : await (async () => {
        stage = "version question";
        return chooseVersion(currentVersion);
      })();

  if (!deployVersion) {
    throw new Error("Deploy version cannot be empty.");
  }

  console.log(
    `\n🚀 Starting Vercel production deploy for version ${deployVersion}...\n`,
  );
  stage = "Vercel upload";
  await runCommand("npx", ["vercel", "--prod", ...vercelArgs]);
  stage = "after going live";

  // The site is already live here: a network blip on the version stamp must not read as a failed
  // deploy. Retry a few times, then say exactly what to run instead of "Deploy aborted".
  let stamped = false;
  for (let attempt = 1; attempt <= 4 && !stamped; attempt++) {
    try {
      await writeAppVersion(deployVersion);
      stamped = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 4) {
        console.warn(
          `\n⚠️  Deploy is LIVE, but saving app_version ${deployVersion} failed (${msg}).\n   Run: npm run deploy:stamp-version -- ${deployVersion}`,
        );
        // The site is live either way: still record the release in git.
        await tagRelease(deployVersion);
        await announceRelease(deployVersion);
        return;
      }
      console.warn(`⏳ Saving app_version failed (${msg}); retrying (${attempt}/3)...`);
      await new Promise((r) => setTimeout(r, attempt * 5_000));
    }
  }

  console.log(
    `\n🎉 Production deploy succeeded! app_version updated to ${deployVersion}.`,
  );
  await tagRelease(deployVersion);
  await notify(`🎉 <b>${projectName} ${deployVersion} is live.</b>`);
  stage = "release notes";
  await announceRelease(deployVersion);
}

/** "What's new" to Slack #releases — only after a successful deploy; never fails it. */
async function announceRelease(version: string): Promise<void> {
  try {
    const settings = await withDb(async (conn) => {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        `SELECT setting_key, setting_value FROM system_settings
         WHERE setting_key IN ('release_notes_snapshot', 'released_request_ids')`,
      );
      return new Map((rows as mysql.RowDataPacket[]).map((r) => [String(r.setting_key), r.setting_value as string | null]));
    });
    const lastSnapshot = settings.get("release_notes_snapshot") ?? null;
    let announcedIds: string[] = [];
    try {
      announcedIds = JSON.parse(settings.get("released_request_ids") || "[]");
    } catch {
      announcedIds = [];
    }
    const changes = collectReleaseChanges(lastSnapshot);
    const saveSnapshot = async () => {
      if (!changes.snapshot) return;
      markSnapshotAnnounced(changes.snapshot);
      await withDb((conn) =>
        conn.execute(
          `INSERT INTO system_settings (setting_key, setting_value, description, updated_at)
           VALUES ('release_notes_snapshot', ?, 'Code snapshot last announced in Slack release notes (deploy-prod).', NOW())
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
          [changes.snapshot],
        ),
      );
    };
    if (!changes.hasBaseline) {
      // First run on this mechanism: everything up to now was already announced.
      await saveSnapshot();
      console.log("ℹ️  Release notes baseline recorded — the next deploy announces only new changes.");
      return;
    }
    // Requests marked Done in the Slack list since the last announcement.
    const resolved = await fetchResolvedRequests(new Set(announcedIds));
    const text = (await writeReleaseNotes(version, changes)) + resolvedRequestsSection(resolved);
    if (!(await postReleaseNotesToSlack(text))) return;
    console.log(`📣 Release notes posted to Slack${resolved.length ? ` (+${resolved.length} resolved request(s))` : ""}.`);
    if (resolved.length) {
      const ids = [...announcedIds, ...resolved.map((r) => r.id)].slice(-1000);
      await withDb((conn) =>
        conn.execute(
          `INSERT INTO system_settings (setting_key, setting_value, description, updated_at)
           VALUES ('released_request_ids', ?, 'Slack request list rows already announced as resolved (deploy-prod).', NOW())
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()`,
          [JSON.stringify(ids)],
        ),
      );
    }
    await saveSnapshot();
  } catch (e) {
    console.warn(`⚠️  Release announcement skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}


main().catch(async (error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ Deploy aborted: ${msg}`);
  // Ctrl+C: the signal handler is still waiting for vitest to stop and owns the cleanup, message and exit.
  if (interrupted) return;
  if (testsStarted && !purged) purgeTestData("Deploy aborted");
  await notifyAbort(msg);
  process.exit(1);
});

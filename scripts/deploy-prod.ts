import "dotenv/config";

import { spawn } from "child_process";
import { createInterface } from "readline/promises";
import mysql from "mysql2/promise";

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

/** Typecheck + vitest — must pass before production deploy. */
async function runPreDeployChecks() {
  console.log("\n🧪 Pre-deploy checks: typecheck + tests...\n");
  await runCommand("npm", ["run", "typecheck"]);
  console.log("\n✅ Typecheck passed.\n");
  await runCommand("npm", ["test"]);
  console.log("\n✅ Tests passed. Continuing to deploy...\n");
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

async function main() {
  const dbHost = requireEnv("DB_HOST");
  const dbPort = Number(requireEnv("DB_PORT"));
  const dbUser = requireEnv("DB_USER");
  const dbPassword = requireEnv("DB_PASSWORD");
  const dbName = requireEnv("DB_NAME");

  const cliArgs = process.argv.slice(2);
  const skipChecks =
    cliArgs.includes("--skip-checks") ||
    process.env.SKIP_DEPLOY_CHECKS === "1" ||
    process.env.SKIP_DEPLOY_CHECKS === "true";
  const filteredArgs = cliArgs.filter((arg) => arg !== "--skip-checks");
  const explicitVersion =
    filteredArgs.find((arg) => !arg.startsWith("-")) ?? "";
  const vercelArgs = explicitVersion
    ? filteredArgs.filter(
        (arg, index) => index !== filteredArgs.indexOf(explicitVersion),
      )
    : filteredArgs;

  if (!skipChecks) {
    await runPreDeployChecks();
  } else {
    console.log(
      "\n⚠️  Skipping pre-deploy checks (--skip-checks / SKIP_DEPLOY_CHECKS).\n",
    );
  }

  const conn = await mysql.createConnection({
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPassword,
    database: dbName,
    ssl: process.env.DB_SSL === "false" ? undefined : { minVersion: "TLSv1.2" },
  });

  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT setting_value
         FROM system_settings
        WHERE setting_key = 'app_version'
        LIMIT 1`,
    );

    const currentVersion =
      (rows as mysql.RowDataPacket[])[0]?.setting_value ?? null;
    const deployVersion = explicitVersion
      ? normalizeVersion(explicitVersion)
      : await promptForVersion(currentVersion);

    if (!deployVersion) {
      throw new Error("Deploy version cannot be empty.");
    }

    console.log(
      `\n🚀 Starting Vercel production deploy for version ${deployVersion}...\n`,
    );
    await runCommand("npx", ["vercel", "--prod", ...vercelArgs]);

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

    console.log(
      `\n🎉 Production deploy succeeded! app_version updated to ${deployVersion}.`,
    );
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(
    `\n❌ Deploy aborted: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});

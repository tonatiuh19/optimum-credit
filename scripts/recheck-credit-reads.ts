/**
 * One-time re-check of reads stored before the Nov 6, 2026 reader fixes. Dry run by default:
 * prints what it would do (extraction / report ids and counts only, no names or report data).
 *
 *   npm run recheck:reads                      what would change
 *   npm run recheck:reads -- --apply           re-queue short progress reads + alert held reports
 *
 * 1. Progress reads short of their own report (entries below the table of contents, or a creditor with
 *    fewer accounts than the text prints) → re-queued with today's text data, so the read cron reads
 *    them again with the fixed reader (split-merge fix, reconcile pass with creditor hints).
 * 2. Credit analyses the printed-fact repairs would change → listed only (already delivered to leads;
 *    never rewritten silently).
 * 3. Reports held right now (needs_review) → listed with their reasons; --apply sends the held alert.
 */
import "dotenv/config";
// Alerts written from this machine must link to production, never the local .env's localhost (Nov 3, 2026).
process.env.PUBLIC_APP_URL = "https://www.ofgllc.com";
process.env.APP_URL = "https://www.ofgllc.com";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { parseCreditFile, type CreditFile } from "../api/creditFile";
import { normalizeStoredRead } from "../api/creditFileExtract";
import { pv2ApplyPrintedFacts, pv2CreditorShortfall, pv2ParsePullSummary, pv2ReadEntries } from "../api/progressReportV2";

const apply = process.argv.includes("--apply");
const parse = <T>(v: unknown): T | null => {
  if (v == null) return null;
  try {
    return (typeof v === "string" ? JSON.parse(v) : v) as T;
  } catch {
    return null;
  }
};

async function pdfText(r: mysql.RowDataPacket): Promise<string | null> {
  if (!/^https?:/.test(String(r.storage_key || "")) || !process.env.DOC_ENCRYPTION_KEY) return null;
  try {
    const enc = Buffer.from(await (await fetch(String(r.storage_key), { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
    const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(process.env.DOC_ENCRYPTION_KEY, "hex"), Buffer.from(String(r.enc_iv), "hex"));
    d.setAuthTag(Buffer.from(String(r.enc_tag), "hex"));
    const { PDFParse } = await import("pdf-parse");
    return (await new PDFParse({ data: Buffer.concat([d.update(enc), d.final()]) }).getText()).text;
  } catch {
    return null;
  }
}

/** Short-lived connections: TiDB Serverless drops a socket left idle during the PDF downloads. */
const connect = () =>
  mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === "false" ? undefined : { minVersion: "TLSv1.2" },
  });

async function main() {
  console.log(apply ? "\nApplying.\n" : "\nDry run (add --apply to act).\n");
  let conn = await connect();

  // 1 + 2: the latest ready read per file (progress and analysis).
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    // Current reader only (Oct 28+): older reads have no entry count, are never reused and are gated as a base.
    `SELECT id, purpose, file_sha256, extracted_json, storage_key, enc_iv, enc_tag
       FROM credit_file_extractions
      WHERE (id IN (SELECT MAX(id) FROM credit_file_extractions WHERE status = 'ready' AND extracted_json IS NOT NULL GROUP BY COALESCE(file_sha256, CONCAT('id', id)))
             -- Every copy stored with repairs applied (Nov 7 build), reused copies included.
             OR (status = 'ready' AND JSON_CONTAINS_PATH(extracted_json, 'one', '$.printedRepairs')))
        AND storage_key LIKE 'http%' AND extract_version IS NOT NULL
      ORDER BY id DESC`,
  );
  await conn.end();
  const shortReads: Array<{ id: number; why: string; skeleton: string }> = [];
  // Today's summaries (printed facts, parser v3) for every file read here: saved with --apply so no
  // report waits for a PDF download + re-parse on its first open after the deploy.
  const warm: Array<{ id: number; sha: string | null; summary: string }> = [];
  const analysesChanged: number[] = [];
  for (let i = 0; i < rows.length; i += 8) {
    await Promise.all(
      rows.slice(i, i + 8).map(async (r) => {
        const stored = parse<CreditFile>(r.extracted_json);
        if (!stored?.accounts) return;
        const text = await pdfText(r);
        if (!text) return;
        const skeleton = parseCreditFile(text) as CreditFile & { pullSummary2?: unknown };
        const summary = pv2ParsePullSummary(text);
        skeleton.pullSummary2 = summary;
        const file = normalizeStoredRead(stored);
        if (summary) warm.push({ id: Number(r.id), sha: r.file_sha256 ? String(r.file_sha256) : null, summary: JSON.stringify(summary) });
        if ((stored as CreditFile).printedRepairs?.length) {
          // The Nov 7 build saved repaired values: only a fresh read gets the reader's own values back.
          shortReads.push({ id: Number(r.id), why: "stored with repairs applied (Nov 7 build) — read again for the reader's own values", skeleton: JSON.stringify(skeleton) });
        } else if (r.purpose === "progress_before" || r.purpose === "progress_after") {
          const why: string[] = [];
          if (summary?.accountsPrinted && pv2ReadEntries(file) < summary.accountsPrinted) why.push(`${pv2ReadEntries(file)} of ${summary.accountsPrinted} listed`);
          for (const c of pv2CreditorShortfall(file, skeleton)) why.push(`${c.creditor} ${c.read}/${c.printed}`);
          if (why.length) shortReads.push({ id: Number(r.id), why: why.join("; "), skeleton: JSON.stringify(skeleton) });
        } else if (r.purpose === "analysis" && pv2ApplyPrintedFacts(file, summary) !== file) {
          analysesChanged.push(Number(r.id));
        }
      }),
    );
  }

  console.log(`1. Reads to read again (short, or stored with repairs applied): ${shortReads.length}`);
  for (const s of shortReads) console.log(`   ${s.id}  ${s.why.slice(0, 160)}`);
  if (apply && shortReads.length) {
    conn = await connect();
    for (const s of shortReads) {
      // Today's text data (summary with printed facts, per-bureau Days Late) + back to the read queue.
      await conn.query(
        `UPDATE credit_file_extractions
            SET text_skeleton_json = CAST(? AS JSON), status = 'queued', attempts = 0, batch_id = NULL, error_message = NULL
          WHERE id = ? AND status = 'ready'`,
        [s.skeleton, s.id],
      );
    }
    console.log(`   → re-queued ${shortReads.length}; the read cron re-reads them (2-4 min each).`);
    await conn.end();
  }

  console.log(`\n   Summaries to save (no first-open delay): ${warm.length}`);
  if (apply && warm.length) {
    conn = await connect();
    for (const w of warm) {
      // Every copy of the same PDF (reused reads share its fingerprint).
      await conn.query(
        `UPDATE credit_file_extractions
            SET text_skeleton_json = JSON_SET(COALESCE(text_skeleton_json, JSON_OBJECT()), '$.pullSummary2', CAST(? AS JSON))
          WHERE ${w.sha ? "file_sha256 = ?" : "id = ?"}`,
        [w.summary, w.sha ?? w.id],
      );
    }
    await conn.end();
    console.log(`   → saved ${warm.length}.`);
  }

  console.log(`\n2. Credit analyses the printed-fact repairs would change (listed only): ${analysesChanged.length}`);
  if (analysesChanged.length) console.log(`   ${analysesChanged.slice(0, 40).join(", ")}${analysesChanged.length > 40 ? " …" : ""}`);

  // 3: reports held right now.
  conn = await connect();
  const [held] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT r.id, r.client_id, r.round_number, r.self_check_json, CONCAT_WS(' ', c.first_name, c.last_name) AS name
       FROM client_round_reports r JOIN clients c ON c.id = r.client_id
      WHERE r.delivery_status = 'needs_review'
      ORDER BY r.id`,
  );
  await conn.end();
  console.log(`\n3. Reports held right now: ${held.length}`);
  const { notifyReportHeldAlert, reportHeldReasons } = await import("../api/index");
  let alerted = 0;
  for (const h of held) {
    const checks = parse<Array<{ key: string; pass: boolean | null; detail?: string }>>(h.self_check_json) ?? [];
    console.log(`   report ${h.id} R${h.round_number}: ${reportHeldReasons(checks).join(" | ").slice(0, 200) || "(no failed check stored)"}`);
    if (apply) alerted += await notifyReportHeldAlert({ roundReportId: Number(h.id), clientId: Number(h.client_id), roundNumber: Number(h.round_number), clientName: String(h.name || `Client #${h.client_id}`), checks });
  }
  if (apply) console.log(`   → ${alerted} alert(s) sent (once per report).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

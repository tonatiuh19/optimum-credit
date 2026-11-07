/**
 * Read-only audit of every stored credit-report read against the report's OWN printed totals
 * (Nov 6, 2026). Finds whole classes of reader problems across all clients instead of one file at
 * a time: missing accounts, short reused reads, account / balance / limit / inquiry totals that do
 * not match. Prints counts per format and extraction ids only (no names, no report data).
 *
 *   npm run audit:reads                  all distinct files (latest ready read per file)
 *   npm run audit:reads -- 200           only the 200 most recent
 *   npm run audit:reads -- 200 --fresh   re-parse each PDF's text with today's parsers (downloads + decrypts; slower)
 */
import "dotenv/config";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { parseCreditFile } from "../api/creditFile";
import type { Bureau, CreditFile } from "../api/creditFile";
import { isClosedTradeline } from "../api/creditAnalysisFromFile";
import { normalizeStoredRead } from "../api/creditFileExtract";
import { parseReportDate } from "../api/creditAnalysisFromFile";
import { pv2ApplyPrintedFacts, pv2CreditorShortfall, pv2Diff, pv2ParsePullSummary, pv2ReadEntries, pv2SummaryShortfall, pv2WithinTwoYears, type Pv2PullSummary } from "../api/progressReportV2";

const BUREAUS: Bureau[] = ["TU", "EX", "EQ"];
const parse = <T>(v: unknown): T | null => {
  if (v == null) return null;
  try {
    return (typeof v === "string" ? JSON.parse(v) : v) as T;
  } catch {
    return null;
  }
};

type Finding = "entries_short" | "summary_shortfall" | "creditor_short" | "bureau_totals" | "balances" | "balances_after_repair" | "limits" | "limits_after_repair" | "inquiries" | "inquiries_after_repair" | "headers_short" | "repair_broke" | "repair_unfixed";

function audit(file: CreditFile, s: Pv2PullSummary | null, skeleton: CreditFile | null): Finding[] {
  const out: Finding[] = [];
  const printed = s?.accountsPrinted ?? s?.merged?.totalAccounts ?? null;
  if (printed && pv2ReadEntries(file) < printed) out.push("entries_short");
  if (s && pv2SummaryShortfall(file, s)) out.push("summary_shortfall");
  if (skeleton && pv2CreditorShortfall(file, skeleton).length) out.push("creditor_short");
  // SmartCredit with every page as text: one header per account block (split cards print 2 blocks, so only entries are compared).
  if (skeleton?.accounts?.length && skeleton.imagePages === 0 && pv2ReadEntries(file) < skeleton.accounts.length - 1) out.push("headers_short");
  if (!s) return out;
  const near = (got: number, want: number, abs: number, rel: number) => Math.abs(got - want) <= Math.max(abs, want * rel);
  for (const b of BUREAUS) {
    const total = s.perBureau?.[b]?.totalAccounts;
    if (total != null && file.accounts.filter((a) => a.bureaus[b]).length < total - Math.max(1, Math.round(total * 0.05))) out.push("bureau_totals");
  }
  // Each check as read, and after the guarded repairs from printed facts (what staff would still see).
  const repaired = pv2ApplyPrintedFacts(file, s);
  const limitSum = (f: CreditFile, b: (typeof BUREAUS)[number]) =>
    f.accounts.filter((a) => a.section === "revolving" && a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a)).reduce((n, a) => n + (a.bureaus[b]!.creditLimit ?? 0), 0);
  const balSum = (f: CreditFile, b: (typeof BUREAUS)[number]) => f.accounts.reduce((n, a) => n + Math.max(0, a.bureaus[b]?.balance ?? 0), 0);
  const balancesOff = (f: CreditFile) =>
    BUREAUS.some((b) => {
      const want = s.perBureau?.[b]?.balances;
      return want != null && !near(f.accounts.reduce((n, a) => n + Math.max(0, a.bureaus[b]?.balance ?? 0), 0), want, 10, 0.01);
    });
  const limitsOff = (f: CreditFile) =>
    BUREAUS.some((b) => {
      const want = s.revolving?.[b]?.limit;
      if (want == null) return false;
      const got = f.accounts.filter((a) => a.section === "revolving" && a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a)).reduce((n, a) => n + (a.bureaus[b]!.creditLimit ?? 0), 0);
      return !near(got, want, 50, 0.02);
    });
  const inquiriesOff = (f: CreditFile) => {
    const asOf = parseReportDate(f.reportDate);
    return BUREAUS.some((b) => {
      const want = s.perBureau?.[b]?.inquiries2y;
      if (want == null) return false;
      const got = f.inquiries.filter((q) => {
        if (q.bureau !== b) return false;
        const d = parseReportDate(q.date);
        return !d || !asOf || s.format === "mfsn" || pv2WithinTwoYears(d, asOf);
      }).length;
      return got !== want;
    });
  };
  // Gate (Nov 7, 2026): a repair may only change a bureau it makes match, and never break one that matched.
  const nearLim = (f: CreditFile, b: (typeof BUREAUS)[number]) => {
    const want = s.revolving?.[b]?.limit;
    return want == null ? null : near(limitSum(f, b), want, 50, 0.02);
  };
  const nearBal = (f: CreditFile, b: (typeof BUREAUS)[number]) => {
    const want = s.perBureau?.[b]?.balances;
    return want == null ? null : near(balSum(f, b), want, 10, 0.01);
  };
  for (const b of BUREAUS) {
    for (const [okBefore, okAfter, changed] of [
      [nearLim(file, b), nearLim(repaired, b), limitSum(file, b) !== limitSum(repaired, b)],
      [nearBal(file, b), nearBal(repaired, b), balSum(file, b) !== balSum(repaired, b)],
    ] as const) {
      if (okBefore === null) continue;
      if (okBefore && !okAfter) out.push("repair_broke");
      else if (!okBefore && !okAfter && changed) out.push("repair_unfixed");
    }
  }
  if (balancesOff(file)) out.push(balancesOff(repaired) ? "balances_after_repair" : "balances");
  if (limitsOff(file)) out.push(limitsOff(repaired) ? "limits_after_repair" : "limits");
  if (inquiriesOff(file)) out.push(inquiriesOff(repaired) ? "inquiries_after_repair" : "inquiries");
  return [...new Set(out)];
}

async function main() {
  const args = process.argv.slice(2);
  const fresh = args.includes("--fresh");
  // --gate: exit 1 when a repair broke a matching bureau or changed one it did not fix (current reader only).
  const gate = args.includes("--gate");
  const limit = Number(args.find((a) => /^\d+$/.test(a))) || 0;
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === "false" ? undefined : { minVersion: "TLSv1.2" },
  });
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT id, provider, read_mode, extract_version, extracted_json, text_skeleton_json, storage_key, enc_iv, enc_tag
       FROM credit_file_extractions
      WHERE id IN (SELECT MAX(id) FROM credit_file_extractions WHERE status = 'ready' AND extracted_json IS NOT NULL GROUP BY COALESCE(file_sha256, CONCAT('id', id)))
      ORDER BY id DESC ${limit ? `LIMIT ${limit}` : ""}`,
  );

  // Cross-round: every published round's Before → After comparison rebuilt as the engine does; a "removed"
  // account whose creditor and open month are still in the After is a matching problem (a false win).
  const [rounds] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT r.id, r.round_number,
            (SELECT e.extracted_json FROM credit_file_extractions e WHERE e.report_wizard_session_id = r.wizard_session_id AND e.purpose = 'progress_before' AND e.status = 'ready' ORDER BY e.id DESC LIMIT 1) AS before_json,
            (SELECT e.text_skeleton_json FROM credit_file_extractions e WHERE e.report_wizard_session_id = r.wizard_session_id AND e.purpose = 'progress_before' AND e.status = 'ready' ORDER BY e.id DESC LIMIT 1) AS before_skel,
            (SELECT e.extracted_json FROM credit_file_extractions e WHERE e.report_wizard_session_id = r.wizard_session_id AND e.purpose = 'progress_after' AND e.status = 'ready' ORDER BY e.id DESC LIMIT 1) AS after_json,
            (SELECT e.text_skeleton_json FROM credit_file_extractions e WHERE e.report_wizard_session_id = r.wizard_session_id AND e.purpose = 'progress_after' AND e.status = 'ready' ORDER BY e.id DESC LIMIT 1) AS after_skel
       FROM client_round_reports r
      WHERE r.wizard_session_id IS NOT NULL
      ORDER BY r.id DESC ${limit ? `LIMIT ${limit}` : ""}`,
  );
  await conn.end();
  const key8 = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const month = (a: CreditFile["accounts"][number]) => {
    for (const b of BUREAUS) {
      const m = /^(\d{1,2})\/(?:\d{1,2}\/)?(\d{4})$/.exec(String(a.bureaus[b]?.dateOpened ?? ""));
      if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
    }
    return null;
  };
  let roundsChecked = 0;
  let gated = 0;
  const suspect: string[] = [];
  for (const r of rounds) {
    const bj = parse<CreditFile>(r.before_json);
    const aj = parse<CreditFile>(r.after_json);
    if (!bj?.accounts || !aj?.accounts) continue;
    const sb = parse<{ pullSummary2?: Pv2PullSummary | null }>(r.before_skel)?.pullSummary2 ?? null;
    const sa = parse<{ pullSummary2?: Pv2PullSummary | null }>(r.after_skel)?.pullSummary2 ?? null;
    const before = pv2ApplyPrintedFacts(normalizeStoredRead(bj), sb);
    const after = pv2ApplyPrintedFacts(normalizeStoredRead(aj), sa);
    // Pairs today's completeness gate blocks (half-loaded prints, legacy rounds) are never compared.
    if (pv2SummaryShortfall(before, sb) || pv2SummaryShortfall(after, sa) || before.accounts.length <= 3 || after.accounts.length <= 3) {
      gated++;
      continue;
    }
    let diff;
    try {
      diff = pv2Diff(before, after);
    } catch {
      continue;
    }
    roundsChecked++;
    const removed = diff.wins.filter((w) => w.kind === "account" && w.status === "REMOVED");
    for (const w of removed) {
      const src = before.accounts.find((a) => w.item.toLowerCase().includes(a.creditor.toLowerCase().slice(0, 10)));
      if (!src) continue;
      const m = month(src);
      if (m && after.accounts.some((a) => key8(a.creditor) === key8(src.creditor) && month(a) === m)) suspect.push(`${r.id} R${r.round_number}`);
    }
  }

  // --fresh: the text as today's parsers see it (what production uses once a file is opened again).
  const freshText = async (r: mysql.RowDataPacket): Promise<string | null> => {
    if (!fresh || !/^https?:/.test(String(r.storage_key || "")) || !process.env.DOC_ENCRYPTION_KEY) return null;
    try {
      const enc = Buffer.from(await (await fetch(String(r.storage_key), { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
      const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(process.env.DOC_ENCRYPTION_KEY, "hex"), Buffer.from(String(r.enc_iv), "hex"));
      d.setAuthTag(Buffer.from(String(r.enc_tag), "hex"));
      const { PDFParse } = await import("pdf-parse");
      return (await new PDFParse({ data: Buffer.concat([d.update(enc), d.final()]) }).getText()).text;
    } catch {
      return null;
    }
  };

  const byFormat = new Map<string, { files: number; findings: Map<Finding, number[]> }>();
  const one = async (r: mysql.RowDataPacket) => {
    const stored = parse<CreditFile>(r.extracted_json);
    if (!stored?.accounts) return;
    const file = normalizeStoredRead(stored); // as the engine loads it
    const text = await freshText(r);
    const skeleton = text ? (parseCreditFile(text) as CreditFile) : parse<CreditFile & { pullSummary2?: Pv2PullSummary | null }>(r.text_skeleton_json);
    const summary = text ? pv2ParsePullSummary(text) : ((skeleton as { pullSummary2?: Pv2PullSummary | null } | null)?.pullSummary2 ?? null);
    // Reads from before Oct 28, 2026 (old reader: no version) are never reused and are gated as a base; shown apart.
    const format = `${summary?.format ?? String(r.provider || "unknown")}${r.extract_version ? "" : " (old reader)"}`;
    const g = byFormat.get(format) ?? { files: 0, findings: new Map() };
    byFormat.set(format, g);
    g.files++;
    for (const f of audit(file, summary, skeleton?.provider === "smartcredit" ? skeleton : null)) {
      g.findings.set(f, [...(g.findings.get(f) ?? []), Number(r.id)]);
    }
  };
  for (let i = 0; i < rows.length; i += fresh ? 8 : rows.length) await Promise.all(rows.slice(i, i + (fresh ? 8 : rows.length)).map(one));

  console.log(`\nCredit read audit · ${rows.length} distinct files\n`);
  for (const [format, g] of [...byFormat].sort((a, b) => b[1].files - a[1].files)) {
    console.log(`${format.padEnd(12)} ${String(g.files).padStart(4)} files`);
    for (const [f, ids] of [...g.findings].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`   ${f.padEnd(20)} ${String(ids.length).padStart(4)}  ${ids.slice(0, 8).join(", ")}${ids.length > 8 ? " …" : ""}`);
    }
  }
  if (gate) {
    const bad: string[] = [];
    for (const [format, g] of byFormat) {
      if (format.includes("(old reader)")) continue;
      for (const k of ["repair_broke", "repair_unfixed"] as const) for (const id of g.findings.get(k) ?? []) bad.push(`${k} ${id}`);
    }
    if (bad.length) {
      console.error(`\n❌ Repair gate: ${bad.length} problem(s) — a repair broke a matching total or changed a bureau it did not fix:\n   ${bad.slice(0, 20).join("\n   ")}`);
      process.exitCode = 1;
    } else console.log("\n✅ Repair gate: no repair broke a match or changed a bureau without fixing it.");
  }
  console.log(`\nCross-round: ${roundsChecked} published rounds compared (${gated} skipped: the gate blocks them); ${suspect.length} "removed" account(s) still in the After${suspect.length ? `: ${[...new Set(suspect)].slice(0, 12).join(", ")}` : ""}`);
  console.log(`
entries_short        fewer entries than the report's own account list (reader / split merge)
summary_shortfall    the platform would call the file incomplete
creditor_short       SmartCredit: a creditor has more accounts in the text than in the read (reconcile pass runs)
headers_short        SmartCredit: 2+ fewer entries than account headers in the text
bureau_totals        a bureau's printed account total not reached
balances / limits / inquiries               off as read, fixed by the printed rows (staff never see it)
*_after_repair                              still off after the repairs (the report is held for review)
repair_broke / repair_unfixed               a repair broke a matching total / changed a bureau it did not fix (gate fails)\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

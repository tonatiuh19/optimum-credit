/**
 * Plain-language reasons for a report the self-check held (Nov 7, 2026). The self-check details are
 * written for engineers ("After EX: revolving limits $22,800 vs summary $15,800"); staff need to know
 * whose problem it is and what to do. Half-loaded PDFs are stopped at upload, so a held report almost
 * always means the platform's reading of a good PDF did not add up to the PDF's own totals — not the
 * upload. Only a large shortfall of accounts points at the file itself.
 */

export type HeldBureau = "TU" | "EX" | "EQ";

export interface HeldReason {
  /** Self-check key (limits, balances, account_totals, inquiries, …). */
  key: string;
  kind: "limits" | "balances" | "accounts" | "open_accounts" | "inquiries" | "other";
  pull: "before" | "after" | null;
  bureau: HeldBureau | null;
  /** What the platform counted, and what the report itself prints. */
  platform: number | null;
  report: number | null;
  /** The original engineer-facing detail (kept for Cesar / Alex). */
  detail: string;
}

export interface HeldExplanation {
  /** platform = the PDF is fine, the reading did not add up; file = the PDF looks incomplete. */
  cause: "platform" | "file";
  reasons: HeldReason[];
}

const NUM = (s: string) => Number(s.replace(/[$,]/g, ""));

function parsePart(key: string, part: string): HeldReason {
  const base = { key, pull: null, bureau: null, platform: null, report: null, detail: part.trim() } as const;
  const head = /^(Before|After)\s+(TU|EX|EQ)\s*:\s*/i.exec(part.trim());
  const pull = head ? (head[1].toLowerCase() as "before" | "after") : null;
  const bureau = head ? (head[2].toUpperCase() as HeldBureau) : null;
  const rest = head ? part.trim().slice(head[0].length) : part.trim();
  let m: RegExpExecArray | null;
  if ((m = /revolving limits \$?([\d,]+)\s+vs summary \$?([\d,]+)/i.exec(rest))) return { ...base, kind: "limits", pull, bureau, platform: NUM(m[1]), report: NUM(m[2]) };
  if ((m = /balances \$?([\d,]+)\s+vs summary \$?([\d,]+)/i.exec(rest))) return { ...base, kind: "balances", pull, bureau, platform: NUM(m[1]), report: NUM(m[2]) };
  if ((m = /(\d+)\s+open accounts read,\s*summary\s+(\d+)/i.exec(rest))) return { ...base, kind: "open_accounts", pull, bureau, platform: NUM(m[1]), report: NUM(m[2]) };
  if ((m = /(\d+)\s+accounts read,\s*(?:summary|the report lists)\s+(\d+)/i.exec(rest))) return { ...base, kind: "accounts", pull, bureau, platform: NUM(m[1]), report: NUM(m[2]) };
  if ((m = /(\d+)\s+inquiries read,\s*summary\s+(\d+)/i.exec(rest))) return { ...base, kind: "inquiries", pull, bureau, platform: NUM(m[1]), report: NUM(m[2]) };
  return { ...base, kind: "other", pull, bureau };
}

/** Reasons from the failed checks (pass === false); "not printed" (null) and passed checks are ignored. */
export function explainHeldChecks(checks: Array<{ key: string; pass: boolean | null; detail?: string | null }>): HeldExplanation {
  const reasons = checks
    .filter((c) => c.pass === false && c.key !== "printed_repairs")
    .flatMap((c) => String(c.detail ?? "").split(/;\s*/).filter((p) => p.trim()).map((p) => parsePart(c.key, p)));
  // Files 10%+ short are stopped at upload, so a published report held on counts is almost always the
  // platform's reading (a client: 35 of 39 — complete PDF, look-alike accounts merged). Only a quarter or
  // more missing is a clearly half-loaded print that got through: then the PDF itself is the cause.
  const fileShort = reasons.some((r) => (r.kind === "accounts" || r.kind === "open_accounts") && r.platform != null && r.report != null && r.platform < r.report * 0.75);
  return { cause: fileShort ? "file" : "platform", reasons };
}

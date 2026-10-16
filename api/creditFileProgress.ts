/**
 * OFG Progress Report enhancement — Before vs After credit files (account
 * level). Feeds the appended "account detail" pages of the existing Progress
 * Report PDF (Michelle sample): summary tiles, REMOVED / PARTIAL per account
 * with balances, what is still reporting, what moved the score.
 *
 * Pure; inlined into api/index.ts by scripts/inline-credit-file-engine.mjs.
 */
import { BUREAUS, type Bureau, type CreditFile } from "./creditFile";
import {
  buildCreditAnalysis,
  type AnalysisNegative,
  type CreditAnalysisData,
} from "./creditAnalysisFromFile";

export interface ProgressRemovedItem {
  creditor: string;
  kind: AnalysisNegative["kind"];
  balance: number | null;
  /** Bureaus that no longer report it (of the ones that did before). */
  removedFrom: Bureau[];
  /** Bureaus still reporting it in the After file. */
  stillOn: Bureau[];
  status: "REMOVED" | "PARTIAL";
  impact: "HIGH" | "MEDIUM";
}

export interface ProgressFactor {
  code: "deleted" | "limits_up" | "util_down" | "util_up" | "new_inquiries" | "new_negative";
  effect: "positive" | "holding_back";
  /** Values for the localized sentence (counts, %, $, creditor). */
  values: Record<string, string | number>;
}

export interface ProgressEnhancement {
  beforeDate: string | null;
  afterDate: string | null;
  scoreModel: string | null;
  scores: Record<Bureau, { before: number | null; after: number | null }>;
  /** Accounts fully deleted from every bureau that reported them. */
  deletedCount: number;
  /** Negative account × bureau listings, before → after. */
  listings: { before: number; after: number };
  balanceRemoved: number;
  removed: ProgressRemovedItem[];
  stillReporting: AnalysisNegative[];
  newNegatives: AnalysisNegative[];
  utilization: { before: number | null; after: number | null };
  revolvingLimit: { before: number; after: number };
  newInquiries: number;
  factors: ProgressFactor[];
  after: CreditAnalysisData;
}

function key(creditor: string): string {
  return creditor.toLowerCase().replace(/\b(llc|inc|corp|co|na|bank)\b/g, "").replace(/[^a-z0-9]/g, "").slice(0, 24);
}

function sameAccount(a: string, b: string): boolean {
  const ka = key(a);
  const kb = key(b);
  if (!ka || !kb) return false;
  return ka === kb || (ka.length >= 5 && kb.length >= 5 && (ka.startsWith(kb) || kb.startsWith(ka)));
}

function listings(a: CreditAnalysisData): number {
  return a.negatives.reduce((s, n) => s + n.bureaus.length, 0);
}

/** Compare Before (enrollment / prior round) with After (this round). */
export function diffCreditFiles(
  beforeFile: CreditFile & { scoreModel?: string | null },
  afterFile: CreditFile & { scoreModel?: string | null },
): ProgressEnhancement {
  const before = buildCreditAnalysis(beforeFile);
  const after = buildCreditAnalysis(afterFile);

  // One-to-one matching: the same creditor can report several accounts (e.g.
  // two Midland collections); each After account matches at most one Before
  // account, closest balance first.
  const matchOf = new Map<AnalysisNegative, AnalysisNegative>();
  const used = new Set<AnalysisNegative>();
  const pairs: { b: AnalysisNegative; a: AnalysisNegative; gap: number }[] = [];
  for (const b of before.negatives) {
    for (const a of after.negatives) {
      if (sameAccount(a.creditor, b.creditor) && a.kind === b.kind) {
        pairs.push({ b, a, gap: Math.abs((a.balance ?? 0) - (b.balance ?? 0)) });
      }
    }
  }
  pairs.sort((x, y) => x.gap - y.gap);
  for (const { b, a } of pairs) {
    if (matchOf.has(b) || used.has(a)) continue;
    matchOf.set(b, a);
    used.add(a);
  }

  const removed: ProgressRemovedItem[] = [];
  for (const b of before.negatives) {
    const match = matchOf.get(b);
    const stillOn = match ? b.bureaus.filter((x) => match.bureaus.includes(x)) : [];
    const removedFrom = b.bureaus.filter((x) => !stillOn.includes(x));
    if (removedFrom.length === 0) continue;
    removed.push({
      creditor: b.creditor,
      kind: b.kind,
      balance: b.balance,
      removedFrom,
      stillOn,
      status: stillOn.length === 0 ? "REMOVED" : "PARTIAL",
      impact:
        b.kind === "collection" || b.kind === "charge_off" || b.kind === "repossession" || b.kind === "public_record"
          ? "HIGH"
          : "MEDIUM",
    });
  }
  const newNegatives = after.negatives.filter((a) => !used.has(a));
  const stillReporting = after.negatives.filter((a) => !newNegatives.includes(a));
  const fully = removed.filter((r) => r.status === "REMOVED");
  const balanceRemoved = fully.reduce((s, r) => s + Math.max(0, r.balance ?? 0), 0);

  const revLimit = (a: CreditAnalysisData) => Math.max(...BUREAUS.map((b) => a.overview[b].revolvingLimit));
  const factors: ProgressFactor[] = [];
  if (removed.length) {
    factors.push({
      code: "deleted",
      effect: "positive",
      values: { deleted: fully.length, partial: removed.length - fully.length },
    });
  }
  const limitGain = revLimit(after) - revLimit(before);
  if (limitGain > 0) {
    factors.push({ code: "limits_up", effect: "positive", values: { amount: Math.round(limitGain) } });
  }
  const utilB = before.utilizationOverall.all;
  const utilA = after.utilizationOverall.all;
  if (utilB !== null && utilA !== null && utilA < utilB - 5) {
    factors.push({ code: "util_down", effect: "positive", values: { from: utilB, to: utilA } });
  } else if (utilB !== null && utilA !== null && utilA > utilB + 5) {
    factors.push({ code: "util_up", effect: "holding_back", values: { from: utilB, to: utilA } });
  }
  const newInquiries = Math.max(0, afterFile.inquiries.length - beforeFile.inquiries.length);
  if (newInquiries > 0) {
    factors.push({ code: "new_inquiries", effect: "holding_back", values: { count: newInquiries } });
  }
  for (const n of newNegatives) {
    factors.push({
      code: "new_negative",
      effect: "holding_back",
      values: { creditor: n.creditor, kind: n.kind, bureaus: n.bureaus.join("/") },
    });
  }

  return {
    beforeDate: beforeFile.reportDate,
    afterDate: afterFile.reportDate,
    scoreModel: afterFile.scoreModel ?? beforeFile.scoreModel ?? null,
    scores: Object.fromEntries(
      BUREAUS.map((b) => [b, { before: beforeFile.scores[b], after: afterFile.scores[b] }]),
    ) as ProgressEnhancement["scores"],
    deletedCount: fully.length,
    listings: { before: listings(before), after: listings(after) },
    balanceRemoved,
    removed,
    stillReporting,
    newNegatives,
    utilization: { before: utilB, after: utilA },
    revolvingLimit: { before: revLimit(before), after: revLimit(after) },
    newInquiries,
    factors,
    after,
  };
}

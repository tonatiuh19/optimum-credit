/**
 * Client-facing rules for the progress report PDF (Cesar, Oct 26 2026 — found
 * on a Round 5 test file), checked on EVERY combination of the conditions that
 * broke them, in EN and ES (synthetic files only):
 *
 *  1  no "What Moved Your Score" section (new negatives → targets + internal notes)
 *  2  "new" only when dated after the baseline
 *  3  one round number in the whole report
 *  4  targets = negative ACCOUNTS; inquiries are one summary row
 *  5  missing bureau on the baseline: said plainly, no 2-bureau middle, no "every bureau up"
 *  6  same-name accounts are told apart
 *  7  one classification per account (verified / active dispute / new)
 *  8  "Your progress too" and "Round N Targets" always present
 *  9  no "under 30%" card advice without open revolving credit
 * 10  no repeated names; exactly 3 pages
 */
import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import type { Bureau, BureauTradeline, CreditAccount, CreditFile, CreditInquiry } from "./creditFile";
import { generateProgressReportV2Pdf, pv2BuildPdfData, pv2Contradictions, pv2Diff, type Pv2Lang, type Pv2RenderStats } from "./progressReportV2";

const B: Bureau[] = ["TU", "EX", "EQ"];
const tl = (o: Partial<BureauTradeline>): BureauTradeline => ({
  accountNumber: null, highBalance: null, lastVerified: null, dateLastActivity: null, dateReported: null,
  dateOpened: "01/2019", balance: 0, closedDate: null, accountRating: null, description: null, disputeStatus: null,
  creditorType: null, accountStatus: "Open", paymentStatus: "Current", remarks: null, paymentAmount: null,
  lastPayment: null, termLength: null, pastDue: 0, accountType: null, paymentFrequency: null, creditLimit: null,
  late30: 0, late60: 0, late90: 0, gridMarks: [],
  ...o,
});
const acct = (creditor: string, mask: string, section: CreditAccount["section"], bureaus: Bureau[], o: Partial<BureauTradeline>): CreditAccount => ({
  creditor, mask, section, headerStatus: null, confident: true, bureaus: Object.fromEntries(bureaus.map((b) => [b, tl(o)])),
});
const BASE = "06/15/2026";
const NOW = "10/26/2026";

type Combo = {
  missingBaselineBureau: boolean;
  openCards: boolean;
  sameNameCollections: 1 | 2 | 3;
  inquiries: 0 | 5 | 40;
  held: "none" | "verified" | "active_dispute";
  newAccountAfterBase: boolean;
};

function build(c: Combo): { before: CreditFile; after: CreditFile; scores: Record<Bureau, { before: number | null; after: number | null }> } {
  const beforeBureaus: Bureau[] = c.missingBaselineBureau ? ["EX", "EQ"] : B;
  const common = (bs: Bureau[]): CreditAccount[] => [
    acct("WESTLAKE SERVICE", "1001", "installment", bs, { dateOpened: "03/2019", balance: 9000, accountType: "Auto Loan" }),
    acct("ALLY FINANCIAL", "1002", "installment", bs, { dateOpened: "05/2020", balance: 0, accountStatus: "Closed", paymentStatus: "Paid" }),
    ...(c.openCards ? [acct("CAPITAL ONE", "1003", "revolving", bs, { dateOpened: "02/2021", balance: 900, creditLimit: 1000, accountType: "Credit Card" })] : []),
  ];
  // Same-name collections: the Before has them, the After removed them (wins with one name).
  const removedColl = Array.from({ length: c.sameNameCollections }, (_, i) =>
    acct("CREDIT COLLECTION SE", `20${i}${i}`, "collection", beforeBureaus.filter((b) => b !== "TU"), { dateOpened: "", balance: 99 + i * 10, paymentStatus: "Collection", accountType: "Collection" }),
  );
  // Same-name collections still reporting (targets with one name).
  const stillColl = (bs: Bureau[]) =>
    Array.from({ length: c.sameNameCollections }, (_, i) =>
      acct("CREDIT SERVICE CO", `30${i}${i}`, "collection", bs, { dateOpened: "", balance: 1200 + i * 100, paymentStatus: "Collection", accountType: "Collection" }),
    );
  const heldRemarks = c.held === "active_dispute" ? "CONSUMER DISPUTES - ACCOUNT INFORMATION DISPUTED BY CONSUMER" : c.held === "verified" ? "DISPUTE RESOLVED - CONSUMER DISAGREES" : null;
  const held = (bs: Bureau[]) => acct("ALLSTATE FIRE C", "4004", "collection", bs, { dateOpened: "", balance: 450, paymentStatus: "Collection", accountType: "Collection", remarks: heldRemarks });
  const newAcct = acct("REGIONAL FINANCE", "5005", "installment", ["EX", "TU"], {
    dateOpened: c.newAccountAfterBase ? "08/2026" : "11/2024",
    balance: 4278,
    paymentStatus: "Over 120 Days Past Due",
    late30: 1, late60: 1, late90: 1,
  });
  // Inquiries: half before the baseline (2025 — must never be "new"), half after it.
  const inq = (n: number, onlyAfter: boolean): CreditInquiry[] =>
    Array.from({ length: n }, (_, i) => {
      const old = i % 2 === 0;
      const date = old ? `10/${String((i % 27) + 1).padStart(2, "0")}/2025` : `09/${String((i % 27) + 1).padStart(2, "0")}/2026`;
      return { creditor: `LENDER ${i}`, bureau: B[i % 3], date, matchedAccount: null };
    }).filter((q) => !onlyAfter || q.date.endsWith("2026"));
  const before: CreditFile = {
    provider: "mfsn" as never, reportDate: BASE, scores: { TU: c.missingBaselineBureau ? null : 600, EX: 582, EQ: 609 },
    accounts: [...common(beforeBureaus), ...removedColl, ...stillColl(beforeBureaus), held(beforeBureaus.filter((b) => b !== "EX"))],
    // The Before read lacks the 2025 inquiries on the missing bureau (a client case) — they must not become "new".
    inquiries: inq(c.inquiries, false).filter((q) => !(c.missingBaselineBureau && q.bureau === "TU")),
    publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [],
  };
  const after: CreditFile = {
    provider: "mfsn" as never, reportDate: NOW, scores: { TU: 617, EX: 613, EQ: 644 },
    accounts: [...common(B), ...stillColl(B), held(["TU", "EQ"]), newAcct],
    inquiries: inq(c.inquiries, false),
    publicRecordsReported: false, imagePages: 0, totalPages: 0, confidence: 1, warnings: [],
  };
  const scores = Object.fromEntries(B.map((b) => [b, { before: before.scores[b], after: after.scores[b] }])) as Record<Bureau, { before: number | null; after: number | null }>;
  return { before, after, scores };
}

const combos: Combo[] = [];
for (const missingBaselineBureau of [false, true])
  for (const openCards of [false, true])
    for (const sameNameCollections of [1, 2, 3] as const)
      for (const inquiries of [0, 5, 40] as const)
        for (const held of ["none", "verified", "active_dispute"] as const)
          for (const newAccountAfterBase of [false, true]) combos.push({ missingBaselineBureau, openCards, sameNameCollections, inquiries, held, newAccountAfterBase });

const ROUND = 5;
const label = (c: Combo) =>
  `baseTU:${c.missingBaselineBureau ? "missing" : "ok"} cards:${c.openCards} coll:${c.sameNameCollections} inq:${c.inquiries} held:${c.held} new:${c.newAccountAfterBase}`;

describe.each(["en", "es"] as Pv2Lang[])("client PDF rules (%s) over every combination", (lang) => {
  it(`${combos.length} combinations`, async () => {
    for (const c of combos) {
      const name = label(c);
      const { before, after, scores } = build(c);
      const d = pv2Diff(before, after, lang);
      const pdf = pv2BuildPdfData({ diff: d, clientFirstName: "Juan", clientName: "Juan M.", round: ROUND, scores, phone: "(949) 674-0714", site: "ofgllc.com", lang, programRound: ROUND });
      const stats: Pv2RenderStats = { targetsRepresented: 0, winsRepresented: 0, pages: 0, croaText: "", clientText: [] };
      const buf = await generateProgressReportV2Pdf(pdf, null, stats);
      const text = (await new PDFParse({ data: buf }).getText()).text.replace(/\s+/g, " ");

      // 1 — no "What Moved" section in the client PDF.
      expect(text, name).not.toMatch(/What Moved Your Score|Lo que movio su puntaje/);
      // 2 — nothing dated on/before the baseline is "new".
      for (const t of d.targets.filter((x) => x.isNew)) expect(t.item, name).not.toMatch(/2025/);
      expect(d.newNegativeFacts.join(" "), name).not.toMatch(/2025/);
      if (!c.newAccountAfterBase) expect(d.newNegativeFacts.join(" "), name).not.toMatch(/REGIONAL FINANCE/);
      // 3 — exactly one round number anywhere in the client text.
      const rounds = new Set([...text.matchAll(/(?:Round|ROUND|Ronda|RONDA)S? (\d+)/g)].map((m) => m[1]));
      rounds.delete("1"); // "ROUNDS 1-4 COMPLETE" range start
      expect([...rounds], name).toEqual([String(ROUND)]);
      expect(text, name).not.toMatch(/\bR[1-4]\b/);
      // 4 — account targets listed; inquiries only as one summary row.
      for (const t of d.targets.filter((x) => x.kind !== "inquiry")) expect(text, name).toContain(t.item.split(" - ")[0].split(" (")[0]);
      if (d.targets.some((t) => t.kind === "inquiry")) expect(text, name).toMatch(/Hard inquiries: \d+|Consultas de credito: \d+/);
      expect(text, name).not.toMatch(/Hard inquiry \d|Consulta de credito \d/);
      // 5 — missing baseline bureau: said plainly; no 2-bureau middle; no "every bureau up".
      if (c.missingBaselineBureau) {
        expect(text, name).toMatch(/no score on the baseline report|sin puntaje en el reporte base/);
        expect(text, name).not.toMatch(/Every bureau moved up|Todos los buros subieron/);
        expect(text, name).toMatch(/(Middle Score|Puntaje medio) -- 617/);
      }
      // 6 — same-name rows are told apart (wins and targets).
      for (const rows of [d.wins.map((w) => w.item), d.targets.map((t) => t.item)]) expect(new Set(rows).size, name).toBe(rows.length);
      // 7 — one classification per account.
      expect(pv2Contradictions(d), name).toEqual([]);
      const informational = d.informational.map((i) => i.item.split(" - ")[0]);
      for (const n of informational) {
        expect(d.targets.some((t) => t.item.startsWith(n)), `${name}: ${n} informational + target`).toBe(false);
        expect(d.newNegativeFacts.some((f) => f.includes(n)), `${name}: ${n} informational + new`).toBe(false);
      }
      if (c.held === "active_dispute") {
        expect(informational.join(" "), name).not.toContain("ALLSTATE");
        expect(d.targets.find((t) => t.item.startsWith("ALLSTATE"))!.detail, name).toMatch(/dispute in progress|disputa en curso/);
      }
      // 8 — standing sections.
      expect(text, name).toMatch(/Your progress too|Su progreso tambien/);
      expect(text, name).toMatch(new RegExp(`Round ${ROUND} Targets|objetivos de la Ronda ${ROUND}`));
      // 9 — no card advice without open revolving credit.
      if (!c.openCards) expect([...pdf.plan, ...pdf.actionNeeded].join(" ") + text, name).not.toMatch(/under 30%|bajo 30%|< 30%/);
      // 10 — no repeated names in the File Strength note; 3 pages; every target represented.
      const growth = (pdf.fileStrengthNote.split(/is in |esta en /)[1] ?? "").replace(/\.$/, "").split(", ");
      expect(new Set(growth).size, name).toBe(growth.length);
      expect(stats.pages, name).toBe(3);
      expect(stats.targetsRepresented, name).toBe(d.targets.length);
    }
  }, 600_000);
});

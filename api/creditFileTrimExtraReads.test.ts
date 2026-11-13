/**
 * Nov 12, 2026 audit — the AI read more accounts than the report lists (a loan read twice at a
 * page break, a partial row with no status). The text reader, on the same PDF, matched the report's
 * own total. Extras are trimmed only when that lands exactly on the printed total. No client data.
 */
import { describe, expect, it } from "vitest";
import type { Bureau, BureauTradeline, CreditAccount } from "./creditFile";
import { trimExtraReads } from "./creditFileExtract";

const tl = (o: Partial<BureauTradeline> = {}): BureauTradeline =>
  ({ dateOpened: "10/22/2025", balance: 0, creditLimit: null, highBalance: null, accountStatus: "Open", paymentStatus: "Current", pastDue: 0, late30: 0, late60: 0, late90: 0, gridMarks: [], ...o }) as BureauTradeline;
const ai = (creditor: string, mask: string | null, t: Partial<BureauTradeline> = {}, bureaus: Bureau[] = ["TU"]): CreditAccount =>
  ({ creditor, mask, section: "installment", headerStatus: null, confident: true, bureaus: Object.fromEntries(bureaus.map((b) => [b, tl(t)])) }) as CreditAccount;
const sk = (creditor: string, mask: string | null, bureaus: Bureau[] = ["TU"]): CreditAccount =>
  ({ creditor, mask, section: "installment", headerStatus: null, confident: true, bureaus: Object.fromEntries(bureaus.map((b) => [b, tl({ balance: null, dateOpened: null })])) }) as CreditAccount;
const summary = (tu: number, balances?: number) => ({ perBureau: { TU: { totalAccounts: tu, balances: balances ?? null } } });
const tuCount = (list: CreditAccount[]) => list.filter((a) => a.bureaus.TU).length;

describe("trimExtraReads", () => {
  it("drops a loan read twice and a partial row, landing on the printed total and balance (the audit case)", () => {
    const accounts = [
      ai("AFFIRM INC", "SYA5", { balance: 355 }),
      ai("AFFIRM INC", "5YA5", { balance: 355 }), // same loan, misread number
      ai("AVANT LLC/WEB BANK", "1", { balance: 0 }),
      ai("AVANT LLC/WEB BANK", "1", { balance: 492, accountStatus: null, paymentStatus: null }), // partial row
      ai("ONEMAIN", "2543", { balance: 9733 }),
    ];
    const skeleton = [sk("AFFIRM INC", "S5SYA5**"), sk("AVANT LLC/WEB BANK", "1****"), sk("ONEMAIN", "102543****")];
    const r = trimExtraReads(accounts, skeleton, summary(3, 355 + 9733));
    expect(tuCount(r.accounts)).toBe(3);
    expect(r.trimmed.map((x) => `${x.creditor} ${x.balance}`).sort()).toEqual(["AFFIRM INC 355", "AVANT LLC/WEB BANK 492"]);
    expect(r.trimmed.find((x) => x.balance === 492)?.fragment).toBe(true);
    expect(r.suspects).toEqual([]);
  });

  it("pairs unreadable text-reader headers with creditors the text reader never named", () => {
    const accounts = [ai("CREDIT ONE BANK NA", "4796", { balance: 8 }), ai("KAFENE INC", "V"), ai("US BANK", "3784"), ai("US BANK", "3784")];
    const skeleton = [sk("(unreadable — header on page 4)", null), sk("(unreadable — header on page 5)", null), sk("US BANK", "403784****")];
    const r = trimExtraReads(accounts, skeleton, summary(3));
    expect(tuCount(r.accounts)).toBe(3);
    expect(r.trimmed.map((x) => x.creditor)).toEqual(["US BANK"]);
    expect(r.accounts.some((a) => a.creditor === "KAFENE INC")).toBe(true);
  });

  it("tolerates one misread digit in the AI's account number (pass 2: creditor only)", () => {
    const accounts = [ai("CAPITAL ONE", "5805"), ai("CAPITAL ONE", "7805"), ai("CAPITAL ONE", "7805"), ai("BANK X", "11"), ai("BANK X", "11", { accountStatus: null, paymentStatus: null })];
    const skeleton = [sk("CAPITAL ONE", "517805****"), sk("CAPITAL ONE", "517805****"), sk("CAPITAL ONE", "517805****"), sk("BANK X", "11")];
    const r = trimExtraReads(accounts, skeleton, summary(4));
    expect(r.accounts.filter((a) => a.creditor === "CAPITAL ONE")).toHaveLength(3);
    expect(r.trimmed).toHaveLength(1);
    expect(r.trimmed[0]).toMatchObject({ creditor: "BANK X", fragment: true });
  });

  it("removes only the one bureau from a multi-bureau account, keeping the others", () => {
    const multi = ai("CARD CO", "12", {}, ["TU", "EQ"]);
    const r = trimExtraReads([ai("CARD CO", "12"), multi], [sk("CARD CO", "12")], summary(1));
    expect(r.accounts).toHaveLength(2);
    expect(r.accounts.filter((a) => a.bureaus.TU)).toHaveLength(1);
    expect(r.accounts.filter((a) => a.bureaus.EQ)).toHaveLength(1);
  });

  describe("never removes anything when the evidence is not clean", () => {
    const accounts = () => [ai("LOAN CO", "1", { balance: 100 }), ai("LOAN CO", "1", { balance: 100 }), ai("OTHER", "9")];
    it("the text reader does not match the printed total", () => {
      const r = trimExtraReads(accounts(), [sk("LOAN CO", "1")], summary(2));
      expect(r.accounts).toHaveLength(3);
      expect(r.trimmed).toEqual([]);
    });
    it("the AI is not over the printed total", () => {
      const r = trimExtraReads(accounts(), [sk("LOAN CO", "1"), sk("LOAN CO", "1"), sk("OTHER", "9")], summary(3));
      expect(r.trimmed).toEqual([]);
    });
    it("no printed total for the bureau", () => {
      const r = trimExtraReads(accounts(), [sk("LOAN CO", "1"), sk("OTHER", "9")], { perBureau: { TU: null } });
      expect(r.trimmed).toEqual([]);
    });
    it("a text-reader row has no AI counterpart (the AI also missed something): suspects only", () => {
      const r = trimExtraReads(accounts(), [sk("LOAN CO", "1"), sk("MISSING BANK", "77")], summary(2));
      expect(r.accounts).toHaveLength(3);
      expect(r.trimmed).toEqual([]);
      expect(r.suspects.length).toBeGreaterThan(0);
    });
    it("removing the extras would move the balance further from the printed balance: suspects only", () => {
      // Printed balance counts both $100 rows, so they are two real accounts the text reader merged.
      const r = trimExtraReads(accounts(), [sk("LOAN CO", "1"), sk("OTHER", "9")], summary(2, 200));
      expect(r.trimmed).toEqual([]);
      expect(r.suspects).toHaveLength(1);
    });
    it("extras that would overshoot below the total are not removed", () => {
      const r = trimExtraReads([ai("A", "1"), ai("A", "1"), ai("A", "1")], [sk("A", "1"), sk("B", "2")], summary(2));
      expect(r.trimmed).toEqual([]);
    });
  });

  it("does not mutate its input", () => {
    const accounts = [ai("LOAN CO", "1"), ai("LOAN CO", "1")];
    const before = JSON.stringify(accounts);
    trimExtraReads(accounts, [sk("LOAN CO", "1")], summary(1));
    expect(JSON.stringify(accounts)).toBe(before);
  });
});

describe("applyReadExclusions (staff marked a row 'not a real account')", () => {
  const twin = () => [ai("LOAN CO", "1", { balance: 355 }), ai("LOAN CO", "1", { balance: 355 }), ai("OTHER", "9", { balance: 10 }, ["TU", "EQ"])];
  const ex = (o: Partial<import("./creditFileExtract").ReadExclusion> = {}) => ({ bureau: "TU" as const, creditor: "LOAN CO", mask: "1", balance: 355, dateOpened: "10/22/2025", ...o });

  it("removes exactly one matching row, keeping its real twin", async () => {
    const { applyReadExclusions } = await import("./creditFileExtract");
    const out = applyReadExclusions(twin(), [ex()]);
    expect(out.filter((a) => a.creditor === "LOAN CO")).toHaveLength(1);
    expect(out).toHaveLength(2);
  });
  it("removes only the marked bureau of a multi-bureau account", async () => {
    const { applyReadExclusions } = await import("./creditFileExtract");
    const out = applyReadExclusions(twin(), [ex({ creditor: "OTHER", mask: "9", balance: 10 })]);
    const other = out.find((a) => a.creditor === "OTHER")!;
    expect(other.bureaus.TU).toBeUndefined();
    expect(other.bureaus.EQ).toBeTruthy();
  });
  it("ignores an exclusion that no longer matches (different balance, number or date) and never mutates", async () => {
    const { applyReadExclusions } = await import("./creditFileExtract");
    const input = twin();
    const before = JSON.stringify(input);
    for (const miss of [ex({ balance: 356 }), ex({ mask: "2" }), ex({ dateOpened: "01/01/2020" }), ex({ bureau: "EQ" })]) {
      expect(applyReadExclusions(input, [miss])).toHaveLength(3);
    }
    expect(JSON.stringify(input)).toBe(before);
  });
  it("two exclusions remove both copies", async () => {
    const { applyReadExclusions } = await import("./creditFileExtract");
    expect(applyReadExclusions(twin(), [ex(), ex()]).filter((a) => a.creditor === "LOAN CO")).toHaveLength(0);
  });

  it("matches a row whose number the merge step lengthened (fragments agree), and counts copies", async () => {
    const { applyReadExclusions, readExclusionMatches } = await import("./creditFileExtract");
    const rows = [ai("LOAN CO", "1234", { balance: 355 }), ai("LOAN CO", "34", { balance: 355 })];
    expect(readExclusionMatches(rows, ex({ mask: "34" }))).toBe(2);
    expect(readExclusionMatches(rows, ex({ mask: "99" }))).toBe(0);
    // Exact number first: the "34" row goes, the "1234" row stays.
    expect(applyReadExclusions(rows, [ex({ mask: "34" })]).map((a) => a.mask)).toEqual(["1234"]);
  });
});

/**
 * Read reuse (Nov 6, 2026 — Jeser): re-uploading the same PDF copied a stored read that was short
 * of the report's own account list, so the file could never pass. A short read is read again.
 */
import { describe, expect, it } from "vitest";
import type { Pv2PullSummary } from "./progressReportV2";
import { storedReadIsShort } from "./index";

const read = (accounts: number, readEntries?: number) => ({
  accounts: Array.from({ length: accounts }, (_, i) => ({ creditor: `L${i}`, mask: String(i), section: "other", bureaus: { TU: { balance: 0 } } })),
  ...(readEntries != null ? { readEntries } : {}),
});
const summary = (o: Partial<Pv2PullSummary>): Pv2PullSummary => ({ perBureau: { TU: null, EX: null, EQ: null }, revolving: { TU: null, EX: null, EQ: null }, ...o }) as Pv2PullSummary;

describe("storedReadIsShort", () => {
  it.each([
    ["Jeser Before: 35 entries, table of contents lists 39", read(35, 35), summary({ accountsPrinted: 39 }), true],
    ["one entry short is enough to read again", read(38, 38), summary({ accountsPrinted: 39 }), true],
    ["complete MyFreeScoreNow read (per-bureau copies merged)", read(30, 39), summary({ accountsPrinted: 39 }), false],
    ["stale entry count below the accounts read", read(38, 34), summary({ accountsPrinted: 38 }), false],
    ["tri-merge total", read(20), summary({ merged: { totalAccounts: 22, openAccounts: null, publicRecords: null, collections: null } }), true],
    ["no printed count (SmartCredit): only a large shortfall counts", read(20), summary({}), false],
    ["no summary", read(5), null, false],
  ] as const)("%s", (_n, r, s, want) => {
    expect(storedReadIsShort(r, s as Pv2PullSummary | null)).toBe(want);
  });

  it("an unreadable stored read is never reused", () => {
    expect(storedReadIsShort("{not json", summary({ accountsPrinted: 3 }))).toBe(true);
    expect(storedReadIsShort({ accounts: null }, summary({ accountsPrinted: 3 }))).toBe(true);
  });

  it("works on the JSON string as stored", () => {
    expect(storedReadIsShort(JSON.stringify(read(35, 35)), summary({ accountsPrinted: 39 }))).toBe(true);
  });
});

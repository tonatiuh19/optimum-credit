/**
 * Review gate units: audit findings must show a real difference, two audit
 * runs must agree on blocking findings, missing accounts merge without
 * duplicates, and the auditor gets a compact, PII-free summary.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { CreditFile } from "./creditFile";
import { analysisSummaryForAudit, buildCreditAnalysis, mergeMissingAccounts } from "./creditAnalysisFromFile";
import {
  CREDIT_AUDIT_POLICIES,
  buildCreditFileAuditParams,
  buildCreditFileReconcileParams,
  consensusAuditFindings,
  parseAccountItems,
  parseAuditFindings,
} from "./creditFileExtract";

const file: CreditFile = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "credit-files", "factual-data-trimerge-active-loan.json"), "utf8"),
);

describe("parseAuditFindings", () => {
  it("drops confirmations and findings where analysis == report", () => {
    const out = parseAuditFindings({
      findings: [
        { check: "Middle score", severity: "blocking", analysis_says: "585", report_shows: "585", detail: "Middle is 585." },
        { check: "Name", severity: "blocking", analysis_says: "x", report_shows: "y", detail: "No error here; recorded for completeness only." },
        { check: "Count", severity: "note", analysis_says: "20", report_shows: "20 (?)", detail: "No count error detected; disregard." },
        { check: "Score TU", severity: "blocking", analysis_says: "TU 587", report_shows: "TU 578", detail: "TransUnion score is 578 on the report." },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "blocking", analysisSays: "TU 587", reportShows: "TU 578" });
  });

  it("masks anything that looks like an SSN", () => {
    const [f] = parseAuditFindings({ findings: [{ check: "x", severity: "note", analysis_says: "a", report_shows: "b", detail: "SSN 123-45-6789 differs" }] });
    expect(f.detail).not.toMatch(/123-45-6789/);
  });
});

describe("consensusAuditFindings (two runs)", () => {
  const capOne = { check: "Round", severity: "blocking" as const, detail: "CAPITAL ONE ...9607 is listed as positive" };
  it("keeps a blocking finding both runs report about the same account", () => {
    const out = consensusAuditFindings([capOne], [{ check: "Rounds", severity: "blocking", detail: "9607 appears in positives" }]);
    expect(out[0].severity).toBe("blocking");
  });
  it("downgrades a one-off blocking finding to an unconfirmed note", () => {
    const out = consensusAuditFindings([capOne], [{ check: "Name", severity: "blocking", detail: "GM FINANCIAL joint flag" }]);
    expect(out[0].severity).toBe("note");
    expect(out[0].detail).toMatch(/^\(unconfirmed\)/);
  });
});

describe("missing-account pass", () => {
  it("parses returned accounts and merges only new ones", () => {
    const found = parseAccountItems(
      [
        // already present (same creditor + last 4 + section + open date)
        { creditor: file.accounts[0].creditor, original_creditor: "", account_mask: file.accounts[0].mask, repository: "TU,EQ,XP", ecoa: "", section: file.accounts[0].section, tradelines: [{ bureau: "transunion", date_opened: file.accounts[0].bureaus.TU!.dateOpened, date_last_activity: "", date_reported: "", closed_date: "", balance: "1", credit_limit: "1", past_due: "", account_type: "", account_status: "", payment_status: "", remarks: "", dispute_status: "", late_30: "", late_60: "", late_90: "", payment_grid_lates: [] }] },
        // genuinely missing (Equifax-only medical card)
        { creditor: "MEDICAL CARD", original_creditor: "", account_mask: "xxxx5094", repository: "EQ", ecoa: "", section: "revolving", tradelines: [{ bureau: "transunion", date_opened: "2020-01-01", date_last_activity: "", date_reported: "", closed_date: "2021-01-01", balance: "0", credit_limit: "300", past_due: "0", account_type: "Revolving", account_status: "Closed", payment_status: "AsAgreed", remarks: "", dispute_status: "", late_30: "0", late_60: "0", late_90: "0", payment_grid_lates: [] }] },
      ],
      true,
    );
    expect(found[1].bureaus).toEqual({ EQ: expect.any(Object) }); // bureaus from Repository only
    expect(found[1].mask).toBe("5094");
    const merged = mergeMissingAccounts(file, found);
    expect(merged.added).toBe(1);
    const a = buildCreditAnalysis(merged.file);
    expect(a.selfCheck!.items.find((i) => i.key === "accounts")).toMatchObject({ expected: "29", actual: "29", ok: true });
    expect(a.selfCheck!.ok).toBe(true);
  });

  it("reconcile request lists what was found and asks only for the missing ones", () => {
    const p: any = buildCreditFileReconcileParams({
      fileBase64: "AA==",
      mediaType: "application/pdf",
      model: "m",
      reportFormat: "merged",
      expected: "29 accounts, 12 revolving",
      have: file.accounts.map((x) => ({ creditor: x.creditor, mask: x.mask, section: x.section })),
    });
    const text = p.messages[0].content[1].text as string;
    expect(text).toMatch(/29 accounts, 12 revolving/);
    expect(text).toMatch(/found only these 28 accounts/);
    expect(text).toMatch(/never invent/);
  });
});

describe("auditor input", () => {
  const a = buildCreditAnalysis(file);
  it("summary names rounds, exclusions and positives with last 4 + open date, never SSN/DOB", () => {
    const s = analysisSummaryForAudit(a);
    expect(s).toMatch(/Name: JANE QUINN SAMPLE/);
    expect(s).toMatch(/ROCKET MORTG .* EXCLUDED - permissible purpose: active transaction/);
    expect(s).toMatch(/Round 4:\n- GM FINANCIAL \.\.\.9001 opened 2019-05-25/);
    expect(s).toMatch(/Positive accounts \(never targets\): .*\.\.\.\d{4} opened/);
    expect(s).not.toMatch(/\d{3}-\d{2}-\d{4}/);
  });
  it("audit prompt carries the fixed policies (not up for debate)", () => {
    const p: any = buildCreditFileAuditParams({ fileBase64: "AA==", mediaType: "application/pdf", model: "m", analysisSummary: "x" });
    const text = p.messages[0].content[1].text as string;
    for (const policy of CREDIT_AUDIT_POLICIES) expect(text).toContain(policy);
    expect(text).toMatch(/NEVER include checks that passed/);
  });
});

describe("auditor summary states every exclusion reason (no false 'dispute target')", () => {
  it("an inquiry excluded because it matches an opened account is never described as a Round 1 target", () => {
    const a = buildCreditAnalysis(file);
    const s = analysisSummaryForAudit(a);
    const carvana = s.split("\n").find((l) => /CARVANA/i.test(l))!;
    expect(carvana).toMatch(/EXCLUDED - permissible purpose: matches BRIDGECREST/);
    expect(carvana).not.toMatch(/Round 1 dispute target/);
    // Every non-dispute inquiry line says EXCLUDED or ages off.
    for (const q of a.inquiries.filter((x) => x.action !== "dispute")) {
      const line = s.split("\n").find((l) => l.includes(q.creditor) && l.includes(q.date))!;
      expect(line).not.toMatch(/Round 1 dispute target/);
    }
  });
});

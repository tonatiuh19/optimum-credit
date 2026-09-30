import { describe, expect, it } from "vitest";
import {
  ProgressReportAlerts,
  buildDeterministicProgressAlerts,
  detectClosedStillReporting,
  detectHardInquiriesStillOpen,
  detectPersonalInfoMismatches,
  normalizeCompareText,
  type ClientProfileForAlerts,
  type NegativeAccountLike,
} from "./progressReportAlerts";

const baseProfile: ClientProfileForAlerts = {
  first_name: "Maria",
  last_name: "Garcia",
  phone: "(305) 555-1212",
  address_line1: "123 Main Street",
  city: "Miami",
  state: "FL",
  zip: "33101",
};

describe("normalizeCompareText", () => {
  it("lowercases, folds diacritics, and strips punctuation/spaces", () => {
    expect(normalizeCompareText("José García!")).toBe("josegarcia");
    expect(normalizeCompareText("123 Main St.")).toBe("123mainst");
    expect(normalizeCompareText("  A-B_C  ")).toBe("abc");
  });

  it("handles empty input", () => {
    expect(normalizeCompareText("")).toBe("");
  });
});

describe("detectPersonalInfoMismatches", () => {
  it("alerts when PDF has an alternate phone that does not match profile", () => {
    const text = `
      Consumer: Maria Garcia
      Phone: (786) 555-9999
      Address: 123 Main Street
      Miami, FL 33101
    `;
    const alerts = detectPersonalInfoMismatches(baseProfile, text);
    expect(alerts.some((a) => a.meta?.field === "phone")).toBe(true);
    expect(
      alerts.find((a) => a.meta?.field === "phone")?.type,
    ).toBe("personal_info_mismatch");
  });

  it("does not alert on phone when PDF only lists the profile phone", () => {
    const text = `
      Maria Garcia
      Tel: 305-555-1212
      123 Main Street
      Miami, FL 33101
    `;
    const alerts = detectPersonalInfoMismatches(baseProfile, text);
    expect(alerts.filter((a) => a.meta?.field === "phone")).toHaveLength(0);
  });

  it("alerts when PDF street address conflicts with profile", () => {
    const text = `
      Maria Garcia
      Phone: 305-555-1212
      Current Address: 999 Ocean Drive
      Miami, FL 33101
    `;
    const alerts = detectPersonalInfoMismatches(baseProfile, text);
    expect(alerts.some((a) => a.meta?.field === "address_line1")).toBe(true);
  });

  it("alerts when city/state/ZIP on PDF does not match profile", () => {
    const text = `
      Maria Garcia
      123 Main Street
      Orlando, FL 32801
    `;
    const alerts = detectPersonalInfoMismatches(baseProfile, text);
    expect(alerts.some((a) => a.meta?.field === "city_state_zip")).toBe(true);
  });

  it("alerts when profile name length > 3 and name is absent from PDF", () => {
    const text = `
      Consumer file for UNKNOWN SUBJECT
      Phone: 305-555-1212
      123 Main Street
      Miami, FL 33101
    `;
    const alerts = detectPersonalInfoMismatches(baseProfile, text);
    expect(alerts.some((a) => a.meta?.field === "name")).toBe(true);
  });

  it("does not alert on name when first and last appear in PDF", () => {
    const text = `
      GARCIA, MARIA
      Phone: 305-555-1212
      123 Main Street
      Miami, FL 33101
    `;
    const alerts = detectPersonalInfoMismatches(baseProfile, text);
    expect(alerts.filter((a) => a.meta?.field === "name")).toHaveLength(0);
  });

  it("skips name check when combined name length is <= 3", () => {
    const alerts = detectPersonalInfoMismatches(
      { first_name: "A", last_name: "B" },
      "No name here at all",
    );
    expect(alerts.filter((a) => a.meta?.field === "name")).toHaveLength(0);
  });
});

describe("detectClosedStillReporting", () => {
  it("flags closed / paid closed / paid was collection / settled accounts", () => {
    const accounts: NegativeAccountLike[] = [
      {
        key: "capone|closed",
        label: "Capital One — Closed",
        type: "Collection",
      },
      {
        key: "midland|paidclosed",
        label: "Midland — Paid Closed",
        type: "Collection",
      },
      {
        key: "abc|paidwascollection",
        label: "ABC Coll — Paid Was Collection",
        type: "Collection",
      },
      {
        key: "xyz|settled",
        label: "XYZ Finance — Settled",
        type: "Charge-Off",
      },
      {
        key: "open|collection",
        label: "Open Collections Inc — Collection",
        type: "Collection",
      },
    ];
    const alerts = detectClosedStillReporting(accounts);
    expect(alerts).toHaveLength(4);
    expect(alerts.every((a) => a.type === "closed_still_reporting")).toBe(true);
    expect(alerts.every((a) => a.severity === "warning")).toBe(true);
  });

  it("returns empty for accounts without closed keywords", () => {
    expect(
      detectClosedStillReporting([
        {
          key: "late|late",
          label: "Chase — Late Payment",
          type: "Late Payment",
        },
      ]),
    ).toHaveLength(0);
  });
});

describe("detectHardInquiriesStillOpen", () => {
  const inquiries: NegativeAccountLike[] = [
    {
      key: "autoloan|hardinquiry",
      label: "Auto Finance Co — Hard Inquiry",
      type: "Hard Inquiry",
    },
    {
      key: "bankofamerica|hardinquiry",
      label: "Bank of America — Hard Inquiry",
      type: "Hard Inquiry",
    },
  ];

  it("warns for each remaining inquiry when no prior win claimed removal", () => {
    const alerts = detectHardInquiriesStillOpen(inquiries);
    expect(alerts).toHaveLength(2);
    expect(alerts.every((a) => a.type === "hard_inquiry_open")).toBe(true);
    expect(alerts.every((a) => a.severity === "warning")).toBe(true);
  });

  it("marks critical when priorWins claimed removal of same creditor", () => {
    const alerts = detectHardInquiriesStillOpen(inquiries, undefined, [
      { label: "Auto Finance Co" },
    ]);
    const auto = alerts.find((a) =>
      String(a.detail).includes("Auto Finance Co"),
    );
    const boa = alerts.find((a) =>
      String(a.detail).includes("Bank of America"),
    );
    expect(auto?.severity).toBe("critical");
    expect(auto?.meta?.claimed_removed).toBe(true);
    expect(boa?.severity).toBe("warning");
  });

  it("ignores non-inquiry accounts", () => {
    const alerts = detectHardInquiriesStillOpen([
      {
        key: "midland|collection",
        label: "Midland — Collection",
        type: "Collection",
      },
    ]);
    expect(alerts).toHaveLength(0);
  });
});

describe("buildDeterministicProgressAlerts", () => {
  it("combines detectors and dedupes by type+detail", () => {
    const afterAccounts: NegativeAccountLike[] = [
      {
        key: "midland|closed",
        label: "Midland — Closed",
        type: "Collection",
      },
      {
        key: "lender|hardinquiry",
        label: "LenderX — Hard Inquiry",
        type: "Hard Inquiry",
      },
    ];
    const pdf = `
      Someone Else
      Phone: (212) 555-0000
      50 Broadway Ave
      New York, NY 10004
      Midland — Closed
      LenderX Hard Inquiry
    `;
    const alerts = buildDeterministicProgressAlerts({
      profile: baseProfile,
      afterPdfText: pdf,
      afterAccounts,
      priorWins: [{ label: "LenderX" }],
    });

    expect(alerts.some((a) => a.type === "personal_info_mismatch")).toBe(true);
    expect(alerts.some((a) => a.type === "closed_still_reporting")).toBe(true);
    expect(
      alerts.some(
        (a) => a.type === "hard_inquiry_open" && a.severity === "critical",
      ),
    ).toBe(true);

    const keys = alerts.map((a) => `${a.type}|${a.detail}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("exposes the same functions via ProgressReportAlerts re-export namespace", () => {
    expect(ProgressReportAlerts.normalizeCompareText("Hi!")).toBe("hi");
    expect(typeof ProgressReportAlerts.buildDeterministicProgressAlerts).toBe(
      "function",
    );
  });

  it("maps OfGReportData item/itemRemoved fields (not .label) into detectors", () => {
    const targets = [
      { item: "Midland Funding — Closed", bureaus: ["TU"] as string[] },
      { item: "Capital One Hard Inquiry", bureaus: ["EX"] as string[] },
    ];
    const wins = [{ itemRemoved: "Capital One Hard Inquiry" }];
    const afterAccounts = targets.map((t, i) => {
      const itemLabel = String(t.item || "");
      return {
        key: `target-${i}-${itemLabel.slice(0, 40)}`,
        label: itemLabel,
        type: /inquir/i.test(itemLabel)
          ? "inquiry"
          : /closed|paid|charge.?off|collection/i.test(itemLabel)
            ? "collection"
            : "other",
        bureaus: t.bureaus,
      };
    });
    const alerts = buildDeterministicProgressAlerts({
      profile: baseProfile,
      afterPdfText:
        "Maria Gomez\nPhone: (949) 555-1212\n100 Main St\nIrvine, CA 92614",
      afterAccounts,
      priorWins: wins.map((w) => ({ label: w.itemRemoved })),
    });
    expect(alerts.some((a) => a.type === "closed_still_reporting")).toBe(true);
    expect(alerts.some((a) => a.type === "hard_inquiry_open")).toBe(true);
  });

  it("flags utilization increase of ≥10pp", () => {
    const alerts = buildDeterministicProgressAlerts({
      profile: baseProfile,
      afterPdfText: "ok",
      afterAccounts: [],
      utilizationBeforePct: 20,
      utilizationAfterPct: 35,
      utilizationIncreaseThresholdPp: 10,
    });
    expect(alerts.some((a) => a.type === "utilization_increase")).toBe(true);
  });
});

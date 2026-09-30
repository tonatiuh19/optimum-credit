/**
 * Pure progress-report alert helpers (no DB, no Express).
 *
 * Production entry remains `api/index.ts` (no runtime imports from sibling
 * api modules yet). Tests import from this file. When safe to wire, re-export
 * from index with:
 *   export { ... } from "./progressReportAlerts.js";
 * or copy the functions inline.
 */

export type ProgressReportAlertType =
  | "personal_info_mismatch"
  | "closed_still_reporting"
  | "hard_inquiry_open"
  | "utilization_increase";

export interface ProgressReportAlert {
  type: ProgressReportAlertType;
  severity: "warning" | "critical";
  title: string;
  detail: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface ClientProfileForAlerts {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface NegativeAccountLike {
  key: string;
  label: string;
  type: string;
  bureaus?: string[];
}

/** Lowercase, fold diacritics, and strip punctuation/spaces for fuzzy compare. */
export function normalizeCompareText(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function digitsOnly(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

/** Normalize to 10-digit US phone when possible. */
function normalizePhoneDigits(s: string): string {
  let d = digitsOnly(s);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

function extractPhonesFromText(text: string): string[] {
  const found = new Set<string>();
  const re =
    /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = normalizePhoneDigits(m[0]);
    if (n.length === 10) found.add(n);
  }
  return [...found];
}

const STREET_ADDRESS_RE =
  /\b(\d{1,6}\s+[A-Za-z0-9.'\-\s]{2,40}(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|pl|place|cir|circle|pkwy|parkway)\.?)\b/gi;

const CITY_STATE_ZIP_RE =
  /\b([A-Za-z][A-Za-z\s.'-]{1,40}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/g;

function extractStreetAddresses(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(STREET_ADDRESS_RE.source, STREET_ADDRESS_RE.flags);
  while ((m = re.exec(text)) !== null) {
    const normalized = normalizeCompareText(m[1]);
    if (normalized.length >= 8) found.add(m[1].trim().replace(/\s+/g, " "));
  }
  return [...found];
}

function extractCityStateZips(
  text: string,
): Array<{ city: string; state: string; zip: string }> {
  const out: Array<{ city: string; state: string; zip: string }> = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(CITY_STATE_ZIP_RE.source, CITY_STATE_ZIP_RE.flags);
  while ((m = re.exec(text)) !== null) {
    const city = m[1].trim().replace(/\s+/g, " ");
    const state = m[2].toUpperCase();
    const zip = m[3];
    const key = `${normalizeCompareText(city)}|${state}|${zip.slice(0, 5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ city, state, zip });
  }
  return out;
}

function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhoneDigits(a);
  const nb = normalizePhoneDigits(b);
  if (!na || !nb) return false;
  return na === nb;
}

function streetMatchesProfile(
  streetFromPdf: string,
  profileStreet: string | null | undefined,
): boolean {
  if (!profileStreet?.trim()) return false;
  const a = normalizeCompareText(streetFromPdf);
  const b = normalizeCompareText(profileStreet);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function cityStateZipMatchesProfile(
  row: { city: string; state: string; zip: string },
  profile: ClientProfileForAlerts,
): boolean {
  const pCity = normalizeCompareText(profile.city ?? "");
  const pState = (profile.state ?? "").trim().toUpperCase();
  const pZip = digitsOnly(profile.zip ?? "").slice(0, 5);
  const rCity = normalizeCompareText(row.city);
  const rZip = digitsOnly(row.zip).slice(0, 5);

  // Require at least zip or (city+state) agreement when profile has those fields.
  if (pZip && rZip && pZip === rZip) {
    if (pState && row.state !== pState) return false;
    if (pCity && rCity && !(rCity.includes(pCity) || pCity.includes(rCity))) {
      return false;
    }
    return true;
  }
  if (pCity && pState && rCity && row.state) {
    return (
      row.state === pState &&
      (rCity.includes(pCity) || pCity.includes(rCity))
    );
  }
  return false;
}

/**
 * Conservative personal-info mismatches: only when the PDF shows a clear
 * alternate phone/address that conflicts with the profile, or when the
 * profile full name (length > 3) is absent from the PDF text.
 */
export function detectPersonalInfoMismatches(
  profile: ClientProfileForAlerts,
  afterPdfText: string,
): ProgressReportAlert[] {
  const alerts: ProgressReportAlert[] = [];
  const text = afterPdfText ?? "";

  const profilePhone = (profile.phone ?? "").trim();
  if (profilePhone) {
    const pdfPhones = extractPhonesFromText(text);
    const mismatches = pdfPhones.filter((p) => !phonesMatch(p, profilePhone));
    // Conservative: only when PDF contains an alternate phone that ≠ profile
    for (const alt of mismatches.slice(0, 3)) {
      alerts.push({
        type: "personal_info_mismatch",
        severity: "warning",
        title: "Phone mismatch on report",
        detail: `Report lists phone ending in ${alt.slice(-4)} that does not match the client profile.`,
        meta: {
          field: "phone",
          profile_phone_last4: normalizePhoneDigits(profilePhone).slice(-4),
          report_phone_last4: alt.slice(-4),
        },
      });
    }
  }

  const profileStreet = (profile.address_line1 ?? "").trim();
  const streets = extractStreetAddresses(text);
  if (profileStreet && streets.length > 0) {
    const mismatchedStreets = streets.filter(
      (s) => !streetMatchesProfile(s, profileStreet),
    );
    if (mismatchedStreets.length > 0) {
      const sample = mismatchedStreets[0];
      alerts.push({
        type: "personal_info_mismatch",
        severity: "warning",
        title: "Address mismatch on report",
        detail: `Report lists address "${sample}" which does not match the client profile street.`,
        meta: {
          field: "address_line1",
          report_address: sample,
          profile_address: profileStreet,
        },
      });
    }
  }

  const hasLocationProfile =
    !!(profile.city?.trim() || profile.state?.trim() || profile.zip?.trim());
  if (hasLocationProfile) {
    const locations = extractCityStateZips(text);
    const mismatched = locations.filter(
      (loc) => !cityStateZipMatchesProfile(loc, profile),
    );
    // Only alert when we found location rows and none match profile
    // (or clear alternate city/state/zip present).
    if (locations.length > 0 && mismatched.length > 0) {
      const anyMatch = locations.some((loc) =>
        cityStateZipMatchesProfile(loc, profile),
      );
      if (!anyMatch) {
        const sample = mismatched[0];
        alerts.push({
          type: "personal_info_mismatch",
          severity: "warning",
          title: "City/state/ZIP mismatch on report",
          detail: `Report lists "${sample.city}, ${sample.state} ${sample.zip}" which does not match the client profile.`,
          meta: {
            field: "city_state_zip",
            report_city: sample.city,
            report_state: sample.state,
            report_zip: sample.zip,
          },
        });
      }
    }
  }

  const first = (profile.first_name ?? "").trim();
  const last = (profile.last_name ?? "").trim();
  const fullName = `${first} ${last}`.trim();
  if (fullName.length > 3 && text.trim().length > 0) {
    const hay = normalizeCompareText(text);
    const needle = normalizeCompareText(fullName);
    const firstN = normalizeCompareText(first);
    const lastN = normalizeCompareText(last);
    const found =
      (needle.length > 0 && hay.includes(needle)) ||
      (firstN.length >= 2 &&
        lastN.length >= 2 &&
        hay.includes(firstN) &&
        hay.includes(lastN));
    if (!found) {
      alerts.push({
        type: "personal_info_mismatch",
        severity: "warning",
        title: "Name not found on report",
        detail: `Client name "${fullName}" was not found in the after report text.`,
        meta: { field: "name", profile_name: fullName },
      });
    }
  }

  return alerts;
}

const CLOSED_STILL_REPORTING_RE =
  /\b(?:paid\s+closed|paid\s+was\s+collection|closed|settled)\b/i;

/**
 * Accounts whose type/label suggests closed/paid/settled but are still listed.
 */
export function detectClosedStillReporting(
  afterAccounts: NegativeAccountLike[],
): ProgressReportAlert[] {
  const alerts: ProgressReportAlert[] = [];
  for (const acct of afterAccounts ?? []) {
    const hay = `${acct.type ?? ""} ${acct.label ?? ""}`;
    if (!CLOSED_STILL_REPORTING_RE.test(hay)) continue;
    alerts.push({
      type: "closed_still_reporting",
      severity: "warning",
      title: "Closed account still reporting",
      detail: `"${acct.label}" appears closed/paid/settled but is still listed on the after report.`,
      meta: {
        account_key: acct.key,
        account_label: acct.label,
        account_type: acct.type,
      },
    });
  }
  return alerts;
}

function isInquiryAccount(acct: NegativeAccountLike): boolean {
  const hay = `${acct.type ?? ""} ${acct.label ?? ""}`;
  return /\bhard\s*inquiry\b|\binquiry\b/i.test(hay);
}

function creditorTokenFromAccount(acct: NegativeAccountLike): string {
  // Prefer key left of "|", else label before em-dash / hyphen type suffix
  const fromKey = (acct.key ?? "").split("|")[0] ?? "";
  if (fromKey) return normalizeCompareText(fromKey);
  const label = acct.label ?? "";
  const beforeSep = label.split(/\s*[—–\-]\s*/)[0] ?? label;
  return normalizeCompareText(beforeSep);
}

function winMatchesInquiry(
  winLabel: string,
  inquiry: NegativeAccountLike,
): boolean {
  const win = normalizeCompareText(winLabel);
  if (!win || win.length < 3) return false;
  const creditor = creditorTokenFromAccount(inquiry);
  const labelN = normalizeCompareText(inquiry.label);
  const typeN = normalizeCompareText(inquiry.type);
  if (creditor && (win.includes(creditor) || creditor.includes(win))) {
    return true;
  }
  if (labelN && (win.includes(labelN) || labelN.includes(win))) return true;
  // Win may be just creditor name while inquiry label includes type
  if (creditor && win.length >= 3 && labelN.includes(win)) return true;
  void typeN;
  return false;
}

/**
 * Hard inquiries remaining on the after report. Critical when prior wins
 * claimed removal of the same creditor; otherwise warning.
 */
export function detectHardInquiriesStillOpen(
  afterAccounts: NegativeAccountLike[],
  priorTargets?: NegativeAccountLike[],
  priorWins?: Array<{ label: string }>,
): ProgressReportAlert[] {
  const alerts: ProgressReportAlert[] = [];
  const inquiries = (afterAccounts ?? []).filter(isInquiryAccount);
  const wins = priorWins ?? [];
  // priorTargets reserved for future matching; keep signature stable
  void priorTargets;

  for (const inquiry of inquiries) {
    const claimedRemoved = wins.some((w) =>
      winMatchesInquiry(w.label ?? "", inquiry),
    );
    if (claimedRemoved) {
      alerts.push({
        type: "hard_inquiry_open",
        severity: "critical",
        title: "Hard inquiry still open after claimed removal",
        detail: `"${inquiry.label}" was marked removed in a prior win but still appears on the after report.`,
        meta: {
          account_key: inquiry.key,
          account_label: inquiry.label,
          claimed_removed: true,
        },
      });
    } else {
      alerts.push({
        type: "hard_inquiry_open",
        severity: "warning",
        title: "Hard inquiry still reporting",
        detail: `"${inquiry.label}" is still listed as an inquiry on the after report.`,
        meta: {
          account_key: inquiry.key,
          account_label: inquiry.label,
          claimed_removed: false,
        },
      });
    }
  }
  return alerts;
}

export interface BuildDeterministicProgressAlertsOpts {
  profile: ClientProfileForAlerts;
  afterPdfText: string;
  afterAccounts: NegativeAccountLike[];
  priorTargets?: NegativeAccountLike[];
  priorWins?: Array<{ label: string }>;
  utilizationBeforePct?: number | null;
  utilizationAfterPct?: number | null;
  utilizationIncreaseThresholdPp?: number;
}

export const DEFAULT_UTIL_INCREASE_THRESHOLD_PP = 10;

export function detectUtilizationIncrease(opts: {
  beforePct?: number | null;
  afterPct?: number | null;
  thresholdPp?: number;
}): ProgressReportAlert[] {
  const before = opts.beforePct;
  const after = opts.afterPct;
  const threshold = opts.thresholdPp ?? DEFAULT_UTIL_INCREASE_THRESHOLD_PP;
  if (
    before == null ||
    after == null ||
    !Number.isFinite(before) ||
    !Number.isFinite(after)
  ) {
    return [];
  }
  const delta = after - before;
  if (delta < threshold) return [];
  return [
    {
      type: "utilization_increase",
      severity: delta >= threshold * 2 ? "critical" : "warning",
      title: "Utilization increased",
      detail: `Revolving utilization rose ${Math.round(delta)}pp (${Math.round(before)}% → ${Math.round(after)}%). Review paydown before next funding push.`,
      meta: {
        before_pct: Math.round(before),
        after_pct: Math.round(after),
        delta_pp: Math.round(delta),
        threshold_pp: threshold,
      },
    },
  ];
}

/** Combine detectors and dedupe by type+detail. */
export function buildDeterministicProgressAlerts(
  opts: BuildDeterministicProgressAlertsOpts,
): ProgressReportAlert[] {
  const combined: ProgressReportAlert[] = [
    ...detectPersonalInfoMismatches(opts.profile, opts.afterPdfText),
    ...detectClosedStillReporting(opts.afterAccounts),
    ...detectHardInquiriesStillOpen(
      opts.afterAccounts,
      opts.priorTargets,
      opts.priorWins,
    ),
    ...detectUtilizationIncrease({
      beforePct: opts.utilizationBeforePct,
      afterPct: opts.utilizationAfterPct,
      thresholdPp: opts.utilizationIncreaseThresholdPp,
    }),
  ];

  const seen = new Set<string>();
  const out: ProgressReportAlert[] = [];
  for (const alert of combined) {
    const key = `${alert.type}|${alert.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alert);
  }
  return out;
}

/** Namespace export for future `export { ProgressReportAlerts } from "..."` wiring. */
export const ProgressReportAlerts = {
  normalizeCompareText,
  detectPersonalInfoMismatches,
  detectClosedStillReporting,
  detectHardInquiriesStillOpen,
  detectUtilizationIncrease,
  buildDeterministicProgressAlerts,
} as const;

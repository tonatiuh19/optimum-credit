/**
 * OFG prospect traffic light (semáforo) — pure rules (Cesar, Oct 14 2026;
 * replaces task 3030556). Prospects / web leads only.
 *
 *  hot  (Caliente): analysis reviewed with Cesar, a call is scheduled, or the
 *                   prospect started registration (payment, monitoring login,
 *                   documents).
 *  warm (Tibio):    replied in the last 14 days, or has a credit report /
 *                   analysis — but not hot.
 *  cold (Frío):     no reply in 14+ days and no credit report.
 *
 * Production entry stays api/index.ts (inlined; sync test).
 */

export type LeadTemperature = "hot" | "warm" | "cold";

export type LeadReason =
  | "analysis_reviewed"
  | "call_scheduled"
  | "payment_started"
  | "monitoring_login"
  | "documents_uploaded"
  | "recent_reply"
  | "has_credit_report"
  | "no_reply_14d";

export interface LeadSignals {
  now: Date;
  lastInboundAt: Date | null;
  hasCreditReport: boolean;
  analysisReviewedAt: Date | null;
  callScheduledAt: Date | null;
  paymentStarted: boolean;
  monitoringLogin: boolean;
  documentsUploaded: boolean;
}

export const LEAD_REPLY_WINDOW_DAYS = 14;
/** A scheduled call keeps the prospect hot until 2 days after its time. */
export const LEAD_CALL_GRACE_DAYS = 2;
export const LEAD_HOT_STALE_DAYS = 3;

const DAY = 86_400_000;

export function computeLeadTemperature(s: LeadSignals): {
  temperature: LeadTemperature;
  reasons: LeadReason[];
} {
  const hot: LeadReason[] = [];
  if (s.analysisReviewedAt) hot.push("analysis_reviewed");
  if (s.callScheduledAt && s.callScheduledAt.getTime() >= s.now.getTime() - LEAD_CALL_GRACE_DAYS * DAY) {
    hot.push("call_scheduled");
  }
  if (s.paymentStarted) hot.push("payment_started");
  if (s.monitoringLogin) hot.push("monitoring_login");
  if (s.documentsUploaded) hot.push("documents_uploaded");
  if (hot.length) return { temperature: "hot", reasons: hot };

  const warm: LeadReason[] = [];
  if (s.lastInboundAt && s.now.getTime() - s.lastInboundAt.getTime() < LEAD_REPLY_WINDOW_DAYS * DAY) {
    warm.push("recent_reply");
  }
  if (s.hasCreditReport) warm.push("has_credit_report");
  if (warm.length) return { temperature: "warm", reasons: warm };

  return { temperature: "cold", reasons: ["no_reply_14d"] };
}

const RANK: Record<LeadTemperature, number> = { cold: 0, warm: 1, hot: 2 };

/** True when the color moved up (cold→warm, warm→hot, cold→hot). */
export function isLeadTemperatureUpgrade(
  prev: LeadTemperature | null | undefined,
  next: LeadTemperature,
): boolean {
  return !!prev && RANK[next] > RANK[prev];
}

/** Hot with no movement (message either way / change) for 3+ days. */
export function isHotLeadStale(opts: {
  temperature: LeadTemperature | null;
  lastMovementAt: Date | null;
  lastAlertAt: Date | null;
  now: Date;
}): boolean {
  if (opts.temperature !== "hot" || !opts.lastMovementAt) return false;
  if (opts.now.getTime() - opts.lastMovementAt.getTime() < LEAD_HOT_STALE_DAYS * DAY) return false;
  // One alert per stale stretch: re-alert only after new movement.
  return !opts.lastAlertAt || opts.lastAlertAt.getTime() < opts.lastMovementAt.getTime();
}

/** "Analysis reviewed" auto-detect: a 5+ minute call after the analysis. */
export const LEAD_REVIEW_CALL_MIN_SEC = 300;

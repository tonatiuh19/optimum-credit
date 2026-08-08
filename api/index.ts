import "dotenv/config";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import fs from "fs";
import path from "path";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import multer from "multer";
import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Resend } from "resend";
import twilio from "twilio";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type {
  OfGReportData,
  OfGReportWizardOptions,
  InfoRequestFieldDef,
  InfoRequestStatus,
  PipelineStage,
  ClientStatus,
  Label,
  LabelLayer,
  CreditAnalysisMode,
  CreditAnalysisNegativeItem,
  CreditAnalysisResult,
  AdminNotifyEventKey,
  AdminNotifyChannel,
  AdminNotificationPrefs,
  AdminNotifyEventToggles,
} from "../shared/api";
// ============================================================================
// AFFILIATE HELPERS (inline — Vercel serverless; keep tests importing from ./index)
// ============================================================================

export type AffiliatePlan = "standard" | "master" | "sub_affiliate";
export type AffiliateLanding = "credit_analysis" | "pricing";
export type AffiliateSubscriptionStatus =
  | "none"
  | "pending"
  | "active"
  | "past_due"
  | "cancelled"
  | "comped";
export type AffiliateStatus = "invited" | "active" | "inactive" | "suspended";

export const AFFILIATE_ATTRIBUTION_COOKIE = "oc_aff_ref";
/** First-touch attribution window (days) — locked decision. */
export const AFFILIATE_ATTRIBUTION_DAYS = 30;

/** Suggested monthly subscription prices (cents). */
export const AFFILIATE_TIER_PRICES_CENTS: Record<AffiliatePlan, number> = {
  standard: 20_000, // $200
  master: 50_000, // $500
  sub_affiliate: 0,
};

/**
 * Suggested commission rates in basis points (1% = 100 bps).
 * Admins can override per affiliate in the DB row.
 */
export const AFFILIATE_COMMISSION_SUGGESTIONS_BPS: Record<
  AffiliatePlan,
  { enrollment_bps: number; parent_override_bps: number }
> = {
  standard: { enrollment_bps: 1000, parent_override_bps: 0 }, // 10%
  master: { enrollment_bps: 1500, parent_override_bps: 500 }, // 15% + 5% on subs
  sub_affiliate: { enrollment_bps: 500, parent_override_bps: 0 }, // 5%
};

/** Feature flags — everything on for both paid tiers for now, SMS deferred. */
export const AFFILIATE_FEATURES_ALL_ON = {
  pipeline: true,
  lead_create: true,
  credit_analysis_links: true,
  sms: false,
  view_team_pipeline: true,
  sub_affiliates: true,
  commission_reports: true,
} as const;

export function slugifyAffiliateName(
  firstName: string,
  lastName: string,
): string {
  const base = `${firstName || ""}-${lastName || ""}`
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "affiliate";
}

export function normalizeAffiliateSlug(raw: string): string {
  return String(raw || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function isValidAffiliateSlug(slug: string): boolean {
  return (
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    slug.length >= 2 &&
    slug.length <= 64
  );
}

export function suggestedTierDefaults(plan: AffiliatePlan): {
  monthly_price_cents: number;
  commission_rate_bps: number;
  parent_override_rate_bps: number;
} {
  const prices = AFFILIATE_TIER_PRICES_CENTS[plan];
  const rates = AFFILIATE_COMMISSION_SUGGESTIONS_BPS[plan];
  return {
    monthly_price_cents: prices,
    commission_rate_bps: rates.enrollment_bps,
    parent_override_rate_bps: rates.parent_override_bps,
  };
}

export function computeCommissionCents(
  baseAmountCents: number,
  rateBps: number,
): number {
  if (baseAmountCents <= 0 || rateBps <= 0) return 0;
  return Math.round((baseAmountCents * rateBps) / 10_000);
}

export function affiliateHasPortalAccess(opts: {
  status: string;
  subscription_status: string;
}): boolean {
  if (opts.status === "suspended" || opts.status === "inactive") return false;
  if (opts.status === "active") {
    return (
      opts.subscription_status === "active" ||
      opts.subscription_status === "comped"
    );
  }
  // invited: only if comped early (admin fast-tracked before payment)
  return opts.subscription_status === "comped";
}

/**
 * Whether a resolved affiliate can still be attributed a click / referral
 * link. Broader than portal access — an invited-but-unpaid affiliate's link
 * should still work so early sharing isn't wasted, but inactive/suspended
 * affiliates should not accumulate new attribution.
 */
export function affiliateCanReceiveClicks(opts: { status: string }): boolean {
  return opts.status !== "inactive" && opts.status !== "suspended";
}

export function affiliateLandingPath(
  landing: AffiliateLanding,
  slug: string,
): string {
  if (landing === "pricing") return `/pricing?ref=${encodeURIComponent(slug)}`;
  return `/credit-analysis?ref=${encodeURIComponent(slug)}`;
}

export function buildAffiliatePublicLinks(
  slug: string,
  appUrl?: string,
): {
  short_default: string;
  short_analysis: string;
  short_pricing: string;
  analysis_ref: string;
  pricing_ref: string;
} {
  const base = (appUrl || "").replace(/\/$/, "");
  const s = encodeURIComponent(slug);
  const prefix = base ? `${base}` : "";
  return {
    short_default: `${prefix}/r/${s}`,
    short_analysis: `${prefix}/r/${s}?to=analysis`,
    short_pricing: `${prefix}/r/${s}?to=pricing`,
    analysis_ref: `${prefix}/credit-analysis?ref=${s}`,
    pricing_ref: `${prefix}/pricing?ref=${s}`,
  };
}

// ============================================================================
// HUBSPOT HELPERS (inline — Vercel serverless; keep tests importing from ./index)
// ============================================================================

export type WorkTaskStatus = "backlog" | "doing" | "done";
export type WorkTaskPriority = "low" | "medium" | "high" | "urgent";

export function hubspotStatusToWork(
  status: string | null | undefined,
): WorkTaskStatus {
  const s = String(status || "").toUpperCase();
  if (s === "COMPLETED") return "done";
  if (s === "IN_PROGRESS") return "doing";
  return "backlog";
}

export function workStatusToHubspot(status: WorkTaskStatus): string {
  if (status === "done") return "COMPLETED";
  if (status === "doing") return "IN_PROGRESS";
  return "NOT_STARTED";
}

export function hubspotPriorityToWork(
  priority: string | null | undefined,
): WorkTaskPriority {
  const p = String(priority || "").toUpperCase();
  if (p === "HIGH" || p === "URGENT") return "high";
  if (p === "LOW") return "low";
  return "medium";
}

export function workPriorityToHubspot(priority: WorkTaskPriority): string {
  if (priority === "urgent" || priority === "high") return "HIGH";
  if (priority === "low") return "LOW";
  return "MEDIUM";
}

// 2026.03 Tasks API is authorized via contacts scopes — crm.objects.tasks.*
// is not a valid Projects/Service Key scope (HubSpot Developer Support, Aug 2026).
export const HUBSPOT_SCOPES = [
  "oauth",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
].join(" ");

export const HUBSPOT_TASKS_API_BASE =
  "https://api.hubapi.com/crm/objects/2026-03/tasks";

export interface HubspotTokenBundle {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix ms
  token_type?: string;
}

export interface HubspotRemoteTask {
  id: string;
  title: string;
  description: string | null;
  status: WorkTaskStatus;
  priority: WorkTaskPriority;
  due_at: string | null;
  owner_id: string | null;
  updated_at: string | null;
}

function hubspotAccountAccessToken(): string {
  // Service Keys (beta) replace legacy private apps for system-to-system CRM API access.
  // https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys
  return (
    String(process.env.HUBSPOT_SERVICE_KEY || "").trim() ||
    String(process.env.HUBSPOT_PRIVATE_APP_TOKEN || "").trim()
  );
}

export function isHubspotServiceKeyConfigured(): boolean {
  return Boolean(hubspotAccountAccessToken());
}

/** Effective HubSpot auth path for Work Hub sync. Service Key wins when set. */
export function hubspotAuthMode(): "service_key" | "oauth" | null {
  if (isHubspotServiceKeyConfigured()) return "service_key";
  if (isHubspotOAuthConfigured()) return "oauth";
  return null;
}

function hubspotConfigured(): boolean {
  return Boolean(
    (process.env.HUBSPOT_CLIENT_ID && process.env.HUBSPOT_CLIENT_SECRET) ||
      isHubspotServiceKeyConfigured(),
  );
}

export function isHubspotOAuthConfigured(): boolean {
  return Boolean(
    process.env.HUBSPOT_CLIENT_ID && process.env.HUBSPOT_CLIENT_SECRET,
  );
}

/** True when either OAuth client credentials or a Service Key / account token is set. */
export function isHubspotSyncConfigured(): boolean {
  return hubspotConfigured();
}

export function buildHubspotAuthorizeUrl(opts: {
  redirectUri: string;
  state: string;
}): string | null {
  if (!isHubspotOAuthConfigured()) return null;
  const params = new URLSearchParams({
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    redirect_uri: opts.redirectUri,
    scope: HUBSPOT_SCOPES,
    state: opts.state,
  });
  return `https://app.hubspot.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeHubspotCode(opts: {
  code: string;
  redirectUri: string;
}): Promise<HubspotTokenBundle> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
    redirect_uri: opts.redirectUri,
    code: opts.code,
  });
  const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await resp.json()) as any;
  if (!resp.ok) {
    throw new Error(
      data?.message ||
        data?.error_description ||
        "HubSpot token exchange failed",
    );
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + Number(data.expires_in || 1800) * 1000 - 60_000,
    token_type: data.token_type,
  };
}

export async function refreshHubspotToken(
  refreshToken: string,
): Promise<HubspotTokenBundle> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
    refresh_token: refreshToken,
  });
  const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await resp.json()) as any;
  if (!resp.ok) {
    throw new Error(
      data?.message ||
        data?.error_description ||
        "HubSpot token refresh failed",
    );
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at: Date.now() + Number(data.expires_in || 1800) * 1000 - 60_000,
    token_type: data.token_type,
  };
}

export async function fetchHubspotAccountInfo(
  accessToken: string,
): Promise<{ hub_id?: string; hub_domain?: string }> {
  try {
    const resp = await fetch("https://api.hubapi.com/account-info/v3/details", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return {};
    const data = (await resp.json()) as any;
    return {
      hub_id: data?.portalId != null ? String(data.portalId) : undefined,
      hub_domain: data?.uiDomain || data?.companyCurrency || undefined,
    };
  } catch {
    return {};
  }
}

function mapRemoteTask(raw: any): HubspotRemoteTask {
  const props = raw.properties || {};
  const dueRaw = props.hs_timestamp || props.hs_task_reminders || null;
  let due_at: string | null = null;
  if (dueRaw) {
    const n = Number(dueRaw);
    due_at = Number.isFinite(n) ? new Date(n).toISOString() : String(dueRaw);
  }
  return {
    id: String(raw.id),
    title: String(
      props.hs_task_subject || props.hs_task_body || "HubSpot task",
    ).slice(0, 255),
    description: props.hs_task_body ? String(props.hs_task_body) : null,
    status: hubspotStatusToWork(props.hs_task_status),
    priority: hubspotPriorityToWork(props.hs_task_priority),
    due_at,
    owner_id: props.hubspot_owner_id ? String(props.hubspot_owner_id) : null,
    updated_at: props.hs_lastmodifieddate || raw.updatedAt || null,
  };
}

export async function listHubspotTasks(
  accessToken: string,
  limit = 100,
): Promise<HubspotRemoteTask[]> {
  const props = [
    "hs_task_subject",
    "hs_task_body",
    "hs_task_status",
    "hs_task_priority",
    "hs_timestamp",
    "hubspot_owner_id",
    "hs_lastmodifieddate",
  ].join(",");
  const url = new URL(HUBSPOT_TASKS_API_BASE);
  url.searchParams.set("limit", String(Math.min(100, limit)));
  url.searchParams.set("properties", props);
  url.searchParams.set("archived", "false");

  const out: HubspotRemoteTask[] = [];
  let after: string | undefined;
  do {
    if (after) url.searchParams.set("after", after);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await resp.json()) as any;
    if (!resp.ok) {
      throw new Error(data?.message || "Failed to list HubSpot tasks");
    }
    for (const row of data.results || []) {
      out.push(mapRemoteTask(row));
    }
    after = data.paging?.next?.after;
  } while (after && out.length < limit);

  return out;
}

export async function updateHubspotTask(
  accessToken: string,
  taskId: string,
  patch: {
    title?: string;
    description?: string | null;
    status?: WorkTaskStatus;
    priority?: WorkTaskPriority;
    due_at?: string | null;
  },
): Promise<void> {
  const properties: Record<string, string> = {};
  if (patch.title != null) properties.hs_task_subject = patch.title;
  if (patch.description !== undefined) {
    properties.hs_task_body = patch.description || "";
  }
  if (patch.status != null) {
    properties.hs_task_status = workStatusToHubspot(patch.status);
  }
  if (patch.priority != null) {
    properties.hs_task_priority = workPriorityToHubspot(patch.priority);
  }
  if (patch.due_at !== undefined) {
    properties.hs_timestamp = patch.due_at
      ? String(new Date(patch.due_at).getTime())
      : "";
  }
  if (Object.keys(properties).length === 0) return;

  const resp = await fetch(
    `${HUBSPOT_TASKS_API_BASE}/${encodeURIComponent(taskId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    },
  );
  if (!resp.ok) {
    const data = (await resp.json().catch(() => ({}))) as any;
    throw new Error(data?.message || "Failed to update HubSpot task");
  }
}

/** Fuzzy match key when hubspot_task_id is missing. */
export function workTaskMatchKey(
  title: string,
  dueAt: string | null | undefined,
): string {
  const t = title.trim().toLowerCase().replace(/\s+/g, " ");
  const d = dueAt ? new Date(dueAt).toISOString().slice(0, 10) : "";
  return `${t}|${d}`;
}

// ============================================================================
// CREDIT ANALYSIS ALGORITHM (inline — Vercel serverless; keep tests importing from ./index)
// ============================================================================

// ─── Brand tokens (email-safe hex matching global.css) ─────────────────────

export const OFG_COLORS = {
  navy: "#121829",
  gold: "#C0A06A",
  foreground: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  cardBg: "#f8fafc",
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#ca8a04",
  lower: "#2563eb",
  utilOk: "#16a34a",
} as const;

export type AnalystLang = "English" | "Spanish";
export type DisputePriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOWER";
export type GoalKind =
  | "fha"
  | "conventional"
  | "jumbo"
  | "auto"
  | "business"
  | "general";

export type AnalystScores = {
  transunion: number | null;
  experian: number | null;
  equifax: number | null;
};

export type AnalystNegativeInput = {
  type: string;
  creditor?: string;
  bureaus?: string[];
  detail?: string;
};

export type AnalystUtilRow = {
  account: string;
  limit: number;
  balance: number;
  pctUsed: number;
  payTo30: number;
  payTo10: number;
};

/** Flat JSON — ALL VALUES FLAT, NO ARRAYS, NO NESTED OBJECTS */
export type CreditAnalysisAnalystFlat = {
  client_name: string;
  analysis_goal: string;
  report_date: string;
  referral_name: string;
  referral_company: string;

  score_transunion: number | null;
  score_experian: number | null;
  score_equifax: number | null;
  score_tu_label: string;
  score_ex_label: string;
  score_eq_label: string;
  middle_score: number | null;
  fha_status: string;
  goal_score: number;
  goal_description: string;
  gap_tu: number | null;
  gap_ex: number | null;
  gap_eq: number | null;

  neg_1_account: string;
  neg_1_type: string;
  neg_1_bureaus: string;
  neg_1_priority: string;
  neg_1_dispute_basis: string;
  neg_2_account: string;
  neg_2_type: string;
  neg_2_bureaus: string;
  neg_2_priority: string;
  neg_2_dispute_basis: string;
  neg_3_account: string;
  neg_3_type: string;
  neg_3_bureaus: string;
  neg_3_priority: string;
  neg_3_dispute_basis: string;
  neg_4_account: string;
  neg_4_type: string;
  neg_4_bureaus: string;
  neg_4_priority: string;
  neg_4_dispute_basis: string;
  neg_5_account: string;
  neg_5_type: string;
  neg_5_bureaus: string;
  neg_5_priority: string;
  neg_5_dispute_basis: string;

  utilization_critical_note: string;
  util_1_account: string;
  util_1_limit: string;
  util_1_balance: string;
  util_1_percent: string;
  util_1_pay30: string;
  util_1_pay10: string;
  util_2_account: string;
  util_2_limit: string;
  util_2_balance: string;
  util_2_percent: string;
  util_2_pay30: string;
  util_2_pay10: string;
  util_3_account: string;
  util_3_limit: string;
  util_3_balance: string;
  util_3_percent: string;
  util_3_pay30: string;
  util_3_pay10: string;
  total_revolving_limit: string;
  total_revolving_balance: string;
  total_revolving_util: string;
  paydown_30_instruction: string;
  paydown_10_instruction: string;

  score_today: number | null;
  score_30_days: number | null;
  score_60_days: number | null;
  score_90_days: number | null;
  score_target: number | null;
  target_timeframe: string;

  round_1_actions: string;
  round_2_actions: string;
  round_3_actions: string;
  positive_accounts_protect: string;

  action_1_time: string;
  action_1_action: string;
  action_1_reason: string;
  action_2_time: string;
  action_2_action: string;
  action_2_reason: string;
  action_3_time: string;
  action_3_action: string;
  action_3_reason: string;
  action_4_time: string;
  action_4_action: string;
  action_4_reason: string;
  action_5_time: string;
  action_5_action: string;
  action_5_reason: string;
  action_6_time: string;
  action_6_action: string;
  action_6_reason: string;

  file_strength_score: number;
  file_strength_rating: string;
  fs_label_1: string;
  fs_open_revolving: string;
  fs_label_2: string;
  fs_installment_mix: string;
  fs_label_3: string;
  fs_mortgage: string;
  fs_label_4: string;
  fs_account_age: string;
  fs_label_5: string;
  fs_post_repair: string;
  tradeline_recommendation: string;

  negative_items_html: string;
  negative_count: number;
  critical_count: number;
  high_count: number;
  utilization_html: string;
  action_plan_html: string;
  mortgage_tu: number | null;
  mortgage_ex: number | null;
  mortgage_eq: number | null;
  tradeline_needed: string;
  client_text_message: string;
  text_language: AnalystLang;
};

export type CreditAnalysisAlgorithmInput = {
  clientName: string;
  firstName: string;
  lastName: string;
  repName?: string | null;
  clientGoal?: string | null;
  language: "en" | "es";
  scores: AnalystScores;
  negatives: AnalystNegativeInput[];
  reportText: string;
  utilization?: AnalystUtilRow[];
  positiveAccounts?: string[];
  reportDate?: string | null;
  weakExtraction?: boolean;
};

type RankedNeg = {
  account: string;
  type: string;
  bureaus: string;
  priority: DisputePriority;
  dispute_basis: string;
};

type TFn = (en: string, es: string) => string;

const PRIORITY_RANK: Record<DisputePriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOWER: 3,
};

const HISPANIC_SURNAME_HINT =
  /\b(garcia|rodriguez|martinez|hernandez|lopez|gonzalez|perez|sanchez|ramirez|torres|flores|rivera|gomez|diaz|reyes|morales|cruz|ortiz|gutierrez|chavez|ramos|ruiz|alvarez|mendoza|castillo|jimenez|moreno|romero|vargas|herrera|medina|aguilar|guerrero|contreras|delgado|vega|campos|soto|guzman|castro|fernandez|munoz|muñoz|silva|rojas|mendez|navarro|dominguez|espinoza|valdez|salazar|guillen|ibarra|carrillo)\b/i;

// escapeHtml is defined once later in this file (shared by email + analyst HTML).

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function clampScore(n: number): number {
  return Math.min(850, Math.max(300, Math.round(n)));
}

function makeT(lang: AnalystLang): TFn {
  return (en, es) => (lang === "Spanish" ? es : en);
}

function fsFormat(score: number, max: number, notes: string): string {
  return `${score}/${max} — ${notes}`;
}

export function scoreBandLabel(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return "";
  if (score < 580) return "POOR";
  if (score < 670) return "FAIR";
  if (score < 740) return "GOOD";
  if (score < 800) return "VERY GOOD";
  return "EXCELLENT";
}

/** Median of 3; lower of 2 if one null; single if only one. */
export function computeMiddleScore(scores: AnalystScores): number | null {
  const vals = [scores.transunion, scores.experian, scores.equifax].filter(
    (n): n is number => n != null && !Number.isNaN(n),
  );
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  if (vals.length === 2) return vals[0];
  return vals[Math.floor(vals.length / 2)];
}

export function classifyGoalKind(goal: string | null | undefined): GoalKind {
  const g = (goal || "").toLowerCase();
  if (/fha/.test(g)) return "fha";
  if (/jumbo/.test(g)) return "jumbo";
  if (/conventional/.test(g)) return "conventional";
  if (/auto|car|vehicle/.test(g)) return "auto";
  if (/business|sba|funding/.test(g)) return "business";
  if (/general|improv/.test(g)) return "general";
  if (/mortgage|home|house|purchase/.test(g)) return "conventional";
  if (!g.trim()) return "general";
  return "general";
}

export function resolveTextLanguage(
  language: "en" | "es",
  lastName: string,
): AnalystLang {
  if (language === "es") return "Spanish";
  if (HISPANIC_SURNAME_HINT.test(lastName.trim())) return "Spanish";
  return "English";
}

export function extractUtilizationFromText(text: string): AnalystUtilRow[] {
  const results: AnalystUtilRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(
      /([A-Za-z0-9*\/\s]{4,40}?)\s+[\$]?([\d,]+)\s+[\$]?([\d,]+)\s+(\d{1,3})%/,
    );
    if (!m) continue;
    const limit = Number(m[2].replace(/,/g, ""));
    const balance = Number(m[3].replace(/,/g, ""));
    const pctUsed = Number(m[4]);
    if (limit <= 0 || pctUsed > 100) continue;
    results.push({
      account: m[1].trim().slice(0, 40),
      limit,
      balance,
      pctUsed,
      payTo30: Math.max(0, Math.ceil(balance - limit * 0.3)),
      payTo10: Math.max(0, Math.ceil(balance - limit * 0.1)),
    });
  }
  return results.slice(0, 12);
}

function utilColor(pct: number): string {
  if (pct > 80) return OFG_COLORS.critical;
  if (pct > 50) return OFG_COLORS.high;
  if (pct > 30) return OFG_COLORS.medium;
  return OFG_COLORS.utilOk;
}

function priorityColor(p: DisputePriority): string {
  if (p === "CRITICAL") return OFG_COLORS.critical;
  if (p === "HIGH") return OFG_COLORS.high;
  if (p === "MEDIUM") return OFG_COLORS.medium;
  return OFG_COLORS.lower;
}

function extractBalanceHint(detail: string): number | null {
  const m = detail.match(/\$?\s*([\d,]{2,})/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function countBureaus(text: string, explicit?: string[]): number {
  if (explicit?.length) return explicit.length;
  let n = 0;
  if (/\b(TU|TransUnion)\b/i.test(text)) n++;
  if (/\b(EX|Experian)\b/i.test(text)) n++;
  if (/\b(EQ|Equifax)\b/i.test(text)) n++;
  return n;
}

function formatBureaus(hay: string, explicit?: string[]): string {
  if (explicit?.length) return explicit.join("/");
  const found: string[] = [];
  if (/\b(TU|TransUnion)\b/i.test(hay)) found.push("TU");
  if (/\b(EX|Experian)\b/i.test(hay)) found.push("EX");
  if (/\b(EQ|Equifax)\b/i.test(hay)) found.push("EQ");
  return found.length ? found.join("/") : "TU/EX/EQ";
}

export function rankNegativeItem(n: AnalystNegativeInput): RankedNeg {
  const hay = `${n.type} ${n.creditor || ""} ${n.detail || ""}`;
  const type = n.type || "Derogatory Item";
  const account = (n.creditor || type).slice(0, 60);
  const bureauCount = countBureaus(hay, n.bureaus);
  const bureaus = formatBureaus(hay, n.bureaus);
  const bal = extractBalanceHint(n.detail || "");

  let priority: DisputePriority = "MEDIUM";
  let basis =
    "FCRA accuracy review — verify reporting and dispute unsupported items.";

  if (/inqui/i.test(hay)) {
    priority = "LOWER";
    basis =
      "Hard inquiry — verify permissible purpose under FCRA; dispute unauthorized inquiries.";
  } else if (
    /personal|address|name|ssn|dob|identity/i.test(hay) &&
    /error|incorrect|wrong/i.test(hay)
  ) {
    priority = "LOWER";
    basis =
      "Personal information error — request correction of inaccurate consumer data (FCRA).";
  } else if (
    /90\+|90 day|120/i.test(hay) &&
    /late|delinquen|past due|active/i.test(hay)
  ) {
    priority = "CRITICAL";
    basis =
      "Active 90+ delinquency — high-impact; dispute inaccurate status/dates with all reporting bureaus.";
  } else if (/charge.?off|charged off/i.test(hay)) {
    if (bureauCount > 0 && bureauCount < 3) {
      priority = "CRITICAL";
      basis =
        "Charge-off not consistent across all 3 bureaus — prioritize metro inconsistency dispute (FCRA).";
    } else {
      priority = "HIGH";
      basis =
        "Charge-off on file — dispute inaccurate balance, status, or dates; request method of verification.";
    }
  } else if (/collection/i.test(hay)) {
    if (bal != null && bal < 500) {
      priority = "MEDIUM";
      basis =
        "Small collection (<$500) — dispute validation under FDCPA/FCRA; verify original creditor & amount.";
    } else {
      priority = "HIGH";
      basis =
        "Collection account — demand validation (FDCPA) and dispute inaccurate reporting (FCRA).";
    }
  } else if (/late|past due|delinquen/i.test(hay)) {
    priority = "HIGH";
    basis =
      "Recent late payment — dispute incorrect late marks; verify payment history dates.";
  } else if (/bankrupt|foreclos|repossess|judgment|lien/i.test(hay)) {
    priority = "HIGH";
    basis =
      "Public-record / severe derogatory — verify court data accuracy and reporting period (FCRA).";
  }

  return { account, type, bureaus, priority, dispute_basis: basis };
}

function adjustmentFactors(
  util: AnalystUtilRow[],
  negatives: RankedNeg[],
  reportText: string,
): number {
  const totalLimit = util.reduce((s, u) => s + u.limit, 0);
  const totalBal = util.reduce((s, u) => s + u.balance, 0);
  const utilPct = totalLimit > 0 ? (totalBal / totalLimit) * 100 : 0;
  const highUtil = utilPct > 50;
  const recentLates = negatives.some((n) => /late|delinquen/i.test(n.type));
  const collections = negatives.some((n) => /collection|charge/i.test(n.type));
  const accountMentions = (reportText.match(/\baccount\b/gi) || []).length;
  const thinFile =
    accountMentions > 0 && accountMentions < 4 && util.length < 2;

  let delta = 25;
  if (highUtil) delta += utilPct > 80 ? 18 : 12;
  if (recentLates) delta += 20;
  if (collections) delta += 28;
  if (thinFile) delta += 15;
  if (!highUtil && !recentLates && !collections && !thinFile) delta = 18;
  return Math.min(55, Math.max(15, delta));
}

function nextTierGoal(mid: number): number {
  if (mid < 580) return 580;
  if (mid < 670) return 670;
  if (mid < 740) return 740;
  if (mid < 800) return 800;
  return Math.min(850, mid + 20);
}

function autoTier(score: number): { tier: string; label: string } {
  if (score >= 720) return { tier: "Tier 1", label: "best rates" };
  if (score >= 680) return { tier: "Tier 2", label: "competitive rates" };
  if (score >= 620)
    return { tier: "Tier 3", label: "standard/subprime border" };
  return { tier: "Subprime", label: "higher-cost financing" };
}

function estimateAccountAgeYears(text: string): number {
  const m = text.match(/(\d{1,2})\s*(?:yrs?|years)\s*(?:old|history|age)?/i);
  if (m) return Number(m[1]);
  if (/opened\s+\d{2}\/\d{2}\/(19|20)\d{2}/i.test(text)) return 5;
  return 3;
}

function countOpenRevolving(util: AnalystUtilRow[], text: string): number {
  if (util.length > 0) return util.length;
  const cards = (text.match(/revolving|credit card|bank card/gi) || []).length;
  return Math.min(5, Math.floor(cards / 2));
}

function hasInstallment(text: string): boolean {
  return /installment|auto loan|student|mortgage|personal loan/i.test(text);
}

function hasAuto(text: string): boolean {
  return /auto loan|vehicle|car loan|automobile/i.test(text);
}

function hasMortgage(text: string): boolean {
  return /mortgage|home equity|heloc/i.test(text);
}

function hasBusinessLine(text: string): boolean {
  return /business (credit|line|card)|sba|d&b|dun/i.test(text);
}

function localizeDisputeBasis(basis: string, lang: AnalystLang): string {
  if (lang !== "Spanish") return basis;
  return basis
    .replace(
      "FCRA accuracy review — verify reporting and dispute unsupported items.",
      "Revisión de exactitud FCRA — verificar el reporte y disputar ítems no respaldados.",
    )
    .replace(
      "Hard inquiry — verify permissible purpose under FCRA; dispute unauthorized inquiries.",
      "Consulta dura — verificar propósito permisible bajo FCRA; disputar consultas no autorizadas.",
    )
    .replace(
      "Personal information error — request correction of inaccurate consumer data (FCRA).",
      "Error de información personal — solicitar corrección de datos inexactos (FCRA).",
    )
    .replace(
      "Active 90+ delinquency — high-impact; dispute inaccurate status/dates with all reporting bureaus.",
      "Morosidad activa 90+ — alto impacto; disputar estado/fechas inexactas con las 3 agencias.",
    )
    .replace(
      "Charge-off not consistent across all 3 bureaus — prioritize metro inconsistency dispute (FCRA).",
      "Cargo fallido inconsistente entre las 3 agencias — priorizar disputa por inconsistencia (FCRA).",
    )
    .replace(
      "Charge-off on file — dispute inaccurate balance, status, or dates; request method of verification.",
      "Cargo fallido en el archivo — disputar saldo, estado o fechas; solicitar método de verificación.",
    )
    .replace(
      "Small collection (<$500) — dispute validation under FDCPA/FCRA; verify original creditor & amount.",
      "Cobro pequeño (<$500) — disputar validación bajo FDCPA/FCRA; verificar acreedor original y monto.",
    )
    .replace(
      "Collection account — demand validation (FDCPA) and dispute inaccurate reporting (FCRA).",
      "Cuenta en cobro — exigir validación (FDCPA) y disputar reporte inexacto (FCRA).",
    )
    .replace(
      "Recent late payment — dispute incorrect late marks; verify payment history dates.",
      "Pago atrasado reciente — disputar marcas incorrectas; verificar fechas del historial.",
    )
    .replace(
      "Public-record / severe derogatory — verify court data accuracy and reporting period (FCRA).",
      "Registro público / negativo severo — verificar exactitud judicial y período de reporte (FCRA).",
    );
}

function buildNegativeHtml(items: RankedNeg[]): string {
  return items
    .map(
      (n) =>
        `<tr><td style="padding:8px;border-bottom:1px solid ${OFG_COLORS.border};"><strong>${escapeHtml(n.account)}</strong></td><td style="padding:8px;border-bottom:1px solid ${OFG_COLORS.border};">${escapeHtml(n.type)}</td><td style="padding:8px;border-bottom:1px solid ${OFG_COLORS.border};text-align:center;">${escapeHtml(n.bureaus)}</td><td style="padding:8px;border-bottom:1px solid ${OFG_COLORS.border};text-align:center;color:${priorityColor(n.priority)};font-weight:bold;">${n.priority}</td><td style="padding:8px;border-bottom:1px solid ${OFG_COLORS.border};font-size:12px;">${escapeHtml(n.dispute_basis)}</td></tr>`,
    )
    .join("");
}

function buildUtilHtml(rows: AnalystUtilRow[]): string {
  return rows
    .map(
      (u) =>
        `<tr><td style="padding:8px;border-bottom:1px solid ${OFG_COLORS.border};"><strong>${escapeHtml(u.account)}</strong></td><td style="padding:8px;border-bottom:1px solid ${OFG_COLORS.border};">${money(u.limit)}</td><td style="padding:8px;border-bottom:1px solid ${OFG_COLORS.border};">${money(u.balance)}</td><td style="padding:8px;border-bottom:1px solid ${OFG_COLORS.border};color:${utilColor(u.pctUsed)};font-weight:bold;">${u.pctUsed}%</td><td style="padding:8px;border-bottom:1px solid ${OFG_COLORS.border};">${money(u.payTo30)}</td><td style="padding:8px;border-bottom:1px solid ${OFG_COLORS.border};">${money(u.payTo10)}</td></tr>`,
    )
    .join("");
}

function buildActionPlanHtml(
  actions: Array<{ time: string; action: string; reason: string }>,
): string {
  return actions
    .map(
      (a) =>
        `<tr><td style="padding:10px;border-bottom:1px solid ${OFG_COLORS.border};font-weight:bold;white-space:nowrap;background:${OFG_COLORS.navy};color:${OFG_COLORS.gold};">${escapeHtml(a.time)}</td><td style="padding:10px;border-bottom:1px solid ${OFG_COLORS.border};font-weight:bold;color:${OFG_COLORS.foreground};">${escapeHtml(a.action)}</td><td style="padding:10px;border-bottom:1px solid ${OFG_COLORS.border};color:${OFG_COLORS.muted};font-size:13px;">${escapeHtml(a.reason)}</td></tr>`,
    )
    .join("");
}

function lendingConversion(
  kind: GoalKind,
  scores: AnalystScores,
  mid: number | null,
  delta: number,
  t: TFn,
): {
  fha_status: string;
  goal_score: number;
  goal_description: string;
  mortgage_tu: number | null;
  mortgage_ex: number | null;
  mortgage_eq: number | null;
  lendingMid: number | null;
} {
  const convert = (s: number | null, bump: number) =>
    s == null ? null : clampScore(s - (delta + bump));

  if (kind === "fha" || kind === "conventional" || kind === "jumbo") {
    const mortgage_tu = convert(scores.transunion, 5); // ~FICO 4
    const mortgage_ex = convert(scores.experian, 0); // ~FICO 2
    const mortgage_eq = convert(scores.equifax, 8); // ~FICO 5
    const lendingMid = computeMiddleScore({
      transunion: mortgage_tu,
      experian: mortgage_ex,
      equifax: mortgage_eq,
    });
    const m = lendingMid ?? mid ?? 0;

    if (kind === "fha") {
      let status: string;
      if (m >= 580)
        status = t(
          "FHA Eligible (3.5% down path) — focus on rate optimization",
          "Elegible FHA (enganche 3.5%) — enfocarse en optimizar tasa",
        );
      else if (m >= 500)
        status = t(
          "FHA possible with 10% down (500–579) — strengthen mid score toward 580+",
          "FHA posible con 10% de enganche (500–579) — fortalecer puntaje medio hacia 580+",
        );
      else
        status = t(
          "Below typical FHA thresholds — prioritize score repair before application",
          "Por debajo de umbrales FHA típicos — priorizar reparación antes de aplicar",
        );
      return {
        fha_status: status,
        goal_score: Math.max(620, Math.min(680, nextTierGoal(m))),
        goal_description: t(
          "Target mortgage mid score typically 620–680 for stronger FHA pricing",
          "Meta de puntaje hipotecario medio típicamente 620–680 para mejor precio FHA",
        ),
        mortgage_tu,
        mortgage_ex,
        mortgage_eq,
        lendingMid,
      };
    }

    if (kind === "conventional") {
      const ok = m >= 620;
      return {
        fha_status: t(
          `Conventional Loan Eligibility: ${ok ? "Eligible at minimum — ideal 740+" : "Below 620 minimum — repair needed"}`,
          `Elegibilidad Hipoteca Convencional: ${ok ? "Elegible al mínimo — ideal 740+" : "Bajo el mínimo 620 — se necesita reparación"}`,
        ),
        goal_score: Math.max(
          680,
          Math.min(740, nextTierGoal(Math.max(m, 620))),
        ),
        goal_description: t(
          "Conventional programs typically need 620+; best pricing near 740+",
          "Programas convencionales suelen requerir 620+; mejor precio cerca de 740+",
        ),
        mortgage_tu,
        mortgage_ex,
        mortgage_eq,
        lendingMid,
      };
    }

    // jumbo
    const ok = m >= 700;
    return {
      fha_status: t(
        `Jumbo Loan Eligibility: ${ok ? "Meets common 700+ floor — ideal 740+" : "Below typical 700 Jumbo floor"}`,
        `Elegibilidad Préstamo Jumbo: ${ok ? "Cumple piso común 700+ — ideal 740+" : "Bajo el piso típico Jumbo de 700"}`,
      ),
      goal_score: Math.max(720, Math.min(760, nextTierGoal(Math.max(m, 700)))),
      goal_description: t(
        "Jumbo underwriting commonly looks for 700+, with 740+ preferred",
        "Suscripción Jumbo suele buscar 700+, con preferencia 740+",
      ),
      mortgage_tu,
      mortgage_ex,
      mortgage_eq,
      lendingMid,
    };
  }

  if (kind === "auto") {
    const autoDelta = Math.min(30, Math.max(10, Math.round(delta * 0.55)));
    const mortgage_tu =
      scores.transunion == null
        ? null
        : clampScore(scores.transunion - autoDelta + 2);
    const mortgage_ex =
      scores.experian == null ? null : clampScore(scores.experian - autoDelta);
    const mortgage_eq =
      scores.equifax == null
        ? null
        : clampScore(scores.equifax - autoDelta - 2);
    const lendingMid = computeMiddleScore({
      transunion: mortgage_tu,
      experian: mortgage_ex,
      equifax: mortgage_eq,
    });
    const m = lendingMid ?? mid ?? 0;
    const tier = autoTier(m);
    return {
      fha_status: t(
        `Auto Financing Tier: ${tier.tier} — ${tier.label}`,
        `Nivel Financiamiento Auto: ${tier.tier} — ${tier.label}`,
      ),
      goal_score: m < 660 ? 660 : m < 720 ? 720 : Math.min(760, m + 20),
      goal_description: t(
        "Auto lending scores often differ 10–30 pts from FICO 8; Tier 1 starts at 720+",
        "Puntajes auto suelen diferir 10–30 pts del FICO 8; Tier 1 inicia en 720+",
      ),
      mortgage_tu,
      mortgage_ex,
      mortgage_eq,
      lendingMid,
    };
  }

  if (kind === "business") {
    const m = mid ?? 0;
    let status: string;
    if (m >= 680)
      status = t(
        "Business Funding Eligibility: Strong for SBA / lines of credit",
        "Elegibilidad Financiamiento Empresarial: Fuerte para SBA / líneas de crédito",
      );
    else if (m >= 650)
      status = t(
        "Business Funding Eligibility: Possible for some SBA programs; strengthen toward 680+",
        "Elegibilidad Financiamiento Empresarial: Posible en algunos programas SBA; fortalecer hacia 680+",
      );
    else if (m >= 600)
      status = t(
        "Business Funding Eligibility: Some term loans possible; SBA/LOC prefer 680+",
        "Elegibilidad Financiamiento Empresarial: Algunos préstamos a plazo posibles; SBA/LOC prefieren 680+",
      );
    else
      status = t(
        "Business Funding Eligibility: Below common lender floors — prioritize personal FICO 8 repair",
        "Elegibilidad Financiamiento Empresarial: Bajo pisos comunes — priorizar reparación de FICO 8 personal",
      );
    return {
      fha_status: status,
      goal_score: Math.max(680, Math.min(720, nextTierGoal(m || 600))),
      goal_description: t(
        "Most business lenders use personal FICO 8 or SBSS; 680+ preferred",
        "La mayoría de prestamistas usan FICO 8 personal o SBSS; se prefiere 680+",
      ),
      mortgage_tu: scores.transunion,
      mortgage_ex: scores.experian,
      mortgage_eq: scores.equifax,
      lendingMid: mid,
    };
  }

  // general
  const m = mid ?? 0;
  const band = scoreBandLabel(m) || "FAIR";
  return {
    fha_status: t(
      `General Credit Health: ${band}`,
      `Salud Crediticia General: ${band}`,
    ),
    goal_score: nextTierGoal(m || 580),
    goal_description: t(
      "Focus on overall credit health and the next score tier",
      "Enfocarse en la salud crediticia general y el siguiente nivel de puntaje",
    ),
    mortgage_tu: scores.transunion,
    mortgage_ex: scores.experian,
    mortgage_eq: scores.equifax,
    lendingMid: mid,
  };
}

function timelineLabel(kind: GoalKind, t: TFn): string {
  if (kind === "auto")
    return t("Auto lending score progression", "Progresión puntaje auto");
  if (kind === "business")
    return t(
      "Business lending score progression",
      "Progresión puntaje financiamiento empresarial",
    );
  if (kind === "general")
    return t("Credit score progression", "Progresión del puntaje de crédito");
  return t(
    "Mortgage mid score progression",
    "Progresión puntaje hipotecario medio",
  );
}

function buildFileStrength(
  kind: GoalKind,
  util: AnalystUtilRow[],
  text: string,
  ranked: RankedNeg[],
  scores: AnalystScores,
  t: TFn,
): {
  labels: [string, string, string, string, string];
  values: [string, string, string, string, string];
  total: number;
  rating: string;
  tradelineNeeded: boolean;
  tradelineRec: string;
} {
  const openRev = countOpenRevolving(util, text);
  let fs1 = 0;
  let n1 = "";
  if (openRev >= 3) {
    fs1 = 20;
    n1 = t("3+ open bank cards / low util", "3+ tarjetas abiertas / util baja");
  } else if (openRev >= 1) {
    fs1 = 10;
    n1 = t("1–2 open revolving", "1–2 revolving abiertas");
  } else {
    fs1 = 0;
    n1 = t("no open bank revolving", "sin revolving bancario abierto");
  }

  const types =
    (util.length > 0 || /credit card|revolving/i.test(text) ? 1 : 0) +
    (/installment|student|personal loan/i.test(text) ? 1 : 0) +
    (hasAuto(text) ? 1 : 0) +
    (hasMortgage(text) ? 1 : 0);
  let fs2 = 10;
  let n2 = t("1 account type", "1 tipo de cuenta");
  if (types >= 3) {
    fs2 = 20;
    n2 = t("revolving + installment + auto", "revolving + installment + auto");
  } else if (types === 2) {
    fs2 = 15;
    n2 = t("2 account types", "2 tipos de cuenta");
  }

  let label3 = "";
  let fs3 = 0;
  let n3 = "";
  if (kind === "fha" || kind === "conventional" || kind === "jumbo") {
    label3 = t("Mortgage History", "Historial Hipotecario");
    if (hasMortgage(text)) {
      fs3 = 20;
      n3 = t("active mortgage on file", "hipoteca activa en archivo");
    } else {
      fs3 = 0;
      n3 = t(
        "no mortgage (expected for new buyers)",
        "sin hipoteca (esperado en compradores nuevos)",
      );
    }
  } else if (kind === "auto") {
    label3 = t("Auto Loan History", "Historial de Auto");
    if (/paid as agreed|never late/i.test(text) && hasAuto(text)) {
      fs3 = 20;
      n3 = t("prior auto loan paid on time", "auto previo pagado a tiempo");
    } else if (hasAuto(text)) {
      fs3 = 10;
      n3 = t("current auto loan", "auto actual");
    } else {
      fs3 = 0;
      n3 = t("no auto history", "sin historial de auto");
    }
  } else if (kind === "business") {
    label3 = t("Business Credit Lines", "Líneas de Crédito Empresarial");
    if (hasBusinessLine(text)) {
      fs3 = 20;
      n3 = t("business credit line on file", "línea empresarial en archivo");
    } else if (util.length > 0 || /credit card/i.test(text)) {
      fs3 = 10;
      n3 = t("personal lines only", "solo líneas personales");
    } else {
      fs3 = 0;
      n3 = t("none", "ninguna");
    }
  } else {
    label3 = t("Account Diversity", "Diversidad de Cuentas");
    const div =
      (hasMortgage(text) ? 1 : 0) +
      (hasAuto(text) ? 1 : 0) +
      (util.length > 0 || /credit card/i.test(text) ? 1 : 0);
    if (div >= 3) {
      fs3 = 20;
      n3 = t("mortgage + auto + cards", "hipoteca + auto + tarjetas");
    } else if (div === 2) {
      fs3 = 15;
      n3 = t("2 types", "2 tipos");
    } else if (div === 1) {
      fs3 = 10;
      n3 = t("1 type", "1 tipo");
    } else {
      fs3 = 5;
      n3 = t("thin file", "archivo delgado");
    }
  }

  const age = estimateAccountAgeYears(text);
  let fs4 = 5;
  let n4 = t("under 2 years", "menos de 2 años");
  if (age >= 7) {
    fs4 = 20;
    n4 = t("7+ years", "7+ años");
  } else if (age >= 3) {
    fs4 = 12;
    n4 = t("3–6 years", "3–6 años");
  }

  const remain = Math.min(ranked.length, 5);
  let fs5 = 20;
  let n5 = t("none expected after repair", "ninguno esperado tras reparación");
  if (remain >= 3) {
    fs5 = 5;
    n5 = t("3+ may remain", "3+ pueden permanecer");
  } else if (remain >= 1) {
    fs5 = 10;
    n5 = t("1–2 may remain", "1–2 pueden permanecer");
  }

  const total = fs1 + fs2 + fs3 + fs4 + fs5;
  let rating = "WEAK";
  if (total >= 80) rating = "STRONG";
  else if (total >= 60) rating = "GOOD";
  else if (total >= 40) rating = "MODERATE";

  const exNull = scores.experian == null;
  const tradelineNeeded =
    openRev === 0 ||
    exNull ||
    openRev + (hasInstallment(text) ? 1 : 0) < 2 ||
    age < 2 ||
    (text.match(/\baccount\b/gi) || []).length < 4;

  const tradelineRec = tradelineNeeded
    ? t(
        "Authorized-user / seasoned tradeline support may help deepen thin areas of the file after disputes begin.",
        "Una tradeline autorizada / sazonada puede ayudar a fortalecer áreas delgadas del archivo tras iniciar disputas.",
      )
    : t(
        "File depth looks adequate — prioritize disputes and utilization before adding tradelines.",
        "La profundidad del archivo parece adecuada — priorizar disputas y utilización antes de agregar tradelines.",
      );

  return {
    labels: [
      t(
        "Open Revolving Accounts (3+ needed)",
        "Cuentas Revolving Abiertas (se necesitan 3+)",
      ),
      t("Credit Mix", "Mezcla de Crédito"),
      label3,
      t("Account Age", "Antigüedad de Cuentas"),
      t("Negative Items Post-Repair", "Ítems Negativos Post-Reparación"),
    ],
    values: [
      fsFormat(fs1, 20, n1),
      fsFormat(fs2, 20, n2),
      fsFormat(fs3, 20, n3),
      fsFormat(fs4, 20, n4),
      fsFormat(fs5, 20, n5),
    ],
    total,
    rating,
    tradelineNeeded,
    tradelineRec,
  };
}

function bullet(items: string[]): string {
  return items.map((i) => `★ ${i}`).join("\n");
}

export function runCreditAnalysisAlgorithm(
  input: CreditAnalysisAlgorithmInput,
): CreditAnalysisAnalystFlat {
  const lang = resolveTextLanguage(input.language, input.lastName);
  const t = makeT(lang);
  const goalRaw =
    (input.clientGoal || "").trim() ||
    t("General Improvement", "Mejora General");
  const goalKind = classifyGoalKind(input.clientGoal);
  const scores = input.scores;
  const mid = computeMiddleScore(scores);
  const util =
    input.utilization ?? extractUtilizationFromText(input.reportText || "");
  const ranked = [...input.negatives.map(rankNegativeItem)].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  );
  for (const n of ranked) {
    n.dispute_basis = localizeDisputeBasis(n.dispute_basis, lang);
  }

  const delta = adjustmentFactors(util, ranked, input.reportText || "");
  const lending = lendingConversion(goalKind, scores, mid, delta, t);
  const lendingToday = lending.lendingMid ?? mid;

  const totalLimit = util.reduce((s, u) => s + u.limit, 0);
  const totalBal = util.reduce((s, u) => s + u.balance, 0);
  const totalPct =
    totalLimit > 0 ? Math.round((totalBal / totalLimit) * 100) : 0;
  const topUtil = [...util].sort((a, b) => b.pctUsed - a.pctUsed).slice(0, 3);

  const goalScore = lending.goal_score;
  const today = lendingToday;
  const gapToGoal = today != null ? Math.max(0, goalScore - today) : goalScore;
  const score_30 =
    today == null
      ? null
      : clampScore(today + Math.min(25, Math.round(gapToGoal * 0.2)));
  const score_60 =
    today == null
      ? null
      : clampScore(today + Math.min(45, Math.round(gapToGoal * 0.45)));
  const score_90 =
    today == null
      ? null
      : clampScore(today + Math.min(70, Math.round(gapToGoal * 0.7)));
  const score_target =
    today == null ? goalScore : clampScore(Math.min(goalScore, score_90! + 15));

  const top5 = ranked.slice(0, 5);
  const negSlots = [0, 1, 2, 3, 4].map((i) => top5[i] || null);

  const utilSlots = [0, 1, 2].map((i) => topUtil[i] || null);

  const fs = buildFileStrength(
    goalKind,
    util,
    input.reportText || "",
    ranked,
    scores,
    t,
  );

  const topNames = top5.map((n) => n.account).filter(Boolean);
  const round1 = bullet(
    [
      topNames[0]
        ? t(
            `Dispute ${topNames[0]} (${top5[0]?.priority}) with all reporting bureaus`,
            `Disputar ${topNames[0]} (${top5[0]?.priority}) con todas las agencias`,
          )
        : t(
            "Audit personal info & freeze unauthorized inquiries",
            "Auditar info personal y congelar consultas no autorizadas",
          ),
      topNames[1]
        ? t(
            `Package documentation for ${topNames[1]}`,
            `Preparar documentación para ${topNames[1]}`,
          )
        : t(
            "Pull method-of-verification requests for top derogatories",
            "Solicitar método de verificación de los principales negativos",
          ),
      t(
        "Keep all open accounts current — no new late marks",
        "Mantener todas las cuentas al corriente — sin nuevos atrasos",
      ),
    ].slice(0, 4),
  );

  const round2 = bullet([
    t(
      "Follow up Round 1 disputes; escalate inconsistent bureau responses",
      "Seguimiento de disputas Ronda 1; escalar respuestas inconsistentes",
    ),
    topNames[2]
      ? t(
          `Second-wave dispute on ${topNames[2]}`,
          `Segunda ola de disputa sobre ${topNames[2]}`,
        )
      : t(
          "Re-dispute remaining HIGH items with fresh evidence",
          "Redisputar ítems HIGH restantes con evidencia nueva",
        ),
    totalPct > 30
      ? t(
          "Re-check revolving utilization after paydown progress",
          "Revisar utilización revolving tras avances de pago",
        )
      : t(
          "Protect positive accounts — do not close oldest cards",
          "Proteger cuentas positivas — no cerrar las tarjetas más antiguas",
        ),
  ]);

  const round3 = bullet([
    t(
      "Final challenge on stubborn negatives still reporting",
      "Desafío final a negativos persistentes que siguen reportando",
    ),
    t(
      "Confirm deletions/updates across TU, EX, and EQ",
      "Confirmar eliminaciones/actualizaciones en TU, EX y EQ",
    ),
    fs.tradelineNeeded
      ? t(
          "Evaluate seasoned tradeline if file still thin for goal",
          "Evaluar tradeline sazonada si el archivo sigue delgado para la meta",
        )
      : t(
          "Lock in utilization under 10–30% before funding applications",
          "Fijar utilización bajo 10–30% antes de solicitudes de financiamiento",
        ),
  ]);

  const actions = [
    {
      time: t("WEEK 1", "SEMANA 1"),
      action: t(
        "Complete credit analysis review & dispute intake",
        "Completar revisión del análisis e ingreso de disputas",
      ),
      reason: t(
        "Establish accurate baseline and priority queue",
        "Establecer línea base precisa y cola de prioridades",
      ),
    },
    {
      time: t("WEEK 1–2", "SEMANA 1–2"),
      action: t(
        "File Round 1 disputes on CRITICAL/HIGH items",
        "Presentar disputas Ronda 1 en ítems CRITICAL/HIGH",
      ),
      reason: t(
        "Highest-impact negatives move first",
        "Los negativos de mayor impacto se atienden primero",
      ),
    },
    {
      time: t("MONTH 1", "MES 1"),
      action:
        totalPct > 30
          ? t(
              "Lower revolving utilization toward 30%",
              "Bajar utilización revolving hacia 30%",
            )
          : t(
              "Hold utilization at or under 30%",
              "Mantener utilización en o bajo 30%",
            ),
      reason: t(
        "Utilization is a fast-moving FICO lever",
        "La utilización es una palanca FICO de movimiento rápido",
      ),
    },
    {
      time: t("MONTH 2", "MES 2"),
      action: t(
        "Round 2 follow-ups + bureau consistency checks",
        "Seguimientos Ronda 2 + chequeos de consistencia entre agencias",
      ),
      reason: t(
        "Catch metro 2 mismatches and incomplete deletions",
        "Detectar inconsistencias metro 2 y eliminaciones incompletas",
      ),
    },
    {
      time: t("MONTH 2–3", "MES 2–3"),
      action: t(
        "Round 3 + goal-specific readiness check",
        "Ronda 3 + revisión de preparación según la meta",
      ),
      reason: lending.goal_description,
    },
    {
      time: t("MONTH 3+", "MES 3+"),
      action: fs.tradelineNeeded
        ? t(
            "Consider file-strength options (tradeline / mix)",
            "Considerar opciones de fortaleza (tradeline / mezcla)",
          )
        : t(
            "Re-score & prepare lending application package",
            "Re-puntuar y preparar paquete de solicitud de financiamiento",
          ),
      reason: t(
        "Align timing with goal score and lender guidelines",
        "Alinear el momento con el puntaje meta y guías del prestamista",
      ),
    },
  ];

  const positives =
    input.positiveAccounts && input.positiveAccounts.length
      ? input.positiveAccounts.slice(0, 5).join("; ")
      : t(
          "Keep oldest revolving accounts open and paid as agreed.",
          "Mantener abiertas las revolving más antiguas y pagadas según acuerdo.",
        );

  const rep =
    (input.repName || "").trim() ||
    t("Your Optimum Advisor", "Tu Asesor Optimum");
  const premium =
    "https://www.optimum-financial-group.com/premium-plan-payment";

  let line1: string;
  let line2: string;
  if (goalKind === "auto") {
    line1 = t(
      `Hi ${input.firstName}, your estimated auto lending mid score is ${lendingToday ?? "—"}.`,
      `Hola ${input.firstName}, tu puntaje medio estimado de auto es ${lendingToday ?? "—"}.`,
    );
    line2 = lending.fha_status;
  } else if (goalKind === "business") {
    line1 = t(
      `Hi ${input.firstName}, your business lending score (personal FICO 8 mid) is ${lendingToday ?? "—"}.`,
      `Hola ${input.firstName}, tu puntaje de financiamiento empresarial (FICO 8 medio) es ${lendingToday ?? "—"}.`,
    );
    line2 = lending.fha_status;
  } else if (goalKind === "general") {
    line1 = t(
      `Hi ${input.firstName}, your current mid score is ${mid ?? "—"}.`,
      `Hola ${input.firstName}, tu puntaje medio actual es ${mid ?? "—"}.`,
    );
    line2 = t(
      `There's clear room to climb toward ${goalScore} with a focused dispute plan.`,
      `Hay un claro margen para subir hacia ${goalScore} con un plan de disputas enfocado.`,
    );
  } else {
    line1 = t(
      `Hi ${input.firstName}, your estimated mortgage mid score is ${lendingToday ?? "—"}.`,
      `Hola ${input.firstName}, tu puntaje hipotecario medio estimado es ${lendingToday ?? "—"}.`,
    );
    line2 = lending.fha_status;
  }
  const line3 = t(
    `When you're ready, start here: ${premium}`,
    `Cuando estés listo, comienza aquí: ${premium}`,
  );
  const client_text_message = `${line1} ${line2}\n${line3}\n- ${rep} | Optimum Financial Group`;

  const utilNote =
    totalPct > 50
      ? t(
          "Utilization is elevated — paying revolving balances down is one of the fastest score levers.",
          "La utilización está elevada — bajar saldos revolving es una de las palancas más rápidas.",
        )
      : totalPct > 30
        ? t(
            "Utilization is above the ideal 30% band on one or more cards.",
            "La utilización está por encima del rango ideal del 30% en una o más tarjetas.",
          )
        : t(
            "Revolving utilization looks manageable — protect it while disputes run.",
            "La utilización revolving se ve manejable — protégela mientras corren las disputas.",
          );

  const gap = (s: number | null) =>
    s == null || goalScore == null ? null : Math.max(0, goalScore - s);

  const out: CreditAnalysisAnalystFlat = {
    client_name: input.clientName,
    analysis_goal: goalRaw,
    report_date: input.reportDate || new Date().toISOString().slice(0, 10),
    referral_name: "Optimum Financial Group",
    referral_company: "Optimum Financial Group",

    score_transunion: scores.transunion,
    score_experian: scores.experian,
    score_equifax: scores.equifax,
    score_tu_label: scoreBandLabel(scores.transunion),
    score_ex_label: scoreBandLabel(scores.experian),
    score_eq_label: scoreBandLabel(scores.equifax),
    middle_score: mid,
    fha_status: lending.fha_status,
    goal_score: goalScore,
    goal_description: lending.goal_description,
    gap_tu: gap(lending.mortgage_tu ?? scores.transunion),
    gap_ex: gap(lending.mortgage_ex ?? scores.experian),
    gap_eq: gap(lending.mortgage_eq ?? scores.equifax),

    neg_1_account: negSlots[0]?.account || "",
    neg_1_type: negSlots[0]?.type || "",
    neg_1_bureaus: negSlots[0]?.bureaus || "",
    neg_1_priority: negSlots[0]?.priority || "",
    neg_1_dispute_basis: negSlots[0]?.dispute_basis || "",
    neg_2_account: negSlots[1]?.account || "",
    neg_2_type: negSlots[1]?.type || "",
    neg_2_bureaus: negSlots[1]?.bureaus || "",
    neg_2_priority: negSlots[1]?.priority || "",
    neg_2_dispute_basis: negSlots[1]?.dispute_basis || "",
    neg_3_account: negSlots[2]?.account || "",
    neg_3_type: negSlots[2]?.type || "",
    neg_3_bureaus: negSlots[2]?.bureaus || "",
    neg_3_priority: negSlots[2]?.priority || "",
    neg_3_dispute_basis: negSlots[2]?.dispute_basis || "",
    neg_4_account: negSlots[3]?.account || "",
    neg_4_type: negSlots[3]?.type || "",
    neg_4_bureaus: negSlots[3]?.bureaus || "",
    neg_4_priority: negSlots[3]?.priority || "",
    neg_4_dispute_basis: negSlots[3]?.dispute_basis || "",
    neg_5_account: negSlots[4]?.account || "",
    neg_5_type: negSlots[4]?.type || "",
    neg_5_bureaus: negSlots[4]?.bureaus || "",
    neg_5_priority: negSlots[4]?.priority || "",
    neg_5_dispute_basis: negSlots[4]?.dispute_basis || "",

    utilization_critical_note: utilNote,
    util_1_account: utilSlots[0]?.account || "",
    util_1_limit: utilSlots[0] ? money(utilSlots[0].limit) : "",
    util_1_balance: utilSlots[0] ? money(utilSlots[0].balance) : "",
    util_1_percent: utilSlots[0] ? `${utilSlots[0].pctUsed}%` : "",
    util_1_pay30: utilSlots[0] ? money(utilSlots[0].payTo30) : "",
    util_1_pay10: utilSlots[0] ? money(utilSlots[0].payTo10) : "",
    util_2_account: utilSlots[1]?.account || "",
    util_2_limit: utilSlots[1] ? money(utilSlots[1].limit) : "",
    util_2_balance: utilSlots[1] ? money(utilSlots[1].balance) : "",
    util_2_percent: utilSlots[1] ? `${utilSlots[1].pctUsed}%` : "",
    util_2_pay30: utilSlots[1] ? money(utilSlots[1].payTo30) : "",
    util_2_pay10: utilSlots[1] ? money(utilSlots[1].payTo10) : "",
    util_3_account: utilSlots[2]?.account || "",
    util_3_limit: utilSlots[2] ? money(utilSlots[2].limit) : "",
    util_3_balance: utilSlots[2] ? money(utilSlots[2].balance) : "",
    util_3_percent: utilSlots[2] ? `${utilSlots[2].pctUsed}%` : "",
    util_3_pay30: utilSlots[2] ? money(utilSlots[2].payTo30) : "",
    util_3_pay10: utilSlots[2] ? money(utilSlots[2].payTo10) : "",
    total_revolving_limit: money(totalLimit),
    total_revolving_balance: money(totalBal),
    total_revolving_util: `${totalPct}%`,
    paydown_30_instruction:
      totalPct > 30
        ? t(
            `Pay down about ${money(Math.max(0, totalBal - totalLimit * 0.3))} across revolving to reach ~30% util.`,
            `Abona aproximadamente ${money(Math.max(0, totalBal - totalLimit * 0.3))} en revolving para llegar a ~30% de util.`,
          )
        : t(
            "Already near or under 30% — maintain statement balances.",
            "Ya cerca o bajo 30% — mantén los saldos del estado de cuenta.",
          ),
    paydown_10_instruction:
      totalPct > 10
        ? t(
            `For stronger scoring, target ~10% util (~${money(Math.max(0, totalBal - totalLimit * 0.1))} paydown).`,
            `Para un puntaje más fuerte, apunta a ~10% util (~${money(Math.max(0, totalBal - totalLimit * 0.1))} de abono).`,
          )
        : t(
            "Utilization already near the 10% sweet spot.",
            "La utilización ya está cerca del punto ideal del 10%.",
          ),

    score_today: today,
    score_30_days: score_30,
    score_60_days: score_60,
    score_90_days: score_90,
    score_target,
    target_timeframe: `${timelineLabel(goalKind, t)} · ${t("≈ 90 days", "≈ 90 días")}`,

    round_1_actions: round1,
    round_2_actions: round2,
    round_3_actions: round3,
    positive_accounts_protect: positives,

    action_1_time: actions[0].time,
    action_1_action: actions[0].action,
    action_1_reason: actions[0].reason,
    action_2_time: actions[1].time,
    action_2_action: actions[1].action,
    action_2_reason: actions[1].reason,
    action_3_time: actions[2].time,
    action_3_action: actions[2].action,
    action_3_reason: actions[2].reason,
    action_4_time: actions[3].time,
    action_4_action: actions[3].action,
    action_4_reason: actions[3].reason,
    action_5_time: actions[4].time,
    action_5_action: actions[4].action,
    action_5_reason: actions[4].reason,
    action_6_time: actions[5].time,
    action_6_action: actions[5].action,
    action_6_reason: actions[5].reason,

    file_strength_score: fs.total,
    file_strength_rating: fs.rating,
    fs_label_1: fs.labels[0],
    fs_open_revolving: fs.values[0],
    fs_label_2: fs.labels[1],
    fs_installment_mix: fs.values[1],
    fs_label_3: fs.labels[2],
    fs_mortgage: fs.values[2],
    fs_label_4: fs.labels[3],
    fs_account_age: fs.values[3],
    fs_label_5: fs.labels[4],
    fs_post_repair: fs.values[4],
    tradeline_recommendation: fs.tradelineRec,

    negative_items_html: buildNegativeHtml(ranked),
    negative_count: ranked.length,
    critical_count: ranked.filter((n) => n.priority === "CRITICAL").length,
    high_count: ranked.filter((n) => n.priority === "HIGH").length,
    utilization_html: buildUtilHtml(util),
    action_plan_html: buildActionPlanHtml(actions),
    mortgage_tu: lending.mortgage_tu,
    mortgage_ex: lending.mortgage_ex,
    mortgage_eq: lending.mortgage_eq,
    tradeline_needed: fs.tradelineNeeded ? t("Yes", "Sí") : t("No", "No"),
    client_text_message,
    text_language: lang,
  };

  if (input.weakExtraction) {
    out.utilization_critical_note = t(
      "Limited PDF text extraction — scores and tables may be incomplete. Re-upload a text-based SmartCredit PDF for a full analysis.",
      "Extracción limitada del PDF — puntajes y tablas pueden estar incompletos. Sube un PDF de texto de SmartCredit para un análisis completo.",
    );
    out.fha_status = t(
      "Analysis limited — could not fully read the report",
      "Análisis limitado — no se pudo leer el informe por completo",
    );
  }

  return out;
}

/**
 * Rich HTML narrative for email + result panel (Optimum navy/gold styling).
 */
export function buildAnalystAnalysisHtml(opts: {
  firstName: string;
  analyst: CreditAnalysisAnalystFlat;
  weakExtraction?: boolean;
  croaDisclosure: string;
}): { html: string; text: string } {
  const a = opts.analyst;
  const isEs = a.text_language === "Spanish";
  const C = OFG_COLORS;

  if (opts.weakExtraction) {
    const html = `
      <h2 style="margin:0 0 12px;font-size:20px;font-weight:800;color:${C.foreground};">${isEs ? `Tu análisis de crédito, ${escapeHtml(opts.firstName)}` : `Your Credit Analysis, ${escapeHtml(opts.firstName)}`}</h2>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(a.utilization_critical_note)}</p>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">${opts.croaDisclosure}</p>
    `.trim();
    return {
      html,
      text: [
        isEs
          ? `Tu análisis de crédito, ${opts.firstName}`
          : `Your Credit Analysis, ${opts.firstName}`,
        a.utilization_critical_note,
        opts.croaDisclosure,
      ].join("\n\n"),
    };
  }

  const scoreRow = (label: string, score: number | null, band: string) =>
    `<td style="padding:12px;text-align:center;border:1px solid ${C.border};">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:${C.muted};text-transform:uppercase;">${label}</div>
      <div style="font-size:28px;font-weight:800;color:${C.navy};margin:6px 0;">${score ?? "—"}</div>
      <div style="font-size:11px;font-weight:700;color:${C.gold};">${escapeHtml(band || "—")}</div>
    </td>`;

  const html = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:${C.navy};">${isEs ? `Tu análisis de crédito, ${escapeHtml(opts.firstName)}` : `Your Credit Analysis, ${escapeHtml(opts.firstName)}`}</h2>
    <p style="margin:0 0 20px;font-size:14px;color:${C.muted};">${isEs ? "Meta" : "Goal"}: <strong style="color:${C.foreground};">${escapeHtml(a.analysis_goal)}</strong></p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;">
      <tr>
        ${scoreRow("TransUnion", a.score_transunion, a.score_tu_label)}
        ${scoreRow("Experian", a.score_experian, a.score_ex_label)}
        ${scoreRow("Equifax", a.score_equifax, a.score_eq_label)}
      </tr>
    </table>

    <div style="margin:0 0 20px;padding:16px;border-radius:12px;background:${C.cardBg};border:1px solid ${C.border};">
      <div style="font-size:12px;font-weight:700;color:${C.gold};letter-spacing:0.04em;text-transform:uppercase;margin-bottom:6px;">${isEs ? "Puntaje medio / meta" : "Mid score / goal"}</div>
      <p style="margin:0 0 8px;font-size:15px;color:#334155;"><strong style="color:${C.navy};font-size:22px;">${a.middle_score ?? "—"}</strong>
        → <strong style="color:${C.gold};">${a.goal_score}</strong></p>
      <p style="margin:0;font-size:14px;color:#334155;">${escapeHtml(a.fha_status)}</p>
      <p style="margin:8px 0 0;font-size:13px;color:${C.muted};">${escapeHtml(a.goal_description)}</p>
    </div>

    ${
      a.negative_count > 0
        ? `<h3 style="margin:0 0 8px;font-size:15px;font-weight:800;color:${C.navy};">${isEs ? "Ítems negativos (prioridad de disputa)" : "Negative items (dispute priority)"}</h3>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;font-size:13px;">
        <tr style="background:${C.navy};color:${C.gold};">
          <th style="padding:8px;text-align:left;">${isEs ? "Cuenta" : "Account"}</th>
          <th style="padding:8px;text-align:left;">${isEs ? "Tipo" : "Type"}</th>
          <th style="padding:8px;text-align:center;">${isEs ? "Agencias" : "Bureaus"}</th>
          <th style="padding:8px;text-align:center;">${isEs ? "Prioridad" : "Priority"}</th>
          <th style="padding:8px;text-align:left;">${isEs ? "Base" : "Basis"}</th>
        </tr>
        ${a.negative_items_html}
      </table>`
        : `<p style="margin:0 0 20px;font-size:14px;color:${C.utilOk};font-weight:600;">${isEs ? "No detectamos ítems negativos obvios." : "No obvious negative items detected."}</p>`
    }

    ${
      a.utilization_html
        ? `<h3 style="margin:0 0 8px;font-size:15px;font-weight:800;color:${C.navy};">${isEs ? "Utilización revolving" : "Revolving utilization"}</h3>
      <p style="margin:0 0 8px;font-size:13px;color:${C.muted};">${escapeHtml(a.utilization_critical_note)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border-collapse:collapse;font-size:13px;">
        <tr style="background:${C.cardBg};">
          <th style="padding:8px;text-align:left;">${isEs ? "Cuenta" : "Account"}</th>
          <th style="padding:8px;text-align:left;">${isEs ? "Límite" : "Limit"}</th>
          <th style="padding:8px;text-align:left;">${isEs ? "Saldo" : "Balance"}</th>
          <th style="padding:8px;text-align:left;">Util%</th>
          <th style="padding:8px;text-align:left;">→30%</th>
          <th style="padding:8px;text-align:left;">→10%</th>
        </tr>
        ${a.utilization_html}
      </table>
      <p style="margin:0 0 20px;font-size:12px;color:${C.muted};">${escapeHtml(a.total_revolving_util)} util · ${escapeHtml(a.paydown_30_instruction)}</p>`
        : ""
    }

    <h3 style="margin:0 0 8px;font-size:15px;font-weight:800;color:${C.navy};">${isEs ? "Línea de tiempo estimada" : "Estimated timeline"}</h3>
    <p style="margin:0 0 4px;font-size:13px;color:${C.muted};">${escapeHtml(a.target_timeframe)}</p>
    <p style="margin:0 0 20px;font-size:14px;color:#334155;">
      <strong>${a.score_today ?? "—"}</strong> → 30d <strong>${a.score_30_days ?? "—"}</strong> → 60d <strong>${a.score_60_days ?? "—"}</strong> → 90d <strong>${a.score_90_days ?? "—"}</strong> → ${isEs ? "meta" : "target"} <strong style="color:${C.gold};">${a.score_target ?? "—"}</strong>
    </p>

    <h3 style="margin:0 0 8px;font-size:15px;font-weight:800;color:${C.navy};">${isEs ? "Fortaleza del archivo" : "File strength"}: ${a.file_strength_score}/100 · ${escapeHtml(a.file_strength_rating)}</h3>
    <ul style="margin:0 0 20px;padding-left:18px;font-size:13px;color:#334155;line-height:1.7;">
      <li><strong>${escapeHtml(a.fs_label_1)}</strong> — ${escapeHtml(a.fs_open_revolving)}</li>
      <li><strong>${escapeHtml(a.fs_label_2)}</strong> — ${escapeHtml(a.fs_installment_mix)}</li>
      <li><strong>${escapeHtml(a.fs_label_3)}</strong> — ${escapeHtml(a.fs_mortgage)}</li>
      <li><strong>${escapeHtml(a.fs_label_4)}</strong> — ${escapeHtml(a.fs_account_age)}</li>
      <li><strong>${escapeHtml(a.fs_label_5)}</strong> — ${escapeHtml(a.fs_post_repair)}</li>
    </ul>

    <h3 style="margin:0 0 8px;font-size:15px;font-weight:800;color:${C.navy};">${isEs ? "Plan de acción" : "Action plan"}</h3>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;font-size:13px;">
      ${a.action_plan_html}
    </table>

    <div style="margin:0 0 16px;padding:14px;border-left:3px solid ${C.gold};background:${C.cardBg};">
      <div style="font-size:12px;font-weight:700;color:${C.navy};margin-bottom:6px;">${isEs ? "Mensaje para el cliente" : "Client message"}</div>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#334155;white-space:pre-wrap;">${escapeHtml(a.client_text_message)}</p>
    </div>

    <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">${opts.croaDisclosure}</p>
  `.trim();

  const text = [
    isEs
      ? `Tu análisis de crédito, ${opts.firstName}`
      : `Your Credit Analysis, ${opts.firstName}`,
    `Goal: ${a.analysis_goal}`,
    `TU ${a.score_transunion ?? "—"} (${a.score_tu_label}) · EX ${a.score_experian ?? "—"} (${a.score_ex_label}) · EQ ${a.score_equifax ?? "—"} (${a.score_eq_label})`,
    `Mid: ${a.middle_score ?? "—"} → Goal: ${a.goal_score}`,
    a.fha_status,
    a.goal_description,
    `Negatives: ${a.negative_count} (CRITICAL ${a.critical_count}, HIGH ${a.high_count})`,
    a.neg_1_account &&
      `${a.neg_1_priority}: ${a.neg_1_account} — ${a.neg_1_type}`,
    a.neg_2_account &&
      `${a.neg_2_priority}: ${a.neg_2_account} — ${a.neg_2_type}`,
    a.neg_3_account &&
      `${a.neg_3_priority}: ${a.neg_3_account} — ${a.neg_3_type}`,
    `Timeline: ${a.score_today} → ${a.score_30_days} → ${a.score_60_days} → ${a.score_90_days} → ${a.score_target}`,
    `File strength: ${a.file_strength_score}/100 ${a.file_strength_rating}`,
    a.client_text_message,
    opts.croaDisclosure,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}

// ============================================================================
// INFO REQUEST HELPERS (inline — Vercel serverless cannot import ../shared runtime modules)
// ============================================================================

type InfoRequestValidationError = {
  code: string;
  message: string;
  fieldKey?: string;
};

function isSensitiveInfoFieldType(type: string): boolean {
  return type === "password" || type === "smart_credit_block";
}

export function canClientSubmitInfoRequest(
  status: InfoRequestStatus | string,
): boolean {
  return status === "open" || status === "rejected";
}

export function isInfoRequestActionable(
  status: InfoRequestStatus | string,
): boolean {
  return status === "open" || status === "rejected";
}

export function countsTowardPipelineSoftWarn(
  status: InfoRequestStatus | string,
): boolean {
  return status === "open" || status === "submitted" || status === "rejected";
}

export function canAdminReviewInfoRequest(
  status: InfoRequestStatus | string,
): boolean {
  return status === "submitted";
}

export function canAdminCancelInfoRequest(
  status: InfoRequestStatus | string,
): boolean {
  return !["approved", "cancelled"].includes(String(status));
}

export function validateInfoRequestConsent(
  agreedTerms: boolean,
  agreedSms: boolean,
): InfoRequestValidationError | null {
  if (!agreedTerms || !agreedSms) {
    return {
      code: "consent_required",
      message: "You must agree to the Terms of Service and SMS Terms",
    };
  }
  return null;
}

export function parseInfoFieldsJson(raw: unknown): InfoRequestFieldDef[] {
  if (Array.isArray(raw)) return raw as InfoRequestFieldDef[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as InfoRequestFieldDef[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function parseInfoResponseJson(
  raw: unknown,
): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw))
    return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export function normalizeCardLast4(value: unknown): string {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(-4);
}

export function validateSmartCreditBlock(
  value: unknown,
  required: boolean,
): InfoRequestValidationError | null {
  const block =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const email = String(block.email || "").trim();
  const password = String(block.password || "");
  const security_question = String(block.security_question || "").trim();
  const security_answer = String(block.security_answer || "");

  if (
    !required &&
    !email &&
    !password &&
    !security_question &&
    !security_answer
  )
    return null;

  if (!email || !password || !security_question || !security_answer) {
    return {
      code: "smart_credit_incomplete",
      message: "Smart Credit email, password, and security Q&A are required",
    };
  }
  if (!email.includes("@")) {
    return {
      code: "smart_credit_email_invalid",
      message: "Smart Credit email looks invalid",
    };
  }
  return null;
}

export function validateBillingConfirm(
  value: unknown,
  required: boolean,
): InfoRequestValidationError | null {
  const block =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const last4 = normalizeCardLast4(block.card_last4);
  const filled =
    !!block.address_line1 ||
    !!block.city ||
    !!block.state ||
    !!block.postal_code ||
    !!last4;

  if (!required && !filled) return null;

  if (
    !String(block.address_line1 || "").trim() ||
    !String(block.city || "").trim() ||
    !String(block.state || "").trim() ||
    !String(block.postal_code || "").trim() ||
    last4.length !== 4
  ) {
    return {
      code: "billing_incomplete",
      message: "Billing confirmation fields are required",
    };
  }
  return null;
}

type PartitionedInfoResponses = {
  safeResponses: Record<string, unknown>;
  secrets: Record<string, unknown>;
  errors: InfoRequestValidationError[];
  requiresPaymentOpaque: boolean;
  requiresUploadKeys: string[];
};

export function partitionInfoRequestResponses(
  fields: InfoRequestFieldDef[],
  responses: Record<string, unknown>,
  opts: {
    hasPaymentOpaque?: boolean;
    uploadedFieldKeys?: Set<string>;
  } = {},
): PartitionedInfoResponses {
  const safeResponses: Record<string, unknown> = {};
  const secrets: Record<string, unknown> = {};
  const errors: InfoRequestValidationError[] = [];
  let requiresPaymentOpaque = false;
  const requiresUploadKeys: string[] = [];
  const uploaded = opts.uploadedFieldKeys ?? new Set<string>();

  for (const field of fields) {
    const key = String(field.key || "");
    if (!key) {
      errors.push({
        code: "field_key_missing",
        message: "Field definition is missing a key",
      });
      continue;
    }
    const type = String(field.type || "text");
    const required = !!field.required;
    const value = responses[key];

    if (type === "upload") {
      requiresUploadKeys.push(key);
      if (required && !uploaded.has(key)) {
        errors.push({
          code: "file_required",
          message: `File required for ${key}`,
          fieldKey: key,
        });
      }
      continue;
    }

    if (type === "payment_card") {
      requiresPaymentOpaque = true;
      if (required && !opts.hasPaymentOpaque) {
        errors.push({
          code: "card_required",
          message: "Card details are required",
          fieldKey: key,
        });
      } else if (opts.hasPaymentOpaque) {
        safeResponses[key] = { card_updated: true };
      }
      continue;
    }

    if (type === "smart_credit_block") {
      const err = validateSmartCreditBlock(value, required);
      if (err) {
        errors.push({ ...err, fieldKey: key });
        continue;
      }
      const block =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : {};
      const email = String(block.email || "").trim();
      if (email) {
        secrets[key] = {
          email,
          password: String(block.password || ""),
          security_question: String(block.security_question || "").trim(),
          security_answer: String(block.security_answer || ""),
        };
        safeResponses[key] = { email, credentials_received: true };
      }
      continue;
    }

    if (type === "billing_confirm") {
      const err = validateBillingConfirm(value, required);
      if (err) {
        errors.push({ ...err, fieldKey: key });
        continue;
      }
      const block =
        value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : {};
      if (
        String(block.address_line1 || "").trim() ||
        normalizeCardLast4(block.card_last4)
      ) {
        safeResponses[key] = {
          address_line1: String(block.address_line1 || "").trim(),
          address_line2: String(block.address_line2 || "").trim() || null,
          city: String(block.city || "").trim(),
          state: String(block.state || "").trim(),
          postal_code: String(block.postal_code || "").trim(),
          card_last4: normalizeCardLast4(block.card_last4),
        };
      }
      continue;
    }

    if (type === "password" || isSensitiveInfoFieldType(type)) {
      if (required && !String(value || "").trim()) {
        errors.push({
          code: "required",
          message: `${key} is required`,
          fieldKey: key,
        });
        continue;
      }
      if (value != null && String(value).length > 0) {
        secrets[key] = String(value);
        safeResponses[key] = { received: true };
      }
      continue;
    }

    if (required && (value == null || String(value).trim() === "")) {
      errors.push({
        code: "required",
        message: `${key} is required`,
        fieldKey: key,
      });
      continue;
    }
    if (value != null) safeResponses[key] = value;
  }

  return {
    safeResponses,
    secrets,
    errors,
    requiresPaymentOpaque,
    requiresUploadKeys,
  };
}

export function localizeInfoRequestCopy(
  row: {
    title_en: string;
    title_es: string;
    message_en?: string | null;
    message_es?: string | null;
  },
  lang: string,
): { title: string; message: string | null } {
  const isEs = lang === "es";
  return {
    title: isEs ? row.title_es : row.title_en,
    message: (isEs ? row.message_es : row.message_en) || null,
  };
}

export function validateCreateInfoRequestPayload(body: {
  title_en?: unknown;
  title_es?: unknown;
  fields_json?: unknown;
}): InfoRequestValidationError | null {
  if (
    !String(body.title_en ?? "").trim() ||
    !String(body.title_es ?? "").trim()
  ) {
    return {
      code: "titles_required",
      message: "title_en and title_es required",
    };
  }
  if (!Array.isArray(body.fields_json) || body.fields_json.length === 0) {
    return {
      code: "fields_required",
      message: "fields_json must be a non-empty array",
    };
  }
  const keys = new Set<string>();
  for (const f of body.fields_json as InfoRequestFieldDef[]) {
    const key = String(f?.key || "").trim();
    if (!key) {
      return {
        code: "field_key_missing",
        message: "Every field must have a key",
      };
    }
    if (keys.has(key)) {
      return {
        code: "duplicate_field_key",
        message: `Duplicate field key: ${key}`,
      };
    }
    keys.add(key);
  }
  return null;
}

// ============================================================================
// FRIENDLY API / DB ERRORS (never leak raw MySQL to clients)
// ============================================================================

function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; errno?: number };
  return (
    e?.code === "ER_DUP_ENTRY" ||
    e?.errno === 1062 ||
    String(e?.message || "").includes("Duplicate entry")
  );
}

function isForeignKeyError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; errno?: number };
  return (
    e?.code === "ER_NO_REFERENCED_ROW_2" ||
    e?.code === "ER_NO_REFERENCED_ROW" ||
    e?.code === "ER_ROW_IS_REFERENCED_2" ||
    e?.errno === 1451 ||
    e?.errno === 1452 ||
    String(e?.message || "")
      .toLowerCase()
      .includes("foreign key")
  );
}

/** Map known DB / validation errors to a safe client-facing response. */
function mapFriendlyError(
  err: unknown,
  context?: { duplicateLabel?: string },
): { status: number; error: string } | null {
  if (!err) return null;
  const e = err as { status?: number; message?: string; code?: string };
  if (typeof e.status === "number" && e.status >= 400 && e.status < 600) {
    return {
      status: e.status,
      error: String(e.message || "Request failed"),
    };
  }
  if (isDuplicateKeyError(err)) {
    const msg = String(e.message || "").toLowerCase();
    if (msg.includes("email") || context?.duplicateLabel === "email") {
      return {
        status: 409,
        error: "An account with this email already exists",
      };
    }
    if (msg.includes("slug") || context?.duplicateLabel === "slug") {
      return { status: 409, error: "This slug is already in use" };
    }
    if (msg.includes("code") || context?.duplicateLabel === "coupon") {
      return { status: 409, error: "This code already exists" };
    }
    if (msg.includes("case_number")) {
      return { status: 409, error: "Case number conflict — please retry" };
    }
    return {
      status: 409,
      error: context?.duplicateLabel
        ? `This ${context.duplicateLabel} already exists`
        : "This record already exists",
    };
  }
  if (isForeignKeyError(err)) {
    return {
      status: 400,
      error: "Related record not found or still in use",
    };
  }
  return null;
}

function sendFriendlyError(
  res: Response,
  err: unknown,
  context?: { duplicateLabel?: string; fallback?: string },
): boolean {
  const mapped = mapFriendlyError(err, context);
  if (mapped) {
    res.status(mapped.status).json({ error: mapped.error });
    return true;
  }
  return false;
}

// ============================================================================
// BULK CSV IMPORT — CLIENTS (inline — Vercel serverless, no runtime import
// from ../shared; helpers here parse/validate, ../shared/bulkImport.ts only
// has browser-side preview/report utilities)
// ============================================================================

const CLIENT_CSV_HEADERS: string[] = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "status",
  "preferred_language",
  "package_slug",
  "admin_notes",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "zip",
  "date_of_birth",
  "external_ref",
];
const CLIENT_CSV_REQUIRED_HEADERS: string[] = [
  "first_name",
  "last_name",
  "email",
];
const CLIENT_CSV_ALLOWED_STATUS: string[] = [
  "pending_payment",
  "onboarding",
  "active",
  "paused",
  "cancelled",
];
const CLIENT_CSV_ALLOWED_LANGUAGE: string[] = ["en", "es"];
const BULK_IMPORT_MAX_ROWS = 500;
const BULK_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const BULK_IMPORT_JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
const BULK_IMPORT_FORBIDDEN_COLUMNS: string[] = [
  "password",
  "password_hash",
  "ssn",
  "social_security",
];

/** Off by default in production unless explicitly enabled. */
function resolveBulkCsvImportEnabled(): boolean {
  if (process.env.BULK_CSV_IMPORT_ENABLED === "0") return false;
  if (process.env.NODE_ENV === "production") {
    return (
      process.env.BULK_CSV_IMPORT_ENABLED === "1" ||
      process.env.BULK_CSV_IMPORT_ALLOW_PRODUCTION === "1"
    );
  }
  return true;
}

function sanitizeCsvCell(value: string | null | undefined): string {
  if (value == null) return "";
  // eslint-disable-next-line no-control-regex
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
}

function normalizePhoneLast10(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDateIso(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const US_STATE_ABBR: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

/** Best-effort normalization to a 2-letter US state code; falls back to the raw input. */
function normalizeUsState(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const abbr = US_STATE_ABBR[raw.toLowerCase()];
  return abbr || raw.slice(0, 50);
}

/** Minimal RFC4180 CSV tokenizer (handles quoted fields, escaped quotes, CRLF/LF). */
function tokenizeCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyField = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAnyField = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      sawAnyField = true;
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnyField = false;
      continue;
    }
    field += c;
    sawAnyField = true;
  }
  if (sawAnyField || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

interface ParsedBulkCsv {
  headers: string[];
  rows: string[][];
  error?: string;
}

/** Parses + validates a client-import CSV against CLIENT_CSV_HEADERS (BOM/quotes/# comment rows). */
function parseBulkCsv(text: string): ParsedBulkCsv {
  const allRows = tokenizeCsv(text).filter(
    (r) => !(r.length <= 1 && (r[0] ?? "").trim() === ""),
  );
  const dataLines = allRows.filter((r) => !(r[0] ?? "").trim().startsWith("#"));
  if (dataLines.length === 0) {
    return { headers: [], rows: [], error: "CSV file is empty" };
  }
  const headerRow = dataLines[0].map((h) => sanitizeCsvCell(h).toLowerCase());
  const forbidden = headerRow.filter((h) =>
    BULK_IMPORT_FORBIDDEN_COLUMNS.includes(h),
  );
  if (forbidden.length > 0) {
    return {
      headers: headerRow,
      rows: [],
      error: `Forbidden column(s): ${forbidden.join(", ")}`,
    };
  }
  const unknown = headerRow.filter((h) => !CLIENT_CSV_HEADERS.includes(h));
  if (unknown.length > 0) {
    return {
      headers: headerRow,
      rows: [],
      error: `Unknown column(s): ${unknown.join(", ")}. Allowed columns: ${CLIENT_CSV_HEADERS.join(", ")}`,
    };
  }
  const missingRequired = CLIENT_CSV_REQUIRED_HEADERS.filter(
    (h) => !headerRow.includes(h),
  );
  if (missingRequired.length > 0) {
    return {
      headers: headerRow,
      rows: [],
      error: `Missing required column(s): ${missingRequired.join(", ")}`,
    };
  }
  return { headers: headerRow, rows: dataLines.slice(1) };
}

interface OptimumClientImportRow {
  row_number: number;
  external_ref: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  normalized_phone: string | null;
  client_status: string;
  preferred_language: string;
  package_slug: string | null;
  package_id: number | null;
  admin_notes: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  date_of_birth: string | null;
  import_status: "will_create" | "skipped" | "error";
  message?: string;
  conflict_client_id?: number | null;
}

interface BulkImportPreviewRow {
  row_number: number;
  status: "will_create" | "skipped" | "error";
  message?: string;
  external_ref: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  badge: string | null;
  conflict_entity_id: number | null;
}

/** Recomputes counts + UI preview rows from the current row states (call after any bulk mutation). */
function rebuildOptimumClientPreview(rows: OptimumClientImportRow[]): {
  preview_rows: BulkImportPreviewRow[];
  row_count: number;
  will_create_count: number;
  skipped_count: number;
  error_count: number;
} {
  const will_create_count = rows.filter(
    (r) => r.import_status === "will_create",
  ).length;
  const skipped_count = rows.filter(
    (r) => r.import_status === "skipped",
  ).length;
  const error_count = rows.filter((r) => r.import_status === "error").length;
  const preview_rows: BulkImportPreviewRow[] = rows.map((r) => ({
    row_number: r.row_number,
    status: r.import_status,
    message: r.message,
    external_ref: r.external_ref,
    display_name:
      `${r.first_name} ${r.last_name}`.trim() ||
      r.email ||
      `Row ${r.row_number}`,
    email: r.email || null,
    phone: r.phone,
    badge: r.client_status || r.package_slug || null,
    conflict_entity_id: r.conflict_client_id ?? null,
  }));
  return {
    preview_rows,
    row_count: rows.length,
    will_create_count,
    skipped_count,
    error_count,
  };
}

/** Field-level validation + within-file duplicate detection (no DB access). */
function validateOptimumClientRows(
  headers: string[],
  dataRows: string[][],
): { rows: OptimumClientImportRow[] } & ReturnType<
  typeof rebuildOptimumClientPreview
> {
  const idx = (name: string) => headers.indexOf(name);
  const iFirst = idx("first_name");
  const iLast = idx("last_name");
  const iEmail = idx("email");
  const iPhone = idx("phone");
  const iStatus = idx("status");
  const iLang = idx("preferred_language");
  const iPkg = idx("package_slug");
  const iNotes = idx("admin_notes");
  const iAddr1 = idx("address_line1");
  const iAddr2 = idx("address_line2");
  const iCity = idx("city");
  const iState = idx("state");
  const iZip = idx("zip");
  const iDob = idx("date_of_birth");
  const iRef = idx("external_ref");

  const cell = (r: string[], i: number): string =>
    i >= 0 && i < r.length ? sanitizeCsvCell(r[i]) : "";

  const rows: OptimumClientImportRow[] = dataRows.map((r, arrIdx) => {
    const rowNumber = arrIdx + 2; // header is row 1
    const firstName = cell(r, iFirst);
    const lastName = cell(r, iLast);
    const email = cell(r, iEmail).toLowerCase();
    const phone = cell(r, iPhone) || null;
    const statusRaw = cell(r, iStatus).toLowerCase();
    const langRaw = cell(r, iLang).toLowerCase();
    const packageSlug = cell(r, iPkg) || null;
    const adminNotes = cell(r, iNotes) || null;
    const addressLine1 = cell(r, iAddr1) || null;
    const addressLine2 = cell(r, iAddr2) || null;
    const city = cell(r, iCity) || null;
    const stateRaw = cell(r, iState) || null;
    const zip = cell(r, iZip) || null;
    const dob = cell(r, iDob) || null;
    const externalRef = cell(r, iRef) || null;

    const errors: string[] = [];
    if (!firstName) errors.push("first_name is required");
    if (!lastName) errors.push("last_name is required");
    if (!email && !phone) {
      errors.push("email or phone is required");
    } else if (email && !isValidEmail(email)) {
      errors.push("email is invalid");
    }

    let normalizedPhone: string | null = null;
    if (phone) {
      normalizedPhone = normalizePhoneLast10(phone);
      if (!normalizedPhone) errors.push("phone is invalid");
    }

    let clientStatus = "pending_payment";
    if (statusRaw) {
      if (!CLIENT_CSV_ALLOWED_STATUS.includes(statusRaw)) {
        errors.push(`invalid status "${statusRaw}"`);
      } else {
        clientStatus = statusRaw;
      }
    }

    let preferredLanguage = "en";
    if (langRaw) {
      if (!CLIENT_CSV_ALLOWED_LANGUAGE.includes(langRaw)) {
        errors.push(`invalid preferred_language "${langRaw}"`);
      } else {
        preferredLanguage = langRaw;
      }
    }

    if (dob && !isValidDateIso(dob)) {
      errors.push("date_of_birth must be YYYY-MM-DD");
    }

    return {
      row_number: rowNumber,
      external_ref: externalRef,
      first_name: firstName,
      last_name: lastName,
      email: email || null,
      phone,
      normalized_phone: normalizedPhone,
      client_status: clientStatus,
      preferred_language: preferredLanguage,
      package_slug: packageSlug,
      package_id: null,
      admin_notes: adminNotes,
      address_line1: addressLine1,
      address_line2: addressLine2,
      city,
      state: normalizeUsState(stateRaw),
      zip,
      date_of_birth: dob,
      import_status: errors.length > 0 ? "error" : "will_create",
      message: errors.length > 0 ? errors.join("; ") : undefined,
    };
  });

  // Duplicate emails/phones within the file itself
  const emailCount = new Map<string, number>();
  const phoneCount = new Map<string, number>();
  for (const row of rows) {
    if (row.email)
      emailCount.set(row.email, (emailCount.get(row.email) || 0) + 1);
    if (row.normalized_phone) {
      phoneCount.set(
        row.normalized_phone,
        (phoneCount.get(row.normalized_phone) || 0) + 1,
      );
    }
  }
  for (const row of rows) {
    if (row.import_status === "error") continue;
    const dupEmail = !!row.email && (emailCount.get(row.email) || 0) > 1;
    const dupPhone =
      !!row.normalized_phone && (phoneCount.get(row.normalized_phone) || 0) > 1;
    if (dupEmail || dupPhone) {
      row.import_status = "error";
      row.message = dupEmail
        ? "Duplicate email within file"
        : "Duplicate phone within file";
    }
  }

  return { rows, ...rebuildOptimumClientPreview(rows) };
}

/** Resolves package_slug → package_id; unknown slugs become row errors. */
async function resolveOptimumClientPackages(
  dbPool: Pool,
  rows: OptimumClientImportRow[],
): Promise<void> {
  const slugs = Array.from(
    new Set(
      rows.filter((r) => r.package_slug).map((r) => r.package_slug as string),
    ),
  );
  if (slugs.length === 0) return;
  const [pkgRows] = await dbPool.query<RowDataPacket[]>(
    `SELECT id, slug FROM packages WHERE slug IN (?)`,
    [slugs],
  );
  const slugMap = new Map<string, number>();
  for (const p of pkgRows) slugMap.set(String(p.slug), Number(p.id));
  for (const row of rows) {
    if (!row.package_slug) continue;
    const pkgId = slugMap.get(row.package_slug);
    if (pkgId == null) {
      row.package_id = null;
      const unknownMsg = `Unknown package_slug "${row.package_slug}"`;
      row.message = row.message ? `${row.message}; ${unknownMsg}` : unknownMsg;
      row.import_status = "error";
    } else {
      row.package_id = pkgId;
    }
  }
}

/** DB preflight: rows that would create a client with an already-registered email are skipped instead. */
async function applyOptimumClientDbPreflight(
  dbPool: Pool,
  rows: OptimumClientImportRow[],
): Promise<void> {
  const emails = Array.from(
    new Set(
      rows
        .filter((r) => r.import_status === "will_create" && r.email)
        .map((r) => r.email),
    ),
  );
  if (emails.length === 0) return;
  const [existing] = await dbPool.query<RowDataPacket[]>(
    `SELECT id, email FROM clients WHERE email IN (?)`,
    [emails],
  );
  const existingMap = new Map<string, number>();
  for (const row of existing) {
    existingMap.set(String(row.email).toLowerCase(), Number(row.id));
  }
  for (const row of rows) {
    if (row.import_status !== "will_create") continue;
    const conflictId = row.email ? existingMap.get(row.email) : undefined;
    if (conflictId != null) {
      row.import_status = "skipped";
      row.conflict_client_id = conflictId;
      row.message = "A client with this email already exists";
    }
  }
}

function buildOptimumClientTemplateCsv(): string {
  const escape = (v: string) =>
    /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const sampleRow = [
    "Jane",
    "Doe",
    "jane.doe@example.com",
    "5551234567",
    "pending_payment",
    "en",
    "standard",
    "Referred by John Smith",
    "123 Main St",
    "",
    "Austin",
    "TX",
    "78701",
    "1990-01-15",
    "EXT-1001",
  ];
  return [CLIENT_CSV_HEADERS.join(","), sampleRow.map(escape).join(",")].join(
    "\n",
  );
}

function parseBulkImportJsonField<T>(val: unknown): T | null {
  if (val == null) return null;
  if (typeof val === "object") return val as T;
  try {
    return JSON.parse(String(val)) as T;
  } catch {
    return null;
  }
}

// ============================================================================
// ENV VALIDATION
// ============================================================================

const MISSING_DB_VARS = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"].filter(
  (k) => !process.env[k],
);
if (MISSING_DB_VARS.length > 0) {
  console.error(
    `❌ Missing required env vars: ${MISSING_DB_VARS.join(", ")}. All API routes will return 503.`,
  );
}

// Production = deployed on Vercel with a production environment. Local =
// anything else that isn't production, unless explicitly opted out — this
// keeps CI/staging runs without ALLOW_INSECURE_DEFAULTS from silently
// falling back to insecure defaults just because VERCEL isn't set there.
const IS_PROD =
  process.env.VERCEL_ENV === "production" ||
  process.env.NODE_ENV === "production";
const IS_LOCAL =
  !IS_PROD &&
  (process.env.ALLOW_INSECURE_DEFAULTS === "true" || !process.env.VERCEL);

/**
 * Affiliates feature flag. Set AFFILIATES_ENABLED=0|false to hide the admin
 * Affiliates / My Affiliate sections (lock icon), block those routes' APIs,
 * and disable public /r/:slug resolve until subscription pricing is ready.
 * Unset or 1|true = enabled (default).
 */
function affiliatesFeatureEnabled(): boolean {
  const v = String(process.env.AFFILIATES_ENABLED ?? "1")
    .trim()
    .toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

const AFFILIATES_FF_LOCK_REASON =
  "Coming soon — affiliate subscriptions are being finalized.";

function applyAffiliatesFeatureFlagToLocks<T extends Record<string, any>>(
  rows: T[],
): T[] {
  if (affiliatesFeatureEnabled()) return rows;
  return rows.map((r) => {
    if (
      r.section_key !== "affiliates" &&
      r.section_key !== "affiliate-portal"
    ) {
      return r;
    }
    return {
      ...r,
      is_locked: true,
      lock_reason: r.lock_reason || AFFILIATES_FF_LOCK_REASON,
    };
  });
}

const RAW_JWT_SECRET = process.env.JWT_SECRET;
if (!RAW_JWT_SECRET) {
  if (IS_PROD) {
    throw new Error(
      "❌ JWT_SECRET is required in production. Refusing to start with an insecure default.",
    );
  } else if (!IS_LOCAL) {
    throw new Error(
      "❌ JWT_SECRET is required. Set JWT_SECRET in .env, or ALLOW_INSECURE_DEFAULTS=true for local dev only.",
    );
  } else {
    console.warn(
      "⚠️  WARNING: Using default JWT_SECRET (ALLOW_INSECURE_DEFAULTS=true, local only). Set JWT_SECRET in .env for anything beyond local dev!",
    );
  }
}
const JWT_SECRET =
  RAW_JWT_SECRET || "default-jwt-secret-CHANGE-THIS-IN-PRODUCTION";

/** Canonical public site URL for emails, invite links, affiliate share URLs. */
function resolvePublicAppUrl(): string {
  const raw = String(process.env.PUBLIC_APP_URL || "")
    .trim()
    .replace(/\/$/, "");
  const onVercel = Boolean(process.env.VERCEL);
  const vercelEnv = String(process.env.VERCEL_ENV || "");
  const isVercelProd = onVercel && vercelEnv === "production";
  const isLocalDev = !onVercel;

  const looksLikeVercelApp = (url: string) => {
    try {
      return /\.vercel\.app$/i.test(new URL(url).hostname);
    } catch {
      return /vercel\.app/i.test(url);
    }
  };

  // Local server: never mint share links on *.vercel.app if .env still points there.
  if (isLocalDev) {
    if (!raw || looksLikeVercelApp(raw)) return "http://localhost:8080";
    return raw;
  }

  // Production: prefer custom domain over the Vercel deployment hostname.
  if (isVercelProd) {
    if (raw && !looksLikeVercelApp(raw)) return raw;
    return "https://www.ofgllc.com";
  }

  // Preview / other: keep configured URL, else Vercel URL, else ofgllc.
  if (raw) return raw;
  if (process.env.VERCEL_URL) {
    return `https://${String(process.env.VERCEL_URL).replace(/^https?:\/\//, "")}`;
  }
  return "https://www.ofgllc.com";
}

const APP_URL = resolvePublicAppUrl();
const SESSION_TTL_DAYS = 30;
const OTP_TTL_MIN = 10;
const ONBOARDING_TOKEN_TTL_HOURS = 72;
// /tmp is the only writable path in serverless (Vercel). Fall back to it when
// the preferred directory cannot be created (read-only filesystem).
const UPLOADS_DIR =
  process.env.UPLOADS_DIR ||
  (() => {
    const preferred = path.join(process.cwd(), "uploads");
    try {
      fs.mkdirSync(preferred, { recursive: true });
      return preferred;
    } catch {
      const tmp = "/tmp/uploads";
      fs.mkdirSync(tmp, { recursive: true });
      return tmp;
    }
  })();

// CDN (disruptinglabs.com) file storage
// Files are proxied through Express — the CDN URL is never exposed to the browser.
const CDN_UPLOAD_SECRET = process.env.CDN_UPLOAD_SECRET || "";
const CDN_UPLOAD_URL =
  process.env.CDN_UPLOAD_URL ||
  "https://disruptinglabs.com/data/api/uploadFiles.php";
const CDN_MAIN_FOLDER = process.env.CDN_MAIN_FOLDER || "optimum-credit";

// ============================================================================
// DATABASE POOL
// ============================================================================

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 4000,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: true },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "+00:00", // Always use UTC — prevents expires_at mismatch with TiDB NOW()
  // TiDB Cloud Serverless closes idle connections aggressively (~5 min).
  // keepAlive prevents the OS from holding dead TCP sockets in the pool.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // send first keepalive after 10s
  connectTimeout: 60000, // 60s connect timeout
});

// ============================================================================
// PIPELINE ADVANCE (inline — AGENTS.md)
// ============================================================================

export const PIPELINE_STAGES = [
  "prospect",
  "new_client",
  "docs_ready",
  "round_1",
  "round_2",
  "round_3",
  "round_4",
  "round_5",
  "completed",
  "cancelled",
] as const;

/**
 * Index of a stage within PIPELINE_STAGES. `cancelled` is treated as the
 * terminal-most stage regardless of its array position so any move away
 * from it (or into it) still resolves sensibly for forward/backward checks.
 */
export function pipelineStageIndex(stage: string): number {
  if (stage === "cancelled") return PIPELINE_STAGES.length - 1;
  const idx = (PIPELINE_STAGES as readonly string[]).indexOf(stage);
  return idx === -1 ? 0 : idx;
}

/** True when `to` is further along the pipeline than `from`. */
export function isForwardStageMove(from: string, to: string): boolean {
  return pipelineStageIndex(to) > pipelineStageIndex(from);
}

/** True when `to` is earlier in the pipeline than `from`. */
export function isBackwardStageMove(from: string, to: string): boolean {
  return pipelineStageIndex(to) < pipelineStageIndex(from);
}

/**
 * Per product decision 6C: forward moves, backward moves, and stage jumps
 * all require confirmation in the UI — i.e. any actual stage change.
 */
export function shouldConfirmStageMove(from: string, to: string): boolean {
  return from !== to;
}

/**
 * Prospects (status/stage = 'prospect') may optionally already have a
 * prospect-stage case (New Case → Prospect). The only legal board drag is
 * prospect → new_client, which must go through the convert endpoint — not a
 * plain stage update.
 */
export function canDragProspect(from: string, to: string): boolean {
  return from === "prospect" && to === "new_client";
}

function pipelineStageAfterRoundReport(roundNumber: number): string {
  if (roundNumber >= 5) return "completed";
  if (roundNumber < 1) return "docs_ready";
  return `round_${roundNumber + 1}`;
}

/** @deprecated use pipelineStageAfterRoundReport */
export const roundNumberToPipelineStage = pipelineStageAfterRoundReport;

async function resolveActiveCaseId(
  pool: Pool,
  clientId: number,
  caseId?: number | null,
): Promise<number | null> {
  if (caseId) return caseId;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM credit_repair_cases
     WHERE client_id = ? AND status = 'active'
     ORDER BY id DESC LIMIT 1`,
    [clientId],
  );
  return rows.length > 0 ? (rows[0].id as number) : null;
}

/** Atomically sync pipeline stage on case + client + history. */
async function advanceCasePipeline(
  db: Pick<Pool, "query">,
  opts: {
    clientId: number;
    stage: string;
    caseId?: number | null;
    adminId?: number | null;
    notes?: string | null;
  },
): Promise<{ fromStage: string; caseId: number | null; unchanged: boolean }> {
  const resolvedCaseId = await resolveActiveCaseId(
    db as Pool,
    opts.clientId,
    opts.caseId,
  );

  const [clientRows] = await db.query<RowDataPacket[]>(
    `SELECT pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
    [opts.clientId],
  );
  if (clientRows.length === 0) {
    throw new Error("Client not found");
  }

  let fromStage = clientRows[0].pipeline_stage as string;
  if (resolvedCaseId) {
    const [caseRows] = await db.query<RowDataPacket[]>(
      `SELECT pipeline_stage FROM credit_repair_cases WHERE id = ? LIMIT 1`,
      [resolvedCaseId],
    );
    if (caseRows.length > 0) {
      fromStage = caseRows[0].pipeline_stage as string;
    }
  }

  if (fromStage === opts.stage) {
    return { fromStage, caseId: resolvedCaseId, unchanged: true };
  }

  if (resolvedCaseId) {
    await db.query<ResultSetHeader>(
      `UPDATE credit_repair_cases
       SET pipeline_stage = ?, pipeline_stage_changed_at = NOW()
       WHERE id = ?`,
      [opts.stage, resolvedCaseId],
    );
  }

  await db.query<ResultSetHeader>(
    `UPDATE clients
     SET pipeline_stage = ?, pipeline_stage_changed_at = NOW()
     WHERE id = ?`,
    [opts.stage, opts.clientId],
  );

  await db.query<ResultSetHeader>(
    `INSERT INTO client_pipeline_history
       (client_id, from_stage, to_stage, changed_by_admin_id, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [
      opts.clientId,
      fromStage,
      opts.stage,
      opts.adminId ?? null,
      opts.notes ?? null,
    ],
  );

  return { fromStage, caseId: resolvedCaseId, unchanged: false };
}

// ============================================================================
// REPORT WIZARD VALIDATION (inline)
// ============================================================================

const PDF_MAGIC = "%PDF";

function isPdfBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 5) return false;
  return buf.subarray(0, 4).toString("ascii") === PDF_MAGIC;
}

function validatePdfUploadPair(
  before: Buffer,
  after: Buffer,
  maxBytes = 15 * 1024 * 1024,
): string | null {
  if (!before?.length || !after?.length) {
    return "Both PDF files are required";
  }
  if (before.length > maxBytes || after.length > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return `Each PDF must be ${mb} MB or smaller`;
  }
  if (!isPdfBuffer(before) || !isPdfBuffer(after)) {
    return "Invalid PDF file — files must start with %PDF header";
  }
  return null;
}

/** Pipeline stage → which round report the client should publish next. */
function expectedReportRoundForStage(pipelineStage: string): number | null {
  if (pipelineStage === "docs_ready") return 1;
  const match = pipelineStage.match(/^round_(\d)$/);
  if (match) return Number(match[1]);
  if (pipelineStage === "completed") return 5;
  return null;
}

function validatePublishRound(params: {
  roundNumber: number;
  pipelineStage: string;
  allowRepublish?: boolean;
  hasExistingReport?: boolean;
}): string | null {
  const { roundNumber, pipelineStage, allowRepublish, hasExistingReport } =
    params;

  if (roundNumber < 1 || roundNumber > 5) {
    return "round_number must be 1–5";
  }

  const expected = expectedReportRoundForStage(pipelineStage);
  if (expected == null) {
    return `Reports cannot be published while client is in stage "${pipelineStage}"`;
  }

  if (roundNumber > expected) {
    return `Round ${roundNumber} is not available yet — client is at ${pipelineStage.replace("_", " ")}`;
  }

  if (pipelineStage === "docs_ready" && roundNumber !== 1) {
    return "First report must be Round 1 while client is at Docs Verified";
  }

  if (hasExistingReport && !allowRepublish) {
    return `Round ${roundNumber} already has a published report — contact super admin to replace`;
  }

  return null;
}

function canReviewSession(status: string): boolean {
  return ["review", "draft", "failed"].includes(status);
}

function canExtractSession(status: string): boolean {
  return status !== "published" && status !== "extracting";
}

function canFinalizeSession(status: string): boolean {
  return status === "review";
}

function canPreviewSession(status: string): boolean {
  return ["review", "draft", "failed", "generating"].includes(status);
}

/** Median of three bureau scores (0 treated as missing). */
function calcMiddleScore(
  before: number,
  middle: number,
  after: number,
): number {
  const vals = [before, middle, after].filter((n) => n > 0);
  if (vals.length === 0) return 0;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

function scoresRoughlyMatchMiddle(data: {
  middleScore: { before: number; after: number };
  bureauScores: {
    transunion: { before: number; after: number };
    experian: { before: number; after: number };
    equifax: { before: number; after: number };
  };
}): string[] {
  const warnings: string[] = [];
  const expectedBefore = calcMiddleScore(
    data.bureauScores.transunion.before,
    data.bureauScores.experian.before,
    data.bureauScores.equifax.before,
  );
  const expectedAfter = calcMiddleScore(
    data.bureauScores.transunion.after,
    data.bureauScores.experian.after,
    data.bureauScores.equifax.after,
  );

  if (
    expectedBefore > 0 &&
    data.middleScore.before > 0 &&
    Math.abs(expectedBefore - data.middleScore.before) > 5
  ) {
    warnings.push(
      `Middle score before (${data.middleScore.before}) differs from bureau median (${expectedBefore})`,
    );
  }
  if (
    expectedAfter > 0 &&
    data.middleScore.after > 0 &&
    Math.abs(expectedAfter - data.middleScore.after) > 5
  ) {
    warnings.push(
      `Middle score after (${data.middleScore.after}) differs from bureau median (${expectedAfter})`,
    );
  }
  return warnings;
}

// ============================================================================
// REPORT EXTRACTION CORE (inline)
// ============================================================================

type ReportProvider = "identityiq" | "smartcredit" | "myscoreiq" | "generic";

type BureauScores = {
  transunion: number | null;
  experian: number | null;
  equifax: number | null;
};

function detectProvider(text: string): ReportProvider {
  const t = text.toLowerCase();
  if (t.includes("identityiq") || t.includes("identity iq"))
    return "identityiq";
  if (t.includes("smartcredit") || t.includes("smart credit"))
    return "smartcredit";
  if (t.includes("myscoreiq") || t.includes("my score iq")) return "myscoreiq";
  return "generic";
}

function extractBureauScoreGeneric(
  text: string,
  bureau: string,
): number | null {
  const patterns = [
    new RegExp(`${bureau}[^\\d]{0,60}(\\d{3})`, "i"),
    new RegExp(`${bureau.slice(0, 3)}[^\\d]{0,30}(\\d{3})`, "i"),
    new RegExp(`(${bureau.slice(0, 2)})\\s*[:\\-]?\\s*(\\d{3})`, "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    const score = m ? Number(m[m.length - 1]) : NaN;
    if (score >= 300 && score <= 850) return score;
  }
  return null;
}

function extractBureauScoreProvider(
  text: string,
  bureau: "transunion" | "experian" | "equifax",
  provider: ReportProvider,
): number | null {
  const labels: Record<typeof bureau, string[]> = {
    transunion: ["transunion", "trans union", "tu"],
    experian: ["experian", "exp", "ex"],
    equifax: ["equifax", "eq"],
  };

  const providerPatterns: RegExp[] = [];
  const abbrev =
    bureau === "transunion" ? "TU" : bureau === "experian" ? "EX" : "EQ";
  providerPatterns.push(new RegExp(`\\b${abbrev}\\b[^\\d]{0,20}(\\d{3})`, "i"));

  if (
    provider === "identityiq" ||
    provider === "smartcredit" ||
    provider === "myscoreiq"
  ) {
    for (const label of labels[bureau]) {
      providerPatterns.push(
        new RegExp(
          `${label}[^\\d]{0,40}(?:score|vantage|fico)?[^\\d]{0,10}(\\d{3})`,
          "i",
        ),
      );
      providerPatterns.push(
        new RegExp(
          `(?:score|vantage|fico)[^\\d]{0,20}${label}[^\\d]{0,20}(\\d{3})`,
          "i",
        ),
      );
    }
  }

  for (const re of providerPatterns) {
    const m = text.match(re);
    const score = m ? Number(m[1]) : NaN;
    if (score >= 300 && score <= 850) return score;
  }

  const genericName =
    bureau === "transunion"
      ? "TransUnion"
      : bureau === "experian"
        ? "Experian"
        : "Equifax";
  return extractBureauScoreGeneric(text, genericName);
}

function extractAllScores(
  text: string,
  provider: ReportProvider = detectProvider(text),
): BureauScores {
  return {
    transunion: extractBureauScoreProvider(text, "transunion", provider),
    experian: extractBureauScoreProvider(text, "experian", provider),
    equifax: extractBureauScoreProvider(text, "equifax", provider),
  };
}

function middleScore(scores: BureauScores): number | null {
  const vals = [scores.transunion, scores.experian, scores.equifax].filter(
    (n): n is number => n != null,
  );
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

const NEGATIVE_LINE_KEYWORDS =
  /collection|charge.?off|late payment|inquiry|repossession|foreclosure|bankruptcy|lien|judgment|delinquent|past due|derogatory|charged off/i;

function detectNegativeLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 8 && l.length < 140);
  const accountPrefix =
    /^([A-Z0-9*\/\s&.'-]{4,60}?)\s+(?:-\s+)?(?:collection|charge|late|inquiry|repossession|foreclosure|bankruptcy|lien|judgment|delinquent|past due|derogatory)/i;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    if (!NEGATIVE_LINE_KEYWORDS.test(line)) continue;
    const prefixMatch = line.match(accountPrefix);
    const normalized = (prefixMatch?.[1] ?? line).trim().slice(0, 100);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out.slice(0, 25);
}

export type BureauCode = "TU" | "EX" | "EQ";

/** Structured negative tradeline for account-level before/after matching. */
export interface NegativeAccount {
  key: string;
  label: string;
  type: string;
  bureaus: BureauCode[];
  bureaus_uncertain?: boolean;
}

function normalizeCreditorToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(llc|inc|corp|co|ltd|na|bank)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 48);
}

export function normalizeAccountKey(creditor: string, type: string): string {
  return `${normalizeCreditorToken(creditor)}|${normalizeCreditorToken(type)}`;
}

export function detectBureausInText(chunk: string): BureauCode[] {
  const found: BureauCode[] = [];
  if (/trans\s*union|transunion|\bTU\b/i.test(chunk)) found.push("TU");
  if (/experian|\bEX\b/i.test(chunk)) found.push("EX");
  if (/equifax|\bEQ\b/i.test(chunk)) found.push("EQ");
  return found;
}

function isTriBureauReport(text: string): boolean {
  return (
    /transunion|trans\s*union/i.test(text) &&
    /experian/i.test(text) &&
    /equifax/i.test(text)
  );
}

/** Extract structured negatives with per-line bureau tags when detectable. */
export function extractNegativeAccounts(text: string): NegativeAccount[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const accounts: NegativeAccount[] = [];
  const seen = new Set<string>();
  const triBureau = isTriBureauReport(text);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 8 || line.length > 140) continue;
    if (!NEGATIVE_LINE_KEYWORDS.test(line)) continue;

    const classified = classifyNegativeLine(line);
    const creditor = classified.creditor || line.slice(0, 40);
    const key = normalizeAccountKey(creditor, classified.type);
    if (seen.has(key)) continue;
    seen.add(key);

    const window = [lines[i - 2], lines[i - 1], line, lines[i + 1], lines[i + 2]]
      .filter(Boolean)
      .join(" ");
    let bureaus = detectBureausInText(window);
    let uncertain = false;
    if (bureaus.length === 0) {
      uncertain = true;
      // Tri-bureau 3-in-1 PDFs (SmartCredit etc.): soft-default all three.
      // Single-bureau / unknown: leave empty so review UI does not invent tags.
      bureaus = triBureau ? ["TU", "EX", "EQ"] : [];
    }

    const label = (
      classified.creditor
        ? `${classified.creditor} — ${classified.type}`
        : classified.detail
    ).slice(0, 100);

    accounts.push({
      key,
      label,
      type: classified.type,
      bureaus,
      bureaus_uncertain: uncertain || undefined,
    });
  }
  return accounts.slice(0, 25);
}

/** Exact fingerprint match only — same creditor + different types are distinct. */
function accountsMatch(a: NegativeAccount, b: NegativeAccount): boolean {
  return a.key === b.key;
}

/** Diff structured negatives: removed = in before but not after. */
export function diffNegativeAccounts(
  before: NegativeAccount[],
  after: NegativeAccount[],
): { removed: NegativeAccount[]; remaining: NegativeAccount[] } {
  const removed = before.filter(
    (b) => !after.some((a) => accountsMatch(a, b)),
  );
  return { removed, remaining: after };
}

/**
 * Prefer structured removals; merge in any line-diff removals that structured
 * matching did not already surface (avoids incomplete structured results
 * suppressing real wins).
 */
export function mergeRemovedWins(
  structuredRemoved: NegativeAccount[],
  lineRemoved: string[],
): Array<{ label: string; bureaus: BureauCode[] }> {
  const out: Array<{ label: string; bureaus: BureauCode[] }> = [];
  const seen = new Set<string>();
  for (const acct of structuredRemoved) {
    const k = acct.label.toLowerCase().trim();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label: acct.label, bureaus: acct.bureaus });
  }
  for (const line of lineRemoved) {
    const k = line.toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    // Skip if any structured label already covers this creditor token
    const lineKey = normalizeCreditorToken(line);
    const covered = structuredRemoved.some((a) => {
      const cred = a.key.split("|")[0];
      return cred.length >= 5 && lineKey.includes(cred);
    });
    if (covered) continue;
    seen.add(k);
    out.push({ label: line, bureaus: ["TU", "EX", "EQ"] });
  }
  return out;
}

/** Parse common credit-report date strings to YYYY-MM-DD (US MM/DD, or DD/MM when unambiguous). */
export function parseLooseDateToIso(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  let a = Number(m[1]);
  let b = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (year < 1990 || year > 2100) return null;

  // If first part > 12, must be DD/MM/YYYY
  let month: number;
  let day: number;
  if (a > 12 && b >= 1 && b <= 12) {
    day = a;
    month = b;
  } else if (a >= 1 && a <= 12 && b >= 1 && b <= 31) {
    // Prefer US MM/DD when ambiguous
    month = a;
    day = b;
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Best-effort report date from PDF text (SmartCredit / bureau exports). */
export function extractReportDate(text: string): string | null {
  const patterns = [
    /report\s*date[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /as\s+of[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /generated(?:\s+on)?[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /date\s+prepared[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:report|as of|generated)[^\d]{0,24}(\d{4}-\d{2}-\d{2})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const iso = parseLooseDateToIso(m[1]);
      if (iso) return iso;
    }
  }
  return null;
}

/**
 * Keyword → negative-item "type" classification, used both to build the
 * structured negatives array returned to the public credit-analysis form
 * and to derive human-readable analysis label suggestions.
 */
const NEGATIVE_TYPE_PATTERNS: Array<[string, RegExp]> = [
  ["Bankruptcy", /bankrupt/i],
  ["Foreclosure", /foreclosure/i],
  ["Repossession", /repossession/i],
  ["Charge-Off", /charge.?off|charged off/i],
  ["Collection", /collection/i],
  ["Judgment", /judgment/i],
  ["Lien", /\blien\b/i],
  ["Late Payment", /late payment|past due|delinquent/i],
  ["Hard Inquiry", /inquiry/i],
  ["Derogatory Item", /derogatory/i],
];

/** Turn the flat lines from detectNegativeLines into structured items for the API/UI. */
function classifyNegativeLine(line: string): CreditAnalysisNegativeItem {
  const found = NEGATIVE_TYPE_PATTERNS.find(([, re]) => re.test(line));
  const type = found ? found[0] : "Derogatory Item";
  const creditorGuess = line
    .replace(
      /[-–—]?\s*(collection|charge.?off|charged off|late payment|inquiry|repossession|foreclosure|bankrupt(?:cy)?|lien|judgment|delinquent|past due|derogatory).*$/i,
      "",
    )
    .trim();
  const creditor =
    creditorGuess &&
    creditorGuess.length > 1 &&
    creditorGuess.length < line.length
      ? creditorGuess
      : undefined;
  return { type, creditor, detail: line };
}

function buildNegativeItems(lines: string[]): CreditAnalysisNegativeItem[] {
  return lines.map(classifyNegativeLine);
}

/**
 * Map detected negative lines + full report text to analysis label slugs.
 * Slugs must match the seeded `labels` rows (layer='analysis') from
 * database/migrations/20260731_190000_prospects_labels_analysis.sql.
 */
export function inferAnalysisLabelSlugs(
  negatives: string[],
  text: string,
): string[] {
  const haystack = `${negatives.join(" \n ")}\n${text}`.toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ["housing", /mortgage|foreclosure|\brent\b|landlord|housing/],
    ["auto", /auto loan|vehicle|car loan|repossession|\bauto\b/],
    [
      "credit_card",
      /credit card|visa|mastercard|discover|amex|american express/,
    ],
    ["collections", /collection agency|placed for collection|\bcollections?\b/],
    ["student_loan", /student loan|sallie mae|navient|dept\.? of education/],
    ["personal_loan", /personal loan|installment loan|signature loan/],
    ["medical", /medical|hospital|clinic|health ?care/],
    ["bankruptcy", /bankrupt/],
    ["inquiry", /hard inquiry|\binquiry\b/],
  ];
  const matched = new Set<string>();
  for (const [slug, re] of rules) {
    if (re.test(haystack)) matched.add(slug);
  }
  if (matched.size === 0 && negatives.length > 0) {
    matched.add("other_derogatory");
  }
  return Array.from(matched);
}

function extractUtilization(text: string): OfGReportData["utilization"] {
  const results: OfGReportData["utilization"] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(
      /([A-Za-z0-9*\/\s]{4,40}?)\s+[\$]?([\d,]+)\s+[\$]?([\d,]+)\s+(\d{1,3})%/,
    );
    if (!m) continue;
    const limit = Number(m[2].replace(/,/g, ""));
    const balance = Number(m[3].replace(/,/g, ""));
    const pctUsed = Number(m[4]);
    if (limit <= 0 || pctUsed > 100) continue;
    const payTo30 = Math.max(0, Math.ceil(balance - limit * 0.3));
    const payTo10 = Math.max(0, Math.ceil(balance - limit * 0.1));
    results.push({
      account: m[1].trim().slice(0, 40),
      limit,
      balance,
      pctUsed,
      payTo30,
      payTo10,
    });
  }
  return results.slice(0, 12);
}

function extractPositiveAccounts(text: string): string[] {
  const out: string[] = [];
  const re =
    /(paid as agreed|current|never late|positive|good standing)[^\n]{0,60}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < 8) {
    const line = m[0].trim().slice(0, 80);
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

function diffItems(before: string[], after: string[]): string[] {
  const afterSet = new Set(after.map((s) => s.toLowerCase().trim()));
  return before.filter((b) => !afterSet.has(b.toLowerCase().trim()));
}

function buildConfidence(
  beforeScores: BureauScores,
  afterScores: BureauScores,
): Record<string, number> {
  return {
    transunion: beforeScores.transunion && afterScores.transunion ? 0.9 : 0.4,
    experian: beforeScores.experian && afterScores.experian ? 0.9 : 0.4,
    equifax: beforeScores.equifax && afterScores.equifax ? 0.9 : 0.4,
  };
}

function computeFileStrengthScore(
  afterMiddle: number | null,
  winsCount: number,
  targetsCount: number,
): number {
  return Math.min(
    100,
    Math.max(0, (afterMiddle ?? 500) - 400 + winsCount * 5 - targetsCount * 2),
  );
}

// ============================================================================
// REPORT EXTRACTION (inline)
// ============================================================================

type PdfParseFn = (buf: Buffer) => Promise<{ text: string }>;
let pdfParseLoader: Promise<PdfParseFn> | null = null;

/**
 * Lazy-load pdf-parse (v2+ exports `PDFParse` class, not a default function).
 * Keep load deferred so Vercel cold start does not fail on module init.
 */
function loadPdfParse(): Promise<PdfParseFn> {
  if (!pdfParseLoader) {
    pdfParseLoader = import("pdf-parse").then((mod) => {
      const PDFParseCtor = (
        mod as {
          PDFParse?: new (opts: { data: Buffer | Uint8Array }) => {
            getText: () => Promise<{ text: string }>;
            destroy: () => Promise<void>;
          };
        }
      ).PDFParse;

      // Legacy v1 default-export fallback (if ever downgraded)
      const maybeDefault = (mod as { default?: unknown }).default;
      const legacyFn: PdfParseFn | null =
        typeof maybeDefault === "function"
          ? (maybeDefault as PdfParseFn)
          : typeof (mod as unknown) === "function"
            ? (mod as unknown as PdfParseFn)
            : null;

      if (PDFParseCtor) {
        const parseWithClass: PdfParseFn = async (buf) => {
          const parser = new PDFParseCtor({ data: buf });
          try {
            const result = await parser.getText();
            return { text: result?.text ?? "" };
          } finally {
            await parser.destroy().catch(() => undefined);
          }
        };
        return parseWithClass;
      }

      if (legacyFn) return legacyFn;

      throw new Error(
        "pdf-parse module did not export PDFParse class or a parse function",
      );
    });
  }
  return pdfParseLoader;
}

const CROA_DISCLOSURE_EN =
  "Optimum Financial Group provides credit repair services in compliance with the Credit Repair Organizations Act (CROA), 15 U.S.C. §1679 et seq. We do not guarantee specific score improvements. Results vary by individual.";

const CROA_DISCLOSURE_ES =
  "Optimum Financial Group proporciona servicios de reparación de crédito en cumplimiento con la Ley de Organizaciones de Reparación de Crédito (CROA), 15 U.S.C. §1679 et seq. No garantizamos mejoras específicas en el puntaje. Los resultados varían según el individuo.";

function buildActionPlan(spanish: boolean): OfGReportData["actionPlan"] {
  if (spanish) {
    return [
      {
        step: 1,
        description: "Continúe realizando pagos puntuales en todas sus cuentas",
        owner: "client",
      },
      {
        step: 2,
        description: "Mantenga los saldos de tarjetas por debajo del 30%",
        owner: "client",
      },
      {
        step: 3,
        description:
          "OFG presentará disputas dirigidas para los ítems restantes",
        owner: "ofg",
      },
    ];
  }
  return [
    {
      step: 1,
      description: "Continue making on-time payments on all open accounts",
      owner: "client",
    },
    {
      step: 2,
      description: "Keep credit card balances below 30% utilization",
      owner: "client",
    },
    {
      step: 3,
      description: "OFG will submit targeted disputes for remaining items",
      owner: "ofg",
    },
  ];
}

async function extractFromCreditReportPdfs(
  beforeBuffer: Buffer,
  afterBuffer: Buffer,
  clientFirstName: string,
  roundNumber: number,
  options: {
    highlightWin?: string;
    spanish?: boolean;
    tradelineRec?: boolean;
    fundingNote?: boolean;
  } = {},
): Promise<{ data: OfGReportData; meta: Record<string, unknown> }> {
  const t0 = Date.now();
  const pdfParse = await loadPdfParse();
  const [beforeParsed, afterParsed] = await Promise.all([
    pdfParse(beforeBuffer),
    pdfParse(afterBuffer),
  ]);

  if (!beforeParsed.text?.trim() || !afterParsed.text?.trim()) {
    throw new Error(
      "Could not extract text from one or both PDFs — file may be scanned/image-only",
    );
  }

  const combinedText = beforeParsed.text + afterParsed.text;
  const provider = detectProvider(combinedText);
  const beforeScores = extractAllScores(beforeParsed.text, provider);
  const afterScores = extractAllScores(afterParsed.text, provider);
  const beforeMiddle = middleScore(beforeScores);
  const afterMiddle = middleScore(afterScores);

  const beforeAccounts = extractNegativeAccounts(beforeParsed.text);
  const afterAccounts = extractNegativeAccounts(afterParsed.text);
  const { removed, remaining } = diffNegativeAccounts(
    beforeAccounts,
    afterAccounts,
  );

  const beforeNeg = detectNegativeLines(beforeParsed.text);
  const afterNeg = detectNegativeLines(afterParsed.text);
  const lineRemoved = diffItems(beforeNeg, afterNeg);

  const mergedRemoved = mergeRemovedWins(removed, lineRemoved);
  const matchingMethod =
    removed.length > 0 && lineRemoved.length > 0 && mergedRemoved.length > removed.length
      ? "account_fingerprint+line_diff"
      : removed.length > 0
        ? "account_fingerprint"
        : "line_diff";

  const wins = mergedRemoved.map((item) => ({
    itemRemoved: item.label,
    bureaus: item.bureaus,
    impact: options.spanish ? "Eliminado del informe" : "Removed from report",
    status: options.spanish ? "Eliminado" : "Removed",
    highlighted:
      !!options.highlightWin &&
      item.label.toLowerCase().includes(options.highlightWin.toLowerCase()),
  }));

  if (options.highlightWin && wins.length === 0) {
    wins.push({
      itemRemoved: options.highlightWin,
      bureaus: ["TU", "EX", "EQ"],
      impact: options.spanish ? "Eliminado del informe" : "Removed from report",
      status: options.spanish ? "Eliminado" : "Removed",
      highlighted: true,
    });
  }

  const targetSource =
    remaining.length > 0
      ? remaining
      : afterAccounts.length > 0
        ? afterAccounts
        : afterNeg.map((item) => ({
            key: normalizeAccountKey(item, "Derogatory Item"),
            label: item,
            type: "Derogatory Item",
            bureaus: ["TU", "EX", "EQ"] as BureauCode[],
          }));

  const targets = targetSource.slice(0, 8).map((acct, i) => ({
    item: "label" in acct ? acct.label : String(acct),
    bureaus: ("bureaus" in acct
      ? acct.bureaus
      : ["TU", "EX", "EQ"]) as BureauCode[],
    detail: options.spanish
      ? "Aún reportando — objetivo próxima ronda"
      : "Still reporting — next round target",
    priority: (i < 3 ? "high" : "medium") as "high" | "medium" | "low",
  }));

  const utilization = extractUtilization(afterParsed.text);
  const positiveAccounts = extractPositiveAccounts(afterParsed.text);
  const actionNeeded = utilization
    .filter((u) => u.pctUsed > 30)
    .map(
      (u) =>
        `${u.account}: ${u.pctUsed}% utilized — pay down $${u.payTo30} to reach 30%`,
    );

  const scoreGoal = afterMiddle != null ? Math.min(850, afterMiddle + 40) : 700;
  const gapRemaining =
    afterMiddle != null ? Math.max(0, scoreGoal - afterMiddle) : 0;

  const spanish = !!options.spanish;
  const todayIso = new Date().toISOString().slice(0, 10);
  const beforeDateFromPdf = extractReportDate(beforeParsed.text);
  const afterDateFromPdf = extractReportDate(afterParsed.text);
  const beforeReportDate = beforeDateFromPdf || todayIso;
  const afterReportDate = afterDateFromPdf || todayIso;

  const data: OfGReportData = {
    client: { firstName: clientFirstName },
    reportDate: {
      before: beforeReportDate,
      after: afterReportDate,
    },
    bureauScores: {
      transunion: {
        before: beforeScores.transunion ?? 0,
        after: afterScores.transunion ?? 0,
      },
      experian: {
        before: beforeScores.experian ?? 0,
        after: afterScores.experian ?? 0,
      },
      equifax: {
        before: beforeScores.equifax ?? 0,
        after: afterScores.equifax ?? 0,
      },
    },
    middleScore: {
      before: beforeMiddle ?? 0,
      after: afterMiddle ?? 0,
    },
    wins,
    targets,
    utilization,
    positiveAccounts,
    actionNeeded,
    roadmap: {
      currentRound: roundNumber,
      nextRound: Math.min(5, roundNumber + 1),
      scoreGoal,
      gapRemaining,
      milestones: spanish
        ? [
            `Ronda ${roundNumber} documentada`,
            `Ronda ${Math.min(5, roundNumber + 1)} en progreso`,
            "Meta de puntaje en camino",
          ]
        : [
            `Round ${roundNumber} progress documented`,
            `Round ${Math.min(5, roundNumber + 1)} disputes in progress`,
            "Score goal on track",
          ],
    },
    actionPlan: buildActionPlan(spanish),
    fileStrengthScore: computeFileStrengthScore(
      afterMiddle,
      wins.length,
      targets.length,
    ),
    tradelineRecommendation: options.tradelineRec
      ? {
          code: "IH-1",
          projectedImpact: spanish
            ? "Proyección +15–25 puntos cuando se actualice el informe"
            : "Projected +15–25 points when reporting updates",
        }
      : undefined,
    fundingReadinessNote: options.fundingNote
      ? spanish
        ? "En camino hacia mejor preparación para financiamiento conforme se eliminan ítems negativos."
        : "On track for improved funding readiness as negative items are removed and utilization is optimized."
      : undefined,
    croaDisclosure: spanish ? CROA_DISCLOSURE_ES : CROA_DISCLOSURE_EN,
    locale: spanish ? "es" : "en",
  };

  const confidence = buildConfidence(beforeScores, afterScores);

  return {
    data,
    meta: {
      duration_ms: Date.now() - t0,
      provider,
      extraction_method: "heuristic_structured",
      matching_method: matchingMethod,
      before_text_length: beforeParsed.text.length,
      after_text_length: afterParsed.text.length,
      before_report_date: beforeReportDate,
      after_report_date: afterReportDate,
      before_date_from_pdf: !!beforeDateFromPdf,
      after_date_from_pdf: !!afterDateFromPdf,
      confidence,
      wins_detected: data.wins.length,
      targets_detected: data.targets.length,
      utilization_detected: data.utilization.length,
      before_accounts: beforeAccounts.length,
      after_accounts: afterAccounts.length,
    },
  };
}

// ============================================================================
// PUBLIC CREDIT ANALYSIS — branded narrative builder (3A: heuristic +
// templated HTML, not a real dispute report). Returns an HTML *fragment*
// (no <html>/<body>) so it renders both inline on the public results page
// (client/pages/CreditAnalysis.tsx, `prose` container) and inside the
// full emailLayout() wrapper when opted in for email delivery.
// ============================================================================
/**
 * Classifies how well we were able to read text out of an uploaded credit
 * report so the caller can avoid making false-positive "no negatives found"
 * claims when we simply couldn't read the file (e.g. a scanned photo, or a
 * PDF whose text layer failed to parse).
 */
export type CreditAnalysisExtractionStatus =
  | "ok"
  | "empty"
  | "parse_failed"
  | "unsupported_type";

export function resolveExtractionStatus(
  mime: string | null | undefined,
  text: string,
  parseFailed: boolean,
): CreditAnalysisExtractionStatus {
  if (mime !== "application/pdf") return "unsupported_type";
  if (parseFailed) return "parse_failed";
  if (text.trim().length < 80) return "empty";
  return "ok";
}

/**
 * Reminder-flow audience gate: returns required slugs the client is missing.
 * Empty array ⇒ client passes the filter (or no requirements).
 */
export function missingRequiredLabelSlugs(
  clientSlugs: string[],
  requiredSlugs: string[],
): string[] {
  if (!requiredSlugs.length) return [];
  const have = new Set(clientSlugs);
  return requiredSlugs.filter((s) => !have.has(s));
}

function buildProspectAnalysisHtml(opts: {
  firstName: string;
  scores: BureauScores;
  negatives: CreditAnalysisNegativeItem[];
  clientGoal?: string | null;
  lang?: string;
  /** True when extraction_status !== 'ok' — suppresses "no negatives found" claims. */
  weakExtraction?: boolean;
  extractionStatus?: CreditAnalysisExtractionStatus;
}): { html: string; text: string } {
  const isEs = opts.lang === "es";
  const mid = middleScore(opts.scores);
  const negCount = opts.negatives.length;
  const weak = opts.weakExtraction ?? opts.extractionStatus !== "ok";

  const scoreLine = mid
    ? isEs
      ? `Tu puntaje estimado combinado es de <strong>${mid}</strong>.`
      : `Your estimated combined credit score is <strong>${mid}</strong>.`
    : weak
      ? isEs
        ? "No pudimos leer un puntaje numérico de tu informe porque no extrajimos texto suficiente."
        : "We couldn't read a numeric score from your report because we didn't extract enough text."
      : isEs
        ? "No pudimos leer un puntaje numérico de tu informe, pero aún así identificamos áreas de oportunidad abajo."
        : "We couldn't read a numeric score from your report, but we still identified opportunities below.";

  const negLine = weak
    ? isEs
      ? "No pudimos leer tu informe de manera confiable, así que no podemos confirmar si tiene ítems negativos. Por favor sube un PDF de texto (no una foto o escaneo) de tu reporte de SmartCredit para obtener un análisis preciso."
      : "We couldn't reliably read your report, so we can't confirm whether it has negative items. Please upload a text-based SmartCredit PDF (not a photo or scan) so we can give you an accurate analysis."
    : negCount > 0
      ? isEs
        ? `Encontramos <strong>${negCount}</strong> ítem${negCount === 1 ? "" : "s"} negativo${negCount === 1 ? "" : "s"} que probablemente estén afectando tu puntaje.`
        : `We found <strong>${negCount}</strong> negative item${negCount === 1 ? "" : "s"} that are likely impacting your score.`
      : isEs
        ? "¡Buenas noticias! No detectamos ítems negativos obvios en tu informe."
        : "Good news — we didn't detect any obvious negative items on your report.";

  const goalLine = opts.clientGoal
    ? isEs
      ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Nos dijiste que tu meta es: <em>"${escapeHtml(opts.clientGoal)}"</em>. Nuestro equipo puede construir un plan de disputas dirigido a ayudarte a alcanzarla.</p>`
      : `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">You told us your goal is: <em>"${escapeHtml(opts.clientGoal)}"</em>. Our team can build a targeted dispute plan aimed at getting you there.</p>`
    : "";

  const itemsHtml =
    negCount > 0
      ? `<ul style="margin:0 0 16px;padding-left:20px;color:#334155;font-size:14px;line-height:1.7;">
          ${opts.negatives
            .slice(0, 10)
            .map(
              (n) =>
                `<li><strong>${escapeHtml(n.creditor || n.type)}</strong>${n.creditor ? ` — ${escapeHtml(n.type)}` : ""}</li>`,
            )
            .join("")}
        </ul>`
      : "";

  const html = `
    <h2 style="margin:0 0 12px;font-size:20px;font-weight:800;color:#0f172a;">${isEs ? `Tu análisis de crédito, ${escapeHtml(opts.firstName)}` : `Your Credit Analysis, ${escapeHtml(opts.firstName)}`}</h2>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${scoreLine}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${negLine}</p>
    ${itemsHtml}
    ${goalLine}
    <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">${isEs ? CROA_DISCLOSURE_ES : CROA_DISCLOSURE_EN}</p>
  `.trim();

  const text = [
    isEs
      ? `Tu análisis de crédito, ${opts.firstName}`
      : `Your Credit Analysis, ${opts.firstName}`,
    scoreLine.replace(/<\/?strong>/g, ""),
    negLine.replace(/<\/?strong>/g, ""),
    ...opts.negatives
      .slice(0, 10)
      .map(
        (n) => `- ${n.creditor || n.type}${n.creditor ? ` (${n.type})` : ""}`,
      ),
    opts.clientGoal ? `Goal: ${opts.clientGoal}` : "",
    isEs ? CROA_DISCLOSURE_ES : CROA_DISCLOSURE_EN,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { html, text };
}

// ============================================================================
// REPORT COMPLIANCE (inline)
// ============================================================================

const BLOCKED_PHRASES = [
  /guarantee/i,
  /guaranteed/i,
  /goodwill letter/i,
  /pay off your/i,
  /negotiate.*debt/i,
  /will increase.*\d+ points/i,
];

export type ReportComplianceResult = {
  /** Hard blockers — always reject preview/publish. */
  errors: string[];
  /** Soft checks — preview allowed; publish needs acknowledge_score_anomalies. */
  warnings: string[];
};

function validateReportCompliance(data: OfGReportData): ReportComplianceResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data.croaDisclosure?.includes("CROA")) {
    errors.push("CROA disclosure is missing");
  }

  if (!data.client?.firstName?.trim()) {
    errors.push("Client first name is required");
  }

  if (data.roadmap.currentRound < 1 || data.roadmap.currentRound > 5) {
    errors.push("Invalid round number in report data");
  }

  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!data.reportDate?.before || !isoDate.test(data.reportDate.before)) {
    warnings.push(
      "Before report date is missing or invalid — verify against the source PDF",
    );
  }
  if (!data.reportDate?.after || !isoDate.test(data.reportDate.after)) {
    warnings.push(
      "After report date is missing or invalid — verify against the source PDF",
    );
  }
  if (
    data.reportDate?.before &&
    data.reportDate?.after &&
    isoDate.test(data.reportDate.before) &&
    isoDate.test(data.reportDate.after) &&
    data.reportDate.after < data.reportDate.before
  ) {
    warnings.push(
      "After report date is earlier than Before date — verify the PDFs were not swapped",
    );
  }

  const hasAnyAfterScore =
    data.middleScore.after > 0 ||
    data.bureauScores.transunion.after > 0 ||
    data.bureauScores.experian.after > 0 ||
    data.bureauScores.equifax.after > 0;

  if (!hasAnyAfterScore) {
    errors.push(
      "At least one after score is required — verify bureau scores before publishing",
    );
  }

  for (const bureau of ["transunion", "experian", "equifax"] as const) {
    const s = data.bureauScores[bureau];
    for (const [label, val] of [
      ["before", s.before],
      ["after", s.after],
    ] as const) {
      if (val !== 0 && (val < 300 || val > 850)) {
        errors.push(`${bureau} ${label} score out of range: ${val}`);
      }
    }
    if (s.before > 0 && s.after > 0 && s.after < s.before - 150) {
      warnings.push(
        `${bureau} after score dropped more than 150 points — verify accuracy against the source PDFs, or correct the score in review`,
      );
    }
  }

  warnings.push(...scoresRoughlyMatchMiddle(data));

  const textFields = [
    data.fundingReadinessNote,
    data.tradelineRecommendation?.projectedImpact,
    ...data.actionPlan.map((a) => a.description),
    ...data.wins.map((w) => w.itemRemoved),
    ...data.targets.map((t) => t.item),
  ].filter(Boolean) as string[];

  for (const text of textFields) {
    for (const re of BLOCKED_PHRASES) {
      if (re.test(text)) {
        errors.push(
          `Compliance issue: prohibited phrase in "${text.slice(0, 40)}..."`,
        );
      }
    }
  }

  if (
    data.tradelineRecommendation?.code &&
    !/^IH-\d+$/i.test(data.tradelineRecommendation.code)
  ) {
    errors.push("Tradeline code must use IH-N format only");
  }

  return { errors, warnings };
}

// ============================================================================
// OFG PROGRESS REPORT PDF (inline)
// ============================================================================

const NAVY = rgb(0.051, 0.122, 0.235);
const GOLD = rgb(0.788, 0.659, 0.298);
const GRAY = rgb(0.35, 0.35, 0.38);

type PdfLabels = {
  progressReport: (name: string) => string;
  scoreOverview: (name: string) => string;
  middleScore: (before: number, after: number) => string;
  winsTitle: string;
  noWins: string;
  targetsTitle: string;
  noTargets: string;
  utilTitle: string;
  utilEmpty: string;
  utilLine: (account: string, pct: number, pay: number) => string;
  positiveTitle: string;
  positiveDefault: string;
  roadmapTitle: (round: number) => string;
  scoreGoal: (goal: number, gap: number) => string;
  fileStrength: (score: number) => string;
  actionPlanTitle: string;
  croaTitle: string;
  footer: string;
  page2Header: string;
  page3Header: string;
};

const LABELS: Record<"en" | "es", PdfLabels> = {
  en: {
    progressReport: (name) => `Progress Report - ${name}`,
    scoreOverview: (name) => `${name} - Score Overview`,
    middleScore: (b, a) => `Middle Score: ${b} -> ${a}`,
    winsTitle: "What came off your report (Wins)",
    noWins: "No wins detected - verify against source PDFs.",
    targetsTitle: "Still on report (Round targets)",
    noTargets: "None detected",
    utilTitle: "Credit Utilization",
    utilEmpty: "Utilization details to be added as account data is available.",
    utilLine: (account, pct, pay) =>
      `${account}: ${pct}% used - pay to 30%: $${pay}`,
    positiveTitle: "Positive accounts working in your favor",
    positiveDefault: "On-time payment history on open accounts",
    roadmapTitle: (round) => `Round ${round} Milestone`,
    scoreGoal: (goal, gap) => `Score goal: ${goal} (gap: ${gap} pts)`,
    fileStrength: (score) => `File Strength Score: ${score}/100`,
    actionPlanTitle: "Your action plan",
    croaTitle: "CROA Disclosure",
    footer: "optimum-financial-group.com | (949) 736-5644",
    page2Header: "Utilization & What's Working",
    page3Header: "Roadmap & Action Plan",
  },
  es: {
    progressReport: (name) => `Informe de Progreso - ${name}`,
    scoreOverview: (name) => `${name} - Resumen de Puntajes`,
    middleScore: (b, a) => `Puntaje Medio: ${b} -> ${a}`,
    winsTitle: "Lo que salio de su reporte (Victorias)",
    noWins: "No se detectaron victorias - verifique los PDFs fuente.",
    targetsTitle: "Aun en el reporte (Objetivos de la ronda)",
    noTargets: "Ninguno detectado",
    utilTitle: "Utilizacion de Credito",
    utilEmpty:
      "Los detalles de utilizacion se agregaran cuando haya datos de cuentas.",
    utilLine: (account, pct, pay) =>
      `${account}: ${pct}% usado - pagar al 30%: $${pay}`,
    positiveTitle: "Cuentas positivas a su favor",
    positiveDefault: "Historial de pagos puntuales en cuentas abiertas",
    roadmapTitle: (round) => `Hito de la Ronda ${round}`,
    scoreGoal: (goal, gap) => `Meta de puntaje: ${goal} (brecha: ${gap} pts)`,
    fileStrength: (score) => `Puntaje de Fortaleza: ${score}/100`,
    actionPlanTitle: "Su plan de accion",
    croaTitle: "Divulgacion CROA",
    footer: "optimum-financial-group.com | (949) 736-5644",
    page2Header: "Utilizacion y Lo Que Funciona",
    page3Header: "Hoja de Ruta y Plan de Accion",
  },
};

function resolveLocale(data: OfGReportData): "en" | "es" {
  return data.locale === "es" ? "es" : "en";
}

/**
 * StandardFonts (Helvetica) use WinAnsi — Unicode arrows/dashes/bullets crash drawText.
 * Normalize common glyphs + strip any remaining non-WinAnsi code points.
 */
function toPdfSafeText(input: string): string {
  return String(input ?? "")
    .replace(/\u2192|\u21D2|\u2794|\u27A1/g, "->") // → ⇒ ➔ ➡
    .replace(/\u2190|\u21D0/g, "<-") // ← ⇐
    .replace(/[\u2013\u2014\u2015]/g, "-") // – — ―
    .replace(/\u2022|\u00B7|\u25CF|\u25E6/g, "*") // • · ● ○
    .replace(/\u2026/g, "...") // …
    .replace(/[\u2018\u2019\u2032]/g, "'") // ‘ ’ ′
    .replace(/[\u201C\u201D\u2033]/g, '"') // “ ” ″
    .replace(/\u00A0/g, " ") // nbsp
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?"); // remaining non-WinAnsi
}

function scoreBar(before: number, after: number, width = 28): string {
  const max = 850;
  const min = 300;
  const pct = Math.min(1, Math.max(0, (after - min) / (max - min)));
  const filled = Math.round(pct * width);
  const delta = after - before;
  const sign = delta >= 0 ? "+" : "";
  return `[${"=".repeat(filled)}${" ".repeat(Math.max(0, width - filled))}] ${before} -> ${after} (${sign}${delta} pts)`;
}

async function generateOfgProgressReportPdf(
  data: OfGReportData,
  fileNameHint: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const locale = resolveLocale(data);
  const L = LABELS[locale];
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const dateLocale = locale === "es" ? "es-US" : "en-US";
  const monthYear = new Date()
    .toLocaleDateString(dateLocale, { month: "short", year: "numeric" })
    .replace(" ", "");
  const fileName =
    fileNameHint ||
    `${data.client.firstName}_OFG_Progress_Report_${monthYear}.pdf`;

  const drawHeader = (
    page: ReturnType<PDFDocument["addPage"]>,
    title: string,
  ) => {
    const { width, height } = page.getSize();
    page.drawRectangle({
      x: 0,
      y: height - 56,
      width,
      height: 56,
      color: NAVY,
    });
    page.drawText("Optimum Financial Group", {
      x: 40,
      y: height - 32,
      size: 14,
      font: fontBold,
      color: GOLD,
    });
    page.drawText(toPdfSafeText(title), {
      x: 40,
      y: height - 48,
      size: 9,
      font,
      color: rgb(1, 1, 1),
    });
  };

  const writeLines = (
    page: ReturnType<PDFDocument["addPage"]>,
    lines: string[],
    startY: number,
    size = 10,
  ) => {
    let y = startY;
    for (const line of lines) {
      if (y < 60) break;
      page.drawText(toPdfSafeText(line).slice(0, 95), {
        x: 40,
        y,
        size,
        font,
        color: GRAY,
      });
      y -= size + 6;
    }
    return y;
  };

  const drawSafe = (
    page: ReturnType<PDFDocument["addPage"]>,
    text: string,
    opts: {
      x: number;
      y: number;
      size: number;
      font: typeof font;
      color: ReturnType<typeof rgb>;
    },
  ) => {
    page.drawText(toPdfSafeText(text), opts);
  };

  const p1 = pdf.addPage([612, 792]);
  drawHeader(p1, L.progressReport(data.client.firstName));
  let y = 700;
  drawSafe(p1, L.scoreOverview(data.client.firstName), {
    x: 40,
    y,
    size: 16,
    font: fontBold,
    color: NAVY,
  });
  y -= 28;
  const todayIso = new Date().toISOString().slice(0, 10);
  const beforeDate = data.reportDate?.before || todayIso;
  const afterDate = data.reportDate?.after || todayIso;
  const dateLabel =
    locale === "es"
      ? `Fechas del informe: ${beforeDate} -> ${afterDate}`
      : `Report dates: ${beforeDate} -> ${afterDate}`;
  drawSafe(p1, dateLabel, {
    x: 40,
    y,
    size: 9,
    font,
    color: GRAY,
  });
  y -= 18;
  drawSafe(p1, L.middleScore(data.middleScore.before, data.middleScore.after), {
    x: 40,
    y,
    size: 11,
    font: fontBold,
    color: NAVY,
  });
  y -= 22;
  const bars = [
    `TransUnion: ${scoreBar(data.bureauScores.transunion.before, data.bureauScores.transunion.after)}`,
    `Experian:   ${scoreBar(data.bureauScores.experian.before, data.bureauScores.experian.after)}`,
    `Equifax:    ${scoreBar(data.bureauScores.equifax.before, data.bureauScores.equifax.after)}`,
  ];
  y = writeLines(p1, bars, y, 9);
  y -= 10;
  drawSafe(p1, L.winsTitle, {
    x: 40,
    y,
    size: 12,
    font: fontBold,
    color: NAVY,
  });
  y -= 18;
  if (data.wins.length === 0) {
    y = writeLines(p1, [L.noWins], y);
  } else {
    y = writeLines(
      p1,
      data.wins.map(
        (w, i) =>
          `${i + 1}. ${w.itemRemoved} - ${w.bureaus.join("/")} - ${w.status}`,
      ),
      y,
      9,
    );
  }
  y -= 8;
  drawSafe(p1, L.targetsTitle, {
    x: 40,
    y,
    size: 12,
    font: fontBold,
    color: NAVY,
  });
  y -= 18;
  y = writeLines(
    p1,
    data.targets.length
      ? data.targets.map((t, i) => `${i + 1}. ${t.item}`)
      : [L.noTargets],
    y,
    9,
  );

  const p2 = pdf.addPage([612, 792]);
  drawHeader(p2, L.page2Header);
  y = 700;
  drawSafe(p2, L.utilTitle, {
    x: 40,
    y,
    size: 14,
    font: fontBold,
    color: NAVY,
  });
  y -= 22;
  y = writeLines(
    p2,
    data.utilization.length
      ? data.utilization.map((u) => L.utilLine(u.account, u.pctUsed, u.payTo30))
      : [L.utilEmpty],
    y,
    9,
  );
  y -= 12;
  drawSafe(p2, L.positiveTitle, {
    x: 40,
    y,
    size: 12,
    font: fontBold,
    color: NAVY,
  });
  y -= 18;
  y = writeLines(
    p2,
    data.positiveAccounts.length ? data.positiveAccounts : [L.positiveDefault],
    y,
    9,
  );

  const p3 = pdf.addPage([612, 792]);
  drawHeader(p3, L.page3Header);
  y = 700;
  drawSafe(p3, L.roadmapTitle(data.roadmap.currentRound), {
    x: 40,
    y,
    size: 14,
    font: fontBold,
    color: NAVY,
  });
  y -= 22;
  y = writeLines(
    p3,
    [
      L.scoreGoal(data.roadmap.scoreGoal, data.roadmap.gapRemaining),
      L.fileStrength(data.fileStrengthScore),
      ...data.roadmap.milestones.map((m) => `* ${m}`),
    ],
    y,
    10,
  );
  y -= 10;
  drawSafe(p3, L.actionPlanTitle, {
    x: 40,
    y,
    size: 12,
    font: fontBold,
    color: NAVY,
  });
  y -= 18;
  y = writeLines(
    p3,
    data.actionPlan.map(
      (a) => `${a.step}. [${a.owner.toUpperCase()}] ${a.description}`,
    ),
    y,
    9,
  );
  if (data.tradelineRecommendation) {
    y -= 8;
    y = writeLines(
      p3,
      [
        `Tradeline (${data.tradelineRecommendation.code}): ${data.tradelineRecommendation.projectedImpact}`,
      ],
      y,
      9,
    );
  }
  if (data.fundingReadinessNote) {
    y -= 8;
    y = writeLines(p3, [data.fundingReadinessNote], y, 9);
  }
  y -= 16;
  drawSafe(p3, L.croaTitle, {
    x: 40,
    y,
    size: 10,
    font: fontBold,
    color: NAVY,
  });
  y -= 14;
  writeLines(p3, [data.croaDisclosure], y, 8);
  drawSafe(p3, L.footer, {
    x: 40,
    y: 40,
    size: 8,
    font,
    color: GRAY,
  });

  const bytes = await pdf.save();
  return { buffer: Buffer.from(bytes), fileName };
}

function reportDataToSummaryMd(data: OfGReportData): string {
  const todayIso = new Date().toISOString().slice(0, 10);
  const beforeDate = data.reportDate?.before || todayIso;
  const afterDate = data.reportDate?.after || todayIso;
  const lines = [
    `## Round ${data.roadmap.currentRound} Progress`,
    "",
    `Report dates: **${beforeDate}** → **${afterDate}**`,
    "",
    `Middle score: **${data.middleScore.before}** → **${data.middleScore.after}**`,
    "",
    "### Wins",
    ...data.wins.map(
      (w) =>
        `- ${w.itemRemoved}${w.bureaus?.length ? ` (${w.bureaus.join("/")})` : ""}`,
    ),
    "",
    "### Next targets",
    ...data.targets.map(
      (t) =>
        `- ${t.item}${t.bureaus?.length ? ` (${t.bureaus.join("/")})` : ""}`,
    ),
  ];
  return lines.join("\n");
}

// Silently swallow connection-level errors so a dead pooled connection doesn't
// crash the process — mysql2 will discard it and open a fresh one on the next query.
const TRANSIENT_DB_CODES = [
  "ECONNRESET",
  "PROTOCOL_CONNECTION_LOST",
  "ETIMEDOUT",
  "ECONNREFUSED",
];

pool.on("connection", (conn) => {
  conn.on("error", (err: NodeJS.ErrnoException) => {
    if (!TRANSIENT_DB_CODES.includes(err.code ?? "")) throw err;
  });
});

// Pool-level safety net (catches errors not handled at the connection level)
(pool as any).on("error", (err: NodeJS.ErrnoException) => {
  if (!TRANSIENT_DB_CODES.includes(err.code ?? "")) throw err;
});

// ============================================================================
// EXTERNAL CLIENTS (Email / Twilio / Authorize.net) — all with graceful fallback
// ============================================================================

const FROM_EMAIL =
  process.env.SMTP_FROM || "Optimum <no-reply@disruptinglabs.com>";
let emailClient: Resend | null = null;
if (process.env.RESEND_API_KEY) {
  emailClient = new Resend(process.env.RESEND_API_KEY);
  console.log("✅ Email provider initialized");
} else {
  console.warn("⚠️  RESEND_API_KEY not set — emails will be logged, not sent");
}

let twilioClient: ReturnType<typeof twilio> | null = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    );
    console.log("✅ Twilio initialized");
  } catch (err) {
    console.warn("⚠️  Twilio init failed:", err);
  }
} else {
  console.warn("⚠️  Twilio not configured — SMS/calls will be logged only");
}
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

const AUTHORIZENET_URL =
  process.env.AUTHORIZENET_SANDBOX !== "false"
    ? "https://apitest.authorize.net/xml/v1/request.api"
    : "https://api.authorize.net/xml/v1/request.api";
const authorizeNetConfigured = !!(
  process.env.AUTHORIZENET_API_LOGIN_ID &&
  process.env.AUTHORIZENET_TRANSACTION_KEY
);
if (authorizeNetConfigured) {
  console.log(
    "✅ Authorize.net initialized (",
    process.env.AUTHORIZENET_SANDBOX !== "false" ? "sandbox" : "production",
    ")",
  );
} else {
  console.warn(
    "⚠️  AUTHORIZENET_API_LOGIN_ID / AUTHORIZENET_TRANSACTION_KEY not set — payments will use mock mode",
  );
}

function mockPaymentsAllowed(): boolean {
  if (authorizeNetConfigured) return false;
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.AUTHORIZENET_SANDBOX === "false") return false;
  return true;
}

// ============================================================================
// AUTH HELPERS
// ============================================================================

type ActorType = "client" | "admin";
interface JwtPayload {
  actor: ActorType;
  id: number;
  email: string;
  jti: string;
}
interface AuthedRequest extends Request {
  auth?: JwtPayload;
}

// ============================================================================
// FILE ENCRYPTION HELPERS (AES-256-GCM)
// ============================================================================

function getDocEncKey(): Buffer {
  const hex = process.env.DOC_ENCRYPTION_KEY || "";
  const isValidHex = hex.length === 64 && /^[0-9a-fA-F]{64}$/.test(hex);
  if (!isValidHex) {
    if (IS_PROD) {
      throw new Error(
        "DOC_ENCRYPTION_KEY is not set or invalid — refusing to use an insecure fallback in production",
      );
    }
    console.warn(
      "⚠️  DOC_ENCRYPTION_KEY not set or invalid — using insecure fallback (local/dev only)",
    );
    return Buffer.alloc(32, 0);
  }
  return Buffer.from(hex, "hex");
}

function encryptFile(buf: Buffer): {
  encrypted: Buffer;
  iv: string;
  tag: string;
} {
  const key = getDocEncKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buf), cipher.final()]);
  return {
    encrypted,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}

function decryptFile(encrypted: Buffer, ivHex: string, tagHex: string): Buffer {
  const key = getDocEncKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function encryptJsonSecrets(payload: Record<string, unknown>): {
  ciphertext: Buffer;
  iv: string;
  tag: string;
} {
  const { encrypted, iv, tag } = encryptFile(
    Buffer.from(JSON.stringify(payload), "utf8"),
  );
  return { ciphertext: encrypted, iv, tag };
}

function decryptJsonSecrets(
  ciphertext: Buffer,
  ivHex: string,
  tagHex: string,
): Record<string, unknown> {
  const raw = decryptFile(ciphertext, ivHex, tagHex).toString("utf8");
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Upload a file buffer to the Disrupting Labs CDN and return the full public URL.
 * The URL is stored as storage_key in the DB and is never sent directly to the browser —
 * all access is proxied through the authenticated Express file-serve endpoints.
 */
async function uploadToCDN(
  buffer: Buffer,
  originalname: string,
  mimetype: string,
  clientId: number | string,
): Promise<string> {
  if (!CDN_UPLOAD_SECRET)
    throw new Error("CDN_UPLOAD_SECRET is not configured");
  // Opaque folder id: a bare `client-123` folder on the CDN is guessable —
  // anyone iterating IDs could probe for other clients' folders (the CDN
  // itself has no per-tenant auth; our API is the only access control, and
  // that's bypassed once you know/guess the folder path). Appending a random
  // suffix makes the folder unguessable while the real clientId still lives
  // only in our DB metadata / storage_key, never in a URL pattern an
  // attacker could iterate.
  const folderId = `c-${clientId}-${crypto.randomUUID().slice(0, 8)}`;
  const formData = new FormData();
  formData.append("main_folder", CDN_MAIN_FOLDER);
  formData.append("id", folderId);
  formData.append(
    "files[]",
    new Blob([new Uint8Array(buffer)], { type: mimetype }),
    originalname,
  );
  const res = await fetch(CDN_UPLOAD_URL, {
    method: "POST",
    headers: { "X-Api-Key": CDN_UPLOAD_SECRET },
    body: formData,
  });
  if (!res.ok) throw new Error(`CDN upload failed: ${res.status}`);
  const data = (await res.json()) as any;
  const uploaded = data?.uploaded?.[0];
  if (!uploaded?.url)
    throw new Error(
      "CDN upload returned no URL: " + (data?.error ?? "unknown"),
    );
  return uploaded.url as string;
}

/** Best-effort CDN cleanup when DB writes fail after upload (requires CDN_DELETE_URL). */
async function deleteFromCDN(storageUrl: string): Promise<void> {
  const deleteUrl = process.env.CDN_DELETE_URL;
  if (!deleteUrl || !CDN_UPLOAD_SECRET || !storageUrl) return;
  const res = await fetch(deleteUrl, {
    method: "POST",
    headers: {
      "X-Api-Key": CDN_UPLOAD_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: storageUrl }),
  });
  if (!res.ok) {
    console.warn(
      `[cdn:delete] Failed (${res.status}) for ${storageUrl.slice(0, 80)}…`,
    );
  }
}

// ============================================================================
// ONBOARDING TOKEN HELPERS (magic link after payment)
// ============================================================================

async function createOnboardingToken(
  clientId: number,
  ttlHours: number = ONBOARDING_TOKEN_TTL_HOURS,
): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await pool.query<ResultSetHeader>(
    `INSERT INTO onboarding_tokens (client_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [clientId, tokenHash, expiresAt],
  );
  return rawToken;
}

async function consumeOnboardingToken(
  rawToken: string,
): Promise<number | null> {
  const tokenHash = sha256(rawToken);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, client_id FROM onboarding_tokens
     WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash],
  );
  if (rows.length === 0) return null;
  await pool.query<ResultSetHeader>(
    `UPDATE onboarding_tokens SET consumed_at = NOW() WHERE id = ?`,
    [rows[0].id],
  );
  return rows[0].client_id as number;
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Constant-time secret comparison. Pads both buffers to the same (max)
 * length before comparing so `crypto.timingSafeEqual` never throws on a
 * length mismatch — a length-mismatch failure would otherwise itself be
 * a (crude) timing side-channel, so we always compare a fixed size.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length, 1);
  const bufA = Buffer.alloc(len);
  const bufB = Buffer.alloc(len);
  bufA.write(a);
  bufB.write(b);
  return crypto.timingSafeEqual(bufA, bufB) && a.length === b.length;
}

// ============================================================================
// IN-MEMORY RATE LIMITER
// ----------------------------------------------------------------------------
// Best-effort, per-instance limiter — good enough to blunt brute-force /
// credential-stuffing bursts on a single serverless instance without adding
// an external store. Resets on cold start; that's an acceptable trade-off
// for these endpoints (OTP, registration, payments already have their own
// DB-level guards as the real backstop).
// ============================================================================
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function hitRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  sweepRateLimitBuckets();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  if (bucket.count > max) return true;
  return false;
}

// Opportunistic cleanup so the map doesn't grow unbounded on long-lived
// instances. Cheap since buckets are tiny; runs at most once/minute.
let lastRateLimitSweep = 0;
function sweepRateLimitBuckets() {
  const now = Date.now();
  if (now - lastRateLimitSweep < 60_000) return;
  lastRateLimitSweep = now;
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}

function rateLimitKey(req: Request, suffix: string): string {
  const ip = req.ip || "unknown-ip";
  return `${suffix}:${ip}`;
}

function generateOtpCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function signSessionToken(payload: Omit<JwtPayload, "jti">) {
  const jti = crypto.randomBytes(16).toString("hex");
  const token = jwt.sign({ ...payload, jti }, JWT_SECRET, {
    expiresIn: `${SESSION_TTL_DAYS}d`,
  });
  return { token, jti };
}

function verifySessionToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

async function createOtp(
  actor: ActorType,
  actorId: number,
  purpose: string,
  ip?: string,
): Promise<string> {
  const code = generateOtpCode();
  const codeHash = sha256(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
  const table = actor === "admin" ? "admin_otp_codes" : "client_otp_codes";
  const idCol = actor === "admin" ? "admin_id" : "client_id";
  await pool.query<ResultSetHeader>(
    `INSERT INTO ${table} (${idCol}, code_hash, purpose, expires_at, ip_address) VALUES (?,?,?,?,?)`,
    [actorId, codeHash, purpose, expiresAt, ip || null],
  );
  return code;
}

const OTP_MAX_ATTEMPTS = 5;

/**
 * Look up the latest unconsumed, unexpired OTP for this actor+purpose
 * (regardless of code) and check the submitted code against it. This closes
 * two gaps in the old "match code_hash directly" approach: (1) a caller could
 * brute-force codes indefinitely since a wrong guess never touched the row,
 * and (2) requesting a fresh code left the old one guessable in parallel.
 * Now every wrong guess increments `attempts` on the live OTP row, and once
 * attempts >= OTP_MAX_ATTEMPTS the OTP is dead even with the right code.
 */
async function consumeOtp(
  actor: ActorType,
  actorId: number,
  code: string,
  purpose: string,
): Promise<boolean> {
  const table = actor === "admin" ? "admin_otp_codes" : "client_otp_codes";
  const idCol = actor === "admin" ? "admin_id" : "client_id";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, code_hash, attempts FROM ${table}
     WHERE ${idCol} = ? AND purpose = ?
       AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [actorId, purpose],
  );
  if (rows.length === 0) return false;
  const otp = rows[0];

  if (Number(otp.attempts) >= OTP_MAX_ATTEMPTS) {
    // Locked out — burn it so it can't linger as a target.
    await pool.query<ResultSetHeader>(
      `UPDATE ${table} SET consumed_at = NOW() WHERE id = ?`,
      [otp.id],
    );
    return false;
  }

  const codeHash = sha256(code);
  if (codeHash !== otp.code_hash) {
    await pool.query<ResultSetHeader>(
      `UPDATE ${table} SET attempts = attempts + 1 WHERE id = ?`,
      [otp.id],
    );
    return false;
  }

  await pool.query<ResultSetHeader>(
    `UPDATE ${table} SET consumed_at = NOW() WHERE id = ?`,
    [otp.id],
  );
  return true;
}

async function createSession(
  actor: ActorType,
  actorId: number,
  email: string,
  ip?: string,
  userAgent?: string,
): Promise<string> {
  const { token, jti } = signSessionToken({ actor, id: actorId, email });
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const table = actor === "admin" ? "admin_sessions" : "client_sessions";
  const idCol = actor === "admin" ? "admin_id" : "client_id";
  await pool.query<ResultSetHeader>(
    `INSERT INTO ${table} (${idCol}, token_hash, ip_address, user_agent, expires_at) VALUES (?,?,?,?,?)`,
    [actorId, sha256(jti), ip || null, userAgent || null, expiresAt],
  );
  return token;
}

async function revokeSession(token: string): Promise<void> {
  const payload = verifySessionToken(token);
  if (!payload) return;
  const table =
    payload.actor === "admin" ? "admin_sessions" : "client_sessions";
  await pool.query<ResultSetHeader>(
    `UPDATE ${table} SET is_active = 0 WHERE token_hash = ?`,
    [sha256(payload.jti)],
  );
}

async function isSessionActive(payload: JwtPayload): Promise<boolean> {
  const table =
    payload.actor === "admin" ? "admin_sessions" : "client_sessions";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM ${table}
     WHERE token_hash = ? AND is_active = 1 AND expires_at > NOW() LIMIT 1`,
    [sha256(payload.jti)],
  );
  return rows.length > 0;
}

/**
 * Kill every active session for an actor — used when an admin/client is
 * deactivated/suspended/cancelled so a leaked or still-open token can't
 * keep working until it naturally expires (up to SESSION_TTL_DAYS later).
 */
async function revokeAllSessions(
  actor: ActorType,
  actorId: number,
): Promise<void> {
  const table = actor === "admin" ? "admin_sessions" : "client_sessions";
  const idCol = actor === "admin" ? "admin_id" : "client_id";
  await pool.query<ResultSetHeader>(
    `UPDATE ${table} SET is_active = 0 WHERE ${idCol} = ? AND is_active = 1`,
    [actorId],
  );
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

function requireAuth(actor: ActorType) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const payload = verifySessionToken(token);
    if (!payload || payload.actor !== actor) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const ok = await isSessionActive(payload);
    if (!ok) return res.status(401).json({ error: "Session expired" });

    // Re-check the actor's current status on every request — a session
    // token stays cryptographically valid for SESSION_TTL_DAYS, so without
    // this a deactivated admin or cancelled client could keep using an
    // already-issued token until it expires on its own.
    if (actor === "admin") {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT status FROM admins WHERE id = ? LIMIT 1`,
        [payload.id],
      );
      if (rows.length === 0 || rows[0].status !== "active") {
        return res.status(401).json({ error: "Account is no longer active" });
      }
    } else {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT status FROM clients WHERE id = ? LIMIT 1`,
        [payload.id],
      );
      if (rows.length === 0 || rows[0].status === "cancelled") {
        return res.status(401).json({ error: "Account is no longer active" });
      }
    }

    req.auth = payload;
    next();
  };
}
const requireClient = requireAuth("client");
const requireAdmin = requireAuth("admin");

async function requireSuperAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const payload = verifySessionToken(token);
  if (!payload || payload.actor !== "admin") {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const ok = await isSessionActive(payload);
  if (!ok) return res.status(401).json({ error: "Session expired" });
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT role FROM admins WHERE id = ? LIMIT 1`,
    [payload.id],
  );
  if (rows[0]?.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden: super_admin required" });
  }
  req.auth = payload;
  next();
}

// ============================================================================
// EMAIL HELPERS
// ============================================================================

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
}

/** Vitest-only capture of dry-run emails (attachments included). */
type EmailDryRunRecord = {
  to: string;
  subject: string;
  attachmentNames: string[];
  hasCalendarAttachment: boolean;
  attachmentBytes: number[];
  /** First SEQUENCE value found in an attached .ics (if any). */
  icsSequence: number | null;
};
let emailDryRuns: EmailDryRunRecord[] = [];

export function __testClearEmailDryRuns() {
  emailDryRuns = [];
}

export function __testGetEmailDryRuns(): EmailDryRunRecord[] {
  return emailDryRuns.slice();
}

/** Test-only: payment-success side effects (promotes prospect-stage cases). */
export async function __testMarkPaymentSucceeded(
  clientId: number,
  transactionId: string,
) {
  return markPaymentSucceeded(clientId, transactionId);
}

async function sendEmail(opts: SendEmailOptions) {
  // Never hit Resend during vitest — integration suites use fake
  // @*.test addresses that bounce and pollute the sending domain.
  if (!emailClient || process.env.VITEST === "true") {
    if (process.env.VITEST === "true") {
      let icsSequence: number | null = null;
      for (const a of opts.attachments ?? []) {
        const isIcs =
          a.filename.endsWith(".ics") ||
          String(a.contentType || "").includes("text/calendar");
        if (!isIcs) continue;
        const text = Buffer.isBuffer(a.content)
          ? a.content.toString("utf8")
          : String(a.content);
        const m = /SEQUENCE:(\d+)/.exec(text);
        if (m) {
          icsSequence = Number(m[1]);
          break;
        }
      }
      emailDryRuns.push({
        to: opts.to,
        subject: opts.subject,
        attachmentNames: (opts.attachments ?? []).map((a) => a.filename),
        hasCalendarAttachment: (opts.attachments ?? []).some(
          (a) =>
            a.filename.endsWith(".ics") ||
            String(a.contentType || "").includes("text/calendar"),
        ),
        attachmentBytes: (opts.attachments ?? []).map((a) =>
          Buffer.isBuffer(a.content)
            ? a.content.length
            : Buffer.byteLength(String(a.content), "utf8"),
        ),
        icsSequence,
      });
    }
    console.log(
      "[email:dry-run]",
      opts.to,
      opts.subject,
      opts.attachments?.length
        ? `(${opts.attachments.length} attachment(s))`
        : "",
    );
    return { id: "dry-run" };
  }
  const { data, error } = await emailClient.emails.send({
    from: FROM_EMAIL,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    replyTo: opts.replyTo,
    attachments: opts.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });
  if (error) throw new Error(error.message);
  console.log("[email:sent]", opts.to, opts.subject, data?.id || "(no-id)");
  return { id: data?.id };
}

/** Default spacing between expected round-completion dates (all-day). */
export const DEFAULT_ROUND_INTERVAL_DAYS = 35;

function formatDateYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalize MySQL DATE / ISO string to YYYY-MM-DD without TZ drift.
 *  Pool uses `timezone: "+00:00"`, so DATE columns arrive as UTC midnight —
 *  always read Y/M/D via UTC getters for Date objects.
 */
export function mysqlDateToYmd(v: unknown): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const day = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const s = String(v ?? "");
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  return formatDateYmd(new Date());
}

function parseDateYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt;
}

/** Prefill five all-day round target dates from a start day + interval. */
export function buildDefaultRoundScheduleDates(
  start: Date = new Date(),
  intervalDays = DEFAULT_ROUND_INTERVAL_DAYS,
): {
  round_1_date: string;
  round_2_date: string;
  round_3_date: string;
  round_4_date: string;
  round_5_date: string;
} {
  const base = new Date(
    Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()),
  );
  const days = Math.max(1, Math.min(120, Number(intervalDays) || DEFAULT_ROUND_INTERVAL_DAYS));
  const out: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + days * i);
    out.push(formatDateYmd(d));
  }
  return {
    round_1_date: out[0],
    round_2_date: out[1],
    round_3_date: out[2],
    round_4_date: out[3],
    round_5_date: out[4],
  };
}

export function validateRoundScheduleDates(input: {
  round_1_date?: string;
  round_2_date?: string;
  round_3_date?: string;
  round_4_date?: string;
  round_5_date?: string;
}):
  | {
      ok: true;
      dates: {
        round_1_date: string;
        round_2_date: string;
        round_3_date: string;
        round_4_date: string;
        round_5_date: string;
      };
    }
  | { ok: false; error: string } {
  const keys = [
    "round_1_date",
    "round_2_date",
    "round_3_date",
    "round_4_date",
    "round_5_date",
  ] as const;
  const dates: Record<(typeof keys)[number], string> = {} as any;
  const parsed: Date[] = [];
  for (const k of keys) {
    const raw = input[k];
    const dt = parseDateYmd(String(raw || ""));
    if (!dt) return { ok: false, error: `Invalid ${k} (use YYYY-MM-DD)` };
    dates[k] = formatDateYmd(dt);
    parsed.push(dt);
  }
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].getTime() < parsed[i - 1].getTime()) {
      return {
        ok: false,
        error: "Round dates must be in non-decreasing order (R1 ≤ R2 ≤ … ≤ R5)",
      };
    }
  }
  return { ok: true, dates: dates as any };
}

function icsFoldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (start === 0 ? 75 : 74), bytes.length);
    // Avoid splitting multi-byte UTF-8 mid-character
    while (end > start && (bytes[end] & 0xc0) === 0x80) end--;
    const chunk = bytes.subarray(start, end).toString("utf8");
    parts.push(start === 0 ? chunk : ` ${chunk}`);
    start = end;
  }
  return parts.join("\r\n");
}

function icsEscapeText(s: string): string {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

function ymdToIcsDate(ymd: string): string {
  return ymd.replace(/-/g, "");
}

function nextDayYmd(ymd: string): string {
  const d = parseDateYmd(ymd)!;
  d.setUTCDate(d.getUTCDate() + 1);
  return formatDateYmd(d);
}

/** Build a single METHOD:PUBLISH calendar with 5 all-day round VEVENTs (stable UIDs). */
export function buildRoundScheduleIcs(opts: {
  caseNumber: string;
  clientName: string;
  uidNs: string;
  dates: {
    round_1_date: string;
    round_2_date: string;
    round_3_date: string;
    round_4_date: string;
    round_5_date: string;
  };
  lang?: string;
  /** ICS SEQUENCE — bump on resend so clients can replace prior events. */
  sequence?: number;
}): string {
  const isEs = opts.lang === "es";
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const sequence = Math.max(0, Number(opts.sequence) || 0);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Optimum Credit//Round Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  const rounds = [
    { n: 1, date: opts.dates.round_1_date },
    { n: 2, date: opts.dates.round_2_date },
    { n: 3, date: opts.dates.round_3_date },
    { n: 4, date: opts.dates.round_4_date },
    { n: 5, date: opts.dates.round_5_date },
  ];
  for (const r of rounds) {
    const summary = isEs
      ? `Optimum Credit — Meta Ronda ${r.n} (${opts.caseNumber})`
      : `Optimum Credit — Round ${r.n} target (${opts.caseNumber})`;
    const desc = isEs
      ? `Fecha objetivo de completación de la Ronda ${r.n} para ${opts.clientName}. Caso ${opts.caseNumber}. Esta es una fecha planificada — el avance real puede variar.`
      : `Target completion date for Round ${r.n} for ${opts.clientName}. Case ${opts.caseNumber}. This is a planned target — actual progress may vary.`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:oc-${opts.uidNs}-r${r.n}@optimumcredit.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymdToIcsDate(r.date)}`,
      `DTEND;VALUE=DATE:${ymdToIcsDate(nextDayYmd(r.date))}`,
      `SEQUENCE:${sequence}`,
      `SUMMARY:${icsEscapeText(summary)}`,
      `DESCRIPTION:${icsEscapeText(desc)}`,
      "TRANSP:TRANSPARENT",
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFoldLine).join("\r\n") + "\r\n";
}

function tplRoundCalendarInvite(opts: {
  firstName: string;
  clientName: string;
  caseNumber: string;
  dates: {
    round_1_date: string;
    round_2_date: string;
    round_3_date: string;
    round_4_date: string;
    round_5_date: string;
  };
  recipientRole: "client" | "referrer" | "admin";
  lang?: string;
  isUpdate?: boolean;
}) {
  const isEs = opts.lang === "es";
  const list = [1, 2, 3, 4, 5]
    .map((n) => {
      const key = `round_${n}_date` as keyof typeof opts.dates;
      return `<li style="margin:0 0 4px;"><strong>${isEs ? "Ronda" : "Round"} ${n}:</strong> ${escapeHtml(opts.dates[key])}</li>`;
    })
    .join("");
  const roleHint =
    opts.recipientRole === "client"
      ? isEs
        ? "Adjunta el archivo .ics a tu calendario (Google, Apple u Outlook) para recordarte cada meta de ronda."
        : "Attach the .ics file to your calendar (Google, Apple, or Outlook) so each round target is on your schedule."
      : opts.recipientRole === "referrer"
        ? isEs
          ? `Estas son las metas de ronda planificadas para <strong>${escapeHtml(opts.clientName)}</strong>. Añade el .ics a tu calendario para hacer seguimiento.`
          : `These are the planned round targets for <strong>${escapeHtml(opts.clientName)}</strong>. Add the .ics to your calendar to stay aligned.`
        : isEs
          ? `Calendario de rondas para <strong>${escapeHtml(opts.clientName)}</strong> (${escapeHtml(opts.caseNumber)}).`
          : `Round schedule for <strong>${escapeHtml(opts.clientName)}</strong> (${escapeHtml(opts.caseNumber)}).`;
  const title = opts.isUpdate
    ? isEs
      ? "Calendario de rondas actualizado"
      : "Updated round calendar"
    : isEs
      ? "Fechas de ronda en tu calendario"
      : "Round dates for your calendar";
  const body = `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">${title}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
      ${isEs ? "Hola" : "Hi"} ${escapeHtml(opts.firstName)},
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${roleHint}</p>
    <ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.6;color:#334155;">${list}</ul>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#64748b;">
      ${
        isEs
          ? "Si ya tenías estos eventos, vuelve a importar el archivo adjunto para actualizarlos (mismos identificadores)."
          : "If you already added these events, re-import the attached file to update them (same event IDs)."
      }
    </p>`;
  return {
    subject: opts.isUpdate
      ? isEs
        ? `Calendario actualizado — ${opts.caseNumber}`
        : `Updated calendar — ${opts.caseNumber}`
      : isEs
        ? `Calendario de rondas — ${opts.caseNumber}`
        : `Round calendar — ${opts.caseNumber}`,
    html: emailLayout({
      title,
      preheader: opts.caseNumber,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

async function upsertCaseRoundSchedule(
  caseId: number,
  dates: {
    round_1_date: string;
    round_2_date: string;
    round_3_date: string;
    round_4_date: string;
    round_5_date: string;
  },
  intervalDays: number,
  conn?: any,
): Promise<{ calendar_uid_ns: string; is_new: boolean }> {
  const q = conn || pool;
  const [existing] = await q.query(
    `SELECT id, calendar_uid_ns FROM case_round_schedules WHERE case_id = ? LIMIT 1`,
    [caseId],
  );
  const rows = existing as any[];
  if (rows.length > 0) {
    await q.query(
      `UPDATE case_round_schedules
       SET round_1_date = ?, round_2_date = ?, round_3_date = ?,
           round_4_date = ?, round_5_date = ?, interval_days = ?
       WHERE case_id = ?`,
      [
        dates.round_1_date,
        dates.round_2_date,
        dates.round_3_date,
        dates.round_4_date,
        dates.round_5_date,
        intervalDays,
        caseId,
      ],
    );
    return { calendar_uid_ns: rows[0].calendar_uid_ns as string, is_new: false };
  }
  const uidNs = `case${caseId}-${crypto.randomBytes(6).toString("hex")}`;
  await q.query(
    `INSERT INTO case_round_schedules
      (case_id, round_1_date, round_2_date, round_3_date, round_4_date, round_5_date,
       interval_days, calendar_uid_ns)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      caseId,
      dates.round_1_date,
      dates.round_2_date,
      dates.round_3_date,
      dates.round_4_date,
      dates.round_5_date,
      intervalDays,
      uidNs,
    ],
  );
  return { calendar_uid_ns: uidNs, is_new: true };
}

async function resolveRoundCalendarRecipients(clientId: number): Promise<
  Array<{
    email: string;
    firstName: string;
    role: "client" | "referrer" | "admin";
    lang: string;
    adminId?: number;
  }>
> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.first_name AS client_first, c.last_name AS client_last, c.email AS client_email,
            c.preferred_language AS client_lang,
            r.first_name AS ref_first, r.email AS ref_email, r.preferred_language AS ref_lang,
            a.id AS admin_id, a.first_name AS admin_first, a.email AS admin_email,
            a.preferred_language AS admin_lang, a.notification_prefs_json AS admin_prefs
     FROM clients c
     LEFT JOIN referrers r ON r.id = c.referrer_id AND r.status = 'active'
     LEFT JOIN admins a ON a.id = c.assigned_admin_id AND a.status = 'active'
     WHERE c.id = ? LIMIT 1`,
    [clientId],
  );
  if (!rows.length) return [];
  const row = rows[0];
  const out: Array<{
    email: string;
    firstName: string;
    role: "client" | "referrer" | "admin";
    lang: string;
    adminId?: number;
  }> = [];
  const seen = new Set<string>();
  const push = (
    email: unknown,
    firstName: unknown,
    role: "client" | "referrer" | "admin",
    lang: unknown,
    adminId?: number,
  ) => {
    const e = String(email || "")
      .trim()
      .toLowerCase();
    if (!e || !e.includes("@") || seen.has(e)) return;
    seen.add(e);
    out.push({
      email: e,
      firstName: String(firstName || "there").trim() || "there",
      role,
      lang: String(lang || "en") === "es" ? "es" : "en",
      adminId,
    });
  };
  push(row.client_email, row.client_first, "client", row.client_lang);
  push(row.ref_email, row.ref_first, "referrer", row.ref_lang || row.client_lang);
  if (row.admin_id) {
    const prefs = parseAdminNotificationPrefs(row.admin_prefs);
    if (adminNotifyPrefOn(prefs, "email", "round_calendar")) {
      push(
        row.admin_email,
        row.admin_first,
        "admin",
        row.admin_lang || row.client_lang,
        Number(row.admin_id),
      );
    }
  }
  return out;
}

async function sendCaseRoundCalendarInvites(opts: {
  caseId: number;
  clientId: number;
  caseNumber: string;
  clientName: string;
  dates: {
    round_1_date: string;
    round_2_date: string;
    round_3_date: string;
    round_4_date: string;
    round_5_date: string;
  };
  uidNs: string;
  isUpdate?: boolean;
}): Promise<{ sent_to: string[]; errors: string[]; sequence: number }> {
  const [schedRows] = await pool.query<RowDataPacket[]>(
    `SELECT calendar_send_count FROM case_round_schedules WHERE case_id = ? LIMIT 1`,
    [opts.caseId],
  );
  const priorCount = Number(schedRows[0]?.calendar_send_count ?? 0);
  const sequence = priorCount; // 0 first send, then 1, 2, …
  const recipients = await resolveRoundCalendarRecipients(opts.clientId);
  const sent_to: string[] = [];
  const errors: string[] = [];

  // In-app for assigned admin even when email recipients are empty
  // (e.g. phone-only client + admin muted round_calendar email).
  try {
    const [aRows] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.notification_prefs_json
       FROM clients c
       JOIN admins a ON a.id = c.assigned_admin_id AND a.status = 'active'
       WHERE c.id = ? LIMIT 1`,
      [opts.clientId],
    );
    if (aRows[0]) {
      const prefs = parseAdminNotificationPrefs(aRows[0].notification_prefs_json);
      if (adminNotifyPrefOn(prefs, "in_app", "round_calendar")) {
        await insertAdminInAppNotification({
          adminId: Number(aRows[0].id),
          eventKey: "round_calendar",
          title: `Round calendar — ${opts.caseNumber}`,
          body: `Calendar invite sent for ${opts.clientName}`,
          linkUrl: `${APP_URL}/admin/pipeline?case=${opts.caseId}`,
        });
      }
    }
  } catch (e: any) {
    console.error("[round-calendar:in-app]", e?.message ?? e);
  }

  if (recipients.length === 0) {
    return {
      sent_to: [],
      errors: ["No recipients with email (client / referrer / assigned admin)"],
      sequence,
    };
  }
  for (const r of recipients) {
    try {
      const ics = buildRoundScheduleIcs({
        caseNumber: opts.caseNumber,
        clientName: opts.clientName,
        uidNs: opts.uidNs,
        dates: opts.dates,
        lang: r.lang,
        sequence,
      });
      const tpl = tplRoundCalendarInvite({
        firstName: r.firstName,
        clientName: opts.clientName,
        caseNumber: opts.caseNumber,
        dates: opts.dates,
        recipientRole: r.role,
        lang: r.lang,
        isUpdate: opts.isUpdate || sequence > 0,
      });
      await sendEmail({
        to: r.email,
        subject: tpl.subject,
        html: tpl.html,
        attachments: [
          {
            filename: `${opts.caseNumber}-round-schedule.ics`,
            content: Buffer.from(ics, "utf8"),
            contentType: "text/calendar; method=PUBLISH; charset=UTF-8",
          },
        ],
      });
      sent_to.push(r.email);
    } catch (e: any) {
      errors.push(`${r.email}: ${e?.message || "send failed"}`);
    }
  }
  if (sent_to.length > 0) {
    await pool.query(
      `UPDATE case_round_schedules
       SET last_sent_at = NOW(),
           last_sent_recipients = ?,
           calendar_send_count = calendar_send_count + 1
       WHERE case_id = ?`,
      [JSON.stringify(sent_to), opts.caseId],
    );
  }

  return { sent_to, errors, sequence };
}

async function persistAndMaybeSendRoundSchedule(opts: {
  caseId: number;
  clientId: number;
  caseNumber: string;
  clientName: string;
  scheduleInput: any;
}): Promise<{
  saved: boolean;
  sent?: { sent_to: string[]; errors: string[] };
  error?: string;
}> {
  const raw = opts.scheduleInput;
  if (!raw || typeof raw !== "object") return { saved: false };
  const sendCalendar = !!raw.send_calendar;
  const intervalDays = Math.max(
    1,
    Math.min(
      120,
      Number(raw.interval_days) || DEFAULT_ROUND_INTERVAL_DAYS,
    ),
  );
  let datesInput = raw;
  const hasAnyDate =
    raw.round_1_date ||
    raw.round_2_date ||
    raw.round_3_date ||
    raw.round_4_date ||
    raw.round_5_date;
  if (!hasAnyDate) {
    if (!sendCalendar) return { saved: false };
    datesInput = buildDefaultRoundScheduleDates(new Date(), intervalDays);
  }
  const validated = validateRoundScheduleDates(datesInput);
  if (validated.ok === false) {
    return { saved: false, error: validated.error };
  }
  const { calendar_uid_ns, is_new } = await upsertCaseRoundSchedule(
    opts.caseId,
    validated.dates,
    intervalDays,
  );
  if (!sendCalendar) return { saved: true };
  const sent = await sendCaseRoundCalendarInvites({
    caseId: opts.caseId,
    clientId: opts.clientId,
    caseNumber: opts.caseNumber,
    clientName: opts.clientName,
    dates: validated.dates,
    uidNs: calendar_uid_ns,
    isUpdate: !is_new,
  });
  return { saved: true, sent };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape LIKE wildcards using `!` as the ESCAPE character (MySQL/TiDB safe). */
function escapeLikePattern(raw: string): string {
  return String(raw).replace(/[!%_]/g, (ch) => `!${ch}`);
}

/** Build a contains-match LIKE value with escaped wildcards. Pair with `ESCAPE '!'`. */
function likeContains(raw: string): string {
  return `%${escapeLikePattern(raw)}%`;
}

function emailLayout(opts: {
  title: string;
  preheader?: string;
  bodyHtml: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const tagline = isEs
    ? "Reparación de Crédito, Bien Hecha"
    : "Credit Repair, Done Right";
  const footer = isEs
    ? `Recibes este correo porque tienes una cuenta con Optimum Credit Repair.<br/>© ${new Date().getFullYear()} Optimum Credit Repair. Todos los derechos reservados.`
    : `You're receiving this email because you have an account with Optimum Credit Repair.<br/>© ${new Date().getFullYear()} Optimum Credit Repair. All rights reserved.`;
  return `<!doctype html>
<html lang="${isEs ? "es" : "en"}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(opts.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f9;padding:40px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
      <tr><td style="background:#121829;padding:24px 32px;">
        <table width="100%"><tr>
          <td>
            <img src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_white.png" alt="Optimum Credit" height="40" style="display:block;height:40px;width:auto;border:0;" />
          </td>
          <td align="right" style="font-size:12px;color:#C0A06A;font-weight:600;letter-spacing:0.03em;">${tagline}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:32px;">${opts.bodyHtml}</td></tr>
      <tr><td style="padding:24px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;text-align:center;">
        ${footer}
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function emailButton(url: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr><td style="border-radius:10px;background:#C0A06A;">
    <a href="${url}" style="display:inline-block;padding:14px 28px;color:#121829;text-decoration:none;font-weight:700;font-size:15px;border-radius:10px;">${escapeHtml(label)}</a>
  </td></tr></table>`;
}

function tplOtpLogin(opts: {
  firstName?: string;
  code: string;
  isAdmin?: boolean;
  lang?: string;
}) {
  const isEs = opts.lang === "es" && !opts.isAdmin;
  const greeting = opts.firstName
    ? isEs
      ? `Hola ${escapeHtml(opts.firstName)},`
      : `Hi ${escapeHtml(opts.firstName)},`
    : isEs
      ? "Hola,"
      : "Hi,";
  const role = opts.isAdmin
    ? "admin panel"
    : isEs
      ? "portal de clientes"
      : "client portal";
  const body = isEs
    ? `
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Tu código de acceso</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${greeting} usa el código de verificación a continuación para iniciar sesión en tu ${role}.</p>
    <div style="margin:24px 0;padding:24px;background:#f1f5f9;border-radius:12px;text-align:center;font-family:'SF Mono',Menlo,monospace;font-size:36px;font-weight:800;letter-spacing:8px;color:#0f172a;">${escapeHtml(opts.code)}</div>
    <p style="margin:0;font-size:13px;color:#64748b;">Este código expira en 10 minutos. Si no lo solicitaste, puedes ignorar este correo de forma segura.</p>`
    : `
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Your sign-in code</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${greeting} use the verification code below to sign in to your ${role}.</p>
    <div style="margin:24px 0;padding:24px;background:#f1f5f9;border-radius:12px;text-align:center;font-family:'SF Mono',Menlo,monospace;font-size:36px;font-weight:800;letter-spacing:8px;color:#0f172a;">${escapeHtml(opts.code)}</div>
    <p style="margin:0;font-size:13px;color:#64748b;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>`;
  return {
    subject: isEs
      ? `Tu código de Optimum Credit: ${opts.code}`
      : `Your Optimum Credit code: ${opts.code}`,
    html: emailLayout({
      title: isEs ? "Código de acceso" : "Sign-in code",
      preheader: isEs ? `Código: ${opts.code}` : `Code: ${opts.code}`,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

function tplWelcomePayment(opts: {
  firstName: string;
  packageName: string;
  packagePrice: string;
  onboardingUrl: string;
}) {
  const docRows = [
    {
      icon: "&#128100;",
      label: "Government-issued ID",
      desc: "Front and back (driver's license or passport)",
    },
    {
      icon: "&#128196;",
      label: "Social Security Card",
      desc: "Clear photo of your SSN card",
    },
    {
      icon: "&#127968;",
      label: "Proof of Address",
      desc: "Utility bill or bank statement, no older than 3 months",
    },
  ]
    .map(
      (d) =>
        `<tr><td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
        <table width="100%"><tr>
          <td width="36" style="font-size:22px;vertical-align:middle;">${d.icon}</td>
          <td style="padding-left:8px;">
            <div style="font-size:14px;font-weight:700;color:#0f172a;">${d.label}</div>
            <div style="font-size:12px;color:#64748b;margin-top:2px;">${d.desc}</div>
          </td>
          <td width="60" align="right" style="font-size:12px;color:#d97706;font-weight:600;">Needed</td>
        </tr></table>
       </td></tr>`,
    )
    .join("");
  const body = `
    <h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#0f172a;">Welcome aboard, ${escapeHtml(opts.firstName)}!</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Your payment was confirmed — you're officially on your way to a stronger credit score. One quick step remains: upload your documents.</p>
    <div style="margin:20px 0;padding:20px;background:#fdf8f0;border-radius:12px;border:1px solid #d4b896;">
      <div style="font-size:13px;color:#8a6d3b;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Your Package</div>
      <div style="margin-top:6px;font-size:18px;font-weight:700;color:#0f172a;">${escapeHtml(opts.packageName)} — ${escapeHtml(opts.packagePrice)}</div>
    </div>
    <p style="margin:16px 0 8px;font-size:15px;font-weight:700;color:#0f172a;">Documents you'll need to upload:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      ${docRows}
    </table>
    <div style="margin:16px 0;padding:14px 18px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#15803d;">Your documents are secured with AES-256 encryption</div>
      <div style="font-size:12px;color:#166534;margin-top:4px;">All uploaded files are encrypted end-to-end and stored securely. Only authorised Optimum Credit staff can access them for review.</div>
    </div>
    <p style="margin:16px 0;font-size:15px;line-height:1.6;color:#334155;">Click the button below — this is your personal secure link (valid for 72 hours).</p>
    ${emailButton(opts.onboardingUrl, "Upload My Documents")}
    <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Need help? Just reply to this email — we're here for you.</p>`;
  return {
    subject: `Welcome to Optimum Credit, ${opts.firstName}! — Upload your documents`,
    html: emailLayout({
      title: "Welcome — Upload Documents",
      preheader:
        "Your payment is confirmed. Upload your documents to get started.",
      bodyHtml: body,
    }),
  };
}

const DOC_TYPE_LABELS: Record<string, string> = {
  id_front: "Government ID (front)",
  id_back: "Government ID (back)",
  ssn_card: "Social Security Card",
  proof_of_address: "Proof of Address",
  other: "Document",
};

const DOC_TYPE_LABELS_ES: Record<string, string> = {
  id_front: "Identificación oficial (frente)",
  id_back: "Identificación oficial (reverso)",
  ssn_card: "Tarjeta de Seguro Social",
  proof_of_address: "Comprobante de domicilio",
  other: "Documento",
};

function tplDocumentRejected(opts: {
  firstName: string;
  docType: string;
  reason: string;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const label = isEs
    ? DOC_TYPE_LABELS_ES[opts.docType] || opts.docType
    : DOC_TYPE_LABELS[opts.docType] || opts.docType;
  const body = isEs
    ? `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Acción requerida: por favor vuelve a subir tu documento</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)}, revisamos tu <strong>${escapeHtml(label)}</strong> pero no pudimos aceptarlo. Por favor sube una nueva copia desde tu portal.</p>
    <div style="margin:20px 0;padding:16px 20px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#991b1b;">Motivo del rechazo</div>
      <div style="margin-top:6px;font-size:14px;color:#7f1d1d;">${escapeHtml(opts.reason)}</div>
    </div>
    <p style="margin:16px 0;font-size:14px;color:#334155;">Consejos frecuentes: asegúrate de que el documento esté enfocado, no recortado, muestre claramente las cuatro esquinas y sea una copia reciente (no mayor a 3 meses para comprobante de domicilio).</p>
    ${emailButton(opts.portalUrl, "Volver a subir desde mi portal")}
    <p style="margin:16px 0 0;font-size:13px;color:#64748b;">¿Preguntas? Responde a este correo y nuestro equipo te ayudará.</p>`
    : `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Action needed: please re-upload your document</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, we reviewed your <strong>${escapeHtml(label)}</strong> but were unable to accept it. Please upload a new copy from your portal.</p>
    <div style="margin:20px 0;padding:16px 20px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#991b1b;">Reason for rejection</div>
      <div style="margin-top:6px;font-size:14px;color:#7f1d1d;">${escapeHtml(opts.reason)}</div>
    </div>
    <p style="margin:16px 0;font-size:14px;color:#334155;">Common tips: make sure the document is in focus, not cropped, clearly shows all four corners, and is a recent copy (no older than 3 months for address proof).</p>
    ${emailButton(opts.portalUrl, "Re-upload from My Portal")}
    <p style="margin:16px 0 0;font-size:13px;color:#64748b;">Questions? Reply to this email and our team will help you out.</p>`;
  return {
    subject: isEs
      ? `Optimum Credit: acción requerida — vuelve a subir tu ${label}`
      : `Optimum Credit: action needed — re-upload your ${label}`,
    html: emailLayout({
      title: isEs ? "Nueva subida requerida" : "Re-upload required",
      preheader: isEs
        ? `Necesitamos una nueva copia de tu ${label}.`
        : `We need a new copy of your ${label}.`,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

function tplAllDocsApproved(opts: {
  firstName: string;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">¡Buenas noticias &#127881; — todos tus documentos han sido verificados!</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)}, nuestro equipo ha revisado y aprobado los cuatro documentos de identidad. Tu expediente ha pasado a la siguiente etapa y nuestros especialistas comenzarán a trabajar en tu caso de inmediato.</p>
    <div style="margin:20px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#15803d;">¿Qué sigue?</div>
      <div style="margin-top:6px;font-size:14px;color:#166534;line-height:1.6;">Nuestros especialistas comenzarán a revisar tus reportes de crédito y a preparar cartas de disputa con las principales agencias de crédito. Recibirás una actualización de progreso después de que se complete cada ronda — generalmente dentro de 30&ndash;45 días.</div>
    </div>
    <p style="margin:16px 0;font-size:14px;line-height:1.6;color:#334155;">Puedes seguir tu progreso y ver los informes de cada ronda directamente desde tu portal.</p>
    ${emailButton(opts.portalUrl, "Ver mi portal")}
    <p style="margin:24px 0 0;font-size:13px;color:#64748b;">¿Preguntas? Responde a este correo y nuestro equipo estará feliz de ayudarte.</p>`
    : `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Great news &#127881; — your documents are all verified!</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, our team has reviewed and approved all four of your identity documents. Your file has been moved to the next stage and our specialists will begin working on your case right away.</p>
    <div style="margin:20px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#15803d;">What happens next?</div>
      <div style="margin-top:6px;font-size:14px;color:#166534;line-height:1.6;">Our specialists will start reviewing your credit reports and preparing dispute letters with the major credit bureaus. You'll receive a progress update after each round is completed — usually within 30&ndash;45 days.</div>
    </div>
    <p style="margin:16px 0;font-size:14px;line-height:1.6;color:#334155;">You can track your progress and view round reports directly from your client portal.</p>
    ${emailButton(opts.portalUrl, "View My Portal")}
    <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Questions? Reply to this email and our team will be happy to assist.</p>`;
  return {
    subject: isEs
      ? `Optimum Credit: documentos verificados — ¡comenzamos!`
      : `Optimum Credit: all documents verified — we're getting started!`,
    html: emailLayout({
      title: isEs ? "Documentos Verificados" : "Documents Verified",
      preheader: isEs
        ? "Todos tus documentos han sido aprobados. ¡Manos a la obra!"
        : "All your documents have been approved. We're on it!",
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

function tplInfoRequestCreated(opts: {
  firstName: string;
  title: string;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Necesitamos información adicional</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)}, nuestro equipo solicitó: <strong>${escapeHtml(opts.title)}</strong>.</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">Inicia sesión en tu portal para completar la solicitud. Tus datos están protegidos y solo se usan para tu caso de reparación crediticia.</p>
    ${emailButton(opts.portalUrl, "Abrir solicitud")}`
    : `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Additional information needed</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, our team requested: <strong>${escapeHtml(opts.title)}</strong>.</p>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">Log in to your portal to complete the request. Your information is protected and used only for your credit repair case.</p>
    ${emailButton(opts.portalUrl, "Open request")}`;
  return {
    subject: isEs
      ? `Optimum Credit: información solicitada — ${opts.title}`
      : `Optimum Credit: information requested — ${opts.title}`,
    html: emailLayout({
      title: isEs ? "Información solicitada" : "Information requested",
      preheader: isEs
        ? "Completa la solicitud en tu portal."
        : "Complete the request in your portal.",
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

function tplInfoRequestReviewed(opts: {
  firstName: string;
  title: string;
  approved: boolean;
  reason?: string | null;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  if (opts.approved) {
    const body = isEs
      ? `
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Información recibida</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)}, revisamos y aprobamos tu respuesta a <strong>${escapeHtml(opts.title)}</strong>. ¡Gracias!</p>
      ${emailButton(opts.portalUrl, "Ver portal")}`
      : `
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Information received</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, we reviewed and approved your response to <strong>${escapeHtml(opts.title)}</strong>. Thank you!</p>
      ${emailButton(opts.portalUrl, "View portal")}`;
    return {
      subject: isEs
        ? `Optimum Credit: información aprobada — ${opts.title}`
        : `Optimum Credit: information approved — ${opts.title}`,
      html: emailLayout({
        title: isEs ? "Aprobado" : "Approved",
        bodyHtml: body,
        lang: opts.lang,
      }),
    };
  }
  const body = isEs
    ? `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Acción requerida</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)}, necesitamos que vuelvas a enviar tu respuesta a <strong>${escapeHtml(opts.title)}</strong>.</p>
    <div style="margin:20px 0;padding:16px 20px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#991b1b;">Motivo</div>
      <div style="margin-top:6px;font-size:14px;color:#7f1d1d;">${escapeHtml(opts.reason || "Por favor revisa y vuelve a enviar.")}</div>
    </div>
    ${emailButton(opts.portalUrl, "Volver a enviar")}`
    : `
    <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#0f172a;">Action needed</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, we need you to resubmit your response to <strong>${escapeHtml(opts.title)}</strong>.</p>
    <div style="margin:20px 0;padding:16px 20px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:8px;">
      <div style="font-size:13px;font-weight:700;color:#991b1b;">Reason</div>
      <div style="margin-top:6px;font-size:14px;color:#7f1d1d;">${escapeHtml(opts.reason || "Please review and resubmit.")}</div>
    </div>
    ${emailButton(opts.portalUrl, "Resubmit now")}`;
  return {
    subject: isEs
      ? `Optimum Credit: vuelve a enviar — ${opts.title}`
      : `Optimum Credit: please resubmit — ${opts.title}`,
    html: emailLayout({
      title: isEs ? "Reenvío requerido" : "Resubmission required",
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

function tplRoundComplete(opts: {
  firstName: string;
  roundNumber: number;
  scoreBefore?: number | null;
  scoreAfter?: number | null;
  itemsRemoved: number;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const delta =
    opts.scoreBefore != null && opts.scoreAfter != null
      ? opts.scoreAfter - opts.scoreBefore
      : null;
  const body = `
    <h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#0f172a;">${isEs ? `Ronda ${opts.roundNumber} completada` : `Round ${opts.roundNumber} is complete`}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${isEs ? `Hola ${escapeHtml(opts.firstName)}, aquí está tu actualización de progreso mensual.` : `Hi ${escapeHtml(opts.firstName)}, here's your monthly progress update.`}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
      <tr>
        <td style="padding:16px;background:#f1f5f9;border-radius:12px;text-align:center;width:33%;">
          <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;">${isEs ? "Elementos eliminados" : "Items Removed"}</div>
          <div style="margin-top:6px;font-size:24px;font-weight:800;color:#16a34a;">${opts.itemsRemoved}</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:16px;background:#f1f5f9;border-radius:12px;text-align:center;">
          <div style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;">${isEs ? "Cambio de puntaje" : "Score Change"}</div>
          <div style="margin-top:6px;font-size:24px;font-weight:800;color:${delta != null && delta >= 0 ? "#16a34a" : "#0f172a"};">${delta != null ? (delta >= 0 ? "+" : "") + delta : "—"}</div>
        </td>
      </tr>
    </table>
    ${emailButton(opts.portalUrl, isEs ? "Ver informe completo" : "View Full Report")}`;
  return {
    subject: isEs
      ? `Ronda ${opts.roundNumber} completada — tu informe de progreso está listo`
      : `Round ${opts.roundNumber} complete — your progress report is ready`,
    html: emailLayout({
      title: isEs ? "Ronda completada" : "Round complete",
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ============================================================================
// ROUND PDF REPORT READY EMAIL TEMPLATE
// ============================================================================

/** Attach pdfs[] to each round report row from the round_report_pdfs table. */
async function attachPdfsToReports(
  clientId: number,
  reports: RowDataPacket[],
): Promise<void> {
  if (!reports.length) return;
  const [pdfRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, client_id, round_number, round_report_id, file_name, uploaded_at
     FROM round_report_pdfs WHERE client_id = ? ORDER BY round_number ASC, uploaded_at ASC`,
    [clientId],
  );
  const byRound: Record<number, RowDataPacket[]> = {};
  for (const p of pdfRows) {
    const rn = p.round_number as number;
    if (!byRound[rn]) byRound[rn] = [];
    byRound[rn].push(p);
  }
  for (const r of reports) {
    r.pdfs = byRound[r.round_number as number] ?? [];
  }
}

// ============================================================================
// OFG REPORT WIZARD HELPERS
// ============================================================================

async function loadWizardSession(
  pool: Pool,
  sessionId: number,
): Promise<RowDataPacket | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rws.*, c.first_name, c.last_name, c.email, c.phone, c.preferred_language
     FROM report_wizard_sessions rws
     JOIN clients c ON c.id = rws.client_id
     WHERE rws.id = ? LIMIT 1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

async function loadWizardSourcePdfBuffer(
  pool: Pool,
  pdfId: number,
  decrypt: (encrypted: Buffer, ivHex: string, tagHex: string) => Buffer,
): Promise<Buffer> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT storage_key, enc_iv, enc_tag FROM round_report_source_pdfs WHERE id = ? LIMIT 1`,
    [pdfId],
  );
  if (rows.length === 0) throw new Error("Source PDF not found");
  const row = rows[0];
  const resp = await fetch(row.storage_key as string);
  if (!resp.ok) throw new Error("Failed to fetch source PDF from CDN");
  const encBuf = Buffer.from(await resp.arrayBuffer());
  return decrypt(encBuf, row.enc_iv as string, row.enc_tag as string);
}

function parseWizardJsonField<T>(val: unknown): T | null {
  if (val == null) return null;
  if (typeof val === "object") return val as T;
  try {
    return JSON.parse(String(val)) as T;
  } catch {
    return null;
  }
}

async function runWizardSessionExtraction(
  pool: Pool,
  session: RowDataPacket,
  decrypt: (encrypted: Buffer, ivHex: string, tagHex: string) => Buffer,
): Promise<{ data: OfGReportData; meta: Record<string, unknown> }> {
  const beforePdfId = session.before_pdf_id as number | null;
  const afterPdfId = session.after_pdf_id as number | null;
  if (!beforePdfId || !afterPdfId) {
    throw new Error("Source PDFs missing for this session");
  }

  const options =
    parseWizardJsonField<OfGReportWizardOptions>(session.options_json) ?? {};
  const firstName = String(session.first_name || "Client");
  const roundNumber = session.round_number as number;

  const beforeBuf = await loadWizardSourcePdfBuffer(pool, beforePdfId, decrypt);
  const afterBuf = await loadWizardSourcePdfBuffer(pool, afterPdfId, decrypt);

  const { data, meta } = await extractFromCreditReportPdfs(
    beforeBuf,
    afterBuf,
    firstName,
    roundNumber,
    {
      highlightWin: options.highlight_win,
      spanish: options.spanish,
      tradelineRec: options.tradeline_rec,
      fundingNote: options.funding_note,
    },
  );

  meta.before_source = session.before_source ?? "upload";
  meta.before_reused_from_session_id =
    session.before_reused_from_session_id ?? null;

  return { data, meta };
}

async function hasPublishedWizardRound(
  pool: Pool,
  clientId: number,
  roundNumber: number,
  excludeSessionId?: number,
): Promise<boolean> {
  const params: number[] = [clientId, roundNumber];
  let sql = `SELECT id FROM report_wizard_sessions
             WHERE client_id = ? AND round_number = ? AND status = 'published'`;
  if (excludeSessionId) {
    sql += ` AND id != ?`;
    params.push(excludeSessionId);
  }
  sql += ` LIMIT 1`;
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows.length > 0;
}

function formatWizardSessionResponse(session: RowDataPacket) {
  return {
    ...session,
    options_json: parseWizardJsonField(session.options_json),
    extracted_json: parseWizardJsonField(session.extracted_json),
    reviewed_json: parseWizardJsonField(session.reviewed_json),
    extraction_meta: parseWizardJsonField(session.extraction_meta),
  };
}

export type ReportWizardBeforeContext = {
  source: "enrollment" | "prior_round" | "none";
  can_reuse: boolean;
  prior_session_id: number | null;
  prior_round: number | null;
  file_name: string | null;
  report_date_after: string | null;
  score_after: number | null;
  middle_score_after: number | null;
};

/** Resolve whether Round N can reuse Round N−1's published "after" PDF as Before. */
async function resolveWizardBeforeContext(
  pool: Pool,
  caseId: number,
  roundNumber: number,
): Promise<ReportWizardBeforeContext> {
  if (roundNumber <= 1) {
    return {
      source: "enrollment",
      can_reuse: false,
      prior_session_id: null,
      prior_round: null,
      file_name: null,
      report_date_after: null,
      score_after: null,
      middle_score_after: null,
    };
  }

  const priorRound = roundNumber - 1;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.round_number, s.after_pdf_id, s.extracted_json, s.reviewed_json,
            p.file_name, crr.score_after
     FROM report_wizard_sessions s
     LEFT JOIN round_report_source_pdfs p ON p.id = s.after_pdf_id
     LEFT JOIN client_round_reports crr ON crr.wizard_session_id = s.id
     WHERE s.case_id = ? AND s.round_number = ? AND s.status = 'published'
       AND s.after_pdf_id IS NOT NULL
     ORDER BY s.published_at DESC, s.id DESC
     LIMIT 1`,
    [caseId, priorRound],
  );

  if (rows.length === 0) {
    return {
      source: "none",
      can_reuse: false,
      prior_session_id: null,
      prior_round: priorRound,
      file_name: null,
      report_date_after: null,
      score_after: null,
      middle_score_after: null,
    };
  }

  const row = rows[0];
  const reviewed = parseWizardJsonField<OfGReportData>(row.reviewed_json);
  const extracted = parseWizardJsonField<OfGReportData>(row.extracted_json);
  const data = reviewed ?? extracted;
  const reportDateAfter = data?.reportDate?.after ?? null;
  const middleAfter = data?.middleScore?.after ?? null;

  return {
    source: "prior_round",
    can_reuse: true,
    prior_session_id: row.id as number,
    prior_round: row.round_number as number,
    file_name: (row.file_name as string) || null,
    report_date_after: reportDateAfter,
    score_after:
      row.score_after != null
        ? Number(row.score_after)
        : middleAfter != null
          ? Number(middleAfter)
          : null,
    middle_score_after: middleAfter != null ? Number(middleAfter) : null,
  };
}

function tplRoundPdfReady(opts: {
  firstName: string;
  roundNumber: number;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = `
    <h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#0f172a;">${isEs ? `Tu informe PDF de la Ronda ${opts.roundNumber} ya está disponible` : `Your Round ${opts.roundNumber} PDF report is ready`}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${isEs ? `Hola ${escapeHtml(opts.firstName)}, tu asesor de crédito ha subido el informe detallado de la Ronda ${opts.roundNumber}. Puedes descargarlo desde tu portal en cualquier momento.` : `Hi ${escapeHtml(opts.firstName)}, your credit advisor has uploaded the detailed Round ${opts.roundNumber} report. You can download it from your portal at any time.`}</p>
    <div style="margin:20px 0;padding:20px 24px;background:#f1f5f9;border-radius:12px;border-left:4px solid #C0A06A;">
      <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:6px;">📄 ${isEs ? `Informe de la Ronda ${opts.roundNumber}` : `Round ${opts.roundNumber} Report`}</div>
      <div style="font-size:13px;color:#64748b;">${isEs ? "Este informe incluye el desglose completo de los elementos disputados, eliminados y los cambios en tu puntuación crediticia." : "This report includes the complete breakdown of disputed items, removals, and credit score changes for this round."}</div>
    </div>
    ${emailButton(opts.portalUrl, isEs ? "Descargar mi informe" : "Download My Report")}
    <p style="margin:20px 0 0;font-size:13px;color:#94a3b8;">${isEs ? "Si tienes preguntas sobre tu informe, no dudes en contactar a tu asesor a través del portal." : "If you have questions about your report, feel free to contact your advisor through the portal."}</p>`;
  return {
    subject: isEs
      ? `Tu informe PDF de la Ronda ${opts.roundNumber} ya está listo — Optimum Credit`
      : `Round ${opts.roundNumber} PDF report ready — Optimum Credit`,
    html: emailLayout({
      title: isEs ? "Informe PDF listo" : "PDF Report Ready",
      preheader: isEs
        ? `Tu informe de la Ronda ${opts.roundNumber} está disponible para descargar.`
        : `Your Round ${opts.roundNumber} report is available to download.`,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ============================================================================
// CLIENT WELCOME EMAIL (manual admin-created client)
// ============================================================================
function tplClientWelcome(opts: {
  firstName: string;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0f172a;">¡Bienvenido, ${escapeHtml(opts.firstName)}!</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Tu cuenta con Optimum Credit ha sido creada. Haz clic en el botón de abajo para acceder a tu portal de cliente.</p>
       ${emailButton(opts.portalUrl, "Acceder a mi portal")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">¿Necesitas ayuda? Responde a este correo y te asistiremos.</p>`
    : `<h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0f172a;">Welcome, ${escapeHtml(opts.firstName)}!</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Your Optimum Credit account has been created. Click below to access your client portal.</p>
       ${emailButton(opts.portalUrl, "Access My Portal")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Need help? Just reply to this email — we're here for you.</p>`;
  return {
    subject: isEs
      ? `Bienvenido a Optimum Credit, ${opts.firstName}`
      : `Welcome to Optimum Credit, ${opts.firstName}`,
    html: emailLayout({
      title: isEs ? "Bienvenido" : "Welcome",
      preheader: isEs ? "Tu cuenta está lista." : "Your account is ready.",
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

function tplTaskReopened(opts: {
  firstName: string;
  taskTitle: string;
  portalUrl: string;
  reason?: string | null;
  expiresHours: number;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const reasonBlock = opts.reason
    ? isEs
      ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;"><strong>Nota:</strong> ${escapeHtml(opts.reason)}</p>`
      : `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;"><strong>Note:</strong> ${escapeHtml(opts.reason)}</p>`
    : "";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Necesitamos que vuelvas a completar una tarea</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         La tarea <strong>${escapeHtml(opts.taskTitle)}</strong> se reabrió y necesita una nueva entrega.
       </p>
       ${reasonBlock}
       ${emailButton(opts.portalUrl, "Completar esta tarea")}
       <p style="margin:20px 0 0;font-size:13px;color:#64748b;">
         Este enlace seguro caduca en ${opts.expiresHours} horas y solo puede usarse una vez.
       </p>`
    : `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">We need you to resubmit a task</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         <strong>${escapeHtml(opts.taskTitle)}</strong> was reopened and needs a new submission.
       </p>
       ${reasonBlock}
       ${emailButton(opts.portalUrl, "Complete this task")}
       <p style="margin:20px 0 0;font-size:13px;color:#64748b;">
         This secure link expires in ${opts.expiresHours} hours and can only be used once.
       </p>`;
  return {
    subject: isEs
      ? `Acción requerida — ${opts.taskTitle} reabierta`
      : `Action required — ${opts.taskTitle} reopened`,
    html: emailLayout({
      title: isEs ? "Tarea reabierta" : "Task reopened",
      preheader: opts.taskTitle,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

function tplTaskReminder(opts: {
  firstName: string;
  taskTitle: string;
  portalUrl: string;
  expiresHours: number;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Recordatorio: ${escapeHtml(opts.taskTitle)}</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         Todavía necesitamos que completes la tarea <strong>${escapeHtml(opts.taskTitle)}</strong>
         para avanzar tu expediente de reparación de crédito.
       </p>
       ${emailButton(opts.portalUrl, "Completar esta tarea")}
       <p style="margin:20px 0 0;font-size:13px;color:#64748b;">
         Este enlace seguro caduca en ${opts.expiresHours} horas y solo puede usarse una vez.
       </p>`
    : `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Reminder: ${escapeHtml(opts.taskTitle)}</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         We still need you to complete <strong>${escapeHtml(opts.taskTitle)}</strong>
         so we can keep your credit repair case moving.
       </p>
       ${emailButton(opts.portalUrl, "Complete this task")}
       <p style="margin:20px 0 0;font-size:13px;color:#64748b;">
         This secure link expires in ${opts.expiresHours} hours and can only be used once.
       </p>`;
  return {
    subject: isEs
      ? `Recordatorio — ${opts.taskTitle}`
      : `Reminder — ${opts.taskTitle}`,
    html: emailLayout({
      title: isEs ? "Recordatorio de tarea" : "Task reminder",
      preheader: opts.taskTitle,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ============================================================================
// CASE STARTED EMAIL (manual CR- case)
// ============================================================================
function tplCaseStarted(opts: {
  firstName: string;
  caseNumber: string;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0f172a;">¡Tu caso ha sido activado!</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)}, tu expediente de reparación de crédito <strong>${escapeHtml(opts.caseNumber)}</strong> ya está activo.</p>
       <div style="margin:20px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
         <div style="font-size:13px;font-weight:700;color:#15803d;">Número de caso: ${escapeHtml(opts.caseNumber)}</div>
       </div>
       ${emailButton(opts.portalUrl, "Ver mi portal")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">¿Preguntas? Responde este correo.</p>`
    : `<h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0f172a;">Your case is now active!</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, your credit repair case <strong>${escapeHtml(opts.caseNumber)}</strong> is now active. Our team will begin working on it right away.</p>
       <div style="margin:20px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
         <div style="font-size:13px;font-weight:700;color:#15803d;">Case number: ${escapeHtml(opts.caseNumber)}</div>
       </div>
       ${emailButton(opts.portalUrl, "View My Portal")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Have questions? Just reply to this email.</p>`;
  return {
    subject: isEs
      ? `Tu caso ${opts.caseNumber} está activo — Optimum Credit`
      : `Your case ${opts.caseNumber} is active — Optimum Credit`,
    html: emailLayout({
      title: isEs ? "Caso activado" : "Case started",
      preheader: isEs
        ? `Tu expediente ${opts.caseNumber} está en marcha.`
        : `Your case ${opts.caseNumber} is now underway.`,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ============================================================================
// PROSPECT CONVERT WELCOME EMAIL (5A/7A — dedicated template, NOT
// payment_confirmed/tplClientWelcome, sent when a prospect is converted
// to a client + case by an admin without ever taking a payment)
// ============================================================================
function tplProspectConvertWelcome(opts: {
  firstName: string;
  caseNumber: string;
  portalUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0f172a;">¡Es oficial, ${escapeHtml(opts.firstName)}!</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Con base en tu análisis de crédito, hemos activado tu expediente de reparación de crédito <strong>${escapeHtml(opts.caseNumber)}</strong>. El siguiente paso es completar tus tareas de inicio para que podamos comenzar a trabajar en tus disputas.</p>
       <div style="margin:20px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
         <div style="font-size:13px;font-weight:700;color:#15803d;">Número de caso: ${escapeHtml(opts.caseNumber)}</div>
       </div>
       ${emailButton(opts.portalUrl, "Completar mis tareas de inicio")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">¿Preguntas? Responde este correo y con gusto te ayudamos.</p>`
    : `<h1 style="margin:0 0 16px;font-size:26px;font-weight:800;color:#0f172a;">It's official, ${escapeHtml(opts.firstName)}!</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Based on your credit analysis, we've activated your credit repair case <strong>${escapeHtml(opts.caseNumber)}</strong>. The next step is completing your Get Started tasks so our team can begin working on your disputes.</p>
       <div style="margin:20px 0;padding:16px 20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;">
         <div style="font-size:13px;font-weight:700;color:#15803d;">Case number: ${escapeHtml(opts.caseNumber)}</div>
       </div>
       ${emailButton(opts.portalUrl, "Complete My Get Started Tasks")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Have questions? Just reply to this email — we're happy to help.</p>`;
  return {
    subject: isEs
      ? `Bienvenido a Optimum Credit — tu caso ${opts.caseNumber} está activo`
      : `Welcome to Optimum Credit — your case ${opts.caseNumber} is active`,
    html: emailLayout({
      title: isEs ? "Bienvenido" : "Welcome",
      preheader: isEs
        ? "Completa tus tareas de inicio para comenzar."
        : "Complete your Get Started tasks to begin.",
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ============================================================================
// ADMIN: client received doc-upload link (language owner notify)
// ============================================================================
function tplAdminDocUploadLinkAlert(opts: {
  adminFirstName: string;
  clientName: string;
  clientEmail: string;
  portalUrl: string;
  caseUploadUrl: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Enlace de documentos enviado al cliente</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.adminFirstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         El cliente <strong>${escapeHtml(opts.clientName)}</strong> (${escapeHtml(opts.clientEmail)})
         recibió el enlace para subir sus documentos. Como platicamos: a menudo el cliente o el referidor
         ya nos envía los papeles directamente y nosotros hacemos ese proceso.
       </p>
       <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">Puedes:</p>
       <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.7;color:#334155;">
         <li>Abrir el mismo enlace del cliente (por si necesitas reenviarlo)</li>
         <li>Subir los documentos manualmente en el caso del pipeline (misma encriptación AES-256)</li>
       </ul>
       ${emailButton(opts.portalUrl, "Ver enlace del cliente")}
       <div style="height:12px;"></div>
       ${emailButton(opts.caseUploadUrl, "Subir documentos en el caso")}`
    : `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Client document-upload link sent</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.adminFirstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         Client <strong>${escapeHtml(opts.clientName)}</strong> (${escapeHtml(opts.clientEmail)})
         received the document upload link. Often the client or referrer already sends papers directly
         and your team uploads them on their behalf.
       </p>
       <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">You can:</p>
       <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.7;color:#334155;">
         <li>Open the same client link (to forward if needed)</li>
         <li>Upload documents manually on the pipeline case (same AES-256 encryption)</li>
       </ul>
       ${emailButton(opts.portalUrl, "Open client upload link")}
       <div style="height:12px;"></div>
       ${emailButton(opts.caseUploadUrl, "Upload documents on case")}`;
  return {
    subject: isEs
      ? `Documentos — ${opts.clientName} recibió el enlace de carga`
      : `Documents — ${opts.clientName} received the upload link`,
    html: emailLayout({
      title: isEs ? "Enlace de documentos" : "Document upload link",
      preheader: isEs
        ? "También puedes subir los papeles en el caso."
        : "You can also upload papers on the case.",
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

function tplReferrerRoundUpdate(opts: {
  referrerFirstName: string;
  clientName: string;
  stageLabel: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Actualización de caso</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         Hola ${escapeHtml(opts.referrerFirstName)}, el expediente de
         <strong>${escapeHtml(opts.clientName)}</strong> avanzó a
         <strong>${escapeHtml(opts.stageLabel)}</strong>. Te mantendremos al tanto en cada ronda.
       </p>`
    : `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">Case update</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         Hi ${escapeHtml(opts.referrerFirstName)}, the case for
         <strong>${escapeHtml(opts.clientName)}</strong> moved to
         <strong>${escapeHtml(opts.stageLabel)}</strong>. We'll keep you updated each round.
       </p>`;
  return {
    subject: isEs
      ? `Actualización — ${opts.clientName}: ${opts.stageLabel}`
      : `Update — ${opts.clientName}: ${opts.stageLabel}`,
    html: emailLayout({
      title: isEs ? "Actualización" : "Case update",
      preheader: opts.stageLabel,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

const ROUND_STAGE_LABELS: Record<string, { en: string; es: string }> = {
  round_1: { en: "Round 1", es: "Ronda 1" },
  round_2: { en: "Round 2", es: "Ronda 2" },
  round_3: { en: "Round 3", es: "Ronda 3" },
  round_4: { en: "Round 4", es: "Ronda 4" },
  round_5: { en: "Round 5", es: "Ronda 5" },
  completed: { en: "Completed", es: "Completado" },
};

// ============================================================================
// ADMIN NOTIFICATION PREFERENCES (profile mute toggles)
// ============================================================================

const ADMIN_NOTIFY_EVENT_KEYS: AdminNotifyEventKey[] = [
  "purchase_enrollment",
  "payment_installment",
  "submission_ready_review",
  "submission_doc_upload",
  "submission_info_request",
  "doc_upload_link",
  "round_calendar",
  "work_task_assigned",
  "work_task_overdue",
];

function allAdminNotifyEventsOn(): AdminNotifyEventToggles {
  return {
    purchase_enrollment: true,
    payment_installment: true,
    submission_ready_review: true,
    submission_doc_upload: true,
    submission_info_request: true,
    doc_upload_link: true,
    round_calendar: true,
    work_task_assigned: true,
    work_task_overdue: true,
  };
}

function defaultAdminNotificationPrefs(): AdminNotificationPrefs {
  return {
    email: allAdminNotifyEventsOn(),
    in_app: allAdminNotifyEventsOn(),
    sms: allAdminNotifyEventsOn(),
  };
}

function mergeAdminNotifyChannel(
  raw: unknown,
  defaults: AdminNotifyEventToggles,
): AdminNotifyEventToggles {
  const out = { ...defaults };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const key of ADMIN_NOTIFY_EVENT_KEYS) {
    if (typeof obj[key] === "boolean") out[key] = obj[key] as boolean;
  }
  return out;
}

function parseAdminNotificationPrefs(raw: unknown): AdminNotificationPrefs {
  const defaults = defaultAdminNotificationPrefs();
  if (!raw) return defaults;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaults;
    }
  }
  if (!parsed || typeof parsed !== "object") return defaults;
  const obj = parsed as Record<string, unknown>;
  return {
    email: mergeAdminNotifyChannel(obj.email, defaults.email),
    in_app: mergeAdminNotifyChannel(obj.in_app, defaults.in_app),
    sms: mergeAdminNotifyChannel(obj.sms, defaults.sms),
  };
}

function adminNotifyPrefOn(
  prefs: AdminNotificationPrefs,
  channel: AdminNotifyChannel,
  eventKey: AdminNotifyEventKey,
): boolean {
  return prefs[channel][eventKey] !== false;
}

/** Twilio keys present — unlocks SMS toggles; admin SMS delivery uses sendSms. */
function isAdminSmsChannelAvailable(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER &&
    twilioClient &&
    TWILIO_FROM
  );
}

function adminNotifyChannelMeta(): Record<
  AdminNotifyChannel,
  { available: boolean; disabled_reason?: string | null }
> {
  const smsOk = isAdminSmsChannelAvailable();
  return {
    email: { available: true, disabled_reason: null },
    in_app: { available: true, disabled_reason: null },
    sms: {
      available: smsOk,
      disabled_reason: smsOk
        ? null
        : "sms_twilio_not_configured",
    },
  };
}

async function insertAdminInAppNotification(opts: {
  adminId: number;
  eventKey: AdminNotifyEventKey;
  title: string;
  body: string;
  linkUrl: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO admin_notifications
       (admin_id, event_key, title, body, link_url, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      opts.adminId,
      opts.eventKey,
      opts.title.slice(0, 255),
      opts.body || null,
      opts.linkUrl || null,
      opts.payload ? JSON.stringify(opts.payload) : null,
    ],
  );
}

type TeamAdminRecipient = {
  id: number;
  email: string;
  first_name: string;
  phone: string | null;
  preferred_language: string | null;
  prefs: AdminNotificationPrefs;
};

/** Active Optimum staff (excludes affiliate portal users). */
async function listActiveTeamAdmins(): Promise<TeamAdminRecipient[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, first_name, phone, preferred_language, notification_prefs_json
     FROM admins
     WHERE status = 'active'
       AND role IN ('super_admin', 'admin', 'agent')
       AND email IS NOT NULL AND TRIM(email) <> ''`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    email: String(r.email),
    first_name: String(r.first_name || "Admin"),
    phone: r.phone ? String(r.phone) : null,
    preferred_language: (r.preferred_language as string) || "en",
    prefs: parseAdminNotificationPrefs(r.notification_prefs_json),
  }));
}

type TeamAdminNotifyBuild = {
  subject: string;
  html: string;
  inAppTitle: string;
  inAppBody: string;
  linkUrl: string;
  smsBody?: string;
};

async function deliverAdminNotificationChannels(opts: {
  admin: TeamAdminRecipient;
  eventKey: AdminNotifyEventKey;
  tpl: TeamAdminNotifyBuild;
}): Promise<{ email: boolean; in_app: boolean; sms: boolean }> {
  const { admin, eventKey, tpl } = opts;
  const result = { email: false, in_app: false, sms: false };

  if (adminNotifyPrefOn(admin.prefs, "email", eventKey)) {
    try {
      await sendEmail({
        to: admin.email,
        subject: tpl.subject,
        html: tpl.html,
      });
      result.email = true;
    } catch (e: any) {
      console.error(
        `[notify:${eventKey}:email] ${admin.email}:`,
        e?.message ?? e,
      );
    }
  }

  if (adminNotifyPrefOn(admin.prefs, "in_app", eventKey)) {
    try {
      await insertAdminInAppNotification({
        adminId: admin.id,
        eventKey,
        title: tpl.inAppTitle,
        body: tpl.inAppBody,
        linkUrl: tpl.linkUrl,
      });
      result.in_app = true;
    } catch (e: any) {
      console.error(
        `[notify:${eventKey}:in_app] admin ${admin.id}:`,
        e?.message ?? e,
      );
    }
  }

  if (
    isAdminSmsChannelAvailable() &&
    adminNotifyPrefOn(admin.prefs, "sms", eventKey) &&
    admin.phone
  ) {
    try {
      const smsText =
        tpl.smsBody ||
        `${tpl.inAppTitle}: ${tpl.inAppBody}`.slice(0, 320);
      await sendSms({ to: admin.phone, body: smsText });
      result.sms = true;
    } catch (e: any) {
      console.error(
        `[notify:${eventKey}:sms] ${admin.phone}:`,
        e?.message ?? e,
      );
    }
  }

  return result;
}

async function notifyAllTeamAdmins(
  eventKey: AdminNotifyEventKey,
  build: (admin: TeamAdminRecipient) => TeamAdminNotifyBuild,
): Promise<{ sent: number; errors: string[] }> {
  const admins = await listActiveTeamAdmins();
  if (admins.length === 0) {
    console.warn(
      "[notifyAllTeamAdmins] no active team admins with email — alert skipped",
    );
    return { sent: 0, errors: ["no_active_team_admins"] };
  }
  const errors: string[] = [];
  let sent = 0;
  await Promise.all(
    admins.map(async (admin) => {
      try {
        const tpl = build(admin);
        const delivered = await deliverAdminNotificationChannels({
          admin,
          eventKey,
          tpl,
        });
        if (delivered.email || delivered.in_app || delivered.sms) sent += 1;
      } catch (e: any) {
        errors.push(`${admin.email}: ${e?.message ?? e}`);
      }
    }),
  );
  if (errors.length) {
    console.error("[notifyAllTeamAdmins] partial failures:", errors.join("; "));
  }
  return { sent, errors };
}

/**
 * Email the language-owner admin when a client is sent a document upload link.
 */
async function notifyLanguageOwnerDocUploadLink(opts: {
  clientId: number;
  firstName: string;
  lastName: string;
  clientEmail: string;
  lang: string;
  portalUrl: string;
  assignedAdminId?: number | null;
  caseId?: number | null;
}): Promise<void> {
  let ownerId = opts.assignedAdminId ?? null;
  if (!ownerId) {
    const [cRows] = await pool.query<RowDataPacket[]>(
      `SELECT assigned_admin_id, preferred_language FROM clients WHERE id = ? LIMIT 1`,
      [opts.clientId],
    );
    ownerId = cRows[0]?.assigned_admin_id
      ? Number(cRows[0].assigned_admin_id)
      : await resolveLanguageOwnerAdminId(
          cRows[0]?.preferred_language === "es" ? "es" : "en",
        );
  }
  if (!ownerId) return;
  const [aRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, first_name, phone, preferred_language, status, notification_prefs_json
     FROM admins WHERE id = ? LIMIT 1`,
    [ownerId],
  );
  const adminRow = aRows[0];
  if (!adminRow || adminRow.status !== "active" || !adminRow.email) return;
  const admin: TeamAdminRecipient = {
    id: Number(adminRow.id),
    email: String(adminRow.email),
    first_name: String(adminRow.first_name || "Admin"),
    phone: adminRow.phone ? String(adminRow.phone) : null,
    preferred_language: (adminRow.preferred_language as string) || "en",
    prefs: parseAdminNotificationPrefs(adminRow.notification_prefs_json),
  };
  const adminLang = admin.preferred_language === "es" ? "es" : "en";
  const caseUploadUrl = opts.caseId
    ? `${APP_URL}/admin/pipeline?case=${opts.caseId}`
    : `${APP_URL}/admin/clients`;
  const tplEmail = tplAdminDocUploadLinkAlert({
    adminFirstName: admin.first_name,
    clientName: `${opts.firstName} ${opts.lastName}`.trim(),
    clientEmail: opts.clientEmail,
    portalUrl: opts.portalUrl,
    caseUploadUrl,
    lang: adminLang,
  });
  const clientName = `${opts.firstName} ${opts.lastName}`.trim();
  await deliverAdminNotificationChannels({
    admin,
    eventKey: "doc_upload_link",
    tpl: {
      subject: tplEmail.subject,
      html: tplEmail.html,
      inAppTitle:
        adminLang === "es"
          ? "Enlace de carga enviado"
          : "Upload link sent",
      inAppBody:
        adminLang === "es"
          ? `Se envió el enlace del portal a ${clientName}.`
          : `Portal upload link sent to ${clientName}.`,
      linkUrl: caseUploadUrl,
      smsBody: `Optimum: upload link sent to ${clientName}`,
    },
  });
}

function tplAdminNewPurchaseAlert(opts: {
  adminFirstName: string;
  clientName: string;
  clientEmail: string;
  packageName: string;
  amountFormatted: string;
  pipelineUrl: string;
  kind?: "enrollment" | "installment";
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const isInstallment = opts.kind === "installment";
  const headline = isInstallment
    ? isEs
      ? "Pago de cuota recibido"
      : "Installment payment received"
    : isEs
      ? "Nueva compra / pago confirmado"
      : "New purchase / payment confirmed";
  const detail = isInstallment
    ? isEs
      ? `pagó una cuota. Concepto: <strong>${escapeHtml(opts.packageName)}</strong> — ${escapeHtml(opts.amountFormatted)}.`
      : `paid an installment. Label: <strong>${escapeHtml(opts.packageName)}</strong> — ${escapeHtml(opts.amountFormatted)}.`
    : isEs
      ? `acaba de pagar. Paquete: <strong>${escapeHtml(opts.packageName)}</strong> — ${escapeHtml(opts.amountFormatted)}.`
      : `just paid. Package: <strong>${escapeHtml(opts.packageName)}</strong> — ${escapeHtml(opts.amountFormatted)}.`;
  const followUp = isInstallment
    ? isEs
      ? "Revisa el calendario de pagos / pipeline del caso."
      : "Review the case payment schedule / pipeline."
    : isEs
      ? "Ya debería aparecer en el pipeline (Nuevo Cliente). El cliente recibe el enlace del portal para subir documentos."
      : "They should now appear on the pipeline (New Client). The client gets the portal link to upload documents.";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">${escapeHtml(headline)}</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.adminFirstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         <strong>${escapeHtml(opts.clientName)}</strong> (${escapeHtml(opts.clientEmail)})
         ${detail}
       </p>
       <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(followUp)}</p>
       ${emailButton(opts.pipelineUrl, "Abrir pipeline")}`
    : `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">${escapeHtml(headline)}</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.adminFirstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         <strong>${escapeHtml(opts.clientName)}</strong> (${escapeHtml(opts.clientEmail)})
         ${detail}
       </p>
       <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(followUp)}</p>
       ${emailButton(opts.pipelineUrl, "Open pipeline")}`;
  return {
    subject: isInstallment
      ? isEs
        ? `Pago recibido — ${opts.clientName}`
        : `Payment received — ${opts.clientName}`
      : isEs
        ? `Nueva compra — ${opts.clientName}`
        : `New purchase — ${opts.clientName}`,
    html: emailLayout({
      title: headline,
      preheader: opts.packageName,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

function tplAdminClientSubmissionAlert(opts: {
  adminFirstName: string;
  clientName: string;
  clientEmail: string;
  summary: string;
  pipelineUrl: string;
  allRequiredDone: boolean;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const headline = opts.allRequiredDone
    ? isEs
      ? "Cliente listo para revisión"
      : "Client ready for review"
    : isEs
      ? "Cliente envió documentos / tareas"
      : "Client submitted documents / tasks";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">${escapeHtml(headline)}</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.adminFirstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         <strong>${escapeHtml(opts.clientName)}</strong> (${escapeHtml(opts.clientEmail)})
         ${opts.allRequiredDone ? "completó todas las tareas requeridas y están pendientes de revisión." : "envió material para revisión."}
       </p>
       <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(opts.summary)}</p>
       ${emailButton(opts.pipelineUrl, "Revisar en el pipeline")}`
    : `<h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#0f172a;">${escapeHtml(headline)}</h1>
       <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.adminFirstName)},</p>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
         <strong>${escapeHtml(opts.clientName)}</strong> (${escapeHtml(opts.clientEmail)})
         ${opts.allRequiredDone ? "completed all required tasks and they are pending review." : "submitted material for review."}
       </p>
       <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(opts.summary)}</p>
       ${emailButton(opts.pipelineUrl, "Review on pipeline")}`;
  return {
    subject: opts.allRequiredDone
      ? isEs
        ? `Listo para revisión — ${opts.clientName}`
        : `Ready for review — ${opts.clientName}`
      : isEs
        ? `Envío del cliente — ${opts.clientName}`
        : `Client submission — ${opts.clientName}`,
    html: emailLayout({
      title: headline,
      preheader: opts.summary,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

async function notifyAdminsNewPurchase(opts: {
  clientId: number;
  clientName: string;
  clientEmail: string;
  packageName: string | null;
  amountCents: number | null;
  caseId?: number | null;
  kind?: "enrollment" | "installment";
}): Promise<void> {
  const amountFormatted =
    opts.amountCents != null
      ? `$${(Number(opts.amountCents) / 100).toFixed(2)}`
      : "—";
  const packageName = opts.packageName?.trim() || "Package";
  const pipelineUrl = opts.caseId
    ? `${APP_URL}/admin/pipeline?case=${opts.caseId}`
    : `${APP_URL}/admin/pipeline?client=${opts.clientId}`;
  const kind = opts.kind || "enrollment";
  const eventKey: AdminNotifyEventKey =
    kind === "installment" ? "payment_installment" : "purchase_enrollment";
  await notifyAllTeamAdmins(eventKey, (admin) => {
    const lang = admin.preferred_language === "es" ? "es" : "en";
    const emailTpl = tplAdminNewPurchaseAlert({
      adminFirstName: admin.first_name,
      clientName: opts.clientName,
      clientEmail: opts.clientEmail,
      packageName,
      amountFormatted,
      pipelineUrl,
      kind,
      lang,
    });
    return {
      subject: emailTpl.subject,
      html: emailTpl.html,
      inAppTitle: emailTpl.subject,
      inAppBody: `${opts.clientName} · ${packageName} · ${amountFormatted}`,
      linkUrl: pipelineUrl,
      smsBody: `${emailTpl.subject}: ${packageName} ${amountFormatted}`,
    };
  });
}

/** Resolve client + case, then email all team admins about a payment. */
async function notifyAdminsPaymentByClientId(opts: {
  clientId: number;
  amountCents: number | null;
  caseId?: number | null;
  packageOrLabel?: string | null;
  kind: "enrollment" | "installment";
}): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT first_name, last_name, email FROM clients WHERE id = ? LIMIT 1`,
    [opts.clientId],
  );
  if (!rows[0]?.email) return;
  const clientName =
    `${rows[0].first_name || ""} ${rows[0].last_name || ""}`.trim() ||
    String(rows[0].email);
  let caseId = opts.caseId ?? null;
  if (!caseId) {
    caseId = await resolvePrimaryActiveCaseId(pool, opts.clientId);
  }
  await notifyAdminsNewPurchase({
    clientId: opts.clientId,
    clientName,
    clientEmail: String(rows[0].email),
    packageName: opts.packageOrLabel || null,
    amountCents: opts.amountCents,
    caseId,
    kind: opts.kind,
  });
}

async function notifyAdminsClientSubmission(opts: {
  clientId: number;
  caseId: number;
  summary: string;
  allRequiredDone: boolean;
  kind?: "doc_upload" | "info_request" | "ready_review";
}): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT first_name, last_name, email FROM clients WHERE id = ? LIMIT 1`,
    [opts.clientId],
  );
  if (!rows[0]) return;
  const clientName =
    `${rows[0].first_name || ""} ${rows[0].last_name || ""}`.trim() ||
    "Client";
  const pipelineUrl = `${APP_URL}/admin/pipeline?case=${opts.caseId}`;
  const eventKey: AdminNotifyEventKey = opts.allRequiredDone
    ? "submission_ready_review"
    : opts.kind === "info_request"
      ? "submission_info_request"
      : "submission_doc_upload";
  await notifyAllTeamAdmins(eventKey, (admin) => {
    const lang = admin.preferred_language === "es" ? "es" : "en";
    const emailTpl = tplAdminClientSubmissionAlert({
      adminFirstName: admin.first_name,
      clientName,
      clientEmail: rows[0].email
        ? String(rows[0].email)
        : "(no email on file)",
      summary: opts.summary,
      pipelineUrl,
      allRequiredDone: opts.allRequiredDone,
      lang,
    });
    return {
      subject: emailTpl.subject,
      html: emailTpl.html,
      inAppTitle: emailTpl.subject,
      inAppBody: opts.summary,
      linkUrl: pipelineUrl,
      smsBody: `${emailTpl.subject}: ${opts.summary}`.slice(0, 320),
    };
  });
}

async function countRequiredOnboardingProgress(
  caseId: number,
): Promise<{ required: number; completed: number }> {
  const [[reqRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM onboarding_task_templates
     WHERE is_active = 1 AND is_required = 1`,
  );
  const [[doneRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM client_task_completions ctc
     JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
     WHERE ctc.case_id = ?
       AND ott.is_active = 1 AND ott.is_required = 1
       AND ctc.status = 'completed'`,
    [caseId],
  );
  return {
    required: Number(reqRow?.cnt || 0),
    completed: Number(doneRow?.cnt || 0),
  };
}

/**
 * Phase 2: auto-email Realtor/Broker referrers on round stage changes.
 */
async function notifyReferrerRoundUpdate(
  clientId: number,
  stage: string,
): Promise<void> {
  if (!ROUND_STAGE_LABELS[stage]) return;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.first_name, c.last_name, c.referral_category, c.preferred_language,
            r.id AS referrer_id, r.first_name AS ref_first, r.last_name AS ref_last,
            r.email AS ref_email, r.preferred_language AS ref_lang, r.category AS ref_category
     FROM clients c
     LEFT JOIN referrers r ON r.id = c.referrer_id AND r.status = 'active'
     WHERE c.id = ? LIMIT 1`,
    [clientId],
  );
  const row = rows[0];
  if (!row) return;
  if (row.referral_category !== "realtor_broker") return;
  if (!row.ref_email) return;
  const lang =
    row.ref_lang === "es" || row.preferred_language === "es" ? "es" : "en";
  const labels = ROUND_STAGE_LABELS[stage];
  const tpl = tplReferrerRoundUpdate({
    referrerFirstName: String(row.ref_first || "Partner"),
    clientName: `${row.first_name} ${row.last_name}`.trim(),
    stageLabel: lang === "es" ? labels.es : labels.en,
    lang,
  });
  await sendEmail({
    to: String(row.ref_email),
    subject: tpl.subject,
    html: tpl.html,
  });
}

// ============================================================================
// PAYMENT DUE EMAIL (split reminder — used by scheduleSplitReminders)
// ============================================================================
function tplPaymentDue(opts: {
  firstName: string;
  label: string;
  amountFormatted: string;
  dueDateFormatted: string;
  paymentLink: string;
  lang?: string;
}) {
  const isEs = opts.lang === "es";
  const body = isEs
    ? `<h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Recordatorio de pago</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(opts.firstName)}, tienes un pago próximo:</p>
       <div style="margin:20px 0;padding:20px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
         <div style="font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(opts.label)}</div>
         <div style="font-size:32px;font-weight:800;color:#0f172a;margin:8px 0;">${escapeHtml(opts.amountFormatted)}</div>
         <div style="font-size:13px;color:#64748b;">Fecha de vencimiento: <strong style="color:#0f172a;">${escapeHtml(opts.dueDateFormatted)}</strong></div>
       </div>
       ${emailButton(opts.paymentLink, "Pagar ahora")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">Si ya realizaste el pago, ignora este mensaje.</p>`
    : `<h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Payment reminder</h1>
       <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(opts.firstName)}, you have an upcoming payment:</p>
       <div style="margin:20px 0;padding:20px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
         <div style="font-size:13px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(opts.label)}</div>
         <div style="font-size:32px;font-weight:800;color:#0f172a;margin:8px 0;">${escapeHtml(opts.amountFormatted)}</div>
         <div style="font-size:13px;color:#64748b;">Due date: <strong style="color:#0f172a;">${escapeHtml(opts.dueDateFormatted)}</strong></div>
       </div>
       ${emailButton(opts.paymentLink, "Pay Now")}
       <p style="margin:24px 0 0;font-size:13px;color:#64748b;">If you've already paid, please disregard this message.</p>`;
  return {
    subject: isEs
      ? `Recordatorio: ${opts.amountFormatted} vence el ${opts.dueDateFormatted}`
      : `Payment reminder: ${opts.amountFormatted} due ${opts.dueDateFormatted}`,
    html: emailLayout({
      title: isEs ? "Recordatorio de pago" : "Payment reminder",
      preheader: isEs
        ? `${opts.amountFormatted} vence el ${opts.dueDateFormatted}.`
        : `${opts.amountFormatted} due on ${opts.dueDateFormatted}.`,
      bodyHtml: body,
      lang: opts.lang,
    }),
  };
}

// ============================================================================
// SPLIT REMINDER SCHEDULER
// Seeds notification_queue for a split based on reminder flow steps.
// delay_days means "days BEFORE due_date" (inverse of pipeline flows).
// ============================================================================
async function scheduleSplitReminders(opts: {
  splitId: number;
  clientId: number;
  flowId: number;
  dueDate: Date;
  paymentLink: string;
  label: string;
  amountFormatted: string;
  dueDateFormatted: string;
}): Promise<void> {
  const [clientRows] = await pool.query<RowDataPacket[]>(
    `SELECT first_name, email, preferred_language FROM clients WHERE id = ? LIMIT 1`,
    [opts.clientId],
  );
  if (clientRows.length === 0) return;
  const client = clientRows[0];
  const deliverTo = String(client.email || "").trim();
  if (!deliverTo) {
    console.warn(
      `[split-reminders] Skipping — client ${opts.clientId} has no email (split ${opts.splitId})`,
    );
    return;
  }
  const lang = (client.preferred_language as string) || "en";

  const [steps] = await pool.query<RowDataPacket[]>(
    `SELECT delay_days FROM reminder_flow_steps WHERE flow_id = ? ORDER BY step_order ASC`,
    [opts.flowId],
  );
  if (steps.length === 0) return;

  const now = new Date();
  for (const step of steps) {
    const delayDays = step.delay_days as number;
    const scheduledFor = new Date(
      opts.dueDate.getTime() - delayDays * 86400000,
    );
    if (scheduledFor <= now) continue; // skip past dates

    const tpl = tplPaymentDue({
      firstName: client.first_name as string,
      label: opts.label,
      amountFormatted: opts.amountFormatted,
      dueDateFormatted: opts.dueDateFormatted,
      paymentLink: opts.paymentLink,
      lang,
    });

    await pool.query<ResultSetHeader>(
      `INSERT INTO notification_queue
         (client_id, channel, to_address, subject, body, scheduled_for, payload_json)
       VALUES (?, 'email', ?, ?, ?, ?, ?)`,
      [
        opts.clientId,
        deliverTo,
        tpl.subject,
        tpl.html,
        scheduledFor,
        JSON.stringify({ split_id: opts.splitId }),
      ],
    );
  }
}

// ============================================================================
// ADMIN WELCOME EMAIL TEMPLATE
// ============================================================================

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  agent: "Agent",
  affiliate: "Affiliate",
};

function tplAdminWelcome(opts: {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  loginUrl: string;
  invitedByName: string;
}) {
  const roleLabel = ROLE_LABELS[opts.role] || opts.role;
  const body = `
    <div style="margin:0 0 28px;padding:24px 28px;background:linear-gradient(135deg,#1a2342 0%,#121829 100%);border-radius:14px;position:relative;overflow:hidden;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#C0A06A;margin-bottom:10px;">You're on the team</div>
      <div style="font-size:30px;font-weight:800;color:#ffffff;line-height:1.2;margin-bottom:8px;">Welcome, ${escapeHtml(opts.firstName)}!</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.55);">Optimum Credit Admin Panel</div>
    </div>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#334155;">
      <strong>${escapeHtml(opts.invitedByName)}</strong> has added you to the <strong>Optimum Credit</strong> admin team.
      Your account is ready and you've been granted access as a
      <span style="display:inline-block;font-size:11px;font-weight:700;background:#C0A06A;color:#121829;padding:1px 10px;border-radius:20px;vertical-align:middle;margin-left:4px;">${escapeHtml(roleLabel)}</span>
    </p>
    <div style="margin:20px 0;padding:0;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
      <div style="padding:10px 20px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Your account details</div>
      </div>
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:12px 20px;width:110px;font-size:12px;font-weight:600;color:#94a3b8;vertical-align:top;">Full name</td>
          <td style="padding:12px 20px;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(opts.firstName)} ${escapeHtml(opts.lastName)}</td>
        </tr>
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:12px 20px;font-size:12px;font-weight:600;color:#94a3b8;vertical-align:top;">Email</td>
          <td style="padding:12px 20px;font-size:14px;color:#0f172a;">${escapeHtml(opts.email)}</td>
        </tr>
        <tr>
          <td style="padding:12px 20px;font-size:12px;font-weight:600;color:#94a3b8;vertical-align:middle;">Access level</td>
          <td style="padding:12px 20px;">
            <span style="display:inline-block;font-size:11px;font-weight:700;background:#C0A06A;color:#121829;padding:3px 12px;border-radius:20px;">${escapeHtml(roleLabel)}</span>
          </td>
        </tr>
      </table>
    </div>
    <p style="margin:20px 0 8px;font-size:14px;line-height:1.6;color:#334155;">
      Click the button below to access your admin panel. You sign in with a one-time code sent to this email — no password needed.
    </p>
    ${emailButton(opts.loginUrl, "Go to Admin Panel")}
    <div style="margin:24px 0 0;padding:14px 18px;background:#f1f5f9;border-radius:10px;border-left:4px solid #C0A06A;">
      <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:4px;">🔒 Security reminder</div>
      <div style="font-size:12px;color:#64748b;line-height:1.6;">
        Optimum Credit staff will <em>never</em> ask for your sign-in code via phone or chat.
        Only enter codes on the official admin login page. If you weren't expecting this invitation, please contact your administrator immediately.
      </div>
    </div>`;
  return {
    subject: `You've been added to Optimum Credit — welcome aboard, ${opts.firstName}!`,
    html: emailLayout({
      title: "Welcome to the Optimum Credit team",
      preheader: `${opts.invitedByName} has added you to the Optimum Credit admin team as ${roleLabel}.`,
      bodyHtml: body,
    }),
  };
}

// ============================================================================
// SMS HELPERS
// ============================================================================

async function sendSms(opts: { to: string; body: string }) {
  if (!twilioClient || !TWILIO_FROM || process.env.VITEST === "true") {
    console.log("[sms:dry-run]", opts.to, opts.body);
    return { sid: "dry-run", status: "dry-run" };
  }
  const msg = await twilioClient.messages.create({
    from: TWILIO_FROM,
    to: opts.to,
    body: opts.body,
  });
  return { sid: msg.sid, status: msg.status };
}

/**
 * Validate an inbound Twilio webhook's X-Twilio-Signature. Returns true
 * when TWILIO_AUTH_TOKEN isn't configured AND we're not in production —
 * every other case requires a valid signature. This stops anyone from
 * POSTing forged inbound-SMS/voice payloads directly to our webhook URL.
 */
function isValidTwilioWebhookRequest(req: Request): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return !IS_PROD;
  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!signature) return false;
  const url = `${APP_URL}${req.originalUrl}`;
  try {
    return twilio.validateRequest(
      authToken,
      signature,
      url,
      (req.body as Record<string, string>) || {},
    );
  } catch {
    return false;
  }
}

// ============================================================================
// AUTHORIZE.NET HELPERS
// ============================================================================

async function chargeCard(opts: {
  amountDollars: string;
  dataDescriptor: string;
  dataValue: string;
  clientId: number;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<{
  transactionId: string;
  customerProfileId?: string;
  customerPaymentProfileId?: string;
}> {
  // Step 1: Charge the card. No createCustomerProfile field — it doesn't exist
  // in the createTransactionRequest XSD schema. Customer profile is created
  // separately after a successful charge via createCustomerProfileFromTransactionRequest.
  const chargePayload = {
    createTransactionRequest: {
      merchantAuthentication: {
        name: process.env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: process.env.AUTHORIZENET_TRANSACTION_KEY,
      },
      transactionRequest: {
        transactionType: "authCaptureTransaction",
        amount: opts.amountDollars,
        payment: {
          opaqueData: {
            dataDescriptor: opts.dataDescriptor,
            dataValue: opts.dataValue,
          },
        },
        customer: {
          type: "individual",
          id: String(opts.clientId),
          email: opts.email,
        },
        billTo: {
          firstName: opts.firstName,
          lastName: opts.lastName,
          email: opts.email,
        },
        userFields: {
          userField: [{ name: "client_id", value: String(opts.clientId) }],
        },
      },
    },
  };

  const resp = await fetch(AUTHORIZENET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(chargePayload),
  });
  const data = (await resp.json()) as any;

  console.log(
    "[anet:charge]",
    JSON.stringify(
      {
        resultCode: data?.messages?.resultCode,
        responseCode: data?.transactionResponse?.responseCode,
        transId: data?.transactionResponse?.transId,
        authCode: data?.transactionResponse?.authCode,
        errors: data?.transactionResponse?.errors,
        messages: data?.messages?.message,
      },
      null,
      2,
    ),
  );

  if (
    data?.messages?.resultCode !== "Ok" ||
    data?.transactionResponse?.responseCode !== "1"
  ) {
    const errText =
      data?.transactionResponse?.errors?.error?.[0]?.errorText ||
      data?.messages?.message?.[0]?.text ||
      "Payment processing failed";
    throw new Error(errText);
  }

  const transactionId = data.transactionResponse.transId as string;

  // Step 2: Create customer profile from the successful transaction.
  // This is the documented approach — a separate call after charge.
  // Errors here are non-fatal: the charge already succeeded.
  let customerProfileId: string | undefined;
  let customerPaymentProfileId: string | undefined;
  try {
    const profileResp = await fetch(AUTHORIZENET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        createCustomerProfileFromTransactionRequest: {
          merchantAuthentication: {
            name: process.env.AUTHORIZENET_API_LOGIN_ID,
            transactionKey: process.env.AUTHORIZENET_TRANSACTION_KEY,
          },
          transId: transactionId,
        },
      }),
    });
    const profileData = (await profileResp.json()) as any;
    console.log(
      "[anet:profile]",
      JSON.stringify(
        {
          resultCode: profileData?.messages?.resultCode,
          customerProfileId: profileData?.customerProfileId,
          customerPaymentProfileIdList:
            profileData?.customerPaymentProfileIdList,
          messages: profileData?.messages?.message,
        },
        null,
        2,
      ),
    );
    if (profileData?.messages?.resultCode === "Ok") {
      customerProfileId = profileData.customerProfileId as string;
      customerPaymentProfileId = profileData
        .customerPaymentProfileIdList?.[0] as string | undefined;
    }
  } catch (profileErr) {
    // Profile creation failure doesn't block the payment flow
    console.error("[anet:profile:error]", profileErr);
  }

  return { transactionId, customerProfileId, customerPaymentProfileId };
}

/**
 * Create or replace an Authorize.net customer/payment profile from Accept.js
 * opaque data without charging (used by info-request payment_card fields).
 */
async function createOrUpdatePaymentProfileFromOpaque(opts: {
  dataDescriptor: string;
  dataValue: string;
  clientId: number;
  email: string;
  firstName: string;
  lastName: string;
  existingCustomerProfileId?: string | null;
}): Promise<{
  customerProfileId: string;
  customerPaymentProfileId?: string;
  last4?: string | null;
}> {
  const merchantAuthentication = {
    name: process.env.AUTHORIZENET_API_LOGIN_ID,
    transactionKey: process.env.AUTHORIZENET_TRANSACTION_KEY,
  };

  if (opts.existingCustomerProfileId) {
    const payload = {
      createCustomerPaymentProfileRequest: {
        merchantAuthentication,
        customerProfileId: opts.existingCustomerProfileId,
        paymentProfile: {
          billTo: {
            firstName: opts.firstName,
            lastName: opts.lastName,
          },
          payment: {
            opaqueData: {
              dataDescriptor: opts.dataDescriptor,
              dataValue: opts.dataValue,
            },
          },
          defaultPaymentProfile: true,
        },
        validationMode:
          process.env.AUTHORIZENET_ENV === "production"
            ? "liveMode"
            : "testMode",
      },
    };
    const resp = await fetch(AUTHORIZENET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as any;
    if (data?.messages?.resultCode === "Ok") {
      const paymentProfileId = data?.customerPaymentProfileId as
        | string
        | undefined;
      if (paymentProfileId) {
        await pool.query(
          `UPDATE clients SET anet_payment_profile_id = ? WHERE id = ?`,
          [paymentProfileId, opts.clientId],
        );
      }
      return {
        customerProfileId: opts.existingCustomerProfileId,
        customerPaymentProfileId: paymentProfileId,
        last4: null,
      };
    }
    // Fall through to create a fresh customer profile if adding a payment profile fails
    console.warn(
      "[anet:paymentProfile]",
      data?.messages?.message?.[0]?.text ||
        "createCustomerPaymentProfile failed",
    );
  }

  const createPayload = {
    createCustomerProfileRequest: {
      merchantAuthentication,
      profile: {
        merchantCustomerId: `c${opts.clientId}-${Date.now()}`.slice(0, 20),
        email: opts.email,
        paymentProfiles: {
          customerType: "individual",
          billTo: {
            firstName: opts.firstName,
            lastName: opts.lastName,
          },
          payment: {
            opaqueData: {
              dataDescriptor: opts.dataDescriptor,
              dataValue: opts.dataValue,
            },
          },
        },
      },
      validationMode:
        process.env.AUTHORIZENET_ENV === "production" ? "liveMode" : "testMode",
    },
  };
  const resp = await fetch(AUTHORIZENET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createPayload),
  });
  const data = (await resp.json()) as any;
  if (data?.messages?.resultCode !== "Ok") {
    throw new Error(
      data?.messages?.message?.[0]?.text || "Failed to save payment card",
    );
  }
  const customerProfileId = String(data.customerProfileId);
  const customerPaymentProfileId = data.customerPaymentProfileIdList
    ?.numericString?.[0]
    ? String(data.customerPaymentProfileIdList.numericString[0])
    : data.customerPaymentProfileIdList?.[0]
      ? String(data.customerPaymentProfileIdList[0])
      : undefined;

  await pool.query(
    `UPDATE clients SET anet_customer_profile_id = ?, anet_payment_profile_id = ? WHERE id = ?`,
    [customerProfileId, customerPaymentProfileId ?? null, opts.clientId],
  );

  return {
    customerProfileId,
    customerPaymentProfileId,
    last4: null,
  };
}

function anetDateYmd(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** True if the affiliate row already has a live or in-flight ARB subscription. */
function hasActiveOrPendingSubscription(aff: RowDataPacket): boolean {
  const status = aff.subscription_status as string;
  return (
    status === "active" || status === "pending" || !!aff.anet_subscription_id
  );
}

async function createARBSubscription(opts: {
  amountDollars: string;
  dataDescriptor: string;
  dataValue: string;
  clientId: number;
  email: string;
  firstName: string;
  lastName: string;
  subscriptionName: string;
  startDate?: string;
}): Promise<{ subscriptionId: string }> {
  const payload = {
    ARBCreateSubscriptionRequest: {
      merchantAuthentication: {
        name: process.env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: process.env.AUTHORIZENET_TRANSACTION_KEY,
      },
      subscription: {
        name: opts.subscriptionName.slice(0, 50),
        paymentSchedule: {
          interval: { length: "1", unit: "months" },
          startDate: opts.startDate ?? anetDateYmd(),
          totalOccurrences: "9999",
        },
        amount: opts.amountDollars,
        payment: {
          opaqueData: {
            dataDescriptor: opts.dataDescriptor,
            dataValue: opts.dataValue,
          },
        },
        billTo: {
          firstName: opts.firstName,
          lastName: opts.lastName,
          email: opts.email,
        },
        customer: {
          type: "individual",
          id: String(opts.clientId),
          email: opts.email,
        },
      },
    },
  };

  const resp = await fetch(AUTHORIZENET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await resp.json()) as any;

  console.log(
    "[anet:arb-create]",
    JSON.stringify(
      {
        resultCode: data?.messages?.resultCode,
        subscriptionId: data?.subscriptionId,
        messages: data?.messages?.message,
      },
      null,
      2,
    ),
  );

  if (data?.messages?.resultCode !== "Ok" || !data?.subscriptionId) {
    const errText =
      data?.messages?.message?.[0]?.text || "Subscription creation failed";
    throw new Error(errText);
  }

  return { subscriptionId: String(data.subscriptionId) };
}

async function cancelARBSubscription(subscriptionId: string): Promise<void> {
  const payload = {
    ARBCancelSubscriptionRequest: {
      merchantAuthentication: {
        name: process.env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: process.env.AUTHORIZENET_TRANSACTION_KEY,
      },
      subscriptionId,
    },
  };

  const resp = await fetch(AUTHORIZENET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await resp.json()) as any;

  console.log(
    "[anet:arb-cancel]",
    JSON.stringify(
      {
        resultCode: data?.messages?.resultCode,
        messages: data?.messages?.message,
      },
      null,
      2,
    ),
  );

  if (data?.messages?.resultCode !== "Ok") {
    const errText =
      data?.messages?.message?.[0]?.text || "Subscription cancellation failed";
    throw new Error(errText);
  }
}

async function createARBSubscriptionFromProfile(opts: {
  customerProfileId: string;
  customerPaymentProfileId: string;
  amountDollars: string;
  clientId: number;
  email: string;
  subscriptionName: string;
  startDate?: string;
}): Promise<{ subscriptionId: string }> {
  const payload = {
    ARBCreateSubscriptionRequest: {
      merchantAuthentication: {
        name: process.env.AUTHORIZENET_API_LOGIN_ID,
        transactionKey: process.env.AUTHORIZENET_TRANSACTION_KEY,
      },
      subscription: {
        name: opts.subscriptionName.slice(0, 50),
        paymentSchedule: {
          interval: { length: "1", unit: "months" },
          startDate: opts.startDate ?? anetDateYmd(),
          totalOccurrences: "9999",
        },
        amount: opts.amountDollars,
        profile: {
          customerProfileId: opts.customerProfileId,
          customerPaymentProfileId: opts.customerPaymentProfileId,
        },
        customer: {
          type: "individual",
          id: String(opts.clientId),
          email: opts.email,
        },
      },
    },
  };

  const resp = await fetch(AUTHORIZENET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await resp.json()) as any;

  if (data?.messages?.resultCode !== "Ok" || !data?.subscriptionId) {
    const errText =
      data?.messages?.message?.[0]?.text ||
      "Subscription creation failed (stored card)";
    throw new Error(errText);
  }

  return { subscriptionId: String(data.subscriptionId) };
}

async function sendPeaceOfMindSubscriptionEmail(
  clientId: number,
  kind: "started" | "cancelled",
): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT first_name, email, preferred_language FROM clients WHERE id = ? LIMIT 1`,
    [clientId],
  );
  if (rows.length === 0 || !rows[0].email) return;
  const firstName = String(rows[0].first_name || "there");
  const lang = rows[0].preferred_language === "es" ? "es" : "en";
  const isEs = lang === "es";
  const appUrl = APP_URL;

  const body =
    kind === "started"
      ? isEs
        ? `<h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Peace of Mind activado</h1>
           <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(firstName)}, tu suscripción Peace of Mind ($49.99/mes) está activa. Tienes soporte ilimitado y prioridad en el portal.</p>
           ${emailButton(`${appUrl}/portal/payments`, "Ver mi suscripción")}`
        : `<h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Peace of Mind activated</h1>
           <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(firstName)}, your Peace of Mind subscription ($49.99/month) is now active. You have unlimited support and priority service in your portal.</p>
           ${emailButton(`${appUrl}/portal/payments`, "View subscription")}`
      : isEs
        ? `<h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Suscripción cancelada</h1>
           <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola ${escapeHtml(firstName)}, tu suscripción Peace of Mind ha sido cancelada. No se realizarán más cargos mensuales.</p>`
        : `<h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f172a;">Subscription cancelled</h1>
           <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hi ${escapeHtml(firstName)}, your Peace of Mind subscription has been cancelled. No further monthly charges will be made.</p>`;

  const subject = isEs
    ? kind === "started"
      ? "Peace of Mind — suscripción activa"
      : "Peace of Mind — suscripción cancelada"
    : kind === "started"
      ? "Peace of Mind — subscription active"
      : "Peace of Mind — subscription cancelled";

  await sendEmail({
    to: String(rows[0].email),
    subject,
    html: emailLayout({
      title: subject,
      bodyHtml: body,
      lang,
    }),
  }).catch((e) =>
    console.error("[email:peace-of-mind]", kind, e?.message ?? e),
  );
}

async function fetchTradelineSelectionsForPayments(
  paymentIds: number[],
): Promise<Map<number, RowDataPacket[]>> {
  const map = new Map<number, RowDataPacket[]>();
  if (paymentIds.length === 0) return map;
  const placeholders = paymentIds.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, payment_id, tradeline_product_id, product_name, product_details, price_cents, created_at
     FROM client_tradeline_selections
     WHERE payment_id IN (${placeholders})
     ORDER BY id ASC`,
    paymentIds,
  );
  for (const r of rows) {
    const pid = Number(r.payment_id);
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid)!.push(r);
  }
  return map;
}

async function processMockRegistrationPayment(
  clientId: number,
  amountCents: number,
  packageId: number,
  metadata: Record<string, unknown> = {},
): Promise<{ transactionId: string; paymentId: number }> {
  const txnId = `txn_mock_${Date.now()}_${clientId}`;
  const [payIns] = await pool.query<ResultSetHeader>(
    `INSERT INTO payments (client_id, package_id, amount_cents, status, provider, provider_transaction_id, metadata_json)
     VALUES (?, ?, ?, 'pending', 'authorize_net', ?, ?)`,
    [clientId, packageId, amountCents, txnId, JSON.stringify(metadata)],
  );
  await markPaymentSucceeded(clientId, txnId);
  return { transactionId: txnId, paymentId: payIns.insertId };
}

/** $0 checkout (e.g. 100% coupon) — no Authorize.net charge; records a manual payment. */
async function processFreeRegistrationPayment(
  clientId: number,
  packageId: number,
  metadata: Record<string, unknown> = {},
): Promise<{ transactionId: string; paymentId: number }> {
  const txnId = `free_${Date.now()}_${clientId}_${crypto.randomBytes(4).toString("hex")}`;
  const [payIns] = await pool.query<ResultSetHeader>(
    `INSERT INTO payments (client_id, package_id, amount_cents, status, provider, provider_transaction_id, metadata_json)
     VALUES (?, ?, 0, 'pending', 'manual', ?, ?)`,
    [
      clientId,
      packageId,
      txnId,
      JSON.stringify({ ...metadata, free_checkout: true }),
    ],
  );
  await markPaymentSucceeded(clientId, txnId);
  return { transactionId: txnId, paymentId: payIns.insertId };
}

async function loadActiveTradelineProducts(
  ids: number[],
): Promise<RowDataPacket[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, slug, name, details, price_cents, compare_price_cents
     FROM tradeline_products
     WHERE is_active = 1 AND id IN (${placeholders})
     ORDER BY sort_order ASC`,
    ids,
  );
  return rows;
}

async function insertTradelineSelections(
  clientId: number,
  paymentId: number,
  products: RowDataPacket[],
): Promise<void> {
  if (products.length === 0) return;
  const values = products.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
  const params = products.flatMap((p) => [
    clientId,
    paymentId,
    p.id,
    p.name,
    p.details,
    p.price_cents,
  ]);
  await pool.query<ResultSetHeader>(
    `INSERT INTO client_tradeline_selections
       (client_id, payment_id, tradeline_product_id, product_name, product_details, price_cents)
     VALUES ${values}`,
    params,
  );
}

// ============================================================================
// SHARED — payment success processing
// ============================================================================

/**
 * Resolves the primary active case for a client (package preferred, then newest).
 */
async function resolvePrimaryActiveCaseId(
  db: Pick<Pool, "query">,
  clientId: number,
): Promise<number | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM credit_repair_cases
     WHERE client_id = ? AND status = 'active'
     ORDER BY (package_id IS NOT NULL) DESC, id DESC
     LIMIT 1`,
    [clientId],
  );
  return (rows[0]?.id as number) ?? null;
}

/**
 * Creates client_task_completions rows for all active, auto_assign=1 templates
 * for a specific case. Safe to call multiple times (INSERT IGNORE).
 */
async function autoAssignTasksForCase(
  clientId: number,
  caseId: number,
): Promise<void> {
  const [templates] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM onboarding_task_templates
     WHERE is_active = 1 AND auto_assign = 1
     ORDER BY sort_order ASC, id ASC`,
  );
  if (templates.length === 0) return;

  const values = templates.map(() => "(?, ?, ?, 'pending')").join(", ");
  const params = templates.flatMap((t) => [clientId, caseId, t.id]);

  await pool.query<ResultSetHeader>(
    `INSERT IGNORE INTO client_task_completions (client_id, case_id, task_template_id, status)
     VALUES ${values}`,
    params,
  );
}

async function autoAssignTasksForClient(
  clientId: number,
  caseId?: number,
): Promise<void> {
  const resolved = caseId ?? (await resolvePrimaryActiveCaseId(pool, clientId));
  if (!resolved) return;
  await autoAssignTasksForCase(clientId, resolved);
}

/**
 * When staff uploads a case doc (id_front/id_back/ssn_card/proof_of_address),
 * mirror it onto the matching onboarding upload task as completed + approved
 * so the Tasks checklist and docs_ready rules stay in sync with portal uploads.
 */
async function syncAdminUploadToMatchingTask(opts: {
  clientId: number;
  caseId: number;
  docType: string;
  fileStorageKey: string;
  fileName: string;
  fileMime: string;
  adminId: number;
}): Promise<boolean> {
  const uploadSlugs = ["id_front", "id_back", "ssn_card", "proof_of_address"];
  if (!uploadSlugs.includes(opts.docType)) return false;

  const [tplRows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM onboarding_task_templates
     WHERE slug = ? AND task_type = 'upload' AND is_active = 1
     LIMIT 1`,
    [opts.docType],
  );
  if (!tplRows[0]) return false;
  const templateId = Number(tplRows[0].id);

  await pool.query<ResultSetHeader>(
    `INSERT INTO client_task_completions
       (client_id, case_id, task_template_id, status,
        file_storage_key, file_name, file_mime, completed_at,
        admin_review_status, admin_notes, admin_reviewed_at)
     VALUES (?, ?, ?, 'completed', ?, ?, ?, NOW(), 'approved', ?, NOW())
     ON DUPLICATE KEY UPDATE
       status = 'completed',
       file_storage_key = VALUES(file_storage_key),
       file_name = VALUES(file_name),
       file_mime = VALUES(file_mime),
       completed_at = NOW(),
       admin_review_status = 'approved',
       admin_notes = VALUES(admin_notes),
       admin_reviewed_at = NOW()`,
    [
      opts.clientId,
      opts.caseId,
      templateId,
      opts.fileStorageKey,
      opts.fileName,
      opts.fileMime,
      `Admin upload by #${opts.adminId}`,
    ],
  );
  return true;
}

/**
 * Docs Verified auto-advance: only when EVERY active required task for the
 * case is approved (uploads + service_agreement, etc.). Never advances early.
 */
async function maybeAutoAdvanceDocsReadyFromTasks(opts: {
  clientId: number;
  caseId: number;
  adminId: number;
}): Promise<boolean> {
  const [caseRows] = await pool.query<RowDataPacket[]>(
    `SELECT pipeline_stage FROM credit_repair_cases WHERE id = ? LIMIT 1`,
    [opts.caseId],
  );
  if (caseRows[0]?.pipeline_stage !== "new_client") return false;

  const [[reqRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS required_total FROM onboarding_task_templates
     WHERE is_active = 1 AND is_required = 1`,
  );
  const [[approvedRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS approved_count
     FROM client_task_completions ctc
     JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
     WHERE ctc.case_id = ? AND ctc.admin_review_status = 'approved'
       AND ott.is_required = 1 AND ott.is_active = 1`,
    [opts.caseId],
  );
  const requiredTotal = Number(reqRow.required_total);
  const approvedCount = Number(approvedRow.approved_count);
  if (requiredTotal <= 0 || approvedCount < requiredTotal) return false;

  await advanceCasePipeline(pool, {
    clientId: opts.clientId,
    caseId: opts.caseId,
    stage: "docs_ready",
    adminId: opts.adminId,
    notes: "Auto-advanced: all required tasks approved",
  });
  await pool.query<ResultSetHeader>(
    `UPDATE clients SET status = 'active' WHERE id = ? AND status <> 'active'`,
    [opts.clientId],
  );
  triggerReminderFlow("docs_ready", opts.clientId).catch((e) =>
    console.error("[flow:docs_ready]", e?.message),
  );
  return true;
}

// ============================================================================
// LABELS (source + analysis layers)
// ============================================================================

/** Attach labels to a client by slug, ignoring unknown slugs and dupes. */
async function attachLabelsBySlug(
  clientId: number,
  slugs: string[],
): Promise<void> {
  const uniqueSlugs = Array.from(new Set(slugs.filter(Boolean)));
  if (uniqueSlugs.length === 0) return;
  const [labelRows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM labels WHERE slug IN (?)`,
    [uniqueSlugs],
  );
  if (labelRows.length === 0) return;
  const values = labelRows.map(() => "(?, ?)").join(", ");
  const params = labelRows.flatMap((l) => [clientId, l.id]);
  await pool.query<ResultSetHeader>(
    `INSERT IGNORE INTO client_labels (client_id, label_id) VALUES ${values}`,
    params,
  );
}

/**
 * Resolve the language-owner admin for a client language.
 * Matches active staff (super_admin/admin/agent) whose preferred_language
 * equals the client's language. First match by id wins when multiple exist.
 */
async function resolveLanguageOwnerAdminId(
  lang: "en" | "es",
): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM admins
     WHERE preferred_language = ?
       AND status = 'active'
       AND role IN ('super_admin', 'admin', 'agent')
     ORDER BY id ASC
     LIMIT 1`,
    [lang],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

/** Map referral_category → source label slug(s) for the hybrid label system. */
function referralCategoryLabelSlugs(
  category: string | null | undefined,
): string[] {
  switch (category) {
    case "realtor_broker":
      return ["realtor_broker"];
    case "one_off":
      return ["one_off_referral"];
    case "affiliate_partner":
      return ["affiliate_referral"];
    default:
      return [];
  }
}

async function getClientLabels(clientId: number): Promise<Label[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.* FROM client_labels cl
     JOIN labels l ON l.id = cl.label_id
     WHERE cl.client_id = ?
     ORDER BY l.layer ASC, l.sort_order ASC, l.id ASC`,
    [clientId],
  );
  return rows as unknown as Label[];
}

/**
 * Batch-attach `labels` onto a list of rows, keyed by the client id found on
 * each row under `keyField` (defaults to `id` — the client's own primary key;
 * pass `"client_id"` for rows like pipeline cases where `id` is the case id).
 */
async function attachLabelsToRows(
  rows: RowDataPacket[],
  keyField: string = "id",
): Promise<void> {
  if (rows.length === 0) return;
  const ids = rows.map((r) => r[keyField] as number);
  const [labelRows] = await pool.query<RowDataPacket[]>(
    `SELECT cl.client_id, l.* FROM client_labels cl
     JOIN labels l ON l.id = cl.label_id
     WHERE cl.client_id IN (?)
     ORDER BY l.layer ASC, l.sort_order ASC, l.id ASC`,
    [ids],
  );
  const byClient = new Map<number, Label[]>();
  for (const lr of labelRows) {
    const cid = lr.client_id as number;
    const { client_id, ...label } = lr as any;
    if (!byClient.has(cid)) byClient.set(cid, []);
    byClient.get(cid)!.push(label as Label);
  }
  for (const r of rows) {
    (r as any).labels = byClient.get(r[keyField] as number) ?? [];
  }
}

/**
 * Prospects (1C): clients with status='prospect' + their latest credit
 * analysis summary. Pass `scopedAffiliateIds` (from `getAffiliateScope`) to
 * restrict results to an affiliate's own + sub-affiliates' referred prospects.
 */
async function fetchProspectsWithLabels(
  scopedAffiliateIds?: number[],
  extra?: { where: string[]; args: any[] },
): Promise<RowDataPacket[]> {
  const where: string[] = ["c.status = 'prospect'"];
  const args: any[] = [];
  if (scopedAffiliateIds && scopedAffiliateIds.length > 0) {
    where.push("c.affiliate_id IN (?)");
    args.push(scopedAffiliateIds);
  }
  if (extra?.where?.length) {
    where.push(...extra.where);
    args.push(...(extra.args || []));
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
            c.preferred_language, c.created_at,
            ca.id AS credit_analysis_id, ca.mode AS analysis_mode,
            ca.client_goal, ca.notes, ca.agent_phone, ca.rep_name,
            pc.case_id, pc.case_number
     FROM clients c
     LEFT JOIN (
       SELECT ca1.*
       FROM credit_analyses ca1
       INNER JOIN (
         SELECT client_id, MAX(id) AS max_id FROM credit_analyses GROUP BY client_id
       ) latest ON latest.client_id = ca1.client_id AND latest.max_id = ca1.id
     ) ca ON ca.client_id = c.id
     LEFT JOIN (
       SELECT cr.client_id, cr.id AS case_id, cr.case_number
       FROM credit_repair_cases cr
       INNER JOIN (
         SELECT client_id, MAX(id) AS max_id
         FROM credit_repair_cases
         WHERE status = 'active' AND pipeline_stage = 'prospect'
         GROUP BY client_id
       ) latest_pc ON latest_pc.client_id = cr.client_id AND latest_pc.max_id = cr.id
     ) pc ON pc.client_id = c.id
     WHERE ${where.join(" AND ")}
     ORDER BY c.created_at DESC`,
    args,
  );
  await attachLabelsToRows(rows);
  for (const r of rows) {
    (r as any).source_label =
      ((r as any).labels as Label[]).find((l) => l.layer === "source")?.slug ??
      null;
  }
  return rows;
}

// ============================================================================
// AFFILIATES v1 — scope, attribution, and commission helpers
// ============================================================================

/**
 * Resolve an affiliate id from a public code — accepts either the full
 * `slug` (up to 64 chars) or the legacy `referral_code` (max 32 chars,
 * historically `slug.slice(0, 32)`). Used for both link-click capture and
 * lead/registration attribution.
 *
 * v1 rule: resolve as long as the affiliate is not inactive/suspended —
 * invited-but-unpaid affiliates can still share links early.
 */
async function resolveAffiliateIdBySlugOrCode(
  code: string | null | undefined,
): Promise<number | null> {
  const raw = String(code || "").trim();
  if (!raw) return null;
  // referral_code is VARCHAR(32); only attempt that match when the raw
  // code fits, so longer slugs don't silently truncate into a wrong hit.
  const referralMatch = raw.length <= 32 ? `OR referral_code = ?` : "";
  const params: string[] = raw.length <= 32 ? [raw, raw] : [raw];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status FROM affiliates
     WHERE (slug = ? ${referralMatch})
       AND status NOT IN ('inactive','suspended')
     LIMIT 1`,
    params,
  );
  if (rows.length === 0) return null;
  if (!affiliateCanReceiveClicks({ status: rows[0].status as string }))
    return null;
  return rows[0].id as number;
}

interface AffiliateScope {
  affiliateId: number;
  plan: AffiliatePlan;
  parentId: number | null;
  status: string;
  subscriptionStatus: string;
  hasPortalAccess: boolean;
  /** Self + (if master) all direct sub-affiliate ids — used for `affiliate_id IN (...)` filters. */
  scopedAffiliateIds: number[];
}

/**
 * Determine the affiliate isolation scope for an authenticated admin.
 * Returns `null` when the caller is not an affiliate (full/unscoped access
 * for super_admin/admin/agent). Returns the scope otherwise, including
 * sub-affiliates' ids when the caller is a `master`.
 */
async function getAffiliateScope(
  adminId: number,
): Promise<AffiliateScope | null> {
  const [adminRows] = await pool.query<RowDataPacket[]>(
    `SELECT role FROM admins WHERE id = ? LIMIT 1`,
    [adminId],
  );
  if (adminRows.length === 0 || adminRows[0].role !== "affiliate") return null;

  const [affRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, plan, parent_affiliate_id, status, subscription_status
     FROM affiliates WHERE admin_id = ? LIMIT 1`,
    [adminId],
  );
  if (affRows.length === 0) {
    // Role says affiliate but no profile row — treat as fully locked out.
    return {
      affiliateId: 0,
      plan: "standard",
      parentId: null,
      status: "inactive",
      subscriptionStatus: "none",
      hasPortalAccess: false,
      scopedAffiliateIds: [],
    };
  }
  const aff = affRows[0];
  const affiliateId = aff.id as number;
  const scopedAffiliateIds = [affiliateId];
  if (aff.plan === "master") {
    const [children] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM affiliates WHERE parent_affiliate_id = ?`,
      [affiliateId],
    );
    scopedAffiliateIds.push(...children.map((c) => c.id as number));
  }
  return {
    affiliateId,
    plan: aff.plan as AffiliatePlan,
    parentId: (aff.parent_affiliate_id as number | null) ?? null,
    status: aff.status as string,
    subscriptionStatus: aff.subscription_status as string,
    hasPortalAccess: affiliateHasPortalAccess({
      status: aff.status as string,
      subscription_status: aff.subscription_status as string,
    }),
    scopedAffiliateIds,
  };
}

/** True when `clientId` belongs to the caller's affiliate scope (or scope is null = full access). */
async function assertClientInAffiliateScope(
  clientId: number,
  scope: AffiliateScope | null,
): Promise<boolean> {
  if (!scope) return true;
  if (scope.scopedAffiliateIds.length === 0) return false;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT affiliate_id FROM clients WHERE id = ? LIMIT 1`,
    [clientId],
  );
  if (rows.length === 0) return false;
  const affiliateId = rows[0].affiliate_id as number | null;
  return affiliateId != null && scope.scopedAffiliateIds.includes(affiliateId);
}

/**
 * Block affiliate-role callers from team-only admin surfaces
 * (payments, documents, messaging, settings tooling, etc.).
 */
async function denyAffiliateAccess(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const scope = await getAffiliateScope(req.auth!.id);
  if (scope) {
    return res.status(403).json({
      error: "This area is not available to affiliates",
    });
  }
  next();
}

/** Require portal access when the caller is an affiliate; no-op for staff. */
async function requirePortalIfAffiliate(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const scope = await getAffiliateScope(req.auth!.id);
  if (scope && !scope.hasPortalAccess) {
    return res.status(403).json({
      error: "Affiliate subscription required",
      code: "affiliate_subscription_required",
    });
  }
  next();
}

function serializeCommissionRow(row: RowDataPacket) {
  const first = (row.client_first_name as string) || "";
  const last = (row.client_last_name as string) || "";
  const clientName = `${first} ${last}`.trim() || null;
  return {
    ...row,
    client_name: clientName,
  };
}

/**
 * Record enrollment commission (+ parent override for sub-affiliates) for a
 * successful payment. No-ops if the client has no affiliate_id, or if a
 * commission row already exists for this payment_id (idempotent — safe to
 * call from multiple payment-success code paths, e.g. retries/duplicate
 * webhook calls). Because the guard is keyed on `payment_id` rather than
 * `client_id`, calling this once per successful split payment (registration
 * webhook, direct pay, or split-pay-by-link) correctly earns a commission on
 * each payment rather than only the client's first one.
 */
async function recordEnrollmentCommissions(
  clientId: number,
  paymentId: number,
  baseAmountCents: number,
): Promise<void> {
  if (!paymentId || baseAmountCents <= 0) return;
  const [clientRows] = await pool.query<RowDataPacket[]>(
    `SELECT affiliate_id FROM clients WHERE id = ? LIMIT 1`,
    [clientId],
  );
  const affiliateId = clientRows[0]?.affiliate_id as number | null | undefined;
  if (!affiliateId) return;

  const [existing] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM affiliate_commissions WHERE payment_id = ? LIMIT 1`,
    [paymentId],
  );
  if (existing.length > 0) return; // already recorded — avoid double-pay

  const [affRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, commission_rate_bps, parent_affiliate_id FROM affiliates WHERE id = ? LIMIT 1`,
    [affiliateId],
  );
  if (affRows.length === 0) return;
  const aff = affRows[0];

  const enrollmentCents = computeCommissionCents(
    baseAmountCents,
    Number(aff.commission_rate_bps),
  );
  if (enrollmentCents > 0) {
    try {
      await pool.query<ResultSetHeader>(
        `INSERT INTO affiliate_commissions
           (affiliate_id, client_id, payment_id, kind, amount_cents, rate_bps, base_amount_cents, status)
         VALUES (?, ?, ?, 'enrollment', ?, ?, ?, 'pending')`,
        [
          affiliateId,
          clientId,
          paymentId,
          enrollmentCents,
          Number(aff.commission_rate_bps),
          baseAmountCents,
        ],
      );
    } catch (err) {
      // uq_aff_comm_payment_kind_aff backstop — a duplicate here means a
      // concurrent call already recorded this commission; treat as no-op
      // rather than double-paying or failing the payment flow.
      if (!isDuplicateKeyError(err)) throw err;
    }
  }

  const parentAffiliateId = aff.parent_affiliate_id as number | null;
  if (parentAffiliateId) {
    const [parentRows] = await pool.query<RowDataPacket[]>(
      `SELECT parent_override_rate_bps FROM affiliates WHERE id = ? LIMIT 1`,
      [parentAffiliateId],
    );
    if (parentRows.length > 0) {
      const overrideCents = computeCommissionCents(
        baseAmountCents,
        Number(parentRows[0].parent_override_rate_bps),
      );
      if (overrideCents > 0) {
        try {
          await pool.query<ResultSetHeader>(
            `INSERT INTO affiliate_commissions
               (affiliate_id, client_id, payment_id, source_affiliate_id, kind, amount_cents, rate_bps, base_amount_cents, status)
             VALUES (?, ?, ?, ?, 'override', ?, ?, ?, 'pending')`,
            [
              parentAffiliateId,
              clientId,
              paymentId,
              affiliateId,
              overrideCents,
              Number(parentRows[0].parent_override_rate_bps),
              baseAmountCents,
            ],
          );
        } catch (err) {
          if (!isDuplicateKeyError(err)) throw err;
        }
      }
    }
  }
}

/** Generate a unique affiliate slug, appending -2, -3, ... on collision.
 * Also avoids referral_code (first 32 chars) collisions. */
async function generateUniqueAffiliateSlug(base: string): Promise<string> {
  const normalized = normalizeAffiliateSlug(base) || "affiliate";
  let candidate = normalized;
  for (let attempt = 1; attempt <= 50; attempt++) {
    const referralCode = candidate.slice(0, 32);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM affiliates WHERE slug = ? OR referral_code = ? LIMIT 1`,
      [candidate, referralCode],
    );
    if (rows.length === 0) return candidate;
    const suffix = `-${attempt + 1}`;
    candidate = `${normalized.slice(0, 64 - suffix.length)}${suffix}`;
  }
  return `${normalized.slice(0, 48)}-${Date.now()}`;
}

/** Public-facing affiliate summary shape shared by list/detail admin endpoints. */
function serializeAffiliateRow(row: RowDataPacket) {
  return {
    ...row,
    has_portal_access: affiliateHasPortalAccess({
      status: row.status as string,
      subscription_status: row.subscription_status as string,
    }),
  };
}

function affiliateInviteJoinUrl(pathKey: string): string {
  return `${APP_URL}/affiliate/join/${encodeURIComponent(pathKey)}`;
}

function serializeAffiliateInviteLink(row: RowDataPacket) {
  const token = String(row.token);
  const slug =
    row.slug != null && String(row.slug).trim() ? String(row.slug) : null;
  return {
    id: Number(row.id),
    token,
    slug,
    kind: row.kind as "evergreen" | "one_time",
    label: row.label != null ? String(row.label) : null,
    plan: row.plan as AffiliatePlan,
    parent_affiliate_id: row.parent_affiliate_id
      ? Number(row.parent_affiliate_id)
      : null,
    parent_name: row.parent_name != null ? String(row.parent_name) : null,
    is_enabled: !!row.is_enabled,
    max_uses: row.max_uses != null ? Number(row.max_uses) : null,
    use_count: Number(row.use_count || 0),
    expires_at: row.expires_at
      ? new Date(row.expires_at as string).toISOString()
      : null,
    created_by_admin_id: Number(row.created_by_admin_id),
    last_used_at: row.last_used_at
      ? new Date(row.last_used_at as string).toISOString()
      : null,
    created_at: new Date(row.created_at as string).toISOString(),
    join_url: affiliateInviteJoinUrl(slug || token),
  };
}

function affiliateInviteLinkIsOpen(row: RowDataPacket): boolean {
  if (!row.is_enabled) return false;
  if (row.expires_at) {
    const expMs = new Date(row.expires_at as string).getTime();
    if (!Number.isNaN(expMs) && expMs < Date.now()) return false;
  }
  if (row.max_uses != null && Number(row.use_count || 0) >= Number(row.max_uses)) {
    return false;
  }
  return true;
}

function newAffiliateInviteToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** Unique invite path slug; avoids other invite slugs and tokens. */
async function generateUniqueInviteSlug(
  base: string,
  excludeId?: number,
): Promise<string> {
  const normalized = normalizeAffiliateSlug(base) || "invite";
  let candidate = normalized;
  for (let attempt = 1; attempt <= 50; attempt++) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM affiliate_invite_links
       WHERE (slug = ? OR token = ?)
         ${excludeId ? "AND id <> ?" : ""}
       LIMIT 1`,
      excludeId ? [candidate, candidate, excludeId] : [candidate, candidate],
    );
    if (rows.length === 0) return candidate;
    const suffix = `-${attempt + 1}`;
    candidate = `${normalized.slice(0, 64 - suffix.length)}${suffix}`;
  }
  return `${normalized.slice(0, 48)}-${Date.now()}`;
}

async function findAffiliateInviteByPathKey(
  pathKey: string,
): Promise<RowDataPacket | null> {
  const key = String(pathKey || "").trim();
  if (!key) return null;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT i.*,
            CONCAT(p.first_name, ' ', p.last_name) AS parent_name
     FROM affiliate_invite_links i
     LEFT JOIN affiliates p ON p.id = i.parent_affiliate_id
     WHERE i.token = ? OR i.slug = ?
     ORDER BY CASE WHEN i.token = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    [key, key, key],
  );
  return rows[0] || null;
}

async function markPaymentSucceeded(clientId: number, transactionId: string) {
  const [paymentRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, amount_cents, status FROM payments WHERE provider_transaction_id = ? LIMIT 1`,
    [transactionId],
  );
  const wasAlreadySucceeded =
    paymentRows.length > 0 && paymentRows[0].status === "succeeded";

  await pool.query<ResultSetHeader>(
    `UPDATE payments SET status='succeeded', paid_at=NOW() WHERE provider_transaction_id = ? AND status <> 'succeeded'`,
    [transactionId],
  );

  // Affiliate enrollment commission — first successful payment only, guarded
  // by payment_id inside recordEnrollmentCommissions to avoid double-paying
  // on retries/duplicate webhook calls. Awaited so a transient DB error is
  // logged against a real attempt rather than silently dropped by .catch.
  if (paymentRows.length > 0 && !wasAlreadySucceeded) {
    try {
      await recordEnrollmentCommissions(
        clientId,
        paymentRows[0].id as number,
        Number(paymentRows[0].amount_cents),
      );
    } catch (e: any) {
      console.error("[affiliates:record-commission]", e?.message ?? e);
    }
  }

  // A client that paid while still `status='prospect'` (e.g. converted directly
  // from a credit-analysis lead) may also still carry `pipeline_stage='prospect'`
  // — bump it to `new_client` so the case created below doesn't inherit `prospect`.
  await pool.query<ResultSetHeader>(
    `UPDATE clients
     SET status='onboarding',
         pipeline_stage = IF(pipeline_stage = 'prospect', 'new_client', pipeline_stage)
     WHERE id = ? AND status IN ('pending_payment','prospect')`,
    [clientId],
  );

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.first_name, c.last_name, c.email, c.phone, p.name AS package_name, p.price_cents
     FROM clients c LEFT JOIN packages p ON p.id = c.package_id
     WHERE c.id = ? LIMIT 1`,
    [clientId],
  );
  if (rows.length === 0) return;
  const r = rows[0];

  // All Day 0/1/2/3 communication (email) is handled by the
  // "payment_confirmed" reminder flow. SMS can be added as a flow step type
  // once Twilio is configured — do not hardcode sequences here.

  await pool.query<ResultSetHeader>(
    `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id) VALUES ('system', NULL, 'payment.succeeded', 'client', ?)`,
    [clientId],
  );

  // Create a credit_repair_cases row if no active case exists for this client.
  // If a prospect-stage case already exists (New Case → Prospect), promote it
  // so the case does not stay invisible on the pipeline board.
  const [existingCases] = await pool.query<RowDataPacket[]>(
    `SELECT id, pipeline_stage FROM credit_repair_cases
     WHERE client_id = ? AND status = 'active'
     ORDER BY id DESC`,
    [clientId],
  );
  if (existingCases.length === 0) {
    const [pkgRow] = await pool.query<RowDataPacket[]>(
      `SELECT package_id, pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
      [clientId],
    );
    const [caseInsert] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_repair_cases (case_number, client_id, package_id, pipeline_stage, status)
       VALUES (NULL, ?, ?, COALESCE(?, 'new_client'), 'active')`,
      [
        clientId,
        pkgRow[0]?.package_id ?? null,
        pkgRow[0]?.pipeline_stage ?? "new_client",
      ],
    );
    const newCaseId = caseInsert.insertId;
    await pool.query<ResultSetHeader>(
      `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
      [`CR-${String(newCaseId).padStart(5, "0")}`, newCaseId],
    );
    autoAssignTasksForCase(clientId, newCaseId).catch((e) =>
      console.error("[tasks:auto-assign]", e?.message),
    );
  } else {
    const prospectCaseIds = existingCases
      .filter((c) => c.pipeline_stage === "prospect")
      .map((c) => Number(c.id));
    if (prospectCaseIds.length > 0) {
      const primaryId = prospectCaseIds[0];
      await pool.query<ResultSetHeader>(
        `UPDATE credit_repair_cases
         SET pipeline_stage = 'new_client',
             pipeline_stage_changed_at = NOW()
         WHERE id = ?`,
        [primaryId],
      );
      if (prospectCaseIds.length > 1) {
        await pool.query<ResultSetHeader>(
          `UPDATE credit_repair_cases
           SET status = 'cancelled',
               pipeline_stage_changed_at = NOW()
           WHERE client_id = ? AND status = 'active'
             AND pipeline_stage = 'prospect' AND id <> ?`,
          [clientId, primaryId],
        );
      }
      autoAssignTasksForCase(clientId, primaryId).catch((e) =>
        console.error("[tasks:auto-assign]", e?.message),
      );
    } else {
      autoAssignTasksForClient(clientId).catch((e) =>
        console.error("[tasks:auto-assign]", e?.message),
      );
    }
  }

  triggerReminderFlow("payment_confirmed", clientId).catch((e) =>
    console.error("[flow:payment_confirmed]", e?.message),
  );

  // Email every active team admin (Lecca + staff) — not just language owner.
  if (!wasAlreadySucceeded) {
    try {
      const caseId =
        (await resolvePrimaryActiveCaseId(pool, clientId)) ??
        existingCases.find((c) => c.pipeline_stage !== "prospect")?.id ??
        existingCases[0]?.id ??
        null;
      await notifyAdminsNewPurchase({
        clientId,
        clientName:
          `${r.first_name || ""} ${r.last_name || ""}`.trim() ||
          String(r.email),
        clientEmail: String(r.email),
        packageName: (r.package_name as string) || null,
        amountCents:
          paymentRows[0]?.amount_cents != null
            ? Number(paymentRows[0].amount_cents)
            : null,
        caseId,
        kind: "enrollment",
      });
    } catch (e: any) {
      console.error("[notify:admins-purchase]", e?.message ?? e);
    }
  }

  // Push new client to Credit Repair Cloud (async — don't block payment confirmation)
  crcSyncClient(clientId).catch((e) =>
    console.error("[crc:new-client-sync]", e?.message),
  );
}

// ============================================================================
// AUTHORIZE.NET — process card payment via Accept.js nonce
// ============================================================================
async function processAuthorizeNetPayment(
  clientId: number,
  email: string,
  amountCents: number,
  packageId: number | null,
  dataDescriptor: string,
  dataValue: string,
  firstName: string,
  lastName: string,
  metadata: Record<string, unknown> = {},
): Promise<{ transactionId: string; paymentId: number }> {
  // Insert a provisional payments row BEFORE charging so a successful ANet
  // charge that crashes before the DB write still has a ledger trace — the
  // same pattern used by POST /api/pay/:token. On decline/error we mark the
  // row failed; on success we swap in the real provider_transaction_id.
  const provisionalTxnId = `pending-${crypto.randomUUID()}`;
  const [payIns] = await pool.query<ResultSetHeader>(
    `INSERT INTO payments (client_id, package_id, amount_cents, status, provider, provider_transaction_id, metadata_json)
     VALUES (?, ?, ?, 'pending', 'authorize_net', ?, ?)`,
    [
      clientId,
      packageId,
      amountCents,
      provisionalTxnId,
      JSON.stringify(metadata),
    ],
  );
  const paymentId = payIns.insertId;

  let result: {
    transactionId: string;
    customerProfileId?: string;
    customerPaymentProfileId?: string;
  };
  try {
    result = await chargeCard({
      amountDollars: (amountCents / 100).toFixed(2),
      dataDescriptor,
      dataValue,
      clientId,
      email,
      firstName,
      lastName,
    });
  } catch (err: any) {
    await pool.query<ResultSetHeader>(
      `UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?`,
      [
        String(err?.message || "Payment processing failed").slice(0, 500),
        paymentId,
      ],
    );
    throw err;
  }

  await pool.query<ResultSetHeader>(
    `UPDATE payments SET provider_transaction_id = ? WHERE id = ?`,
    [result.transactionId, paymentId],
  );

  // Store Authorize.net customer/payment profile IDs so future charges can
  // reference the same customer and they appear in Authorize.net Manage Customers.
  if (result.customerProfileId) {
    await pool.query<ResultSetHeader>(
      `UPDATE clients SET anet_customer_profile_id = ?, anet_payment_profile_id = ? WHERE id = ?`,
      [
        result.customerProfileId,
        result.customerPaymentProfileId ?? null,
        clientId,
      ],
    );
  }

  await markPaymentSucceeded(clientId, result.transactionId);
  return { transactionId: result.transactionId, paymentId };
}

async function triggerReminderFlow(
  triggerEvent: string,
  clientId: number,
  extraVars?: Record<string, string>,
  opts?: {
    deliverToEmail?: string;
    skipIdempotency?: boolean;
    /** Skip delay_days=0 email/alert steps (e.g. convert already sent a welcome). */
    skipImmediateSteps?: boolean;
  },
): Promise<void> {
  const [flows] = await pool.query<RowDataPacket[]>(
    `SELECT id, required_label_slugs_json FROM reminder_flows WHERE trigger_event = ? AND is_active = 1 LIMIT 1`,
    [triggerEvent],
  );
  if (flows.length === 0) return;
  const flowId = flows[0].id as number;

  // Optional label gate: if the flow specifies required_label_slugs, only run
  // it when the client currently holds ALL of those label slugs.
  // Sandbox "email myself" still uses the selected client for merge fields /
  // label gates so the preview matches a real send.
  const requiredSlugs =
    parseWizardJsonField<string[]>(flows[0].required_label_slugs_json) ?? [];
  if (requiredSlugs.length > 0) {
    const [labelRows] = await pool.query<RowDataPacket[]>(
      `SELECT l.slug FROM client_labels cl
       JOIN labels l ON l.id = cl.label_id
       WHERE cl.client_id = ?`,
      [clientId],
    );
    const clientSlugs = labelRows.map((r) => r.slug as string);
    const missing = missingRequiredLabelSlugs(clientSlugs, requiredSlugs);
    if (missing.length > 0) {
      console.log(
        `[flow:${triggerEvent}] Skipping client ${clientId} — missing required label(s): ${missing.join(", ")}`,
      );
      return;
    }
  }

  // Idempotency guard: skip if this flow already ran for this client within the last 10 minutes
  // (prevents duplicates from double webhooks / retries). Sandbox re-tests may skip it.
  if (!opts?.skipIdempotency) {
    const [recent] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM reminder_flow_executions
     WHERE flow_id = ? AND client_id = ? AND triggered_at >= NOW() - INTERVAL 10 MINUTE
     LIMIT 1`,
      [flowId, clientId],
    );
    if (recent.length > 0) {
      console.warn(
        `[flow:${triggerEvent}] Skipping duplicate trigger for client ${clientId} (already ran within 10 min)`,
      );
      return;
    }
  }

  const [steps] = await pool.query<RowDataPacket[]>(
    `SELECT id, step_type, delay_days, label, subject, body, template_slug
     FROM reminder_flow_steps WHERE flow_id = ? ORDER BY step_order ASC`,
    [flowId],
  );
  if (steps.length === 0) return;

  const [clientRows] = await pool.query<RowDataPacket[]>(
    `SELECT first_name, last_name, email, phone, preferred_language FROM clients WHERE id = ? LIMIT 1`,
    [clientId],
  );
  if (clientRows.length === 0) return;
  const client = clientRows[0];
  const lang = (client.preferred_language as string | null) || "en";
  const deliverTo =
    (opts?.deliverToEmail || "").trim() || (client.email as string);
  const isSandboxDelivery = !!(
    opts?.deliverToEmail &&
    opts.deliverToEmail.trim().toLowerCase() !==
      String(client.email || "").toLowerCase()
  );

  const vars: Record<string, string> = {
    first_name: client.first_name as string,
    last_name: client.last_name as string,
    portal_url: `${APP_URL}/portal/login`, // fallback; overridden per email step below
    ...extraVars,
  };

  let stepsExecuted = 0;
  let stepsScheduled = 0;
  let execError: string | null = null;

  const replaceVars = (tmpl: string) =>
    tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

  try {
    for (const step of steps) {
      const delayMs = (step.delay_days as number) * 24 * 60 * 60 * 1000;
      const scheduledFor = new Date(Date.now() + delayMs);
      const isImmediate = (step.delay_days as number) === 0;

      if (opts?.skipImmediateSteps && isImmediate) {
        continue;
      }

      if (step.step_type === "send_email") {
        if (!deliverTo || !String(deliverTo).trim()) {
          console.warn(
            `[flow:${triggerEvent}] Skipping email step "${step.label || step.id}" — client ${clientId} has no email`,
          );
          continue;
        }
        let subj = step.subject as string | null;
        let bodyHtml = step.body as string | null;

        if (step.template_slug) {
          // Prefer language-specific template (e.g. flow_new_client_day1_es) when available
          const preferredSlug =
            lang !== "en"
              ? `${step.template_slug}_${lang}`
              : step.template_slug;
          const slugsToTry =
            preferredSlug !== step.template_slug
              ? [preferredSlug, step.template_slug]
              : [step.template_slug];
          for (const slug of slugsToTry) {
            const [tmplRows] = await pool.query<RowDataPacket[]>(
              `SELECT subject, body FROM communication_templates WHERE slug = ? AND is_active = 1 LIMIT 1`,
              [slug],
            );
            if (tmplRows.length > 0) {
              subj = tmplRows[0].subject as string | null;
              bodyHtml = tmplRows[0].body as string | null;
              break;
            }
          }
        }

        if (!subj || !bodyHtml) continue;

        // Generate a unique magic-link token for this step.
        // TTL = delay_days * 24h (time until delivery) + 72h buffer for the client to click it.
        const delayDays = step.delay_days as number;
        const tokenTtlHours = delayDays * 24 + ONBOARDING_TOKEN_TTL_HOURS;
        const rawToken = await createOnboardingToken(clientId, tokenTtlHours);
        const magicLink = `${APP_URL}/portal/onboarding/${rawToken}`;

        // Build step-specific vars with the magic link overriding the generic portal_url
        const stepVars = { ...vars, portal_url: magicLink };
        const stepReplaceVars = (tmpl: string) =>
          tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => stepVars[k] ?? `{{${k}}}`);

        let resolvedSubj = stepReplaceVars(subj);
        if (isSandboxDelivery && !resolvedSubj.startsWith("[TEST]")) {
          resolvedSubj = `[TEST] ${resolvedSubj}`;
        }
        const resolvedBody = stepReplaceVars(bodyHtml);
        const btnLabel = lang === "es" ? "Ir a mi portal" : "Go to My Portal";
        const fullHtml = emailLayout({
          title: resolvedSubj,
          bodyHtml: resolvedBody + emailButton(magicLink, btnLabel),
          lang,
        });

        if (isImmediate) {
          try {
            await Promise.race([
              sendEmail({
                to: deliverTo,
                subject: resolvedSubj,
                html: fullHtml,
              }),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error("SMTP timeout after 8s")),
                  8_000,
                ),
              ),
            ]);
            stepsExecuted++;
          } catch (e: any) {
            console.error("[flow:send_email]", e?.message);
            // Fall back to queue so the cron worker can retry without
            // blocking stage/convert handlers on a hung SMTP socket.
            await pool.query<ResultSetHeader>(
              `INSERT INTO notification_queue (client_id, channel, to_address, subject, body, scheduled_for) VALUES (?, 'email', ?, ?, ?, NOW())`,
              [clientId, deliverTo, resolvedSubj, fullHtml],
            );
            stepsScheduled++;
          }
        } else {
          await pool.query<ResultSetHeader>(
            `INSERT INTO notification_queue (client_id, channel, to_address, subject, body, scheduled_for) VALUES (?, 'email', ?, ?, ?, ?)`,
            [clientId, deliverTo, resolvedSubj, fullHtml, scheduledFor],
          );
          stepsScheduled++;
        }
      } else if (step.step_type === "internal_alert") {
        const alertBody = replaceVars(
          (step.body as string | null) ||
            `Client {{first_name}} {{last_name}} requires follow-up (flow: ${triggerEvent}).`,
        );
        await pool.query<ResultSetHeader>(
          `INSERT INTO notification_queue (client_id, channel, to_address, subject, body, scheduled_for) VALUES (?, 'in_app', 'team', ?, ?, ?)`,
          [clientId, step.label || "Team Alert", alertBody, scheduledFor],
        );
        stepsScheduled++;
      }
    }
  } catch (e: any) {
    execError = e?.message ?? String(e);
  }

  await pool.query<ResultSetHeader>(
    `INSERT INTO reminder_flow_executions (flow_id, client_id, status, steps_executed, steps_scheduled, error_message) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      flowId,
      clientId,
      execError ? "partial" : "completed",
      stepsExecuted,
      stepsScheduled,
      execError,
    ],
  );
}

// ============================================================================
// CREDIT REPAIR CLOUD (CRC) SERVICE
// ============================================================================

const CRC_BASE_URL = "https://app.creditrepaircloud.com/api";
const crcConfigured = !!(
  process.env.CRC_API_AUTH_KEY && process.env.CRC_SECRET_KEY
);
const crcDryRun =
  process.env.CRC_DRY_RUN === "true" || process.env.NODE_ENV === "test";

if (crcConfigured && !crcDryRun) {
  console.log("✅ Credit Repair Cloud API configured (live mode)");
} else if (crcConfigured && crcDryRun) {
  console.log(
    "✅ Credit Repair Cloud API configured (DRY-RUN — no real calls)",
  );
} else {
  console.warn(
    "⚠️  CRC_API_AUTH_KEY / CRC_SECRET_KEY not set — CRC sync will be skipped",
  );
}

/** Build the XML payload for a CRC lead/client record. */
function buildCrcClientXml(opts: {
  type: string;
  firstname: string;
  lastname: string;
  email?: string | null;
  phone_home?: string | null;
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  ssno?: string | null;
  birth_date?: string | null;
  memo?: string | null;
  id?: string | null; // required for updateRecord
}): string {
  const tag = (name: string, value: string | null | undefined) =>
    value != null && value !== "" ? `    <${name}>${value}</${name}>` : "";

  const fields = [
    opts.id != null ? `    <id>${opts.id}</id>` : "",
    `    <type>${opts.type}</type>`,
    `    <firstname>${opts.firstname}</firstname>`,
    `    <lastname>${opts.lastname}</lastname>`,
    tag("email", opts.email),
    tag("phone_home", opts.phone_home),
    tag("street_address", opts.street_address),
    tag("city", opts.city),
    tag("state", opts.state),
    tag("zip", opts.zip),
    tag("ssno", opts.ssno),
    tag("birth_date", opts.birth_date),
    tag("memo", opts.memo),
  ]
    .filter(Boolean)
    .join("\n");

  return `<crcloud>\n  <lead>\n${fields}\n  </lead>\n</crcloud>`;
}

/** Map our pipeline_stage to a CRC client status. */
function mapStageToCrcType(stage: string): string {
  if (stage === "new_client") return "Client";
  if (stage === "completed") return "Client";
  if (stage === "cancelled") return "Inactive";
  return "Client"; // active rounds remain Client status
}

/** POST to CRC API with XML data. Returns parsed JSON response body. */
async function crcPost(
  path: string,
  xmlData: string,
): Promise<{ success: boolean; crcId?: string; raw?: any; dryRun?: boolean }> {
  if (!crcConfigured || crcDryRun) {
    const mode = !crcConfigured ? "no-keys" : "dry-run";
    // Never log full CRC XML — it can include SSN, DOB, email.
    const redacted = xmlData
      .replace(/<(ssn|socialsecuritynumber)>[^<]*<\/\1>/gi, "<$1>***</$1>")
      .replace(/<(dob|dateofbirth)>[^<]*<\/\1>/gi, "<$1>***</$1>")
      .replace(/<(email|emailaddress)>[^<]*<\/\1>/gi, "<$1>***</$1>")
      .replace(/<(phone|cellphone|homephone)>[^<]*<\/\1>/gi, "<$1>***</$1>");
    console.log(`[crc:${mode}]`, path, "\n" + redacted);
    // Return a fake CRC ID so local testing exercises the full code path
    return { success: true, crcId: undefined, dryRun: true };
  }

  const url = `${CRC_BASE_URL}${path}?apiauthkey=${encodeURIComponent(process.env.CRC_API_AUTH_KEY!)}&secretkey=${encodeURIComponent(process.env.CRC_SECRET_KEY!)}`;

  const body = new URLSearchParams();
  body.set("xmlData", xmlData);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await resp.text();
  let raw: any;

  // CRC returns XML: <success>True</success><result><id>MzA5</id></result>
  if (text.trimStart().startsWith("<")) {
    const successMatch = text.match(/<success>(True|1)<\/success>/i);
    const idMatch = text.match(/<id>([^<]+)<\/id>/);
    raw = { raw: text };
    if (resp.ok && successMatch) {
      const crcId = idMatch?.[1]?.trim() || undefined;
      return { success: true, crcId, raw };
    }
    console.error("[crc:error]", path, text);
    return { success: false, raw };
  }

  // Fallback: JSON response
  try {
    raw = JSON.parse(text);
  } catch {
    raw = { raw: text };
  }

  // CRC returns {"status":"success","id":"<base64-id>"} on success
  if (resp.ok && (raw?.status === "success" || raw?.status === "1")) {
    return { success: true, crcId: raw?.id as string | undefined, raw };
  }
  console.error("[crc:error]", path, raw);
  return { success: false, raw };
}

/**
 * Push a local client record to CRC (create or update).
 * Logs the result in crc_sync_log and updates clients.crc_client_id.
 */
async function crcSyncClient(clientId: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
            c.address_line1, c.city, c.state, c.zip,
            c.ssn_last4, c.date_of_birth, c.pipeline_stage,
            c.crc_client_id
     FROM clients c WHERE c.id = ? LIMIT 1`,
    [clientId],
  );
  if (rows.length === 0) return;
  const c = rows[0];

  const isUpdate = !!c.crc_client_id;
  if (isUpdate && process.env.CRC_SYNC_STAGES === "false") {
    return;
  }
  const crcType = mapStageToCrcType(c.pipeline_stage as string);

  const xmlData = buildCrcClientXml({
    id: isUpdate ? (c.crc_client_id as string) : null,
    type: crcType,
    firstname: c.first_name as string,
    lastname: c.last_name as string,
    email: (c.email as string) || null,
    phone_home: c.phone as string | null,
    street_address: c.address_line1 as string | null,
    city: c.city as string | null,
    state: c.state as string | null,
    zip: c.zip as string | null,
    ssno: c.ssn_last4 as string | null,
    birth_date: c.date_of_birth
      ? new Date(c.date_of_birth as string).toLocaleDateString("en-US")
      : null,
  });

  const action = isUpdate ? "push_update" : "push_create";
  const endpoint = isUpdate ? "/lead/updateRecord" : "/lead/insertRecord";
  const result = await crcPost(endpoint, xmlData);

  if (result.success && !isUpdate && result.crcId) {
    await pool.query<ResultSetHeader>(
      `UPDATE clients SET crc_client_id = ?, crc_synced_at = NOW() WHERE id = ?`,
      [result.crcId, clientId],
    );
  } else if (result.success && isUpdate) {
    await pool.query<ResultSetHeader>(
      `UPDATE clients SET crc_synced_at = NOW() WHERE id = ?`,
      [clientId],
    );
  }

  await pool.query<ResultSetHeader>(
    `INSERT INTO crc_sync_log (client_id, action, crc_client_id, pipeline_stage, status, error_message, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      clientId,
      action,
      result.crcId || (c.crc_client_id as string) || null,
      c.pipeline_stage,
      result.success ? "success" : "error",
      result.success ? null : JSON.stringify(result.raw),
      JSON.stringify({ xmlData, response: result.raw }),
    ],
  );
}

/** Map Zapier/CRC webhook stage name → our pipeline_stage enum value. */
const CRC_STAGE_MAP: Record<string, string> = {
  "new client": "new_client",
  "docs ready": "docs_ready",
  "round 1": "round_1",
  "round 1 (month 1)": "round_1",
  "round 1 out": "round_1",
  "round 1 out!": "round_1",
  "round 1 in": "round_1",
  "round 1 in!": "round_1",
  "round 2": "round_2",
  "round 2 (month 2)": "round_2",
  "round 2 out": "round_2",
  "round 2 out!": "round_2",
  "round 2 in": "round_2",
  "round 2 in!": "round_2",
  "round 3": "round_3",
  "round 3 (month 3)": "round_3",
  "round 3 out": "round_3",
  "round 3 out!": "round_3",
  "round 3 in": "round_3",
  "round 3 in!": "round_3",
  "round 4": "round_4",
  "round 4 (month 4)": "round_4",
  "round 4 out": "round_4",
  "round 4 out!": "round_4",
  "round 4 in": "round_4",
  "round 4 in!": "round_4",
  "round 5": "round_5",
  "round 5 (month 5)": "round_5",
  "round 5 out": "round_5",
  "round 5 out!": "round_5",
  "round 5 in": "round_5",
  "round 5 in!": "round_5",
  completed: "completed",
  graduated: "completed",
  "deleted client": "completed",
};

// ============================================================================
// EXPRESS APP
// ============================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

/**
 * Build the browser CORS allowlist.
 * - Always includes PUBLIC_APP_URL + local Vite/dev hosts
 * - Includes Vercel preview/deployment URL when present
 * - Includes comma-separated CORS_ALLOWED_ORIGINS (extra custom domains)
 * - Includes known Optimum production hostnames (ofgllc.com) so a mis-set
 *   PUBLIC_APP_URL (e.g. still pointing at *.vercel.app) does not lock admins out
 *
 * `undefined` origin (server-to-server, curl, same-origin proxy) is always
 * allowed by the cors middleware callback — CORS only governs browser XHR.
 */
function buildCorsAllowedOrigins(opts?: {
  appUrl?: string;
  extraCsv?: string;
  vercelUrl?: string;
}): string[] {
  const normalize = (raw: string) => raw.trim().replace(/\/+$/, "");
  const fromCsv = String(
    opts?.extraCsv ?? process.env.CORS_ALLOWED_ORIGINS ?? "",
  )
    .split(",")
    .map(normalize)
    .filter(Boolean);
  const vercelHost = String(
    opts?.vercelUrl ?? process.env.VERCEL_URL ?? "",
  ).trim();
  const vercelOrigin = vercelHost
    ? normalize(
        vercelHost.startsWith("http") ? vercelHost : `https://${vercelHost}`,
      )
    : "";
  return Array.from(
    new Set(
      [
        normalize(opts?.appUrl ?? APP_URL),
        vercelOrigin,
        ...fromCsv,
        // Production custom domains (Optimum Financial Group)
        "https://www.ofgllc.com",
        "https://ofgllc.com",
        "http://localhost:8080",
        "https://localhost:8080",
        "http://localhost:5173",
        "https://localhost:5173",
      ].filter(Boolean),
    ),
  );
}

const CORS_ALLOWED_ORIGINS = buildCorsAllowedOrigins();

function buildApp() {
  const app = express();
  // Vercel (and most reverse proxies) set X-Forwarded-For. Required for
  // express-rate-limit / req.ip — otherwise ValidationError on every request.
  app.set("trust proxy", 1);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || CORS_ALLOWED_ORIGINS.includes(origin)) {
          return callback(null, true);
        }
        // Deny without throwing — throwing becomes a 500 "unexpected error"
        // in our Express error handler (what admins saw on request-otp).
        console.warn(`[cors] blocked origin: ${origin}`);
        return callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf?.toString();
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));

  // Global API rate limit (defense-in-depth). Auth/pay/OTP also have tighter
  // per-route hitRateLimit buckets. Health checks stay unlimited.
  const apiRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path === "/api/health" ||
      req.path === "/api/ping" ||
      req.path.startsWith("/api/cron/"),
    message: { error: "Too many requests. Please try again shortly." },
  });
  app.use("/api/", apiRateLimit);

  // ── Request logger ──────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      const status = res.statusCode;
      const color =
        status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : "\x1b[32m";
      console.log(
        `${color}${req.method}\x1b[0m ${req.path} → ${color}${status}\x1b[0m (${ms}ms)`,
      );
    });
    next();
  });

  // ============================================================
  // HEALTH
  // ============================================================
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
  app.get("/api/ping", (_req, res) => {
    res.json({ message: "pong" });
  });

  // ============================================================
  // SMOKE-TEST HELPERS (only active when SMOKE_TEST_SECRET is set AND
  // never in production — these routes mint real session tokens and
  // delete data, so they must be impossible to reach on a live deploy
  // even if the secret leaked or was left set by accident.)
  // ============================================================
  const SMOKE_SECRET = process.env.SMOKE_TEST_SECRET;
  if (SMOKE_SECRET && !IS_PROD) {
    // POST /api/smoke/token — returns a real session token for admin or client
    app.post("/api/smoke/token", async (req, res) => {
      const { secret, actor, email } = req.body || {};
      if (!timingSafeStringEqual(String(secret || ""), SMOKE_SECRET))
        return res.status(401).json({ error: "Unauthorized" });
      if (!["admin", "client"].includes(String(actor)) || !email)
        return res
          .status(400)
          .json({ error: "actor (admin|client) and email required" });
      const table = actor === "admin" ? "admins" : "clients";
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, email FROM \`${table}\` WHERE email = ? LIMIT 1`,
        [String(email).trim().toLowerCase()],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: `${actor} not found: ${email}` });
      const token = await createSession(
        actor as "admin" | "client",
        rows[0].id as number,
        rows[0].email as string,
        "127.0.0.1",
        "smoke-test",
      );
      res.json({ token, id: rows[0].id, email: rows[0].email });
    });

    // DELETE /api/smoke/cleanup — removes test data created during smoke run
    app.delete("/api/smoke/cleanup", async (req, res) => {
      const { secret, ticket_id, faq_id, session_revoke_token } =
        req.body || {};
      if (!timingSafeStringEqual(String(secret || ""), SMOKE_SECRET))
        return res.status(401).json({ error: "Unauthorized" });
      if (faq_id)
        await pool.query("DELETE FROM support_faq WHERE id = ?", [
          Number(faq_id),
        ]);
      if (ticket_id) {
        await pool.query(
          "DELETE FROM support_ticket_replies WHERE ticket_id = ?",
          [Number(ticket_id)],
        );
        await pool.query("DELETE FROM support_tickets WHERE id = ?", [
          Number(ticket_id),
        ]);
      }
      if (session_revoke_token)
        await revokeSession(String(session_revoke_token));
      res.json({ ok: true });
    });
  }

  // ============================================================
  // AUTH (CLIENT + ADMIN)
  // ============================================================
  const OTP_REQUEST_LIMIT = 5; // per IP+email per window
  const OTP_REQUEST_WINDOW_MS = 15 * 60 * 1000;
  const OTP_VERIFY_LIMIT = 10; // per IP+email per window
  const OTP_VERIFY_WINDOW_MS = 15 * 60 * 1000;

  app.post("/api/auth/client/request-otp", async (req, res) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!email || !/.+@.+\..+/.test(email)) {
      return res.status(400).json({ error: "Valid email required" });
    }
    if (
      hitRateLimit(
        rateLimitKey(req, `otp-req:client:${email}`),
        OTP_REQUEST_LIMIT,
        OTP_REQUEST_WINDOW_MS,
      )
    ) {
      return res
        .status(429)
        .json({ error: "Too many requests. Please try again later." });
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, first_name, preferred_language FROM clients WHERE email = ? LIMIT 1",
      [email],
    );
    if (rows.length === 0) {
      console.warn(
        `[auth:client:request-otp] no client for ${email} — email not sent`,
      );
      return res.status(404).json({
        error: "No account found for that email.",
        code: "ACCOUNT_NOT_FOUND",
      });
    }
    const code = await createOtp(
      "client",
      rows[0].id as number,
      "login",
      req.ip,
    );
    const tpl = tplOtpLogin({
      firstName: rows[0].first_name,
      code,
      lang: rows[0].preferred_language || "en",
    });
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html });
    res.json({
      ok: true,
      message: "A sign-in code has been sent to that email.",
    });
  });

  app.post("/api/auth/client/verify-otp", async (req, res) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !code)
      return res.status(400).json({ error: "Missing fields" });
    if (
      hitRateLimit(
        rateLimitKey(req, `otp-verify:client:${email}`),
        OTP_VERIFY_LIMIT,
        OTP_VERIFY_WINDOW_MS,
      )
    ) {
      return res
        .status(429)
        .json({ error: "Too many attempts. Please try again later." });
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, email, first_name, last_name FROM clients WHERE email = ? LIMIT 1",
      [email],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const ok = await consumeOtp("client", rows[0].id as number, code, "login");
    if (!ok) return res.status(401).json({ error: "Invalid or expired code" });
    await pool.query<ResultSetHeader>(
      "UPDATE clients SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?",
      [rows[0].id],
    );
    const token = await createSession(
      "client",
      rows[0].id as number,
      rows[0].email,
      req.ip,
      String(req.headers["user-agent"] || ""),
    );
    res.json({
      token,
      user: {
        id: rows[0].id,
        email: rows[0].email,
        first_name: rows[0].first_name,
        last_name: rows[0].last_name,
      },
    });
  });

  app.post("/api/auth/admin/request-otp", async (req, res) => {
    try {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      if (!email) return res.status(400).json({ error: "Email required" });
      if (
        hitRateLimit(
          rateLimitKey(req, `otp-req:admin:${email}`),
          OTP_REQUEST_LIMIT,
          OTP_REQUEST_WINDOW_MS,
        )
      ) {
        return res
          .status(429)
          .json({ error: "Too many requests. Please try again later." });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id, first_name, status FROM admins WHERE email = ? LIMIT 1",
        [email],
      );
      if (rows.length === 0) {
        console.warn(
          `[auth:admin:request-otp] no admin for ${email} — email not sent`,
        );
        return res.status(404).json({
          error: "No staff account found for that email.",
          code: "ACCOUNT_NOT_FOUND",
        });
      }
      if (rows[0].status !== "active") {
        console.warn(
          `[auth:admin:request-otp] inactive admin ${email} (status=${rows[0].status}) — email not sent`,
        );
        return res.status(403).json({
          error: "This staff account is not active. Contact a super admin.",
          code: "ACCOUNT_INACTIVE",
        });
      }
      const code = await createOtp(
        "admin",
        rows[0].id as number,
        "login",
        req.ip,
      );
      const tpl = tplOtpLogin({
        firstName: rows[0].first_name,
        code,
        isAdmin: true,
      });
      await sendEmail({ to: email, subject: tpl.subject, html: tpl.html });
      res.json({
        ok: true,
        message: "A sign-in code has been sent to that email.",
      });
    } catch (err: any) {
      console.error("[/api/auth/admin/request-otp]", err?.message ?? err);
      res.status(503).json({
        error: "Service temporarily unavailable. Please try again shortly.",
      });
    }
  });

  app.post("/api/auth/admin/verify-otp", async (req, res) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !code)
      return res.status(400).json({ error: "Missing fields" });
    if (
      hitRateLimit(
        rateLimitKey(req, `otp-verify:admin:${email}`),
        OTP_VERIFY_LIMIT,
        OTP_VERIFY_WINDOW_MS,
      )
    ) {
      return res
        .status(429)
        .json({ error: "Too many attempts. Please try again later." });
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, email, first_name, last_name, role, avatar_url FROM admins WHERE email = ? AND status = 'active' LIMIT 1",
      [email],
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const ok = await consumeOtp("admin", rows[0].id as number, code, "login");
    if (!ok) return res.status(401).json({ error: "Invalid or expired code" });
    await pool.query<ResultSetHeader>(
      "UPDATE admins SET last_login_at = NOW() WHERE id = ?",
      [rows[0].id],
    );
    const token = await createSession(
      "admin",
      rows[0].id as number,
      rows[0].email,
      req.ip,
      String(req.headers["user-agent"] || ""),
    );
    res.json({
      token,
      user: {
        id: rows[0].id,
        email: rows[0].email,
        first_name: rows[0].first_name,
        last_name: rows[0].last_name,
        role: rows[0].role,
        avatar_url: rows[0].avatar_url,
      },
    });
  });

  app.get(
    "/api/auth/client/me",
    requireClient,
    async (req: AuthedRequest, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.address_line1, c.address_line2,
              c.city, c.state, c.zip, c.ssn_last4, c.preferred_language,
              c.pipeline_stage, c.pipeline_stage_changed_at,
              c.contract_signed_at, c.smart_credit_email, c.smart_credit_connected_at,
              c.status, c.email_verified_at, c.created_at,
              p.id AS package_id, p.slug AS package_slug, p.name AS package_name,
              p.price_cents AS package_price_cents, p.duration_months AS package_duration_months
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       WHERE c.id = ? LIMIT 1`,
        [req.auth!.id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Not found" });
      res.json({ user: rows[0] });
    },
  );

  app.get(
    "/api/auth/admin/me",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT id, email, first_name, last_name, role, preferred_language, avatar_url, last_login_at FROM admins WHERE id = ? LIMIT 1",
        [req.auth!.id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Not found" });
      const user = rows[0] as any;

      if (user.role === "affiliate") {
        const [affRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, plan, slug, referral_code, default_landing, status,
                  subscription_status, monthly_price_cents, commission_rate_bps,
                  parent_override_rate_bps, parent_affiliate_id, bio, avatar_url,
                  social_facebook, social_instagram, social_tiktok, social_linkedin
           FROM affiliates WHERE admin_id = ? LIMIT 1`,
          [req.auth!.id],
        );
        if (affRows.length > 0) {
          const aff = affRows[0];
          user.affiliate = aff;
          user.has_portal_access = affiliateHasPortalAccess({
            status: aff.status as string,
            subscription_status: aff.subscription_status as string,
          });
        } else {
          user.affiliate = null;
          user.has_portal_access = false;
        }
      }

      res.json({ user });
    },
  );

  // ── Admin profile: notification preferences ──────────────────────────────
  app.get(
    "/api/admin/me/notification-prefs",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT notification_prefs_json FROM admins WHERE id = ? LIMIT 1`,
        [req.auth!.id],
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      res.json({
        prefs: parseAdminNotificationPrefs(rows[0].notification_prefs_json),
        channels: adminNotifyChannelMeta(),
        events: ADMIN_NOTIFY_EVENT_KEYS,
      });
    },
  );

  app.put(
    "/api/admin/me/notification-prefs",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT notification_prefs_json FROM admins WHERE id = ? LIMIT 1`,
        [req.auth!.id],
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      const existing = parseAdminNotificationPrefs(
        rows[0].notification_prefs_json,
      );
      const body = req.body || {};
      const merged = parseAdminNotificationPrefs({
        email: { ...existing.email, ...(body.email || {}) },
        in_app: { ...existing.in_app, ...(body.in_app || {}) },
        sms: { ...existing.sms, ...(body.sms || {}) },
      });
      // Ignore SMS writes while Twilio is not configured (UI is locked)
      if (!isAdminSmsChannelAvailable()) {
        merged.sms = existing.sms;
      }
      await pool.query<ResultSetHeader>(
        `UPDATE admins SET notification_prefs_json = ? WHERE id = ?`,
        [JSON.stringify(merged), req.auth!.id],
      );
      res.json({
        prefs: merged,
        channels: adminNotifyChannelMeta(),
        events: ADMIN_NOTIFY_EVENT_KEYS,
      });
    },
  );

  app.get(
    "/api/admin/me/notifications",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const limit = Math.min(
        50,
        Math.max(1, Number(req.query.limit) || 20),
      );
      const adminId = req.auth!.id;
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, event_key, title, body, link_url, read_at, created_at
         FROM admin_notifications
         WHERE admin_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [adminId, limit],
      );
      const [[countRow]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM admin_notifications
         WHERE admin_id = ? AND read_at IS NULL`,
        [adminId],
      );
      res.json({
        notifications: rows.map((r) => ({
          id: Number(r.id),
          event_key: String(r.event_key),
          title: String(r.title),
          body: r.body != null ? String(r.body) : null,
          link_url: r.link_url != null ? String(r.link_url) : null,
          read_at: r.read_at
            ? new Date(r.read_at as string).toISOString()
            : null,
          created_at: new Date(r.created_at as string).toISOString(),
        })),
        unread_count: Number(countRow?.cnt || 0),
      });
    },
  );

  app.post(
    "/api/admin/me/notifications/read",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const adminId = req.auth!.id;
      const ids = Array.isArray(req.body?.ids)
        ? (req.body.ids as unknown[])
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n) && n > 0)
        : [];
      const markAll = !!req.body?.all;
      if (markAll) {
        await pool.query<ResultSetHeader>(
          `UPDATE admin_notifications SET read_at = NOW()
           WHERE admin_id = ? AND read_at IS NULL`,
          [adminId],
        );
      } else if (ids.length > 0) {
        await pool.query<ResultSetHeader>(
          `UPDATE admin_notifications SET read_at = NOW()
           WHERE admin_id = ? AND id IN (?) AND read_at IS NULL`,
          [adminId, ids],
        );
      }
      const [[countRow]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM admin_notifications
         WHERE admin_id = ? AND read_at IS NULL`,
        [adminId],
      );
      res.json({ ok: true, unread_count: Number(countRow?.cnt || 0) });
    },
  );

  app.post("/api/auth/logout", async (req, res) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) await revokeSession(token);
    res.json({ ok: true });
  });

  // Magic link — validate onboarding token from welcome email, create full session
  app.get("/api/auth/onboarding/:token", async (req, res) => {
    const rawToken = String(req.params.token || "").trim();
    if (!rawToken || rawToken.length < 32) {
      return res.status(400).json({ error: "Invalid token" });
    }
    const clientId = await consumeOnboardingToken(rawToken);
    if (!clientId) {
      return res.status(401).json({
        error: "Link has expired or already been used. Please sign in.",
      });
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, email, first_name, last_name FROM clients WHERE id = ? LIMIT 1",
      [clientId],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Account not found" });
    const c = rows[0];
    await pool.query<ResultSetHeader>(
      "UPDATE clients SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?",
      [clientId],
    );
    const sessionToken = await createSession(
      "client",
      clientId,
      c.email as string,
      req.ip,
      String(req.headers["user-agent"] || ""),
    );
    res.json({
      token: sessionToken,
      user: {
        id: c.id,
        email: c.email,
        first_name: c.first_name,
        last_name: c.last_name,
      },
    });
  });

  // ============================================================
  // PUBLIC — legal documents (DB-backed markdown)
  // ============================================================
  app.get("/api/legal", async (_req, res) => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT slug, title, updated_at FROM legal_documents ORDER BY slug ASC`,
      );
      res.json({ documents: rows });
    } catch (err: any) {
      console.error("[/api/legal]", err?.message ?? err);
      res.status(503).json({
        error: "Service temporarily unavailable. Please try again shortly.",
      });
    }
  });

  app.get("/api/legal/:slug", async (req, res) => {
    try {
      const slug = String(req.params.slug || "")
        .trim()
        .toLowerCase();
      if (!slug) return res.status(400).json({ error: "slug required" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT slug, title, content_md, source_url, updated_at
         FROM legal_documents WHERE slug = ? LIMIT 1`,
        [slug],
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.json({ document: rows[0] });
    } catch (err: any) {
      console.error("[/api/legal/:slug]", err?.message ?? err);
      res.status(503).json({
        error: "Service temporarily unavailable. Please try again shortly.",
      });
    }
  });

  // ============================================================
  // PUBLIC — packages + registration + Authorize.net
  // ============================================================
  app.get("/api/packages", async (_req, res) => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, slug, name, subtitle, description, price_cents, compare_price_cents,
                billing_interval, checkout_type, duration_months, features_json, sort_order
         FROM packages
         WHERE is_active = 1 AND checkout_type IN ('fixed_price', 'tradeline_picker')
         ORDER BY sort_order ASC`,
      );
      res.json({ packages: rows });
    } catch (err: any) {
      console.error("[/api/packages] DB error:", err?.message ?? err);
      res.status(503).json({
        error: "Service temporarily unavailable. Please try again shortly.",
      });
    }
  });

  app.get("/api/tradeline-products", async (_req, res) => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, slug, name, details, price_cents, compare_price_cents, sort_order
         FROM tradeline_products
         WHERE is_active = 1
         ORDER BY sort_order ASC`,
      );
      res.json({ products: rows });
    } catch (err: any) {
      console.error("[/api/tradeline-products] DB error:", err?.message ?? err);
      res.status(503).json({
        error: "Service temporarily unavailable. Please try again shortly.",
      });
    }
  });

  // Authorize.net webhooks (ARB status, optional signature verification)
  app.post("/api/webhooks/authorize-net", async (req, res) => {
    try {
      const rawBody =
        (req as any).rawBody?.toString?.() || JSON.stringify(req.body ?? {});
      const sigKey = process.env.ANET_WEBHOOK_SIGNATURE_KEY;
      if (!sigKey) {
        if (IS_PROD) {
          console.error(
            "[anet:webhook] ANET_WEBHOOK_SIGNATURE_KEY not configured in production — rejecting",
          );
          return res.status(503).json({ error: "Webhook not configured" });
        }
      } else {
        // Once a signature key is configured, a missing/invalid header is
        // ALWAYS rejected — previously an absent header silently skipped
        // verification, letting anyone forge subscription-status events.
        const headerSig = String(req.headers["x-anet-signature"] || "").replace(
          /^sha512=/i,
          "",
        );
        const expected = crypto
          .createHmac("sha512", sigKey)
          .update(rawBody)
          .digest("hex")
          .toUpperCase();
        if (!headerSig || headerSig.toUpperCase() !== expected) {
          console.warn("[anet:webhook] Invalid or missing signature");
          return res.status(401).json({ error: "Invalid signature" });
        }
      }

      const payload = req.body ?? {};
      const eventType = String(
        payload.eventType || payload.event_type || "",
      ).toLowerCase();
      const subPayload = payload.payload || {};
      const subscriptionId = String(
        subPayload.subscriptionId ||
          subPayload.subscription?.id ||
          (eventType.includes("subscription") ? subPayload.id : "") ||
          payload.subscriptionId ||
          "",
      );
      const transactionId = String(
        (eventType.includes("payment") ? subPayload.id : "") ||
          subPayload.transId ||
          subPayload.transactionId ||
          "",
      );
      const authAmount = Number(
        subPayload.authAmount ?? subPayload.amount ?? NaN,
      );

      // ── Subscription lifecycle (cancel / suspend / fail) ─────────────────
      if (subscriptionId && eventType.includes("subscription")) {
        let newStatus: string | null = null;
        let affiliateSubStatus: string | null = null;
        if (eventType.includes("cancel") || eventType.includes("terminat")) {
          newStatus = "cancelled";
          affiliateSubStatus = "cancelled";
        } else if (
          eventType.includes("suspend") ||
          eventType.includes("fail") ||
          eventType.includes("expired")
        ) {
          newStatus = "suspended";
          affiliateSubStatus = "past_due";
        }

        if (newStatus) {
          await pool.query<ResultSetHeader>(
            `UPDATE client_subscriptions
             SET status = ?, cancelled_at = IF(? = 'cancelled', NOW(), cancelled_at), updated_at = NOW()
             WHERE anet_subscription_id = ? AND status IN ('active','suspended')`,
            [newStatus, newStatus, subscriptionId],
          );
        }
        if (affiliateSubStatus) {
          await pool.query<ResultSetHeader>(
            `UPDATE affiliates
             SET subscription_status = ?, updated_at = NOW()
             WHERE anet_subscription_id = ?
               AND subscription_status IN ('active','pending','past_due')`,
            [affiliateSubStatus, subscriptionId],
          );
        }
      }

      // ── Successful ARB / recurring charge → ledger row + restore active ──
      // Authorize.net emits net.authorize.payment.authcapture.created (and
      // similar) for subscription renewals. Without this, PoM revenue never
      // lands in payments and past_due never recovers.
      const isPaymentEvent =
        eventType.includes("payment") &&
        (eventType.includes("authcapture") ||
          eventType.includes("capture") ||
          eventType.includes("paid"));
      if (isPaymentEvent && subscriptionId) {
        const [clientSubs] = await pool.query<RowDataPacket[]>(
          `SELECT id, client_id, package_id, amount_cents, status
           FROM client_subscriptions
           WHERE anet_subscription_id = ?
           LIMIT 1`,
          [subscriptionId],
        );
        if (clientSubs.length > 0) {
          const sub = clientSubs[0];
          const amountCents =
            Number.isFinite(authAmount) && authAmount > 0
              ? Math.round(authAmount * 100)
              : Number(sub.amount_cents);
          const providerTxn =
            transactionId || `arb-${subscriptionId}-${Date.now()}`;

          // Idempotent: provider_transaction_id is UNIQUE
          try {
            await pool.query<ResultSetHeader>(
              `INSERT INTO payments
                 (client_id, package_id, amount_cents, currency, status, provider,
                  provider_transaction_id, paid_at, metadata_json)
               VALUES (?, ?, ?, 'USD', 'succeeded', 'authorize_net', ?, NOW(), ?)`,
              [
                sub.client_id,
                sub.package_id,
                amountCents,
                providerTxn,
                JSON.stringify({
                  source: "anet_webhook_arb",
                  subscription_id: subscriptionId,
                  event_type: eventType,
                }),
              ],
            );
          } catch (e: any) {
            // Duplicate txn id from webhook retry — ignore
            if (e?.code !== "ER_DUP_ENTRY") throw e;
          }

          await pool.query<ResultSetHeader>(
            `UPDATE client_subscriptions
             SET status = 'active', cancelled_at = NULL, updated_at = NOW()
             WHERE id = ? AND status IN ('active','suspended','cancelled')`,
            [sub.id],
          );
        }

        await pool.query<ResultSetHeader>(
          `UPDATE affiliates
           SET subscription_status = 'active', updated_at = NOW()
           WHERE anet_subscription_id = ?
             AND subscription_status IN ('active','pending','past_due')`,
          [subscriptionId],
        );
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[anet:webhook] error:", err?.message ?? err);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // ============================================================================
  // PUBLIC CREDIT ANALYSIS + LEAD CAPTURE (no auth — 1C/2C/3A/4C/8C/10A)
  // ============================================================================
  const PUBLIC_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  app.post(
    "/api/public/credit-analysis",
    upload.single("report_file"),
    async (req, res) => {
      const b = req.body || {};
      const mode: CreditAnalysisMode = b.mode === "agent" ? "agent" : "client";
      const firstName = String(b.first_name || "").trim();
      const lastName = String(b.last_name || "").trim();
      const email = String(b.email || "")
        .trim()
        .toLowerCase();
      const phone = String(b.phone || "").trim();
      const textLanguage: "en" | "es" = b.text_language === "es" ? "es" : "en";
      const clientGoal = b.client_goal
        ? String(b.client_goal).trim().slice(0, 255)
        : null;
      const notes = b.notes ? String(b.notes).trim() : null;
      const agentPhone =
        mode === "agent" && b.agent_phone ? String(b.agent_phone).trim() : null;
      const repName =
        mode === "agent" && b.rep_name ? String(b.rep_name).trim() : null;
      const emailOptIn = b.email_opt_in === "true" || b.email_opt_in === true;
      const file = (req as any).file as Express.Multer.File | undefined;
      // Affiliate first-touch attribution — cookie is set client-side; server
      // also accepts any of these field names for direct API callers.
      const affiliateCode =
        b.affiliate_code || b.affiliateCode || b.ref || b.slug;

      if (!firstName || !lastName || !email || !phone) {
        return res.status(400).json({
          error: "first_name, last_name, email and phone are required",
        });
      }
      if (!PUBLIC_EMAIL_RE.test(email)) {
        return res.status(400).json({ error: "Invalid email address" });
      }
      if (!file) {
        return res.status(400).json({ error: "report_file is required" });
      }

      // Best-effort text extraction — only PDFs are parsed; other file types
      // (e.g. photos of a report) are still stored but yield no scores/negatives.
      let reportText = "";
      let pdfParseFailed = false;
      if (file.mimetype === "application/pdf") {
        try {
          const pdfParse = await loadPdfParse();
          const parsed = await pdfParse(file.buffer);
          reportText = parsed.text || "";
        } catch (e: any) {
          pdfParseFailed = true;
          console.error(
            "[public:credit-analysis] pdf parse failed:",
            e?.message,
          );
        }
      }
      const extractionStatus = resolveExtractionStatus(
        file.mimetype,
        reportText,
        pdfParseFailed,
      );
      const charsExtracted = reportText.trim().length;
      const weakExtraction = extractionStatus !== "ok";

      const provider = reportText ? detectProvider(reportText) : "generic";
      const scores: BureauScores = reportText
        ? extractAllScores(reportText, provider)
        : { transunion: null, experian: null, equifax: null };
      const hasScores = !!(
        scores.transunion ||
        scores.experian ||
        scores.equifax
      );
      const negativeLines = reportText ? detectNegativeLines(reportText) : [];
      const negatives = buildNegativeItems(negativeLines);
      const suggestedLabels = inferAnalysisLabelSlugs(
        negativeLines,
        reportText,
      );

      try {
        const affiliateId = await resolveAffiliateIdBySlugOrCode(affiliateCode);

        const [existingRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, status FROM clients WHERE email = ? LIMIT 1`,
          [email],
        );

        let clientId: number;
        let isProspectFlow = true;
        if (existingRows.length > 0) {
          clientId = existingRows[0].id as number;
          isProspectFlow = existingRows[0].status === "prospect";
          if (affiliateId) {
            // First-touch: never overwrite an existing attribution.
            await pool.query<ResultSetHeader>(
              `UPDATE clients SET affiliate_id = COALESCE(affiliate_id, ?) WHERE id = ?`,
              [affiliateId, clientId],
            );
          }
        } else {
          const ownerId = await resolveLanguageOwnerAdminId(
            textLanguage === "es" ? "es" : "en",
          );
          const [ins] = await pool.query<ResultSetHeader>(
            `INSERT INTO clients (email, first_name, last_name, phone, preferred_language, assigned_admin_id, status, pipeline_stage, affiliate_id)
             VALUES (?, ?, ?, ?, ?, ?, 'prospect', 'prospect', ?)`,
            [
              email,
              firstName,
              lastName,
              phone || null,
              textLanguage,
              ownerId,
              affiliateId,
            ],
          );
          clientId = ins.insertId;
        }

        if (isProspectFlow) {
          const sourceLabel =
            mode === "agent" ? "agent_submission" : "web_analysis";
          const labelSlugs = [sourceLabel, ...suggestedLabels];
          if (b.lead_source === "get_started")
            labelSlugs.push("get_started_wizard");
          if (affiliateId) labelSlugs.push("affiliate_referral");
          attachLabelsBySlug(clientId, labelSlugs).catch((e) =>
            console.error(
              "[public:credit-analysis] attachLabels failed:",
              e?.message,
            ),
          );
        }

        // Best-effort CDN upload of the raw report — never blocks analysis generation.
        let storageKey: string | null = null;
        try {
          storageKey = await uploadToCDN(
            file.buffer,
            file.originalname,
            file.mimetype,
            `analysis-${clientId}`,
          );
        } catch (e: any) {
          console.error(
            "[public:credit-analysis] CDN upload failed:",
            e?.message,
          );
        }

        const utilization = reportText
          ? extractUtilization(reportText).map((u) => ({
              account: u.account,
              limit: u.limit,
              balance: u.balance,
              pctUsed: u.pctUsed,
              payTo30: u.payTo30,
              payTo10: u.payTo10,
            }))
          : [];
        const positiveAccounts = reportText
          ? extractPositiveAccounts(reportText)
          : [];

        const analyst: CreditAnalysisAnalystFlat = runCreditAnalysisAlgorithm({
          clientName: `${firstName} ${lastName}`.trim(),
          firstName,
          lastName,
          repName,
          clientGoal,
          language: textLanguage,
          scores,
          negatives,
          reportText,
          utilization,
          positiveAccounts,
          weakExtraction,
        });

        const croa =
          analyst.text_language === "Spanish"
            ? CROA_DISCLOSURE_ES
            : CROA_DISCLOSURE_EN;
        const { html, text } = buildAnalystAnalysisHtml({
          firstName,
          analyst,
          weakExtraction,
          croaDisclosure: croa,
        });

        // Prefer algorithm language for email copy when surname-biased Spanish.
        const emailLang: "en" | "es" =
          analyst.text_language === "Spanish" ? "es" : "en";

        let emailSent = false;
        if (emailOptIn) {
          try {
            await sendEmail({
              to: email,
              subject:
                emailLang === "es"
                  ? "Tu análisis de crédito — Optimum Credit"
                  : "Your Credit Analysis — Optimum Credit",
              html: emailLayout({
                title:
                  emailLang === "es"
                    ? "Tu análisis de crédito"
                    : "Your Credit Analysis",
                bodyHtml: html,
                lang: emailLang,
              }),
              text,
            });
            emailSent = true;
          } catch (e: any) {
            console.error(
              "[public:credit-analysis] email send failed:",
              e?.message,
            );
          }
        }

        const generatedAt = new Date();
        const [insAnalysis] = await pool.query<ResultSetHeader>(
          `INSERT INTO credit_analyses
             (client_id, mode, submitter_first_name, submitter_last_name, agent_phone, rep_name,
              client_goal, text_language, notes, report_file_name, report_mime_type, report_storage_key,
              provider_detected, scores_json, negatives_json, labels_suggested_json, analyst_json,
              analysis_html, analysis_text, email_opt_in, email_sent_at, generated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            clientId,
            mode,
            firstName,
            lastName,
            agentPhone,
            repName,
            clientGoal,
            textLanguage,
            notes,
            file.originalname || null,
            file.mimetype || null,
            storageKey,
            provider,
            JSON.stringify(scores),
            JSON.stringify(negatives),
            JSON.stringify(suggestedLabels),
            JSON.stringify(analyst),
            html,
            text,
            emailOptIn ? 1 : 0,
            emailSent ? generatedAt : null,
            generatedAt,
          ],
        );

        const result: CreditAnalysisResult = {
          id: insAnalysis.insertId,
          client_id: clientId,
          mode,
          scores: hasScores ? scores : null,
          negatives,
          suggested_labels: suggestedLabels,
          analysis_html: html,
          analysis_text: text,
          email_sent: emailSent,
          generated_at: generatedAt.toISOString(),
          extraction_status: extractionStatus,
          chars_extracted: charsExtracted,
          analyst,
        };
        res.json(result);
      } catch (err: any) {
        if (sendFriendlyError(res, err, { duplicateLabel: "email" })) return;
        console.error("[public:credit-analysis] error:", err?.message ?? err);
        res
          .status(500)
          .json({
            error: "We couldn't generate your analysis. Please try again.",
          });
      }
    },
  );

  // Lighter lead capture (no file) — homepage "Get my free analysis" mini-form.
  app.post("/api/public/prospect-lead", async (req, res) => {
    const b = req.body || {};
    const firstName = String(b.first_name || "").trim();
    const lastName = String(b.last_name || "").trim();
    const email = String(b.email || "")
      .trim()
      .toLowerCase();
    const phone = b.phone ? String(b.phone).trim() : null;
    const sourceLabel = b.source_label
      ? String(b.source_label).trim()
      : "web_analysis";
    const notes = b.notes ? String(b.notes).trim() : null;
    const affiliateCode =
      b.affiliate_code || b.affiliateCode || b.ref || b.slug;
    const lang =
      b.preferred_language === "es" || b.text_language === "es" ? "es" : "en";

    if (!firstName || !lastName || !email) {
      return res
        .status(400)
        .json({ error: "first_name, last_name and email are required" });
    }
    if (!PUBLIC_EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    try {
      const affiliateId = await resolveAffiliateIdBySlugOrCode(affiliateCode);
      const [existingRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, status FROM clients WHERE email = ? LIMIT 1`,
        [email],
      );

      let clientId: number;
      let isProspectFlow = true;
      if (existingRows.length > 0) {
        clientId = existingRows[0].id as number;
        isProspectFlow = existingRows[0].status === "prospect";
        if (isProspectFlow && phone) {
          await pool.query<ResultSetHeader>(
            `UPDATE clients SET phone = COALESCE(?, phone) WHERE id = ?`,
            [phone, clientId],
          );
        }
        if (affiliateId) {
          await pool.query<ResultSetHeader>(
            `UPDATE clients SET affiliate_id = COALESCE(affiliate_id, ?) WHERE id = ?`,
            [affiliateId, clientId],
          );
        }
      } else {
        const ownerId = await resolveLanguageOwnerAdminId(lang);
        const [ins] = await pool.query<ResultSetHeader>(
          `INSERT INTO clients (email, first_name, last_name, phone, preferred_language, assigned_admin_id, status, pipeline_stage, affiliate_id)
           VALUES (?, ?, ?, ?, ?, ?, 'prospect', 'prospect', ?)`,
          [email, firstName, lastName, phone, lang, ownerId, affiliateId],
        );
        clientId = ins.insertId;
      }

      if (isProspectFlow) {
        const labelSlugs = [sourceLabel];
        if (b.lead_source === "get_started")
          labelSlugs.push("get_started_wizard");
        if (affiliateId) labelSlugs.push("affiliate_referral");
        await attachLabelsBySlug(clientId, labelSlugs);
        if (notes) {
          await pool.query<ResultSetHeader>(
            `INSERT INTO credit_analyses
               (client_id, mode, submitter_first_name, submitter_last_name, notes, generated_at)
             VALUES (?, 'client', ?, ?, ?, NOW())`,
            [clientId, firstName, lastName, notes],
          );
        }
      }

      res.json({ ok: true, client_id: clientId });
    } catch (err: any) {
      if (sendFriendlyError(res, err, { duplicateLabel: "email" })) return;
      console.error("[public:prospect-lead] error:", err?.message ?? err);
      res
        .status(500)
        .json({ error: "We couldn't submit your info. Please try again." });
    }
  });

  // ============================================================================
  // PUBLIC AFFILIATE LINKS — /r/{slug} resolve + click logging (no PII beyond first_name)
  // ============================================================================

  // Resolve a public referral slug into a redirect path + shareable links.
  // Used by the client-side /r/:slug route to set the 30-day first-touch
  // attribution cookie and redirect to the affiliate's default landing page.
  app.get("/api/public/affiliates/:slug", async (req, res) => {
    if (!affiliatesFeatureEnabled()) {
      return res.status(503).json({
        error: "Affiliates temporarily unavailable",
        code: "AFFILIATES_DISABLED",
      });
    }
    const rawSlug = String(req.params.slug || "").trim();
    if (!rawSlug) return res.status(400).json({ error: "slug required" });
    try {
      // Match slug always; referral_code only when ≤32 chars (column width)
      // so longer values never silently truncate into a wrong hit.
      const referralMatch = rawSlug.length <= 32 ? "OR referral_code = ?" : "";
      const params = rawSlug.length <= 32 ? [rawSlug, rawSlug] : [rawSlug];
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, first_name, slug, referral_code, default_landing, status
         FROM affiliates
         WHERE (slug = ? ${referralMatch})
           AND status NOT IN ('inactive','suspended')
         LIMIT 1`,
        params,
      );
      if (
        rows.length === 0 ||
        !affiliateCanReceiveClicks({ status: rows[0].status as string })
      ) {
        return res.status(404).json({ error: "Referral link not found" });
      }
      const aff = rows[0];
      const slug = (aff.slug as string) || (aff.referral_code as string);
      const requestedTo = String(req.query.to || "");
      const landing: AffiliateLanding =
        requestedTo === "analysis"
          ? "credit_analysis"
          : requestedTo === "pricing"
            ? "pricing"
            : (aff.default_landing as AffiliateLanding);
      const redirectPath = affiliateLandingPath(landing, slug);
      res.json({
        slug,
        first_name: aff.first_name,
        redirect_path: redirectPath,
        links: buildAffiliatePublicLinks(slug, APP_URL),
      });
    } catch (err: any) {
      console.error("[public:affiliates:resolve]", err?.message ?? err);
      res.status(503).json({
        error: "Service temporarily unavailable. Please try again shortly.",
      });
    }
  });

  // Log a link click for attribution analytics. Best-effort — never blocks
  // the redirect on the client.
  app.post("/api/public/affiliates/:slug/click", async (req, res) => {
    if (!affiliatesFeatureEnabled()) {
      return res.status(503).json({
        error: "Affiliates temporarily unavailable",
        code: "AFFILIATES_DISABLED",
      });
    }
    const rawSlug = String(req.params.slug || "").trim();
    if (!rawSlug) return res.status(400).json({ error: "slug required" });
    const landing = ["credit_analysis", "pricing", "other"].includes(
      req.body?.landing,
    )
      ? req.body.landing
      : "other";
    try {
      const referralMatch = rawSlug.length <= 32 ? "OR referral_code = ?" : "";
      const params = rawSlug.length <= 32 ? [rawSlug, rawSlug] : [rawSlug];
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, slug, referral_code, status FROM affiliates
         WHERE (slug = ? ${referralMatch})
           AND status NOT IN ('inactive','suspended')
         LIMIT 1`,
        params,
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Not found" });
      const aff = rows[0];
      const slug = (aff.slug as string) || (aff.referral_code as string);
      await pool.query<ResultSetHeader>(
        `INSERT INTO affiliate_link_clicks (affiliate_id, slug, landing, ip_address, user_agent, referer)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          aff.id,
          slug,
          landing,
          req.ip || null,
          String(req.headers["user-agent"] || "").slice(0, 500),
          String(req.headers["referer"] || req.headers["referrer"] || "").slice(
            0,
            500,
          ),
        ],
      );
      res.json({ ok: true, slug });
    } catch (err: any) {
      console.error("[public:affiliates:click]", err?.message ?? err);
      // Never block the redirect flow on a logging failure.
      res.json({ ok: false, slug: rawSlug });
    }
  });

  // ── Public affiliate invite join (staff-created links) ───────────────────
  app.get("/api/public/affiliate-invite/:token", async (req, res) => {
    if (!affiliatesFeatureEnabled()) {
      return res.status(503).json({
        error: "Affiliates temporarily unavailable",
        code: "AFFILIATES_DISABLED",
      });
    }
    const token = String(req.params.token || "").trim();
    if (!token) return res.status(400).json({ error: "token required" });
    const row = await findAffiliateInviteByPathKey(token);
    if (!row) return res.status(404).json({ error: "Invite not found" });
    res.json({
      // Do not expose opaque token on public resolve — join uses the URL path key.
      slug: row.slug != null ? String(row.slug) : null,
      plan: row.plan,
      label: row.label,
      parent_name: row.parent_name || null,
      is_open: affiliateInviteLinkIsOpen(row),
    });
  });

  app.post("/api/public/affiliate-invite/:token/join", async (req, res) => {
    if (!affiliatesFeatureEnabled()) {
      return res.status(503).json({
        error: "Affiliates temporarily unavailable",
        code: "AFFILIATES_DISABLED",
      });
    }
    if (
      process.env.VITEST !== "true" &&
      hitRateLimit(
        rateLimitKey(req, `aff-invite-join:${req.ip || "unknown"}`),
        5,
        60 * 60 * 1000,
      )
    ) {
      return res
        .status(429)
        .json({ error: "Too many signup attempts. Try again later." });
    }
    const token = String(req.params.token || "").trim();
    const b = req.body || {};
    const firstName = String(b.first_name || "").trim();
    const lastName = String(b.last_name || "").trim();
    const email = String(b.email || "")
      .trim()
      .toLowerCase();
    const phone = b.phone ? String(b.phone).trim() : null;
    if (!token || !firstName || !lastName || !email) {
      return res
        .status(400)
        .json({ error: "first_name, last_name and email are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }
    const agreedTerms =
      b.agreed_terms === true ||
      b.agreed_terms === "true" ||
      b.agreed_terms === "1";
    const agreedSms =
      b.agreed_sms === true ||
      b.agreed_sms === "true" ||
      b.agreed_sms === "1";
    if (!agreedTerms || !agreedSms) {
      return res.status(400).json({
        error: "You must accept the Terms of Service and SMS / Privacy consent",
        code: "CONSENT_REQUIRED",
      });
    }

    const link = await findAffiliateInviteByPathKey(token);
    if (!link) return res.status(404).json({ error: "Invite not found" });
    if (!affiliateInviteLinkIsOpen(link)) {
      return res.status(410).json({
        error: "This invite link is no longer available",
        code: "INVITE_CLOSED",
      });
    }

    const plan: AffiliatePlan = [
      "standard",
      "master",
      "sub_affiliate",
    ].includes(link.plan as string)
      ? (link.plan as AffiliatePlan)
      : "standard";
    let parentAffiliateId: number | null = link.parent_affiliate_id
      ? Number(link.parent_affiliate_id)
      : null;
    if (plan === "sub_affiliate") {
      if (!parentAffiliateId) {
        return res.status(400).json({
          error: "Invite misconfigured — missing parent master",
        });
      }
      const [parentRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, plan, status FROM affiliates WHERE id = ? LIMIT 1`,
        [parentAffiliateId],
      );
      if (
        !parentRows[0] ||
        parentRows[0].plan !== "master" ||
        ["inactive", "suspended"].includes(String(parentRows[0].status))
      ) {
        return res.status(400).json({
          error: "Invite parent must be an active master affiliate",
        });
      }
    } else {
      parentAffiliateId = null;
    }

    const defaults = suggestedTierDefaults(plan);
    const slug = await generateUniqueAffiliateSlug(
      slugifyAffiliateName(firstName, lastName),
    );
    const referralCode = slug.slice(0, 32);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Atomically claim a use (prevents concurrent one-time double-join)
      const [claim] = await conn.query<ResultSetHeader>(
        `UPDATE affiliate_invite_links
         SET use_count = use_count + 1,
             last_used_at = NOW(),
             is_enabled = CASE
               WHEN kind = 'one_time' THEN 0
               WHEN max_uses IS NOT NULL AND use_count + 1 >= max_uses THEN 0
               ELSE is_enabled
             END
         WHERE id = ?
           AND is_enabled = 1
           AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
           AND (max_uses IS NULL OR use_count < max_uses)`,
        [link.id],
      );
      if (!claim.affectedRows) {
        await conn.rollback();
        return res.status(410).json({
          error: "This invite link is no longer available",
          code: "INVITE_CLOSED",
        });
      }

      const [adminIns] = await conn.query<ResultSetHeader>(
        `INSERT INTO admins (email, first_name, last_name, phone, role, status)
         VALUES (?, ?, ?, ?, 'affiliate', 'active')`,
        [email, firstName, lastName, phone],
      );
      const adminId = adminIns.insertId;

      const [affIns] = await conn.query<ResultSetHeader>(
        `INSERT INTO affiliates
           (admin_id, email, first_name, last_name, phone, plan, monthly_price_cents,
            commission_rate_bps, parent_override_rate_bps, parent_affiliate_id,
            status, subscription_status, referral_code, slug, default_landing, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'comped', ?, ?, 'credit_analysis', ?)`,
        [
          adminId,
          email,
          firstName,
          lastName,
          phone,
          plan,
          defaults.monthly_price_cents,
          defaults.commission_rate_bps,
          defaults.parent_override_rate_bps,
          parentAffiliateId,
          referralCode,
          slug,
          `Joined via invite link #${link.id}`,
        ],
      );

      await conn.commit();

      const [inviter] = await pool.query<RowDataPacket[]>(
        `SELECT first_name, last_name FROM admins WHERE id = ? LIMIT 1`,
        [link.created_by_admin_id],
      );
      const inviterName = inviter[0]
        ? `${inviter[0].first_name} ${inviter[0].last_name}`
        : "The Optimum Credit team";
      const loginUrl = `${APP_URL}/admin/login`;
      const welcomeTpl = tplAdminWelcome({
        firstName,
        lastName,
        email,
        role: "affiliate",
        loginUrl,
        invitedByName: inviterName,
      });
      sendEmail({
        to: email,
        subject: welcomeTpl.subject,
        html: welcomeTpl.html,
      }).catch((err) => console.error("[affiliate-invite-welcome]:", err));

      res.status(201).json({
        ok: true,
        login_url: loginUrl,
        email,
        affiliate_id: affIns.insertId,
      });
    } catch (err: any) {
      await conn.rollback();
      if (sendFriendlyError(res, err, { duplicateLabel: "email" })) return;
      throw err;
    } finally {
      conn.release();
    }
  });

  // Single-step registration: charge card first, create client only on success.
  // Accepts all form fields + Accept.js nonce (dataDescriptor + dataValue).
  app.post("/api/registration", async (req, res) => {
    const b = req.body || {};
    if (
      hitRateLimit(
        rateLimitKey(
          req,
          `registration:${String(b?.email || "").toLowerCase()}`,
        ),
        10,
        15 * 60 * 1000,
      )
    ) {
      return res
        .status(429)
        .json({ error: "Too many attempts. Please try again later." });
    }
    const required = ["firstName", "lastName", "email", "phone", "packageSlug"];
    // Card nonce required later — only when amount due > 0 (100% coupons are $0)
    for (const f of required) {
      if (!b[f] || String(b[f]).trim().length === 0) {
        return res.status(400).json({ error: `Missing field: ${f}` });
      }
    }
    const email = String(b.email).trim().toLowerCase();

    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id, status FROM clients WHERE email = ? LIMIT 1",
      [email],
    );
    if (
      existing.length > 0 &&
      !["pending_payment", "prospect"].includes(existing[0].status)
    ) {
      return res.status(409).json({
        error: "An account with this email already exists. Please sign in.",
      });
    }

    const [pkgs] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, slug, price_cents, checkout_type
       FROM packages WHERE slug = ? AND is_active = 1 LIMIT 1`,
      [b.packageSlug],
    );
    if (pkgs.length === 0)
      return res.status(400).json({ error: "Invalid package" });
    const pkg = pkgs[0];
    const checkoutType = (pkg.checkout_type as string) || "fixed_price";

    let tradelineProducts: RowDataPacket[] = [];
    let chargeAmountCents = Number(pkg.price_cents);

    if (checkoutType === "tradeline_picker") {
      const rawIds = b.tradelineProductIds;
      const ids = Array.isArray(rawIds)
        ? [
            ...new Set(
              rawIds.map((x: unknown) => Number(x)).filter((n) => n > 0),
            ),
          ]
        : [];
      if (ids.length === 0) {
        return res
          .status(400)
          .json({ error: "Select at least one tradeline to continue" });
      }
      tradelineProducts = await loadActiveTradelineProducts(ids);
      if (tradelineProducts.length !== ids.length) {
        return res.status(400).json({ error: "Invalid tradeline selection" });
      }
      chargeAmountCents = tradelineProducts.reduce(
        (sum, p) => sum + Number(p.price_cents),
        0,
      );
      if (chargeAmountCents <= 0) {
        return res.status(400).json({ error: "Invalid tradeline total" });
      }
    }

    // Affiliate first-touch attribution — accepts referral_code, slug, or `ref`.
    const affiliateId = await resolveAffiliateIdBySlugOrCode(
      b.affiliateCode || b.affiliate_code || b.ref || b.slug,
    );

    // ── Coupon validation ──────────────────────────────────────────────────────
    let couponId: number | null = null;
    let discountCents = 0;
    let originalAmountCents: number | null = null;
    let couponReserved = false;

    if (b.coupon_code) {
      const upperCode = String(b.coupon_code).toUpperCase().trim();
      const [couponRows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM coupons WHERE code = ? AND is_active = 1 LIMIT 1`,
        [upperCode],
      );
      if (couponRows.length === 0) {
        return res
          .status(400)
          .json({ error: "Invalid or inactive coupon code" });
      }

      const c = couponRows[0];
      const now = new Date();
      if (c.valid_from && new Date(c.valid_from) > now) {
        return res.status(400).json({ error: "Coupon is not yet valid" });
      }
      if (c.expires_at && new Date(c.expires_at) < now) {
        return res.status(400).json({ error: "Coupon has expired" });
      }
      if (chargeAmountCents < Number(c.min_amount_cents)) {
        return res.status(400).json({
          error: `Minimum order of $${(Number(c.min_amount_cents) / 100).toFixed(2)} required`,
        });
      }

      // Check package applicability
      let pkgAllowed = true;
      if (c.applicable_packages) {
        let pkgs: number[] = [];
        try {
          pkgs =
            typeof c.applicable_packages === "string"
              ? JSON.parse(c.applicable_packages)
              : c.applicable_packages;
        } catch {}
        if (pkgs.length > 0 && !pkgs.includes(Number(pkg.id))) {
          pkgAllowed = false;
        }
      }
      if (!pkgAllowed) {
        return res
          .status(400)
          .json({ error: "Coupon not valid for selected package" });
      }

      // Reserve one usage atomically to prevent over-redemption on concurrent checkouts.
      const [reserveUsage] = await pool.query<ResultSetHeader>(
        `UPDATE coupons
         SET uses_count = uses_count + 1
         WHERE id = ? AND (max_uses IS NULL OR uses_count < max_uses)`,
        [c.id],
      );
      if (reserveUsage.affectedRows === 0) {
        return res.status(400).json({ error: "Coupon usage limit reached" });
      }

      couponReserved = true;
      couponId = c.id as number;
      originalAmountCents = chargeAmountCents;
      if (c.discount_type === "percentage") {
        discountCents = Math.round(
          (chargeAmountCents * Number(c.discount_value)) / 100,
        );
      } else {
        discountCents = Number(c.discount_value);
      }
      discountCents = Math.min(discountCents, chargeAmountCents);
      chargeAmountCents = chargeAmountCents - discountCents;
    }

    const isFreeCheckout = chargeAmountCents <= 0;

    // Card / payment provider required only when we will charge
    if (!isFreeCheckout) {
      if (authorizeNetConfigured) {
        if (!b.dataDescriptor || !b.dataValue) {
          return res.status(400).json({
            error: "Card details are required to complete payment",
          });
        }
      } else if (!mockPaymentsAllowed()) {
        return res
          .status(503)
          .json({ error: "Payment provider not configured" });
      }
    }

    // 1. Charge card FIRST — no DB record written on failure (mock when ANet off)
    //    $0 after coupon: skip Authorize.net (processor rejects $0.00 charges).
    let chargeResult: Awaited<
      ReturnType<typeof processAuthorizeNetPayment>
    > | null = null;

    // We need a real clientId for Authorize.net metadata. For new clients we insert
    // with status='pending_payment', charge, then update to 'onboarding' — or rollback.
    let clientId: number;
    let isNewClient = false;

    if (existing.length > 0) {
      clientId = existing[0].id as number;
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET first_name=?, last_name=?, phone=?, package_id=?,
          affiliate_id=COALESCE(affiliate_id, ?) WHERE id=?`,
        [
          b.firstName,
          b.lastName,
          b.phone || null,
          pkg.id,
          affiliateId,
          clientId,
        ],
      );
    } else {
      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO clients (email, first_name, last_name, phone, package_id, affiliate_id,
           pipeline_stage, status)
         VALUES (?,?,?,?,?,?, 'new_client', 'pending_payment')`,
        [email, b.firstName, b.lastName, b.phone || null, pkg.id, affiliateId],
      );
      clientId = ins.insertId;
      isNewClient = true;
    }

    const paymentMetadata: Record<string, unknown> =
      checkoutType === "tradeline_picker"
        ? {
            checkout_type: "tradeline_picker",
            tradeline_product_ids: tradelineProducts.map((p) => p.id),
            tradeline_names: tradelineProducts.map((p) => p.name),
          }
        : {};
    if (isFreeCheckout && b.coupon_code) {
      paymentMetadata.coupon_code = String(b.coupon_code).toUpperCase().trim();
    }

    try {
      if (isFreeCheckout) {
        chargeResult = await processFreeRegistrationPayment(
          clientId,
          pkg.id as number,
          paymentMetadata,
        );
      } else if (authorizeNetConfigured) {
        chargeResult = await processAuthorizeNetPayment(
          clientId,
          email,
          chargeAmountCents,
          pkg.id as number,
          String(b.dataDescriptor),
          String(b.dataValue),
          String(b.firstName),
          String(b.lastName),
          paymentMetadata,
        );
      } else {
        if (!mockPaymentsAllowed()) {
          return res
            .status(503)
            .json({ error: "Payment provider not configured" });
        }
        chargeResult = await processMockRegistrationPayment(
          clientId,
          chargeAmountCents,
          pkg.id as number,
          paymentMetadata,
        );
      }
    } catch (e: any) {
      if (couponReserved && couponId !== null) {
        await pool.query<ResultSetHeader>(
          `UPDATE coupons SET uses_count = GREATEST(uses_count - 1, 0) WHERE id = ?`,
          [couponId],
        );
      }
      // Payment failed — delete the newly inserted client so no ghost records
      if (isNewClient) {
        await pool.query(
          `DELETE FROM clients WHERE id = ? AND status = 'pending_payment'`,
          [clientId],
        );
      }
      return res.status(402).json({ error: e.message || "Payment failed" });
    }

    if (
      checkoutType === "tradeline_picker" &&
      tradelineProducts.length > 0 &&
      chargeResult?.paymentId
    ) {
      await insertTradelineSelections(
        clientId,
        chargeResult.paymentId,
        tradelineProducts,
      );
    }

    // ── Apply coupon details to payment record (usage already reserved above) ─
    if (couponId !== null && chargeResult?.transactionId) {
      try {
        await pool.query(
          `UPDATE payments SET coupon_id=?, discount_cents=?, original_amount_cents=?
           WHERE provider_transaction_id=? LIMIT 1`,
          [
            couponId,
            discountCents,
            originalAmountCents,
            chargeResult.transactionId,
          ],
        );
      } catch (couponAttachErr) {
        console.error("[coupon:attach-payment]", couponAttachErr);
      }
    }

    res.json({
      clientId,
      packageId: pkg.id,
      packageName: pkg.name,
      amountCents: chargeAmountCents,
    });
  });

  // Sandbox-only: confirm a mock payment (no real card charge).
  app.post("/api/registration/confirm-mock", async (req, res) => {
    if (!mockPaymentsAllowed()) {
      return res.status(403).json({ error: "Mock payments are disabled" });
    }
    const { clientId, transactionId } = req.body || {};
    if (!clientId || !transactionId) {
      return res.status(400).json({ error: "Missing fields" });
    }
    if (!String(transactionId).startsWith("txn_mock_")) {
      return res.status(400).json({ error: "Not a mock transaction" });
    }
    await markPaymentSucceeded(Number(clientId), String(transactionId));
    res.json({ ok: true });
  });

  // Process a real Authorize.net payment via Accept.js nonce (legacy two-step flow).
  // Legacy two-step flow — the current client never calls this (registration
  // charges the card in one step via POST /api/registration). Kept only for
  // local/sandbox testing and disabled in production unless explicitly
  // opted back in, since it lets anyone with a clientId attempt a charge.
  app.post("/api/registration/process-payment", async (req, res) => {
    if (IS_PROD && process.env.ALLOW_LEGACY_PROCESS_PAYMENT !== "true") {
      return res.status(410).json({ error: "Use POST /api/registration" });
    }
    const { clientId, dataDescriptor, dataValue, tradelineProductIds } =
      req.body || {};
    if (!clientId) return res.status(400).json({ error: "Missing clientId" });
    if (
      hitRateLimit(
        rateLimitKey(req, `process-payment:${clientId}`),
        10,
        15 * 60 * 1000,
      )
    ) {
      return res
        .status(429)
        .json({ error: "Too many attempts. Please try again later." });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.email, c.first_name, c.last_name, c.package_id, c.status,
              p.price_cents, p.checkout_type
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       WHERE c.id = ? LIMIT 1`,
      [Number(clientId)],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Client not found" });
    const client = rows[0];
    if (!["pending_payment", "prospect"].includes(String(client.status))) {
      return res.status(410).json({ error: "Use POST /api/registration" });
    }
    if (!String(client.email || "").trim()) {
      return res.status(422).json({
        error: "Client has no email on file — cannot process card payment",
        code: "email_required_for_payment",
      });
    }
    const checkoutType = (client.checkout_type as string) || "fixed_price";

    let tradelineProducts: RowDataPacket[] = [];
    let amountCents = Number(client.price_cents);
    if (checkoutType === "tradeline_picker") {
      const ids = Array.isArray(tradelineProductIds)
        ? [
            ...new Set(
              tradelineProductIds
                .map((x: unknown) => Number(x))
                .filter((n) => n > 0),
            ),
          ]
        : [];
      if (ids.length === 0) {
        return res
          .status(400)
          .json({ error: "Select at least one tradeline to continue" });
      }
      tradelineProducts = await loadActiveTradelineProducts(ids);
      if (tradelineProducts.length !== ids.length) {
        return res.status(400).json({ error: "Invalid tradeline selection" });
      }
      amountCents = tradelineProducts.reduce(
        (s, p) => s + Number(p.price_cents),
        0,
      );
    }

    const metadata: Record<string, unknown> =
      checkoutType === "tradeline_picker"
        ? {
            checkout_type: "tradeline_picker",
            tradeline_product_ids: tradelineProducts.map((p) => p.id),
          }
        : {};

    try {
      let result: { transactionId: string; paymentId: number };
      if (authorizeNetConfigured) {
        if (!dataDescriptor || !dataValue) {
          return res.status(400).json({ error: "Missing payment token" });
        }
        result = await processAuthorizeNetPayment(
          Number(clientId),
          client.email as string,
          amountCents,
          client.package_id as number | null,
          String(dataDescriptor),
          String(dataValue),
          client.first_name as string,
          client.last_name as string,
          metadata,
        );
      } else {
        if (!mockPaymentsAllowed()) {
          return res
            .status(503)
            .json({ error: "Payment provider not configured" });
        }
        result = await processMockRegistrationPayment(
          Number(clientId),
          amountCents,
          client.package_id as number,
          metadata,
        );
      }

      if (tradelineProducts.length > 0) {
        await insertTradelineSelections(
          Number(clientId),
          result.paymentId,
          tradelineProducts,
        );
      }
    } catch (e: any) {
      return res.status(402).json({ error: e.message || "Payment failed" });
    }

    res.json({ ok: true });
  });

  // ============================================================
  // CLIENT PORTAL
  // ============================================================
  app.get(
    "/api/portal/dashboard",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const [clientRows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
              c.contract_signed_at, c.smart_credit_connected_at, c.status,
              p.name AS package_name, p.price_cents AS package_price_cents,
              p.duration_months AS package_duration_months
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       WHERE c.id = ? LIMIT 1`,
        [clientId],
      );
      if (clientRows.length === 0)
        return res.status(404).json({ error: "Not found" });

      const [docRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, doc_type, file_name, review_status, rejection_reason, uploaded_at
       FROM client_documents WHERE client_id = ? ORDER BY uploaded_at DESC`,
        [clientId],
      );
      const [reportRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, round_number, score_before, score_after, items_removed, items_disputed, summary_md,
              bureau_scores_json, wins_json, targets_json, file_strength_score,
              pdf_file_name, (pdf_storage_key IS NOT NULL) AS has_pdf, pdf_uploaded_at, created_at
       FROM client_round_reports WHERE client_id = ? ORDER BY round_number DESC`,
        [clientId],
      );
      await attachPdfsToReports(clientId, reportRows);
      const [ticketRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, subject, status, priority, created_at FROM support_tickets WHERE client_id = ? ORDER BY created_at DESC LIMIT 5`,
        [clientId],
      );

      const [activeCase] = await pool.query<RowDataPacket[]>(
        `SELECT id, case_number, pipeline_stage, status, created_at
         FROM credit_repair_cases
         WHERE client_id = ? AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [clientId],
      );

      res.json({
        client: clientRows[0],
        documents: docRows,
        reports: reportRows,
        tickets: ticketRows,
        active_case: activeCase[0] ?? null,
      });
    },
  );

  // Serve a client's own document file (decrypted, inline)
  app.get(
    "/api/portal/documents/:id/file",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const docId = Number(req.params.id);
      if (!docId || isNaN(docId))
        return res.status(400).json({ error: "Invalid id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, mime_type, storage_provider, storage_key, encrypted, enc_iv, enc_tag
         FROM client_documents WHERE id = ? AND client_id = ? LIMIT 1`,
        [docId, clientId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Not found" });
      const doc = rows[0];
      try {
        let buf: Buffer;
        if (doc.storage_provider === "cdn") {
          const cdnRes = await fetch(doc.storage_key as string);
          if (!cdnRes.ok)
            return res.status(404).json({ error: "File not available" });
          const cdnRaw = Buffer.from(await cdnRes.arrayBuffer());
          buf =
            doc.encrypted && doc.enc_iv && doc.enc_tag
              ? decryptFile(cdnRaw, doc.enc_iv as string, doc.enc_tag as string)
              : cdnRaw;
        } else {
          const raw = await fs.promises.readFile(
            path.join(UPLOADS_DIR, doc.storage_key as string),
          );
          buf =
            doc.encrypted && doc.enc_iv && doc.enc_tag
              ? decryptFile(raw, doc.enc_iv as string, doc.enc_tag as string)
              : raw;
        }
        res.set(
          "Content-Type",
          (doc.mime_type as string) || "application/octet-stream",
        );
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(doc.file_name as string)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(404).json({ error: "File not found" });
      }
    },
  );

  app.post(
    "/api/portal/documents",
    requireClient,
    upload.array("files", 5),
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const docType = String(req.body?.doc_type || "");
      const allowed = [
        "id_front",
        "id_back",
        "ssn_card",
        "proof_of_address",
        "other",
      ];
      if (!allowed.includes(docType)) {
        return res.status(400).json({ error: "Invalid doc_type" });
      }
      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0)
        return res.status(400).json({ error: "No files" });

      const inserted: any[] = [];
      let linkedCaseId: number | null = null;
      for (const f of files) {
        const { encrypted, iv, tag } = encryptFile(f.buffer);
        const cdnUrl = await uploadToCDN(
          encrypted,
          f.originalname + ".enc",
          "application/octet-stream",
          clientId,
        );
        // Resolve active case for this client to link the document
        const [caseRows] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM credit_repair_cases WHERE client_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
          [clientId],
        );
        const activeCaseId: number | null = caseRows[0]?.id ?? null;
        if (activeCaseId) linkedCaseId = activeCaseId;
        const [r] = await pool.query<ResultSetHeader>(
          `INSERT INTO client_documents
            (client_id, case_id, doc_type, file_name, file_size, mime_type, storage_provider, storage_key, encrypted, enc_iv, enc_tag, review_status)
           VALUES (?,?,?,?,?,?, 'cdn', ?, 1, ?, ?, 'pending')`,
          [
            clientId,
            activeCaseId,
            docType,
            f.originalname,
            f.size,
            f.mimetype,
            cdnUrl,
            iv,
            tag,
          ],
        );
        inserted.push({
          id: r.insertId,
          doc_type: docType,
          file_name: f.originalname,
          review_status: "pending",
        });
      }

      if (linkedCaseId) {
        const fileNames = inserted.map((d) => d.file_name).join(", ");
        try {
          await notifyAdminsClientSubmission({
            clientId,
            caseId: linkedCaseId,
            summary: `Uploaded ${inserted.length} file(s) as ${docType}: ${fileNames}`,
            allRequiredDone: false,
            kind: "doc_upload",
          });
        } catch (e: any) {
          console.error("[notify:admins-doc-upload]", e?.message ?? e);
        }
      }

      res.json({ ok: true, documents: inserted });
    },
  );

  app.get("/api/portal/contract", requireClient, async (_req, res) => {
    const [tpls] = await pool.query<RowDataPacket[]>(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'contract_template_html'`,
    );
    const html =
      (tpls[0]?.setting_value as string) ||
      "<h1>Optimum Credit — Service Agreement</h1><p>By signing below you authorize Optimum Credit Repair to act on your behalf in disputing inaccurate items on your credit reports with the major credit bureaus, in accordance with the Credit Repair Organizations Act (CROA) and applicable state laws.</p><p>You may cancel this agreement at any time without penalty within 5 business days of signing. After that, monthly service fees apply per your selected plan.</p>";
    res.json({ html });
  });

  app.post(
    "/api/portal/contract/sign",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const { signature_name, signature_data_url } = req.body || {};
      if (!signature_name || String(signature_name).trim().length < 2) {
        return res.status(400).json({ error: "Signature name required" });
      }
      const [tpls] = await pool.query<RowDataPacket[]>(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'contract_template_html'`,
      );
      const body =
        (tpls[0]?.setting_value as string) ||
        "<h1>Service Agreement</h1><p>Default agreement.</p>";
      await pool.query<ResultSetHeader>(
        `INSERT INTO client_contracts (client_id, version, body_html, signed_name, signed_ip, signed_at, signature_data_url)
       VALUES (?, '1.0', ?, ?, ?, NOW(), ?)`,
        [
          clientId,
          body,
          signature_name,
          req.ip || null,
          signature_data_url || null,
        ],
      );
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET contract_signed_at = NOW(), contract_signature_name = ?, contract_signature_ip = ? WHERE id = ?`,
        [signature_name, req.ip || null, clientId],
      );
      res.json({ ok: true, signed_at: new Date().toISOString() });
    },
  );

  app.put(
    "/api/portal/profile",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const { first_name, last_name, phone } = req.body || {};
      if (!first_name?.trim() || !last_name?.trim()) {
        return res
          .status(400)
          .json({ error: "First and last name are required" });
      }
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET first_name = ?, last_name = ?, phone = ? WHERE id = ?`,
        [first_name.trim(), last_name.trim(), phone?.trim() || null, clientId],
      );
      res.json({ ok: true });
    },
  );

  app.post(
    "/api/portal/smart-credit",
    requireClient,
    async (req: AuthedRequest, res) => {
      const { smart_credit_email } = req.body || {};
      if (!smart_credit_email)
        return res.status(400).json({ error: "Email required" });
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET smart_credit_email = ?, smart_credit_connected_at = NOW() WHERE id = ?`,
        [smart_credit_email, req.auth!.id],
      );
      res.json({ ok: true });
    },
  );

  app.put(
    "/api/portal/language",
    requireClient,
    async (req: AuthedRequest, res) => {
      const { language } = req.body || {};
      if (!["en", "es"].includes(language)) {
        return res
          .status(400)
          .json({ error: "Invalid language. Supported: en, es" });
      }
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET preferred_language = ? WHERE id = ?`,
        [language, req.auth!.id],
      );
      res.json({ ok: true, language });
    },
  );

  app.get(
    "/api/portal/tickets",
    requireClient,
    async (req: AuthedRequest, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, subject, body, category, priority, status, created_at, updated_at
       FROM support_tickets WHERE client_id = ? ORDER BY created_at DESC`,
        [req.auth!.id],
      );
      res.json({ tickets: rows });
    },
  );

  app.post(
    "/api/portal/tickets",
    requireClient,
    async (req: AuthedRequest, res) => {
      const { subject, body, category, priority } = req.body || {};
      if (!subject || !body)
        return res.status(400).json({ error: "Subject and body required" });
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO support_tickets (client_id, subject, body, category, priority) VALUES (?,?,?,?,?)`,
        [
          req.auth!.id,
          subject,
          body,
          category || "other",
          priority || "normal",
        ],
      );
      res.json({ id: r.insertId });
    },
  );

  app.post(
    "/api/portal/tickets/:id/replies",
    requireClient,
    async (req: AuthedRequest, res) => {
      const { id } = req.params;
      const { body } = req.body || {};
      if (!body) return res.status(400).json({ error: "Body required" });
      const [chk] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM support_tickets WHERE id = ? AND client_id = ? LIMIT 1`,
        [id, req.auth!.id],
      );
      if (chk.length === 0) return res.status(404).json({ error: "Not found" });
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO support_ticket_replies (ticket_id, author_type, author_client_id, body) VALUES (?, 'client', ?, ?)`,
        [id, req.auth!.id, body],
      );
      await pool.query<ResultSetHeader>(
        `UPDATE support_tickets SET status='open', updated_at=NOW() WHERE id = ?`,
        [id],
      );
      res.json({ id: r.insertId });
    },
  );

  // Support FAQ — public read for portal clients
  app.get("/api/portal/support-faq", requireClient, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, question, answer, category, sort_order FROM support_faq WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`,
    );
    res.json({ faqs: rows });
  });

  app.get(
    "/api/portal/ai-chat/sessions",
    requireClient,
    async (req: AuthedRequest, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, title, language, created_at, updated_at FROM ai_chat_sessions WHERE client_id = ? ORDER BY updated_at DESC`,
        [req.auth!.id],
      );
      res.json({ sessions: rows });
    },
  );

  app.get(
    "/api/portal/ai-chat/sessions/:id/messages",
    requireClient,
    async (req: AuthedRequest, res) => {
      const [chk] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM ai_chat_sessions WHERE id = ? AND client_id = ? LIMIT 1`,
        [req.params.id, req.auth!.id],
      );
      if (chk.length === 0) return res.status(404).json({ error: "Not found" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, role, content, created_at FROM ai_chat_messages WHERE session_id = ? ORDER BY id ASC`,
        [req.params.id],
      );
      res.json({ messages: rows });
    },
  );

  app.post(
    "/api/portal/ai-chat/message",
    requireClient,
    async (req: AuthedRequest, res) => {
      const { session_id, content, language } = req.body || {};
      if (!content) return res.status(400).json({ error: "Content required" });

      let sessionId = session_id ? Number(session_id) : null;
      if (!sessionId) {
        const [r] = await pool.query<ResultSetHeader>(
          `INSERT INTO ai_chat_sessions (client_id, title, language) VALUES (?,?,?)`,
          [req.auth!.id, String(content).slice(0, 80), language || "en"],
        );
        sessionId = r.insertId;
      }
      await pool.query<ResultSetHeader>(
        `INSERT INTO ai_chat_messages (session_id, role, content) VALUES (?, 'user', ?)`,
        [sessionId, content],
      );

      const text = String(content).toLowerCase();
      let reply =
        "Thanks for reaching out! I'll connect you with our team if I can't help directly — open a support ticket from the Support section anytime.";
      if (text.includes("how long") || text.includes("timeline")) {
        reply =
          "Most credit repair plans run for 5 monthly rounds. You'll see updates after each round in your portal, and we'll text you when a new report is ready.";
      } else if (text.includes("document") || text.includes("upload")) {
        reply =
          "You can upload your government ID (front and back), Social Security card, and proof of address from the My Documents section of your portal.";
      } else if (text.includes("score") || text.includes("credit")) {
        reply =
          "Your monthly progress reports show how your scores have moved across all three bureaus. Open the Reports section to see them.";
      }

      await pool.query<ResultSetHeader>(
        `INSERT INTO ai_chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`,
        [sessionId, reply],
      );
      await pool.query<ResultSetHeader>(
        `UPDATE ai_chat_sessions SET updated_at = NOW() WHERE id = ?`,
        [sessionId],
      );
      res.json({ session_id: sessionId, reply });
    },
  );

  app.get("/api/portal/videos", requireClient, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, title, content_type, description, video_url, file_url,
              thumbnail_url, duration_seconds, category, language
       FROM educational_videos WHERE is_published = 1 ORDER BY sort_order ASC, id DESC`,
    );
    res.json({ videos: rows });
  });

  app.get(
    "/api/portal/payments",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      try {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT
           p.id,
           pk.name                              AS package_name,
           pk.slug                              AS package_slug,
           p.amount_cents,
           COALESCE(p.discount_cents, 0)        AS discount_cents,
           p.original_amount_cents,
           p.currency,
           p.status,
           p.provider,
           c.code                               AS coupon_code,
           p.paid_at,
           p.created_at
         FROM payments p
         LEFT JOIN packages pk ON pk.id = p.package_id
         LEFT JOIN coupons   c ON  c.id = p.coupon_id
         WHERE p.client_id = ?
         ORDER BY p.created_at DESC`,
          [clientId],
        );
        const paymentIds = rows.map((r) => Number(r.id));
        const selMap = await fetchTradelineSelectionsForPayments(paymentIds);
        const payments = rows.map((r) => ({
          ...r,
          tradeline_items: selMap.get(Number(r.id)) ?? [],
        }));
        res.json({ payments });
      } catch (err) {
        console.error("GET /api/portal/payments error:", err);
        res.status(500).json({ error: "Failed to fetch payments" });
      }
    },
  );

  app.get(
    "/api/portal/peace-of-mind",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      try {
        const [clientRows] = await pool.query<RowDataPacket[]>(
          `SELECT pipeline_stage, anet_customer_profile_id, anet_payment_profile_id
           FROM clients WHERE id = ? LIMIT 1`,
          [clientId],
        );
        if (clientRows.length === 0) {
          return res.status(404).json({ error: "Client not found" });
        }
        const stage = clientRows[0].pipeline_stage as string;
        const eligible = stage === "completed";
        const hasStoredCard = !!(
          clientRows[0].anet_customer_profile_id &&
          clientRows[0].anet_payment_profile_id
        );

        const [pkgRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, slug, name, subtitle, description, price_cents, compare_price_cents,
                  billing_interval, checkout_type, duration_months, features_json, sort_order
           FROM packages
           WHERE slug = 'peace_of_mind' AND is_active = 1
           LIMIT 1`,
        );
        if (pkgRows.length === 0) {
          return res.status(404).json({ error: "Plan not available" });
        }

        const [subRows] = await pool.query<RowDataPacket[]>(
          `SELECT cs.id, cs.package_id, p.name AS package_name, p.slug AS package_slug,
                  cs.anet_subscription_id, cs.status, cs.amount_cents, cs.billing_interval,
                  cs.started_at, cs.cancelled_at, cs.next_billing_at
           FROM client_subscriptions cs
           JOIN packages p ON p.id = cs.package_id
           WHERE cs.client_id = ? AND cs.status = 'active'
           ORDER BY cs.id DESC
           LIMIT 1`,
          [clientId],
        );

        res.json({
          package: pkgRows[0],
          eligible,
          eligibility_reason: eligible
            ? undefined
            : "Available after your credit repair program is completed.",
          has_stored_card: hasStoredCard,
          subscription: subRows.length > 0 ? subRows[0] : null,
        });
      } catch (err) {
        console.error("GET /api/portal/peace-of-mind error:", err);
        res.status(500).json({ error: "Failed to load subscription plan" });
      }
    },
  );

  app.post(
    "/api/portal/peace-of-mind/subscribe",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const { dataDescriptor, dataValue, use_stored_card } = req.body || {};
      const useStored = !!use_stored_card;
      if (!useStored && (!dataDescriptor || !dataValue)) {
        return res.status(400).json({ error: "Missing payment token" });
      }
      if (!authorizeNetConfigured) {
        return res
          .status(503)
          .json({ error: "Payment provider not configured" });
      }

      try {
        const [clientRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, email, first_name, last_name, pipeline_stage,
                  anet_customer_profile_id, anet_payment_profile_id
           FROM clients WHERE id = ? LIMIT 1`,
          [clientId],
        );
        if (clientRows.length === 0) {
          return res.status(404).json({ error: "Client not found" });
        }
        const client = clientRows[0];
        if (client.pipeline_stage !== "completed") {
          return res.status(403).json({
            error:
              "Peace of Mind is available after you complete your credit repair program.",
          });
        }

        const [existingSub] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM client_subscriptions
           WHERE client_id = ? AND status = 'active' LIMIT 1`,
          [clientId],
        );
        if (existingSub.length > 0) {
          return res
            .status(409)
            .json({ error: "You already have an active subscription." });
        }

        const [pkgRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, name, price_cents FROM packages
           WHERE slug = 'peace_of_mind' AND is_active = 1 AND checkout_type = 'subscription'
           LIMIT 1`,
        );
        if (pkgRows.length === 0) {
          return res.status(404).json({ error: "Plan not available" });
        }
        const pkg = pkgRows[0];
        const amountCents = Number(pkg.price_cents);
        const amountDollars = (amountCents / 100).toFixed(2);

        let anetSubId: string;
        if (
          useStored &&
          client.anet_customer_profile_id &&
          client.anet_payment_profile_id
        ) {
          const r = await createARBSubscriptionFromProfile({
            customerProfileId: String(client.anet_customer_profile_id),
            customerPaymentProfileId: String(client.anet_payment_profile_id),
            amountDollars,
            clientId,
            email: String(client.email),
            subscriptionName: String(pkg.name),
          });
          anetSubId = r.subscriptionId;
        } else {
          const r = await createARBSubscription({
            amountDollars,
            dataDescriptor: String(dataDescriptor),
            dataValue: String(dataValue),
            clientId,
            email: String(client.email),
            firstName: String(client.first_name),
            lastName: String(client.last_name),
            subscriptionName: String(pkg.name),
          });
          anetSubId = r.subscriptionId;
        }

        const nextBilling = new Date();
        nextBilling.setMonth(nextBilling.getMonth() + 1);

        const [ins] = await pool.query<ResultSetHeader>(
          `INSERT INTO client_subscriptions
             (client_id, package_id, anet_subscription_id, status, amount_cents, billing_interval, next_billing_at)
           VALUES (?, ?, ?, 'active', ?, 'monthly', ?)`,
          [clientId, pkg.id, anetSubId, amountCents, anetDateYmd(nextBilling)],
        );

        sendPeaceOfMindSubscriptionEmail(clientId, "started").catch(() => {});

        res.json({
          ok: true,
          subscriptionId: ins.insertId,
          anetSubscriptionId: anetSubId,
        });
      } catch (e: any) {
        console.error("POST /api/portal/peace-of-mind/subscribe error:", e);
        res.status(402).json({ error: e.message || "Subscription failed" });
      }
    },
  );

  app.post(
    "/api/portal/peace-of-mind/cancel",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      if (!authorizeNetConfigured) {
        return res
          .status(503)
          .json({ error: "Payment provider not configured" });
      }

      try {
        const [subRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, anet_subscription_id FROM client_subscriptions
           WHERE client_id = ? AND status = 'active'
           ORDER BY id DESC LIMIT 1`,
          [clientId],
        );
        if (subRows.length === 0) {
          return res
            .status(404)
            .json({ error: "No active subscription found" });
        }
        const sub = subRows[0];

        await cancelARBSubscription(String(sub.anet_subscription_id));

        await pool.query<ResultSetHeader>(
          `UPDATE client_subscriptions
           SET status = 'cancelled', cancelled_at = NOW()
           WHERE id = ?`,
          [sub.id],
        );

        sendPeaceOfMindSubscriptionEmail(clientId, "cancelled").catch(() => {});

        res.json({ ok: true });
      } catch (e: any) {
        console.error("POST /api/portal/peace-of-mind/cancel error:", e);
        res.status(400).json({ error: e.message || "Cancellation failed" });
      }
    },
  );

  // ── Client: list own payment splits ────────────────────────────────────────
  app.get(
    "/api/portal/payment-splits",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      try {
        const [splits] = await pool.query<RowDataPacket[]>(
          `SELECT ps.id, cr.case_number, ps.label, ps.amount_cents, ps.currency,
                  ps.due_date, ps.status, ps.completion_source, ps.paid_at,
                  ps.send_payment_link, pst.token AS payment_token
           FROM payment_splits ps
           JOIN credit_repair_cases cr ON cr.id = ps.case_id
           LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
             AND (pst.expires_at > NOW() AND pst.used_at IS NULL)
           WHERE ps.client_id = ?
           ORDER BY ps.due_date ASC`,
          [clientId],
        );
        res.json({ splits });
      } catch (err) {
        console.error("GET /api/portal/payment-splits error:", err);
        res.status(500).json({ error: "Failed to fetch payment splits" });
      }
    },
  );

  // ============================================================================
  // PUBLIC PAYMENT PAGE  /api/pay/:token
  // No auth middleware — validated by the token itself
  // ============================================================================
  app.get("/api/pay/:token", async (req, res) => {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: "Missing token" });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT pst.id AS token_id, pst.split_id, pst.expires_at, pst.used_at,
              ps.id, ps.case_id, cr.case_number, ps.client_id,
              c.first_name AS client_first_name, c.last_name AS client_last_name,
              c.email AS client_email, c.preferred_language,
              c.anet_customer_profile_id, c.anet_payment_profile_id,
              ps.label, ps.amount_cents, ps.currency, ps.due_date,
              ps.status, ps.completion_source, ps.paid_at, ps.payments_id,
              ps.reminder_flow_id, ps.send_payment_link, ps.notes,
              ps.created_at, ps.updated_at
       FROM payment_split_tokens pst
       JOIN payment_splits ps ON ps.id = pst.split_id
       JOIN credit_repair_cases cr ON cr.id = ps.case_id
       JOIN clients c ON c.id = ps.client_id
       WHERE pst.token = ? LIMIT 1`,
      [token],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Payment link not found" });

    const row = rows[0];
    if (row.used_at)
      return res
        .status(410)
        .json({ error: "This payment link has already been used" });
    if (new Date(row.expires_at) < new Date())
      return res.status(410).json({ error: "This payment link has expired" });
    if (row.status === "paid")
      return res
        .status(410)
        .json({ error: "This split has already been paid" });
    if (row.status === "cancelled")
      return res.status(410).json({ error: "This payment has been cancelled" });

    const hasStoredCard = !!(
      row.anet_customer_profile_id && row.anet_payment_profile_id
    );

    res.json({
      split: {
        id: row.id,
        case_id: row.case_id,
        case_number: row.case_number,
        client_id: row.client_id,
        label: row.label,
        amount_cents: row.amount_cents,
        currency: row.currency,
        due_date: row.due_date,
        status: row.status,
        notes: row.notes,
        created_at: row.created_at,
      },
      client_first_name: row.client_first_name,
      client_last_name: row.client_last_name,
      has_stored_card: hasStoredCard,
      card_last4: null, // Authorize.net doesn't expose last4 without additional API call
      preferred_language: row.preferred_language,
    });
  });

  // ── POST /api/pay/:token — charge payment ─────────────────────────────────
  // Reserves the split (status pending → processing, guarded by an
  // affected-rows check under FOR UPDATE) BEFORE charging the card, so two
  // concurrent submits of the same link can't both charge — the loser gets
  // a 409 instead of a duplicate charge. The card is charged only after the
  // reservation commits (never inside the lock — Authorize.net round-trips
  // can take seconds and would hold the row lock the whole time). A
  // provisional `payments` row is inserted before the charge call so a
  // charge that succeeds but crashes before we can record it still has a
  // trace; on failure the split is released back to `pending` so the link
  // remains usable.
  app.post("/api/pay/:token", async (req, res) => {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: "Missing token" });

    if (
      hitRateLimit(rateLimitKey(req, `pay-token:${token}`), 8, 15 * 60 * 1000)
    ) {
      return res
        .status(429)
        .json({ error: "Too many attempts. Please try again later." });
    }

    const { method, data_descriptor, data_value } = req.body || {};
    if (!method || !["stored_profile", "new_card"].includes(method))
      return res
        .status(400)
        .json({ error: "method must be 'stored_profile' or 'new_card'" });
    if (method === "new_card" && (!data_descriptor || !data_value))
      return res.status(400).json({
        error: "data_descriptor and data_value required for new_card",
      });
    if (!authorizeNetConfigured) {
      return res.status(503).json({ error: "Payment provider not configured" });
    }

    // ── Step 1: reserve the split under a row lock ──────────────────────────
    const reserveConn = await pool.getConnection();
    let splitId: number;
    let caseId: number;
    let clientId: number;
    let amountCents: number;
    let currency: string;
    let label: string;
    let email: string;
    let firstName: string;
    let lastName: string;
    let anetCustomerProfileId: string | null;
    let anetPaymentProfileId: string | null;
    let paymentId: number;
    try {
      await reserveConn.beginTransaction();
      const [rows] = await reserveConn.query<RowDataPacket[]>(
        `SELECT pst.id AS token_id, pst.split_id, pst.expires_at, pst.used_at,
                ps.id AS split_id_direct, ps.case_id, ps.client_id,
                ps.label, ps.amount_cents, ps.currency, ps.status,
                c.first_name, c.last_name, c.email, c.preferred_language,
                c.anet_customer_profile_id, c.anet_payment_profile_id
         FROM payment_split_tokens pst
         JOIN payment_splits ps ON ps.id = pst.split_id
         JOIN clients c ON c.id = ps.client_id
         WHERE pst.token = ? LIMIT 1 FOR UPDATE`,
        [token],
      );
      if (rows.length === 0) {
        await reserveConn.rollback();
        return res.status(404).json({ error: "Payment link not found" });
      }
      const row = rows[0];

      if (row.used_at) {
        await reserveConn.rollback();
        return res
          .status(410)
          .json({ error: "This payment link has already been used" });
      }
      if (new Date(row.expires_at) < new Date()) {
        await reserveConn.rollback();
        return res.status(410).json({ error: "Payment link has expired" });
      }
      if (row.status === "paid") {
        await reserveConn.rollback();
        return res.status(410).json({ error: "Already paid" });
      }
      if (row.status === "cancelled") {
        await reserveConn.rollback();
        return res.status(410).json({ error: "Payment cancelled" });
      }
      if (row.status !== "pending") {
        // Already reserved by a concurrent request (status = 'processing').
        await reserveConn.rollback();
        return res.status(409).json({
          error:
            "This payment is already being processed. Please wait a moment.",
        });
      }

      splitId = row.split_id as number;
      caseId = row.case_id as number;
      clientId = row.client_id as number;
      amountCents = Number(row.amount_cents);
      currency = (row.currency as string) || "USD";
      label = row.label as string;
      email = row.email as string;
      firstName = row.first_name as string;
      lastName = row.last_name as string;
      anetCustomerProfileId = row.anet_customer_profile_id as string | null;
      anetPaymentProfileId = row.anet_payment_profile_id as string | null;

      if (
        method === "stored_profile" &&
        (!anetCustomerProfileId || !anetPaymentProfileId)
      ) {
        await reserveConn.rollback();
        return res
          .status(400)
          .json({ error: "No stored card on file. Please use a new card." });
      }

      const [reserveResult] = await reserveConn.query<ResultSetHeader>(
        `UPDATE payment_splits SET status = 'processing' WHERE id = ? AND status = 'pending'`,
        [splitId],
      );
      if (reserveResult.affectedRows === 0) {
        await reserveConn.rollback();
        return res.status(409).json({
          error:
            "This payment is already being processed. Please wait a moment.",
        });
      }

      const provisionalTxnId = `pending-${crypto.randomUUID()}`;
      const [payResult] = await reserveConn.query<ResultSetHeader>(
        `INSERT INTO payments
           (client_id, case_id, split_id, amount_cents, currency,
            status, provider, provider_transaction_id)
         VALUES (?, ?, ?, ?, ?, 'pending', 'authorize_net', ?)`,
        [clientId, caseId, splitId, amountCents, currency, provisionalTxnId],
      );
      paymentId = payResult.insertId;

      await reserveConn.commit();
    } catch (err) {
      await reserveConn.rollback();
      throw err;
    } finally {
      reserveConn.release();
    }

    // ── Step 2: charge the card OUTSIDE the lock ────────────────────────────
    const amountDollars = (amountCents / 100).toFixed(2);
    let chargeResult: { transactionId: string } | null = null;
    let chargeError: string | null = null;
    let newAnetProfile: {
      customerProfileId?: string;
      customerPaymentProfileId?: string;
    } | null = null;

    try {
      if (method === "stored_profile") {
        const payload = {
          createCustomerProfileTransactionRequest: {
            merchantAuthentication: {
              name: process.env.AUTHORIZENET_API_LOGIN_ID,
              transactionKey: process.env.AUTHORIZENET_TRANSACTION_KEY,
            },
            transaction: {
              profileTransAuthCapture: {
                amount: amountDollars,
                customerProfileId: anetCustomerProfileId,
                customerPaymentProfileId: anetPaymentProfileId,
                order: {
                  description: String(label).slice(0, 255),
                },
              },
            },
          },
        };

        const anetResp = await fetch(AUTHORIZENET_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const anetData = (await anetResp.json()) as any;

        const txResp =
          anetData?.createCustomerProfileTransactionResponse?.directResponse;
        if (!txResp) {
          console.error("[pay/token] CIM error:", JSON.stringify(anetData));
          chargeError = "Payment declined. Please try a different card.";
        } else {
          const parts = txResp.split(",");
          // Position 0: result code (1=approved, 2=declined, 3=error)
          if (parts[0] !== "1") {
            chargeError = parts[3] || "Payment declined";
          } else {
            chargeResult = { transactionId: parts[6] || `CIM-${Date.now()}` };
          }
        }
      } else {
        // new_card — charge via Accept.js nonce
        const result = await chargeCard({
          amountDollars,
          dataDescriptor: data_descriptor,
          dataValue: data_value,
          clientId,
          email,
          firstName,
          lastName,
        });
        if (!result.transactionId) {
          chargeError = "Payment failed";
        } else {
          chargeResult = { transactionId: result.transactionId };
          if (result.customerProfileId) {
            newAnetProfile = {
              customerProfileId: result.customerProfileId,
              customerPaymentProfileId: result.customerPaymentProfileId,
            };
          }
        }
      }
    } catch (e: any) {
      console.error("[pay/token] charge threw:", e?.message ?? e);
      chargeError = e?.message || "Payment failed";
    }

    // ── Step 3: settle the reservation based on the charge outcome ─────────
    if (!chargeResult) {
      await pool.query(
        `UPDATE payment_splits SET status = 'pending' WHERE id = ? AND status = 'processing'`,
        [splitId],
      );
      await pool.query(
        `UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?`,
        [chargeError || "Payment failed", paymentId],
      );
      return res.status(402).json({ error: chargeError || "Payment failed" });
    }

    if (newAnetProfile?.customerProfileId) {
      try {
        await pool.query(
          `UPDATE clients SET anet_customer_profile_id = ?, anet_payment_profile_id = ? WHERE id = ?`,
          [
            newAnetProfile.customerProfileId,
            newAnetProfile.customerPaymentProfileId ?? null,
            clientId,
          ],
        );
      } catch (e) {
        console.error("[pay/token] anet profile update failed:", e);
      }
    }

    await pool.query(
      `UPDATE payments SET status = 'succeeded', provider_transaction_id = ?, paid_at = NOW() WHERE id = ?`,
      [chargeResult.transactionId, paymentId],
    );
    await pool.query(
      `UPDATE payment_splits
       SET status = 'paid', completion_source = 'authorize_link', paid_at = NOW(), payments_id = ?
       WHERE id = ? AND status = 'processing'`,
      [paymentId, splitId],
    );
    await pool.query(
      `UPDATE payment_split_tokens SET used_at = NOW() WHERE split_id = ?`,
      [splitId],
    );

    // Affiliate commission for this split payment — guarded by payment_id
    // inside recordEnrollmentCommissions, so each split's own payment id
    // earns its own commission (no double-pay on retries).
    try {
      await recordEnrollmentCommissions(clientId, paymentId, amountCents);
    } catch (e: any) {
      console.error("[pay/token:record-commission]", e?.message ?? e);
    }

    // Cancel pending notifications for this split
    try {
      await pool.query(
        `UPDATE notification_queue SET status = 'cancelled'
         WHERE payload_json->>'$.split_id' = ? AND status = 'pending'`,
        [splitId],
      );
    } catch (e) {
      console.error("[pay/token] cancel notifications failed:", e);
    }

    try {
      await notifyAdminsPaymentByClientId({
        clientId,
        amountCents,
        caseId,
        packageOrLabel: label || "Installment",
        kind: "installment",
      });
    } catch (e: any) {
      console.error("[notify:admins-installment]", e?.message ?? e);
    }

    res.json({ ok: true, transaction_id: chargeResult.transactionId });
  });

  // ============================================================
  // ADMIN
  // ============================================================
  app.get(
    "/api/admin/dashboard",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const scope = await getAffiliateScope(req.auth!.id);
      if (scope && !scope.hasPortalAccess) {
        return res.status(403).json({
          error: "Affiliate subscription required",
          code: "affiliate_subscription_required",
        });
      }

      if (scope) {
        const ids = scope.scopedAffiliateIds;
        const [stages] = await pool.query<RowDataPacket[]>(
          `SELECT pipeline_stage, COUNT(*) AS count FROM clients
         WHERE affiliate_id IN (?) GROUP BY pipeline_stage`,
          [ids],
        );
        const [stats] = await pool.query<RowDataPacket[]>(
          `SELECT
          (SELECT COUNT(*) FROM clients WHERE affiliate_id IN (?) AND status = 'active') AS active_clients,
          (SELECT COUNT(*) FROM clients WHERE affiliate_id IN (?) AND status = 'prospect') AS pending_payments,
          0 AS pending_doc_reviews,
          0 AS open_tickets,
          0 AS revenue_cents_30d,
          (SELECT COUNT(*) FROM clients WHERE affiliate_id IN (?) AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS new_clients_30d,
          (SELECT COUNT(*) FROM clients WHERE affiliate_id IN (?) AND pipeline_stage = 'completed') AS completed_clients,
          0 AS avg_score_improvement`,
          [ids, ids, ids, ids],
        );
        const [recent] = await pool.query<RowDataPacket[]>(
          `SELECT c.id, c.first_name, c.last_name, c.email, c.pipeline_stage, c.status, c.created_at, p.name AS package_name
         FROM clients c LEFT JOIN packages p ON p.id = c.package_id
         WHERE c.affiliate_id IN (?)
         ORDER BY c.created_at DESC LIMIT 6`,
          [ids],
        );
        return res.json({
          stages,
          stats: stats[0] || {},
          recent_clients: recent,
          recent_tickets: [],
          recent_payments: [],
          upcoming_rounds: [],
          my_work_tasks: [],
        });
      }

      const [stages] = await pool.query<RowDataPacket[]>(
        `SELECT pipeline_stage, COUNT(*) AS count FROM clients GROUP BY pipeline_stage`,
      );
      const [stats] = await pool.query<RowDataPacket[]>(
        `SELECT
        (SELECT COUNT(*) FROM clients WHERE status = 'active' OR pipeline_stage NOT IN ('completed','cancelled')) AS active_clients,
        (SELECT COUNT(*) FROM clients WHERE status = 'pending_payment') AS pending_payments,
        (SELECT COUNT(*) FROM client_documents WHERE review_status = 'pending') AS pending_doc_reviews,
        (SELECT COUNT(*) FROM support_tickets WHERE status IN ('open','in_progress')) AS open_tickets,
        (SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE status = 'succeeded' AND paid_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS revenue_cents_30d,
        (SELECT COUNT(*) FROM clients WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS new_clients_30d,
        (SELECT COUNT(*) FROM clients WHERE pipeline_stage = 'completed') AS completed_clients,
        (SELECT COALESCE(ROUND(AVG(CAST(score_after AS SIGNED) - CAST(score_before AS SIGNED)),0),0)
           FROM client_round_reports
          WHERE score_before IS NOT NULL AND score_after IS NOT NULL) AS avg_score_improvement`,
      );
      const [recent] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.pipeline_stage, c.status, c.created_at, p.name AS package_name
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       ORDER BY c.created_at DESC LIMIT 6`,
      );
      const [recent_tickets] = await pool.query<RowDataPacket[]>(
        `SELECT t.id, t.subject, t.status, t.priority, t.category, t.created_at,
              c.first_name, c.last_name, c.id AS client_id
       FROM support_tickets t
       JOIN clients c ON c.id = t.client_id
       WHERE t.status IN ('open','in_progress','waiting_client')
       ORDER BY t.created_at DESC LIMIT 5`,
      );
      const [recent_payments] = await pool.query<RowDataPacket[]>(
        `SELECT p.id, p.amount_cents, p.status, p.paid_at, p.created_at,
              c.first_name, c.last_name, c.id AS client_id
       FROM payments p
       JOIN clients c ON c.id = p.client_id
       WHERE p.status = 'succeeded'
       ORDER BY p.paid_at DESC LIMIT 5`,
      );
      const [upcomingRounds] = await pool.query<RowDataPacket[]>(
        `SELECT r.case_id, cr.case_number, cr.client_id,
                c.first_name, c.last_name,
                r.round_number, r.target_date,
                DATEDIFF(r.target_date, CURDATE()) AS days_until
         FROM (
           SELECT case_id, 1 AS round_number, round_1_date AS target_date FROM case_round_schedules
           UNION ALL SELECT case_id, 2, round_2_date FROM case_round_schedules
           UNION ALL SELECT case_id, 3, round_3_date FROM case_round_schedules
           UNION ALL SELECT case_id, 4, round_4_date FROM case_round_schedules
           UNION ALL SELECT case_id, 5, round_5_date FROM case_round_schedules
         ) r
         JOIN credit_repair_cases cr ON cr.id = r.case_id AND cr.status = 'active'
         JOIN clients c ON c.id = cr.client_id
         WHERE r.target_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 21 DAY)
         ORDER BY r.target_date ASC, r.round_number ASC
         LIMIT 8`,
      );
      const adminId = req.auth!.id;
      const [myWorkTasks] = await pool.query<RowDataPacket[]>(
        `SELECT t.id, t.title, t.status, t.priority, t.due_at, t.case_id,
                cr.case_number, cr.client_id,
                c.first_name AS client_first_name, c.last_name AS client_last_name,
                CASE
                  WHEN t.due_at IS NULL THEN NULL
                  ELSE DATEDIFF(DATE(t.due_at), CURDATE())
                END AS days_until
         FROM admin_work_tasks t
         LEFT JOIN credit_repair_cases cr ON cr.id = t.case_id
         LEFT JOIN clients c ON c.id = cr.client_id
         WHERE t.assignee_admin_id = ?
           AND t.status <> 'done'
         ORDER BY
           (t.due_at IS NOT NULL AND DATE(t.due_at) < CURDATE()) DESC,
           t.due_at IS NULL ASC,
           t.due_at ASC,
           FIELD(t.priority,'urgent','high','medium','low'),
           t.id DESC
         LIMIT 8`,
        [adminId],
      );
      res.json({
        stages,
        stats: stats[0] || {},
        recent_clients: recent,
        recent_tickets,
        recent_payments,
        upcoming_rounds: upcomingRounds.map((r) => ({
          id: `${r.case_id}-r${r.round_number}`,
          case_id: r.case_id,
          case_number: r.case_number,
          client_id: r.client_id,
          first_name: r.first_name,
          last_name: r.last_name,
          round_number: Number(r.round_number),
          target_date: mysqlDateToYmd(r.target_date),
          days_until: Number(r.days_until),
        })),
        my_work_tasks: myWorkTasks.map((r) => {
          const daysUntil =
            r.days_until == null ? null : Number(r.days_until);
          return {
            id: Number(r.id),
            title: String(r.title),
            status: r.status as string,
            priority: r.priority as string,
            due_at: r.due_at ? new Date(r.due_at).toISOString() : null,
            case_id: r.case_id != null ? Number(r.case_id) : null,
            case_number: (r.case_number as string) || null,
            client_id: r.client_id != null ? Number(r.client_id) : null,
            client_first_name: (r.client_first_name as string) || null,
            client_last_name: (r.client_last_name as string) || null,
            days_until: daysUntil,
            overdue: daysUntil != null && daysUntil < 0,
          };
        }),
      });
    },
  );

  app.get(
    "/api/admin/clients",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const scope = await getAffiliateScope(req.auth!.id);
      if (scope && !scope.hasPortalAccess) {
        return res.status(403).json({ error: "Portal access required" });
      }
      const stage = req.query.stage as string | undefined;
      const search = req.query.search as string | undefined;
      const status = req.query.status as string | undefined;
      const language = req.query.language as string | undefined;
      const billing = req.query.billing as string | undefined;
      const joined_from = req.query.joined_from as string | undefined;
      const joined_to = req.query.joined_to as string | undefined;
      const has_notes = req.query.has_notes as string | undefined;
      const labelParam =
        (req.query.labels as string | undefined) ||
        (req.query.label as string | undefined);
      const labelSlugs = labelParam
        ? labelParam
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const limit = Math.min(
        parseInt((req.query.limit as string) || "200", 10),
        200,
      );
      const where: string[] = [];
      const args: any[] = [];
      if (stage) {
        where.push("c.pipeline_stage = ?");
        args.push(stage);
      }
      if (search) {
        where.push(
          "(c.email LIKE ? ESCAPE '!' OR c.first_name LIKE ? ESCAPE '!' OR c.last_name LIKE ? ESCAPE '!' OR CONCAT(c.first_name,' ',c.last_name) LIKE ? ESCAPE '!' OR c.phone LIKE ? ESCAPE '!')",
        );
        const s = likeContains(search);
        args.push(s, s, s, s, s);
      }
      if (status) {
        where.push("c.status = ?");
        args.push(status);
      }
      if (language === "en" || language === "es") {
        where.push("c.preferred_language = ?");
        args.push(language);
      }
      if (joined_from) {
        where.push("DATE(c.created_at) >= ?");
        args.push(joined_from);
      }
      if (joined_to) {
        where.push("DATE(c.created_at) <= ?");
        args.push(joined_to);
      }
      if (has_notes === "yes") {
        where.push("(c.admin_notes IS NOT NULL AND c.admin_notes != '')");
      } else if (has_notes === "no") {
        where.push("(c.admin_notes IS NULL OR c.admin_notes = '')");
      }
      if (billing === "overdue") {
        where.push(
          "EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id AND ps.status = 'overdue')",
        );
      } else if (billing === "split_plan") {
        where.push(
          "EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)",
        );
      } else if (billing === "paid_full") {
        where.push(
          "EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)" +
            " AND NOT EXISTS (SELECT 1 FROM payment_splits ps2 WHERE ps2.client_id = c.id AND ps2.status IN ('pending','overdue'))",
        );
      } else if (billing === "direct_paid") {
        where.push(
          "EXISTS (SELECT 1 FROM payments py WHERE py.client_id = c.id AND py.status = 'succeeded')" +
            " AND NOT EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)",
        );
      } else if (billing === "no_payment") {
        where.push(
          "NOT EXISTS (SELECT 1 FROM payments py WHERE py.client_id = c.id AND py.status = 'succeeded')" +
            " AND NOT EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)",
        );
      }
      if (labelSlugs.length > 0) {
        where.push(
          `EXISTS (SELECT 1 FROM client_labels cl JOIN labels l ON l.id = cl.label_id
                 WHERE cl.client_id = c.id AND l.slug IN (?))`,
        );
        args.push(labelSlugs);
      }
      if (scope) {
        where.push("c.affiliate_id IN (?)");
        args.push(scope.scopedAffiliateIds);
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
              c.status, c.admin_notes, c.created_at, c.preferred_language,
              c.assigned_admin_id, c.referral_category, c.referrer_id,
              p.name AS package_name, p.slug AS package_slug,
              COALESCE(pay_agg.total_paid_cents, 0)  AS total_paid_cents,
              COALESCE(pay_agg.payment_count,   0)   AS payment_count,
              COALESCE(sp_agg.splits_total,     0)   AS splits_total,
              COALESCE(sp_agg.splits_paid,      0)   AS splits_paid,
              COALESCE(sp_agg.splits_pending,   0)   AS splits_pending,
              COALESCE(sp_agg.splits_overdue,   0)   AS splits_overdue,
              COALESCE(sp_agg.splits_amount_cents, 0) AS splits_amount_cents,
              COALESCE(sp_agg.splits_paid_cents,   0) AS splits_paid_cents
       FROM clients c
       LEFT JOIN packages p ON p.id = c.package_id
       LEFT JOIN (
         SELECT client_id,
                SUM(amount_cents) AS total_paid_cents,
                COUNT(*)          AS payment_count
         FROM payments WHERE status = 'succeeded'
         GROUP BY client_id
       ) pay_agg ON pay_agg.client_id = c.id
       LEFT JOIN (
         SELECT client_id,
                COUNT(*)                                                        AS splits_total,
                SUM(status = 'paid')                                            AS splits_paid,
                SUM(status IN ('pending','overdue'))                            AS splits_pending,
                SUM(status = 'overdue')                                         AS splits_overdue,
                SUM(amount_cents)                                               AS splits_amount_cents,
                SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END)    AS splits_paid_cents
         FROM payment_splits
         GROUP BY client_id
       ) sp_agg ON sp_agg.client_id = c.id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY c.created_at DESC LIMIT ${limit}`,
        args,
      );
      if (rows.length > 0) {
        const ids = rows.map((r) => r.id as number);
        const [labelRows] = await pool.query<RowDataPacket[]>(
          `SELECT cl.client_id, l.* FROM client_labels cl
         JOIN labels l ON l.id = cl.label_id
         WHERE cl.client_id IN (?)
         ORDER BY l.layer ASC, l.sort_order ASC, l.id ASC`,
          [ids],
        );
        const byClient = new Map<number, Label[]>();
        for (const lr of labelRows) {
          const cid = lr.client_id as number;
          const { client_id, ...label } = lr as any;
          if (!byClient.has(cid)) byClient.set(cid, []);
          byClient.get(cid)!.push(label as Label);
        }
        for (const r of rows) {
          (r as any).labels = byClient.get(r.id as number) ?? [];
        }
      }
      res.json({ clients: rows });
    },
  );

  app.get(
    "/api/admin/clients/:id",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const scope = await getAffiliateScope(req.auth!.id);
      if (scope && !scope.hasPortalAccess) {
        return res.status(403).json({ error: "Portal access required" });
      }
      if (scope && !(await assertClientInAffiliateScope(id, scope))) {
        return res.status(404).json({ error: "Not found" });
      }
      const [c] = await pool.query<RowDataPacket[]>(
        `SELECT c.*, p.name AS package_name, p.slug AS package_slug, p.price_cents AS package_price_cents
       FROM clients c LEFT JOIN packages p ON p.id = c.package_id
       WHERE c.id = ? LIMIT 1`,
        [id],
      );
      if (c.length === 0) return res.status(404).json({ error: "Not found" });
      const [docs] = await pool.query<RowDataPacket[]>(
        `SELECT id, doc_type, pipeline_round, file_name, file_size, mime_type, review_status, rejection_reason, uploaded_at, reviewed_at
       FROM client_documents WHERE client_id = ? ORDER BY uploaded_at DESC`,
        [id],
      );
      const [reports] = await pool.query<RowDataPacket[]>(
        `SELECT id, round_number, score_before, score_after, items_removed, items_disputed, summary_md,
              bureau_scores_json, wins_json, targets_json, file_strength_score,
              pdf_file_name, (pdf_storage_key IS NOT NULL) AS has_pdf, pdf_uploaded_at, created_at
       FROM client_round_reports WHERE client_id = ? ORDER BY round_number DESC`,
        [id],
      );
      await attachPdfsToReports(Number(id), reports);
      const [payments] = await pool.query<RowDataPacket[]>(
        `SELECT p.id, p.amount_cents, p.status, p.paid_at, p.created_at, p.provider_transaction_id,
              pk.name AS package_name, pk.slug AS package_slug
       FROM payments p
       LEFT JOIN packages pk ON pk.id = p.package_id
       WHERE p.client_id = ? ORDER BY p.created_at DESC`,
        [id],
      );
      const paymentIds = payments.map((p) => Number(p.id));
      const selMap = await fetchTradelineSelectionsForPayments(paymentIds);
      const paymentsWithLines = payments.map((p) => ({
        ...p,
        tradeline_items: selMap.get(Number(p.id)) ?? [],
      }));

      const [subscriptions] = await pool.query<RowDataPacket[]>(
        `SELECT cs.*, p.name AS package_name, p.slug AS package_slug
       FROM client_subscriptions cs
       JOIN packages p ON p.id = cs.package_id
       WHERE cs.client_id = ?
       ORDER BY cs.created_at DESC`,
        [id],
      );

      const [pipeline] = await pool.query<RowDataPacket[]>(
        `SELECT id, from_stage, to_stage, notes, created_at FROM client_pipeline_history WHERE client_id = ? ORDER BY created_at DESC`,
        [id],
      );
      res.json({
        client: c[0],
        documents: docs,
        reports,
        payments: paymentsWithLines,
        subscriptions,
        pipeline_history: pipeline,
      });
    },
  );

  app.get(
    "/api/admin/pipeline",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const scope = await getAffiliateScope(req.auth!.id);
      if (scope && !scope.hasPortalAccess) {
        return res.status(403).json({ error: "Portal access required" });
      }

      const search = (req.query.search as string | undefined)?.trim();
      const language = req.query.language as string | undefined;
      const billing = req.query.billing as string | undefined;
      const packageIdRaw = req.query.package_id as string | undefined;
      const assignedRaw = req.query.assigned_admin_id as string | undefined;
      const referralCategory = req.query.referral_category as
        | string
        | undefined;
      const clientStatus = req.query.client_status as string | undefined;
      const caseStatus = req.query.case_status as string | undefined;
      const stage = req.query.stage as string | undefined;
      const paymentBadge = req.query.payment_badge as string | undefined;
      const tasksFilter = req.query.tasks as string | undefined;
      const infoRequests = req.query.info_requests as string | undefined;
      const hasNotes = req.query.has_notes as string | undefined;
      const labelParam =
        (req.query.labels as string | undefined) ||
        (req.query.label as string | undefined);
      const labelSlugs = labelParam
        ? labelParam
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      // Prospect-stage cases live in the Prospect column (via clients.status),
      // not as Kanban case cards — exclude them from the cases array.
      const caseWhere: string[] = [
        "cr.status NOT IN ('cancelled')",
        "cr.pipeline_stage <> 'prospect'",
      ];
      const caseArgs: any[] = [];
      const prospectWhere: string[] = [];
      const prospectArgs: any[] = [];

      if (scope) {
        caseWhere.push("c.affiliate_id IN (?)");
        caseArgs.push(scope.scopedAffiliateIds);
      }

      // Shared client-level filters (cases + prospects)
      const pushClientFilter = (sql: string, ...vals: any[]) => {
        caseWhere.push(sql);
        caseArgs.push(...vals);
        prospectWhere.push(sql);
        prospectArgs.push(...vals);
      };

      if (search) {
        const s = likeContains(search);
        caseWhere.push(
          `(c.email LIKE ? ESCAPE '!' OR c.first_name LIKE ? ESCAPE '!' OR c.last_name LIKE ? ESCAPE '!'
            OR CONCAT(c.first_name,' ',c.last_name) LIKE ? ESCAPE '!' OR c.phone LIKE ? ESCAPE '!'
            OR cr.case_number LIKE ? ESCAPE '!')`,
        );
        caseArgs.push(s, s, s, s, s, s);
        prospectWhere.push(
          `(c.email LIKE ? ESCAPE '!' OR c.first_name LIKE ? ESCAPE '!' OR c.last_name LIKE ? ESCAPE '!'
            OR CONCAT(c.first_name,' ',c.last_name) LIKE ? ESCAPE '!' OR c.phone LIKE ? ESCAPE '!')`,
        );
        prospectArgs.push(s, s, s, s, s);
      }

      if (language === "en" || language === "es") {
        pushClientFilter("c.preferred_language = ?", language);
      }

      if (clientStatus) {
        pushClientFilter("c.status = ?", clientStatus);
      }

      if (hasNotes === "yes") {
        pushClientFilter(
          "(c.admin_notes IS NOT NULL AND c.admin_notes != '')",
        );
      } else if (hasNotes === "no") {
        pushClientFilter("(c.admin_notes IS NULL OR c.admin_notes = '')");
      }

      if (billing === "overdue") {
        pushClientFilter(
          "EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id AND ps.status = 'overdue')",
        );
      } else if (billing === "split_plan") {
        pushClientFilter(
          "EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)",
        );
      } else if (billing === "paid_full") {
        pushClientFilter(
          "EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)" +
            " AND NOT EXISTS (SELECT 1 FROM payment_splits ps2 WHERE ps2.client_id = c.id AND ps2.status IN ('pending','overdue'))",
        );
      } else if (billing === "direct_paid") {
        pushClientFilter(
          "EXISTS (SELECT 1 FROM payments py WHERE py.client_id = c.id AND py.status = 'succeeded')" +
            " AND NOT EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)",
        );
      } else if (billing === "no_payment") {
        pushClientFilter(
          "NOT EXISTS (SELECT 1 FROM payments py WHERE py.client_id = c.id AND py.status = 'succeeded')" +
            " AND NOT EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id)",
        );
      }

      if (labelSlugs.length > 0) {
        pushClientFilter(
          `EXISTS (SELECT 1 FROM client_labels cl JOIN labels l ON l.id = cl.label_id
                 WHERE cl.client_id = c.id AND l.slug IN (?))`,
          labelSlugs,
        );
      }

      if (
        referralCategory === "realtor_broker" ||
        referralCategory === "one_off" ||
        referralCategory === "affiliate_partner"
      ) {
        pushClientFilter("c.referral_category = ?", referralCategory);
      }

      if (assignedRaw === "unassigned" || assignedRaw === "0") {
        pushClientFilter("c.assigned_admin_id IS NULL");
      } else if (assignedRaw) {
        const aid = Number(assignedRaw);
        if (aid > 0) pushClientFilter("c.assigned_admin_id = ?", aid);
      }

      // Paid badge: real money received (succeeded payment or paid split)
      const paidExpr =
        "(EXISTS (SELECT 1 FROM payments py WHERE py.client_id = c.id AND py.status = 'succeeded')" +
        " OR EXISTS (SELECT 1 FROM payment_splits ps WHERE ps.client_id = c.id AND ps.status = 'paid'))";
      if (paymentBadge === "paid") {
        pushClientFilter(paidExpr);
      } else if (paymentBadge === "unpaid") {
        pushClientFilter(`NOT ${paidExpr}`);
      }

      // Case-only filters
      if (packageIdRaw === "none" || packageIdRaw === "0") {
        caseWhere.push("cr.package_id IS NULL");
      } else if (packageIdRaw) {
        const pid = Number(packageIdRaw);
        if (pid > 0) {
          caseWhere.push("cr.package_id = ?");
          caseArgs.push(pid);
        }
      }

      if (
        caseStatus === "active" ||
        caseStatus === "completed" ||
        caseStatus === "on_hold"
      ) {
        caseWhere.push("cr.status = ?");
        caseArgs.push(caseStatus);
      }

      if (stage && stage !== "prospect" && stage !== "all") {
        caseWhere.push("cr.pipeline_stage = ?");
        caseArgs.push(stage);
      }

      if (tasksFilter === "incomplete") {
        caseWhere.push(
          "COALESCE(ts.tasks_approved, 0) < (SELECT COUNT(*) FROM onboarding_task_templates WHERE is_active = 1 AND is_required = 1)",
        );
      } else if (tasksFilter === "complete") {
        caseWhere.push(
          "COALESCE(ts.tasks_approved, 0) >= (SELECT COUNT(*) FROM onboarding_task_templates WHERE is_active = 1 AND is_required = 1)",
        );
      } else if (tasksFilter === "pending_review") {
        caseWhere.push("COALESCE(ts.tasks_pending_review, 0) > 0");
      } else if (tasksFilter === "rejected") {
        caseWhere.push("COALESCE(ts.tasks_rejected, 0) > 0");
      }

      if (infoRequests === "open") {
        caseWhere.push(
          "(COALESCE(ir.info_requests_open, 0) + COALESCE(ir.info_requests_pending_review, 0)) > 0",
        );
      } else if (infoRequests === "none") {
        caseWhere.push(
          "(COALESCE(ir.info_requests_open, 0) + COALESCE(ir.info_requests_pending_review, 0)) = 0",
        );
      }

      const includeCases = stage !== "prospect";
      const includeProspects =
        !stage || stage === "all" || stage === "prospect";

      let rows: RowDataPacket[] = [];
      if (includeCases) {
        const [caseRows] = await pool.query<RowDataPacket[]>(
          `SELECT cr.id, cr.case_number, cr.client_id, cr.pipeline_stage,
                cr.pipeline_stage_changed_at, cr.status, cr.created_at,
                c.first_name, c.last_name, c.email, c.phone,
                c.status AS client_status, c.preferred_language,
                c.assigned_admin_id, c.referral_category,
                c.crc_client_id, c.crc_synced_at,
                p.name AS package_name, p.slug AS package_slug,
                (SELECT COUNT(*) FROM onboarding_task_templates
                 WHERE is_active = 1) AS tasks_total,
                (SELECT COUNT(*) FROM onboarding_task_templates
                 WHERE is_active = 1 AND is_required = 1) AS tasks_required_total,
                COALESCE(ts.tasks_approved,      0) AS tasks_approved,
                COALESCE(ts.tasks_pending_review,0) AS tasks_pending_review,
                COALESCE(ts.tasks_rejected,      0) AS tasks_rejected,
                COALESCE(ir.info_requests_open, 0) AS info_requests_open,
                COALESCE(ir.info_requests_pending_review, 0) AS info_requests_pending_review,
                GREATEST(
                  (SELECT COUNT(*) FROM credit_repair_cases cr2
                   WHERE cr2.client_id = cr.client_id
                     AND cr2.status = 'active'
                     AND cr2.id != cr.id),
                  0
                ) AS sibling_active_cases,
                (
                  EXISTS (
                    SELECT 1 FROM payments py
                    WHERE py.client_id = c.id AND py.status = 'succeeded'
                  )
                  OR EXISTS (
                    SELECT 1 FROM payment_splits ps
                    WHERE ps.client_id = c.id AND ps.status = 'paid'
                  )
                ) AS is_payment_received
         FROM credit_repair_cases cr
         JOIN clients c ON c.id = cr.client_id
         LEFT JOIN packages p ON p.id = cr.package_id
         LEFT JOIN (
           SELECT ctc.case_id,
             SUM(CASE WHEN ctc.admin_review_status = 'approved'  THEN 1 ELSE 0 END) AS tasks_approved,
             SUM(CASE WHEN ctc.status = 'completed'
                       AND ctc.admin_review_status = 'pending'  THEN 1 ELSE 0 END) AS tasks_pending_review,
             SUM(CASE WHEN ctc.admin_review_status = 'rejected'  THEN 1 ELSE 0 END) AS tasks_rejected
           FROM client_task_completions ctc
           JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id AND ott.is_active = 1
           GROUP BY ctc.case_id
         ) ts ON ts.case_id = cr.id
         LEFT JOIN (
           SELECT case_id,
             SUM(CASE WHEN status IN ('open','rejected') THEN 1 ELSE 0 END) AS info_requests_open,
             SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS info_requests_pending_review
           FROM client_info_requests
           GROUP BY case_id
         ) ir ON ir.case_id = cr.id
         WHERE ${caseWhere.join(" AND ")}
         ORDER BY cr.pipeline_stage_changed_at DESC, cr.created_at DESC`,
          caseArgs,
        );
        rows = caseRows;
        await attachLabelsToRows(rows, "client_id");
      }

      // Case-only filters that don't apply to prospects: skip prospects when set
      const prospectIncompatible =
        !!(
          packageIdRaw ||
          caseStatus ||
          tasksFilter ||
          infoRequests ||
          (stage && stage !== "all" && stage !== "prospect")
        );

      let prospectRows: RowDataPacket[] = [];
      if (includeProspects && !prospectIncompatible) {
        prospectRows = await fetchProspectsWithLabels(
          scope?.scopedAffiliateIds,
          { where: prospectWhere, args: prospectArgs },
        );
      } else if (includeProspects && stage === "prospect") {
        prospectRows = await fetchProspectsWithLabels(
          scope?.scopedAffiliateIds,
          { where: prospectWhere, args: prospectArgs },
        );
      }

      res.json({ cases: rows, prospects: prospectRows });
    },
  );

  // ── Labels (source + analysis) ────────────────────────────────────────────
  app.get("/api/admin/labels", requireAdmin, async (req, res) => {
    const layer = req.query.layer as string | undefined;
    const validLayer = layer === "source" || layer === "analysis";
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM labels ${validLayer ? "WHERE layer = ?" : ""}
       ORDER BY layer ASC, sort_order ASC, id ASC`,
      validLayer ? [layer] : [],
    );
    res.json({ labels: rows });
  });

  // ── Attach/remove labels on a client (merge, by slug) ─────────────────────
  app.post(
    "/api/admin/clients/:id/labels",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const clientId = Number(req.params.id);
      if (!clientId || isNaN(clientId))
        return res.status(400).json({ error: "Invalid client id" });
      const [clientRows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM clients WHERE id = ? LIMIT 1`,
        [clientId],
      );
      if (clientRows.length === 0)
        return res.status(404).json({ error: "Client not found" });
      const scope = await getAffiliateScope(req.auth!.id);
      if (scope && !(await assertClientInAffiliateScope(clientId, scope))) {
        return res.status(404).json({ error: "Client not found" });
      }

      const { add, remove } = req.body || {};
      const addSlugs: string[] = Array.isArray(add)
        ? add.filter((s) => typeof s === "string" && s.trim())
        : [];
      const removeSlugs: string[] = Array.isArray(remove)
        ? remove.filter((s) => typeof s === "string" && s.trim())
        : [];

      if (addSlugs.length > 0) await attachLabelsBySlug(clientId, addSlugs);
      if (removeSlugs.length > 0) {
        const [labelRows] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM labels WHERE slug IN (?)`,
          [removeSlugs],
        );
        if (labelRows.length > 0) {
          await pool.query<ResultSetHeader>(
            `DELETE FROM client_labels WHERE client_id = ? AND label_id IN (?)`,
            [clientId, labelRows.map((l) => l.id)],
          );
        }
      }
      const labels = await getClientLabels(clientId);
      res.json({ labels });
    },
  );

  // ── Prospects list ─────────────────────────────────────────────────────────
  app.get(
    "/api/admin/prospects",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const scope = await getAffiliateScope(req.auth!.id);
      if (scope && !scope.hasPortalAccess) {
        return res.status(403).json({ error: "Portal access required" });
      }
      const prospects = await fetchProspectsWithLabels(
        scope?.scopedAffiliateIds,
      );
      res.json({ prospects });
    },
  );

  // ── Convert a prospect into a client + case (5A/7A) ────────────────────────
  app.post(
    "/api/admin/prospects/:id/convert",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const clientId = Number(req.params.id);
      if (!clientId || isNaN(clientId))
        return res.status(400).json({ error: "Invalid prospect id" });

      const scope = await getAffiliateScope(req.auth!.id);
      if (scope && !scope.hasPortalAccess) {
        return res.status(403).json({ error: "Portal access required" });
      }
      if (scope && !(await assertClientInAffiliateScope(clientId, scope))) {
        return res.status(404).json({ error: "Prospect not found" });
      }

      const { package_id, notes, round_schedule } = req.body || {};

      const [clientRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, first_name, last_name, email, status, preferred_language
         FROM clients WHERE id = ? LIMIT 1`,
        [clientId],
      );
      if (clientRows.length === 0)
        return res.status(404).json({ error: "Prospect not found" });
      const client = clientRows[0];
      if (client.status !== "prospect") {
        return res.status(409).json({ error: "This client is not a prospect" });
      }

      // Prefer promoting an existing prospect-stage case (New Case → Prospect)
      // over inserting a duplicate case on convert.
      const [existingCases] = await pool.query<RowDataPacket[]>(
        `SELECT id, case_number, pipeline_stage
         FROM credit_repair_cases
         WHERE client_id = ? AND status = 'active'
         ORDER BY id DESC`,
        [clientId],
      );
      const prospectCase = existingCases.find(
        (r) => r.pipeline_stage === "prospect",
      );
      if (existingCases.length > 0 && !prospectCase) {
        return res.status(409).json({
          error: `Prospect already has an active case (${existingCases[0].case_number}) past Prospect stage.`,
          existing_cases: existingCases,
        });
      }

      const conn = await pool.getConnection();
      let caseId: number;
      let caseNumber: string;
      try {
        await conn.beginTransaction();

        await conn.query<ResultSetHeader>(
          `UPDATE clients
           SET status = 'onboarding', pipeline_stage = 'new_client',
               pipeline_stage_changed_at = NOW(),
               package_id = COALESCE(?, package_id),
               admin_notes = CASE WHEN ? IS NOT NULL
                 THEN CONCAT(COALESCE(admin_notes, ''), CASE WHEN admin_notes IS NULL OR admin_notes = '' THEN '' ELSE '\n' END, ?)
                 ELSE admin_notes END
           WHERE id = ?`,
          [
            package_id ? Number(package_id) : null,
            notes || null,
            notes || null,
            clientId,
          ],
        );

        if (prospectCase) {
          caseId = Number(prospectCase.id);
          caseNumber =
            (prospectCase.case_number as string) ||
            `CR-${String(caseId).padStart(5, "0")}`;
          await conn.query<ResultSetHeader>(
            `UPDATE credit_repair_cases
             SET pipeline_stage = 'new_client',
                 pipeline_stage_changed_at = NOW(),
                 package_id = COALESCE(?, package_id),
                 notes = COALESCE(?, notes),
                 case_number = COALESCE(case_number, ?)
             WHERE id = ?`,
            [
              package_id ? Number(package_id) : null,
              notes || null,
              caseNumber,
              caseId,
            ],
          );
          // Cancel any extra active prospect-stage cases (allow_duplicate leftovers)
          await conn.query<ResultSetHeader>(
            `UPDATE credit_repair_cases
             SET status = 'cancelled',
                 pipeline_stage_changed_at = NOW()
             WHERE client_id = ? AND status = 'active'
               AND pipeline_stage = 'prospect' AND id <> ?`,
            [clientId, caseId],
          );
        } else {
          const [caseResult] = await conn.query<ResultSetHeader>(
            `INSERT INTO credit_repair_cases (client_id, package_id, pipeline_stage, status, notes)
             VALUES (?, ?, 'new_client', 'active', ?)`,
            [clientId, package_id ? Number(package_id) : null, notes || null],
          );
          caseId = caseResult.insertId;
          caseNumber = `CR-${String(caseId).padStart(5, "0")}`;
          await conn.query(
            `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
            [caseNumber, caseId],
          );
        }

        await conn.query<ResultSetHeader>(
          `INSERT INTO client_pipeline_history (client_id, from_stage, to_stage, changed_by_admin_id, notes)
           VALUES (?, 'prospect', 'new_client', ?, ?)`,
          [clientId, req.auth!.id, "Converted from prospect"],
        );

        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }

      autoAssignTasksForCase(clientId, caseId).catch((e) =>
        console.error(
          "[prospects:convert] autoAssignTasks failed:",
          e?.message,
        ),
      );

      // Schedule Day 2/3 upload nudges + team alert (skip Day 0 — convert welcome
      // already covers first contact without "payment confirmed" copy).
      triggerReminderFlow("payment_confirmed", clientId, undefined, {
        skipImmediateSteps: true,
      }).catch((e) =>
        console.error(
          "[prospects:convert] payment_confirmed flow failed:",
          e?.message,
        ),
      );

      const clientName = `${client.first_name} ${client.last_name}`.trim();
      let calendarResult: any = null;
      try {
        calendarResult = await persistAndMaybeSendRoundSchedule({
          caseId,
          clientId,
          caseNumber,
          clientName,
          scheduleInput: round_schedule,
        });
        if (calendarResult?.error) {
          console.warn(
            "[prospects:convert] round schedule:",
            calendarResult.error,
          );
        }
      } catch (e: any) {
        console.error(
          "[prospects:convert] round schedule failed:",
          e?.message,
        );
      }

      const lang = (client.preferred_language as string) || "en";
      // Welcome email is best-effort — don't block the convert response on SMTP.
      if (client.email) {
        (async () => {
          try {
            const token = await createOnboardingToken(clientId);
            const portalUrl = `${APP_URL}/portal/onboarding/${token}`;
            const tpl = tplProspectConvertWelcome({
              firstName: client.first_name as string,
              caseNumber,
              portalUrl,
              lang,
            });
            await sendEmail({
              to: client.email as string,
              subject: tpl.subject,
              html: tpl.html,
            });
            await notifyLanguageOwnerDocUploadLink({
              clientId,
              firstName: client.first_name as string,
              lastName: client.last_name as string,
              clientEmail: client.email as string,
              lang,
              portalUrl,
              caseId,
            });
          } catch (e: any) {
            console.error(
              "[prospects:convert] welcome email failed:",
              e?.message,
            );
          }
        })();
      } else {
        console.warn(
          `[prospects:convert] Skipping welcome email — client ${clientId} has no email`,
        );
      }

      crcSyncClient(clientId).catch((e) =>
        console.error("[crc:convert-sync]", e?.message),
      );

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
                c.pipeline_stage_changed_at, c.status, c.created_at, c.preferred_language,
                p.name AS package_name, p.slug AS package_slug
         FROM clients c LEFT JOIN packages p ON p.id = c.package_id
         WHERE c.id = ? LIMIT 1`,
        [clientId],
      );
      (rows[0] as any).labels = await getClientLabels(clientId);

      res.json({
        client: rows[0],
        case: { id: caseId, case_number: caseNumber },
        round_calendar: calendarResult?.saved
          ? {
              saved: true,
              sent_to: calendarResult.sent?.sent_to ?? [],
              send_errors: calendarResult.sent?.errors ?? [],
              error: calendarResult.error ?? null,
            }
          : null,
      });
    },
  );

  // ── Create case manually (admin) ──────────────────────────────────────────
  app.post(
    "/api/admin/cases",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const {
        client_id,
        package_id,
        pipeline_stage,
        notes,
        send_case_email,
        splits,
        round_schedule,
      } = req.body || {};
      if (!client_id)
        return res.status(400).json({ error: "client_id is required" });
      const cId = Number(client_id);
      if (!cId || isNaN(cId))
        return res.status(400).json({ error: "Invalid client_id" });

      const [clientRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, first_name, last_name, email, preferred_language,
              anet_customer_profile_id, status
       FROM clients WHERE id = ? LIMIT 1`,
        [cId],
      );
      if (clientRows.length === 0)
        return res.status(404).json({ error: "Client not found" });
      const client = clientRows[0];

      // New Case only starts at Prospect or New Client — later stages must be
      // reached via convert / task approval / board moves (avoids mid-pipeline
      // cases with 0/N tasks, e.g. created straight into docs_ready).
      const ALLOWED_CREATE_STAGES = ["prospect", "new_client"];
      const stage = pipeline_stage || "new_client";
      if (!ALLOWED_CREATE_STAGES.includes(stage)) {
        return res.status(400).json({
          error:
            "Invalid pipeline_stage. New Case only allows prospect or new_client; advance later stages from the Pipeline board after tasks are complete.",
        });
      }

      // Prospect stage: create a case while the lead stays a prospect (no convert).
      // Any other stage for a prospect must go through convert.
      if (client.status === "prospect" && stage !== "prospect") {
        return res.status(409).json({
          error:
            "This client is a prospect. Use POST /api/admin/prospects/:id/convert to move them to New Client, or create a case with pipeline_stage=prospect.",
        });
      }
      if (client.status !== "prospect" && stage === "prospect") {
        return res.status(409).json({
          error:
            "pipeline_stage=prospect is only valid for clients with status=prospect.",
        });
      }

      const [activeCases] = await pool.query<RowDataPacket[]>(
        `SELECT id, case_number, pipeline_stage
       FROM credit_repair_cases
       WHERE client_id = ? AND status = 'active'
       ORDER BY id DESC`,
        [cId],
      );
      if (activeCases.length > 0 && !req.body?.allow_duplicate) {
        return res.status(409).json({
          error: `Client already has an active case (${activeCases[0].case_number}). Cancel or complete it before creating another, or pass allow_duplicate: true.`,
          existing_cases: activeCases,
        });
      }

      const isProspectStageCase = stage === "prospect";
      // Prospect-stage cases stay leads — ignore convert-time fields even if
      // a client/API caller sends them (package/calendar/splits belong on convert).
      const effectiveNotes = isProspectStageCase ? null : notes || null;
      const effectivePackageId = isProspectStageCase
        ? null
        : package_id
          ? Number(package_id)
          : null;
      const effectiveSendCaseEmail = isProspectStageCase
        ? false
        : !!send_case_email;
      const effectiveRoundSchedule = isProspectStageCase
        ? null
        : round_schedule;
      const splitDefs: any[] = isProspectStageCase
        ? []
        : Array.isArray(splits)
          ? splits
          : [];

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        // Insert case
        const [caseResult] = await conn.query<ResultSetHeader>(
          `INSERT INTO credit_repair_cases (client_id, package_id, pipeline_stage, notes)
         VALUES (?, ?, ?, ?)`,
          [cId, effectivePackageId, stage, effectiveNotes],
        );
        const caseId = caseResult.insertId;

        // Generate case number CR-XXXXXX
        const caseNumber = `CR-${String(caseId).padStart(6, "0")}`;
        await conn.query(
          `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
          [caseNumber, caseId],
        );

        // Insert splits if provided
        const insertedSplits: Array<{
          id: number;
          token: string | null;
          label: string;
          amount_cents: number;
          due_date: Date;
          flow_id: number | null;
          send_link: boolean;
        }> = [];
        const manuallyPaidSplits: Array<{
          splitId: number;
          paymentId: number;
          amountCents: number;
        }> = [];

        for (const sp of splitDefs) {
          if (!sp.label || !sp.amount_cents || !sp.due_date) continue;
          const markPaid = !!sp.mark_as_paid;
          // Already-paid splits don't need a client payment link or reminders
          const sendLink = markPaid ? false : !!sp.send_payment_link;
          const [spResult] = await conn.query<ResultSetHeader>(
            `INSERT INTO payment_splits
             (case_id, client_id, label, amount_cents, due_date,
              status, completion_source, paid_at,
              reminder_flow_id, send_payment_link, notes, created_by_admin_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ${markPaid ? "NOW()" : "NULL"}, ?, ?, ?, ?)`,
            [
              caseId,
              cId,
              String(sp.label).trim(),
              Number(sp.amount_cents),
              sp.due_date,
              markPaid ? "paid" : "pending",
              markPaid ? "manual" : null,
              markPaid
                ? null
                : sp.reminder_flow_id
                  ? Number(sp.reminder_flow_id)
                  : null,
              sendLink ? 1 : 0,
              sp.notes || null,
              (req as AuthedRequest).auth!.id,
            ],
          );
          const splitId = spResult.insertId;
          let tokenStr: string | null = null;

          if (sendLink) {
            tokenStr = crypto.randomUUID();
            const expiresAt = new Date(sp.due_date);
            expiresAt.setDate(expiresAt.getDate() + 7); // token valid 7 days after due date
            await conn.query(
              `INSERT INTO payment_split_tokens (split_id, token, expires_at)
             VALUES (?, ?, ?)`,
              [splitId, tokenStr, expiresAt],
            );
          }

          if (markPaid) {
            const amountCents = Number(sp.amount_cents);
            const [manualPayment] = await conn.query<ResultSetHeader>(
              `INSERT INTO payments
               (client_id, case_id, split_id, amount_cents, currency,
                status, provider, provider_transaction_id, paid_at)
             VALUES (?, ?, ?, ?, 'USD', 'succeeded', 'manual', ?, NOW())`,
              [
                cId,
                caseId,
                splitId,
                amountCents,
                `manual-${crypto.randomUUID()}`,
              ],
            );
            const manualPaymentId = manualPayment.insertId;
            await conn.query(
              `UPDATE payment_splits SET payments_id = ? WHERE id = ?`,
              [manualPaymentId, splitId],
            );
            manuallyPaidSplits.push({
              splitId,
              paymentId: manualPaymentId,
              amountCents,
            });
          }

          insertedSplits.push({
            id: splitId,
            token: tokenStr,
            label: String(sp.label).trim(),
            amount_cents: Number(sp.amount_cents),
            due_date: new Date(sp.due_date),
            flow_id:
              markPaid || !sp.reminder_flow_id
                ? null
                : Number(sp.reminder_flow_id),
            send_link: sendLink,
          });
        }

        await conn.commit();

        // Affiliate commissions for any splits marked paid at creation time —
        // run after commit (not inside the txn) same as the online-payment
        // paths, so a slow/failing commission insert can never block the
        // case/split creation itself.
        for (const mp of manuallyPaidSplits) {
          try {
            await recordEnrollmentCommissions(
              cId,
              mp.paymentId,
              mp.amountCents,
            );
          } catch (e: any) {
            console.error(
              "[admin/cases:manual-paid:commission]",
              e?.message ?? e,
            );
          }
        }

        // Post-commit: emails + reminders (best effort).
        // Prospect-stage cases stay leads — no welcome/tasks until convert.
        const lang = (client.preferred_language as string) || "en";
        const appUrl = APP_URL;

        if (!isProspectStageCase && effectiveSendCaseEmail && client.email) {
          try {
            const tpl = tplCaseStarted({
              firstName: client.first_name as string,
              caseNumber,
              portalUrl: `${appUrl}/portal/payments`,
              lang,
            });
            await sendEmail({
              to: client.email as string,
              subject: tpl.subject,
              html: tpl.html,
            });
          } catch (e) {
            console.error("[admin/cases] case-started email failed:", e);
          }
        } else if (
          !isProspectStageCase &&
          effectiveSendCaseEmail &&
          !client.email
        ) {
          console.warn(
            `[admin/cases] Skipping case-started email — client ${cId} has no email`,
          );
        }

        if (!isProspectStageCase) {
          try {
            await triggerReminderFlow("payment_confirmed", cId, {});
          } catch (e) {
            console.error("[admin/cases] triggerReminderFlow failed:", e);
          }

          try {
            await autoAssignTasksForCase(cId, caseId);
          } catch (e) {
            console.error("[admin/cases] autoAssignTasks failed:", e);
          }
        }

        let round_calendar: any = null;
        if (effectiveRoundSchedule) {
          try {
            const clientName =
              `${client.first_name} ${client.last_name}`.trim();
            const cal = await persistAndMaybeSendRoundSchedule({
              caseId,
              clientId: cId,
              caseNumber,
              clientName,
              scheduleInput: effectiveRoundSchedule,
            });
            if (cal.error) {
              console.warn("[admin/cases] round schedule:", cal.error);
            }
            if (cal.saved) {
              round_calendar = {
                saved: true,
                sent_to: cal.sent?.sent_to ?? [],
                send_errors: cal.sent?.errors ?? [],
                error: cal.error ?? null,
              };
            }
          } catch (e: any) {
            console.error("[admin/cases] round schedule failed:", e?.message);
          }
        }

        // Schedule split reminders
        for (const sp of insertedSplits) {
          if (!sp.flow_id || !sp.token) continue;
          try {
            const paymentLink = `${appUrl}/pay/${sp.token}`;
            const amountFormatted = `$${(sp.amount_cents / 100).toFixed(2)}`;
            const dueDateFormatted = sp.due_date.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            });
            await scheduleSplitReminders({
              splitId: sp.id,
              clientId: cId,
              flowId: sp.flow_id,
              dueDate: sp.due_date,
              paymentLink,
              label: sp.label,
              amountFormatted,
              dueDateFormatted,
            });
          } catch (e) {
            console.error("[admin/cases] scheduleSplitReminders failed:", e);
          }
        }

        const [caseRow] = await pool.query<RowDataPacket[]>(
          `SELECT cr.id, cr.case_number, cr.pipeline_stage, cr.status, cr.notes, cr.created_at,
                c.id AS client_id, c.first_name AS client_first_name,
                c.last_name AS client_last_name, c.email AS client_email,
                p.id AS package_id, p.name AS package_name
         FROM credit_repair_cases cr
         JOIN clients c ON c.id = cr.client_id
         LEFT JOIN packages p ON p.id = cr.package_id
         WHERE cr.id = ? LIMIT 1`,
          [caseId],
        );

        res.status(201).json({ case: caseRow[0], round_calendar });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    },
  );

  // ── Round calendar schedule (get / upsert / resend) ───────────────────────
  app.get(
    "/api/admin/cases/:id/round-schedule",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const caseId = Number(req.params.id);
      if (!caseId || isNaN(caseId))
        return res.status(400).json({ error: "Invalid case id" });
      const scope = await getAffiliateScope(req.auth!.id);
      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT cr.id, cr.client_id FROM credit_repair_cases cr WHERE cr.id = ? LIMIT 1`,
        [caseId],
      );
      if (!caseRows.length)
        return res.status(404).json({ error: "Case not found" });
      if (
        scope &&
        !(await assertClientInAffiliateScope(caseRows[0].client_id, scope))
      ) {
        return res.status(404).json({ error: "Case not found" });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT case_id, round_1_date, round_2_date, round_3_date, round_4_date, round_5_date,
                interval_days, calendar_uid_ns, last_sent_at, last_sent_recipients,
                calendar_send_count, updated_at
         FROM case_round_schedules WHERE case_id = ? LIMIT 1`,
        [caseId],
      );
      if (!rows.length) return res.json({ schedule: null });
      const s = rows[0];
      let recipients: string[] | null = null;
      if (s.last_sent_recipients) {
        try {
          recipients =
            typeof s.last_sent_recipients === "string"
              ? JSON.parse(s.last_sent_recipients)
              : s.last_sent_recipients;
        } catch {
          recipients = null;
        }
      }
      res.json({
        schedule: {
          case_id: s.case_id,
          round_1_date: mysqlDateToYmd(s.round_1_date),
          round_2_date: mysqlDateToYmd(s.round_2_date),
          round_3_date: mysqlDateToYmd(s.round_3_date),
          round_4_date: mysqlDateToYmd(s.round_4_date),
          round_5_date: mysqlDateToYmd(s.round_5_date),
          interval_days: s.interval_days,
          calendar_uid_ns: s.calendar_uid_ns,
          calendar_send_count: Number(s.calendar_send_count ?? 0),
          last_sent_at: s.last_sent_at
            ? new Date(s.last_sent_at).toISOString()
            : null,
          last_sent_recipients: recipients,
          updated_at: new Date(s.updated_at).toISOString(),
        },
      });
    },
  );

  app.put(
    "/api/admin/cases/:id/round-schedule",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const caseId = Number(req.params.id);
      if (!caseId || isNaN(caseId))
        return res.status(400).json({ error: "Invalid case id" });
      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT cr.id, cr.case_number, cr.client_id,
                c.first_name, c.last_name
         FROM credit_repair_cases cr
         JOIN clients c ON c.id = cr.client_id
         WHERE cr.id = ? LIMIT 1`,
        [caseId],
      );
      if (!caseRows.length)
        return res.status(404).json({ error: "Case not found" });
      const kase = caseRows[0];
      const body = req.body || {};
      const cal = await persistAndMaybeSendRoundSchedule({
        caseId,
        clientId: kase.client_id,
        caseNumber: kase.case_number || `CR-${caseId}`,
        clientName: `${kase.first_name} ${kase.last_name}`.trim(),
        scheduleInput: {
          ...body,
          send_calendar: !!body.send_calendar,
        },
      });
      if (cal.error) return res.status(400).json({ error: cal.error });
      if (!cal.saved)
        return res.status(400).json({ error: "round_schedule dates required" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT case_id, round_1_date, round_2_date, round_3_date, round_4_date, round_5_date,
                interval_days, calendar_uid_ns, last_sent_at, last_sent_recipients,
                calendar_send_count, updated_at
         FROM case_round_schedules WHERE case_id = ? LIMIT 1`,
        [caseId],
      );
      const s = rows[0];
      let recipients: string[] | null = null;
      if (s?.last_sent_recipients) {
        try {
          recipients =
            typeof s.last_sent_recipients === "string"
              ? JSON.parse(s.last_sent_recipients)
              : s.last_sent_recipients;
        } catch {
          recipients = null;
        }
      }
      res.json({
        schedule: s
          ? {
              case_id: s.case_id,
              round_1_date: mysqlDateToYmd(s.round_1_date),
              round_2_date: mysqlDateToYmd(s.round_2_date),
              round_3_date: mysqlDateToYmd(s.round_3_date),
              round_4_date: mysqlDateToYmd(s.round_4_date),
              round_5_date: mysqlDateToYmd(s.round_5_date),
              interval_days: s.interval_days,
              calendar_uid_ns: s.calendar_uid_ns,
              calendar_send_count: Number(s.calendar_send_count ?? 0),
              last_sent_at: s.last_sent_at
                ? new Date(s.last_sent_at).toISOString()
                : null,
              last_sent_recipients: recipients,
              updated_at: new Date(s.updated_at).toISOString(),
            }
          : null,
        sent_to: cal.sent?.sent_to ?? [],
        send_errors: cal.sent?.errors ?? [],
      });
    },
  );

  app.post(
    "/api/admin/cases/:id/round-schedule/send",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const caseId = Number(req.params.id);
      if (!caseId || isNaN(caseId))
        return res.status(400).json({ error: "Invalid case id" });
      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT cr.id, cr.case_number, cr.client_id, c.first_name, c.last_name
         FROM credit_repair_cases cr
         JOIN clients c ON c.id = cr.client_id
         WHERE cr.id = ? LIMIT 1`,
        [caseId],
      );
      if (!caseRows.length)
        return res.status(404).json({ error: "Case not found" });
      const [schedRows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM case_round_schedules WHERE case_id = ? LIMIT 1`,
        [caseId],
      );
      if (!schedRows.length) {
        return res.status(404).json({
          error: "No round schedule saved for this case. Save dates first.",
        });
      }
      const s = schedRows[0];
      const dates = {
        round_1_date: mysqlDateToYmd(s.round_1_date),
        round_2_date: mysqlDateToYmd(s.round_2_date),
        round_3_date: mysqlDateToYmd(s.round_3_date),
        round_4_date: mysqlDateToYmd(s.round_4_date),
        round_5_date: mysqlDateToYmd(s.round_5_date),
      };
      const kase = caseRows[0];
      const sent = await sendCaseRoundCalendarInvites({
        caseId,
        clientId: kase.client_id,
        caseNumber: kase.case_number || `CR-${caseId}`,
        clientName: `${kase.first_name} ${kase.last_name}`.trim(),
        dates,
        uidNs: s.calendar_uid_ns,
        isUpdate: !!s.last_sent_at,
      });
      res.json({
        sent_to: sent.sent_to,
        send_errors: sent.errors,
      });
    },
  );

  // ── List splits for a case ────────────────────────────────────────────────
  app.get(
    "/api/admin/cases/:id/splits",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const caseId = Number(req.params.id);
      if (!caseId || isNaN(caseId))
        return res.status(400).json({ error: "Invalid case id" });
      const [splits] = await pool.query<RowDataPacket[]>(
        `SELECT ps.id, ps.case_id, ps.client_id, ps.label, ps.amount_cents, ps.currency,
              ps.due_date, ps.status, ps.completion_source, ps.paid_at, ps.payments_id,
              ps.reminder_flow_id, rf.name AS reminder_flow_name,
              ps.send_payment_link, ps.notes, ps.created_at, ps.updated_at,
              pst.token AS payment_token, pst.expires_at AS token_expires_at, pst.used_at AS token_used_at
       FROM payment_splits ps
       LEFT JOIN reminder_flows rf ON rf.id = ps.reminder_flow_id
       LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
       WHERE ps.case_id = ?
       ORDER BY ps.due_date ASC`,
        [caseId],
      );
      const appUrl = APP_URL;
      const result = splits.map((s) => ({
        ...s,
        payment_link: s.payment_token
          ? `${appUrl}/pay/${s.payment_token}`
          : null,
      }));
      res.json({ splits: result });
    },
  );

  // ── Create split for a case ───────────────────────────────────────────────
  app.post(
    "/api/admin/cases/:id/splits",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const caseId = Number(req.params.id);
      if (!caseId || isNaN(caseId))
        return res.status(400).json({ error: "Invalid case id" });

      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT cr.id, cr.client_id, c.email, c.first_name, c.preferred_language
       FROM credit_repair_cases cr JOIN clients c ON c.id = cr.client_id
       WHERE cr.id = ? LIMIT 1`,
        [caseId],
      );
      if (caseRows.length === 0)
        return res.status(404).json({ error: "Case not found" });
      const cr = caseRows[0];

      const {
        label,
        amount_cents,
        due_date,
        send_payment_link,
        reminder_flow_id,
        notes,
        mark_as_paid,
      } = req.body || {};
      if (!label || !amount_cents || !due_date)
        return res
          .status(400)
          .json({ error: "label, amount_cents, and due_date are required" });

      const markPaid = !!mark_as_paid;
      const sendLink = markPaid ? false : !!send_payment_link;
      const flowId =
        markPaid || !reminder_flow_id ? null : Number(reminder_flow_id);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        const [spResult] = await conn.query<ResultSetHeader>(
          `INSERT INTO payment_splits
           (case_id, client_id, label, amount_cents, due_date,
            status, completion_source, paid_at,
            reminder_flow_id, send_payment_link, notes, created_by_admin_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ${markPaid ? "NOW()" : "NULL"}, ?, ?, ?, ?)`,
          [
            caseId,
            cr.client_id,
            String(label).trim(),
            Number(amount_cents),
            due_date,
            markPaid ? "paid" : "pending",
            markPaid ? "manual" : null,
            flowId,
            sendLink ? 1 : 0,
            notes || null,
            (req as AuthedRequest).auth!.id,
          ],
        );
        const splitId = spResult.insertId;
        let tokenStr: string | null = null;

        if (sendLink) {
          tokenStr = crypto.randomUUID();
          const expiresAt = new Date(due_date);
          expiresAt.setDate(expiresAt.getDate() + 7);
          await conn.query(
            `INSERT INTO payment_split_tokens (split_id, token, expires_at) VALUES (?, ?, ?)`,
            [splitId, tokenStr, expiresAt],
          );
        }

        let manualPaymentId: number | null = null;
        if (markPaid) {
          const [manualPayment] = await conn.query<ResultSetHeader>(
            `INSERT INTO payments
             (client_id, case_id, split_id, amount_cents, currency,
              status, provider, provider_transaction_id, paid_at)
           VALUES (?, ?, ?, ?, 'USD', 'succeeded', 'manual', ?, NOW())`,
            [
              cr.client_id,
              caseId,
              splitId,
              Number(amount_cents),
              `manual-${crypto.randomUUID()}`,
            ],
          );
          manualPaymentId = manualPayment.insertId;
          await conn.query(
            `UPDATE payment_splits SET payments_id = ? WHERE id = ?`,
            [manualPaymentId, splitId],
          );
        }

        await conn.commit();

        if (manualPaymentId) {
          try {
            await recordEnrollmentCommissions(
              cr.client_id as number,
              manualPaymentId,
              Number(amount_cents),
            );
          } catch (e: any) {
            console.error(
              "[admin/splits:manual-paid:commission]",
              e?.message ?? e,
            );
          }
          try {
            await notifyAdminsPaymentByClientId({
              clientId: cr.client_id as number,
              amountCents: Number(amount_cents),
              caseId,
              packageOrLabel: String(label || "Installment"),
              kind: "installment",
            });
          } catch (e: any) {
            console.error("[notify:admins-installment]", e?.message ?? e);
          }
        }

        // Schedule reminders
        if (flowId && tokenStr) {
          try {
            const appUrl = APP_URL;
            const dueDate = new Date(due_date);
            const amountFormatted = `$${(Number(amount_cents) / 100).toFixed(2)}`;
            const dueDateFormatted = dueDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            });
            await scheduleSplitReminders({
              splitId,
              clientId: cr.client_id as number,
              flowId,
              dueDate,
              paymentLink: `${appUrl}/pay/${tokenStr}`,
              label: String(label).trim(),
              amountFormatted,
              dueDateFormatted,
            });
          } catch (e) {
            console.error("[admin/splits] scheduleSplitReminders failed:", e);
          }
        }

        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT ps.*, pst.token AS payment_token, pst.expires_at AS token_expires_at
         FROM payment_splits ps
         LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
         WHERE ps.id = ? LIMIT 1`,
          [splitId],
        );
        const created = rows[0];
        res.status(201).json({
          split: {
            ...created,
            payment_link: created.payment_token
              ? `${APP_URL}/pay/${created.payment_token}`
              : null,
          },
        });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    },
  );

  // ── Update split ──────────────────────────────────────────────────────────
  app.put(
    "/api/admin/cases/:id/splits/:splitId",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const caseId = Number(req.params.id);
      const splitId = Number(req.params.splitId);
      if (!caseId || !splitId)
        return res.status(400).json({ error: "Invalid ids" });

      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT ps.*, pst.token FROM payment_splits ps
         LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
         WHERE ps.id = ? AND ps.case_id = ? LIMIT 1`,
        [splitId, caseId],
      );
      if (existing.length === 0)
        return res.status(404).json({ error: "Split not found" });
      const current = existing[0];

      const {
        label,
        amount_cents,
        due_date,
        status,
        completion_source,
        notes,
        reminder_flow_id,
        send_payment_link,
      } = req.body || {};

      const updates: string[] = [];
      const args: any[] = [];
      if (label != null) {
        updates.push("label = ?");
        args.push(String(label).trim());
      }
      if (amount_cents != null) {
        updates.push("amount_cents = ?");
        args.push(Number(amount_cents));
      }
      if (due_date != null) {
        updates.push("due_date = ?");
        args.push(due_date);
      }
      if (notes !== undefined) {
        updates.push("notes = ?");
        args.push(notes || null);
      }
      if (reminder_flow_id !== undefined) {
        updates.push("reminder_flow_id = ?");
        args.push(reminder_flow_id ? Number(reminder_flow_id) : null);
      }
      if (send_payment_link !== undefined) {
        updates.push("send_payment_link = ?");
        args.push(send_payment_link ? 1 : 0);
      }
      const allowedStatuses = ["pending", "paid", "overdue", "cancelled"];
      if (status != null && allowedStatuses.includes(status)) {
        updates.push("status = ?");
        args.push(status);
        if (status === "paid" && completion_source) {
          updates.push("completion_source = ?");
          args.push(completion_source);
          updates.push("paid_at = NOW()");
        }
      }
      if (updates.length === 0)
        return res.status(400).json({ error: "No valid fields to update" });

      args.push(splitId);
      await pool.query<ResultSetHeader>(
        `UPDATE payment_splits SET ${updates.join(", ")} WHERE id = ?`,
        args,
      );

      // Manually marking a split paid (e.g. cash/check/manual entry outside
      // Authorize.net) previously updated payment_splits alone — no payments
      // row, no affiliate commission, and it didn't show up in Admin →
      // Payments. Insert the ledger row here and earn the commission the
      // same way an online payment does.
      const transitioningToPaid =
        status === "paid" && current.status !== "paid" && !current.payments_id;
      if (transitioningToPaid) {
        const finalAmountCents = Number(amount_cents ?? current.amount_cents);
        const [manualPayment] = await pool.query<ResultSetHeader>(
          `INSERT INTO payments
             (client_id, case_id, split_id, amount_cents, currency,
              status, provider, provider_transaction_id, paid_at)
           VALUES (?, ?, ?, ?, ?, 'succeeded', 'manual', ?, NOW())`,
          [
            current.client_id,
            caseId,
            splitId,
            finalAmountCents,
            current.currency || "USD",
            `manual-${crypto.randomUUID()}`,
          ],
        );
        const manualPaymentId = manualPayment.insertId;
        await pool.query(
          `UPDATE payment_splits SET payments_id = ? WHERE id = ?`,
          [manualPaymentId, splitId],
        );
        try {
          await recordEnrollmentCommissions(
            current.client_id as number,
            manualPaymentId,
            finalAmountCents,
          );
        } catch (e: any) {
          console.error(
            "[admin/splits:manual-paid:commission]",
            e?.message ?? e,
          );
        }
        try {
          await notifyAdminsPaymentByClientId({
            clientId: current.client_id as number,
            amountCents: finalAmountCents,
            caseId,
            packageOrLabel: String(current.label || "Installment"),
            kind: "installment",
          });
        } catch (e: any) {
          console.error("[notify:admins-installment]", e?.message ?? e);
        }
      }

      // Enable payment link: create a token if one does not exist yet
      // (and the split is still collectible).
      const wantsLink = send_payment_link === true;
      const stillOpen =
        (status ?? current.status) !== "paid" &&
        (status ?? current.status) !== "cancelled";
      if (wantsLink && stillOpen && !current.token) {
        const tokenStr = crypto.randomUUID();
        const expiresAt = new Date(
          due_date != null ? due_date : (current.due_date as string),
        );
        expiresAt.setDate(expiresAt.getDate() + 7);
        await pool.query(
          `INSERT INTO payment_split_tokens (split_id, token, expires_at)
           VALUES (?, ?, ?)`,
          [splitId, tokenStr, expiresAt],
        );
      }

      // If due_date changed, cancel old notifications and reschedule
      const dueDateChanged =
        due_date != null &&
        new Date(due_date).toISOString().slice(0, 10) !==
          new Date(current.due_date).toISOString().slice(0, 10);
      const markAsPaid = status === "paid" || status === "cancelled";

      if (markAsPaid || dueDateChanged) {
        // Cancel pending notifications for this split
        await pool.query(
          `UPDATE notification_queue SET status = 'cancelled'
           WHERE payload_json->>'$.split_id' = ? AND status = 'pending'`,
          [splitId],
        );
      }

      // Reschedule if due_date changed and split still has a flow + token
      if (
        dueDateChanged &&
        !markAsPaid &&
        current.token &&
        (reminder_flow_id || current.reminder_flow_id)
      ) {
        try {
          const newDueDate = new Date(due_date);
          const flowId = reminder_flow_id
            ? Number(reminder_flow_id)
            : (current.reminder_flow_id as number);
          const appUrl = APP_URL;
          const amountCents = amount_cents ?? (current.amount_cents as number);
          await scheduleSplitReminders({
            splitId,
            clientId: current.client_id as number,
            flowId,
            dueDate: newDueDate,
            paymentLink: `${appUrl}/pay/${current.token}`,
            label: label ?? (current.label as string),
            amountFormatted: `$${(Number(amountCents) / 100).toFixed(2)}`,
            dueDateFormatted: newDueDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
          });
        } catch (e) {
          console.error("[admin/splits] reschedule failed:", e);
        }
      }

      const [updated] = await pool.query<RowDataPacket[]>(
        `SELECT ps.*, pst.token AS payment_token FROM payment_splits ps
         LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
         WHERE ps.id = ? LIMIT 1`,
        [splitId],
      );
      const row = updated[0];
      res.json({
        split: {
          ...row,
          payment_link: row.payment_token
            ? `${APP_URL}/pay/${row.payment_token}`
            : null,
        },
      });
    },
  );

  // ── Delete split ──────────────────────────────────────────────────────────
  app.delete(
    "/api/admin/cases/:id/splits/:splitId",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const caseId = Number(req.params.id);
      const splitId = Number(req.params.splitId);
      if (!caseId || !splitId)
        return res.status(400).json({ error: "Invalid ids" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM payment_splits WHERE id = ? AND case_id = ? LIMIT 1`,
        [splitId, caseId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Split not found" });

      // Cancel pending notifications
      await pool.query(
        `UPDATE notification_queue SET status = 'cancelled'
         WHERE payload_json->>'$.split_id' = ? AND status = 'pending'`,
        [splitId],
      );
      // Tokens cascade via FK
      await pool.query(`DELETE FROM payment_splits WHERE id = ?`, [splitId]);
      res.json({ ok: true });
    },
  );

  // ── Admin payment splits overview (all cases) ─────────────────────────────
  app.get(
    "/api/admin/payment-splits",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
      const offset = (page - 1) * limit;
      const status = req.query.status as string | undefined;
      const allowedStatuses = ["pending", "paid", "overdue", "cancelled"];

      const conditions: string[] = [];
      const args: any[] = [];
      if (status && allowedStatuses.includes(status)) {
        conditions.push("ps.status = ?");
        args.push(status);
      }
      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      const [[countRow]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM payment_splits ps ${where}`,
        args,
      );
      const total = (countRow.total as number) || 0;

      const [splits] = await pool.query<RowDataPacket[]>(
        `SELECT ps.id, ps.case_id, cr.case_number, ps.client_id,
              c.first_name AS client_first_name, c.last_name AS client_last_name,
              c.email AS client_email,
              ps.label, ps.amount_cents, ps.currency, ps.due_date,
              ps.status, ps.completion_source, ps.paid_at, ps.payments_id,
              ps.reminder_flow_id, rf.name AS reminder_flow_name,
              ps.send_payment_link, ps.notes, ps.created_at, ps.updated_at,
              pst.token AS payment_token
       FROM payment_splits ps
       JOIN credit_repair_cases cr ON cr.id = ps.case_id
       JOIN clients c ON c.id = ps.client_id
       LEFT JOIN reminder_flows rf ON rf.id = ps.reminder_flow_id
       LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
       ${where}
       ORDER BY ps.due_date ASC
       LIMIT ? OFFSET ?`,
        [...args, limit, offset],
      );
      const appUrl = APP_URL;
      const result = splits.map((s) => ({
        ...s,
        payment_link: s.payment_token
          ? `${appUrl}/pay/${s.payment_token}`
          : null,
      }));
      res.json({
        splits: result,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    },
  );

  // ── Admin calendar: splits in date range ──────────────────────────────────
  app.get(
    "/api/admin/calendar",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const { from, to } = req.query as { from?: string; to?: string };
      if (!from || !to)
        return res
          .status(400)
          .json({ error: "from and to query params required" });

      const [splits] = await pool.query<RowDataPacket[]>(
        `SELECT ps.id, ps.case_id, cr.case_number, ps.client_id,
              c.first_name AS client_first_name, c.last_name AS client_last_name,
              ps.label, ps.amount_cents, ps.currency, ps.due_date,
              ps.status, ps.completion_source, ps.send_payment_link,
              pst.token AS payment_token
       FROM payment_splits ps
       JOIN credit_repair_cases cr ON cr.id = ps.case_id
       JOIN clients c ON c.id = ps.client_id
       LEFT JOIN payment_split_tokens pst ON pst.split_id = ps.id
       WHERE ps.due_date BETWEEN ? AND ?
       ORDER BY ps.due_date ASC`,
        [from, to],
      );

      const [roundRows] = await pool.query<RowDataPacket[]>(
        `SELECT r.case_id, cr.case_number, cr.client_id,
                c.first_name AS client_first_name, c.last_name AS client_last_name,
                r.round_number, r.target_date
         FROM (
           SELECT case_id, 1 AS round_number, round_1_date AS target_date FROM case_round_schedules
           UNION ALL SELECT case_id, 2, round_2_date FROM case_round_schedules
           UNION ALL SELECT case_id, 3, round_3_date FROM case_round_schedules
           UNION ALL SELECT case_id, 4, round_4_date FROM case_round_schedules
           UNION ALL SELECT case_id, 5, round_5_date FROM case_round_schedules
         ) r
         JOIN credit_repair_cases cr ON cr.id = r.case_id AND cr.status = 'active'
         JOIN clients c ON c.id = cr.client_id
         WHERE r.target_date BETWEEN ? AND ?
         ORDER BY r.target_date ASC, r.round_number ASC`,
        [from, to],
      );

      const [workTaskRows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id, t.title, t.status, t.priority, t.due_at, t.source,
                t.assignee_admin_id, t.case_id,
                a.first_name AS assignee_first_name,
                a.last_name AS assignee_last_name,
                cr.case_number, cr.client_id,
                c.first_name AS client_first_name, c.last_name AS client_last_name
         FROM admin_work_tasks t
         LEFT JOIN admins a ON a.id = t.assignee_admin_id
         LEFT JOIN credit_repair_cases cr ON cr.id = t.case_id
         LEFT JOIN clients c ON c.id = cr.client_id
         WHERE t.due_at IS NOT NULL
           AND t.status IN ('backlog', 'doing')
           AND DATE(t.due_at) BETWEEN ? AND ?
         ORDER BY t.due_at ASC, t.id ASC`,
        [from, to],
      );

      const appUrl = APP_URL;
      res.json({
        splits: splits.map((s) => ({
          ...s,
          send_payment_link: !!s.send_payment_link,
          payment_link: s.payment_token
            ? `${appUrl}/pay/${s.payment_token}`
            : null,
        })),
        round_events: roundRows.map((r) => ({
          id: `${r.case_id}-r${r.round_number}`,
          case_id: r.case_id,
          case_number: r.case_number,
          client_id: r.client_id,
          client_first_name: r.client_first_name,
          client_last_name: r.client_last_name,
          round_number: Number(r.round_number),
          target_date: mysqlDateToYmd(r.target_date),
        })),
        work_tasks: workTaskRows.map((r) => {
          const assigneeName =
            r.assignee_first_name || r.assignee_last_name
              ? `${r.assignee_first_name || ""} ${r.assignee_last_name || ""}`.trim()
              : null;
          return {
            id: Number(r.id),
            title: String(r.title),
            status: r.status as string,
            priority: r.priority as string,
            due_date: mysqlDateToYmd(r.due_at),
            assignee_admin_id: r.assignee_admin_id
              ? Number(r.assignee_admin_id)
              : null,
            assignee_name: assigneeName,
            case_id: r.case_id != null ? Number(r.case_id) : null,
            case_number: (r.case_number as string) || null,
            client_id: r.client_id != null ? Number(r.client_id) : null,
            client_first_name: (r.client_first_name as string) || null,
            client_last_name: (r.client_last_name as string) || null,
            source: r.source as string,
          };
        }),
      });
    },
  );

  // ── Get single case detail (pipeline panel) ──────────────────────────────
  app.get(
    "/api/admin/cases/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const caseId = Number(req.params.id);
      if (!caseId || isNaN(caseId))
        return res.status(400).json({ error: "Invalid case id" });

      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT cr.id AS case_id, cr.case_number, cr.pipeline_stage AS case_stage,
              cr.status AS case_status, cr.created_at AS case_created_at,
              c.id, c.first_name, c.last_name, c.email, c.phone,
              cr.pipeline_stage,
              c.status, c.contract_signed_at, c.smart_credit_connected_at,
              c.crc_client_id, c.crc_synced_at, c.preferred_language,
              p.name AS package_name, p.price_cents AS package_price_cents
       FROM credit_repair_cases cr
       JOIN clients c ON c.id = cr.client_id
       LEFT JOIN packages p ON p.id = cr.package_id
       WHERE cr.id = ? LIMIT 1`,
        [caseId],
      );
      if (caseRows.length === 0)
        return res.status(404).json({ error: "Case not found" });

      const row = caseRows[0];
      const clientId = row.id as number;

      const [taskCompletions] = await pool.query<RowDataPacket[]>(
        `SELECT ctc.id, ctc.task_template_id, ctc.status AS completion_status,
              ctc.form_data_json, ctc.file_name, ctc.file_mime,
              ctc.signature_name, ctc.completed_at,
              ctc.admin_review_status, ctc.admin_notes, ctc.admin_reviewed_at,
              ott.slug, ott.task_type, ott.title_en, ott.title_es,
              ott.description_en, ott.description_es, ott.sort_order, ott.is_required
       FROM client_task_completions ctc
       JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
       WHERE ctc.case_id = ?
       ORDER BY ott.sort_order ASC`,
        [caseId],
      );
      const [reports] = await pool.query<RowDataPacket[]>(
        `SELECT id, round_number, score_before, score_after, items_removed,
              items_disputed, summary_md, bureau_scores_json, wins_json, targets_json,
              file_strength_score,
              pdf_file_name, (pdf_storage_key IS NOT NULL) AS has_pdf, pdf_uploaded_at, created_at
       FROM client_round_reports WHERE client_id = ? ORDER BY round_number DESC`,
        [clientId],
      );
      await attachPdfsToReports(clientId, reports);
      const [payments] = await pool.query<RowDataPacket[]>(
        `SELECT p.id, p.amount_cents, p.status, p.paid_at, p.created_at,
              pk.name AS package_name
       FROM payments p LEFT JOIN packages pk ON pk.id = p.package_id
       WHERE p.client_id = ? ORDER BY p.created_at DESC`,
        [clientId],
      );
      const [pipeline] = await pool.query<RowDataPacket[]>(
        `SELECT id, from_stage, to_stage, notes, created_at
       FROM client_pipeline_history WHERE client_id = ? ORDER BY created_at DESC`,
        [clientId],
      );

      const [siblingCases] = await pool.query<RowDataPacket[]>(
        `SELECT id, case_number, pipeline_stage, status, created_at
       FROM credit_repair_cases
       WHERE client_id = ? AND status = 'active' AND id != ?
       ORDER BY id DESC`,
        [clientId, caseId],
      );

      res.json({
        case_info: {
          id: row.case_id,
          case_number: row.case_number,
          status: row.case_status,
          pipeline_stage: row.case_stage,
          created_at: row.case_created_at,
        },
        client: {
          id: row.id,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          phone: row.phone,
          pipeline_stage: row.pipeline_stage, // sourced from case stage
          status: row.status,
          contract_signed_at: row.contract_signed_at,
          smart_credit_connected_at: row.smart_credit_connected_at,
          crc_client_id: row.crc_client_id,
          crc_synced_at: row.crc_synced_at,
          preferred_language: row.preferred_language,
          package_name: row.package_name,
          package_price_cents: row.package_price_cents,
        },
        documents: taskCompletions,
        reports,
        payments,
        pipeline_history: pipeline,
        sibling_cases: siblingCases,
      });
    },
  );

  // ── Update case pipeline stage ────────────────────────────────────────────
  app.post(
    "/api/admin/cases/:id/stage",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const caseId = Number(req.params.id);
      if (!caseId || isNaN(caseId))
        return res.status(400).json({ error: "Invalid case id" });

      const { stage, notes } = req.body || {};
      const allowed = [
        "new_client",
        "docs_ready",
        "round_1",
        "round_2",
        "round_3",
        "round_4",
        "round_5",
        "completed",
        "cancelled",
      ];
      if (!allowed.includes(stage))
        return res.status(400).json({ error: "Invalid stage" });

      const [cur] = await pool.query<RowDataPacket[]>(
        `SELECT cr.pipeline_stage, cr.client_id FROM credit_repair_cases cr WHERE cr.id = ? LIMIT 1`,
        [caseId],
      );
      if (cur.length === 0)
        return res.status(404).json({ error: "Case not found" });

      const fromStage = cur[0].pipeline_stage as string;
      const clientId = cur[0].client_id as number;

      const scope = await getAffiliateScope(req.auth!.id);
      if (scope && !scope.hasPortalAccess) {
        return res.status(403).json({ error: "Portal access required" });
      }
      if (scope && !(await assertClientInAffiliateScope(clientId, scope))) {
        return res.status(404).json({ error: "Case not found" });
      }

      if (fromStage === stage) return res.json({ ok: true, unchanged: true });

      // Leaving Prospect requires convert (welcome email, tasks, onboarding).
      if (fromStage === "prospect") {
        return res.status(409).json({
          error:
            "Prospect-stage cases must be converted via POST /api/admin/prospects/:id/convert (drag Prospect → New Client).",
        });
      }

      // Enforce docs_ready rule: all required tasks must be approved
      if (stage === "docs_ready") {
        const [[requiredRow]] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS required_total FROM onboarding_task_templates
           WHERE is_active = 1 AND is_required = 1`,
        );
        const requiredTotal = Number(requiredRow.required_total);

        const [[approvedRow]] = await pool.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS approved_count
           FROM client_task_completions ctc
           JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
           WHERE ctc.case_id = ? AND ctc.admin_review_status = 'approved'
             AND ott.is_required = 1 AND ott.is_active = 1`,
          [caseId],
        );
        const approvedCount = Number(approvedRow.approved_count);

        if (approvedCount < requiredTotal) {
          return res.status(422).json({
            error: `Cannot advance to Docs Verified — ${requiredTotal - approvedCount} required task(s) still need approval.`,
          });
        }
      }

      // Update the case stage
      const { unchanged } = await advanceCasePipeline(pool, {
        clientId,
        caseId,
        stage,
        adminId: req.auth!.id,
        notes: notes || null,
      });
      if (unchanged) return res.json({ ok: true, unchanged: true });

      if (stage === "docs_ready") {
        triggerReminderFlow("docs_ready", clientId).catch((e) =>
          console.error("[flow:docs_ready]", e?.message),
        );
      }
      if (stage === "completed") {
        triggerReminderFlow("completed", clientId).catch((e) =>
          console.error("[flow:completed]", e?.message),
        );
      }
      if (ROUND_STAGE_LABELS[stage]) {
        notifyReferrerRoundUpdate(clientId, stage).catch((e) =>
          console.error("[referrer:round-update]", e?.message ?? e),
        );
      }
      crcSyncClient(clientId).catch((e) =>
        console.error("[crc:stage-sync]", e?.message),
      );
      res.json({ ok: true });
    },
  );

  // ── Create client ────────────────────────────────────────────────────────
  app.post(
    "/api/admin/clients",
    requireAdmin,
    requirePortalIfAffiliate,
    async (req: AuthedRequest, res) => {
      const scope = await getAffiliateScope(req.auth!.id);
      const {
        first_name,
        last_name,
        email,
        phone,
        package_id,
        status,
        admin_notes,
        send_welcome_email,
        preferred_language,
        referral_category,
        referrer_id,
        assigned_admin_id,
        create_case,
        round_schedule,
      } = req.body || {};
      if (!first_name || !last_name)
        return res
          .status(400)
          .json({ error: "first_name and last_name are required" });
      const normalizedEmail = String(email ?? "")
        .trim()
        .toLowerCase();
      const normalizedPhone = String(phone ?? "").trim();
      if (!normalizedEmail && !normalizedPhone) {
        return res.status(400).json({
          error: "Email or phone is required",
          code: "contact_required",
        });
      }
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (normalizedEmail && !emailRe.test(normalizedEmail))
        return res.status(400).json({ error: "Invalid email address" });
      const clientEmail: string | null = normalizedEmail || null;
      const clientPhone: string | null = normalizedPhone || null;
      const allowedStatus = [
        "prospect",
        "pending_payment",
        "onboarding",
        "active",
        "paused",
        "cancelled",
      ];
      // Affiliate-referred leads always land as unscoped prospects — status,
      // pipeline stage, package, and admin notes are staff-only concerns.
      const clientStatus = scope
        ? "prospect"
        : allowedStatus.includes(status)
          ? status
          : "pending_payment";
      const isProspect = clientStatus === "prospect";
      const pipelineStage = scope || isProspect ? "prospect" : "new_client";
      const affiliateId = scope ? scope.affiliateId : null;
      const lang = preferred_language === "es" ? "es" : "en";
      const allowedRef = ["realtor_broker", "one_off", "affiliate_partner"];
      const refCategory =
        !scope && allowedRef.includes(referral_category)
          ? (referral_category as string)
          : scope
            ? "affiliate_partner"
            : null;
      const refId =
        !scope && referrer_id != null && referrer_id !== ""
          ? Number(referrer_id)
          : null;
      if (refId != null && (!Number.isFinite(refId) || refId <= 0)) {
        return res.status(400).json({ error: "Invalid referrer_id" });
      }
      let assignedAdminId: number | null = null;
      if (!scope) {
        if (assigned_admin_id != null && assigned_admin_id !== "") {
          const n = Number(assigned_admin_id);
          if (!Number.isFinite(n) || n <= 0) {
            return res.status(400).json({ error: "Invalid assigned_admin_id" });
          }
          assignedAdminId = n;
        } else {
          assignedAdminId = await resolveLanguageOwnerAdminId(lang);
        }
      }
      try {
        if (refId) {
          const [refRows] = await pool.query<RowDataPacket[]>(
            `SELECT id FROM referrers WHERE id = ? AND status = 'active' LIMIT 1`,
            [refId],
          );
          if (!refRows[0]) {
            return res.status(400).json({ error: "Referrer not found" });
          }
        }
        const [result] = await pool.query<ResultSetHeader>(
          `INSERT INTO clients (
             first_name, last_name, email, phone, package_id, status, pipeline_stage,
             preferred_language, assigned_admin_id, admin_notes, affiliate_id,
             referral_category, referrer_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            String(first_name).trim(),
            String(last_name).trim(),
            clientEmail,
            clientPhone,
            scope || isProspect ? null : package_id ? Number(package_id) : null,
            clientStatus,
            pipelineStage,
            lang,
            assignedAdminId,
            scope ? null : admin_notes ? String(admin_notes).trim() : null,
            affiliateId,
            refCategory,
            refId,
          ],
        );
        const clientId = result.insertId;
        const labelSlugs = [
          ...(affiliateId ? ["affiliate_referral"] : []),
          ...referralCategoryLabelSlugs(refCategory),
        ];
        if (labelSlugs.length > 0) {
          attachLabelsBySlug(clientId, labelSlugs).catch((e) =>
            console.error(
              "[admin/clients] attachLabels failed:",
              e?.message ?? e,
            ),
          );
        }
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
                  c.status, c.created_at, c.preferred_language, c.assigned_admin_id,
                  c.referral_category, c.referrer_id,
                  p.name AS package_name, p.slug AS package_slug
           FROM clients c LEFT JOIN packages p ON p.id = c.package_id
           WHERE c.id = ? LIMIT 1`,
          [clientId],
        );
        // Optionally send welcome email with portal access link — staff only.
        // Requires a real email; phone-only clients skip outbound email safely.
        if (send_welcome_email && !scope && !isProspect && clientEmail) {
          try {
            const token = await createOnboardingToken(clientId, 72);
            const portalUrl = `${APP_URL}/portal/onboarding/${token}`;
            const tpl = tplClientWelcome({
              firstName: String(first_name).trim(),
              portalUrl,
              lang,
            });
            await sendEmail({
              to: clientEmail,
              subject: tpl.subject,
              html: tpl.html,
            });
            notifyLanguageOwnerDocUploadLink({
              clientId,
              firstName: String(first_name).trim(),
              lastName: String(last_name).trim(),
              clientEmail,
              lang,
              portalUrl,
              assignedAdminId,
            }).catch((e) =>
              console.error("[admin/clients] owner doc-link notify:", e),
            );
          } catch (emailErr) {
            console.error("[admin/clients] welcome email failed:", emailErr);
          }
        }

        let createdCase: { id: number; case_number: string } | null = null;
        let round_calendar: any = null;
        const wantsCase =
          !scope &&
          !isProspect &&
          (!!create_case ||
            (round_schedule &&
              typeof round_schedule === "object" &&
              (!!round_schedule.send_calendar ||
                !!round_schedule.round_1_date)));
        if (wantsCase) {
          try {
            const [caseResult] = await pool.query<ResultSetHeader>(
              `INSERT INTO credit_repair_cases
                 (client_id, package_id, pipeline_stage, status, notes)
               VALUES (?, ?, 'new_client', 'active', ?)`,
              [
                clientId,
                package_id ? Number(package_id) : null,
                admin_notes ? String(admin_notes).trim() : null,
              ],
            );
            const newCaseId = caseResult.insertId;
            const caseNumber = `CR-${String(newCaseId).padStart(5, "0")}`;
            await pool.query(
              `UPDATE credit_repair_cases SET case_number = ? WHERE id = ?`,
              [caseNumber, newCaseId],
            );
            createdCase = { id: newCaseId, case_number: caseNumber };
            autoAssignTasksForCase(clientId, newCaseId).catch((e) =>
              console.error(
                "[admin/clients] autoAssignTasks failed:",
                e?.message,
              ),
            );
            if (round_schedule && typeof round_schedule === "object") {
              const clientName =
                `${String(first_name).trim()} ${String(last_name).trim()}`.trim();
              const cal = await persistAndMaybeSendRoundSchedule({
                caseId: newCaseId,
                clientId,
                caseNumber,
                clientName,
                scheduleInput: round_schedule,
              });
              if (cal.saved) {
                round_calendar = {
                  saved: true,
                  sent_to: cal.sent?.sent_to ?? [],
                  send_errors: cal.sent?.errors ?? [],
                  error: cal.error ?? null,
                };
              } else if (cal.error) {
                round_calendar = { saved: false, error: cal.error };
              }
            }
          } catch (caseErr: any) {
            console.error(
              "[admin/clients] create_case failed:",
              caseErr?.message ?? caseErr,
            );
          }
        }

        res.status(201).json({
          client: rows[0],
          case: createdCase,
          round_calendar,
        });
      } catch (err: any) {
        if (sendFriendlyError(res, err, { duplicateLabel: "email" })) return;
        throw err;
      }
    },
  );

  // ── Update client ────────────────────────────────────────────────────────
  app.put(
    "/api/admin/clients/:id",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const scope = await getAffiliateScope(req.auth!.id);
      if (scope && !scope.hasPortalAccess) {
        return res.status(403).json({
          error: "Affiliate subscription required",
          code: "affiliate_subscription_required",
        });
      }
      const {
        first_name,
        last_name,
        email,
        phone,
        package_id,
        status,
        admin_notes,
        preferred_language,
        referral_category,
        referrer_id,
        assigned_admin_id,
      } = req.body || {};
      const [existing] = await pool.query<RowDataPacket[]>(
        "SELECT id FROM clients WHERE id = ? LIMIT 1",
        [id],
      );
      if (existing.length === 0)
        return res.status(404).json({ error: "Client not found" });
      if (scope && !(await assertClientInAffiliateScope(id, scope))) {
        return res.status(404).json({ error: "Client not found" });
      }
      const allowedStatus = [
        "pending_payment",
        "onboarding",
        "active",
        "paused",
        "cancelled",
      ];
      const updates: string[] = [];
      const args: any[] = [];
      if (first_name != null) {
        updates.push("first_name = ?");
        args.push(String(first_name).trim());
      }
      if (last_name != null) {
        updates.push("last_name = ?");
        args.push(String(last_name).trim());
      }
      if (email !== undefined) {
        const normalizedEmail = String(email ?? "")
          .trim()
          .toLowerCase();
        if (normalizedEmail) {
          const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRe.test(normalizedEmail))
            return res.status(400).json({ error: "Invalid email address" });
          updates.push("email = ?");
          args.push(normalizedEmail);
        } else {
          updates.push("email = NULL");
        }
      }
      if (phone !== undefined) {
        updates.push("phone = ?");
        args.push(phone ? String(phone).trim() : null);
      }
      // Affiliates are limited to contact-info fields — package/status/notes
      // are staff-only concerns.
      if (!scope) {
        if (package_id !== undefined) {
          updates.push("package_id = ?");
          args.push(package_id ? Number(package_id) : null);
        }
        if (status != null && allowedStatus.includes(status)) {
          updates.push("status = ?");
          args.push(status);
        }
        if (admin_notes !== undefined) {
          updates.push("admin_notes = ?");
          args.push(admin_notes ? String(admin_notes).trim() : null);
        }
        if (preferred_language === "en" || preferred_language === "es") {
          updates.push("preferred_language = ?");
          args.push(preferred_language);
          // Re-resolve owner when language changes unless explicitly overridden
          if (assigned_admin_id === undefined) {
            const ownerId =
              await resolveLanguageOwnerAdminId(preferred_language);
            updates.push("assigned_admin_id = ?");
            args.push(ownerId);
          }
        }
        if (assigned_admin_id !== undefined) {
          updates.push("assigned_admin_id = ?");
          args.push(
            assigned_admin_id === null || assigned_admin_id === ""
              ? null
              : Number(assigned_admin_id),
          );
        }
        if (referral_category !== undefined) {
          const allowedRef = ["realtor_broker", "one_off", "affiliate_partner"];
          updates.push("referral_category = ?");
          args.push(
            referral_category && allowedRef.includes(referral_category)
              ? referral_category
              : null,
          );
        }
        if (referrer_id !== undefined) {
          updates.push("referrer_id = ?");
          args.push(
            referrer_id === null || referrer_id === ""
              ? null
              : Number(referrer_id),
          );
        }
      }
      if (updates.length === 0)
        return res.status(400).json({ error: "No valid fields to update" });

      // Ensure the client still has at least one contact channel after update.
      if (email !== undefined || phone !== undefined) {
        const [cur] = await pool.query<RowDataPacket[]>(
          `SELECT email, phone FROM clients WHERE id = ? LIMIT 1`,
          [id],
        );
        const nextEmail =
          email !== undefined
            ? String(email ?? "").trim().toLowerCase() || null
            : (cur[0]?.email as string | null) || null;
        const nextPhone =
          phone !== undefined
            ? String(phone ?? "").trim() || null
            : (cur[0]?.phone as string | null) || null;
        if (!nextEmail && !nextPhone) {
          return res.status(400).json({
            error: "Email or phone is required",
            code: "contact_required",
          });
        }
      }

      args.push(id);
      try {
        await pool.query<ResultSetHeader>(
          `UPDATE clients SET ${updates.join(", ")} WHERE id = ?`,
          args,
        );
      } catch (err: any) {
        if (sendFriendlyError(res, err, { duplicateLabel: "email" })) return;
        throw err;
      }
      // `suspended` isn't a valid client status today, but check for it too
      // in case the enum grows — cancelled is the one that exists now.
      if (status === "cancelled" || status === "suspended") {
        await revokeAllSessions("client", id).catch((e) =>
          console.error("[admin/clients:revoke-sessions]", e?.message ?? e),
        );
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.pipeline_stage,
                c.status, c.created_at, c.preferred_language, c.assigned_admin_id,
                c.referral_category, c.referrer_id,
                p.name AS package_name, p.slug AS package_slug
         FROM clients c LEFT JOIN packages p ON p.id = c.package_id
         WHERE c.id = ? LIMIT 1`,
        [id],
      );
      res.json({ client: rows[0] });
    },
  );

  // ── Referrers / partners ─────────────────────────────────────────────────
  app.get(
    "/api/admin/referrers",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const category = (req.query.category as string) || "";
      const search = ((req.query.search as string) || "").trim();
      const where: string[] = ["status = 'active'"];
      const args: any[] = [];
      if (
        category === "realtor_broker" ||
        category === "one_off" ||
        category === "affiliate_partner"
      ) {
        where.push("category = ?");
        args.push(category);
      }
      if (search) {
        where.push(
          "(first_name LIKE ? ESCAPE '!' OR last_name LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' OR company LIKE ? ESCAPE '!')",
        );
        const s = likeContains(search);
        args.push(s, s, s, s);
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, category, first_name, last_name, email, phone, company,
                affiliate_id, preferred_language, notes, status, created_at
         FROM referrers WHERE ${where.join(" AND ")}
         ORDER BY last_name ASC, first_name ASC LIMIT 500`,
        args,
      );
      res.json({ referrers: rows });
    },
  );

  app.post(
    "/api/admin/referrers",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const {
        category,
        first_name,
        last_name,
        email,
        phone,
        company,
        affiliate_id,
        preferred_language,
        notes,
      } = req.body || {};
      const allowed = ["realtor_broker", "one_off", "affiliate_partner"];
      if (!allowed.includes(category)) {
        return res.status(400).json({ error: "Invalid category" });
      }
      if (!first_name || !last_name) {
        return res
          .status(400)
          .json({ error: "first_name and last_name are required" });
      }
      const lang = preferred_language === "es" ? "es" : "en";
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO referrers
           (category, first_name, last_name, email, phone, company, affiliate_id, preferred_language, notes)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          category,
          String(first_name).trim(),
          String(last_name).trim(),
          email ? String(email).trim().toLowerCase() : null,
          phone ? String(phone).trim() : null,
          company ? String(company).trim() : null,
          affiliate_id ? Number(affiliate_id) : null,
          lang,
          notes ? String(notes).trim() : null,
        ],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM referrers WHERE id = ? LIMIT 1`,
        [r.insertId],
      );
      res.status(201).json({ referrer: rows[0] });
    },
  );

  // ── Admin manual document upload (same AES-GCM encryption as portal) ─────
  app.post(
    "/api/admin/cases/:id/documents",
    requireAdmin,
    denyAffiliateAccess,
    upload.array("files", 5),
    async (req: AuthedRequest, res) => {
      const caseId = Number(req.params.id);
      if (!caseId || isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case id" });
      }
      const docType = String(req.body?.doc_type || "");
      const allowed = [
        "id_front",
        "id_back",
        "ssn_card",
        "proof_of_address",
        "other",
      ];
      if (!allowed.includes(docType)) {
        return res.status(400).json({ error: "Invalid doc_type" });
      }
      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, client_id, pipeline_stage FROM credit_repair_cases WHERE id = ? LIMIT 1`,
        [caseId],
      );
      if (!caseRows[0])
        return res.status(404).json({ error: "Case not found" });
      const clientId = Number(caseRows[0].client_id);
      const pipelineRound = (caseRows[0].pipeline_stage as string) || null;
      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) {
        return res.status(400).json({ error: "No files" });
      }
      const inserted: any[] = [];
      let syncedTasks = 0;
      for (const f of files) {
        const { encrypted, iv, tag } = encryptFile(f.buffer);
        const cdnUrl = await uploadToCDN(
          encrypted,
          f.originalname + ".enc",
          "application/octet-stream",
          clientId,
        );
        const [r] = await pool.query<ResultSetHeader>(
          `INSERT INTO client_documents
             (client_id, case_id, doc_type, pipeline_round, file_name, file_size, mime_type,
              storage_provider, storage_key, encrypted, enc_iv, enc_tag, review_status, uploaded_by_admin_id)
           VALUES (?,?,?,?,?,?,?, 'cdn', ?, 1, ?, ?, 'approved', ?)`,
          [
            clientId,
            caseId,
            docType,
            pipelineRound,
            f.originalname,
            f.size,
            f.mimetype,
            cdnUrl,
            iv,
            tag,
            req.auth!.id,
          ],
        );
        const fileStorageKey = `${cdnUrl}|${iv}|${tag}`;
        const synced = await syncAdminUploadToMatchingTask({
          clientId,
          caseId,
          docType,
          fileStorageKey,
          fileName: f.originalname,
          fileMime: f.mimetype,
          adminId: req.auth!.id,
        });
        if (synced) syncedTasks += 1;
        inserted.push({
          id: r.insertId,
          doc_type: docType,
          file_name: f.originalname,
          review_status: "approved",
          uploaded_by_admin_id: req.auth!.id,
          task_synced: synced,
        });
      }
      const autoAdvanced = await maybeAutoAdvanceDocsReadyFromTasks({
        clientId,
        caseId,
        adminId: req.auth!.id,
      });
      res.status(201).json({
        ok: true,
        documents: inserted,
        tasks_synced: syncedTasks,
        auto_advanced_docs_ready: autoAdvanced,
      });
    },
  );

  app.get(
    "/api/admin/cases/:id/documents",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const caseId = Number(req.params.id);
      if (!caseId || isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case id" });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT d.id, d.client_id, d.case_id, d.doc_type, d.pipeline_round,
                d.file_name, d.file_size, d.mime_type, d.review_status,
                d.uploaded_by_admin_id, d.uploaded_at,
                a.first_name AS uploaded_by_first_name,
                a.last_name AS uploaded_by_last_name
         FROM client_documents d
         LEFT JOIN admins a ON a.id = d.uploaded_by_admin_id
         WHERE d.case_id = ?
         ORDER BY d.uploaded_at DESC`,
        [caseId],
      );
      res.json({ documents: rows });
    },
  );

  app.get(
    "/api/admin/client-documents/:id/file",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, mime_type, storage_key, encrypted, enc_iv, enc_tag
         FROM client_documents WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      const doc = rows[0];
      try {
        const resp = await fetch(String(doc.storage_key));
        if (!resp.ok) {
          return res.status(502).json({ error: "Failed to fetch file" });
        }
        const buf = Buffer.from(await resp.arrayBuffer());
        const plain =
          doc.encrypted && doc.enc_iv && doc.enc_tag
            ? decryptFile(buf, String(doc.enc_iv), String(doc.enc_tag))
            : buf;
        res.setHeader(
          "Content-Type",
          String(doc.mime_type || "application/octet-stream"),
        );
        res.setHeader(
          "Content-Disposition",
          `inline; filename="${String(doc.file_name).replace(/"/g, "")}"`,
        );
        res.send(plain);
      } catch (e: any) {
        console.error("[admin/client-documents/file]", e?.message ?? e);
        res.status(500).json({ error: "Failed to decrypt file" });
      }
    },
  );

  // ── Delete client ────────────────────────────────────────────────────────
  app.delete(
    "/api/admin/clients/:id",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const scope = await getAffiliateScope(req.auth!.id);
      if (scope && !scope.hasPortalAccess) {
        return res.status(403).json({
          error: "Affiliate subscription required",
          code: "affiliate_subscription_required",
        });
      }
      const [existing] = await pool.query<RowDataPacket[]>(
        "SELECT id, status, affiliate_id FROM clients WHERE id = ? LIMIT 1",
        [id],
      );
      if (existing.length === 0)
        return res.status(404).json({ error: "Client not found" });
      if (scope) {
        if (!(await assertClientInAffiliateScope(id, scope))) {
          return res.status(404).json({ error: "Client not found" });
        }
        // Affiliates may only remove their own referred prospects, never
        // clients that have already entered the paid pipeline.
        if (existing[0].status !== "prospect") {
          return res.status(403).json({
            error: "Only prospect leads can be deleted by affiliates",
          });
        }
      }
      await pool.query<ResultSetHeader>("DELETE FROM clients WHERE id = ?", [
        id,
      ]);
      res.json({ ok: true });
    },
  );

  // ============================================================================
  // BULK CSV IMPORT — CLIENTS
  // ============================================================================

  // Download an empty starter CSV with the expected headers + one sample row
  app.get(
    "/api/admin/bulk-import/templates/clients.csv",
    requireAdmin,
    denyAffiliateAccess,
    async (_req: AuthedRequest, res) => {
      const csv = buildOptimumClientTemplateCsv();
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set(
        "Content-Disposition",
        'attachment; filename="optimum-credit-clients-template.csv"',
      );
      res.send(csv);
    },
  );

  // Upload + validate a CSV (no DB writes to clients yet — stages a job for review/commit)
  app.post(
    "/api/admin/bulk-import/validate",
    requireAdmin,
    denyAffiliateAccess,
    upload.single("file"),
    async (req: AuthedRequest, res) => {
      if (!resolveBulkCsvImportEnabled()) {
        return res.status(403).json({ error: "Bulk CSV import is disabled" });
      }
      const entity = String((req.body || {}).entity || "clients");
      if (entity !== "clients") {
        return res
          .status(400)
          .json({ error: `Unsupported entity type: ${entity}` });
      }
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) return res.status(400).json({ error: "No file provided" });
      if (file.size > BULK_IMPORT_MAX_FILE_BYTES) {
        return res.status(400).json({
          error: `File is too large — max ${Math.floor(BULK_IMPORT_MAX_FILE_BYTES / (1024 * 1024))}MB`,
        });
      }

      const text = file.buffer.toString("utf8");
      const parsed = parseBulkCsv(text);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (parsed.rows.length === 0) {
        return res.status(400).json({ error: "CSV file has no data rows" });
      }
      if (parsed.rows.length > BULK_IMPORT_MAX_ROWS) {
        return res.status(400).json({
          error: `Too many rows — max ${BULK_IMPORT_MAX_ROWS} per file`,
        });
      }

      try {
        const validation = validateOptimumClientRows(
          parsed.headers,
          parsed.rows,
        );
        await resolveOptimumClientPackages(pool, validation.rows);
        await applyOptimumClientDbPreflight(pool, validation.rows);
        const summary = rebuildOptimumClientPreview(validation.rows);

        const expiresAt = new Date(Date.now() + BULK_IMPORT_JOB_TTL_MS);
        const fileSha256 = crypto
          .createHash("sha256")
          .update(file.buffer)
          .digest("hex");

        const [result] = await pool.query<ResultSetHeader>(
          `INSERT INTO bulk_import_jobs
             (entity, uploaded_by_admin_id, file_name, file_sha256, status, preview_json,
              row_count, created_count, skipped_count, error_count, expires_at)
           VALUES ('clients', ?, ?, ?, 'validated', ?, ?, 0, ?, ?, ?)`,
          [
            req.auth!.id,
            file.originalname || "clients.csv",
            fileSha256,
            JSON.stringify({ rows: validation.rows }),
            summary.row_count,
            summary.skipped_count,
            summary.error_count,
            expiresAt,
          ],
        );

        res.json({
          success: true,
          job_id: result.insertId,
          expires_at: expiresAt.toISOString(),
          row_count: summary.row_count,
          will_create_count: summary.will_create_count,
          skipped_count: summary.skipped_count,
          error_count: summary.error_count,
          preview_rows: summary.preview_rows,
          breakdown: {
            will_create: summary.will_create_count,
            skipped: summary.skipped_count,
            error: summary.error_count,
          },
        });
      } catch (err) {
        if (sendFriendlyError(res, err)) return;
        console.error("[bulk-import/validate]", err);
        res
          .status(500)
          .json({ error: "Failed to validate the file. Please try again." });
      }
    },
  );

  // Fetch a staged import job (status + preview + result, if committed)
  app.get(
    "/api/admin/bulk-import/:jobId",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const jobId = Number(req.params.jobId);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM bulk_import_jobs WHERE id = ? AND uploaded_by_admin_id = ? LIMIT 1`,
        [jobId, req.auth!.id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Import job not found" });
      const job = rows[0];
      const preview = parseBulkImportJsonField<{
        rows?: OptimumClientImportRow[];
      }>(job.preview_json);
      const previewSummary = preview?.rows
        ? rebuildOptimumClientPreview(preview.rows)
        : null;
      res.json({
        job: {
          id: job.id,
          entity: job.entity,
          status: job.status,
          file_name: job.file_name,
          row_count: job.row_count,
          created_count: job.created_count,
          skipped_count: job.skipped_count,
          error_count: job.error_count,
          expires_at: job.expires_at,
          created_at: job.created_at,
          committed_at: job.committed_at,
        },
        will_create_count: previewSummary?.will_create_count ?? 0,
        preview_rows: previewSummary?.preview_rows ?? [],
        result: parseBulkImportJsonField(job.result_json),
      });
    },
  );

  // Commit a validated job — creates clients for `will_create` rows
  app.post(
    "/api/admin/bulk-import/:jobId/commit",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      if (!resolveBulkCsvImportEnabled()) {
        return res.status(403).json({ error: "Bulk CSV import is disabled" });
      }
      const jobId = Number(req.params.jobId);
      const sendWelcomeEmails = !!(req.body || {}).send_welcome_emails;

      const [jobRows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM bulk_import_jobs WHERE id = ? AND uploaded_by_admin_id = ? LIMIT 1`,
        [jobId, req.auth!.id],
      );
      if (jobRows.length === 0)
        return res.status(404).json({ error: "Import job not found" });
      const job = jobRows[0];

      if (new Date(job.expires_at as string).getTime() < Date.now()) {
        if (job.status === "validated") {
          await pool.query(
            `UPDATE bulk_import_jobs SET status = 'expired' WHERE id = ?`,
            [jobId],
          );
        }
        return res.status(410).json({
          error:
            "This import job has expired — please re-upload and validate again",
        });
      }
      if (job.status !== "validated") {
        return res.status(409).json({
          error: `Import job cannot be committed (status: ${job.status})`,
        });
      }

      const [claim] = await pool.query<ResultSetHeader>(
        `UPDATE bulk_import_jobs SET status = 'processing' WHERE id = ? AND status = 'validated'`,
        [jobId],
      );
      if (claim.affectedRows === 0) {
        return res
          .status(409)
          .json({ error: "Import job is already being processed" });
      }

      const preview = parseBulkImportJsonField<{
        rows?: OptimumClientImportRow[];
      }>(job.preview_json);
      const rows = preview?.rows || [];

      let createdCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      const results: Array<{
        row_number: number;
        status: "created" | "skipped" | "error";
        entity_id?: number | null;
        message?: string;
        external_ref?: string | null;
      }> = [];

      try {
        for (const row of rows) {
          if (row.import_status === "error") {
            errorCount++;
            results.push({
              row_number: row.row_number,
              status: "error",
              message: row.message,
              external_ref: row.external_ref,
            });
            continue;
          }
          if (row.import_status === "skipped") {
            skippedCount++;
            results.push({
              row_number: row.row_number,
              status: "skipped",
              message: row.message,
              external_ref: row.external_ref,
            });
            continue;
          }
          // will_create — re-check for email conflicts created since validation
          try {
            if (row.email) {
              const [dupRows] = await pool.query<RowDataPacket[]>(
                `SELECT id FROM clients WHERE email = ? LIMIT 1`,
                [row.email],
              );
              if (dupRows.length > 0) {
                skippedCount++;
                results.push({
                  row_number: row.row_number,
                  status: "skipped",
                  entity_id: dupRows[0].id as number,
                  message: "A client with this email already exists",
                  external_ref: row.external_ref,
                });
                continue;
              }
            }
            const [insertResult] = await pool.query<ResultSetHeader>(
              `INSERT INTO clients
                 (first_name, last_name, email, phone, package_id, status, preferred_language,
                  admin_notes, address_line1, address_line2, city, state, zip, date_of_birth)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                row.first_name,
                row.last_name,
                row.email || null,
                row.phone || null,
                row.package_id,
                row.client_status,
                row.preferred_language,
                row.admin_notes,
                row.address_line1,
                row.address_line2,
                row.city,
                row.state,
                row.zip,
                row.date_of_birth,
              ],
            );
            const clientId = insertResult.insertId;
            createdCount++;
            results.push({
              row_number: row.row_number,
              status: "created",
              entity_id: clientId,
              external_ref: row.external_ref,
            });

            if (sendWelcomeEmails && row.email) {
              try {
                const token = await createOnboardingToken(clientId, 72);
                const portalUrl = `${APP_URL}/portal/onboarding/${token}`;
                const tpl = tplClientWelcome({
                  firstName: row.first_name,
                  portalUrl,
                  lang: row.preferred_language,
                });
                await sendEmail({
                  to: row.email,
                  subject: tpl.subject,
                  html: tpl.html,
                });
              } catch (emailErr) {
                console.error(
                  "[bulk-import/commit] welcome email failed:",
                  emailErr,
                );
              }
            }
          } catch (rowErr) {
            errorCount++;
            const friendly = mapFriendlyError(rowErr, {
              duplicateLabel: "email",
            });
            results.push({
              row_number: row.row_number,
              status: "error",
              message: friendly?.error || "Failed to create client",
              external_ref: row.external_ref,
            });
          }
        }

        await pool.query(
          `UPDATE bulk_import_jobs
           SET status = 'committed', result_json = ?, created_count = ?, skipped_count = ?, error_count = ?, committed_at = NOW()
           WHERE id = ?`,
          [
            JSON.stringify({ results }),
            createdCount,
            skippedCount,
            errorCount,
            jobId,
          ],
        );

        res.json({
          success: true,
          created_count: createdCount,
          skipped_count: skippedCount,
          error_count: errorCount,
          results,
        });
      } catch (err) {
        await pool.query(
          `UPDATE bulk_import_jobs SET status = 'failed', result_json = ? WHERE id = ?`,
          [JSON.stringify({ results, error: String(err) }), jobId],
        );
        console.error("[bulk-import/commit]", err);
        res
          .status(500)
          .json({
            error: "Failed to commit the import job. Please try again.",
          });
      }
    },
  );

  app.post(
    "/api/admin/clients/:id/stage",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const { stage, notes } = req.body || {};
      const allowed = [
        "new_client",
        "docs_ready",
        "round_1",
        "round_2",
        "round_3",
        "round_4",
        "round_5",
        "completed",
        "cancelled",
      ];
      if (!allowed.includes(stage))
        return res.status(400).json({ error: "Invalid stage" });
      const [cur] = await pool.query<RowDataPacket[]>(
        `SELECT pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
        [id],
      );
      if (cur.length === 0) return res.status(404).json({ error: "Not found" });

      const scope = await getAffiliateScope(req.auth!.id);
      if (scope && !scope.hasPortalAccess) {
        return res.status(403).json({ error: "Portal access required" });
      }
      if (scope && !(await assertClientInAffiliateScope(id, scope))) {
        return res.status(404).json({ error: "Not found" });
      }

      const fromStage = cur[0].pipeline_stage as string;
      if (fromStage === stage) return res.json({ ok: true, unchanged: true });

      // Leaving Prospect requires convert (welcome email, tasks, onboarding).
      // Also block when client status is still prospect even if stage drifted.
      const [statusRows] = await pool.query<RowDataPacket[]>(
        `SELECT status FROM clients WHERE id = ? LIMIT 1`,
        [id],
      );
      const clientStatus = statusRows[0]?.status as string | undefined;
      if (fromStage === "prospect" || clientStatus === "prospect") {
        return res.status(409).json({
          error:
            "Prospects must be converted via POST /api/admin/prospects/:id/convert (drag Prospect → New Client).",
        });
      }

      const [prospectCases] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM credit_repair_cases
         WHERE client_id = ? AND status = 'active' AND pipeline_stage = 'prospect'
         LIMIT 1`,
        [id],
      );
      if (prospectCases.length > 0) {
        return res.status(409).json({
          error:
            "Prospect-stage cases must be converted via POST /api/admin/prospects/:id/convert.",
        });
      }

      // Enforce docs_ready rule: all 4 required docs must be approved
      if (stage === "docs_ready") {
        const REQUIRED = [
          "id_front",
          "id_back",
          "ssn_card",
          "proof_of_address",
        ];
        const [docRows] = await pool.query<RowDataPacket[]>(
          `SELECT doc_type, review_status FROM client_documents
           WHERE client_id = ? AND doc_type IN (?) ORDER BY uploaded_at DESC`,
          [id, REQUIRED],
        );
        // Keep only the latest doc per type
        const latestByType: Record<string, string> = {};
        for (const d of docRows) {
          if (!latestByType[d.doc_type as string])
            latestByType[d.doc_type as string] = d.review_status as string;
        }
        const approved = REQUIRED.filter((t) => latestByType[t] === "approved");
        if (approved.length < 4) {
          return res.status(422).json({
            error: `Cannot advance to Docs Verified — ${4 - approved.length} required document(s) still need approval.`,
          });
        }
      }
      const { unchanged } = await advanceCasePipeline(pool, {
        clientId: id,
        stage,
        adminId: req.auth!.id,
        notes: notes || null,
      });
      if (unchanged) return res.json({ ok: true, unchanged: true });

      // Trigger reminder flows for docs_ready / completed stages
      if (stage === "docs_ready") {
        triggerReminderFlow("docs_ready", id).catch((e) =>
          console.error("[flow:docs_ready]", e?.message),
        );
      }
      if (stage === "completed") {
        triggerReminderFlow("completed", id).catch((e) =>
          console.error("[flow:completed]", e?.message),
        );
      }
      // Async CRC sync when stage changes — do not block response
      crcSyncClient(id).catch((e) =>
        console.error("[crc:stage-sync]", e?.message),
      );
      res.json({ ok: true });
    },
  );

  // ============================================================
  // CREDIT REPAIR CLOUD — ADMIN ENDPOINTS
  // ============================================================

  /** GET /api/admin/crc/status — check CRC configuration */
  app.get(
    "/api/admin/crc/status",
    requireAdmin,
    denyAffiliateAccess,
    (_req, res) => {
      res.json({
        configured: crcConfigured,
        dry_run: crcDryRun,
        mode: !crcConfigured ? "disabled" : crcDryRun ? "dry_run" : "live",
      });
    },
  );

  /**
   * GET /api/admin/crc/preview/:id — preview the XML payload for a client
   * without sending anything to CRC. Safe to use anytime.
   */
  app.get(
    "/api/admin/crc/preview/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
                c.address_line1, c.city, c.state, c.zip,
                c.ssn_last4, c.date_of_birth, c.pipeline_stage,
                c.crc_client_id, c.crc_synced_at
         FROM clients c WHERE c.id = ? LIMIT 1`,
        [id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Client not found" });
      const c = rows[0];
      const isUpdate = !!c.crc_client_id;
      const xmlData = buildCrcClientXml({
        id: isUpdate ? (c.crc_client_id as string) : null,
        type: mapStageToCrcType(c.pipeline_stage as string),
        firstname: c.first_name as string,
        lastname: c.last_name as string,
        email: (c.email as string) || null,
        phone_home: c.phone as string | null,
        street_address: c.address_line1 as string | null,
        city: c.city as string | null,
        state: c.state as string | null,
        zip: c.zip as string | null,
        ssno: c.ssn_last4 as string | null,
        birth_date: c.date_of_birth
          ? new Date(c.date_of_birth as string).toLocaleDateString("en-US")
          : null,
      });
      res.json({
        action: isUpdate ? "updateRecord" : "insertRecord",
        endpoint: isUpdate
          ? `${CRC_BASE_URL}/lead/updateRecord`
          : `${CRC_BASE_URL}/lead/insertRecord`,
        crc_client_id: c.crc_client_id ?? null,
        crc_synced_at: c.crc_synced_at ?? null,
        xmlData,
        note: "This is a preview only — nothing was sent to CRC.",
      });
    },
  );

  /**
   * POST /api/admin/crc/simulate-webhook — fire a fake Zapier stage-change
   * event against our own webhook handler. Useful for local testing without Zapier.
   *
   * Body: { clientId?: number, email?: string, stage: string }
   */
  app.post(
    "/api/admin/crc/simulate-webhook",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const { clientId, email, stage } = req.body || {};
      if (!stage) return res.status(400).json({ error: "Missing stage" });

      // Resolve the client's email if clientId provided
      let resolvedEmail = email;
      if (!resolvedEmail && clientId) {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT email FROM clients WHERE id = ? LIMIT 1`,
          [Number(clientId)],
        );
        resolvedEmail = rows[0]?.email;
      }
      if (!resolvedEmail)
        return res.status(400).json({ error: "Provide clientId or email" });

      // Forward internally to webhook handler (simulate Zapier POST).
      // Must call Express directly on its plain-HTTP port (not the Vite HTTPS port).
      const webhookSecret = process.env.CRC_WEBHOOK_SECRET || "";
      const internalRes = await fetch(
        `http://localhost:${process.env.EXPRESS_PORT || 8081}/api/webhooks/crc`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: webhookSecret,
            email: resolvedEmail,
            stage,
          }),
        },
      );
      const result = await internalRes.json();
      res.json({ simulated: true, webhook_response: result });
    },
  );

  /** POST /api/admin/clients/:id/crc-sync — manually push a client to CRC */
  app.post(
    "/api/admin/clients/:id/crc-sync",
    requireAdmin,
    async (req, res) => {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      try {
        await crcSyncClient(id);
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT crc_client_id, crc_synced_at FROM clients WHERE id = ? LIMIT 1`,
          [id],
        );
        res.json({
          ok: true,
          crc_client_id: rows[0]?.crc_client_id ?? null,
          crc_synced_at: rows[0]?.crc_synced_at ?? null,
        });
      } catch (e: any) {
        res.status(500).json({ error: e?.message ?? "CRC sync failed" });
      }
    },
  );

  /** GET /api/admin/crc/sync-log — latest CRC sync log entries */
  app.get(
    "/api/admin/crc/sync-log",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT l.id, l.client_id, c.first_name, c.last_name, c.email,
              l.action, l.crc_client_id, l.pipeline_stage,
              l.status, l.error_message, l.created_at
       FROM crc_sync_log l
       JOIN clients c ON c.id = l.client_id
       ORDER BY l.created_at DESC
       LIMIT ?`,
        [limit],
      );
      res.json(rows);
    },
  );

  // ============================================================
  // CREDIT REPAIR CLOUD — WEBHOOK (called by Zapier)
  // ============================================================
  /**
   * POST /api/webhooks/crc
   * Receives a stage-change event from Zapier (or CRC directly).
   *
   * Expected JSON body (sent by Zapier):
   * {
   *   "secret": "<CRC_WEBHOOK_SECRET>",  // optional shared secret
   *   "email": "client@example.com",     // used to look up local client
   *   "crc_client_id": "ODY4",           // CRC base64 ID (optional fallback)
   *   "stage": "Round 2 (Month 2)"       // stage name from CRC/GoHighLevel
   * }
   */
  app.post("/api/webhooks/crc", async (req, res) => {
    // Verify shared secret if configured (timing-safe comparison)
    const webhookSecret = process.env.CRC_WEBHOOK_SECRET;
    if (!webhookSecret) {
      if (IS_PROD) {
        console.error(
          "[crc:webhook] CRC_WEBHOOK_SECRET not configured in production — rejecting",
        );
        return res.status(503).json({ error: "Webhook not configured" });
      }
    } else {
      const provided = String(req.body?.secret ?? "");
      if (!timingSafeStringEqual(provided, webhookSecret)) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const { email, crc_client_id, stage } = req.body || {};

    if (!stage) return res.status(400).json({ error: "Missing stage" });
    if (!email && !crc_client_id)
      return res.status(400).json({ error: "Missing email or crc_client_id" });

    if (process.env.CRC_SYNC_STAGES === "false") {
      return res.json({
        ok: true,
        ignored: true,
        reason: "inbound_stage_sync_disabled",
      });
    }

    // Map CRC stage name → our enum
    const mapped = CRC_STAGE_MAP[String(stage).toLowerCase().trim()];
    if (!mapped) {
      console.warn("[crc:webhook] Unknown stage:", stage);
      return res.status(422).json({ error: `Unknown stage: ${stage}` });
    }

    // Find the client
    const params: (string | number)[] = [];
    let lookup = "";
    if (email) {
      lookup = "email = ?";
      params.push(String(email).toLowerCase().trim());
    } else {
      lookup = "crc_client_id = ?";
      params.push(String(crc_client_id));
    }

    const [clients] = await pool.query<RowDataPacket[]>(
      `SELECT id, pipeline_stage, crc_client_id FROM clients WHERE ${lookup} LIMIT 1`,
      params,
    );

    if (clients.length === 0) {
      console.warn("[crc:webhook] Client not found:", email || crc_client_id);
      // Return 200 so Zapier doesn't retry — we just can't find this client
      return res.json({ ok: false, reason: "client_not_found" });
    }

    const client = clients[0];
    const clientId = client.id as number;
    const fromStage = client.pipeline_stage as string;

    // Store crc_client_id if we didn't have it yet
    if (crc_client_id && !client.crc_client_id) {
      await pool.query<ResultSetHeader>(
        `UPDATE clients SET crc_client_id = ? WHERE id = ?`,
        [String(crc_client_id), clientId],
      );
    }

    if (fromStage === mapped) {
      return res.json({ ok: true, unchanged: true });
    }

    const [activeCases] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM credit_repair_cases
       WHERE client_id = ? AND status = 'active'
       ORDER BY id DESC LIMIT 1`,
      [clientId],
    );
    const activeCaseId =
      activeCases.length > 0 ? (activeCases[0].id as number) : null;

    await advanceCasePipeline(pool, {
      clientId,
      caseId: activeCaseId,
      stage: mapped,
      notes: "Automated: CRC webhook",
    });

    // Log the webhook sync
    await pool.query<ResultSetHeader>(
      `INSERT INTO crc_sync_log (client_id, action, crc_client_id, pipeline_stage, status, payload)
       VALUES (?, 'webhook_stage_update', ?, ?, 'success', ?)`,
      [
        clientId,
        crc_client_id || client.crc_client_id || null,
        mapped,
        JSON.stringify({ from: fromStage, to: mapped, raw_stage: stage }),
      ],
    );

    // Trigger reminder flow for completed stage
    if (mapped === "completed") {
      triggerReminderFlow("completed", clientId).catch((e) =>
        console.error("[flow:completed]", e?.message),
      );
    }
    if (mapped === "docs_ready") {
      triggerReminderFlow("docs_ready", clientId).catch((e) =>
        console.error("[flow:docs_ready]", e?.message),
      );
    }

    res.json({ ok: true, stage: mapped, clientId });
  });

  app.get(
    "/api/admin/documents",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const status = (req.query.status as string) || "all";
      const search = ((req.query.search as string) || "").trim();

      const params: (string | number)[] = [];
      const conditions: string[] = [
        "t.task_type = 'upload'",
        "ctc.file_name IS NOT NULL",
        "ctc.status = 'completed'",
      ];

      if (status !== "all") {
        conditions.push("ctc.admin_review_status = ?");
        params.push(status);
      }
      if (search) {
        conditions.push(
          "(cl.first_name LIKE ? ESCAPE '!' OR cl.last_name LIKE ? ESCAPE '!' OR cl.email LIKE ? ESCAPE '!' OR ctc.file_name LIKE ? ESCAPE '!')",
        );
        const like = likeContains(search);
        params.push(like, like, like, like);
      }

      const where = `WHERE ${conditions.join(" AND ")}`;

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ctc.id, ctc.client_id,
              t.slug AS doc_type,
              NULL AS pipeline_round,
              ctc.file_name, 0 AS file_size, ctc.file_mime AS mime_type,
              ctc.admin_review_status AS review_status,
              ctc.admin_notes AS rejection_reason,
              ctc.completed_at AS uploaded_at,
              ctc.admin_reviewed_at AS reviewed_at,
              cl.first_name, cl.last_name, cl.email, cl.preferred_language,
              crc.case_number
       FROM client_task_completions ctc
       JOIN onboarding_task_templates t ON t.id = ctc.task_template_id
       JOIN clients cl ON cl.id = ctc.client_id
       LEFT JOIN credit_repair_cases crc ON crc.id = ctc.case_id
       ${where}
       ORDER BY ctc.completed_at DESC LIMIT 500`,
        params,
      );
      res.json({ documents: rows });
    },
  );

  app.patch(
    "/api/admin/documents/:id/pipeline-round",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const { pipeline_round } = req.body || {};
      const VALID_ROUNDS = [
        "new_client",
        "docs_ready",
        "round_1",
        "round_2",
        "round_3",
        "round_4",
        "round_5",
        "completed",
        "cancelled",
      ];
      if (
        pipeline_round !== null &&
        pipeline_round !== undefined &&
        !VALID_ROUNDS.includes(pipeline_round)
      ) {
        return res.status(400).json({ error: "Invalid pipeline_round value" });
      }
      await pool.query<ResultSetHeader>(
        `UPDATE client_documents SET pipeline_round = ? WHERE id = ?`,
        [pipeline_round || null, id],
      );
      res.json({ ok: true });
    },
  );

  // Serve decrypted document file to admin (streamed, authenticated)
  app.get(
    "/api/admin/documents/:id/file",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_storage_key, file_name, file_mime
         FROM client_task_completions WHERE id = ? LIMIT 1`,
        [id],
      );
      if (rows.length === 0 || !rows[0].file_storage_key)
        return res.status(404).json({ error: "Not found" });
      const doc = rows[0];
      const parts = (doc.file_storage_key as string).split("|");
      if (parts.length !== 3)
        return res.status(500).json({ error: "Invalid storage key format" });
      const [cdnKey, iv, tag] = parts;
      try {
        const cdnRes = await fetch(cdnKey);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const encrypted = Buffer.from(await cdnRes.arrayBuffer());
        const buf = decryptFile(encrypted, iv, tag);
        res.set(
          "Content-Type",
          (doc.file_mime as string) || "application/octet-stream",
        );
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(doc.file_name as string)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(404).json({ error: "File not found" });
      }
    },
  );

  app.post(
    "/api/admin/documents/:id/review",
    requireSuperAdmin,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      const { decision, reason } = req.body || {};
      if (!["approved", "rejected"].includes(decision)) {
        return res
          .status(400)
          .json({ error: "decision must be approved or rejected" });
      }
      if (decision === "rejected" && !reason) {
        return res.status(400).json({ error: "Reason required for rejection" });
      }
      const [docs] = await pool.query<RowDataPacket[]>(
        `SELECT d.id, d.doc_type, d.client_id, c.first_name, c.email, c.phone, c.preferred_language
         FROM client_documents d JOIN clients c ON c.id = d.client_id
         WHERE d.id = ? LIMIT 1`,
        [id],
      );
      if (docs.length === 0)
        return res.status(404).json({ error: "Not found" });
      const d = docs[0];
      await pool.query<ResultSetHeader>(
        `UPDATE client_documents
         SET review_status = ?, rejection_reason = ?, reviewed_by_admin_id = ?, reviewed_at = NOW()
         WHERE id = ?`,
        [decision, decision === "rejected" ? reason : null, req.auth!.id, id],
      );

      if (decision === "rejected") {
        const portalUrl = `${APP_URL}/portal/documents`;
        const tpl = tplDocumentRejected({
          firstName: d.first_name,
          docType: d.doc_type,
          reason,
          portalUrl,
          lang: d.preferred_language || "en",
        });
        await sendEmail({
          to: d.email,
          subject: tpl.subject,
          html: tpl.html,
        }).catch(() => null);
        if (d.phone) {
          await sendSms({
            to: d.phone,
            body: `Optimum Credit: your ${DOC_TYPE_LABELS[d.doc_type] || d.doc_type} needs to be re-uploaded. Reason: ${reason}. Log in at: ${APP_URL}/portal/documents`,
          }).catch(() => null);
        }
      }

      const required = ["id_front", "id_back", "ssn_card", "proof_of_address"];
      const [docStats] = await pool.query<RowDataPacket[]>(
        `SELECT doc_type, MAX(review_status = 'approved') AS approved
         FROM client_documents
         WHERE client_id = ? AND doc_type IN ('id_front','id_back','ssn_card','proof_of_address')
         GROUP BY doc_type`,
        [d.client_id],
      );
      const approvedSet = new Set(
        (docStats as any[])
          .filter((r) => Number(r.approved) === 1)
          .map((r) => r.doc_type),
      );
      const allApproved = required.every((r) => approvedSet.has(r));
      if (allApproved) {
        const [cur] = await pool.query<RowDataPacket[]>(
          `SELECT pipeline_stage FROM clients WHERE id = ? LIMIT 1`,
          [d.client_id],
        );
        if (cur[0]?.pipeline_stage === "new_client") {
          // advanceCasePipeline also moves the client's active credit_repair_cases
          // row to docs_ready — a plain UPDATE clients here would leave the case
          // stuck at new_client and out of sync with the client.
          await advanceCasePipeline(pool, {
            clientId: d.client_id,
            stage: "docs_ready",
            adminId: req.auth!.id,
            notes: "Auto-advanced: all documents approved",
          });
          await pool.query<ResultSetHeader>(
            `UPDATE clients SET status='active' WHERE id = ? AND status <> 'active'`,
            [d.client_id],
          );
          triggerReminderFlow("docs_ready", d.client_id).catch((e) =>
            console.error("[flow:docs_ready]", e?.message),
          );
          // Notify client that all their documents have been approved
          const portalUrl = `${APP_URL}/portal/documents`;
          const approvedTpl = tplAllDocsApproved({
            firstName: d.first_name,
            portalUrl,
            lang: d.preferred_language || "en",
          });
          await sendEmail({
            to: d.email,
            subject: approvedTpl.subject,
            html: approvedTpl.html,
          }).catch(() => null);
          if (d.phone) {
            await sendSms({
              to: d.phone,
              body: `Optimum Credit: great news! All your documents have been verified and your case is now being processed. Log in to track your progress: ${APP_URL}/portal`,
            }).catch(() => null);
          }
        }
      }

      res.json({ ok: true, auto_advanced: allApproved });
    },
  );

  app.post(
    "/api/admin/clients/:id/round-reports",
    requireSuperAdmin,
    (_req, res) => {
      res.status(410).json({
        error:
          "Manual round reports are deprecated. Use the OFG Report Wizard (POST /admin/cases/{caseId}/report-wizard/sessions).",
      });
    },
  );

  app.post(
    "/api/admin/clients/:clientId/round-reports/:round/pdf",
    requireSuperAdmin,
    (_req, res) => {
      res.status(410).json({
        error:
          "Manual PDF upload is deprecated. Use the OFG Report Wizard to generate compliant progress reports.",
      });
    },
  );

  // ── Serve a specific round_report_pdfs entry (admin) ─────────────────────
  app.get(
    "/api/admin/round-report-pdfs/:pdfId",
    requireAdmin,
    async (req, res) => {
      const pdfId = Number(req.params.pdfId);
      if (!pdfId || isNaN(pdfId))
        return res.status(400).json({ error: "Invalid id" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, storage_key, storage_provider, encrypted, enc_iv, enc_tag
         FROM round_report_pdfs WHERE id = ? LIMIT 1`,
        [pdfId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "PDF not found" });
      const r = rows[0];
      try {
        const cdnRes = await fetch(r.storage_key as string);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const raw = Buffer.from(await cdnRes.arrayBuffer());
        const buf =
          r.encrypted && r.enc_iv && r.enc_tag
            ? decryptFile(raw, r.enc_iv as string, r.enc_tag as string)
            : raw;
        res.set("Content-Type", "application/pdf");
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(r.file_name as string)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(500).json({ error: "Failed to retrieve PDF" });
      }
    },
  );

  // ── Delete a specific round_report_pdfs entry (super_admin) ──────────────
  app.delete(
    "/api/admin/round-report-pdfs/:pdfId",
    requireSuperAdmin,
    async (req, res) => {
      const pdfId = Number(req.params.pdfId);
      if (!pdfId || isNaN(pdfId))
        return res.status(400).json({ error: "Invalid id" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, client_id, round_number FROM round_report_pdfs WHERE id = ? LIMIT 1`,
        [pdfId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "PDF not found" });

      await pool.query(`DELETE FROM round_report_pdfs WHERE id = ?`, [pdfId]);
      res.json({ ok: true });
    },
  );

  // ── Legacy: serve latest PDF for a round report row (admin) ──────────────
  app.get(
    "/api/admin/round-reports/:reportId/pdf",
    requireAdmin,
    async (req, res) => {
      const reportId = Number(req.params.reportId);
      if (!reportId || isNaN(reportId))
        return res.status(400).json({ error: "Invalid id" });

      // Try new table first
      const [newRows] = await pool.query<RowDataPacket[]>(
        `SELECT rrp.file_name, rrp.storage_key, rrp.storage_provider, rrp.encrypted, rrp.enc_iv, rrp.enc_tag
         FROM round_report_pdfs rrp WHERE rrp.round_report_id = ?
         ORDER BY rrp.uploaded_at DESC LIMIT 1`,
        [reportId],
      );
      // Fall back to legacy pdf_ columns
      const [legacyRows] =
        newRows.length === 0
          ? await pool.query<RowDataPacket[]>(
              `SELECT pdf_file_name AS file_name, pdf_storage_key AS storage_key,
                  pdf_storage_provider AS storage_provider, pdf_encrypted AS encrypted,
                  pdf_enc_iv AS enc_iv, pdf_enc_tag AS enc_tag
           FROM client_round_reports WHERE id = ? AND pdf_storage_key IS NOT NULL LIMIT 1`,
              [reportId],
            )
          : [[] as RowDataPacket[]];
      const r = newRows[0] ?? legacyRows[0] ?? null;
      if (!r) return res.status(404).json({ error: "PDF not found" });
      try {
        const cdnRes = await fetch(r.storage_key as string);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const raw = Buffer.from(await cdnRes.arrayBuffer());
        const buf =
          r.encrypted && r.enc_iv && r.enc_tag
            ? decryptFile(raw, r.enc_iv as string, r.enc_tag as string)
            : raw;
        res.set("Content-Type", "application/pdf");
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent((r.file_name as string) || `round-report-${reportId}.pdf`)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(500).json({ error: "Failed to retrieve PDF" });
      }
    },
  );

  // ── Serve a specific round_report_pdfs entry (client portal) ─────────────
  app.get(
    "/api/portal/round-report-pdfs/:pdfId",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const pdfId = Number(req.params.pdfId);
      if (!pdfId || isNaN(pdfId))
        return res.status(400).json({ error: "Invalid id" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, storage_key, storage_provider, encrypted, enc_iv, enc_tag
         FROM round_report_pdfs WHERE id = ? AND client_id = ? LIMIT 1`,
        [pdfId, clientId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "PDF not found" });
      const r = rows[0];
      try {
        const cdnRes = await fetch(r.storage_key as string);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const raw = Buffer.from(await cdnRes.arrayBuffer());
        const buf =
          r.encrypted && r.enc_iv && r.enc_tag
            ? decryptFile(raw, r.enc_iv as string, r.enc_tag as string)
            : raw;
        res.set("Content-Type", "application/pdf");
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(r.file_name as string)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(500).json({ error: "Failed to retrieve PDF" });
      }
    },
  );

  // ── Legacy: serve latest PDF for a round (client portal) ─────────────────
  app.get(
    "/api/portal/round-reports/:round/pdf",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const roundNumber = Number(req.params.round);
      if (isNaN(roundNumber) || roundNumber < 1 || roundNumber > 5) {
        return res.status(400).json({ error: "Invalid round number" });
      }

      // Try new table first (latest PDF for this round)
      const [newRows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, storage_key, storage_provider, encrypted, enc_iv, enc_tag
         FROM round_report_pdfs WHERE client_id = ? AND round_number = ?
         ORDER BY uploaded_at DESC LIMIT 1`,
        [clientId, roundNumber],
      );
      // Fall back to legacy pdf_ columns
      const [legacyRows] =
        newRows.length === 0
          ? await pool.query<RowDataPacket[]>(
              `SELECT pdf_file_name AS file_name, pdf_storage_key AS storage_key,
                  pdf_storage_provider AS storage_provider, pdf_encrypted AS encrypted,
                  pdf_enc_iv AS enc_iv, pdf_enc_tag AS enc_tag
           FROM client_round_reports
           WHERE client_id = ? AND round_number = ? AND pdf_storage_key IS NOT NULL LIMIT 1`,
              [clientId, roundNumber],
            )
          : [[] as RowDataPacket[]];
      const r = newRows[0] ?? legacyRows[0] ?? null;
      if (!r) return res.status(404).json({ error: "PDF not found" });
      try {
        const cdnRes = await fetch(r.storage_key as string);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const raw = Buffer.from(await cdnRes.arrayBuffer());
        const buf =
          r.encrypted && r.enc_iv && r.enc_tag
            ? decryptFile(raw, r.enc_iv as string, r.enc_tag as string)
            : raw;
        const fileName =
          (r.file_name as string) || `round-${roundNumber}-report.pdf`;
        res.set("Content-Type", "application/pdf");
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(fileName)}"`,
        );
        res.set("Content-Length", String(buf.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(buf);
      } catch {
        res.status(500).json({ error: "Failed to retrieve PDF" });
      }
    },
  );

  app.get(
    "/api/admin/conversations",
    requireAdmin,
    denyAffiliateAccess,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT cv.id, cv.channel, cv.status, cv.last_message_at, cv.last_message_preview, cv.unread_count,
              c.id AS client_id, c.first_name, c.last_name, c.email, c.phone
       FROM conversations cv JOIN clients c ON c.id = cv.client_id
       ORDER BY cv.last_message_at DESC LIMIT 100`,
      );
      res.json({ conversations: rows });
    },
  );

  app.get(
    "/api/admin/conversations/:id/messages",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, direction, channel, body, from_address, to_address, sent_by_admin_id, created_at
       FROM conversation_messages WHERE conversation_id = ? ORDER BY id ASC`,
        [req.params.id],
      );
      res.json({ messages: rows });
    },
  );

  app.post(
    "/api/admin/conversations/send",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const { client_id, channel, body, subject } = req.body || {};
      if (!client_id || !channel || !body)
        return res.status(400).json({ error: "Missing fields" });
      const [crows] = await pool.query<RowDataPacket[]>(
        `SELECT email, phone, first_name FROM clients WHERE id = ? LIMIT 1`,
        [client_id],
      );
      if (crows.length === 0)
        return res.status(404).json({ error: "Client not found" });
      const c = crows[0];

      let conversationId: number;
      const [conv] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM conversations WHERE client_id = ? AND channel = ? LIMIT 1`,
        [client_id, channel],
      );
      if (conv.length > 0) {
        conversationId = conv[0].id as number;
      } else {
        const [r] = await pool.query<ResultSetHeader>(
          `INSERT INTO conversations (client_id, channel, status, assigned_admin_id) VALUES (?,?,?,?)`,
          [client_id, channel, "open", req.auth!.id],
        );
        conversationId = r.insertId;
      }

      let providerId: string | undefined;
      let toAddress = "";
      if (channel === "sms") {
        if (!c.phone)
          return res.status(400).json({ error: "Client has no phone" });
        toAddress = c.phone;
        const result = await sendSms({ to: c.phone, body }).catch((e) => {
          console.error(e);
          return null;
        });
        providerId = result?.sid;
      } else if (channel === "email") {
        toAddress = c.email;
        const result = await sendEmail({
          to: c.email,
          subject: subject || `Message from Optimum Credit`,
          html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#0f172a;">${String(body).replace(/\n/g, "<br/>")}</div>`,
        }).catch((e) => {
          console.error(e);
          return null;
        });
        providerId = result?.id;
      } else {
        return res.status(400).json({ error: "Unsupported channel" });
      }

      await pool.query<ResultSetHeader>(
        `INSERT INTO conversation_messages (conversation_id, direction, channel, body, to_address, sent_by_admin_id, provider_message_id) VALUES (?, 'outbound', ?, ?, ?, ?, ?)`,
        [
          conversationId,
          channel,
          body,
          toAddress,
          req.auth!.id,
          providerId || null,
        ],
      );
      await pool.query<ResultSetHeader>(
        `UPDATE conversations SET last_message_at = NOW(), last_message_preview = ? WHERE id = ?`,
        [String(body).slice(0, 200), conversationId],
      );
      res.json({ ok: true, conversation_id: conversationId });
    },
  );

  app.get(
    "/api/admin/tickets",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const status = req.query.status as string | undefined;
      const args: any[] = [];
      let where = "";
      if (status) {
        where = "WHERE t.status = ?";
        args.push(status);
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id, t.subject, t.status, t.priority, t.category, t.created_at, t.updated_at,
              c.id AS client_id, c.first_name, c.last_name, c.email
       FROM support_tickets t JOIN clients c ON c.id = t.client_id
       ${where}
       ORDER BY t.created_at DESC LIMIT 200`,
        args,
      );
      res.json({ tickets: rows });
    },
  );

  app.get(
    "/api/admin/tickets/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const [t] = await pool.query<RowDataPacket[]>(
        `SELECT t.*, c.first_name, c.last_name, c.email
       FROM support_tickets t JOIN clients c ON c.id = t.client_id WHERE t.id = ? LIMIT 1`,
        [req.params.id],
      );
      if (t.length === 0) return res.status(404).json({ error: "Not found" });
      const [replies] = await pool.query<RowDataPacket[]>(
        `SELECT id, author_type, author_admin_id, author_client_id, body, is_internal_note, created_at
       FROM support_ticket_replies WHERE ticket_id = ? ORDER BY id ASC`,
        [req.params.id],
      );
      res.json({ ticket: t[0], replies });
    },
  );

  app.post(
    "/api/admin/tickets/:id/replies",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const { body, is_internal_note } = req.body || {};
      if (!body) return res.status(400).json({ error: "Body required" });
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO support_ticket_replies (ticket_id, author_type, author_admin_id, body, is_internal_note) VALUES (?, 'admin', ?, ?, ?)`,
        [req.params.id, req.auth!.id, body, is_internal_note ? 1 : 0],
      );
      await pool.query<ResultSetHeader>(
        `UPDATE support_tickets SET status='in_progress', updated_at=NOW() WHERE id = ?`,
        [req.params.id],
      );
      res.json({ id: r.insertId });
    },
  );

  app.post(
    "/api/admin/tickets/:id/status",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const { status } = req.body || {};
      const allowed = [
        "open",
        "in_progress",
        "waiting_client",
        "resolved",
        "closed",
      ];
      if (!allowed.includes(status))
        return res.status(400).json({ error: "Invalid status" });
      await pool.query<ResultSetHeader>(
        `UPDATE support_tickets SET status = ?, resolved_at = CASE WHEN ? IN ('resolved','closed') THEN NOW() ELSE NULL END WHERE id = ?`,
        [status, status, req.params.id],
      );
      res.json({ ok: true });
    },
  );

  // Support FAQ — admin CRUD
  app.get(
    "/api/admin/support-faq",
    requireAdmin,
    denyAffiliateAccess,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, question, answer, category, sort_order, is_active, created_at, updated_at FROM support_faq ORDER BY sort_order ASC, id ASC`,
      );
      res.json({ faqs: rows });
    },
  );

  app.post(
    "/api/admin/support-faq",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const { question, answer, category, sort_order, is_active } =
        req.body || {};
      if (!question || !answer)
        return res
          .status(400)
          .json({ error: "question and answer are required" });
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO support_faq (question, answer, category, sort_order, is_active) VALUES (?, ?, ?, ?, ?)`,
        [
          question,
          answer,
          category || "general",
          sort_order ?? 0,
          is_active !== false ? 1 : 0,
        ],
      );
      res.json({ id: r.insertId });
    },
  );

  app.put(
    "/api/admin/support-faq/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const { question, answer, category, sort_order, is_active } =
        req.body || {};
      await pool.query<ResultSetHeader>(
        `UPDATE support_faq SET question = COALESCE(?, question), answer = COALESCE(?, answer), category = COALESCE(?, category), sort_order = COALESCE(?, sort_order), is_active = COALESCE(?, is_active) WHERE id = ?`,
        [
          question ?? null,
          answer ?? null,
          category ?? null,
          sort_order ?? null,
          is_active != null ? (is_active ? 1 : 0) : null,
          req.params.id,
        ],
      );
      res.json({ ok: true });
    },
  );

  app.delete(
    "/api/admin/support-faq/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      await pool.query<ResultSetHeader>(
        `DELETE FROM support_faq WHERE id = ?`,
        [req.params.id],
      );
      res.json({ ok: true });
    },
  );

  app.get(
    "/api/admin/templates",
    requireAdmin,
    denyAffiliateAccess,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, slug, name, channel, subject, body, variables_json, is_active, updated_at
       FROM communication_templates ORDER BY channel, name`,
      );
      res.json({ templates: rows });
    },
  );

  app.post(
    "/api/admin/templates/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const { name, subject, body, is_active } = req.body || {};
      await pool.query<ResultSetHeader>(
        `UPDATE communication_templates SET name = COALESCE(?, name), subject = ?, body = COALESCE(?, body), is_active = COALESCE(?, is_active) WHERE id = ?`,
        [
          name || null,
          subject ?? null,
          body || null,
          typeof is_active === "boolean" ? (is_active ? 1 : 0) : null,
          req.params.id,
        ],
      );
      res.json({ ok: true });
    },
  );

  app.post(
    "/api/admin/templates",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const { slug, name, channel, subject, body, variables } = req.body || {};
      if (!slug || !name || !channel || !body) {
        return res
          .status(400)
          .json({ error: "slug, name, channel and body are required" });
      }
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM communication_templates WHERE slug = ? LIMIT 1`,
        [slug],
      );
      if ((existing as RowDataPacket[]).length > 0) {
        return res
          .status(409)
          .json({ error: "A template with this slug already exists" });
      }
      const vars =
        Array.isArray(variables) && variables.length > 0
          ? JSON.stringify(variables)
          : null;
      try {
        const [result] = await pool.query<ResultSetHeader>(
          `INSERT INTO communication_templates (slug, name, channel, subject, body, variables_json, is_active) VALUES (?,?,?,?,?,?,1)`,
          [slug, name, channel, subject || null, body, vars],
        );
        res.json({ ok: true, id: result.insertId });
      } catch (err: unknown) {
        if (sendFriendlyError(res, err, { duplicateLabel: "slug" })) return;
        throw err;
      }
    },
  );

  app.delete(
    "/api/admin/templates/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      // Guard: block delete if template is referenced by any reminder flow step
      const [usages] = await pool.query<RowDataPacket[]>(
        `SELECT rf.name AS flow_name
       FROM reminder_flow_steps rfs
       JOIN reminder_flows rf ON rf.id = rfs.flow_id
       JOIN communication_templates ct ON ct.slug = rfs.template_slug
       WHERE ct.id = ?`,
        [req.params.id],
      );
      if ((usages as RowDataPacket[]).length > 0) {
        const flows = [
          ...new Set(
            (usages as RowDataPacket[]).map((u) => u.flow_name as string),
          ),
        ];
        return res.status(409).json({
          error: "Template is used in active reminder flows",
          flows,
        });
      }
      await pool.query<ResultSetHeader>(
        `DELETE FROM communication_templates WHERE id = ?`,
        [req.params.id],
      );
      res.json({ ok: true });
    },
  );

  app.get(
    "/api/admin/videos",
    requireAdmin,
    denyAffiliateAccess,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM educational_videos ORDER BY sort_order ASC, id DESC`,
      );
      res.json({ videos: rows });
    },
  );

  // Upload a file to CDN and return the URL (no DB write)
  app.post(
    "/api/admin/educational-content/upload",
    requireAdmin,
    upload.single("file"),
    async (req, res) => {
      const f = (req as any).file as Express.Multer.File | undefined;
      if (!f) return res.status(400).json({ error: "No file provided" });
      try {
        const cdnUrl = await uploadToCDN(
          f.buffer,
          f.originalname,
          f.mimetype,
          "education",
        );
        res.json({ url: cdnUrl, mime_type: f.mimetype, size: f.size });
      } catch (err: any) {
        console.error("[educational-content/upload]", err?.message ?? err);
        res.status(500).json({ error: "Upload failed. Please try again." });
      }
    },
  );

  app.post(
    "/api/admin/videos",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const {
        title,
        content_type,
        description,
        video_url,
        file_url,
        thumbnail_url,
        duration_seconds,
        category,
        language,
        is_published,
        sort_order,
      } = req.body || {};
      if (!title) return res.status(400).json({ error: "title is required" });
      const ctype = content_type || "video";
      if (ctype === "video" && !video_url && !file_url)
        return res
          .status(400)
          .json({ error: "video_url or file_url required for video content" });
      if (
        ["pdf", "image", "article"].includes(ctype) &&
        !file_url &&
        !video_url
      )
        return res
          .status(400)
          .json({ error: "file_url required for this content type" });
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO educational_videos
         (title, content_type, description, video_url, file_url, thumbnail_url,
          duration_seconds, category, language, is_published, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          title,
          ctype,
          description || null,
          video_url || null,
          file_url || null,
          thumbnail_url || null,
          duration_seconds || null,
          category || null,
          language || "en",
          is_published === false || is_published === 0 ? 0 : 1,
          sort_order || 0,
        ],
      );
      res.json({ id: r.insertId });
    },
  );

  app.put(
    "/api/admin/videos/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      const {
        title,
        content_type,
        description,
        video_url,
        file_url,
        thumbnail_url,
        duration_seconds,
        category,
        language,
        is_published,
        sort_order,
      } = req.body || {};
      if (!title) return res.status(400).json({ error: "title is required" });
      await pool.query<ResultSetHeader>(
        `UPDATE educational_videos
       SET title=?, content_type=?, description=?, video_url=?, file_url=?,
           thumbnail_url=?, duration_seconds=?, category=?, language=?,
           is_published=?, sort_order=?
       WHERE id=?`,
        [
          title,
          content_type || "video",
          description || null,
          video_url || null,
          file_url || null,
          thumbnail_url || null,
          duration_seconds || null,
          category || null,
          language || "en",
          is_published === false || is_published === 0 ? 0 : 1,
          sort_order ?? 0,
          id,
        ],
      );
      res.json({ ok: true });
    },
  );

  app.delete(
    "/api/admin/videos/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      await pool.query<ResultSetHeader>(
        `DELETE FROM educational_videos WHERE id = ?`,
        [req.params.id],
      );
      res.json({ ok: true });
    },
  );

  // ── ADMIN PAYMENTS ──────────────────────────────────────────────────────────
  app.get(
    "/api/admin/payments",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const status = (req.query.status as string) || "all";
      const search = ((req.query.search as string) || "").trim();
      const provider = (req.query.provider as string) || "";
      const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
      const limit = Math.min(
        100,
        Math.max(10, parseInt((req.query.limit as string) || "50", 10)),
      );
      const offset = (page - 1) * limit;

      const where: string[] = [];
      const args: any[] = [];

      if (status && status !== "all") {
        where.push("pay.status = ?");
        args.push(status);
      }
      if (provider && provider !== "all") {
        where.push("pay.provider = ?");
        args.push(provider);
      }
      if (search) {
        where.push(
          "(c.email LIKE ? ESCAPE '!' OR c.first_name LIKE ? ESCAPE '!' OR c.last_name LIKE ? ESCAPE '!' OR pay.provider_transaction_id LIKE ? ESCAPE '!')",
        );
        const like = likeContains(search);
        args.push(like, like, like, like);
      }

      const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const [payments] = await pool.query<RowDataPacket[]>(
        `SELECT pay.id, pay.client_id, pay.package_id, pay.amount_cents, pay.currency,
              COALESCE(pay.discount_cents, 0) AS discount_cents,
              pay.original_amount_cents,
              pay.status, pay.provider, pay.provider_transaction_id, pay.provider_charge_id,
              pay.failure_reason, pay.paid_at, pay.created_at, pay.updated_at,
              c.first_name AS client_first_name, c.last_name AS client_last_name,
              c.email AS client_email, c.phone AS client_phone,
              c.pipeline_stage AS client_pipeline_stage, c.status AS client_status,
              p.name AS package_name, p.slug AS package_slug,
              cp.code AS coupon_code
       FROM payments pay
       LEFT JOIN clients c ON c.id = pay.client_id
       LEFT JOIN packages p ON p.id = pay.package_id
       LEFT JOIN coupons cp ON cp.id = pay.coupon_id
       ${whereClause}
       ORDER BY pay.created_at DESC
       LIMIT ? OFFSET ?`,
        [...args, limit, offset],
      );

      const [countRow] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM payments pay
       LEFT JOIN clients c ON c.id = pay.client_id
       ${whereClause}`,
        args,
      );
      const total = Number(countRow[0]?.total ?? 0);

      const [summary] = await pool.query<RowDataPacket[]>(
        `SELECT
        COUNT(*) AS total_count,
        SUM(status = 'succeeded') AS succeeded_count,
        SUM(status = 'pending') AS pending_count,
        SUM(status = 'failed') AS failed_count,
        SUM(status = 'refunded') AS refunded_count,
        COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount_cents ELSE 0 END), 0) AS total_revenue_cents,
        COALESCE(SUM(CASE WHEN status = 'succeeded' AND paid_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN amount_cents ELSE 0 END), 0) AS revenue_30d_cents,
        COALESCE(SUM(CASE WHEN status = 'succeeded' AND paid_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN amount_cents ELSE 0 END), 0) AS revenue_7d_cents
       FROM payments`,
      );

      res.json({
        payments,
        summary: summary[0] || {},
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );

  // ── Refund a payment (ledger clawback) ──────────────────────────────────────
  // Marks the payment refunded and voids any pending/approved commissions
  // tied to it so affiliates aren't paid out on money that came back. This
  // does NOT call Authorize.net's refund/void API yet — it's a bookkeeping
  // clawback only. If the charge is still within the settlement window, ANet
  // still needs a separate void/refund performed through the merchant portal
  // (or a follow-up API integration) — this endpoint only fixes our ledger
  // and commission accounting.
  app.post(
    "/api/admin/payments/:id/refund",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, status FROM payments WHERE id = ? LIMIT 1`,
        [id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Payment not found" });
      if (rows[0].status === "refunded") {
        return res.json({ ok: true }); // already refunded — idempotent
      }
      if (rows[0].status !== "succeeded") {
        return res.status(400).json({
          error: "Only succeeded payments can be refunded",
        });
      }
      await pool.query<ResultSetHeader>(
        `UPDATE payments SET status = 'refunded' WHERE id = ?`,
        [id],
      );
      await pool.query<ResultSetHeader>(
        `UPDATE affiliate_commissions SET status = 'void'
         WHERE payment_id = ? AND status IN ('pending','approved')`,
        [id],
      );
      res.json({ ok: true });
    },
  );

  // ── ADMIN SUBSCRIPTIONS ─────────────────────────────────────────────────────
  app.get(
    "/api/admin/subscriptions",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const status = (req.query.status as string) || "all";
      const search = ((req.query.search as string) || "").trim();
      const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
      const limit = Math.min(
        100,
        Math.max(10, parseInt((req.query.limit as string) || "50", 10)),
      );
      const offset = (page - 1) * limit;

      const where: string[] = [];
      const args: any[] = [];

      if (status && status !== "all") {
        where.push("cs.status = ?");
        args.push(status);
      }
      if (search) {
        where.push(
          "(c.email LIKE ? ESCAPE '!' OR c.first_name LIKE ? ESCAPE '!' OR c.last_name LIKE ? ESCAPE '!' OR cs.anet_subscription_id LIKE ? ESCAPE '!')",
        );
        const like = likeContains(search);
        args.push(like, like, like, like);
      }

      const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const [subscriptions] = await pool.query<RowDataPacket[]>(
        `SELECT cs.id, cs.client_id, cs.package_id, cs.anet_subscription_id,
              cs.status, cs.amount_cents, cs.billing_interval,
              cs.started_at, cs.cancelled_at, cs.next_billing_at,
              cs.created_at, cs.updated_at,
              c.first_name AS client_first_name, c.last_name AS client_last_name,
              c.email AS client_email, c.phone AS client_phone,
              c.pipeline_stage AS client_pipeline_stage, c.status AS client_status,
              p.name AS package_name, p.slug AS package_slug
       FROM client_subscriptions cs
       JOIN clients c ON c.id = cs.client_id
       JOIN packages p ON p.id = cs.package_id
       ${whereClause}
       ORDER BY cs.created_at DESC
       LIMIT ? OFFSET ?`,
        [...args, limit, offset],
      );

      const [countRow] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total
       FROM client_subscriptions cs
       JOIN clients c ON c.id = cs.client_id
       ${whereClause}`,
        args,
      );
      const total = Number(countRow[0]?.total ?? 0);

      const [summary] = await pool.query<RowDataPacket[]>(
        `SELECT
        COUNT(*) AS total_count,
        SUM(status = 'active') AS active_count,
        SUM(status = 'cancelled') AS cancelled_count,
        SUM(status = 'suspended') AS suspended_count,
        SUM(status = 'expired') AS expired_count,
        COALESCE(SUM(CASE WHEN status = 'active' THEN amount_cents ELSE 0 END), 0) AS mrr_cents
       FROM client_subscriptions`,
      );

      res.json({
        subscriptions,
        summary: summary[0] || {},
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );

  // ── TRADELINE PRODUCTS (admin CRUD) ───────────────────────────────────────
  app.get(
    "/api/admin/tradeline-products",
    requireAdmin,
    denyAffiliateAccess,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM tradeline_products ORDER BY sort_order ASC, id ASC`,
      );
      res.json({ products: rows });
    },
  );

  app.post(
    "/api/admin/tradeline-products",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const {
        slug,
        name,
        details,
        price_cents,
        compare_price_cents,
        is_active,
        sort_order,
      } = req.body || {};
      if (!slug || !name || !details || price_cents == null) {
        return res.status(400).json({
          error: "slug, name, details, and price_cents are required",
        });
      }
      const cleanSlug = String(slug)
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_|_$/g, "");
      try {
        const [r] = await pool.query<ResultSetHeader>(
          `INSERT INTO tradeline_products (slug, name, details, price_cents, compare_price_cents, is_active, sort_order)
           VALUES (?,?,?,?,?,?,?)`,
          [
            cleanSlug,
            String(name).trim(),
            String(details).trim(),
            Number(price_cents),
            compare_price_cents != null ? Number(compare_price_cents) : null,
            is_active != null ? Number(is_active) : 1,
            Number(sort_order) || 0,
          ],
        );
        const [created] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM tradeline_products WHERE id = ? LIMIT 1`,
          [r.insertId],
        );
        res.status(201).json({ product: created[0] });
      } catch (err: unknown) {
        if (sendFriendlyError(res, err, { duplicateLabel: "slug" })) return;
        throw err;
      }
    },
  );

  app.put(
    "/api/admin/tradeline-products/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      const {
        slug,
        name,
        details,
        price_cents,
        compare_price_cents,
        is_active,
        sort_order,
      } = req.body || {};
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM tradeline_products WHERE id = ? LIMIT 1`,
        [id],
      );
      if (existing.length === 0)
        return res.status(404).json({ error: "Not found" });

      await pool.query<ResultSetHeader>(
        `UPDATE tradeline_products SET
           slug = COALESCE(?, slug),
           name = COALESCE(?, name),
           details = COALESCE(?, details),
           price_cents = COALESCE(?, price_cents),
           compare_price_cents = ?,
           is_active = COALESCE(?, is_active),
           sort_order = COALESCE(?, sort_order)
         WHERE id = ?`,
        [
          slug
            ? String(slug)
                .toLowerCase()
                .replace(/[^a-z0-9_]+/g, "_")
            : null,
          name != null ? String(name).trim() : null,
          details != null ? String(details).trim() : null,
          price_cents != null ? Number(price_cents) : null,
          compare_price_cents != null ? Number(compare_price_cents) : null,
          is_active != null ? Number(is_active) : null,
          sort_order != null ? Number(sort_order) : null,
          id,
        ],
      );
      const [updated] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM tradeline_products WHERE id = ? LIMIT 1`,
        [id],
      );
      res.json({ product: updated[0] });
    },
  );

  app.delete(
    "/api/admin/tradeline-products/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      await pool.query<ResultSetHeader>(
        `DELETE FROM tradeline_products WHERE id = ?`,
        [id],
      );
      res.json({ ok: true });
    },
  );

  // ── COUPONS (admin CRUD) ────────────────────────────────────────────────────
  app.get(
    "/api/admin/coupons",
    requireAdmin,
    denyAffiliateAccess,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.*,
              CONCAT(a.first_name,' ',a.last_name) AS created_by_name
       FROM coupons c
       LEFT JOIN admins a ON a.id = c.created_by_admin_id
       ORDER BY c.created_at DESC`,
      );
      res.json({ coupons: rows });
    },
  );

  app.post(
    "/api/admin/coupons",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const {
        code,
        description,
        discount_type,
        discount_value,
        min_amount_cents,
        max_uses,
        applicable_packages,
        valid_from,
        expires_at,
        is_active,
      } = req.body || {};

      if (!code || !discount_type || discount_value == null) {
        return res.status(400).json({
          error: "code, discount_type and discount_value are required",
        });
      }
      const upperCode = String(code)
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, "");
      if (!upperCode)
        return res.status(400).json({ error: "Invalid coupon code" });
      if (!["percentage", "fixed"].includes(discount_type)) {
        return res
          .status(400)
          .json({ error: "discount_type must be percentage or fixed" });
      }
      const val = Number(discount_value);
      if (isNaN(val) || val <= 0)
        return res.status(400).json({ error: "discount_value must be > 0" });
      if (discount_type === "percentage" && val > 100) {
        return res
          .status(400)
          .json({ error: "Percentage discount cannot exceed 100" });
      }

      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM coupons WHERE code = ? LIMIT 1`,
        [upperCode],
      );
      if (existing.length > 0)
        return res.status(409).json({ error: "Coupon code already exists" });

      try {
        const [r] = await pool.query<ResultSetHeader>(
          `INSERT INTO coupons
        (code, description, discount_type, discount_value, min_amount_cents, max_uses,
         applicable_packages, valid_from, expires_at, is_active, created_by_admin_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            upperCode,
            description || null,
            discount_type,
            val,
            Number(min_amount_cents) || 0,
            max_uses != null ? Number(max_uses) : null,
            applicable_packages ? JSON.stringify(applicable_packages) : null,
            valid_from || null,
            expires_at || null,
            is_active != null ? Number(is_active) : 1,
            req.auth!.id,
          ],
        );

        const [created] = await pool.query<RowDataPacket[]>(
          `SELECT c.*, CONCAT(a.first_name,' ',a.last_name) AS created_by_name
       FROM coupons c LEFT JOIN admins a ON a.id = c.created_by_admin_id
       WHERE c.id = ? LIMIT 1`,
          [r.insertId],
        );
        res.status(201).json({ coupon: created[0] });
      } catch (err: unknown) {
        if (sendFriendlyError(res, err, { duplicateLabel: "coupon" })) return;
        throw err;
      }
    },
  );

  app.put(
    "/api/admin/coupons/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      const {
        code,
        description,
        discount_type,
        discount_value,
        min_amount_cents,
        max_uses,
        applicable_packages,
        valid_from,
        expires_at,
        is_active,
      } = req.body || {};

      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM coupons WHERE id = ? LIMIT 1`,
        [id],
      );
      if (existing.length === 0)
        return res.status(404).json({ error: "Coupon not found" });

      const sets: string[] = [];
      const vals: any[] = [];

      if (code !== undefined) {
        const upperCode = String(code)
          .toUpperCase()
          .replace(/[^A-Z0-9_-]/g, "");
        if (!upperCode)
          return res.status(400).json({ error: "Invalid coupon code" });
        const [dup] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM coupons WHERE code = ? AND id <> ? LIMIT 1`,
          [upperCode, id],
        );
        if (dup.length > 0)
          return res.status(409).json({ error: "Coupon code already in use" });
        sets.push("code = ?");
        vals.push(upperCode);
      }
      if (description !== undefined) {
        sets.push("description = ?");
        vals.push(description || null);
      }
      if (discount_type !== undefined) {
        sets.push("discount_type = ?");
        vals.push(discount_type);
      }
      if (discount_value !== undefined) {
        sets.push("discount_value = ?");
        vals.push(Number(discount_value));
      }
      if (min_amount_cents !== undefined) {
        sets.push("min_amount_cents = ?");
        vals.push(Number(min_amount_cents) || 0);
      }
      if (max_uses !== undefined) {
        sets.push("max_uses = ?");
        vals.push(max_uses != null ? Number(max_uses) : null);
      }
      if (applicable_packages !== undefined) {
        sets.push("applicable_packages = ?");
        vals.push(
          applicable_packages ? JSON.stringify(applicable_packages) : null,
        );
      }
      if (valid_from !== undefined) {
        sets.push("valid_from = ?");
        vals.push(valid_from || null);
      }
      if (expires_at !== undefined) {
        sets.push("expires_at = ?");
        vals.push(expires_at || null);
      }
      if (is_active !== undefined) {
        sets.push("is_active = ?");
        vals.push(Number(is_active));
      }

      if (sets.length === 0)
        return res.status(400).json({ error: "No fields to update" });

      await pool.query<ResultSetHeader>(
        `UPDATE coupons SET ${sets.join(", ")} WHERE id = ?`,
        [...vals, id],
      );
      const [updated] = await pool.query<RowDataPacket[]>(
        `SELECT c.*, CONCAT(a.first_name,' ',a.last_name) AS created_by_name
       FROM coupons c LEFT JOIN admins a ON a.id = c.created_by_admin_id
       WHERE c.id = ? LIMIT 1`,
        [id],
      );
      res.json({ coupon: updated[0] });
    },
  );

  app.delete(
    "/api/admin/coupons/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM coupons WHERE id = ? LIMIT 1`,
        [id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Not found" });
      await pool.query<ResultSetHeader>(`DELETE FROM coupons WHERE id = ?`, [
        id,
      ]);
      res.json({ ok: true });
    },
  );

  // ── PUBLIC: validate + preview coupon discount ──────────────────────────────
  app.post("/api/validate-coupon", async (req, res) => {
    const { code, package_id, amount_cents } = req.body || {};
    if (!code) return res.status(400).json({ error: "code required" });

    const upperCode = String(code).toUpperCase().trim();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM coupons WHERE code = ? AND is_active = 1 LIMIT 1`,
      [upperCode],
    );
    if (rows.length === 0) {
      return res.json({
        valid: false,
        discount_cents: 0,
        final_amount_cents: Number(amount_cents) || 0,
        error: "Invalid or inactive coupon code",
      });
    }
    const c = rows[0];
    const now = new Date();
    if (c.valid_from && new Date(c.valid_from) > now) {
      return res.json({
        valid: false,
        discount_cents: 0,
        final_amount_cents: Number(amount_cents) || 0,
        error: "Coupon is not yet valid",
      });
    }
    if (c.expires_at && new Date(c.expires_at) < now) {
      return res.json({
        valid: false,
        discount_cents: 0,
        final_amount_cents: Number(amount_cents) || 0,
        error: "Coupon has expired",
      });
    }
    if (c.max_uses != null && Number(c.uses_count) >= Number(c.max_uses)) {
      return res.json({
        valid: false,
        discount_cents: 0,
        final_amount_cents: Number(amount_cents) || 0,
        error: "Coupon usage limit reached",
      });
    }
    const amt = Number(amount_cents) || 0;
    if (amt < Number(c.min_amount_cents)) {
      return res.json({
        valid: false,
        discount_cents: 0,
        final_amount_cents: amt,
        error: `Minimum order of $${(Number(c.min_amount_cents) / 100).toFixed(2)} required`,
      });
    }
    if (c.applicable_packages && package_id) {
      let pkgs: number[] = [];
      try {
        pkgs =
          typeof c.applicable_packages === "string"
            ? JSON.parse(c.applicable_packages)
            : c.applicable_packages;
      } catch {}
      if (pkgs.length > 0 && !pkgs.includes(Number(package_id))) {
        return res.json({
          valid: false,
          discount_cents: 0,
          final_amount_cents: amt,
          error: "Coupon not valid for selected package",
        });
      }
    }
    let discountCents = 0;
    if (c.discount_type === "percentage") {
      discountCents = Math.round((amt * Number(c.discount_value)) / 100);
    } else {
      discountCents = Number(c.discount_value);
    }
    discountCents = Math.min(discountCents, amt);
    res.json({
      valid: true,
      coupon: c,
      discount_cents: discountCents,
      final_amount_cents: amt - discountCents,
    });
  });

  app.get("/api/admin/reports", requireSuperAdmin, async (_req, res) => {
    const [revenueByMonth] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month, SUM(amount_cents) AS revenue_cents, COUNT(*) AS count
       FROM payments WHERE status = 'succeeded' AND paid_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY month ORDER BY month ASC`,
    );
    const [signupsByMonth] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS count
       FROM clients WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY month ORDER BY month ASC`,
    );
    const [packageBreakdown] = await pool.query<RowDataPacket[]>(
      `SELECT p.id AS package_id, p.name AS package_name,
              COUNT(DISTINCT c.id) AS sold,
              COALESCE(SUM(CASE WHEN pay.status = 'succeeded' THEN pay.amount_cents ELSE 0 END), 0) AS revenue
       FROM packages p
       LEFT JOIN clients c ON c.package_id = p.id
       LEFT JOIN payments pay ON pay.client_id = c.id
       GROUP BY p.id, p.name ORDER BY sold DESC`,
    );
    res.json({ revenueByMonth, signupsByMonth, packageBreakdown });
  });

  app.get("/api/admin/settings", requireSuperAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT setting_key, setting_value, description, updated_at FROM system_settings`,
    );
    res.json({ settings: rows });
  });

  app.post("/api/admin/settings", requireSuperAdmin, async (req, res) => {
    const { setting_key, setting_value } = req.body || {};
    if (!setting_key)
      return res.status(400).json({ error: "setting_key required" });
    await pool.query<ResultSetHeader>(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [setting_key, setting_value || null],
    );
    res.json({ ok: true });
  });

  // ── Legal documents (super admin editable) ─────────────────────────────────
  app.get("/api/admin/legal", requireSuperAdmin, async (_req, res) => {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT slug, title, content_md, source_url, updated_at
         FROM legal_documents ORDER BY slug ASC`,
      );
      res.json({ documents: rows });
    } catch (err: any) {
      console.error("[/api/admin/legal]", err?.message ?? err);
      res.status(503).json({ error: "Failed to load legal documents" });
    }
  });

  app.put("/api/admin/legal/:slug", requireSuperAdmin, async (req, res) => {
    try {
      const slug = String(req.params.slug || "")
        .trim()
        .toLowerCase();
      const title = String(req.body?.title || "").trim();
      const content_md = String(req.body?.content_md ?? "");
      const source_url =
        req.body?.source_url != null
          ? String(req.body.source_url).trim() || null
          : undefined;
      if (!slug) return res.status(400).json({ error: "slug required" });
      if (!title) return res.status(400).json({ error: "title required" });
      if (!content_md.trim()) {
        return res.status(400).json({ error: "content_md required" });
      }

      const adminId = (req as AuthedRequest).auth!.id;
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM legal_documents WHERE slug = ? LIMIT 1`,
        [slug],
      );
      if (existing.length === 0) {
        return res.status(404).json({ error: "Document not found" });
      }

      if (source_url === undefined) {
        await pool.query<ResultSetHeader>(
          `UPDATE legal_documents
           SET title = ?, content_md = ?, updated_by_admin_id = ?
           WHERE slug = ?`,
          [title, content_md, adminId, slug],
        );
      } else {
        await pool.query<ResultSetHeader>(
          `UPDATE legal_documents
           SET title = ?, content_md = ?, source_url = ?, updated_by_admin_id = ?
           WHERE slug = ?`,
          [title, content_md, source_url, adminId, slug],
        );
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT slug, title, content_md, source_url, updated_at
         FROM legal_documents WHERE slug = ? LIMIT 1`,
        [slug],
      );
      res.json({ document: rows[0] });
    } catch (err: any) {
      console.error("[/api/admin/legal/:slug]", err?.message ?? err);
      res.status(503).json({ error: "Failed to save legal document" });
    }
  });

  // ── Section locks ───────────────────────────────────────────────────────────

  // GET /api/portal/section-locks — client portal sections (requires client auth)
  app.get("/api/portal/section-locks", requireClient, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT section_key, label, is_locked, lock_reason
       FROM section_locks WHERE section_key LIKE 'portal_%' ORDER BY id ASC`,
    );
    res.json({
      section_locks: rows.map((r) => ({
        ...r,
        is_locked: Boolean(r.is_locked),
      })),
    });
  });

  // GET /api/admin/section-locks — all sections with lock status (any admin)
  app.get("/api/admin/section-locks", requireAdmin, async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, section_key, label, is_locked, lock_reason, updated_by_admin_id, updated_at
       FROM section_locks ORDER BY id ASC`,
    );
    const mapped = applyAffiliatesFeatureFlagToLocks(
      rows.map((r) => ({
        ...r,
        is_locked: Boolean(r.is_locked),
      })),
    );
    res.json({
      section_locks: mapped,
      affiliates_enabled: affiliatesFeatureEnabled(),
    });
  });

  // PUT /api/admin/section-locks/:key — toggle lock (super admin only)
  app.put(
    "/api/admin/section-locks/:key",
    requireSuperAdmin,
    async (req, res) => {
      const { key } = req.params;
      const { is_locked, lock_reason } = req.body || {};
      const adminId = (req as any).adminId as number;
      if (
        !affiliatesFeatureEnabled() &&
        (key === "affiliates" || key === "affiliate-portal") &&
        (is_locked === false || is_locked === 0)
      ) {
        return res.status(403).json({
          error:
            "Affiliates is disabled by AFFILIATES_ENABLED. Set AFFILIATES_ENABLED=1 to unlock.",
        });
      }
      if (
        typeof is_locked !== "boolean" &&
        is_locked !== 0 &&
        is_locked !== 1
      ) {
        return res.status(400).json({ error: "is_locked (boolean) required" });
      }
      const lockedVal = is_locked ? 1 : 0;
      const [result] = await pool.query<ResultSetHeader>(
        `UPDATE section_locks
       SET is_locked = ?, lock_reason = ?, updated_by_admin_id = ?
       WHERE section_key = ?`,
        [lockedVal, lock_reason ?? null, adminId, key],
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Section not found" });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, section_key, label, is_locked, lock_reason, updated_by_admin_id, updated_at
       FROM section_locks WHERE section_key = ?`,
        [key],
      );
      const row = rows[0];
      res.json({ section_lock: { ...row, is_locked: Boolean(row.is_locked) } });
    },
  );

  app.get("/api/admin/admins", requireSuperAdmin, async (req, res) => {
    const search = ((req.query.search as string) || "").trim();
    const role = (req.query.role as string) || "";
    const conditions: string[] = [];
    const params: any[] = [];
    if (search) {
      conditions.push(
        "(email LIKE ? ESCAPE '!' OR first_name LIKE ? ESCAPE '!' OR last_name LIKE ? ESCAPE '!')",
      );
      const like = likeContains(search);
      params.push(like, like, like);
    }
    if (role) {
      conditions.push("role = ?");
      params.push(role);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, email, first_name, last_name, phone, role, status, preferred_language, last_login_at, created_at FROM admins ${where} ORDER BY created_at DESC`,
      params,
    );
    res.json({ admins: rows });
  });

  app.post(
    "/api/admin/admins",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const [me] = await pool.query<RowDataPacket[]>(
        `SELECT role FROM admins WHERE id = ? LIMIT 1`,
        [req.auth!.id],
      );
      if (me[0]?.role !== "super_admin")
        return res.status(403).json({ error: "Forbidden" });
      const { email, first_name, last_name, phone, role, preferred_language } =
        req.body || {};
      if (!email || !first_name || !last_name)
        return res.status(400).json({ error: "Missing fields" });
      if (role === "affiliate") {
        return res.status(400).json({
          error:
            "Use POST /api/admin/affiliates to invite affiliates — it also creates their affiliate profile.",
        });
      }
      const emailNorm = String(email).trim().toLowerCase();
      const lang = preferred_language === "es" ? "es" : "en";
      try {
        const [r] = await pool.query<ResultSetHeader>(
          `INSERT INTO admins (email, first_name, last_name, phone, role, preferred_language) VALUES (?,?,?,?,?,?)`,
          [
            emailNorm,
            String(first_name).trim(),
            String(last_name).trim(),
            phone || null,
            role || "admin",
            lang,
          ],
        );
        // Send welcome email (non-blocking)
        const [inviter] = await pool.query<RowDataPacket[]>(
          `SELECT first_name, last_name FROM admins WHERE id = ? LIMIT 1`,
          [req.auth!.id],
        );
        const inviterName = inviter[0]
          ? `${inviter[0].first_name} ${inviter[0].last_name}`
          : "The Optimum Credit team";
        const welcomeTpl = tplAdminWelcome({
          firstName: String(first_name).trim(),
          lastName: String(last_name).trim(),
          email: emailNorm,
          role: role || "admin",
          loginUrl: `${APP_URL}/admin/login`,
          invitedByName: inviterName,
        });
        sendEmail({
          to: emailNorm,
          subject: welcomeTpl.subject,
          html: welcomeTpl.html,
        }).catch((err) => console.error("[admin-welcome-email]:", err));
        res.json({ id: r.insertId });
      } catch (e: any) {
        if (isDuplicateKeyError(e)) {
          return res.status(409).json({
            error: `An admin with email ${emailNorm} already exists`,
          });
        }
        if (sendFriendlyError(res, e)) return;
        throw e;
      }
    },
  );

  // Resend team welcome email (super_admin only)
  app.post(
    "/api/admin/admins/:id/resend-welcome",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const [me] = await pool.query<RowDataPacket[]>(
        `SELECT role, first_name, last_name FROM admins WHERE id = ? LIMIT 1`,
        [req.auth!.id],
      );
      if (me[0]?.role !== "super_admin")
        return res.status(403).json({ error: "Forbidden" });
      const targetId = Number(req.params.id);
      if (!targetId || isNaN(targetId))
        return res.status(400).json({ error: "Invalid id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, email, first_name, last_name, role, status FROM admins WHERE id = ? LIMIT 1`,
        [targetId],
      );
      if (!rows[0]) return res.status(404).json({ error: "Admin not found" });
      const target = rows[0];
      if (target.status && target.status !== "active")
        return res
          .status(422)
          .json({ error: "Cannot email an inactive admin" });

      const inviterName = `${me[0].first_name} ${me[0].last_name}`;
      const welcomeTpl = tplAdminWelcome({
        firstName: String(target.first_name),
        lastName: String(target.last_name),
        email: String(target.email),
        role: String(target.role || "admin"),
        loginUrl: `${APP_URL}/admin/login`,
        invitedByName: inviterName,
      });
      try {
        await sendEmail({
          to: String(target.email),
          subject: welcomeTpl.subject,
          html: welcomeTpl.html,
        });
      } catch (err: any) {
        console.error("[admin-welcome-resend]:", err?.message || err);
        return res.status(502).json({ error: "Failed to send welcome email" });
      }
      res.json({ ok: true, emailed: target.email });
    },
  );

  app.put(
    "/api/admin/admins/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const [me] = await pool.query<RowDataPacket[]>(
        `SELECT role FROM admins WHERE id = ? LIMIT 1`,
        [req.auth!.id],
      );
      if (me[0]?.role !== "super_admin")
        return res.status(403).json({ error: "Forbidden" });
      const targetId = Number(req.params.id);
      const { first_name, last_name, phone, role, status, preferred_language } =
        req.body || {};
      const [targetRows] = await pool.query<RowDataPacket[]>(
        `SELECT role FROM admins WHERE id = ? LIMIT 1`,
        [targetId],
      );
      if (role === "affiliate" || targetRows[0]?.role === "affiliate") {
        return res.status(400).json({
          error:
            "Manage affiliate admins via PATCH /api/admin/affiliates/:id — it keeps the affiliate profile in sync.",
        });
      }
      const lang =
        preferred_language === "es" || preferred_language === "en"
          ? preferred_language
          : null;
      await pool.query(
        `UPDATE admins SET
           first_name=COALESCE(?,first_name),
           last_name=COALESCE(?,last_name),
           phone=COALESCE(?,phone),
           role=COALESCE(?,role),
           status=COALESCE(?,status),
           preferred_language=COALESCE(?,preferred_language)
         WHERE id=?`,
        [
          first_name || null,
          last_name || null,
          phone || null,
          role || null,
          status || null,
          lang,
          targetId,
        ],
      );
      if (status === "inactive" || status === "suspended") {
        await revokeAllSessions("admin", targetId).catch((e) =>
          console.error("[admin/admins:revoke-sessions]", e?.message ?? e),
        );
      }
      res.json({ ok: true });
    },
  );

  app.delete(
    "/api/admin/admins/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const [me] = await pool.query<RowDataPacket[]>(
        `SELECT role FROM admins WHERE id = ? LIMIT 1`,
        [req.auth!.id],
      );
      if (me[0]?.role !== "super_admin")
        return res.status(403).json({ error: "Forbidden" });
      const targetId = Number(req.params.id);
      if (targetId === req.auth!.id)
        return res.status(400).json({ error: "Cannot delete yourself" });
      const [targetRows] = await pool.query<RowDataPacket[]>(
        `SELECT role FROM admins WHERE id = ? LIMIT 1`,
        [targetId],
      );
      if (targetRows[0]?.role === "affiliate") {
        return res.status(400).json({
          error:
            "Set the affiliate's status to inactive via PATCH /api/admin/affiliates/:id instead of deleting — deleting would orphan their referral/commission history.",
        });
      }
      await pool.query(`DELETE FROM admins WHERE id = ?`, [targetId]);
      res.json({ ok: true });
    },
  );

  // ============================================================
  // AFFILIATES v1 — admin management
  // ============================================================

  function requireAffiliatesEnabled(
    _req: Request,
    res: Response,
    next: NextFunction,
  ) {
    if (!affiliatesFeatureEnabled()) {
      return res.status(503).json({
        error: "Affiliates temporarily unavailable",
        code: "AFFILIATES_DISABLED",
        reason: AFFILIATES_FF_LOCK_REASON,
      });
    }
    next();
  }

  /** super_admin + admin only — affiliates themselves never manage other affiliates. */
  async function requireAffiliateManager(
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
  ) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT role FROM admins WHERE id = ? LIMIT 1`,
      [req.auth!.id],
    );
    const role = rows[0]?.role;
    if (role !== "super_admin" && role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  }

  app.get(
    "/api/admin/affiliates",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req, res) => {
      const search = ((req.query.search as string) || "").trim();
      const plan = (req.query.plan as string) || "";
      const status = (req.query.status as string) || "";
      const where: string[] = [];
      const args: any[] = [];
      if (search) {
        where.push(
          "(a.email LIKE ? ESCAPE '!' OR a.first_name LIKE ? ESCAPE '!' OR a.last_name LIKE ? ESCAPE '!' OR a.slug LIKE ? ESCAPE '!')",
        );
        const like = likeContains(search);
        args.push(like, like, like, like);
      }
      if (plan) {
        where.push("a.plan = ?");
        args.push(plan);
      }
      if (status) {
        where.push("a.status = ?");
        args.push(status);
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT a.*,
                (SELECT COUNT(*) FROM clients c WHERE c.affiliate_id = a.id) AS clients_count,
                (SELECT COUNT(*) FROM affiliates sub WHERE sub.parent_affiliate_id = a.id) AS sub_affiliates_count,
                (SELECT COALESCE(SUM(ac.amount_cents), 0) FROM affiliate_commissions ac
                 WHERE ac.affiliate_id = a.id AND ac.status IN ('approved','paid')) AS commissions_total_cents,
                (SELECT COALESCE(SUM(ac.amount_cents), 0) FROM affiliate_commissions ac
                 WHERE ac.affiliate_id = a.id AND ac.status = 'pending') AS commissions_pending_cents
         FROM affiliates a
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY a.created_at DESC`,
        args,
      );
      res.json({ affiliates: rows.map(serializeAffiliateRow) });
    },
  );

  app.get(
    "/api/admin/affiliates/meta/suggestions",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (_req, res) => {
      const plans: AffiliatePlan[] = ["standard", "master", "sub_affiliate"];
      res.json({
        suggestions: plans.reduce(
          (acc, plan) => {
            acc[plan] = suggestedTierDefaults(plan);
            return acc;
          },
          {} as Record<AffiliatePlan, ReturnType<typeof suggestedTierDefaults>>,
        ),
        features: AFFILIATE_FEATURES_ALL_ON,
      });
    },
  );

  // ── Staff affiliate invite links (shareable signup URLs) ────────────────
  app.get(
    "/api/admin/affiliate-invite-links",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT i.*,
                CONCAT(p.first_name, ' ', p.last_name) AS parent_name
         FROM affiliate_invite_links i
         LEFT JOIN affiliates p ON p.id = i.parent_affiliate_id
         ORDER BY i.created_at DESC
         LIMIT 100`,
      );
      res.json({ links: rows.map(serializeAffiliateInviteLink) });
    },
  );

  app.post(
    "/api/admin/affiliate-invite-links",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req: AuthedRequest, res) => {
      const b = req.body || {};
      const kind: "evergreen" | "one_time" =
        b.kind === "one_time" ? "one_time" : "evergreen";
      // Standard-only for now (direct under admin). Master / sub invites stay in API later.
      const plan: AffiliatePlan = "standard";
      const parentAffiliateId: number | null = null;
      if (b.plan && b.plan !== "standard") {
        return res.status(400).json({
          error: "Only standard plan invite links are enabled for now",
        });
      }
      const label = b.label ? String(b.label).trim().slice(0, 120) : null;
      let expiresAt: string | null = null;
      if (b.expires_at) {
        const d = new Date(String(b.expires_at));
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ error: "Invalid expires_at" });
        }
        expiresAt = d.toISOString().slice(0, 19).replace("T", " ");
      }
      const maxUses = kind === "one_time" ? 1 : null;
      const token = newAffiliateInviteToken();

      // path_mode: token (default) | auto (from admin name) | custom
      const pathMode = String(b.path_mode || "token").toLowerCase();
      let slug: string | null = null;
      if (pathMode === "auto") {
        const [admins] = await pool.query<RowDataPacket[]>(
          `SELECT first_name, last_name FROM admins WHERE id = ? LIMIT 1`,
          [req.auth!.id],
        );
        const base = slugifyAffiliateName(
          String(admins[0]?.first_name || "admin"),
          String(admins[0]?.last_name || "invite"),
        );
        slug = await generateUniqueInviteSlug(base);
      } else if (pathMode === "custom") {
        const normalized = normalizeAffiliateSlug(String(b.slug || ""));
        if (!isValidAffiliateSlug(normalized)) {
          return res.status(400).json({
            error: "slug must be 2–64 chars: lowercase letters, numbers, hyphens",
          });
        }
        const [clash] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM affiliate_invite_links WHERE slug = ? OR token = ? LIMIT 1`,
          [normalized, normalized],
        );
        if (clash[0]) {
          return res.status(409).json({ error: "That slug is already in use" });
        }
        slug = normalized;
      } else if (pathMode !== "token") {
        return res.status(400).json({
          error: "path_mode must be token, auto, or custom",
        });
      }

      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO affiliate_invite_links
           (token, slug, kind, label, plan, parent_affiliate_id, is_enabled, max_uses,
            expires_at, created_by_admin_id)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          token,
          slug,
          kind,
          label,
          plan,
          parentAffiliateId,
          maxUses,
          expiresAt,
          req.auth!.id,
        ],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT i.*,
                CONCAT(p.first_name, ' ', p.last_name) AS parent_name
         FROM affiliate_invite_links i
         LEFT JOIN affiliates p ON p.id = i.parent_affiliate_id
         WHERE i.id = ? LIMIT 1`,
        [ins.insertId],
      );
      res.status(201).json({ link: serializeAffiliateInviteLink(rows[0]) });
    },
  );

  app.patch(
    "/api/admin/affiliate-invite-links/:id",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const b = req.body || {};
      const updates: string[] = [];
      const args: unknown[] = [];
      if (typeof b.is_enabled === "boolean") {
        updates.push("is_enabled = ?");
        args.push(b.is_enabled ? 1 : 0);
      }
      if (b.label !== undefined) {
        updates.push("label = ?");
        args.push(
          b.label === null || b.label === ""
            ? null
            : String(b.label).trim().slice(0, 120),
        );
      }
      if (b.path_mode !== undefined || b.slug !== undefined) {
        const pathMode = String(b.path_mode || "custom").toLowerCase();
        if (pathMode === "token") {
          updates.push("slug = ?");
          args.push(null);
        } else if (pathMode === "auto") {
          const [admins] = await pool.query<RowDataPacket[]>(
            `SELECT first_name, last_name FROM admins WHERE id = ? LIMIT 1`,
            [req.auth!.id],
          );
          const base = slugifyAffiliateName(
            String(admins[0]?.first_name || "admin"),
            String(admins[0]?.last_name || "invite"),
          );
          const unique = await generateUniqueInviteSlug(base, id);
          updates.push("slug = ?");
          args.push(unique);
        } else if (pathMode === "custom" || b.slug !== undefined) {
          if (b.slug === null || b.slug === "") {
            updates.push("slug = ?");
            args.push(null);
          } else {
            const normalized = normalizeAffiliateSlug(String(b.slug));
            if (!isValidAffiliateSlug(normalized)) {
              return res.status(400).json({
                error:
                  "slug must be 2–64 chars: lowercase letters, numbers, hyphens",
              });
            }
            const [clash] = await pool.query<RowDataPacket[]>(
              `SELECT id FROM affiliate_invite_links
               WHERE (slug = ? OR token = ?) AND id <> ? LIMIT 1`,
              [normalized, normalized, id],
            );
            if (clash[0]) {
              return res.status(409).json({ error: "That slug is already in use" });
            }
            updates.push("slug = ?");
            args.push(normalized);
          }
        } else {
          return res.status(400).json({
            error: "path_mode must be token, auto, or custom",
          });
        }
      }
      if (!updates.length) {
        return res.status(400).json({ error: "No updates" });
      }
      args.push(id);
      await pool.query<ResultSetHeader>(
        `UPDATE affiliate_invite_links SET ${updates.join(", ")} WHERE id = ?`,
        args,
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT i.*,
                CONCAT(p.first_name, ' ', p.last_name) AS parent_name
         FROM affiliate_invite_links i
         LEFT JOIN affiliates p ON p.id = i.parent_affiliate_id
         WHERE i.id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      res.json({ link: serializeAffiliateInviteLink(rows[0]) });
    },
  );

  app.delete(
    "/api/admin/affiliate-invite-links/:id",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const [result] = await pool.query<ResultSetHeader>(
        `DELETE FROM affiliate_invite_links WHERE id = ?`,
        [id],
      );
      if (!result.affectedRows) {
        return res.status(404).json({ error: "Not found" });
      }
      res.json({ ok: true, id });
    },
  );

  app.post(
    "/api/admin/affiliates",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req: AuthedRequest, res) => {
      const b = req.body || {};
      const firstName = String(b.first_name || "").trim();
      const lastName = String(b.last_name || "").trim();
      const email = String(b.email || "")
        .trim()
        .toLowerCase();
      if (!firstName || !lastName || !email) {
        return res
          .status(400)
          .json({ error: "first_name, last_name and email are required" });
      }
      const plan: AffiliatePlan = [
        "standard",
        "master",
        "sub_affiliate",
      ].includes(b.plan)
        ? b.plan
        : "standard";

      let parentAffiliateId: number | null = null;
      if (plan === "sub_affiliate") {
        parentAffiliateId = Number(b.parent_affiliate_id) || null;
        if (!parentAffiliateId) {
          return res.status(400).json({
            error: "parent_affiliate_id is required for sub_affiliate plan",
          });
        }
        const [parentRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, plan FROM affiliates WHERE id = ? LIMIT 1`,
          [parentAffiliateId],
        );
        if (parentRows.length === 0 || parentRows[0].plan !== "master") {
          return res
            .status(400)
            .json({
              error: "parent_affiliate_id must reference a master affiliate",
            });
        }
      }

      const defaults = suggestedTierDefaults(plan);
      const monthlyPriceCents =
        b.monthly_price_cents != null
          ? Math.max(0, Number(b.monthly_price_cents))
          : defaults.monthly_price_cents;
      const commissionRateBps =
        b.commission_rate_bps != null
          ? Math.max(0, Number(b.commission_rate_bps))
          : defaults.commission_rate_bps;
      const parentOverrideRateBps =
        b.parent_override_rate_bps != null
          ? Math.max(0, Number(b.parent_override_rate_bps))
          : defaults.parent_override_rate_bps;

      const requestedSlug = b.slug
        ? normalizeAffiliateSlug(String(b.slug))
        : slugifyAffiliateName(firstName, lastName);
      if (b.slug && !isValidAffiliateSlug(requestedSlug)) {
        return res.status(400).json({ error: "Invalid slug" });
      }
      const slug = await generateUniqueAffiliateSlug(requestedSlug);
      const referralCode = slug.slice(0, 32);
      const compSubscription = b.comp_subscription === true;
      const defaultLanding: AffiliateLanding =
        b.default_landing === "pricing" ? "pricing" : "credit_analysis";

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [adminIns] = await conn.query<ResultSetHeader>(
          `INSERT INTO admins (email, first_name, last_name, phone, role)
           VALUES (?, ?, ?, ?, 'affiliate')`,
          [email, firstName, lastName, b.phone || null],
        );
        const adminId = adminIns.insertId;

        const [affIns] = await conn.query<ResultSetHeader>(
          `INSERT INTO affiliates
             (admin_id, email, first_name, last_name, phone, plan, monthly_price_cents,
              commission_rate_bps, parent_override_rate_bps, parent_affiliate_id,
              status, subscription_status, referral_code, slug, default_landing, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            adminId,
            email,
            firstName,
            lastName,
            b.phone || null,
            plan,
            monthlyPriceCents,
            commissionRateBps,
            parentOverrideRateBps,
            parentAffiliateId,
            compSubscription ? "active" : "invited",
            compSubscription ? "comped" : "none",
            referralCode,
            slug,
            defaultLanding,
            b.notes || null,
          ],
        );
        await conn.commit();

        const [inviter] = await pool.query<RowDataPacket[]>(
          `SELECT first_name, last_name FROM admins WHERE id = ? LIMIT 1`,
          [req.auth!.id],
        );
        const inviterName = inviter[0]
          ? `${inviter[0].first_name} ${inviter[0].last_name}`
          : "The Optimum Credit team";
        const welcomeTpl = tplAdminWelcome({
          firstName,
          lastName,
          email,
          role: "affiliate",
          loginUrl: `${APP_URL}/admin/login`,
          invitedByName: inviterName,
        });
        sendEmail({
          to: email,
          subject: welcomeTpl.subject,
          html: welcomeTpl.html,
        }).catch((err) => console.error("[affiliate-welcome-email]:", err));

        res.json({
          id: affIns.insertId,
          admin_id: adminId,
          slug,
          referral_code: referralCode,
        });
      } catch (err: any) {
        await conn.rollback();
        if (sendFriendlyError(res, err, { duplicateLabel: "email" })) return;
        throw err;
      } finally {
        conn.release();
      }
    },
  );

  app.get(
    "/api/admin/affiliates/:id",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT a.*, ad.status AS admin_status, ad.last_login_at
         FROM affiliates a LEFT JOIN admins ad ON ad.id = a.admin_id
         WHERE a.id = ? LIMIT 1`,
        [id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Affiliate not found" });
      const [children] = await pool.query<RowDataPacket[]>(
        `SELECT id, first_name, last_name, email, slug, status, subscription_status
         FROM affiliates WHERE parent_affiliate_id = ? ORDER BY created_at DESC`,
        [id],
      );
      const [clients] = await pool.query<RowDataPacket[]>(
        `SELECT id, first_name, last_name, email, status, pipeline_stage, created_at
         FROM clients WHERE affiliate_id = ? ORDER BY created_at DESC LIMIT 50`,
        [id],
      );
      res.json({
        affiliate: serializeAffiliateRow(rows[0]),
        links: buildAffiliatePublicLinks(rows[0].slug as string, APP_URL),
        sub_affiliates: children,
        clients,
      });
    },
  );

  app.patch(
    "/api/admin/affiliates/:id",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const [existingRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, admin_id FROM affiliates WHERE id = ? LIMIT 1`,
        [id],
      );
      if (existingRows.length === 0)
        return res.status(404).json({ error: "Affiliate not found" });
      const b = req.body || {};

      let slug: string | undefined;
      if (b.slug !== undefined) {
        const normalized = normalizeAffiliateSlug(String(b.slug));
        if (!isValidAffiliateSlug(normalized)) {
          return res.status(400).json({ error: "Invalid slug" });
        }
        slug = normalized;
      }
      if (
        b.parent_affiliate_id !== undefined &&
        b.parent_affiliate_id !== null
      ) {
        const parentId = Number(b.parent_affiliate_id);
        if (parentId === id) {
          return res
            .status(400)
            .json({ error: "An affiliate cannot be its own parent" });
        }
        const [parentRows] = await pool.query<RowDataPacket[]>(
          `SELECT id, plan FROM affiliates WHERE id = ? LIMIT 1`,
          [parentId],
        );
        if (parentRows.length === 0 || parentRows[0].plan !== "master") {
          return res
            .status(400)
            .json({
              error: "parent_affiliate_id must reference a master affiliate",
            });
        }
      }

      try {
        await pool.query<ResultSetHeader>(
          `UPDATE affiliates SET
             slug = COALESCE(?, slug),
             referral_code = COALESCE(?, referral_code),
             plan = COALESCE(?, plan),
             monthly_price_cents = COALESCE(?, monthly_price_cents),
             commission_rate_bps = COALESCE(?, commission_rate_bps),
             parent_override_rate_bps = COALESCE(?, parent_override_rate_bps),
             parent_affiliate_id = ?,
             default_landing = COALESCE(?, default_landing),
             status = COALESCE(?, status),
             first_name = COALESCE(?, first_name),
             last_name = COALESCE(?, last_name),
             phone = COALESCE(?, phone),
             bio = COALESCE(?, bio),
             notes = COALESCE(?, notes)
           WHERE id = ?`,
          [
            slug ?? null,
            slug ? slug.slice(0, 32) : null,
            b.plan ?? null,
            b.monthly_price_cents != null
              ? Number(b.monthly_price_cents)
              : null,
            b.commission_rate_bps != null
              ? Number(b.commission_rate_bps)
              : null,
            b.parent_override_rate_bps != null
              ? Number(b.parent_override_rate_bps)
              : null,
            b.parent_affiliate_id !== undefined
              ? b.parent_affiliate_id
                ? Number(b.parent_affiliate_id)
                : null
              : existingRows[0].parent_affiliate_id,
            b.default_landing ?? null,
            b.status ?? null,
            b.first_name ?? null,
            b.last_name ?? null,
            b.phone ?? null,
            b.bio ?? null,
            b.notes ?? null,
            id,
          ],
        );

        // Keep the linked admin row's name/phone in sync for display purposes.
        if (
          existingRows[0].admin_id &&
          (b.first_name || b.last_name || b.phone)
        ) {
          await pool.query<ResultSetHeader>(
            `UPDATE admins SET
               first_name = COALESCE(?, first_name),
               last_name = COALESCE(?, last_name),
               phone = COALESCE(?, phone)
             WHERE id = ?`,
            [
              b.first_name ?? null,
              b.last_name ?? null,
              b.phone ?? null,
              existingRows[0].admin_id,
            ],
          );
        }

        const [updated] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM affiliates WHERE id = ? LIMIT 1`,
          [id],
        );
        res.json({ affiliate: serializeAffiliateRow(updated[0]) });
      } catch (err: any) {
        if (sendFriendlyError(res, err, { duplicateLabel: "slug" })) return;
        throw err;
      }
    },
  );

  app.post(
    "/api/admin/affiliates/:id/comp",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const [result] = await pool.query<ResultSetHeader>(
        `UPDATE affiliates SET subscription_status = 'comped', status = 'active' WHERE id = ?`,
        [id],
      );
      if (result.affectedRows === 0)
        return res.status(404).json({ error: "Affiliate not found" });
      res.json({ ok: true });
    },
  );

  app.post(
    "/api/admin/affiliates/:id/subscribe",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM affiliates WHERE id = ? LIMIT 1`,
        [id],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Affiliate not found" });
      const aff = rows[0];
      if (hasActiveOrPendingSubscription(aff)) {
        return res.status(409).json({
          error:
            "Affiliate already has an active or pending subscription. Cancel it first.",
        });
      }
      const { dataDescriptor, dataValue } = req.body || {};
      if (!dataDescriptor || !dataValue) {
        return res.status(400).json({ error: "Card details are required" });
      }
      try {
        const sub = await createARBSubscription({
          amountDollars: (Number(aff.monthly_price_cents) / 100).toFixed(2),
          dataDescriptor: String(dataDescriptor),
          dataValue: String(dataValue),
          clientId: id,
          email: aff.email as string,
          firstName: aff.first_name as string,
          lastName: aff.last_name as string,
          subscriptionName: `Affiliate ${aff.plan} — ${aff.first_name} ${aff.last_name}`,
        });
        await pool.query<ResultSetHeader>(
          `UPDATE affiliates SET anet_subscription_id = ?, subscription_status = 'active',
             status = 'active', subscription_started_at = NOW() WHERE id = ?`,
          [sub.subscriptionId, id],
        );
        res.json({ ok: true, subscription_id: sub.subscriptionId });
      } catch (e: any) {
        res.status(402).json({ error: e.message || "Subscription failed" });
      }
    },
  );

  app.get(
    "/api/admin/affiliates/:id/commissions",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ac.*, c.first_name AS client_first_name, c.last_name AS client_last_name,
                sa.first_name AS source_first_name, sa.last_name AS source_last_name
         FROM affiliate_commissions ac
         LEFT JOIN clients c ON c.id = ac.client_id
         LEFT JOIN affiliates sa ON sa.id = ac.source_affiliate_id
         WHERE ac.affiliate_id = ?
         ORDER BY ac.created_at DESC`,
        [id],
      );
      res.json({ commissions: rows.map(serializeCommissionRow) });
    },
  );

  app.post(
    "/api/admin/affiliates/:id/commissions",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const b = req.body || {};
      const amountCents = Number(b.amount_cents);
      if (!amountCents || amountCents === 0) {
        return res.status(400).json({ error: "amount_cents is required" });
      }
      const [affRows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM affiliates WHERE id = ? LIMIT 1`,
        [id],
      );
      if (affRows.length === 0)
        return res.status(404).json({ error: "Affiliate not found" });
      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO affiliate_commissions
           (affiliate_id, client_id, kind, amount_cents, notes, created_by_admin_id, status)
         VALUES (?, ?, 'manual', ?, ?, ?, 'pending')`,
        [
          id,
          b.client_id ? Number(b.client_id) : null,
          amountCents,
          b.notes || null,
          req.auth!.id,
        ],
      );
      res.json({ id: ins.insertId });
    },
  );

  app.patch(
    "/api/admin/affiliates/commissions/:id",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateManager,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const status = req.body?.status;
      if (!["approved", "paid", "void"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const [result] = await pool.query<ResultSetHeader>(
        `UPDATE affiliate_commissions
         SET status = ?, paid_at = IF(? = 'paid', NOW(), paid_at)
         WHERE id = ?`,
        [status, status, id],
      );
      if (result.affectedRows === 0)
        return res.status(404).json({ error: "Commission not found" });
      res.json({ ok: true });
    },
  );

  // ============================================================
  // AFFILIATES v1 — self-service portal (role='affiliate')
  // ============================================================

  interface AffiliateSelfRequest extends AuthedRequest {
    affiliateRow?: RowDataPacket;
  }

  /** Attaches the caller's own affiliate row (req.affiliateRow); 403 if not an affiliate. */
  async function requireAffiliateActor(
    req: AffiliateSelfRequest,
    res: Response,
    next: NextFunction,
  ) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT a.*, ad.role AS admin_role FROM affiliates a
       JOIN admins ad ON ad.id = a.admin_id
       WHERE a.admin_id = ? LIMIT 1`,
      [req.auth!.id],
    );
    if (rows.length === 0 || rows[0].admin_role !== "affiliate") {
      return res.status(403).json({ error: "Affiliate access required" });
    }
    req.affiliateRow = rows[0];
    next();
  }

  function requireAffiliatePortalAccess(
    req: AffiliateSelfRequest,
    res: Response,
    next: NextFunction,
  ) {
    const aff = req.affiliateRow!;
    const hasAccess = affiliateHasPortalAccess({
      status: aff.status as string,
      subscription_status: aff.subscription_status as string,
    });
    if (!hasAccess) {
      return res.status(403).json({
        error: "Portal access required — please complete your subscription",
      });
    }
    next();
  }

  app.get(
    "/api/admin/affiliate/me",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateActor,
    async (req: AffiliateSelfRequest, res) => {
      const aff = req.affiliateRow!;
      const [clicksAgg] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS clicks_total FROM affiliate_link_clicks WHERE affiliate_id = ?`,
        [aff.id],
      );
      const [clientsAgg] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS referred_clients FROM clients WHERE affiliate_id = ?`,
        [aff.id],
      );
      const [commissionsAgg] = await pool.query<RowDataPacket[]>(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_cents ELSE 0 END), 0) AS pending_cents,
           COALESCE(SUM(CASE WHEN status IN ('approved','paid') THEN amount_cents ELSE 0 END), 0) AS earned_cents
         FROM affiliate_commissions WHERE affiliate_id = ?`,
        [aff.id],
      );
      res.json({
        affiliate: serializeAffiliateRow(aff),
        links: buildAffiliatePublicLinks(aff.slug as string, APP_URL),
        stats: {
          clicks_total: Number(clicksAgg[0]?.clicks_total || 0),
          referred_clients: Number(clientsAgg[0]?.referred_clients || 0),
          commissions_pending_cents: Number(
            commissionsAgg[0]?.pending_cents || 0,
          ),
          commissions_earned_cents: Number(
            commissionsAgg[0]?.earned_cents || 0,
          ),
        },
      });
    },
  );

  app.patch(
    "/api/admin/affiliate/me",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateActor,
    async (req: AffiliateSelfRequest, res) => {
      const aff = req.affiliateRow!;
      const b = req.body || {};
      // Limited self-edit surface — rates/plan/status are admin-managed only.
      const defaultLanding =
        b.default_landing === "pricing" ||
        b.default_landing === "credit_analysis"
          ? b.default_landing
          : null;
      await pool.query<ResultSetHeader>(
        `UPDATE affiliates SET
           default_landing = COALESCE(?, default_landing),
           bio = COALESCE(?, bio),
           phone = COALESCE(?, phone),
           social_facebook = COALESCE(?, social_facebook),
           social_instagram = COALESCE(?, social_instagram),
           social_tiktok = COALESCE(?, social_tiktok),
           social_linkedin = COALESCE(?, social_linkedin)
         WHERE id = ?`,
        [
          defaultLanding,
          b.bio ?? null,
          b.phone ?? null,
          b.social_facebook ?? null,
          b.social_instagram ?? null,
          b.social_tiktok ?? null,
          b.social_linkedin ?? null,
          aff.id,
        ],
      );
      if (b.phone) {
        await pool.query<ResultSetHeader>(
          `UPDATE admins SET phone = ? WHERE id = ?`,
          [b.phone, aff.admin_id],
        );
      }
      const [updated] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM affiliates WHERE id = ? LIMIT 1`,
        [aff.id],
      );
      res.json({ affiliate: serializeAffiliateRow(updated[0]) });
    },
  );

  app.post(
    "/api/admin/affiliate/me/subscribe",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateActor,
    async (req: AffiliateSelfRequest, res) => {
      const aff = req.affiliateRow!;
      if (hasActiveOrPendingSubscription(aff)) {
        return res.status(409).json({
          error:
            "You already have an active or pending subscription. Cancel it first.",
        });
      }
      const { dataDescriptor, dataValue } = req.body || {};
      if (!dataDescriptor || !dataValue) {
        return res.status(400).json({ error: "Card details are required" });
      }
      try {
        const sub = await createARBSubscription({
          amountDollars: (Number(aff.monthly_price_cents) / 100).toFixed(2),
          dataDescriptor: String(dataDescriptor),
          dataValue: String(dataValue),
          clientId: aff.id as number,
          email: aff.email as string,
          firstName: aff.first_name as string,
          lastName: aff.last_name as string,
          subscriptionName: `Affiliate ${aff.plan} — ${aff.first_name} ${aff.last_name}`,
        });
        await pool.query<ResultSetHeader>(
          `UPDATE affiliates SET anet_subscription_id = ?, subscription_status = 'active',
             status = 'active', subscription_started_at = NOW() WHERE id = ?`,
          [sub.subscriptionId, aff.id],
        );
        res.json({ ok: true, subscription_id: sub.subscriptionId });
      } catch (e: any) {
        res.status(402).json({ error: e.message || "Subscription failed" });
      }
    },
  );

  app.post(
    "/api/admin/affiliate/leads",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateActor,
    requireAffiliatePortalAccess,
    async (req: AffiliateSelfRequest, res) => {
      const aff = req.affiliateRow!;
      const b = req.body || {};
      const firstName = String(b.first_name || "").trim();
      const lastName = String(b.last_name || "").trim();
      const email = String(b.email || "")
        .trim()
        .toLowerCase();
      const phone = b.phone ? String(b.phone).trim() : null;
      if (!firstName || !lastName) {
        return res
          .status(400)
          .json({ error: "first_name and last_name are required" });
      }
      if (!email && !phone) {
        return res.status(400).json({
          error: "Email or phone is required",
          code: "contact_required",
        });
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Invalid email address" });
      }
      const clientEmail = email || null;
      try {
        let clientId: number;
        if (clientEmail) {
          const [existing] = await pool.query<RowDataPacket[]>(
            `SELECT id, status FROM clients WHERE email = ? LIMIT 1`,
            [clientEmail],
          );
          if (existing.length > 0) {
            clientId = existing[0].id as number;
            await pool.query<ResultSetHeader>(
              `UPDATE clients SET affiliate_id = COALESCE(affiliate_id, ?) WHERE id = ?`,
              [aff.id, clientId],
            );
          } else {
            const [ins] = await pool.query<ResultSetHeader>(
              `INSERT INTO clients (email, first_name, last_name, phone, status, pipeline_stage, affiliate_id)
               VALUES (?, ?, ?, ?, 'prospect', 'prospect', ?)`,
              [clientEmail, firstName, lastName, phone, aff.id],
            );
            clientId = ins.insertId;
          }
        } else {
          const [ins] = await pool.query<ResultSetHeader>(
            `INSERT INTO clients (email, first_name, last_name, phone, status, pipeline_stage, affiliate_id)
             VALUES (NULL, ?, ?, ?, 'prospect', 'prospect', ?)`,
            [firstName, lastName, phone, aff.id],
          );
          clientId = ins.insertId;
        }
        await attachLabelsBySlug(clientId, ["affiliate_referral"]);
        res.json({ ok: true, client_id: clientId });
      } catch (err: any) {
        if (sendFriendlyError(res, err, { duplicateLabel: "email" })) return;
        throw err;
      }
    },
  );

  app.get(
    "/api/admin/affiliate/commissions",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateActor,
    requireAffiliatePortalAccess,
    async (req: AffiliateSelfRequest, res) => {
      const aff = req.affiliateRow!;
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ac.*, c.first_name AS client_first_name, c.last_name AS client_last_name,
                sa.first_name AS source_first_name, sa.last_name AS source_last_name
         FROM affiliate_commissions ac
         LEFT JOIN clients c ON c.id = ac.client_id
         LEFT JOIN affiliates sa ON sa.id = ac.source_affiliate_id
         WHERE ac.affiliate_id = ?
         ORDER BY ac.created_at DESC`,
        [aff.id],
      );
      res.json({ commissions: rows.map(serializeCommissionRow) });
    },
  );

  app.post(
    "/api/admin/affiliate/subs",
    requireAdmin,
    requireAffiliatesEnabled,
    requireAffiliateActor,
    requireAffiliatePortalAccess,
    async (req: AffiliateSelfRequest, res) => {
      const aff = req.affiliateRow!;
      if (aff.plan !== "master") {
        return res
          .status(403)
          .json({ error: "Only master affiliates can invite sub-affiliates" });
      }
      const b = req.body || {};
      const firstName = String(b.first_name || "").trim();
      const lastName = String(b.last_name || "").trim();
      const email = String(b.email || "")
        .trim()
        .toLowerCase();
      if (!firstName || !lastName || !email) {
        return res
          .status(400)
          .json({ error: "first_name, last_name and email are required" });
      }
      const defaults = suggestedTierDefaults("sub_affiliate");
      const slug = await generateUniqueAffiliateSlug(
        slugifyAffiliateName(firstName, lastName),
      );
      const referralCode = slug.slice(0, 32);

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [adminIns] = await conn.query<ResultSetHeader>(
          `INSERT INTO admins (email, first_name, last_name, phone, role)
           VALUES (?, ?, ?, ?, 'affiliate')`,
          [email, firstName, lastName, b.phone || null],
        );
        const subAdminId = adminIns.insertId;
        const [affIns] = await conn.query<ResultSetHeader>(
          `INSERT INTO affiliates
             (admin_id, email, first_name, last_name, phone, plan, monthly_price_cents,
              commission_rate_bps, parent_override_rate_bps, parent_affiliate_id,
              status, subscription_status, referral_code, slug, default_landing)
           VALUES (?, ?, ?, ?, ?, 'sub_affiliate', ?, ?, 0, ?, 'invited', 'none', ?, ?, 'credit_analysis')`,
          [
            subAdminId,
            email,
            firstName,
            lastName,
            b.phone || null,
            defaults.monthly_price_cents,
            defaults.commission_rate_bps,
            aff.id,
            referralCode,
            slug,
          ],
        );
        await conn.commit();

        const welcomeTpl = tplAdminWelcome({
          firstName,
          lastName,
          email,
          role: "affiliate",
          loginUrl: `${APP_URL}/admin/login`,
          invitedByName: `${aff.first_name} ${aff.last_name}`,
        });
        sendEmail({
          to: email,
          subject: welcomeTpl.subject,
          html: welcomeTpl.html,
        }).catch((err) => console.error("[affiliate-sub-welcome-email]:", err));

        res.json({ id: affIns.insertId, admin_id: subAdminId, slug });
      } catch (err: any) {
        await conn.rollback();
        if (sendFriendlyError(res, err, { duplicateLabel: "email" })) return;
        throw err;
      } finally {
        conn.release();
      }
    },
  );

  // ============================================================
  // WEBHOOKS — Twilio inbound SMS / voice
  // ============================================================
  app.post("/api/webhooks/twilio/sms", async (req, res) => {
    if (!process.env.TWILIO_AUTH_TOKEN && IS_PROD) {
      res.set("Content-Type", "text/xml");
      return res.status(503).send("<Response/>");
    }
    if (!isValidTwilioWebhookRequest(req)) {
      console.warn("[twilio:sms] Invalid or missing signature");
      res.set("Content-Type", "text/xml");
      return res.status(403).send("<Response/>");
    }
    const from = String(req.body?.From || "");
    const to = String(req.body?.To || "");
    const body = String(req.body?.Body || "");
    const sid = String(req.body?.MessageSid || "");

    if (!from || !body) {
      res.set("Content-Type", "text/xml");
      return res.send("<Response/>");
    }

    const [crows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM clients WHERE phone = ? OR phone = ? LIMIT 1`,
      [from, from.replace(/^\+1/, "")],
    );
    if (crows.length === 0) {
      console.log("Inbound SMS from unknown phone:", from);
      res.set("Content-Type", "text/xml");
      return res.send("<Response/>");
    }
    const clientId = crows[0].id as number;

    let conversationId: number;
    const [conv] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM conversations WHERE client_id = ? AND channel = 'sms' LIMIT 1`,
      [clientId],
    );
    if (conv.length > 0) {
      conversationId = conv[0].id as number;
    } else {
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO conversations (client_id, channel, status) VALUES (?, 'sms', 'open')`,
        [clientId],
      );
      conversationId = r.insertId;
    }

    await pool.query<ResultSetHeader>(
      `INSERT INTO conversation_messages (conversation_id, direction, channel, body, from_address, to_address, provider_message_id) VALUES (?, 'inbound', 'sms', ?, ?, ?, ?)`,
      [conversationId, body, from, to, sid],
    );
    await pool.query<ResultSetHeader>(
      `UPDATE conversations SET last_message_at = NOW(), last_message_preview = ?, unread_count = unread_count + 1 WHERE id = ?`,
      [body.slice(0, 200), conversationId],
    );

    res.set("Content-Type", "text/xml");
    res.send("<Response/>");
  });

  app.post("/api/webhooks/twilio/voice", async (req, res) => {
    if (!process.env.TWILIO_AUTH_TOKEN && IS_PROD) {
      res.set("Content-Type", "text/xml");
      return res.status(503).send("<Response/>");
    }
    if (!isValidTwilioWebhookRequest(req)) {
      console.warn("[twilio:voice] Invalid or missing signature");
      res.set("Content-Type", "text/xml");
      return res.status(403).send("<Response/>");
    }
    res.set("Content-Type", "text/xml");
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Thank you for calling Optimum Credit Repair. Please leave a message after the tone.</Say><Record maxLength="120"/></Response>`,
    );
  });

  // ============================================================
  // REMINDER FLOWS
  // ============================================================

  // ── List all flows ────────────────────────────────────────────────────────
  app.get(
    "/api/admin/reminder-flows",
    requireAdmin,
    denyAffiliateAccess,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT rf.id, rf.name, rf.description, rf.trigger_event, rf.is_active,
              rf.required_label_slugs_json, rf.created_at, rf.updated_at,
              COUNT(rfs.id) AS step_count
       FROM reminder_flows rf
       LEFT JOIN reminder_flow_steps rfs ON rfs.flow_id = rf.id
       GROUP BY rf.id
       ORDER BY FIELD(rf.trigger_event,
         'payment_confirmed','docs_ready',
         'round_1_complete','round_2_complete','round_3_complete',
         'round_4_complete','round_5_complete','completed')`,
      );
      const flows = rows.map((r) => ({
        ...r,
        required_label_slugs: parseWizardJsonField<string[]>(
          r.required_label_slugs_json,
        ),
      }));
      res.json({ flows });
    },
  );

  // ── Get single flow with steps + recent executions ────────────────────────
  app.get(
    "/api/admin/reminder-flows/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      const [flowRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, name, description, trigger_event, is_active,
              required_label_slugs_json, created_at, updated_at
       FROM reminder_flows WHERE id = ? LIMIT 1`,
        [id],
      );
      if (flowRows.length === 0)
        return res.status(404).json({ error: "Not found" });
      const flowMeta = {
        ...flowRows[0],
        required_label_slugs: parseWizardJsonField<string[]>(
          flowRows[0].required_label_slugs_json,
        ),
      };

      const [steps] = await pool.query<RowDataPacket[]>(
        `SELECT id, flow_id, step_order, step_type, delay_days, label, subject, body, template_slug, created_at, updated_at
       FROM reminder_flow_steps WHERE flow_id = ? ORDER BY step_order ASC`,
        [id],
      );
      const [executions] = await pool.query<RowDataPacket[]>(
        `SELECT rfe.id, rfe.flow_id, rfe.client_id, rfe.triggered_at, rfe.status,
              rfe.steps_executed, rfe.steps_scheduled, rfe.error_message,
              CONCAT(c.first_name, ' ', c.last_name) AS client_name, c.email AS client_email,
              (SELECT COUNT(*) FROM reminder_flow_steps rfs2 WHERE rfs2.flow_id = rfe.flow_id) AS total_steps,
              (SELECT nq.subject FROM notification_queue nq
               WHERE nq.client_id = rfe.client_id AND nq.status = 'pending'
               AND nq.scheduled_for > rfe.triggered_at
               ORDER BY nq.scheduled_for ASC LIMIT 1) AS next_step_label,
              (SELECT nq.scheduled_for FROM notification_queue nq
               WHERE nq.client_id = rfe.client_id AND nq.status = 'pending'
               AND nq.scheduled_for > rfe.triggered_at
               ORDER BY nq.scheduled_for ASC LIMIT 1) AS next_step_scheduled_for
       FROM reminder_flow_executions rfe
       JOIN clients c ON c.id = rfe.client_id
       WHERE rfe.flow_id = ?
       ORDER BY rfe.triggered_at DESC LIMIT 50`,
        [id],
      );

      res.json({ flow: { ...flowMeta, steps }, executions });
    },
  );

  // ── Create flow ───────────────────────────────────────────────────────────
  app.post(
    "/api/admin/reminder-flows",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const { name, description, trigger_event, required_label_slugs } =
        req.body || {};
      if (!name || !trigger_event)
        return res
          .status(400)
          .json({ error: "name and trigger_event required" });
      const allowed = [
        "payment_confirmed",
        "docs_ready",
        "round_1_complete",
        "round_2_complete",
        "round_3_complete",
        "round_4_complete",
        "round_5_complete",
        "completed",
      ];
      if (!allowed.includes(trigger_event))
        return res.status(400).json({ error: "Invalid trigger_event" });
      const slugsJson =
        Array.isArray(required_label_slugs) && required_label_slugs.length > 0
          ? JSON.stringify(
              required_label_slugs.filter((s) => typeof s === "string"),
            )
          : null;
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO reminder_flows (name, description, trigger_event, required_label_slugs_json) VALUES (?, ?, ?, ?)`,
        [name, description || null, trigger_event, slugsJson],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, name, description, trigger_event, is_active,
              required_label_slugs_json, created_at, updated_at
       FROM reminder_flows WHERE id = ? LIMIT 1`,
        [r.insertId],
      );
      res.status(201).json({
        flow: {
          ...rows[0],
          required_label_slugs: parseWizardJsonField<string[]>(
            rows[0].required_label_slugs_json,
          ),
        },
      });
    },
  );

  // ── Update flow ───────────────────────────────────────────────────────────
  app.put(
    "/api/admin/reminder-flows/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      const { name, description, is_active, required_label_slugs } =
        req.body || {};
      const updates: string[] = [];
      const args: any[] = [];
      if (name != null) {
        updates.push("name = ?");
        args.push(String(name).trim());
      }
      if (description !== undefined) {
        updates.push("description = ?");
        args.push(description || null);
      }
      if (is_active !== undefined) {
        updates.push("is_active = ?");
        args.push(is_active ? 1 : 0);
      }
      if (required_label_slugs !== undefined) {
        updates.push("required_label_slugs_json = ?");
        args.push(
          Array.isArray(required_label_slugs) && required_label_slugs.length > 0
            ? JSON.stringify(
                required_label_slugs.filter((s) => typeof s === "string"),
              )
            : null,
        );
      }
      if (updates.length === 0)
        return res.status(400).json({ error: "Nothing to update" });
      args.push(id);
      await pool.query<ResultSetHeader>(
        `UPDATE reminder_flows SET ${updates.join(", ")} WHERE id = ?`,
        args,
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, name, description, trigger_event, is_active,
              required_label_slugs_json, created_at, updated_at
       FROM reminder_flows WHERE id = ? LIMIT 1`,
        [id],
      );
      res.json({
        flow: {
          ...rows[0],
          required_label_slugs: parseWizardJsonField<string[]>(
            rows[0].required_label_slugs_json,
          ),
        },
      });
    },
  );

  // ── Toggle active ─────────────────────────────────────────────────────────
  app.post(
    "/api/admin/reminder-flows/:id/toggle",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      await pool.query<ResultSetHeader>(
        `UPDATE reminder_flows SET is_active = NOT is_active WHERE id = ?`,
        [id],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, is_active FROM reminder_flows WHERE id = ? LIMIT 1`,
        [id],
      );
      res.json({ id, is_active: rows[0]?.is_active ?? 0 });
    },
  );

  // ── Delete flow ───────────────────────────────────────────────────────────
  app.delete(
    "/api/admin/reminder-flows/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      await pool.query<ResultSetHeader>(
        `DELETE FROM reminder_flows WHERE id = ?`,
        [id],
      );
      res.json({ ok: true });
    },
  );

  // ── Add step ──────────────────────────────────────────────────────────────
  app.post(
    "/api/admin/reminder-flows/:id/steps",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const flowId = Number(req.params.id);
      const { step_type, delay_days, label, subject, body, template_slug } =
        req.body || {};
      if (!step_type)
        return res.status(400).json({ error: "step_type required" });
      const [maxOrder] = await pool.query<RowDataPacket[]>(
        `SELECT COALESCE(MAX(step_order), 0) AS max_order FROM reminder_flow_steps WHERE flow_id = ?`,
        [flowId],
      );
      const nextOrder = ((maxOrder[0]?.max_order as number) ?? 0) + 1;
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO reminder_flow_steps (flow_id, step_order, step_type, delay_days, label, subject, body, template_slug) VALUES (?,?,?,?,?,?,?,?)`,
        [
          flowId,
          nextOrder,
          step_type,
          delay_days ?? 0,
          label || null,
          subject || null,
          body || null,
          template_slug || null,
        ],
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM reminder_flow_steps WHERE id = ? LIMIT 1`,
        [r.insertId],
      );
      res.status(201).json({ step: rows[0] });
    },
  );

  // ── Update step ───────────────────────────────────────────────────────────
  app.put(
    "/api/admin/reminder-flows/:id/steps/:stepId",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const flowId = Number(req.params.id);
      const stepId = Number(req.params.stepId);
      const {
        step_type,
        delay_days,
        label,
        subject,
        body,
        template_slug,
        step_order,
      } = req.body || {};
      const updates: string[] = [];
      const args: any[] = [];
      if (step_type != null) {
        updates.push("step_type = ?");
        args.push(step_type);
      }
      if (delay_days !== undefined) {
        updates.push("delay_days = ?");
        args.push(Number(delay_days));
      }
      if (label !== undefined) {
        updates.push("label = ?");
        args.push(label || null);
      }
      if (subject !== undefined) {
        updates.push("subject = ?");
        args.push(subject || null);
      }
      if (body !== undefined) {
        updates.push("body = ?");
        args.push(body || null);
      }
      if (template_slug !== undefined) {
        updates.push("template_slug = ?");
        args.push(template_slug || null);
      }
      if (step_order !== undefined) {
        updates.push("step_order = ?");
        args.push(Number(step_order));
      }
      if (updates.length === 0)
        return res.status(400).json({ error: "Nothing to update" });
      args.push(stepId, flowId);
      await pool.query<ResultSetHeader>(
        `UPDATE reminder_flow_steps SET ${updates.join(", ")} WHERE id = ? AND flow_id = ?`,
        args,
      );
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM reminder_flow_steps WHERE id = ? LIMIT 1`,
        [stepId],
      );
      res.json({ step: rows[0] });
    },
  );

  // ── Delete step ───────────────────────────────────────────────────────────
  app.delete(
    "/api/admin/reminder-flows/:id/steps/:stepId",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const flowId = Number(req.params.id);
      const stepId = Number(req.params.stepId);
      await pool.query<ResultSetHeader>(
        `DELETE FROM reminder_flow_steps WHERE id = ? AND flow_id = ?`,
        [stepId, flowId],
      );
      res.json({ ok: true });
    },
  );

  // ── Manual trigger (fire flow for a specific client) ─────────────────────
  app.post(
    "/api/admin/reminder-flows/:id/trigger",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const flowId = Number(req.params.id);
      const { client_id, deliver_to_admin } = req.body || {};
      if (!client_id)
        return res.status(400).json({ error: "client_id required" });

      const [flowRows] = await pool.query<RowDataPacket[]>(
        `SELECT trigger_event FROM reminder_flows WHERE id = ? LIMIT 1`,
        [flowId],
      );
      if (flowRows.length === 0)
        return res.status(404).json({ error: "Flow not found" });

      const sandbox =
        deliver_to_admin === true ||
        deliver_to_admin === 1 ||
        deliver_to_admin === "true";
      const adminEmail = (req.auth?.email || "").trim();
      if (sandbox && !adminEmail) {
        return res
          .status(400)
          .json({ error: "Admin email unavailable for sandbox delivery" });
      }

      await triggerReminderFlow(
        flowRows[0].trigger_event as string,
        Number(client_id),
        undefined,
        sandbox
          ? { deliverToEmail: adminEmail, skipIdempotency: true }
          : undefined,
      );
      res.json({
        ok: true,
        delivered_to: sandbox ? adminEmail : undefined,
        sandbox: sandbox || undefined,
      });
    },
  );

  // ── List available email templates (for step editor) ─────────────────────
  app.get(
    "/api/admin/reminder-flows/meta/templates",
    requireAdmin,
    denyAffiliateAccess,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT slug, name, subject FROM communication_templates WHERE channel = 'email' AND slug LIKE 'flow_%' ORDER BY name ASC`,
      );
      res.json({ templates: rows });
    },
  );

  // ── List executions across all flows ─────────────────────────────────────
  app.get(
    "/api/admin/reminder-flows/meta/executions",
    requireAdmin,
    denyAffiliateAccess,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT rfe.id, rfe.flow_id, rfe.client_id, rfe.triggered_at, rfe.status,
              rfe.steps_executed, rfe.steps_scheduled, rfe.error_message,
              rf.name AS flow_name, rf.trigger_event,
              CONCAT(c.first_name, ' ', c.last_name) AS client_name, c.email AS client_email,
              (SELECT COUNT(*) FROM reminder_flow_steps rfs2 WHERE rfs2.flow_id = rfe.flow_id) AS total_steps,
              (SELECT nq.subject FROM notification_queue nq
               WHERE nq.client_id = rfe.client_id AND nq.status = 'pending'
               AND nq.scheduled_for > rfe.triggered_at
               ORDER BY nq.scheduled_for ASC LIMIT 1) AS next_step_label,
              (SELECT nq.scheduled_for FROM notification_queue nq
               WHERE nq.client_id = rfe.client_id AND nq.status = 'pending'
               AND nq.scheduled_for > rfe.triggered_at
               ORDER BY nq.scheduled_for ASC LIMIT 1) AS next_step_scheduled_for
       FROM reminder_flow_executions rfe
       JOIN reminder_flows rf ON rf.id = rfe.flow_id
       JOIN clients c ON c.id = rfe.client_id
       ORDER BY rfe.triggered_at DESC LIMIT 100`,
      );
      res.json({ executions: rows });
    },
  );

  // ── Cron: process notification queue ────────────────────────────────────
  // Called by a cPanel cron job:
  //   curl -s -X POST https://yourdomain.com/api/cron/process-queue \
  //        -H "x-cron-secret: YOUR_CRON_SECRET"
  app.post("/api/cron/process-queue", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return res
        .status(503)
        .json({ error: "CRON_SECRET not configured on server" });
    }
    const provided = req.headers["x-cron-secret"] as string | undefined;
    if (!timingSafeStringEqual(String(provided || ""), secret)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const batchSize = 50; // max emails per run
    const maxAttempts = 3;

    // Atomically claim a batch by flipping status to 'processing'.
    // This prevents duplicate sends if two cron runs overlap.
    await pool.query<ResultSetHeader>(
      `UPDATE notification_queue
       SET status = 'processing'
       WHERE status = 'pending'
         AND scheduled_for <= NOW()
         AND attempts < ?
       ORDER BY scheduled_for ASC
       LIMIT ?`,
      [maxAttempts, batchSize],
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, client_id, channel, to_address, subject, body, attempts
       FROM notification_queue
       WHERE status = 'processing'
       ORDER BY scheduled_for ASC
       LIMIT ?`,
      [batchSize],
    );

    let sent = 0;
    let failed = 0;

    for (const row of rows as RowDataPacket[]) {
      const qid = row.id as number;
      try {
        if (row.channel === "email") {
          await sendEmail({
            to: row.to_address as string,
            subject: row.subject as string,
            html: row.body as string,
          });
          await pool.query<ResultSetHeader>(
            `UPDATE notification_queue SET status='sent', sent_at=NOW(), attempts=attempts+1 WHERE id=?`,
            [qid],
          );
          sent++;
        } else {
          // in_app / sms / push — this queue processor doesn't actually
          // deliver these yet (real SMS reminders go out via the dedicated
          // sendSms() call sites, not this generic queue). Previously this
          // branch marked them 'sent' unconditionally, which inflated the
          // "sent" count for messages nobody ever received. Fail them
          // instead so the count reflects reality and they surface for
          // manual follow-up rather than being silently dropped.
          await pool.query<ResultSetHeader>(
            `UPDATE notification_queue SET status='failed', attempts=attempts+1, error_message=? WHERE id=?`,
            [
              row.channel === "sms"
                ? "SMS not configured"
                : `${String(row.channel)} delivery not implemented`,
              qid,
            ],
          );
          failed++;
        }
      } catch (e: any) {
        const newAttempts = (row.attempts as number) + 1;
        const newStatus = newAttempts >= maxAttempts ? "failed" : "pending";
        await pool.query<ResultSetHeader>(
          `UPDATE notification_queue SET status=?, attempts=?, error_message=? WHERE id=?`,
          [newStatus, newAttempts, e?.message ?? String(e), qid],
        );
        failed++;
      }
    }

    // Work Hub overdue reminders (assignees with due_at in the past, not done)
    let workDueNotified = 0;
    try {
      const [dueRows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id, t.title, t.due_at, a.id AS admin_id, a.email, a.first_name,
                a.phone, a.notification_prefs_json
         FROM admin_work_tasks t
         JOIN admins a ON a.id = t.assignee_admin_id
         WHERE t.status <> 'done'
           AND t.assignee_admin_id IS NOT NULL
           AND t.due_at IS NOT NULL
           AND t.due_at < NOW()
           AND t.due_notified_at IS NULL
           AND a.status = 'active'
         ORDER BY t.due_at ASC
         LIMIT 40`,
      );
      for (const row of dueRows) {
        try {
          const admin: TeamAdminRecipient = {
            id: Number(row.admin_id),
            email: String(row.email),
            first_name: String(row.first_name || "there"),
            phone: row.phone ? String(row.phone) : null,
            preferred_language: "en",
            prefs: parseAdminNotificationPrefs(row.notification_prefs_json),
          };
          const link = `${APP_URL}/admin/my-tasks`;
          const delivered = await deliverAdminNotificationChannels({
            admin,
            eventKey: "work_task_overdue",
            tpl: {
              subject: `Overdue task: ${row.title}`,
              html: `<p>Hi ${admin.first_name},</p>
              <p>This work task is overdue: <strong>${row.title}</strong>.</p>
              <p>Due: ${new Date(row.due_at).toLocaleString()}</p>
              <p><a href="${link}">Open My Tasks</a></p>`,
              inAppTitle: `Overdue task: ${row.title}`,
              inAppBody: `Due: ${new Date(row.due_at).toLocaleString()}`,
              linkUrl: link,
              smsBody: `Optimum: overdue task — ${row.title}`,
            },
          });
          // Only stamp due_notified_at when something actually delivered —
          // otherwise unmuting later would never re-fire.
          if (delivered.email || delivered.in_app || delivered.sms) {
            await pool.query(
              `UPDATE admin_work_tasks SET due_notified_at = NOW() WHERE id = ?`,
              [row.id],
            );
            workDueNotified++;
          }
        } catch (e: any) {
          console.error("[cron:work-due]", e?.message ?? e);
        }
      }
    } catch (e: any) {
      // Column may not exist until migration applied — don't fail the queue cron
      console.error("[cron:work-due-batch]", e?.message ?? e);
    }

    res.json({
      ok: true,
      processed: rows.length,
      sent,
      failed,
      work_due_notified: workDueNotified,
    });
  });

  // ============================================================================
  // ONBOARDING TASK TEMPLATES (admin + portal)
  // ============================================================================

  // GET /api/admin/task-templates — list task templates with optional search/filter
  app.get(
    "/api/admin/task-templates",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const { search, type, active } = req.query as Record<string, string>;

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (search?.trim()) {
        conditions.push(
          "(title_en LIKE ? ESCAPE '!' OR title_es LIKE ? ESCAPE '!' OR slug LIKE ? ESCAPE '!' OR COALESCE(description_en,'') LIKE ? ESCAPE '!')",
        );
        const q = likeContains(search.trim());
        params.push(q, q, q, q);
      }
      if (type && type !== "all") {
        conditions.push("task_type = ?");
        params.push(type);
      }
      if (active === "active") {
        conditions.push("is_active = 1");
      } else if (active === "inactive") {
        conditions.push("is_active = 0");
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, slug, task_type, title_en, title_es, description_en, description_es,
              content_html_en, content_html_es, form_fields_json, upload_config_json,
              is_required, is_system, sort_order, is_active, auto_assign, created_at, updated_at
       FROM onboarding_task_templates
       ${where}
       ORDER BY sort_order ASC, id ASC`,
        params,
      );
      res.json({ tasks: rows });
    },
  );

  // POST /api/admin/task-templates — create a new task template
  app.post(
    "/api/admin/task-templates",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const {
        slug,
        task_type,
        title_en,
        title_es,
        description_en,
        description_es,
        content_html_en,
        content_html_es,
        form_fields_json,
        upload_config_json,
        is_required,
        sort_order,
        is_active,
        auto_assign,
      } = req.body || {};

      if (!slug || !task_type || !title_en || !title_es) {
        return res
          .status(400)
          .json({ error: "slug, task_type, title_en, title_es are required" });
      }
      const validTypes = ["form", "upload", "sign_document"];
      if (!validTypes.includes(task_type)) {
        return res.status(400).json({ error: "Invalid task_type" });
      }

      try {
        const [result] = await pool.query<ResultSetHeader>(
          `INSERT INTO onboarding_task_templates
        (slug, task_type, title_en, title_es, description_en, description_es,
         content_html_en, content_html_es, form_fields_json, upload_config_json,
         is_required, sort_order, is_active, auto_assign)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            slug.toLowerCase().replace(/\s+/g, "_"),
            task_type,
            title_en,
            title_es,
            description_en || null,
            description_es || null,
            content_html_en || null,
            content_html_es || null,
            form_fields_json ? JSON.stringify(form_fields_json) : null,
            upload_config_json ? JSON.stringify(upload_config_json) : null,
            is_required !== false ? 1 : 0,
            sort_order ?? 0,
            is_active !== false ? 1 : 0,
            auto_assign !== false ? 1 : 0,
          ],
        );

        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM onboarding_task_templates WHERE id = ?`,
          [result.insertId],
        );
        res.status(201).json({ task: rows[0] });
      } catch (err: unknown) {
        if (sendFriendlyError(res, err, { duplicateLabel: "slug" })) return;
        throw err;
      }
    },
  );

  // PUT /api/admin/task-templates/:id — update a task template
  app.put(
    "/api/admin/task-templates/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid id" });

      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id, is_system FROM onboarding_task_templates WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!existing[0])
        return res.status(404).json({ error: "Task not found" });

      const {
        slug,
        task_type,
        title_en,
        title_es,
        description_en,
        description_es,
        content_html_en,
        content_html_es,
        form_fields_json,
        upload_config_json,
        is_required,
        sort_order,
        is_active,
        auto_assign,
      } = req.body || {};

      const updates: Record<string, unknown> = {};
      if (!existing[0].is_system && slug)
        updates.slug = slug.toLowerCase().replace(/\s+/g, "_");
      if (!existing[0].is_system && task_type) updates.task_type = task_type;
      if (title_en !== undefined) updates.title_en = title_en;
      if (title_es !== undefined) updates.title_es = title_es;
      if (description_en !== undefined)
        updates.description_en = description_en || null;
      if (description_es !== undefined)
        updates.description_es = description_es || null;
      if (content_html_en !== undefined)
        updates.content_html_en = content_html_en || null;
      if (content_html_es !== undefined)
        updates.content_html_es = content_html_es || null;
      if (form_fields_json !== undefined)
        updates.form_fields_json = form_fields_json
          ? JSON.stringify(form_fields_json)
          : null;
      if (upload_config_json !== undefined)
        updates.upload_config_json = upload_config_json
          ? JSON.stringify(upload_config_json)
          : null;
      if (is_required !== undefined) updates.is_required = is_required ? 1 : 0;
      if (sort_order !== undefined) updates.sort_order = sort_order;
      if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;
      if (auto_assign !== undefined) updates.auto_assign = auto_assign ? 1 : 0;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const setClauses = Object.keys(updates)
        .map((k) => `\`${k}\` = ?`)
        .join(", ");
      const values = [...Object.values(updates), id];
      await pool.query<ResultSetHeader>(
        `UPDATE onboarding_task_templates SET ${setClauses} WHERE id = ?`,
        values,
      );

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM onboarding_task_templates WHERE id = ?`,
        [id],
      );
      res.json({ task: rows[0] });
    },
  );

  // DELETE /api/admin/task-templates/:id — delete (blocked for system tasks or those with completions)
  app.delete(
    "/api/admin/task-templates/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid id" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, is_system FROM onboarding_task_templates WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) return res.status(404).json({ error: "Task not found" });
      if (rows[0].is_system) {
        return res
          .status(400)
          .json({ error: "System tasks cannot be deleted" });
      }

      const [completions] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM client_task_completions WHERE task_template_id = ? AND status = 'completed'`,
        [id],
      );
      if ((completions[0] as RowDataPacket).cnt > 0) {
        return res.status(400).json({
          error: `This task has ${(completions[0] as RowDataPacket).cnt} completed submission(s) and cannot be deleted. Deactivate it instead.`,
        });
      }

      await pool.query<ResultSetHeader>(
        `DELETE FROM onboarding_task_templates WHERE id = ?`,
        [id],
      );
      res.json({ ok: true });
    },
  );

  // POST /api/admin/clients/:id/assign-tasks — manually trigger auto-assign for a client
  app.post(
    "/api/admin/clients/:id/assign-tasks",
    requireAdmin,
    async (req, res) => {
      const clientId = Number(req.params.id);
      if (!clientId)
        return res.status(400).json({ error: "Invalid client id" });

      const [client] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM clients WHERE id = ? LIMIT 1`,
        [clientId],
      );
      if (!client[0])
        return res.status(404).json({ error: "Client not found" });

      await autoAssignTasksForClient(clientId);
      res.json({ ok: true, message: "Tasks assigned" });
    },
  );

  // ==========================================================================
  // ADMIN WORK HUB — My Tasks Kanban + HubSpot extract (staff only)
  // ==========================================================================

  const WORK_TASK_FROM = `
    FROM admin_work_tasks t
    LEFT JOIN admins a ON a.id = t.assignee_admin_id
    LEFT JOIN credit_repair_cases cr ON cr.id = t.case_id
    LEFT JOIN clients c ON c.id = cr.client_id`;

  const WORK_TASK_SELECT = `
    SELECT t.*,
           a.first_name AS assignee_first_name,
           a.last_name AS assignee_last_name,
           cr.case_number AS case_number,
           cr.client_id AS client_id,
           c.first_name AS client_first_name,
           c.last_name AS client_last_name
    ${WORK_TASK_FROM}`;

  function mapWorkTaskRow(r: RowDataPacket) {
    let labels: string[] = [];
    try {
      const raw = r.labels_json;
      if (Array.isArray(raw)) labels = raw.map(String);
      else if (typeof raw === "string" && raw) labels = JSON.parse(raw);
    } catch {
      labels = [];
    }
    const assigneeName =
      r.assignee_first_name || r.assignee_last_name
        ? `${r.assignee_first_name || ""} ${r.assignee_last_name || ""}`.trim()
        : null;
    const clientName =
      r.client_first_name || r.client_last_name
        ? `${r.client_first_name || ""} ${r.client_last_name || ""}`.trim()
        : null;
    return {
      id: Number(r.id),
      title: r.title as string,
      description: (r.description as string) || null,
      status: r.status as string,
      priority: r.priority as string,
      due_at: r.due_at ? new Date(r.due_at).toISOString() : null,
      labels,
      source: r.source as string,
      hubspot_task_id: (r.hubspot_task_id as string) || null,
      hubspot_owner_id: (r.hubspot_owner_id as string) || null,
      assignee_admin_id: r.assignee_admin_id
        ? Number(r.assignee_admin_id)
        : null,
      assignee_name: assigneeName,
      case_id: r.case_id != null ? Number(r.case_id) : null,
      case_number: (r.case_number as string) || null,
      client_id: r.client_id != null ? Number(r.client_id) : null,
      client_name: clientName,
      created_by_admin_id: r.created_by_admin_id
        ? Number(r.created_by_admin_id)
        : null,
      sort_order: Number(r.sort_order || 0),
      last_synced_at: r.last_synced_at
        ? new Date(r.last_synced_at).toISOString()
        : null,
      sync_error: (r.sync_error as string) || null,
      pending_push: Boolean(r.pending_push),
      due_notified_at: r.due_notified_at
        ? new Date(r.due_notified_at).toISOString()
        : null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    };
  }

  async function resolveWorkTaskCaseId(
    raw: unknown,
  ): Promise<{ caseId: number | null; error: string | null }> {
    if (raw === undefined || raw === null || raw === "") {
      return { caseId: null, error: null };
    }
    const caseId = Number(raw);
    if (!caseId || Number.isNaN(caseId)) {
      return { caseId: null, error: "Invalid case_id" };
    }
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM credit_repair_cases WHERE id = ? LIMIT 1`,
      [caseId],
    );
    if (!rows[0]) return { caseId: null, error: "Case not found" };
    return { caseId, error: null };
  }

  async function adminCanExtractHubspot(adminId: number): Promise<boolean> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT role FROM admins WHERE id = ? LIMIT 1`,
      [adminId],
    );
    if (!rows[0]) return false;
    if (rows[0].role === "super_admin") return true;
    const [perm] = await pool.query<RowDataPacket[]>(
      `SELECT can_extract FROM admin_hubspot_permissions WHERE admin_id = ? LIMIT 1`,
      [adminId],
    );
    return Boolean(perm[0]?.can_extract);
  }

  async function loadHubspotTokens(
    adminId: number,
  ): Promise<HubspotTokenBundle | null> {
    // Preferred for OFG: HubSpot Service Key (beta) — system-to-system CRM API
    // access without Legacy Apps. Projects OAuth apps currently cannot register
    // crm.objects.tasks.* on deploy.
    const accountTok = hubspotAccountAccessToken();
    if (accountTok) {
      return {
        access_token: accountTok,
        refresh_token: "",
        expires_at: Date.now() + 365 * 24 * 60 * 60 * 1000,
      };
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT token_ciphertext, token_iv, token_tag, revoked_at
       FROM admin_hubspot_connections WHERE admin_id = ? LIMIT 1`,
      [adminId],
    );
    if (!rows[0] || rows[0].revoked_at) return null;
    try {
      const bundle = decryptJsonSecrets(
        rows[0].token_ciphertext as Buffer,
        rows[0].token_iv as string,
        rows[0].token_tag as string,
      ) as unknown as HubspotTokenBundle;
      if (!bundle?.access_token || !bundle?.refresh_token) return null;
      if (bundle.expires_at && Date.now() < bundle.expires_at) return bundle;
      const refreshed = await refreshHubspotToken(bundle.refresh_token);
      const enc = encryptJsonSecrets(
        refreshed as unknown as Record<string, unknown>,
      );
      await pool.query<ResultSetHeader>(
        `UPDATE admin_hubspot_connections
         SET token_ciphertext = ?, token_iv = ?, token_tag = ?, updated_at = NOW()
         WHERE admin_id = ?`,
        [enc.ciphertext, enc.iv, enc.tag, adminId],
      );
      return refreshed;
    } catch (e: any) {
      console.error("[hubspot:load-tokens]", e?.message ?? e);
      return null;
    }
  }

  async function notifyWorkTaskAssignee(opts: {
    assigneeId: number;
    title: string;
    assignerId: number;
    taskId: number;
  }) {
    if (opts.assigneeId === opts.assignerId) return;
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT email, first_name, phone, notification_prefs_json
         FROM admins WHERE id = ? AND status = 'active' LIMIT 1`,
        [opts.assigneeId],
      );
      if (!rows[0]?.email) return;
      const admin: TeamAdminRecipient = {
        id: opts.assigneeId,
        email: String(rows[0].email),
        first_name: String(rows[0].first_name || "there"),
        phone: rows[0].phone ? String(rows[0].phone) : null,
        preferred_language: "en",
        prefs: parseAdminNotificationPrefs(rows[0].notification_prefs_json),
      };
      const link = `${APP_URL}/admin/my-tasks`;
      await deliverAdminNotificationChannels({
        admin,
        eventKey: "work_task_assigned",
        tpl: {
          subject: `Task assigned: ${opts.title}`,
          html: `<p>Hi ${admin.first_name},</p>
          <p>You were assigned a work task: <strong>${opts.title}</strong>.</p>
          <p><a href="${link}">Open My Tasks</a></p>`,
          inAppTitle: `Task assigned: ${opts.title}`,
          inAppBody: "Open My Tasks to review the assignment.",
          linkUrl: link,
          smsBody: `Optimum: task assigned — ${opts.title}`,
        },
      });
    } catch (e: any) {
      console.error("[work-tasks:notify]", e?.message ?? e);
    }
  }

  // List board tasks (Jira-style: unassigned backlog + assigned)
  app.get(
    "/api/admin/work-tasks",
    requireAdmin,
    denyAffiliateAccess,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `${WORK_TASK_SELECT}
         ORDER BY FIELD(t.status,'backlog','doing','done'), t.sort_order ASC, t.due_at IS NULL, t.due_at ASC, t.id DESC`,
      );
      res.json({ tasks: rows.map(mapWorkTaskRow) });
    },
  );

  // Search cases to link on a work task (active first; includes completed/on_hold)
  app.get(
    "/api/admin/work-tasks/case-search",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const q = String(req.query.q || "").trim();
      if (q.length < 1) return res.json({ cases: [] });
      const like = likeContains(q);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT cr.id AS case_id, cr.case_number, cr.client_id, cr.pipeline_stage,
                cr.status AS case_status,
                c.first_name AS client_first_name, c.last_name AS client_last_name,
                c.email AS client_email
         FROM credit_repair_cases cr
         JOIN clients c ON c.id = cr.client_id
         WHERE cr.status <> 'cancelled'
           AND (
             cr.case_number LIKE ? ESCAPE '!'
             OR c.first_name LIKE ? ESCAPE '!'
             OR c.last_name LIKE ? ESCAPE '!'
             OR c.email LIKE ? ESCAPE '!'
             OR CONCAT(c.first_name, ' ', c.last_name) LIKE ? ESCAPE '!'
           )
         ORDER BY FIELD(cr.status,'active','on_hold','completed') ASC,
                  cr.updated_at DESC
         LIMIT 10`,
        [like, like, like, like, like],
      );
      res.json({
        cases: rows.map((r) => ({
          case_id: Number(r.case_id),
          case_number: (r.case_number as string) || null,
          client_id: Number(r.client_id),
          client_first_name: String(r.client_first_name || ""),
          client_last_name: String(r.client_last_name || ""),
          client_email: (r.client_email as string) || null,
          pipeline_stage: String(r.pipeline_stage || ""),
          case_status: String(r.case_status || "active"),
        })),
      });
    },
  );

  app.get(
    "/api/admin/work-tasks/assignees",
    requireAdmin,
    denyAffiliateAccess,
    async (_req, res) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, first_name, last_name, email, role
         FROM admins
         WHERE status = 'active'
           AND role IN ('super_admin','admin','agent')
         ORDER BY first_name ASC, last_name ASC`,
      );
      res.json({ assignees: rows });
    },
  );

  app.get(
    "/api/admin/work-tasks/badge",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const adminId = req.auth!.id;
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT
           SUM(CASE WHEN assignee_admin_id = ? AND status <> 'done' THEN 1 ELSE 0 END) AS mine_open,
           SUM(CASE WHEN assignee_admin_id = ? AND status <> 'done'
                     AND due_at IS NOT NULL AND due_at < NOW() THEN 1 ELSE 0 END) AS mine_overdue
         FROM admin_work_tasks`,
        [adminId, adminId],
      );
      res.json({
        mine_open: Number(rows[0]?.mine_open || 0),
        mine_overdue: Number(rows[0]?.mine_overdue || 0),
      });
    },
  );

  app.post(
    "/api/admin/work-tasks",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const {
        title,
        description,
        status,
        priority,
        due_at,
        labels,
        assignee_admin_id,
        case_id,
      } = req.body || {};
      if (!title || !String(title).trim()) {
        return res.status(400).json({ error: "title is required" });
      }
      const allowedStatus = ["backlog", "doing", "done"];
      const allowedPriority = ["low", "medium", "high", "urgent"];
      const st = allowedStatus.includes(status) ? status : "backlog";
      const pr = allowedPriority.includes(priority) ? priority : "medium";
      const assigneeId =
        assignee_admin_id != null && assignee_admin_id !== ""
          ? Number(assignee_admin_id)
          : null;
      const labelsJson = JSON.stringify(
        Array.isArray(labels) ? labels.map(String).slice(0, 20) : [],
      );
      const caseRes = await resolveWorkTaskCaseId(
        case_id !== undefined ? case_id : null,
      );
      if (caseRes.error) {
        return res.status(400).json({ error: caseRes.error });
      }

      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO admin_work_tasks
           (title, description, status, priority, due_at, labels_json, source,
            assignee_admin_id, case_id, created_by_admin_id)
         VALUES (?, ?, ?, ?, ?, ?, 'optimum', ?, ?, ?)`,
        [
          String(title).trim().slice(0, 255),
          description ? String(description) : null,
          st,
          pr,
          due_at || null,
          labelsJson,
          assigneeId && !isNaN(assigneeId) ? assigneeId : null,
          caseRes.caseId,
          req.auth!.id,
        ],
      );
      const taskId = ins.insertId;
      if (assigneeId && !isNaN(assigneeId)) {
        void notifyWorkTaskAssignee({
          assigneeId,
          title: String(title).trim(),
          assignerId: req.auth!.id,
          taskId,
        });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `${WORK_TASK_SELECT} WHERE t.id = ? LIMIT 1`,
        [taskId],
      );
      res.status(201).json({ task: mapWorkTaskRow(rows[0]) });
    },
  );

  app.put(
    "/api/admin/work-tasks/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid id" });
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM admin_work_tasks WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!existing[0])
        return res.status(404).json({ error: "Task not found" });
      const cur = existing[0];
      const b = req.body || {};
      const updates: string[] = [];
      const args: any[] = [];
      if (b.title != null) {
        updates.push("title = ?");
        args.push(String(b.title).trim().slice(0, 255));
      }
      if (b.description !== undefined) {
        updates.push("description = ?");
        args.push(b.description ? String(b.description) : null);
      }
      if (["backlog", "doing", "done"].includes(b.status)) {
        updates.push("status = ?");
        args.push(b.status);
      }
      if (["low", "medium", "high", "urgent"].includes(b.priority)) {
        updates.push("priority = ?");
        args.push(b.priority);
      }
      if (b.due_at !== undefined) {
        updates.push("due_at = ?");
        args.push(b.due_at || null);
      }
      if (b.labels !== undefined) {
        updates.push("labels_json = ?");
        args.push(
          JSON.stringify(
            Array.isArray(b.labels) ? b.labels.map(String).slice(0, 20) : [],
          ),
        );
      }
      if (b.assignee_admin_id !== undefined) {
        updates.push("assignee_admin_id = ?");
        args.push(
          b.assignee_admin_id != null && b.assignee_admin_id !== ""
            ? Number(b.assignee_admin_id)
            : null,
        );
      }
      if (b.case_id !== undefined) {
        const caseRes = await resolveWorkTaskCaseId(b.case_id);
        if (caseRes.error) {
          return res.status(400).json({ error: caseRes.error });
        }
        updates.push("case_id = ?");
        args.push(caseRes.caseId);
      }
      if (b.sort_order != null) {
        updates.push("sort_order = ?");
        args.push(Number(b.sort_order) || 0);
      }

      // HubSpot-linked edits need a push
      if (cur.hubspot_task_id && updates.length > 0) {
        updates.push("pending_push = 1");
      }
      // Reset due reminder when due date moves into the future / changes
      if (b.due_at !== undefined) {
        updates.push("due_notified_at = NULL");
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }
      args.push(id);
      await pool.query(
        `UPDATE admin_work_tasks SET ${updates.join(", ")} WHERE id = ?`,
        args,
      );

      // Immediate push for HubSpot-linked cards
      if (cur.hubspot_task_id && (await adminCanExtractHubspot(req.auth!.id))) {
        const tokens = await loadHubspotTokens(req.auth!.id);
        if (tokens) {
          try {
            const [fresh] = await pool.query<RowDataPacket[]>(
              `SELECT * FROM admin_work_tasks WHERE id = ? LIMIT 1`,
              [id],
            );
            const f = fresh[0];
            await updateHubspotTask(
              tokens.access_token,
              String(cur.hubspot_task_id),
              {
                title: f.title as string,
                description: (f.description as string) || null,
                status: f.status as any,
                priority: f.priority as any,
                due_at: f.due_at ? new Date(f.due_at).toISOString() : null,
              },
            );
            await pool.query(
              `UPDATE admin_work_tasks
               SET pending_push = 0, last_synced_at = NOW(), sync_error = NULL
               WHERE id = ?`,
              [id],
            );
          } catch (e: any) {
            await pool.query(
              `UPDATE admin_work_tasks SET sync_error = ? WHERE id = ?`,
              [String(e?.message || "HubSpot push failed").slice(0, 500), id],
            );
          }
        }
      }

      const prevAssignee = cur.assignee_admin_id
        ? Number(cur.assignee_admin_id)
        : null;
      const nextAssignee =
        b.assignee_admin_id !== undefined
          ? b.assignee_admin_id != null && b.assignee_admin_id !== ""
            ? Number(b.assignee_admin_id)
            : null
          : prevAssignee;
      if (nextAssignee && nextAssignee !== prevAssignee) {
        void notifyWorkTaskAssignee({
          assigneeId: nextAssignee,
          title: String(b.title ?? cur.title),
          assignerId: req.auth!.id,
          taskId: id,
        });
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        `${WORK_TASK_SELECT} WHERE t.id = ? LIMIT 1`,
        [id],
      );
      res.json({ task: mapWorkTaskRow(rows[0]) });
    },
  );

  app.delete(
    "/api/admin/work-tasks/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: "Invalid id" });
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id, source FROM admin_work_tasks WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!existing[0])
        return res.status(404).json({ error: "Task not found" });
      // Soft-remove from Optimum only (does not delete in HubSpot)
      await pool.query(`DELETE FROM admin_work_tasks WHERE id = ?`, [id]);
      res.json({ ok: true });
    },
  );

  // HubSpot connection status for current admin
  app.get(
    "/api/admin/hubspot/status",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const adminId = req.auth!.id;
      const canExtract = await adminCanExtractHubspot(adminId);
      const authMode = hubspotAuthMode();
      const serviceKeyMode = authMode === "service_key";
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT hub_domain, connected_at, revoked_at
         FROM admin_hubspot_connections WHERE admin_id = ? LIMIT 1`,
        [adminId],
      );
      const oauthConnected = Boolean(rows[0] && !rows[0].revoked_at);
      // Service Key is account-wide: permitted admins are treated as connected.
      const connected = serviceKeyMode ? canExtract : oauthConnected;
      res.json({
        connected,
        can_extract: canExtract,
        hub_domain: connected
          ? serviceKeyMode
            ? "service-key"
            : rows[0]?.hub_domain || null
          : null,
        connected_at:
          connected && !serviceKeyMode && rows[0]?.connected_at
            ? new Date(rows[0].connected_at).toISOString()
            : connected && serviceKeyMode
              ? new Date().toISOString()
              : null,
        // True when any sync path is configured (Service Key and/or OAuth client).
        oauth_configured: isHubspotSyncConfigured(),
        auth_mode: authMode,
      });
    },
  );

  app.get(
    "/api/admin/hubspot/oauth/start",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const adminId = req.auth!.id;
      if (!(await adminCanExtractHubspot(adminId))) {
        return res.status(403).json({
          error:
            "HubSpot extract is not enabled for your account. Ask a super admin.",
        });
      }
      if (isHubspotServiceKeyConfigured()) {
        return res.status(400).json({
          error:
            "HubSpot is configured with a Service Key. No per-admin OAuth connect is needed — use Sync now.",
        });
      }
      if (!isHubspotOAuthConfigured()) {
        return res.status(503).json({
          error: "HubSpot OAuth is not configured (HUBSPOT_CLIENT_ID/SECRET).",
        });
      }
      const redirectUri = `${APP_URL}/api/admin/hubspot/oauth/callback`;
      const state = Buffer.from(
        JSON.stringify({
          adminId,
          nonce: crypto.randomBytes(16).toString("hex"),
          ts: Date.now(),
        }),
      ).toString("base64url");
      // Short-lived state in sessions-like table: store on admin connection row pending
      await pool.query(
        `INSERT INTO admin_hubspot_connections
           (admin_id, hub_id, token_ciphertext, token_iv, token_tag, scopes, revoked_at)
         VALUES (?, NULL, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           token_iv = VALUES(token_iv),
           token_tag = VALUES(token_tag),
           scopes = VALUES(scopes),
           updated_at = NOW()`,
        [
          adminId,
          Buffer.from("pending"),
          state.slice(0, 64),
          "oauth-state",
          "oauth_pending",
        ],
      );
      const url = buildHubspotAuthorizeUrl({ redirectUri, state });
      if (!url) return res.status(503).json({ error: "OAuth not configured" });
      res.json({ authorize_url: url });
    },
  );

  app.get("/api/admin/hubspot/oauth/callback", async (req, res) => {
    try {
      const code = String(req.query.code || "");
      const stateRaw = String(req.query.state || "");
      if (!code || !stateRaw) {
        return res.redirect(
          `${APP_URL}/admin/my-tasks?hubspot=error&reason=missing_code`,
        );
      }
      let state: { adminId: number; nonce: string; ts: number };
      try {
        state = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
      } catch {
        return res.redirect(
          `${APP_URL}/admin/my-tasks?hubspot=error&reason=bad_state`,
        );
      }
      if (!state.adminId || Date.now() - state.ts > 15 * 60 * 1000) {
        return res.redirect(
          `${APP_URL}/admin/my-tasks?hubspot=error&reason=state_expired`,
        );
      }
      // Verify pending state matches
      const [pending] = await pool.query<RowDataPacket[]>(
        `SELECT token_iv FROM admin_hubspot_connections WHERE admin_id = ? LIMIT 1`,
        [state.adminId],
      );
      if (
        !pending[0] ||
        String(pending[0].token_iv) !== stateRaw.slice(0, 64)
      ) {
        return res.redirect(
          `${APP_URL}/admin/my-tasks?hubspot=error&reason=state_mismatch`,
        );
      }
      if (!(await adminCanExtractHubspot(state.adminId))) {
        return res.redirect(
          `${APP_URL}/admin/my-tasks?hubspot=error&reason=forbidden`,
        );
      }
      const redirectUri = `${APP_URL}/api/admin/hubspot/oauth/callback`;
      const tokens = await exchangeHubspotCode({ code, redirectUri });
      const account = await fetchHubspotAccountInfo(tokens.access_token);
      const enc = encryptJsonSecrets(
        tokens as unknown as Record<string, unknown>,
      );
      await pool.query<ResultSetHeader>(
        `INSERT INTO admin_hubspot_connections
           (admin_id, hub_id, hub_domain, token_ciphertext, token_iv, token_tag, scopes, revoked_at, connected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NOW())
         ON DUPLICATE KEY UPDATE
           hub_id = VALUES(hub_id),
           hub_domain = VALUES(hub_domain),
           token_ciphertext = VALUES(token_ciphertext),
           token_iv = VALUES(token_iv),
           token_tag = VALUES(token_tag),
           scopes = VALUES(scopes),
           revoked_at = NULL,
           connected_at = NOW(),
           updated_at = NOW()`,
        [
          state.adminId,
          account.hub_id || null,
          account.hub_domain || null,
          enc.ciphertext,
          enc.iv,
          enc.tag,
          HUBSPOT_SCOPES,
        ],
      );
      res.redirect(`${APP_URL}/admin/my-tasks?hubspot=connected`);
    } catch (e: any) {
      console.error("[hubspot:oauth-callback]", e?.message ?? e);
      res.redirect(
        `${APP_URL}/admin/my-tasks?hubspot=error&reason=${encodeURIComponent(e?.message || "oauth_failed")}`,
      );
    }
  });

  app.post(
    "/api/admin/hubspot/disconnect",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      if (isHubspotServiceKeyConfigured()) {
        return res.status(400).json({
          error:
            "HubSpot uses a shared Service Key. Remove HUBSPOT_SERVICE_KEY from env to disconnect.",
        });
      }
      await pool.query(
        `UPDATE admin_hubspot_connections SET revoked_at = NOW() WHERE admin_id = ?`,
        [req.auth!.id],
      );
      res.json({ ok: true });
    },
  );

  // Soft sync: pull HubSpot → upsert; push pending Optimum→HubSpot
  app.post(
    "/api/admin/hubspot/sync",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const adminId = req.auth!.id;
      if (!(await adminCanExtractHubspot(adminId))) {
        return res.status(403).json({ error: "HubSpot extract not permitted" });
      }
      const tokens = await loadHubspotTokens(adminId);
      if (!tokens) {
        return res.status(400).json({ error: "Connect HubSpot first" });
      }

      const result = {
        pulled: 0,
        updated: 0,
        created: 0,
        pushed: 0,
        errors: [] as string[],
      };

      try {
        const remote = await listHubspotTasks(tokens.access_token, 100);
        result.pulled = remote.length;

        const [locals] = await pool.query<RowDataPacket[]>(
          `SELECT id, title, due_at, hubspot_task_id, status, pending_push
           FROM admin_work_tasks WHERE source = 'hubspot' OR hubspot_task_id IS NOT NULL`,
        );
        const byHsId = new Map<string, RowDataPacket>();
        const byMatch = new Map<string, RowDataPacket>();
        for (const row of locals) {
          if (row.hubspot_task_id) byHsId.set(String(row.hubspot_task_id), row);
          byMatch.set(
            workTaskMatchKey(
              String(row.title),
              row.due_at ? new Date(row.due_at).toISOString() : null,
            ),
            row,
          );
        }

        for (const rt of remote) {
          const existing =
            byHsId.get(rt.id) ||
            byMatch.get(workTaskMatchKey(rt.title, rt.due_at));
          if (existing) {
            // Don't clobber local edits waiting to push
            if (existing.pending_push) continue;
            await pool.query(
              `UPDATE admin_work_tasks
               SET title = ?, description = ?, status = ?, priority = ?, due_at = ?,
                   hubspot_task_id = ?, hubspot_owner_id = ?, source = 'hubspot',
                   last_synced_at = NOW(), sync_error = NULL
               WHERE id = ?`,
              [
                rt.title,
                rt.description,
                rt.status,
                rt.priority,
                rt.due_at ? new Date(rt.due_at) : null,
                rt.id,
                rt.owner_id,
                existing.id,
              ],
            );
            result.updated++;
          } else {
            await pool.query(
              `INSERT INTO admin_work_tasks
                 (title, description, status, priority, due_at, labels_json, source,
                  hubspot_task_id, hubspot_owner_id, created_by_admin_id, last_synced_at)
               VALUES (?, ?, ?, ?, ?, '[]', 'hubspot', ?, ?, ?, NOW())`,
              [
                rt.title,
                rt.description,
                rt.status,
                rt.priority,
                rt.due_at ? new Date(rt.due_at) : null,
                rt.id,
                rt.owner_id,
                adminId,
              ],
            );
            result.created++;
          }
        }

        // Push pending local changes
        const [pending] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM admin_work_tasks
           WHERE pending_push = 1 AND hubspot_task_id IS NOT NULL`,
        );
        for (const row of pending) {
          try {
            await updateHubspotTask(
              tokens.access_token,
              String(row.hubspot_task_id),
              {
                title: row.title as string,
                description: (row.description as string) || null,
                status: row.status as any,
                priority: row.priority as any,
                due_at: row.due_at ? new Date(row.due_at).toISOString() : null,
              },
            );
            await pool.query(
              `UPDATE admin_work_tasks
               SET pending_push = 0, last_synced_at = NOW(), sync_error = NULL
               WHERE id = ?`,
              [row.id],
            );
            result.pushed++;
          } catch (e: any) {
            result.errors.push(String(e?.message || e));
            await pool.query(
              `UPDATE admin_work_tasks SET sync_error = ? WHERE id = ?`,
              [String(e?.message || "push failed").slice(0, 500), row.id],
            );
          }
        }
      } catch (e: any) {
        result.errors.push(String(e?.message || e));
      }

      res.json(result);
    },
  );

  // Super-admin: grant/revoke HubSpot extract permission
  app.get(
    "/api/admin/hubspot/permissions",
    requireSuperAdmin,
    async (_req, res) => {
      const serviceKeyMode = isHubspotServiceKeyConfigured();
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT a.id AS admin_id, a.email, a.first_name, a.last_name, a.role,
                COALESCE(p.can_extract, 0) AS can_extract,
                p.granted_at,
                CASE WHEN c.id IS NOT NULL AND c.revoked_at IS NULL THEN 1 ELSE 0 END AS oauth_connected
         FROM admins a
         LEFT JOIN admin_hubspot_permissions p ON p.admin_id = a.id
         LEFT JOIN admin_hubspot_connections c ON c.admin_id = a.id
         WHERE a.status = 'active'
           AND a.role IN ('super_admin','admin','agent')
         ORDER BY a.first_name, a.last_name`,
      );
      res.json({
        permissions: rows.map((r) => {
          const canExtract =
            Boolean(r.can_extract) || r.role === "super_admin";
          // Service Key is account-wide: "connected" means extract is permitted.
          const connected = serviceKeyMode
            ? canExtract
            : Boolean(r.oauth_connected);
          return {
            admin_id: Number(r.admin_id),
            email: r.email,
            first_name: r.first_name,
            last_name: r.last_name,
            role: r.role,
            can_extract: canExtract,
            connected,
            granted_at: r.granted_at
              ? new Date(r.granted_at).toISOString()
              : null,
          };
        }),
      });
    },
  );

  app.put(
    "/api/admin/hubspot/permissions/:adminId",
    requireSuperAdmin,
    async (req: AuthedRequest, res) => {
      const targetId = Number(req.params.adminId);
      if (!targetId) return res.status(400).json({ error: "Invalid admin id" });
      const canExtract = !!req.body?.can_extract;
      const [target] = await pool.query<RowDataPacket[]>(
        `SELECT id, role FROM admins WHERE id = ? LIMIT 1`,
        [targetId],
      );
      if (!target[0]) return res.status(404).json({ error: "Admin not found" });
      if (target[0].role === "super_admin") {
        return res.json({ ok: true, can_extract: true });
      }
      await pool.query(
        `INSERT INTO admin_hubspot_permissions
           (admin_id, can_extract, granted_by_admin_id, granted_at)
         VALUES (?, ?, ?, IF(? = 1, NOW(), NULL))
         ON DUPLICATE KEY UPDATE
           can_extract = VALUES(can_extract),
           granted_by_admin_id = VALUES(granted_by_admin_id),
           granted_at = IF(VALUES(can_extract) = 1, NOW(), granted_at)`,
        [targetId, canExtract ? 1 : 0, req.auth!.id, canExtract ? 1 : 0],
      );
      res.json({ ok: true, can_extract: canExtract });
    },
  );

  // GET /api/admin/cases/:caseId/task-completions — task progress for a case
  app.get(
    "/api/admin/cases/:caseId/task-completions",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const caseId = Number(req.params.caseId);
      if (!caseId || isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case id" });
      }

      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT client_id FROM credit_repair_cases WHERE id = ? LIMIT 1`,
        [caseId],
      );
      if (caseRows.length === 0) {
        return res.status(404).json({ error: "Case not found" });
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id AS template_id, t.slug, t.task_type,
                t.title_en, t.title_es, t.description_en, t.description_es,
                t.is_required, t.is_system, t.sort_order, t.is_active,
                c.id AS completion_id, c.status AS completion_status,
                c.signature_name, c.file_name, c.file_mime,
                c.completed_at, c.admin_review_status, c.admin_notes,
                c.admin_reviewed_at
         FROM onboarding_task_templates t
         LEFT JOIN client_task_completions c
           ON c.task_template_id = t.id AND c.case_id = ?
         WHERE t.is_active = 1
         ORDER BY t.sort_order ASC, t.id ASC`,
        [caseId],
      );

      const tasks = (rows as any[]).map((r) => ({
        id: r.completion_id ?? null,
        template_id: r.template_id,
        slug: r.slug,
        task_type: r.task_type,
        title_en: r.title_en,
        title_es: r.title_es,
        description_en: r.description_en,
        description_es: r.description_es,
        is_required: r.is_required,
        is_system: r.is_system,
        sort_order: r.sort_order,
        is_active: r.is_active,
        completion_status: r.completion_status ?? null,
        signature_name: r.signature_name ?? null,
        file_name: r.file_name ?? null,
        file_mime: r.file_mime ?? null,
        completed_at: r.completed_at ?? null,
        admin_review_status: r.admin_review_status ?? null,
        admin_notes: r.admin_notes ?? null,
        admin_reviewed_at: r.admin_reviewed_at ?? null,
      }));

      res.json({ tasks });
    },
  );

  // GET /api/admin/clients/:id/task-completions — legacy; resolves active case
  app.get(
    "/api/admin/clients/:id/task-completions",
    requireAdmin,
    async (req, res) => {
      const clientId = Number(req.params.id);
      if (!clientId)
        return res.status(400).json({ error: "Invalid client id" });

      const caseId = await resolvePrimaryActiveCaseId(pool, clientId);
      if (!caseId) {
        return res.json({ tasks: [] });
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id AS template_id, t.slug, t.task_type,
                t.title_en, t.title_es, t.description_en, t.description_es,
                t.is_required, t.is_system, t.sort_order, t.is_active,
                c.id AS completion_id, c.status AS completion_status,
                c.signature_name, c.file_name, c.file_mime,
                c.completed_at, c.admin_review_status, c.admin_notes,
                c.admin_reviewed_at
         FROM onboarding_task_templates t
         LEFT JOIN client_task_completions c
           ON c.task_template_id = t.id AND c.case_id = ?
         WHERE t.is_active = 1
         ORDER BY t.sort_order ASC, t.id ASC`,
        [caseId],
      );

      // Normalize: `id` = completion row id (used for approve/reject/preview actions)
      // `template_id` = template reference
      const tasks = (rows as any[]).map((r) => ({
        id: r.completion_id ?? null,
        template_id: r.template_id,
        slug: r.slug,
        task_type: r.task_type,
        title_en: r.title_en,
        title_es: r.title_es,
        description_en: r.description_en,
        description_es: r.description_es,
        is_required: r.is_required,
        is_system: r.is_system,
        sort_order: r.sort_order,
        is_active: r.is_active,
        completion_status: r.completion_status ?? null,
        signature_name: r.signature_name ?? null,
        file_name: r.file_name ?? null,
        file_mime: r.file_mime ?? null,
        completed_at: r.completed_at ?? null,
        admin_review_status: r.admin_review_status ?? null,
        admin_notes: r.admin_notes ?? null,
        admin_reviewed_at: r.admin_reviewed_at ?? null,
      }));

      res.json({ tasks });
    },
  );

  // GET /api/portal/tasks — get all active tasks with this client's completion status
  app.get(
    "/api/portal/tasks",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const activeCaseId = await resolvePrimaryActiveCaseId(pool, clientId);
      if (!activeCaseId) {
        return res.json({ tasks: [] });
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT t.id, t.slug, t.task_type, t.title_en, t.title_es,
              t.description_en, t.description_es,
              t.content_html_en, t.content_html_es,
              t.form_fields_json, t.upload_config_json,
              t.is_required, t.is_system, t.sort_order,
              c.id AS completion_id, c.status AS completion_status,
              c.signature_name, c.file_name, c.completed_at,
              c.admin_review_status, c.admin_notes, c.admin_reviewed_at
       FROM onboarding_task_templates t
       LEFT JOIN client_task_completions c
         ON c.task_template_id = t.id AND c.case_id = ?
       WHERE t.is_active = 1
       ORDER BY t.sort_order ASC, t.id ASC`,
        [activeCaseId],
      );
      const tasks = (rows as any[]).map((r) => ({
        id: r.id,
        slug: r.slug,
        task_type: r.task_type,
        title_en: r.title_en,
        title_es: r.title_es,
        description_en: r.description_en,
        description_es: r.description_es,
        content_html_en: r.content_html_en,
        content_html_es: r.content_html_es,
        form_fields_json: r.form_fields_json,
        upload_config_json: r.upload_config_json,
        is_required: r.is_required,
        is_system: r.is_system,
        sort_order: r.sort_order,
        completion: r.completion_id
          ? {
              id: r.completion_id,
              status: r.completion_status,
              signature_name: r.signature_name,
              file_name: r.file_name,
              completed_at: r.completed_at,
              admin_review_status: r.admin_review_status,
              admin_notes: r.admin_notes,
              admin_reviewed_at: r.admin_reviewed_at,
            }
          : null,
      }));
      res.json({ tasks });
    },
  );

  // POST /api/portal/tasks/:id/complete — submit a task
  app.post(
    "/api/portal/tasks/:id/complete",
    requireClient,
    upload.single("file"),
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const templateId = Number(req.params.id);
      if (!templateId)
        return res.status(400).json({ error: "Invalid task id" });

      const [tRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, task_type, title_en, slug FROM onboarding_task_templates WHERE id = ? AND is_active = 1 LIMIT 1`,
        [templateId],
      );
      if (!tRows[0]) return res.status(404).json({ error: "Task not found" });
      const taskType: string = tRows[0].task_type;
      const taskTitle: string =
        String(tRows[0].title_en || tRows[0].slug || "Task").trim() || "Task";

      const activeCaseId = await resolvePrimaryActiveCaseId(pool, clientId);
      if (!activeCaseId) {
        return res.status(422).json({
          error: "No active credit repair case — contact support",
        });
      }

      let fileStorageKey: string | null = null;
      let fileName: string | null = null;
      let fileMime: string | null = null;
      let formData: unknown = null;
      let signatureName: string | null = null;
      const signatureIp = req.ip || null;

      if (taskType === "upload") {
        const file = req.file as Express.Multer.File | undefined;
        if (!file)
          return res
            .status(400)
            .json({ error: "File is required for upload tasks" });
        const { encrypted, iv, tag } = encryptFile(file.buffer);
        const cdnKey = await uploadToCDN(
          encrypted,
          file.originalname + ".enc",
          "application/octet-stream",
          clientId,
        );
        fileStorageKey = `${cdnKey}|${iv}|${tag}`;
        fileName = file.originalname;
        fileMime = file.mimetype;
      } else if (taskType === "form") {
        try {
          formData =
            typeof req.body.form_data === "string"
              ? JSON.parse(req.body.form_data)
              : req.body.form_data;
        } catch {
          return res.status(400).json({ error: "Invalid form_data JSON" });
        }
        if (!formData)
          return res.status(400).json({ error: "form_data required" });
      } else if (taskType === "sign_document") {
        signatureName = (req.body.signature_name || "").trim();
        if (!signatureName)
          return res.status(400).json({ error: "signature_name required" });
      }

      // Snapshot progress before upsert so we only alert when the client
      // *becomes* ready for review (avoids per-task spam + re-submit noise).
      const progressBefore = await countRequiredOnboardingProgress(activeCaseId);

      await pool.query<ResultSetHeader>(
        `INSERT INTO client_task_completions
          (client_id, case_id, task_template_id, status, form_data_json,
           file_storage_key, file_name, file_mime,
           signature_name, signature_ip, completed_at)
         VALUES (?,?,?, 'completed', ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           status = 'completed',
           form_data_json = VALUES(form_data_json),
           file_storage_key = VALUES(file_storage_key),
           file_name = VALUES(file_name),
           file_mime = VALUES(file_mime),
           signature_name = VALUES(signature_name),
           signature_ip = VALUES(signature_ip),
           completed_at = NOW(),
           admin_review_status = 'pending',
           admin_notes = NULL,
           admin_reviewed_at = NULL`,
        [
          clientId,
          activeCaseId,
          templateId,
          formData ? JSON.stringify(formData) : null,
          fileStorageKey,
          fileName,
          fileMime,
          signatureName,
          signatureIp,
        ],
      );

      const progressAfter = await countRequiredOnboardingProgress(activeCaseId);
      const wasReady =
        progressBefore.required > 0 &&
        progressBefore.completed >= progressBefore.required;
      const isReady =
        progressAfter.required > 0 &&
        progressAfter.completed >= progressAfter.required;
      if (isReady && !wasReady) {
        try {
          await notifyAdminsClientSubmission({
            clientId,
            caseId: activeCaseId,
            summary: `Completed required task "${taskTitle}" — ${progressAfter.completed}/${progressAfter.required} required tasks done (pending admin review).`,
            allRequiredDone: true,
            kind: "ready_review",
          });
        } catch (e: any) {
          console.error("[notify:admins-submission]", e?.message ?? e);
        }
      }

      res.json({ ok: true, completed_at: new Date().toISOString() });
    },
  );

  // GET /api/portal/tasks/:id/file — client views their own submitted file
  app.get(
    "/api/portal/tasks/:id/file",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const templateId = Number(req.params.id);
      const activeCaseId = await resolvePrimaryActiveCaseId(pool, clientId);
      if (!activeCaseId) {
        return res.status(404).json({ error: "File not found" });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_storage_key, file_name, file_mime
         FROM client_task_completions
         WHERE task_template_id = ? AND case_id = ? LIMIT 1`,
        [templateId, activeCaseId],
      );
      if (rows.length === 0 || !rows[0].file_storage_key)
        return res.status(404).json({ error: "File not found" });

      const { file_storage_key, file_name, file_mime } = rows[0];
      const parts = (file_storage_key as string).split("|");
      if (parts.length !== 3)
        return res.status(500).json({ error: "Invalid storage key" });
      const [cdnKey, iv, tag] = parts;
      try {
        const cdnRes = await fetch(cdnKey);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const encrypted = Buffer.from(await cdnRes.arrayBuffer());
        const decrypted = decryptFile(encrypted, iv, tag);
        res.set(
          "Content-Type",
          (file_mime as string) || "application/octet-stream",
        );
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(file_name as string)}"`,
        );
        res.set("Content-Length", String(decrypted.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(decrypted);
      } catch {
        res.status(404).json({ error: "File could not be decrypted" });
      }
    },
  );

  // ============================================================
  // CLIENT INFO REQUESTS
  // ============================================================

  async function loadInfoRequestFiles(requestId: number) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, field_key, file_name, mime_type, file_size, created_at
       FROM client_info_request_files WHERE request_id = ? ORDER BY id ASC`,
      [requestId],
    );
    return rows;
  }

  function mapInfoRequestRow(
    row: RowDataPacket,
    opts: { includeSecrets?: boolean; files?: RowDataPacket[] } = {},
  ) {
    const hasSecrets = !!(
      row.secrets_ciphertext &&
      row.secrets_iv &&
      row.secrets_tag
    );
    let secrets_json: Record<string, unknown> | null = null;
    if (opts.includeSecrets && hasSecrets) {
      try {
        secrets_json = decryptJsonSecrets(
          Buffer.isBuffer(row.secrets_ciphertext)
            ? row.secrets_ciphertext
            : Buffer.from(row.secrets_ciphertext as any),
          String(row.secrets_iv),
          String(row.secrets_tag),
        );
      } catch (e) {
        console.error("[info-request:decrypt]", (e as Error)?.message);
      }
    }
    return {
      id: row.id,
      case_id: row.case_id,
      client_id: row.client_id,
      created_by_admin_id: row.created_by_admin_id,
      preset_key: row.preset_key,
      title_en: row.title_en,
      title_es: row.title_es,
      message_en: row.message_en,
      message_es: row.message_es,
      fields_json: parseInfoFieldsJson(row.fields_json),
      status: row.status,
      due_at: row.due_at,
      response_json: parseInfoResponseJson(row.response_json),
      has_secrets: hasSecrets,
      secrets_json,
      client_consented_at: row.client_consented_at,
      submitted_at: row.submitted_at,
      reviewed_at: row.reviewed_at,
      reviewed_by_admin_id: row.reviewed_by_admin_id,
      rejection_reason: row.rejection_reason,
      case_number: row.case_number ?? null,
      files: opts.files ?? [],
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // Admin: list info requests for a case
  app.get(
    "/api/admin/cases/:caseId/info-requests",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const caseId = Number(req.params.caseId);
      if (!caseId || isNaN(caseId))
        return res.status(400).json({ error: "Invalid case id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT r.*, cr.case_number
         FROM client_info_requests r
         JOIN credit_repair_cases cr ON cr.id = r.case_id
         WHERE r.case_id = ?
         ORDER BY r.created_at DESC`,
        [caseId],
      );
      const requests = [];
      for (const row of rows) {
        const files = await loadInfoRequestFiles(row.id as number);
        requests.push(mapInfoRequestRow(row, { includeSecrets: false, files }));
      }
      res.json({ requests });
    },
  );

  // Admin: create info request
  app.post(
    "/api/admin/cases/:caseId/info-requests",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const caseId = Number(req.params.caseId);
      if (!caseId || isNaN(caseId))
        return res.status(400).json({ error: "Invalid case id" });

      const {
        preset_key,
        title_en,
        title_es,
        message_en,
        message_es,
        fields_json,
        due_at,
      } = req.body || {};

      const createErr = validateCreateInfoRequestPayload({
        title_en,
        title_es,
        fields_json,
      });
      if (createErr) return res.status(400).json({ error: createErr.message });

      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT cr.id, cr.client_id, cr.case_number,
                c.first_name, c.email, c.phone, c.preferred_language
         FROM credit_repair_cases cr
         JOIN clients c ON c.id = cr.client_id
         WHERE cr.id = ? LIMIT 1`,
        [caseId],
      );
      if (!caseRows[0])
        return res.status(404).json({ error: "Case not found" });
      const kase = caseRows[0];

      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO client_info_requests
          (case_id, client_id, created_by_admin_id, preset_key,
           title_en, title_es, message_en, message_es, fields_json, due_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        [
          caseId,
          kase.client_id,
          req.auth!.id,
          preset_key || null,
          String(title_en).trim(),
          String(title_es).trim(),
          message_en?.trim() || null,
          message_es?.trim() || null,
          JSON.stringify(fields_json),
          due_at || null,
        ],
      );

      const requestId = ins.insertId;
      const portalUrl = `${APP_URL}/portal/requests`;
      const lang = (kase.preferred_language as string) || "en";
      const { title } = localizeInfoRequestCopy(
        {
          title_en: String(title_en).trim(),
          title_es: String(title_es).trim(),
        },
        lang,
      );
      const emailTpl = tplInfoRequestCreated({
        firstName: String(kase.first_name || "there"),
        title,
        portalUrl,
        lang,
      });
      sendEmail({
        to: String(kase.email),
        subject: emailTpl.subject,
        html: emailTpl.html,
      }).catch((e) => console.error("[info-request:email]", e?.message));

      if (kase.phone) {
        const smsBody =
          lang === "es"
            ? `Optimum Credit: necesitamos información adicional (${title}). Completa en: ${portalUrl}`
            : `Optimum Credit: we need additional information (${title}). Complete at: ${portalUrl}`;
        sendSms({ to: String(kase.phone), body: smsBody }).catch((e) =>
          console.error("[info-request:sms]", e?.message),
        );
      }

      const [created] = await pool.query<RowDataPacket[]>(
        `SELECT r.*, cr.case_number FROM client_info_requests r
         JOIN credit_repair_cases cr ON cr.id = r.case_id
         WHERE r.id = ? LIMIT 1`,
        [requestId],
      );
      res.status(201).json({
        request: mapInfoRequestRow(created[0], { files: [] }),
      });
    },
  );

  // Admin: get one request (optionally decrypt secrets)
  app.get("/api/admin/info-requests/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const includeSecrets = String(req.query.include_secrets || "") === "1";
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.*, cr.case_number FROM client_info_requests r
         JOIN credit_repair_cases cr ON cr.id = r.case_id
         WHERE r.id = ? LIMIT 1`,
      [id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Not found" });
    const files = await loadInfoRequestFiles(id);
    res.json({
      request: mapInfoRequestRow(rows[0], {
        includeSecrets,
        files,
      }),
    });
  });

  // Admin: cancel
  app.post(
    "/api/admin/info-requests/:id/cancel",
    requireAdmin,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, status FROM client_info_requests WHERE id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      if (!canAdminCancelInfoRequest(String(rows[0].status)))
        return res.status(422).json({ error: "Cannot cancel this request" });
      await pool.query(
        `UPDATE client_info_requests SET status = 'cancelled' WHERE id = ?`,
        [id],
      );
      res.json({ ok: true });
    },
  );

  // Admin: approve / reject
  app.post(
    "/api/admin/info-requests/:id/review",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const { status, rejection_reason } = req.body || {};
      if (!["approved", "rejected"].includes(status))
        return res
          .status(400)
          .json({ error: "status must be approved or rejected" });
      if (status === "rejected" && !String(rejection_reason || "").trim())
        return res.status(400).json({ error: "rejection_reason required" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT r.*, c.first_name, c.email, c.phone, c.preferred_language
         FROM client_info_requests r
         JOIN clients c ON c.id = r.client_id
         WHERE r.id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      if (!canAdminReviewInfoRequest(String(rows[0].status)))
        return res
          .status(422)
          .json({ error: "Only submitted requests can be reviewed" });

      await pool.query(
        `UPDATE client_info_requests
         SET status = ?, rejection_reason = ?, reviewed_at = NOW(), reviewed_by_admin_id = ?
         WHERE id = ?`,
        [
          status,
          status === "rejected" ? String(rejection_reason).trim() : null,
          req.auth!.id,
          id,
        ],
      );

      // On Smart Credit approval, stamp connected_at
      if (status === "approved" && rows[0].preset_key === "smart_credit") {
        await pool.query(
          `UPDATE clients SET smart_credit_connected_at = COALESCE(smart_credit_connected_at, NOW()) WHERE id = ?`,
          [rows[0].client_id],
        );
      }

      const lang = (rows[0].preferred_language as string) || "en";
      const { title } = localizeInfoRequestCopy(
        {
          title_en: String(rows[0].title_en),
          title_es: String(rows[0].title_es),
        },
        lang,
      );
      const portalUrl = `${APP_URL}/portal/requests`;
      const emailTpl = tplInfoRequestReviewed({
        firstName: String(rows[0].first_name || "there"),
        title,
        approved: status === "approved",
        reason: rejection_reason,
        portalUrl,
        lang,
      });
      sendEmail({
        to: String(rows[0].email),
        subject: emailTpl.subject,
        html: emailTpl.html,
      }).catch((e) => console.error("[info-request:review:email]", e?.message));

      if (rows[0].phone) {
        const smsBody =
          status === "approved"
            ? lang === "es"
              ? `Optimum Credit: tu información para "${title}" fue aprobada.`
              : `Optimum Credit: your information for "${title}" was approved.`
            : lang === "es"
              ? `Optimum Credit: vuelve a enviar "${title}". Motivo: ${String(rejection_reason).trim()}. ${portalUrl}`
              : `Optimum Credit: please resubmit "${title}". Reason: ${String(rejection_reason).trim()}. ${portalUrl}`;
        sendSms({ to: String(rows[0].phone), body: smsBody }).catch((e) =>
          console.error("[info-request:review:sms]", e?.message),
        );
      }

      res.json({ ok: true, status });
    },
  );

  // Admin: serve uploaded file
  app.get(
    "/api/admin/info-requests/:id/files/:fileId",
    requireAdmin,
    async (req, res) => {
      const requestId = Number(req.params.id);
      const fileId = Number(req.params.fileId);
      if (!requestId || !fileId)
        return res.status(400).json({ error: "Invalid id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, mime_type, storage_provider, storage_key, encrypted, enc_iv, enc_tag
         FROM client_info_request_files
         WHERE id = ? AND request_id = ? LIMIT 1`,
        [fileId, requestId],
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      const f = rows[0];
      try {
        if (f.storage_provider !== "cdn")
          return res.status(404).json({ error: "Unsupported storage" });
        const cdnRes = await fetch(f.storage_key as string);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const raw = Buffer.from(await cdnRes.arrayBuffer());
        const buf =
          f.encrypted && f.enc_iv && f.enc_tag
            ? decryptFile(raw, f.enc_iv as string, f.enc_tag as string)
            : raw;
        res.set(
          "Content-Type",
          (f.mime_type as string) || "application/octet-stream",
        );
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(f.file_name as string)}"`,
        );
        res.set("Cache-Control", "no-store");
        res.send(buf);
      } catch {
        res.status(404).json({ error: "File could not be read" });
      }
    },
  );

  // Portal: list all info requests for this client
  app.get(
    "/api/portal/info-requests",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT r.*, cr.case_number
         FROM client_info_requests r
         JOIN credit_repair_cases cr ON cr.id = r.case_id
         WHERE r.client_id = ?
         ORDER BY
           FIELD(r.status, 'rejected', 'open', 'submitted', 'approved', 'cancelled'),
           r.created_at DESC`,
        [clientId],
      );
      const requests = [];
      for (const row of rows) {
        const files = await loadInfoRequestFiles(row.id as number);
        requests.push(mapInfoRequestRow(row, { includeSecrets: false, files }));
      }
      const actionable = requests.filter((r) =>
        isInfoRequestActionable(r.status),
      ).length;
      res.json({ requests, actionable_count: actionable });
    },
  );

  // Portal: get one
  app.get(
    "/api/portal/info-requests/:id",
    requireClient,
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT r.*, cr.case_number
         FROM client_info_requests r
         JOIN credit_repair_cases cr ON cr.id = r.case_id
         WHERE r.id = ? AND r.client_id = ? LIMIT 1`,
        [id, clientId],
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      const files = await loadInfoRequestFiles(id);
      res.json({
        request: mapInfoRequestRow(rows[0], {
          includeSecrets: false,
          files,
        }),
      });
    },
  );

  // Portal: submit / resubmit
  app.post(
    "/api/portal/info-requests/:id/submit",
    requireClient,
    upload.any(),
    async (req: AuthedRequest, res) => {
      const clientId = req.auth!.id;
      const id = Number(req.params.id);
      if (!id || isNaN(id))
        return res.status(400).json({ error: "Invalid id" });

      const agreedTerms =
        req.body?.agreed_terms === true ||
        req.body?.agreed_terms === "true" ||
        req.body?.agreed_terms === "1";
      const agreedSms =
        req.body?.agreed_sms === true ||
        req.body?.agreed_sms === "true" ||
        req.body?.agreed_sms === "1";
      const consentErr = validateInfoRequestConsent(agreedTerms, agreedSms);
      if (consentErr)
        return res.status(400).json({ error: consentErr.message });

      let responses: Record<string, unknown> = {};
      try {
        const raw = req.body?.responses;
        responses =
          typeof raw === "string"
            ? (JSON.parse(raw) as Record<string, unknown>)
            : raw && typeof raw === "object"
              ? (raw as Record<string, unknown>)
              : {};
      } catch {
        return res.status(400).json({ error: "Invalid responses payload" });
      }

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT r.*, c.first_name, c.last_name, c.email,
                c.anet_customer_profile_id, c.preferred_language
         FROM client_info_requests r
         JOIN clients c ON c.id = r.client_id
         WHERE r.id = ? AND r.client_id = ? LIMIT 1`,
        [id, clientId],
      );
      if (!rows[0]) return res.status(404).json({ error: "Not found" });
      const row = rows[0];
      if (!canClientSubmitInfoRequest(String(row.status)))
        return res
          .status(422)
          .json({ error: "This request cannot be submitted right now" });

      const fields = parseInfoFieldsJson(row.fields_json);
      const uploadedFiles =
        (req.files as Express.Multer.File[] | undefined) || [];
      const uploadedFieldKeys = new Set<string>();
      for (const f of uploadedFiles) {
        const name = String(f.fieldname || "");
        if (name.startsWith("file_")) uploadedFieldKeys.add(name.slice(5));
        else if (name) uploadedFieldKeys.add(name);
      }
      const dataDescriptor = String(req.body?.dataDescriptor || "");
      const dataValue = String(req.body?.dataValue || "");
      const hasPaymentOpaque = !!(dataDescriptor && dataValue);

      const partitioned = partitionInfoRequestResponses(fields, responses, {
        hasPaymentOpaque,
        uploadedFieldKeys,
      });
      if (partitioned.errors.length > 0) {
        return res.status(400).json({ error: partitioned.errors[0].message });
      }

      const safeResponses: Record<string, unknown> = {
        ...partitioned.safeResponses,
      };
      const secrets: Record<string, unknown> = { ...partitioned.secrets };

      // Persist Smart Credit email on profile (non-secret)
      for (const field of fields) {
        if (field.type !== "smart_credit_block") continue;
        const sc = secrets[field.key] as { email?: string } | undefined;
        if (sc?.email) {
          await pool.query(
            `UPDATE clients SET smart_credit_email = ? WHERE id = ?`,
            [sc.email, clientId],
          );
        }
      }

      if (partitioned.requiresPaymentOpaque && hasPaymentOpaque) {
        try {
          await createOrUpdatePaymentProfileFromOpaque({
            dataDescriptor,
            dataValue,
            clientId,
            email: String(row.email),
            firstName: String(row.first_name || ""),
            lastName: String(row.last_name || ""),
            existingCustomerProfileId: row.anet_customer_profile_id
              ? String(row.anet_customer_profile_id)
              : null,
          });
          for (const field of fields) {
            if (field.type === "payment_card") {
              safeResponses[field.key] = {
                card_updated: true,
                updated_at: new Date().toISOString(),
              };
            }
          }
        } catch (e: any) {
          return res.status(422).json({
            error: e?.message || "Failed to update payment card",
          });
        }
      }

      await pool.query(
        `DELETE FROM client_info_request_files WHERE request_id = ?`,
        [id],
      );
      for (const field of fields) {
        if (field.type !== "upload") continue;
        const key = String(field.key);
        const file =
          uploadedFiles.find((f) => f.fieldname === `file_${key}`) ||
          uploadedFiles.find((f) => f.fieldname === key);
        if (!file) continue;
        const { encrypted, iv, tag } = encryptFile(file.buffer);
        const storageKey = await uploadToCDN(
          encrypted,
          file.originalname,
          file.mimetype,
          clientId,
        );
        await pool.query(
          `INSERT INTO client_info_request_files
            (request_id, field_key, file_name, mime_type, file_size,
             storage_provider, storage_key, encrypted, enc_iv, enc_tag)
           VALUES (?, ?, ?, ?, ?, 'cdn', ?, 1, ?, ?)`,
          [
            id,
            key,
            file.originalname,
            file.mimetype,
            file.size,
            storageKey,
            iv,
            tag,
          ],
        );
        safeResponses[key] = {
          file_name: file.originalname,
          uploaded: true,
        };
      }

      let secretsCipher: Buffer | null = null;
      let secretsIv: string | null = null;
      let secretsTag: string | null = null;
      if (Object.keys(secrets).length > 0) {
        const enc = encryptJsonSecrets(secrets);
        secretsCipher = enc.ciphertext;
        secretsIv = enc.iv;
        secretsTag = enc.tag;
      }

      const [legalRows] = await pool.query<RowDataPacket[]>(
        `SELECT slug, updated_at FROM legal_documents WHERE slug IN ('terms','privacy')`,
      );
      const termsUpdated =
        legalRows.find((l) => l.slug === "terms")?.updated_at ?? null;
      const privacyUpdated =
        legalRows.find((l) => l.slug === "privacy")?.updated_at ?? null;

      await pool.query(
        `UPDATE client_info_requests SET
           status = 'submitted',
           response_json = ?,
           secrets_ciphertext = ?,
           secrets_iv = ?,
           secrets_tag = ?,
           client_consented_at = NOW(),
           client_consent_ip = ?,
           terms_doc_updated_at = ?,
           privacy_doc_updated_at = ?,
           submitted_at = NOW(),
           rejection_reason = NULL,
           reviewed_at = NULL,
           reviewed_by_admin_id = NULL
         WHERE id = ?`,
        [
          JSON.stringify(safeResponses),
          secretsCipher,
          secretsIv,
          secretsTag,
          (req.ip || "").slice(0, 45) || null,
          termsUpdated,
          privacyUpdated,
          id,
        ],
      );

      const caseIdForAlert = Number(row.case_id) || 0;
      if (caseIdForAlert) {
        const title =
          String(row.title_en || row.preset_key || "Info request").trim() ||
          "Info request";
        try {
          await notifyAdminsClientSubmission({
            clientId,
            caseId: caseIdForAlert,
            summary: `Submitted info request: ${title}`,
            allRequiredDone: false,
            kind: "info_request",
          });
        } catch (e: any) {
          console.error("[notify:admins-info-request]", e?.message ?? e);
        }
      }

      res.json({ ok: true, status: "submitted" });
    },
  );

  // ── Reopen an approved task (optional client email alert) ────────────────
  app.post(
    "/api/admin/task-completions/:id/reopen",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const completionId = Number(req.params.id);
      if (!completionId || isNaN(completionId)) {
        return res.status(400).json({ error: "Invalid completion id" });
      }
      const notifyClient = !!req.body?.notify_client;
      const reason = req.body?.reason
        ? String(req.body.reason).trim().slice(0, 1000)
        : null;

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ctc.id, ctc.client_id, ctc.case_id, ctc.status, ctc.admin_review_status,
                ctc.task_template_id,
                ott.slug, ott.title_en, ott.title_es, ott.task_type, ott.is_required,
                c.first_name, c.email, c.preferred_language,
                cr.pipeline_stage, cr.status AS case_status
         FROM client_task_completions ctc
         JOIN clients c ON c.id = ctc.client_id
         JOIN credit_repair_cases cr ON cr.id = ctc.case_id
         JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
         WHERE ctc.id = ? LIMIT 1`,
        [completionId],
      );
      if (!rows[0]) {
        return res.status(404).json({ error: "Task completion not found" });
      }
      const row = rows[0];
      if (row.case_status !== "active") {
        return res.status(422).json({
          error: "Cannot reopen tasks on a non-active case",
          case_status: row.case_status,
        });
      }
      if (row.admin_review_status !== "approved") {
        return res.status(422).json({
          error: "Only approved tasks can be reopened",
        });
      }

      const clientId = Number(row.client_id);
      const caseId = Number(row.case_id);
      const lang = row.preferred_language === "es" ? "es" : "en";
      const taskTitle =
        lang === "es"
          ? String(row.title_es || row.title_en)
          : String(row.title_en || row.slug);
      const pipelineStage = String(row.pipeline_stage || "");

      // Optimistic lock: only reopen if still approved (race-safe)
      const [upd] = await pool.query<ResultSetHeader>(
        `UPDATE client_task_completions
         SET status = 'pending',
             form_data_json = NULL,
             file_storage_key = NULL,
             file_name = NULL,
             file_mime = NULL,
             signature_name = NULL,
             signature_ip = NULL,
             completed_at = NULL,
             admin_review_status = 'pending',
             admin_notes = ?,
             admin_reviewed_at = NULL
         WHERE id = ? AND admin_review_status = 'approved'`,
        [reason ? `Reopened: ${reason}` : "Reopened by admin", completionId],
      );
      if (upd.affectedRows === 0) {
        return res.status(409).json({
          error: "Task was already changed — refresh and try again",
        });
      }

      // Smart: required onboarding tasks must stay consistent with stage.
      // Reopening a required task from Docs Verified OR any later stage rolls
      // back to New Client so "all required approved" remains enforceable.
      let stageRolledBack = false;
      const shouldRollBackRequired =
        Number(row.is_required) === 1 &&
        pipelineStage !== "new_client" &&
        pipelineStage !== "prospect";
      if (shouldRollBackRequired) {
        await advanceCasePipeline(pool, {
          clientId,
          caseId,
          stage: "new_client",
          adminId: req.auth!.id,
          notes: `Reopened required task "${row.slug}" from ${pipelineStage} — returned to New Client`,
        });
        stageRolledBack = true;
      }

      let emailed: string | null = null;
      let expiresAt: string | null = null;
      let notifyError: string | null = null;
      let notifySkippedReason: string | null = null;
      if (notifyClient) {
        const to = row.email ? String(row.email).trim() : "";
        if (!to) {
          notifySkippedReason = "no_email";
        } else {
          try {
            // Test-only hook to exercise email failure without failing reopen
            if (
              process.env.VITEST === "true" &&
              process.env.VITEST_REOPEN_EMAIL_FAIL === "1"
            ) {
              throw new Error("forced_email_fail");
            }
            const ttlHours = ONBOARDING_TOKEN_TTL_HOURS;
            const token = await createOnboardingToken(clientId, ttlHours);
            const portalUrl = `${APP_URL}/portal/onboarding/${token}?task=${encodeURIComponent(String(row.slug))}`;
            const tpl = tplTaskReopened({
              firstName: String(row.first_name),
              taskTitle,
              portalUrl,
              reason,
              expiresHours: ttlHours,
              lang,
            });
            await sendEmail({
              to,
              subject: tpl.subject,
              html: tpl.html,
            });
            emailed = to;
            expiresAt = new Date(
              Date.now() + ttlHours * 60 * 60 * 1000,
            ).toISOString();
          } catch (err: any) {
            // Reopen already committed — never fail the request on email errors
            notifyError = String(err?.message || "email_failed");
            console.error("[reopen:notify]", err?.message || err);
          }
        }
      }

      res.json({
        ok: true,
        reopened: true,
        notified: !!emailed,
        notify_requested: notifyClient,
        notify_skipped_reason: notifySkippedReason,
        notify_error: notifyError,
        emailed,
        expires_at: expiresAt,
        stage_rolled_back: stageRolledBack,
        pipeline_stage: stageRolledBack ? "new_client" : pipelineStage,
        task_slug: row.slug,
        task_type: row.task_type,
        template_id: row.task_template_id,
        is_required: Number(row.is_required) === 1,
      });
    },
  );

  // ── Remind client about a specific onboarding task (secure one-time link) ─
  app.post(
    "/api/admin/cases/:caseId/tasks/:templateId/remind",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const caseId = Number(req.params.caseId);
      const templateId = Number(req.params.templateId);
      if (!caseId || isNaN(caseId) || !templateId || isNaN(templateId)) {
        return res.status(400).json({ error: "Invalid case or task id" });
      }

      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT cr.id, cr.client_id, cr.case_number, cr.status AS case_status,
                c.first_name, c.last_name, c.email, c.phone, c.preferred_language
         FROM credit_repair_cases cr
         JOIN clients c ON c.id = cr.client_id
         WHERE cr.id = ? LIMIT 1`,
        [caseId],
      );
      if (!caseRows[0]) return res.status(404).json({ error: "Case not found" });
      const row = caseRows[0];
      if (!row.email) {
        return res.status(422).json({ error: "Client has no email on file" });
      }

      const [tplRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, slug, title_en, title_es, task_type, is_active
         FROM onboarding_task_templates WHERE id = ? LIMIT 1`,
        [templateId],
      );
      if (!tplRows[0] || !tplRows[0].is_active) {
        return res.status(404).json({ error: "Task template not found" });
      }
      const tpl = tplRows[0];
      const lang = row.preferred_language === "es" ? "es" : "en";
      const taskTitle =
        lang === "es"
          ? String(tpl.title_es || tpl.title_en)
          : String(tpl.title_en || tpl.slug);

      // Ensure a completion row exists so the portal checklist includes this task
      await pool.query<ResultSetHeader>(
        `INSERT IGNORE INTO client_task_completions
           (client_id, case_id, task_template_id, status)
         VALUES (?, ?, ?, 'pending')`,
        [row.client_id, caseId, templateId],
      );

      const ttlHours = ONBOARDING_TOKEN_TTL_HOURS;
      const token = await createOnboardingToken(Number(row.client_id), ttlHours);
      const portalUrl = `${APP_URL}/portal/onboarding/${token}?task=${encodeURIComponent(String(tpl.slug))}`;
      const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

      const emailTpl = tplTaskReminder({
        firstName: String(row.first_name),
        taskTitle,
        portalUrl,
        expiresHours: ttlHours,
        lang,
      });
      await sendEmail({
        to: String(row.email),
        subject: emailTpl.subject,
        html: emailTpl.html,
      });

      res.json({
        ok: true,
        emailed: String(row.email),
        sms_sent: false,
        task_slug: tpl.slug,
        task_title: taskTitle,
        expires_at: expiresAt.toISOString(),
        expires_hours: ttlHours,
      });
    },
  );

  app.put(
    "/api/admin/task-completions/:id/review",
    requireAdmin,
    async (req: AuthedRequest, res) => {
      const completionId = Number(req.params.id);
      if (!completionId || isNaN(completionId))
        return res.status(400).json({ error: "Invalid completion id" });

      const {
        admin_review_status,
        admin_notes,
        case_id: bodyCaseId,
      } = req.body || {};
      if (!["approved", "rejected"].includes(admin_review_status))
        return res
          .status(400)
          .json({ error: "admin_review_status must be approved or rejected" });

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ctc.id, ctc.client_id, ctc.case_id, ctc.status, ctc.task_template_id,
                ott.title_en, ott.is_required, ott.is_active,
                c.first_name, c.email, c.phone, c.preferred_language,
                cr.pipeline_stage
         FROM client_task_completions ctc
         JOIN clients c ON c.id = ctc.client_id
         JOIN credit_repair_cases cr ON cr.id = ctc.case_id
         JOIN onboarding_task_templates ott ON ott.id = ctc.task_template_id
         WHERE ctc.id = ? LIMIT 1`,
        [completionId],
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Task completion not found" });

      const row = rows[0];
      const clientId = row.client_id as number;
      const completionCaseId = row.case_id as number;

      if (bodyCaseId && Number(bodyCaseId) !== completionCaseId) {
        return res.status(400).json({
          error: "case_id does not match this task completion",
        });
      }
      const caseId = completionCaseId;

      await pool.query<ResultSetHeader>(
        `UPDATE client_task_completions
         SET admin_review_status = ?, admin_notes = ?, admin_reviewed_at = NOW()
         WHERE id = ?`,
        [admin_review_status, admin_notes ?? null, completionId],
      );

      // Send rejection notification
      if (admin_review_status === "rejected") {
        const taskLabel = row.title_en as string;
        const portalUrl = `${APP_URL}/portal/documents`;
        if (row.email) {
          const subj =
            row.preferred_language === "es"
              ? `Acción requerida: ${taskLabel}`
              : `Action required: ${taskLabel}`;
          const body =
            row.preferred_language === "es"
              ? `<p>Hola ${row.first_name},</p><p>Una de tus tareas fue rechazada: <strong>${taskLabel}</strong>.</p>${admin_notes ? `<p>Motivo: ${admin_notes}</p>` : ""}<p><a href="${portalUrl}">Ingresa al portal</a> para volver a enviarla.</p>`
              : `<p>Hi ${row.first_name},</p><p>One of your tasks was rejected: <strong>${taskLabel}</strong>.</p>${admin_notes ? `<p>Reason: ${admin_notes}</p>` : ""}<p><a href="${portalUrl}">Log in to the portal</a> to re-submit.</p>`;
          await sendEmail({
            to: row.email as string,
            subject: subj,
            html: body,
          }).catch(() => null);
        }
        if (row.phone) {
          await sendSms({
            to: row.phone as string,
            body: `Optimum Credit: your task "${taskLabel}" was rejected. ${admin_notes ? `Reason: ${admin_notes}. ` : ""}Log in to re-submit: ${portalUrl}`,
          }).catch(() => null);
        }
      }

      // Auto-advance to docs_ready when all required tasks are approved
      if (admin_review_status === "approved") {
        const autoAdvanced = await maybeAutoAdvanceDocsReadyFromTasks({
          clientId,
          caseId,
          adminId: req.auth!.id,
        });
        if (autoAdvanced && row.email) {
          const portalUrl = `${APP_URL}/portal/documents`;
          const subj =
            row.preferred_language === "es"
              ? "¡Tus tareas fueron aprobadas! — Optimum Credit"
              : "All tasks approved — Optimum Credit";
          const body =
            row.preferred_language === "es"
              ? `<p>Hola ${row.first_name},</p><p>¡Todas tus tareas requeridas han sido aprobadas! Tu caso avanzó a la siguiente etapa.</p><p><a href="${portalUrl}">Accede al portal</a></p>`
              : `<p>Hi ${row.first_name},</p><p>All your required tasks have been approved! Your case has advanced to the next stage.</p><p><a href="${portalUrl}">Access your portal</a></p>`;
          await sendEmail({
            to: row.email as string,
            subject: subj,
            html: body,
          }).catch(() => null);
        }
      }

      res.json({ ok: true });
    },
  );

  // ── GET /api/admin/task-completions/:id/file — serve decrypted file ───────
  app.get(
    "/api/admin/task-completions/:id/file",
    requireAdmin,
    async (_req: AuthedRequest, res) => {
      const id = Number(_req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_storage_key, file_name, file_mime
         FROM client_task_completions WHERE id = ? LIMIT 1`,
        [id],
      );
      if (rows.length === 0 || !rows[0].file_storage_key)
        return res.status(404).json({ error: "File not found" });

      const { file_storage_key, file_name, file_mime } = rows[0];
      // Format: cdnUrl|iv|tag
      const parts = (file_storage_key as string).split("|");
      if (parts.length !== 3)
        return res.status(500).json({ error: "Invalid storage key format" });
      const [cdnKey, iv, tag] = parts;

      try {
        const cdnRes = await fetch(cdnKey);
        if (!cdnRes.ok)
          return res.status(404).json({ error: "File not available" });
        const encrypted = Buffer.from(await cdnRes.arrayBuffer());
        const decrypted = decryptFile(encrypted, iv, tag);
        res.set(
          "Content-Type",
          (file_mime as string) || "application/octet-stream",
        );
        res.set(
          "Content-Disposition",
          `inline; filename="${encodeURIComponent(file_name as string)}"`,
        );
        res.set("Content-Length", String(decrypted.length));
        res.set("Cache-Control", "no-store, no-cache");
        res.send(decrypted);
      } catch {
        res.status(404).json({ error: "File could not be decrypted" });
      }
    },
  );

  // ── OFG Report Wizard (inline — Vercel serverless) ─────────────────────────
  app.get(
    "/api/admin/cases/:caseId/report-wizard/before-context",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const caseId = Number(req.params.caseId);
      if (!caseId || isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case id" });
      }
      const roundNumber = Number(req.query.round_number) || 1;
      if (roundNumber < 1 || roundNumber > 5) {
        return res.status(400).json({ error: "round_number must be 1–5" });
      }
      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM credit_repair_cases WHERE id = ? LIMIT 1`,
        [caseId],
      );
      if (caseRows.length === 0) {
        return res.status(404).json({ error: "Case not found" });
      }
      const context = await resolveWizardBeforeContext(
        pool,
        caseId,
        roundNumber,
      );
      res.json({ context });
    },
  );

  app.get(
    "/api/admin/cases/:caseId/report-wizard/sessions",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const caseId = Number(req.params.caseId);
      if (!caseId || isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case id" });
      }
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, case_id, client_id, round_number, status, error_message, created_at, updated_at
         FROM report_wizard_sessions
         WHERE case_id = ? AND status != 'published'
         ORDER BY updated_at DESC`,
        [caseId],
      );
      res.json({ sessions: rows });
    },
  );

  app.post(
    "/api/admin/cases/:caseId/report-wizard/sessions",
    requireAdmin,
    denyAffiliateAccess,
    upload.fields([
      { name: "before_pdf", maxCount: 1 },
      { name: "after_pdf", maxCount: 1 },
    ]),
    async (req: AuthedRequest, res) => {
      const caseId = Number(req.params.caseId);
      if (!caseId || isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case id" });
      }

      const files = req.files as
        | Record<string, Express.Multer.File[]>
        | undefined;
      const beforeFile = files?.before_pdf?.[0];
      const afterFile = files?.after_pdf?.[0];
      const reuseBeforeSessionId =
        Number(req.body?.reuse_before_session_id) || 0;

      if (!afterFile) {
        return res.status(400).json({ error: "after_pdf is required" });
      }
      if (!beforeFile && !reuseBeforeSessionId) {
        return res.status(400).json({
          error:
            "before_pdf is required unless reuse_before_session_id is provided",
        });
      }
      if (afterFile.mimetype !== "application/pdf") {
        return res.status(400).json({ error: "Only PDF files are accepted" });
      }
      if (beforeFile && beforeFile.mimetype !== "application/pdf") {
        return res.status(400).json({ error: "Only PDF files are accepted" });
      }

      const roundNumber = Number(req.body?.round_number) || 1;
      if (roundNumber < 1 || roundNumber > 5) {
        return res.status(400).json({ error: "round_number must be 1–5" });
      }

      const options: OfGReportWizardOptions = {
        highlight_win: req.body?.highlight_win || undefined,
        tradeline_rec: req.body?.tradeline_rec === "true",
        funding_note: req.body?.funding_note === "true",
        spanish: req.body?.spanish === "true",
      };

      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, client_id, pipeline_stage FROM credit_repair_cases WHERE id = ? LIMIT 1`,
        [caseId],
      );
      if (caseRows.length === 0) {
        return res.status(404).json({ error: "Case not found" });
      }
      const clientId = caseRows[0].client_id as number;
      const pipelineStage = caseRows[0].pipeline_stage as string;

      const alreadyPublished = await hasPublishedWizardRound(
        pool,
        clientId,
        roundNumber,
      );
      const roundErr = validatePublishRound({
        roundNumber,
        pipelineStage,
        hasExistingReport: alreadyPublished,
      });
      if (roundErr) return res.status(422).json({ error: roundErr });

      let beforeBuffer: Buffer;
      let beforeFileName: string;
      let beforeSource: "upload" | "prior_round" | "enrollment" = "upload";
      let beforeReusedFrom: number | null = null;

      try {
        if (beforeFile) {
          beforeBuffer = beforeFile.buffer;
          beforeFileName = beforeFile.originalname;
          beforeSource = roundNumber === 1 ? "enrollment" : "upload";
        } else {
          const prior = await loadWizardSession(pool, reuseBeforeSessionId);
          if (!prior || prior.case_id !== caseId) {
            return res.status(404).json({
              error: "Prior wizard session not found for this case",
            });
          }
          if (prior.status !== "published") {
            return res.status(422).json({
              error: "Only a published prior-round after PDF can be reused",
            });
          }
          if ((prior.round_number as number) !== roundNumber - 1) {
            return res.status(422).json({
              error: `reuse_before_session_id must be the published Round ${roundNumber - 1} session`,
            });
          }
          if (!prior.after_pdf_id) {
            return res
              .status(422)
              .json({ error: "Prior session has no after PDF" });
          }
          beforeBuffer = await loadWizardSourcePdfBuffer(
            pool,
            prior.after_pdf_id as number,
            decryptFile,
          );
          const [srcRows] = await pool.query<RowDataPacket[]>(
            `SELECT file_name FROM round_report_source_pdfs WHERE id = ? LIMIT 1`,
            [prior.after_pdf_id],
          );
          beforeFileName =
            (srcRows[0]?.file_name as string) ||
            `round_${prior.round_number}_after.pdf`;
          beforeSource = "prior_round";
          beforeReusedFrom = prior.id as number;
        }
      } catch (e: any) {
        return res.status(400).json({
          error: e?.message || "Failed to load before PDF",
        });
      }

      const pdfErr = validatePdfUploadPair(beforeBuffer, afterFile.buffer);
      if (pdfErr) return res.status(400).json({ error: pdfErr });

      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO report_wizard_sessions
           (case_id, client_id, round_number, status, options_json,
            before_source, before_reused_from_session_id, created_by_admin_id)
         VALUES (?, ?, ?, 'extracting', ?, ?, ?, ?)`,
        [
          caseId,
          clientId,
          roundNumber,
          JSON.stringify(options),
          beforeSource,
          beforeReusedFrom,
          req.auth!.id,
        ],
      );
      const sessionId = ins.insertId;

      const storeSource = async (
        role: "before" | "after",
        buffer: Buffer,
        originalName: string,
      ) => {
        const { encrypted, iv, tag } = encryptFile(buffer);
        const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const cdnUrl = await uploadToCDN(
          encrypted,
          `${role}_${Date.now()}_${safeName}.enc`,
          "application/octet-stream",
          clientId,
        );
        const [pdfIns] = await pool.query<ResultSetHeader>(
          `INSERT INTO round_report_source_pdfs
             (session_id, role, file_name, storage_key, encrypted, enc_iv, enc_tag, uploaded_by_admin_id)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
          [sessionId, role, originalName, cdnUrl, iv, tag, req.auth!.id],
        );
        return pdfIns.insertId;
      };

      try {
        const beforePdfId = await storeSource(
          "before",
          beforeBuffer,
          beforeFileName,
        );
        const afterPdfId = await storeSource(
          "after",
          afterFile.buffer,
          afterFile.originalname,
        );

        await pool.query(
          `UPDATE report_wizard_sessions SET before_pdf_id = ?, after_pdf_id = ? WHERE id = ?`,
          [beforePdfId, afterPdfId, sessionId],
        );

        const [clientRows] = await pool.query<RowDataPacket[]>(
          `SELECT first_name FROM clients WHERE id = ? LIMIT 1`,
          [clientId],
        );
        const firstName = String(clientRows[0]?.first_name || "Client");

        const { data, meta } = await extractFromCreditReportPdfs(
          beforeBuffer,
          afterFile.buffer,
          firstName,
          roundNumber,
          {
            highlightWin: options.highlight_win,
            spanish: options.spanish,
            tradelineRec: options.tradeline_rec,
            fundingNote: options.funding_note,
          },
        );
        meta.before_source = beforeSource;
        meta.before_reused_from_session_id = beforeReusedFrom;

        await pool.query(
          `UPDATE report_wizard_sessions
           SET status = 'review', extracted_json = ?, extraction_meta = ?, updated_at = NOW()
           WHERE id = ?`,
          [JSON.stringify(data), JSON.stringify(meta), sessionId],
        );

        const session = await loadWizardSession(pool, sessionId);
        res.status(201).json({
          session: session ? formatWizardSessionResponse(session) : null,
        });
      } catch (e: any) {
        await pool.query(
          `UPDATE report_wizard_sessions SET status = 'failed', error_message = ?, updated_at = NOW() WHERE id = ?`,
          [String(e?.message || e).slice(0, 500), sessionId],
        );
        console.error("[report-wizard:create]", e);
        res.status(500).json({
          error: e?.message || "Extraction failed",
          session_id: sessionId,
        });
      }
    },
  );

  app.get(
    "/api/admin/report-wizard/sessions/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const sessionId = Number(req.params.id);
      const session = await loadWizardSession(pool, sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json({ session: formatWizardSessionResponse(session) });
    },
  );

  app.post(
    "/api/admin/report-wizard/sessions/:id/extract",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const sessionId = Number(req.params.id);
      const session = await loadWizardSession(pool, sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (session.status === "published") {
        return res
          .status(400)
          .json({ error: "Cannot re-extract published session" });
      }
      if (!canExtractSession(session.status as string)) {
        return res
          .status(409)
          .json({ error: "Extraction already in progress" });
      }

      await pool.query(
        `UPDATE report_wizard_sessions SET status = 'extracting', error_message = NULL, updated_at = NOW() WHERE id = ?`,
        [sessionId],
      );

      try {
        const { data, meta } = await runWizardSessionExtraction(
          pool,
          session,
          decryptFile,
        );
        await pool.query(
          `UPDATE report_wizard_sessions
           SET status = 'review', extracted_json = ?, reviewed_json = NULL,
               extraction_meta = ?, updated_at = NOW()
           WHERE id = ?`,
          [JSON.stringify(data), JSON.stringify(meta), sessionId],
        );
        const updated = await loadWizardSession(pool, sessionId);
        res.json({
          session: {
            ...updated,
            options_json: parseWizardJsonField(updated?.options_json),
            extracted_json: data,
            reviewed_json: null,
            extraction_meta: meta,
          },
        });
      } catch (e: any) {
        await pool.query(
          `UPDATE report_wizard_sessions SET status = 'failed', error_message = ?, updated_at = NOW() WHERE id = ?`,
          [String(e?.message || e).slice(0, 500), sessionId],
        );
        console.error("[report-wizard:extract]", e);
        res.status(500).json({ error: e?.message || "Re-extraction failed" });
      }
    },
  );

  app.post(
    "/api/admin/report-wizard/sessions/:id/preview",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const sessionId = Number(req.params.id);
      const session = await loadWizardSession(pool, sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (!canPreviewSession(session.status as string)) {
        return res
          .status(400)
          .json({ error: "Session cannot be previewed in current state" });
      }

      const data =
        (req.body?.reviewed_json as OfGReportData | undefined) ??
        parseWizardJsonField<OfGReportData>(session.reviewed_json) ??
        parseWizardJsonField<OfGReportData>(session.extracted_json);
      if (!data) {
        return res.status(400).json({ error: "No report data to preview" });
      }

      const { errors: complianceErrors, warnings: complianceWarnings } =
        validateReportCompliance(data);
      if (complianceErrors.length > 0) {
        return res.status(422).json({
          error: "Compliance validation failed",
          issues: complianceErrors,
          warnings: complianceWarnings,
        });
      }

      // Soft warnings (e.g. large score drops) do not block preview —
      // admin is verifying the PDF. Surface them in a response header.
      if (complianceWarnings.length > 0) {
        res.set(
          "X-Compliance-Warnings",
          encodeURIComponent(JSON.stringify(complianceWarnings)),
        );
      }

      try {
        const { buffer, fileName } = await generateOfgProgressReportPdf(
          data,
          `${data.client.firstName}_OFG_Preview.pdf`,
        );
        res.set("Content-Type", "application/pdf");
        res.set("Content-Disposition", `inline; filename="${fileName}"`);
        res.set("Cache-Control", "no-store");
        res.send(buffer);
      } catch (e: any) {
        console.error("[report-wizard:preview]", e);
        res
          .status(500)
          .json({ error: e?.message || "Preview generation failed" });
      }
    },
  );

  app.patch(
    "/api/admin/report-wizard/sessions/:id/review",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const sessionId = Number(req.params.id);
      const session = await loadWizardSession(pool, sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      if (!canReviewSession(session.status as string)) {
        return res
          .status(400)
          .json({ error: "Session is not in review state" });
      }

      const reviewed = req.body?.reviewed_json as OfGReportData | undefined;
      if (!reviewed?.middleScore) {
        return res.status(400).json({ error: "reviewed_json required" });
      }

      await pool.query(
        `UPDATE report_wizard_sessions
         SET reviewed_json = ?, status = 'review', updated_at = NOW()
         WHERE id = ?`,
        [JSON.stringify(reviewed), sessionId],
      );

      const updated = await loadWizardSession(pool, sessionId);
      res.json({
        session: {
          ...updated,
          reviewed_json: reviewed,
          extracted_json: parseWizardJsonField(updated?.extracted_json),
        },
      });
    },
  );

  app.post(
    "/api/admin/report-wizard/sessions/:id/finalize",
    requireAdmin,
    denyAffiliateAccess,
    async (req: AuthedRequest, res) => {
      const sessionId = Number(req.params.id);
      const session = await loadWizardSession(pool, sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });

      if (session.status === "published") {
        return res.json({ ok: true, already_published: true });
      }
      if (!canFinalizeSession(session.status as string)) {
        return res.status(400).json({
          error:
            session.status === "failed"
              ? "Session failed — re-extract or start a new session"
              : "Session is not ready to publish",
        });
      }

      const duplicatePublished = await hasPublishedWizardRound(
        pool,
        session.client_id as number,
        session.round_number as number,
        sessionId,
      );
      if (duplicatePublished) {
        return res.status(409).json({
          error: `Round ${session.round_number} already has a published wizard report`,
        });
      }

      const [caseRows] = await pool.query<RowDataPacket[]>(
        `SELECT pipeline_stage FROM credit_repair_cases WHERE id = ? LIMIT 1`,
        [session.case_id],
      );
      const roundErr = validatePublishRound({
        roundNumber: session.round_number as number,
        pipelineStage: (caseRows[0]?.pipeline_stage as string) || "new_client",
        hasExistingReport: false,
      });
      if (roundErr) return res.status(422).json({ error: roundErr });

      const data =
        parseWizardJsonField<OfGReportData>(session.reviewed_json) ??
        parseWizardJsonField<OfGReportData>(session.extracted_json);
      if (!data) {
        return res.status(400).json({ error: "No report data to publish" });
      }

      if (!req.body?.compliance_acknowledged) {
        return res
          .status(400)
          .json({ error: "Compliance attestation required" });
      }

      const { errors: complianceErrors, warnings: complianceWarnings } =
        validateReportCompliance(data);
      if (complianceErrors.length > 0) {
        return res.status(422).json({
          error: "Compliance validation failed",
          issues: complianceErrors,
          warnings: complianceWarnings,
        });
      }
      if (
        complianceWarnings.length > 0 &&
        !req.body?.acknowledge_score_anomalies
      ) {
        return res.status(422).json({
          error:
            "Score anomalies detected — correct scores in review, or acknowledge them before publishing",
          issues: complianceWarnings,
          warnings: complianceWarnings,
        });
      }

      const clientId = session.client_id as number;
      const caseId = session.case_id as number;
      const roundNumber = session.round_number as number;
      const adminId = req.auth!.id;

      const [lockResult] = await pool.query<ResultSetHeader>(
        `UPDATE report_wizard_sessions
         SET status = 'generating', updated_at = NOW()
         WHERE id = ? AND status = 'review'`,
        [sessionId],
      );
      if (lockResult.affectedRows === 0) {
        return res
          .status(409)
          .json({ error: "Session is already being published" });
      }

      let cdnUrl = "";
      let iv = "";
      let tag = "";
      let fileName = "";
      let outputPdfId = 0;
      let roundReportId = 0;
      let newStage = "";

      try {
        const pdfResult = await generateOfgProgressReportPdf(
          data,
          `${data.client.firstName}_OFG_Progress_Report_${new Date().toISOString().slice(0, 7)}.pdf`,
        );
        fileName = pdfResult.fileName;
        const {
          encrypted,
          iv: encIv,
          tag: encTag,
        } = encryptFile(pdfResult.buffer);
        iv = encIv;
        tag = encTag;
        cdnUrl = await uploadToCDN(
          encrypted,
          `ofg_report_r${roundNumber}_${Date.now()}.enc`,
          "application/octet-stream",
          clientId,
        );

        const summaryMd = reportDataToSummaryMd(data);
        const locale = data.locale === "es" ? "es" : "en";
        newStage = pipelineStageAfterRoundReport(roundNumber);

        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();

          await conn.query<ResultSetHeader>(
            `INSERT INTO client_round_reports
               (client_id, case_id, round_number, score_before, score_after,
                items_removed, items_disputed, summary_md,
                bureau_scores_json, wins_json, targets_json, utilization_json,
                action_plan_json, file_strength_score, wizard_session_id, report_locale,
                created_by_admin_id, delivered_via_email, delivered_via_sms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
             ON DUPLICATE KEY UPDATE
               case_id = VALUES(case_id),
               score_before = VALUES(score_before),
               score_after = VALUES(score_after),
               items_removed = VALUES(items_removed),
               items_disputed = VALUES(items_disputed),
               summary_md = VALUES(summary_md),
               bureau_scores_json = VALUES(bureau_scores_json),
               wins_json = VALUES(wins_json),
               targets_json = VALUES(targets_json),
               utilization_json = VALUES(utilization_json),
               action_plan_json = VALUES(action_plan_json),
               file_strength_score = VALUES(file_strength_score),
               wizard_session_id = VALUES(wizard_session_id),
               report_locale = VALUES(report_locale),
               created_by_admin_id = VALUES(created_by_admin_id)`,
            [
              clientId,
              caseId,
              roundNumber,
              data.middleScore.before || null,
              data.middleScore.after || null,
              data.wins.length,
              data.targets.length,
              summaryMd,
              JSON.stringify(data.bureauScores),
              JSON.stringify(data.wins),
              JSON.stringify(data.targets),
              JSON.stringify(data.utilization),
              JSON.stringify(data.actionPlan),
              data.fileStrengthScore,
              sessionId,
              locale,
              adminId,
            ],
          );

          const [[roundReportRow]] = await conn.query<RowDataPacket[]>(
            `SELECT id FROM client_round_reports WHERE client_id = ? AND round_number = ? LIMIT 1`,
            [clientId, roundNumber],
          );
          roundReportId = roundReportRow?.id as number;

          const [pdfIns] = await conn.query<ResultSetHeader>(
            `INSERT INTO round_report_pdfs
               (client_id, round_number, round_report_id, file_name, storage_key, storage_provider, encrypted, enc_iv, enc_tag, uploaded_by_admin_id)
             VALUES (?, ?, ?, ?, ?, 'cdn', 1, ?, ?, ?)`,
            [
              clientId,
              roundNumber,
              roundReportId,
              fileName,
              cdnUrl,
              iv,
              tag,
              adminId,
            ],
          );
          outputPdfId = pdfIns.insertId;

          await advanceCasePipeline(conn, {
            clientId,
            caseId,
            stage: newStage,
            adminId,
            notes: `OFG Progress Report published — Round ${roundNumber}`,
          });

          await conn.query(
            `UPDATE report_wizard_sessions
             SET status = 'published', output_pdf_id = ?, round_report_id = ?,
                 compliance_acknowledged_at = NOW(), published_at = NOW(), updated_at = NOW()
             WHERE id = ?`,
            [outputPdfId, roundReportId, sessionId],
          );

          await conn.query(
            `INSERT INTO audit_logs
               (actor_type, actor_id, action, entity_type, entity_id, changes_json, status)
             VALUES ('admin', ?, 'report_wizard.published', 'client_round_report', ?, ?, 'success')`,
            [
              adminId,
              roundReportId,
              JSON.stringify({
                session_id: sessionId,
                round_number: roundNumber,
                pipeline_stage: newStage,
                wins: data.wins.length,
                targets_remaining: data.targets.length,
              }),
            ],
          );

          await conn.commit();
        } catch (dbErr) {
          await conn.rollback();
          throw dbErr;
        } finally {
          conn.release();
        }

        const tpl = tplRoundComplete({
          firstName: session.first_name as string,
          roundNumber,
          scoreBefore: data.middleScore.before,
          scoreAfter: data.middleScore.after,
          itemsRemoved: data.wins.length,
          portalUrl: `${APP_URL}/portal/reports`,
          lang: (session.preferred_language as string) || "en",
        });
        await sendEmail({
          to: session.email as string,
          subject: tpl.subject,
          html: tpl.html,
        }).catch(() => null);
        if (session.phone) {
          await sendSms({
            to: session.phone as string,
            body: `${session.first_name}, your Round ${roundNumber} OFG Progress Report is ready! ${APP_URL}/portal/reports`,
          }).catch(() => null);
        }
        const scoreChange = String(
          data.middleScore.after - data.middleScore.before,
        );
        await triggerReminderFlow(`round_${roundNumber}_complete`, clientId, {
          items_removed: String(data.wins.length),
          score_change: scoreChange,
        }).catch(() => null);

        if (process.env.CRC_SYNC_STAGES !== "false") {
          crcSyncClient(clientId).catch((e) =>
            console.error("[crc:wizard-publish]", e?.message),
          );
        }

        res.json({
          ok: true,
          session_id: sessionId,
          round_report_id: roundReportId,
          output_pdf_id: outputPdfId,
          pipeline_stage: newStage,
        });
      } catch (e: any) {
        if (cdnUrl) {
          await deleteFromCDN(cdnUrl).catch(() => null);
        }
        await pool.query(
          `UPDATE report_wizard_sessions SET status = 'failed', error_message = ?, updated_at = NOW() WHERE id = ?`,
          [String(e?.message || e).slice(0, 500), sessionId],
        );
        console.error("[report-wizard:finalize]", e);
        res.status(500).json({ error: e?.message || "Publish failed" });
      }
    },
  );

  app.get(
    "/api/admin/report-wizard/sessions/:id/source/:role",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const sessionId = Number(req.params.id);
      const role = req.params.role;
      if (role !== "before" && role !== "after") {
        return res.status(400).json({ error: "role must be before or after" });
      }
      const session = await loadWizardSession(pool, sessionId);
      if (!session) return res.status(404).json({ error: "Session not found" });
      const pdfId =
        role === "before" ? session.before_pdf_id : session.after_pdf_id;
      if (!pdfId) return res.status(404).json({ error: "PDF not found" });
      try {
        const buf = await loadWizardSourcePdfBuffer(
          pool,
          pdfId as number,
          decryptFile,
        );
        res.set("Content-Type", "application/pdf");
        res.set("Cache-Control", "no-store");
        res.send(buf);
      } catch {
        res.status(404).json({ error: "Could not load PDF" });
      }
    },
  );

  app.delete(
    "/api/admin/report-wizard/sessions/:id",
    requireAdmin,
    denyAffiliateAccess,
    async (req, res) => {
      const sessionId = Number(req.params.id);
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT status FROM report_wizard_sessions WHERE id = ? LIMIT 1`,
        [sessionId],
      );
      if (rows.length === 0) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (rows[0].status === "published") {
        return res
          .status(400)
          .json({ error: "Cannot delete published session" });
      }
      await pool.query(`DELETE FROM report_wizard_sessions WHERE id = ?`, [
        sessionId,
      ]);
      res.json({ ok: true });
    },
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const friendly = mapFriendlyError(err);
    if (friendly) {
      console.error(
        `[Express error handler] ${friendly.status}:`,
        err?.message ?? err,
      );
      return res.status(friendly.status).json({ error: friendly.error });
    }
    const status = typeof err?.status === "number" ? err.status : 500;
    // Never leak raw DB / driver messages to clients
    const raw = String(err?.message ?? err ?? "");
    const looksInternal =
      /Duplicate entry|ER_|ECONNREFUSED|PROTOCOL_|SQL|mysql|tidb|UNSIGNED|out of range/i.test(
        raw,
      );
    const message =
      looksInternal || process.env.NODE_ENV === "production"
        ? "An unexpected error occurred."
        : raw || "An unexpected error occurred.";
    console.error(`[Express error handler] ${status}:`, err?.message ?? err);
    res.status(status).json({ error: message });
  });

  return app;
}

// ============================================================================
// TEST EXPORTS (vitest)
// ============================================================================

export {
  pipelineStageAfterRoundReport,
  validatePdfUploadPair,
  validatePublishRound,
  canExtractSession,
  canReviewSession,
  canPreviewSession,
  canFinalizeSession,
  calcMiddleScore,
  expectedReportRoundForStage,
  isPdfBuffer,
  scoresRoughlyMatchMiddle,
  detectProvider,
  extractAllScores,
  middleScore,
  diffItems,
  buildConfidence,
  computeFileStrengthScore,
  validateReportCompliance,
  detectNegativeLines,
  extractUtilization,
  extractPositiveAccounts,
  toPdfSafeText,
  createSession,
  isDuplicateKeyError,
  mapFriendlyError,
  classifyNegativeLine,
  buildNegativeItems,
  buildProspectAnalysisHtml,
  tplProspectConvertWelcome,
  attachLabelsBySlug,
  buildCorsAllowedOrigins,
  escapeLikePattern,
  likeContains,
};

// ============================================================================
// EXPORTS — Vercel serverless + dev server
// ============================================================================

let app: ReturnType<typeof buildApp>;
if (process.env.VITEST === "true") {
  app = express() as ReturnType<typeof buildApp>;
} else
  try {
    app = buildApp();
  } catch (initErr: any) {
    console.error(
      "[API init] Fatal error during startup:",
      initErr?.message ?? initErr,
    );
    // Serve a JSON 503 for every request when the app fails to initialise
    app = express() as any;
    (app as any).use((_req: Request, res: Response) => {
      res.status(503).json({
        error:
          "Service unavailable — server failed to initialise. Check environment variables.",
      });
    });
  }

export default function handler(req: VercelRequest, res: VercelResponse) {
  try {
    return app(req as any, res as any);
  } catch (err: any) {
    console.error("[API handler]", err?.message ?? err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

export function createServer() {
  return buildApp();
}

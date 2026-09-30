/**
 * Pure MyFreeScoreNow helpers (no Express, no DB).
 *
 * Production entry remains `api/index.ts` (no runtime imports from sibling
 * api modules). Tests import from this file. Keep in sync with the inlined
 * copies in api/index.ts.
 *
 * Ported from credit-check `lib/mfsn.ts` (login + 3B JSON parse only).
 * Does not store member passwords. Does not enroll or charge cards.
 */

export const MFSN_DEFAULT_UAT_BASE = "https://uat-api.myfreescorenow.com";
export const MFSN_REQUEST_TIMEOUT_MS = 30_000;
export const MFSN_TOKEN_TTL_MS = 55 * 60 * 1000;

const BUREAU_LABELS: Record<string, "Equifax" | "Experian" | "TransUnion"> = {
  EFX: "Equifax",
  EXP: "Experian",
  TU: "TransUnion",
};

export type MfsnMode =
  | "disabled"
  | "needs_credentials"
  | "ready_to_probe";

export type MfsnPublicStatus = {
  enabled: boolean;
  credentials_present: boolean;
  client_token_present: boolean;
  base_url: string | null;
  mode: MfsnMode;
  warnings: string[];
};

export class MfsnError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "MfsnError";
  }
}

export function isMfsnFeatureEnabled(raw?: string | null): boolean {
  const v = String(raw ?? "0")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export function readMfsnEnv(env: NodeJS.Dict<string> = process.env): {
  enabled: boolean;
  baseUrl: string;
  apiEmail: string;
  apiPassword: string;
  clientToken: string;
} {
  return {
    enabled: isMfsnFeatureEnabled(env.MFSN_ENABLED),
    baseUrl: String(env.MFSN_API_BASE_URL || MFSN_DEFAULT_UAT_BASE).trim(),
    apiEmail: String(env.MFSN_API_EMAIL || "").trim(),
    apiPassword: String(env.MFSN_API_PASSWORD || ""),
    clientToken: String(env.MFSN_CLIENT_TOKEN || "").trim(),
  };
}

export function mfsnLoginCredentialsPresent(cfg: {
  apiEmail: string;
  apiPassword: string;
}): boolean {
  return Boolean(cfg.apiEmail && cfg.apiPassword);
}

export function buildMfsnPublicStatus(cfg: {
  enabled: boolean;
  baseUrl: string;
  apiEmail: string;
  apiPassword: string;
  clientToken: string;
}): MfsnPublicStatus {
  const credentials_present = mfsnLoginCredentialsPresent(cfg);
  const warnings: string[] = [
    "MFSN portal IP whitelist can block Vercel (dynamic egress) and local IP. Add the caller IP in API Access Setup before probing.",
    "Promote To Production stays locked until Cesar uploads the UX proof PDF. This probe does not complete that packet.",
    "Never store a MyFreeScoreNow member password. Affiliate API user + client_token only.",
  ];
  if (!cfg.enabled) {
    return {
      enabled: false,
      credentials_present,
      client_token_present: Boolean(cfg.clientToken),
      base_url: null,
      mode: "disabled",
      warnings,
    };
  }
  return {
    enabled: true,
    credentials_present,
    client_token_present: Boolean(cfg.clientToken),
    base_url: cfg.baseUrl,
    mode: credentials_present ? "ready_to_probe" : "needs_credentials",
    warnings,
  };
}

export type MfsnLoginResponse = {
  success?: boolean;
  message?: string;
  token?: string;
};

export function parseMfsnLoginResponse(
  status: number,
  body: unknown,
): { ok: boolean; message: string; token: string | null } {
  const data =
    body && typeof body === "object" ? (body as MfsnLoginResponse) : {};
  const token = typeof data.token === "string" && data.token.trim() ? data.token : null;
  const message =
    typeof data.message === "string" && data.message.trim()
      ? data.message
      : status === 200
        ? "Login successful"
        : `MFSN login failed (${status})`;
  const ok = status >= 200 && status < 300 && data.success !== false && Boolean(token);
  return { ok, message, token };
}

export type MfsnProviderView = {
  provider?: string;
  summary?: {
    reportGenerated?: number;
    creditScore?: {
      score?: number;
      scoreReasons?: Array<{
        code?: string;
        description?: string;
        creditScoreFactorEffect?: "HELPING" | "HURTING" | "NEUTRAL";
      }>;
    };
  };
};

export type Mfsn3BReportData = {
  providerViews?: MfsnProviderView[];
  generatedDate?: number;
};

export function parseMfsn3BReport(raw: Mfsn3BReportData): {
  bureauScores: Array<{
    bureau: "Equifax" | "Experian" | "TransUnion";
    score: number;
    asOf: string | null;
  }>;
  scoreFactors: Array<{ code: string; description: string; effect: string }>;
  generatedAt: string | null;
} {
  const bureauScores: Array<{
    bureau: "Equifax" | "Experian" | "TransUnion";
    score: number;
    asOf: string | null;
  }> = [];
  const scoreFactors: Array<{
    code: string;
    description: string;
    effect: string;
  }> = [];
  const seen = new Set<string>();

  for (const view of raw.providerViews ?? []) {
    const bureau = view.provider ? BUREAU_LABELS[view.provider] : undefined;
    const creditScore = view.summary?.creditScore;
    const score = creditScore?.score;
    const asOf = epochMsToIso(view.summary?.reportGenerated);
    if (bureau && typeof score === "number") {
      bureauScores.push({ bureau, score, asOf });
    }
    for (const reason of creditScore?.scoreReasons ?? []) {
      const key = reason.code ?? reason.description ?? "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      scoreFactors.push({
        code: reason.code ?? "Score factor",
        description: reason.description ?? "",
        effect: reason.creditScoreFactorEffect ?? "NEUTRAL",
      });
    }
  }

  return {
    bureauScores,
    scoreFactors: scoreFactors.slice(0, 8),
    generatedAt: epochMsToIso(raw.generatedDate),
  };
}

function epochMsToIso(value?: number): string | null {
  if (!value) return null;
  const ms = value > 1_000_000_000_000 ? value : value * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

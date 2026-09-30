import type { CreditAnalysisResult } from "@shared/api";
import { decodeLiteralUnicodeEscapes } from "@/lib/decodeLiteralUnicodeEscapes";

function analystNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function analystStr(v: unknown): string {
  return typeof v === "string" ? decodeLiteralUnicodeEscapes(v) : "";
}

export interface ParsedNegativeRow {
  account: string;
  type: string;
  bureaus: string;
  priority: string;
  basis: string;
  round: string;
}

export interface ParsedActionRow {
  time: string;
  action: string;
  reason: string;
}

export interface ParsedUtilRow {
  account: string;
  limit: string;
  balance: string;
  percent: string;
  pay30: string;
  pay10: string;
}

export interface ParsedCreditAnalysisView {
  weakExtraction: boolean;
  mid: number | null;
  goal: number | null;
  fhaStatus: string;
  programTierLabel: string;
  timeline: { key: string; label: string; v: number | null }[];
  negRows: ParsedNegativeRow[];
  fallbackNegatives: CreditAnalysisResult["negatives"];
  actions: ParsedActionRow[];
  fsRows: [string, string][];
  fileStrengthScore: number | null;
  fileStrengthRating: string;
  utilRows: ParsedUtilRow[];
  utilNote: string;
  clientMessage: string;
  scoreBands: {
    tu: string;
    ex: string;
    eq: string;
  };
}

export function parseCreditAnalysisView(
  result: CreditAnalysisResult,
  timelineLabels: {
    today: string;
    d30: string;
    d60: string;
    d90: string;
    target: string;
  },
): ParsedCreditAnalysisView {
  const analyst = result.analyst ?? null;
  const weakExtraction =
    Boolean(result.extraction_status) && result.extraction_status !== "ok";

  const negRows = [1, 2, 3, 4, 5]
    .map((i) => ({
      account: analystStr(analyst?.[`neg_${i}_account`]),
      type: analystStr(analyst?.[`neg_${i}_type`]),
      bureaus: analystStr(analyst?.[`neg_${i}_bureaus`]),
      priority: analystStr(analyst?.[`neg_${i}_priority`]),
      basis: analystStr(analyst?.[`neg_${i}_dispute_basis`]),
      round: analystStr(analyst?.[`neg_${i}_round`]),
    }))
    .filter((r) => r.account);

  const utilRows = [1, 2, 3]
    .map((i) => ({
      account: analystStr(analyst?.[`util_${i}_account`]),
      limit: analystStr(analyst?.[`util_${i}_limit`]),
      balance: analystStr(analyst?.[`util_${i}_balance`]),
      percent: analystStr(analyst?.[`util_${i}_percent`]),
      pay30: analystStr(analyst?.[`util_${i}_pay30`]),
      pay10: analystStr(analyst?.[`util_${i}_pay10`]),
    }))
    .filter((r) => r.account);

  return {
    weakExtraction,
    mid: analystNum(analyst?.middle_score),
    goal: analystNum(analyst?.goal_score),
    fhaStatus: analystStr(analyst?.fha_status),
    programTierLabel: analystStr(analyst?.program_tier_label),
    timeline: [
      { key: "today", label: timelineLabels.today, v: analystNum(analyst?.score_today) },
      { key: "30", label: timelineLabels.d30, v: analystNum(analyst?.score_30_days) },
      { key: "60", label: timelineLabels.d60, v: analystNum(analyst?.score_60_days) },
      { key: "90", label: timelineLabels.d90, v: analystNum(analyst?.score_90_days) },
      {
        key: "target",
        label: timelineLabels.target,
        v: analystNum(analyst?.score_target),
      },
    ],
    negRows,
    fallbackNegatives: result.negatives ?? [],
    actions: [1, 2, 3, 4, 5, 6]
      .map((i) => ({
        time: analystStr(analyst?.[`action_${i}_time`]),
        action: analystStr(analyst?.[`action_${i}_action`]),
        reason: analystStr(analyst?.[`action_${i}_reason`]),
      }))
      .filter((a) => a.action),
    fsRows: analyst
      ? (
          [
            [analystStr(analyst.fs_label_1), analystStr(analyst.fs_open_revolving)],
            [analystStr(analyst.fs_label_2), analystStr(analyst.fs_installment_mix)],
            [analystStr(analyst.fs_label_3), analystStr(analyst.fs_mortgage)],
            [analystStr(analyst.fs_label_4), analystStr(analyst.fs_account_age)],
            [analystStr(analyst.fs_label_5), analystStr(analyst.fs_post_repair)],
          ] as [string, string][]
        ).filter(([l]) => l)
      : [],
    fileStrengthScore: analystNum(analyst?.file_strength_score),
    fileStrengthRating: analystStr(analyst?.file_strength_rating),
    utilRows,
    utilNote: analystStr(analyst?.utilization_critical_note),
    clientMessage: analystStr(analyst?.client_text_message),
    scoreBands: {
      tu: analystStr(analyst?.score_tu_label),
      ex: analystStr(analyst?.score_ex_label),
      eq: analystStr(analyst?.score_eq_label),
    },
  };
}

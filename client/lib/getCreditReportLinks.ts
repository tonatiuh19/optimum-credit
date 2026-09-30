/** Public MyFreeScoreNow pull options for /get-credit-report (unlisted). */
export type GetCreditReportOption = "free" | "full";

export const GET_CREDIT_REPORT_URLS: Record<GetCreditReportOption, string> = {
  free: "https://app.myfreescorenow.com/credit-snapshot/29544?s=MXxmYWxzZQ%3D%3D",
  full: "https://app.myfreescorenow.com/enroll/C01C6710?s=MXxmYWxzZQ%3D%3D",
};

/** Masked OFG short path for SMS (SPA or API 302 → free MFSN). */
export const FREE_SCORE_SHORT_PATH = "/go/free-score";

export function resolveGetCreditReportUrl(
  option: string | null | undefined,
): string | null {
  if (option === "free" || option === "full") {
    return GET_CREDIT_REPORT_URLS[option];
  }
  return null;
}

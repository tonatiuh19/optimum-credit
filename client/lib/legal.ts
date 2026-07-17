/**
 * In-app legal document routes (content loaded from DB via /api/legal/:slug).
 */
export const LEGAL_PATHS = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
  /** Same doc as privacy until a dedicated SMS page exists. */
  smsTerms: "/legal/privacy",
} as const;

export type LegalPathKey = keyof typeof LEGAL_PATHS;

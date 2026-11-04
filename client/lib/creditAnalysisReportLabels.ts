/** User-visible copy for credit analysis results — always matches report language, not admin UI i18n. */
export type CreditAnalysisReportLang = "en" | "es";

export interface CreditAnalysisReportLabels {
  documentTitle: string;
  tagline: string;
  resultBadge: string;
  resultHeading: string;
  resultSubheading: string;
  scoresHeading: string;
  transunion: string;
  experian: string;
  equifax: string;
  midScore: string;
  goalScore: string;
  lendingStatus: string;
  timelineHeading: string;
  timelineToday: string;
  timeline30: string;
  timeline60: string;
  timeline90: string;
  timelineTarget: string;
  negativesHeading: string;
  noNegatives: string;
  programTierHeading: string;
  round: string;
  fileStrengthHeading: string;
  actionPlanHeading: string;
  clientMessageHeading: string;
  utilizationHeading: string;
  utilAccount: string;
  utilLimit: string;
  utilBalance: string;
  utilPercent: string;
  utilPay30: string;
  utilPay10: string;
  labelsHeading: string;
  generatedOn: string;
  croaDisclaimer: string;
  priority: string;
  bureaus: string;
  basis: string;
  account: string;
  type: string;
}

const EN: CreditAnalysisReportLabels = {
  documentTitle: "Credit Analysis",
  tagline: "Credit Repair, Done Right",
  resultBadge: "Analysis Complete",
  resultHeading: "Your Credit Analysis Is Ready",
  resultSubheading:
    "Personalized scores, dispute priorities, and an action plan based on your uploaded report.",
  scoresHeading: "Bureau Scores",
  transunion: "TransUnion",
  experian: "Experian",
  equifax: "Equifax",
  midScore: "Mid score",
  goalScore: "Goal score",
  lendingStatus: "Lending status",
  timelineHeading: "Estimated Score Path",
  timelineToday: "Today",
  timeline30: "Round 1",
  timeline60: "Round 2",
  timeline90: "Round 3–4",
  timelineTarget: "Target",
  negativesHeading: "Negative Items Found",
  noNegatives: "No negative items detected — great shape!",
  programTierHeading: "Program tier",
  round: "Round",
  fileStrengthHeading: "File Strength",
  actionPlanHeading: "Action Plan",
  clientMessageHeading: "Client Text Message",
  utilizationHeading: "Revolving Utilization",
  utilAccount: "Account",
  utilLimit: "Limit",
  utilBalance: "Balance",
  utilPercent: "Util %",
  utilPay30: "Pay to 30%",
  utilPay10: "Pay to 10%",
  labelsHeading: "Matched Categories",
  generatedOn: "Generated",
  croaDisclaimer:
    "Optimum Financial Group provides credit repair services in compliance with the Credit Repair Organizations Act (CROA), 15 U.S.C. §1679 et seq. We do not guarantee specific score improvements. Results vary by individual.",
  priority: "Priority",
  bureaus: "Bureaus",
  basis: "Dispute basis",
  account: "Account",
  type: "Type",
};

const ES: CreditAnalysisReportLabels = {
  documentTitle: "Análisis de Crédito",
  tagline: "Reparación de Crédito, Bien Hecha",
  resultBadge: "Análisis Completo",
  resultHeading: "Tu Análisis de Crédito Está Listo",
  resultSubheading:
    "Puntajes personalizados, prioridades de disputa y plan de acción según tu reporte.",
  scoresHeading: "Puntajes de Buró",
  transunion: "TransUnion",
  experian: "Experian",
  equifax: "Equifax",
  midScore: "Puntaje medio",
  goalScore: "Meta",
  lendingStatus: "Estado crediticio",
  timelineHeading: "Progresión del Puntaje",
  timelineToday: "Hoy",
  timeline30: "Ronda 1",
  timeline60: "Ronda 2",
  timeline90: "Ronda 3–4",
  timelineTarget: "Meta",
  negativesHeading: "Ítems Negativos Detectados",
  noNegatives: "No se detectaron ítems negativos — ¡excelente!",
  programTierHeading: "Nivel de programa",
  round: "Ronda",
  fileStrengthHeading: "Fortaleza del Archivo",
  actionPlanHeading: "Plan de Acción",
  clientMessageHeading: "Mensaje para el Cliente",
  utilizationHeading: "Utilización Revolving",
  utilAccount: "Cuenta",
  utilLimit: "Límite",
  utilBalance: "Saldo",
  utilPercent: "Util %",
  utilPay30: "Pago → 30%",
  utilPay10: "Pago → 10%",
  labelsHeading: "Categorías Identificadas",
  generatedOn: "Generado",
  croaDisclaimer:
    "Optimum Financial Group proporciona servicios de reparación de crédito en cumplimiento con la Ley de Organizaciones de Reparación de Crédito (CROA), 15 U.S.C. §1679 et seq. No garantizamos mejoras específicas en el puntaje. Los resultados varían según el individuo.",
  priority: "Prioridad",
  bureaus: "Agencias",
  basis: "Base de disputa",
  account: "Cuenta",
  type: "Tipo",
};

export function creditAnalysisReportLabels(
  lang: CreditAnalysisReportLang,
): CreditAnalysisReportLabels {
  return lang === "es" ? ES : EN;
}

export function resolveCreditAnalysisReportLang(result: {
  text_language?: "en" | "es";
}): CreditAnalysisReportLang {
  return result.text_language === "es" ? "es" : "en";
}

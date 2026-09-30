/** @deprecated Use printCreditAnalysisResult from creditAnalysisPdfDocument */
export function printCreditAnalysisReport(_opts: {
  html: string;
  fileName: string;
  subtitle?: string;
}): void {
  throw new Error("Use printCreditAnalysisResult instead");
}

export function creditAnalysisPdfFileName(opts: {
  firstName?: string;
  lastName?: string;
  generatedAt?: string;
}): string {
  const name = [opts.firstName, opts.lastName]
    .filter(Boolean)
    .join("-")
    .replace(/[^\w-]+/g, "")
    .slice(0, 40);
  const date = opts.generatedAt
    ? new Date(opts.generatedAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return name
    ? `optimum-credit-analysis-${name}-${date}.pdf`
    : `optimum-credit-analysis-${date}.pdf`;
}

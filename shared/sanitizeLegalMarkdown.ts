/**
 * Strip internal editor notes and duplicate page title from public legal MD.
 */
export function sanitizeLegalMarkdown(md: string): string {
  return md
    .replace(
      /^>.*(?:Source:|Extracted for reference|Runtime source|Note:|\*\*Note:\*\*).*\n?/gim,
      "",
    )
    .replace(/^#\s+.+\n+/, "") // page already shows title
    .replace(/^\s*\n+/, "")
    .trim();
}

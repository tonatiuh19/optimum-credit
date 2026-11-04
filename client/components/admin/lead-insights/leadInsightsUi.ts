import type { LeadReadiness } from "@shared/api";

/** Semantic tokens only (DESIGN_SYSTEM): ready = accent, close = primary, long = muted. */
export const READINESS_CLASS: Record<LeadReadiness, string> = {
  ready: "bg-accent/10 text-accent border-accent/30",
  close: "bg-primary/10 text-primary border-primary/30",
  long: "bg-muted text-muted-foreground border-border",
};

/** Heat 0-100 → token class (70+ destructive/hot, 40+ primary, else muted). */
export function heatClass(score: number): string {
  if (score >= 70) return "bg-destructive/10 text-destructive border-destructive/30";
  if (score >= 40) return "bg-primary/10 text-primary border-primary/30";
  return "bg-muted text-muted-foreground border-border";
}

export function fmtUsd(n: number | null | undefined): string {
  return Math.round(Number(n ?? 0)).toLocaleString("en-US");
}

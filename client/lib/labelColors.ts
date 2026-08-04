/**
 * Maps a label's design-token color name (stored in DB, e.g. "primary", "accent")
 * to a literal Tailwind class string. Kept literal (not interpolated) so the
 * Tailwind JIT scanner can find and generate these classes.
 */
const LABEL_COLOR_CLASSES: Record<string, string> = {
  primary: "bg-primary/10 text-primary border-primary/20",
  accent: "bg-accent/10 text-accent border-accent/20",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  secondary: "bg-secondary text-secondary-foreground border-border",
  muted: "bg-muted text-muted-foreground border-border",
};

export function labelColorClasses(color?: string | null): string {
  return LABEL_COLOR_CLASSES[color ?? ""] ?? LABEL_COLOR_CLASSES.muted;
}

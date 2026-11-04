import type { LucideIcon } from "lucide-react";
import { Award, Crown, Flame, Hand, Inbox, Medal, PartyPopper, Phone, Rocket, Sparkles, Star, Trophy, Zap } from "lucide-react";
import type { ProductivityGrade, ProductivityLevel } from "@/store/slices/productivitySlice";

/** Semantic tone per grade: A accent, B primary, C muted, D/F destructive. */
export function gradeTone(grade: ProductivityGrade | null | undefined): { text: string; bg: string; ring: string } {
  switch (grade) {
    case "A":
      return { text: "text-accent", bg: "bg-accent/15", ring: "stroke-accent" };
    case "B":
      return { text: "text-primary", bg: "bg-primary/15", ring: "stroke-primary" };
    case "C":
      return { text: "text-foreground", bg: "bg-muted", ring: "stroke-muted-foreground" };
    case "D":
    case "F":
      return { text: "text-destructive", bg: "bg-destructive/15", ring: "stroke-destructive" };
    default:
      return { text: "text-muted-foreground", bg: "bg-muted", ring: "stroke-muted-foreground" };
  }
}

export function scoreTone(score: number | null): string {
  if (score == null) return "bg-muted-foreground/30";
  if (score >= 90) return "bg-accent";
  if (score >= 70) return "bg-primary";
  return "bg-destructive";
}

export const LEVEL_META: Record<ProductivityLevel, { icon: LucideIcon; tone: string; chip: string }> = {
  bronze: { icon: Medal, tone: "text-muted-foreground", chip: "bg-muted text-foreground" },
  silver: { icon: Award, tone: "text-primary", chip: "bg-primary/15 text-primary" },
  gold: { icon: Crown, tone: "text-accent", chip: "bg-accent/15 text-accent" },
};

export const BADGE_META: Record<string, LucideIcon> = {
  first_a: Star,
  streak_5: Flame,
  streak_10: Zap,
  level_silver: Award,
  level_gold: Crown,
  perfect_week: Trophy,
  inbox_zero: Inbox,
  same_day_hero: Rocket,
  closer: Hand,
  hot_hands: Phone,
};

export const ALL_BADGES = Object.keys(BADGE_META);

export const CelebrateIcon = PartyPopper;
export const SparkIcon = Sparkles;

import type { CreditPackage } from "@shared/api";

export function formatPackageDollars(cents: number): string {
  return cents % 100 === 0
    ? (cents / 100).toLocaleString()
    : (cents / 100).toFixed(2);
}

export function isMonthlyPackage(pkg: CreditPackage): boolean {
  return pkg.billing_interval === "monthly";
}

export function packageFeatures(pkg: CreditPackage): string[] {
  if (Array.isArray(pkg.features_json)) return pkg.features_json;
  if (typeof pkg.features_json === "string") {
    try {
      const parsed = JSON.parse(pkg.features_json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

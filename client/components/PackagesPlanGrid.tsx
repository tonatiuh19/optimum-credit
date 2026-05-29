import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { CreditPackage } from "@shared/api";
import PlanOptionCard, { PlanOptionCardSkeleton } from "@/components/PlanOptionCard";

export interface PackagesPlanGridProps {
  packages: CreditPackage[];
  loading?: boolean;
  /** Register: highlights selection. Marketing: navigates on click */
  mode: "register" | "marketing";
  selectedSlug?: string;
  onSelectPlan: (slug: string) => void;
}

export default function PackagesPlanGrid({
  packages,
  loading,
  mode,
  selectedSlug,
  onSelectPlan,
}: PackagesPlanGridProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto rounded-3xl border border-border/50 bg-card/20 p-5 sm:p-7 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 lg:gap-8 items-stretch">
          {[...Array(4)].map((_, i) => (
            <PlanOptionCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (packages.length === 0) {
    return (
      <div className="max-w-5xl mx-auto text-center py-16 text-muted-foreground">
        {t("packages.unavailable")}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto rounded-3xl border border-border/50 bg-gradient-to-b from-card/40 to-transparent p-5 sm:p-7 md:p-8 shadow-inner">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6 lg:gap-8 items-stretch">
        {packages.map((pkg, idx) => (
          <PlanOptionCard
            key={pkg.id}
            pkg={pkg}
            mode={mode}
            selected={mode === "register" && selectedSlug === pkg.slug}
            onSelect={() => onSelectPlan(pkg.slug)}
            index={idx}
          />
        ))}
      </div>
    </div>
  );
}

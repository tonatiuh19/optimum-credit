import { BadgeCheck, Check, Lock, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import ThemeToggle from "@/components/ThemeToggle";
import LegalLinks from "@/components/LegalLinks";

/** Trust + legal footer for standalone public wizards (Register, Funding). */
export default function PublicWizardFooter() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border/60 bg-background/60 backdrop-blur-sm mt-auto w-full">
      <div className="container max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="w-3.5 h-3.5 text-accent shrink-0" />
            <span>{t("pricing.trustEncryption")}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 text-accent shrink-0" />
            <span>{t("pricing.trustSecurity")}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <BadgeCheck className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>{t("pricing.trustBbb")}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="w-3.5 h-3.5 text-accent shrink-0" />
            <span>{t("pricing.trustCancel")}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground/70">
          <ThemeToggle zone="portal" compact className="!text-muted-foreground hover:!text-foreground" />
          <span className="text-border hidden sm:inline">·</span>
          <span>
            {t("footer.allRightsReserved", {
              year: new Date().getFullYear(),
            })}
          </span>
          <span className="hidden sm:inline text-border">·</span>
          <LegalLinks className="text-[11px] text-muted-foreground/70" />
          <span className="hidden sm:inline text-border">·</span>
          <span className="hidden sm:inline">{t("footer.neverSold")}</span>
        </div>
      </div>
    </footer>
  );
}

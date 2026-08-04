import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Lock, BadgeCheck } from "lucide-react";
import PageMeta from "@/components/PageMeta";
import PackagesPlanGrid from "@/components/PackagesPlanGrid";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchPackages } from "@/store/slices/packagesSlice";
import { captureAffiliateRef } from "@/lib/affiliateAttribution";

/**
 * Standalone pricing page — the default "pricing" landing for affiliate
 * links (`/r/:slug?to=pricing`). Mirrors the home page packages section so
 * affiliates can share a focused, plans-only link.
 */
export default function Pricing() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { packages, loading } = useAppSelector((s) => s.packages);

  useEffect(() => {
    dispatch(fetchPackages());
  }, [dispatch]);

  useEffect(() => {
    const ref = searchParams.get("ref");
    if (ref) captureAffiliateRef(ref);
  }, [searchParams]);

  return (
    <div className="w-full max-w-[100vw] overflow-x-hidden">
      <PageMeta
        title={t("pricing.metaTitle")}
        description={t("pricing.metaDescription")}
        canonical="/pricing"
      />

      <section className="relative overflow-hidden bg-background pt-28 pb-8 md:pt-36 md:pb-10">
        <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/[0.08] to-transparent pointer-events-none" />
        <div className="absolute -top-16 -right-16 w-64 h-64 bg-accent/10 rounded-full blur-3xl pointer-events-none animate-float" />
        <div className="section-inner relative z-10 max-w-3xl mx-auto text-center px-4">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-foreground leading-tight mb-4">
            {t("pricing.heading")}
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto">
            {t("pricing.subheading")}
          </p>
        </div>
      </section>

      <section className="section-container pb-16">
        <div className="section-inner">
          <PackagesPlanGrid
            packages={packages}
            loading={loading}
            mode="marketing"
            onSelectPlan={(slug) => navigate(`/register?plan=${slug}`)}
          />

          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-10">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="w-3.5 h-3.5 text-accent" />
              <span>{t("pricing.trustEncryption")}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5 text-accent" />
              <span>{t("pricing.trustSecurity")}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <BadgeCheck className="w-3.5 h-3.5 text-primary" />
              <span>{t("pricing.trustBbb")}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

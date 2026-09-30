import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import PageMeta from "@/components/PageMeta";
import ProspectCreditAnalysisSection from "@/components/credit/ProspectCreditAnalysisSection";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { isProspectLead } from "@/lib/pipelineFilters";
import { useTranslation } from "react-i18next";
import { fetchPortalCreditAnalysis } from "@/store/slices/creditAnalysisSlice";
import { Loader2 } from "lucide-react";

export default function PortalCreditAnalysis() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((s) => s.clientAuth);
  const { portalResult, portalLoading } = useAppSelector((s) => s.creditAnalysis);
  const [initialized, setInitialized] = useState(false);
  const isProspect = isProspectLead(user);

  useEffect(() => {
    void dispatch(fetchPortalCreditAnalysis()).finally(() => setInitialized(true));
  }, [dispatch]);

  if (!initialized || (portalLoading && !portalResult)) {
    return (
      <>
        <PageMeta
          title={t("prospectAnalysis.pageTitle")}
          description={t("prospectAnalysis.portalPageSubtitle")}
          noIndex
        />
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          {t("prospectAnalysis.loading")}
        </div>
      </>
    );
  }

  if (!isProspect && !portalResult) {
    return <Navigate to="/portal" replace />;
  }

  return (
    <>
      <PageMeta
        title={t("prospectAnalysis.pageTitle")}
        description={t("prospectAnalysis.portalPageSubtitle")}
        noIndex
      />
      <div className="max-w-3xl mx-auto space-y-6 py-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t("prospectAnalysis.pageTitle")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isProspect
              ? t("prospectAnalysis.portalPageSubtitle")
              : t("prospectAnalysis.portalPageSubtitleReadOnly")}
          </p>
        </div>
        <ProspectCreditAnalysisSection
          variant="portal"
          uploadEnabled={isProspect}
          prefilled={{
            first_name: user?.first_name,
            last_name: user?.last_name,
            email: user?.email,
            preferred_language: user?.preferred_language,
          }}
        />
      </div>
    </>
  );
}

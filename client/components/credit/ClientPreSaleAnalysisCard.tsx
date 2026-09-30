import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import CreditAnalysisResultPanel from "@/components/credit/CreditAnalysisResultPanel";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminClientCreditAnalysis } from "@/store/slices/creditAnalysisSlice";

export default function ClientPreSaleAnalysisCard({
  clientId,
}: {
  clientId: number;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { adminResult, adminLoading } = useAppSelector((s) => s.creditAnalysis);

  useEffect(() => {
    dispatch(fetchAdminClientCreditAnalysis(clientId));
  }, [clientId, dispatch]);

  if (adminLoading && !adminResult) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("prospectAnalysis.loading")}
      </div>
    );
  }

  if (!adminResult) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {t("prospectAnalysis.priorAnalysisHeading")}
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          {t("prospectAnalysis.priorAnalysisHint")}
        </p>
      </div>
      <CreditAnalysisResultPanel result={adminResult} showRegisterCta={false} />
    </div>
  );
}

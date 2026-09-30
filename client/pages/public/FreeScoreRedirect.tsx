/**
 * Public short link — /go/free-score
 * Instant client-side redirect to the free MyFreeScoreNow snapshot
 * (SMS-friendly OFG URL; prospect already captured before they tap).
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { GET_CREDIT_REPORT_URLS } from "@/lib/getCreditReportLinks";

export default function FreeScoreRedirect() {
  const { t } = useTranslation();

  useEffect(() => {
    window.location.replace(GET_CREDIT_REPORT_URLS.free);
  }, []);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 px-4 text-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">
        {t("getCreditReport.redirectingToReport")}
      </p>
    </div>
  );
}

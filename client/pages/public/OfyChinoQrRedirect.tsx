/**
 * Printed OFY Chino signs (ADU night, communities, Cesar) all encode
 * /e/ofy/s/ofy-chino-1001. Production also 302s this path in vercel.json
 * before the SPA loads; this route covers local dev.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

export const OFY_CHINO_QR_URL = "https://www.ofgllc.com/get-credit-report";

export default function OfyChinoQrRedirect() {
  const { t } = useTranslation();

  useEffect(() => {
    window.location.replace(OFY_CHINO_QR_URL);
  }, []);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3 px-4 text-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">
        {t("affiliates.redirect.redirecting")}
      </p>
    </div>
  );
}

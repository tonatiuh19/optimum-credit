/**
 * Public referral short link — /r/:slug
 * Resolves the affiliate's slug, sets 30-day first-touch attribution, logs the
 * click, then redirects to the affiliate's default (or `?to=`) landing page.
 */
import { useEffect, useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resolvePublicAffiliate, logAffiliateClick } from "@/store/slices/affiliatesSlice";
import { captureAffiliateRef } from "@/lib/affiliateAttribution";

export default function AffiliateRedirect() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const { publicResolve, publicResolving, publicError } = useAppSelector(
    (s) => s.affiliates,
  );
  const handled = useRef(false);

  const toParam = searchParams.get("to");

  useEffect(() => {
    if (!slug) return;
    dispatch(resolvePublicAffiliate({ slug, to: toParam }));
  }, [dispatch, slug, toParam]);

  useEffect(() => {
    if (!publicResolve || handled.current) return;
    handled.current = true;

    captureAffiliateRef(publicResolve.slug);

    const landing: "credit_analysis" | "pricing" =
      toParam === "analysis"
        ? "credit_analysis"
        : toParam === "pricing"
          ? "pricing"
          : (publicResolve.redirect_path.startsWith("/pricing")
              ? "pricing"
              : "credit_analysis");
    dispatch(logAffiliateClick({ slug: publicResolve.slug, landing }));

    const overridePath =
      toParam === "analysis"
        ? `/credit-analysis?ref=${encodeURIComponent(publicResolve.slug)}`
        : toParam === "pricing"
          ? `/pricing?ref=${encodeURIComponent(publicResolve.slug)}`
          : null;

    navigate(overridePath || publicResolve.redirect_path, { replace: true });
  }, [publicResolve, toParam, dispatch, navigate]);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4">
      {publicError ? (
        <div className="max-w-sm text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6 text-destructive" />
          </div>
          <h1 className="text-lg font-bold text-foreground">
            {t("affiliates.redirect.errorTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{publicError}</p>
          <a href="/" className="inline-block text-sm font-medium text-primary hover:underline">
            {t("affiliates.redirect.goHome")}
          </a>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm">
            {publicResolving
              ? t("affiliates.redirect.loading")
              : t("affiliates.redirect.redirecting")}
          </p>
        </div>
      )}
    </div>
  );
}

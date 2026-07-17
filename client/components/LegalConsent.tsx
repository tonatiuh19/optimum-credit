import { Link } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { LEGAL_PATHS } from "@/lib/legal";
import { cn } from "@/lib/utils";

type LegalConsentProps = {
  agreedTerms: boolean;
  agreedSms: boolean;
  onAgreedTermsChange: (v: boolean) => void;
  onAgreedSmsChange: (v: boolean) => void;
  error?: string | null;
  className?: string;
};

/**
 * Required consent block for checkout / data-collection forms.
 * Links open in-app legal pages (DB-backed markdown).
 */
export default function LegalConsent({
  agreedTerms,
  agreedSms,
  onAgreedTermsChange,
  onAgreedSmsChange,
  error,
  className,
}: LegalConsentProps) {
  const { t } = useTranslation();

  const linkCls =
    "text-primary font-medium underline underline-offset-2 hover:opacity-80";

  return (
    <div className={cn("space-y-3", className)}>
      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={agreedTerms}
          onChange={(e) => onAgreedTermsChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 rounded border-input text-primary focus:ring-primary/30"
        />
        <span className="text-xs sm:text-sm text-muted-foreground leading-relaxed group-hover:text-foreground/80 transition-colors">
          <Trans
            i18nKey="legal.agreeTerms"
            components={{
              terms: (
                <Link
                  to={LEGAL_PATHS.terms}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkCls}
                  onClick={(e) => e.stopPropagation()}
                />
              ),
              privacy: (
                <Link
                  to={LEGAL_PATHS.privacy}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkCls}
                  onClick={(e) => e.stopPropagation()}
                />
              ),
            }}
          />
        </span>
      </label>

      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={agreedSms}
          onChange={(e) => onAgreedSmsChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 rounded border-input text-primary focus:ring-primary/30"
        />
        <span className="text-xs sm:text-sm text-muted-foreground leading-relaxed group-hover:text-foreground/80 transition-colors">
          <Trans
            i18nKey="legal.agreeSms"
            components={{
              sms: (
                <Link
                  to={LEGAL_PATHS.smsTerms}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkCls}
                  onClick={(e) => e.stopPropagation()}
                />
              ),
            }}
          />
        </span>
      </label>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error || t("legal.consentRequired")}
        </p>
      )}
    </div>
  );
}

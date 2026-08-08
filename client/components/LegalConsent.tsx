import { Link } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
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
    "text-primary font-semibold underline underline-offset-2 decoration-primary/40 hover:decoration-primary transition-colors";

  return (
    <div className={cn("space-y-2.5", className)}>
      <ConsentRow
        id="legal-consent-terms"
        checked={agreedTerms}
        onCheckedChange={onAgreedTermsChange}
      >
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
      </ConsentRow>

      <ConsentRow
        id="legal-consent-sms"
        checked={agreedSms}
        onCheckedChange={onAgreedSmsChange}
      >
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
      </ConsentRow>

      {error && (
        <p className="text-xs text-destructive px-0.5" role="alert">
          {error || t("legal.consentRequired")}
        </p>
      )}
    </div>
  );
}

function ConsentRow({
  id,
  checked,
  onCheckedChange,
  children,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start gap-3 cursor-pointer rounded-xl border px-3 py-2.5 transition-all duration-200",
        checked
          ? "border-primary/30 bg-primary/[0.06] shadow-sm shadow-primary/5"
          : "border-border/80 bg-background/60 hover:border-primary/20 hover:bg-muted/40",
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className={cn(
          "mt-0.5 h-[18px] w-[18px] rounded-md border-2 shadow-none transition-all duration-200",
          "border-primary/35 data-[state=unchecked]:bg-card",
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
          "data-[state=checked]:shadow-md data-[state=checked]:shadow-primary/25",
          "focus-visible:ring-primary/40",
        )}
      />
      <span
        className={cn(
          "text-xs sm:text-[13px] leading-relaxed transition-colors",
          checked ? "text-foreground/90" : "text-muted-foreground",
        )}
      >
        {children}
      </span>
    </label>
  );
}

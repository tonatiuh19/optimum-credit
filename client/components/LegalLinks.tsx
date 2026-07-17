import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LEGAL_PATHS } from "@/lib/legal";
import { cn } from "@/lib/utils";

type LegalLinksProps = {
  className?: string;
  linkClassName?: string;
  separator?: string;
};

/**
 * Footer / inline legal links — in-app routes backed by DB markdown.
 */
export default function LegalLinks({
  className,
  linkClassName,
  separator = "·",
}: LegalLinksProps) {
  const { t } = useTranslation();
  const linkCls = cn(
    "hover:text-foreground transition-colors underline-offset-2 hover:underline",
    linkClassName,
  );

  const items = [
    { to: LEGAL_PATHS.privacy, label: t("legal.privacyPolicy") },
    { to: LEGAL_PATHS.terms, label: t("legal.termsOfService") },
  ];

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-x-2 gap-y-1",
        className,
      )}
    >
      {items.map((item, i) => (
        <span key={item.to} className="inline-flex items-center gap-x-2">
          {i > 0 && (
            <span className="text-border" aria-hidden>
              {separator}
            </span>
          )}
          <Link to={item.to} className={linkCls}>
            {item.label}
          </Link>
        </span>
      ))}
    </span>
  );
}

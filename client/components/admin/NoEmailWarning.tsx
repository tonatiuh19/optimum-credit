import { AlertTriangle, MailX, Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * Prominent warning when creating/editing a client without email.
 * Email is how portal invites, reminders, and convert welcomes are delivered today.
 */
export default function NoEmailWarning({
  className,
  hasPhone,
}: {
  className?: string;
  /** When true, phone can still be used for manual outreach */
  hasPhone?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      data-testid="no-email-warning"
      className={cn(
        "relative overflow-hidden rounded-xl border border-destructive/30",
        "bg-gradient-to-br from-destructive/10 via-destructive/5 to-transparent",
        "px-3.5 py-3 shadow-sm",
        "animate-in fade-in-0 slide-in-from-top-1 duration-300",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-destructive/10 blur-2xl"
      />
      <div className="relative flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-destructive/25 bg-background/80 text-destructive shadow-sm">
          <MailX className="h-4 w-4" strokeWidth={2.25} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
            <p className="text-sm font-semibold tracking-tight text-foreground">
              {t("adminHelpers.noEmailWarningTitle")}
            </p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("adminHelpers.noEmailWarningBody")}
          </p>
          <ul className="space-y-1 text-[11px] leading-snug text-muted-foreground">
            <li className="flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-destructive/70" />
              {t("adminHelpers.noEmailWarningBulletPortal")}
            </li>
            <li className="flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-destructive/70" />
              {t("adminHelpers.noEmailWarningBulletReminders")}
            </li>
            <li className="flex gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-destructive/70" />
              {t("adminHelpers.noEmailWarningBulletConvert")}
            </li>
          </ul>
          {hasPhone ? (
            <p className="flex items-start gap-1.5 pt-0.5 text-[11px] font-medium text-foreground/80">
              <Phone className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              {t("adminHelpers.noEmailWarningPhoneOk")}
            </p>
          ) : (
            <p className="pt-0.5 text-[11px] font-medium text-destructive">
              {t("adminHelpers.noEmailWarningNeedPhone")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

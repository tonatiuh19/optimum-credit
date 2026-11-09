import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Branded background + logo header shared by the public event pages (sign-up, door check-in). */
export function EventPublicShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="relative min-h-[100dvh] flex flex-col bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.07] via-background to-muted/40" />
        <div className="absolute -top-24 right-[-10%] h-[28rem] w-[28rem] rounded-full bg-primary/[0.08] blur-3xl" />
        <div className="absolute bottom-[-10%] left-[-8%] h-[22rem] w-[22rem] rounded-full bg-accent/[0.07] blur-3xl" />
      </div>

      <header className="relative z-10 overflow-hidden border-b border-border/70">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-primary/[0.08] via-card/90 to-accent/[0.06]" />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-2.5 px-4 py-6 sm:py-7">
          <div className="relative rounded-2xl border border-border/60 bg-card/90 px-5 py-3 shadow-sm shadow-primary/10 backdrop-blur-sm">
            <img
              src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_dark.png"
              alt={t("eventMarketing.public.brandName")}
              className="h-9 w-auto sm:h-11 dark:hidden"
            />
            <img
              src="https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_white.png"
              alt=""
              aria-hidden
              className="hidden h-9 w-auto sm:h-11 dark:block"
            />
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 mx-auto w-full max-w-xl px-4 py-8 sm:py-10 space-y-6">{children}</main>
    </div>
  );
}

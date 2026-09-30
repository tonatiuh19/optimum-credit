import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleHelp } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Inline glossary control for leads/clients: dotted term + question icon.
 * Hover (desktop) or tap (mobile) opens a short legend — never submit a form.
 */
export default function TermHelp({
  termKey,
  label,
  legend,
  lng,
  iconOnly = false,
  className,
}: {
  termKey: string;
  label?: string;
  legend?: string;
  lng?: "en" | "es";
  iconOnly?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = lng || (i18n.language?.startsWith("es") ? "es" : "en");
  const i18nOpts = { lng: lang };
  const term = t(`termHelp.${termKey}.term`, i18nOpts);
  const body = legend || t(`termHelp.${termKey}.legend`, i18nOpts);
  const visible = label ?? term;
  const [open, setOpen] = useState(false);
  const leaveTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    };
  }, []);

  const clearLeave = () => {
    if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };

  const openNow = () => {
    clearLeave();
    setOpen(true);
  };

  const closeSoon = () => {
    clearLeave();
    leaveTimer.current = window.setTimeout(() => setOpen(false), 160);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-0.5 align-baseline rounded-md",
            "text-inherit font-inherit",
            "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          aria-label={t("termHelp.aria", { term: visible, lng: lang })}
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          {!iconOnly && (
            <span className="underline decoration-dotted decoration-primary/50 underline-offset-4">
              {visible}
            </span>
          )}
          <CircleHelp
            className={cn(
              "text-primary shrink-0 opacity-80",
              iconOnly ? "w-3.5 h-3.5" : "w-3 h-3 ml-0.5",
            )}
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={12}
        className="w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-3.5 shadow-lg"
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-bold uppercase tracking-wide text-primary mb-1">
          {term}
        </p>
        <p className="text-sm leading-relaxed text-foreground">{body}</p>
      </PopoverContent>
    </Popover>
  );
}

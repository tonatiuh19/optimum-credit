import { Globe } from "lucide-react";

interface LangBadgeProps {
  lang?: "en" | "es" | null;
  className?: string;
}

/**
 * Small badge indicating a client's preferred language (EN / ES).
 * Use wherever a client name is shown in the admin UI.
 */
export function LangBadge({ lang, className = "" }: LangBadgeProps) {
  const isEs = lang === "es";
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold font-mono uppercase border shrink-0 ${
        isEs
          ? "bg-amber-500/10 text-amber-600 border-amber-500/25 dark:text-amber-400"
          : "bg-primary/10 text-primary border-primary/25"
      } ${className}`}
      title={
        isEs ? "Preferred language: Spanish" : "Preferred language: English"
      }
    >
      <Globe className="w-2.5 h-2.5" />
      {isEs ? "ES" : "EN"}
    </span>
  );
}

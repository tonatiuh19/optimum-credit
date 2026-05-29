import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getStoredScheme,
  toggleScheme,
  themeChangeEvent,
  type ColorScheme,
  type ThemeZone,
} from "@/lib/routeTheme";

interface Props {
  zone: ThemeZone;
  compact?: boolean;
  collapsed?: boolean;
  className?: string;
}

export default function ThemeToggle({
  zone,
  compact,
  collapsed,
  className = "",
}: Props) {
  const { t } = useTranslation();
  const [scheme, setScheme] = useState<ColorScheme>(() =>
    getStoredScheme(zone),
  );

  useEffect(() => {
    const event = themeChangeEvent(zone);
    const sync = () => setScheme(getStoredScheme(zone));
    window.addEventListener(event, sync);
    return () => window.removeEventListener(event, sync);
  }, [zone]);

  const isDark = scheme === "dark";
  const label = isDark ? t("sidebar.themeLight") : t("sidebar.themeDark");

  const adminStyles =
    "text-slate-400 hover:text-slate-100 hover:bg-white/[0.08]";
  const portalStyles =
    "text-muted-foreground hover:text-foreground hover:bg-secondary";

  return (
    <button
      type="button"
      onClick={() => setScheme(toggleScheme(zone))}
      title={label}
      aria-label={label}
      className={[
        "flex items-center rounded-lg text-sm font-medium transition-colors",
        zone === "admin" ? adminStyles : portalStyles,
        compact
          ? "justify-center p-2"
          : collapsed
            ? "justify-center w-full py-2"
            : zone === "admin"
              ? "gap-2.5 w-full px-3 py-2 text-[12px]"
              : "gap-3 w-full px-3 py-2.5",
        className,
      ].join(" ")}
    >
      {isDark ? (
        <Sun
          className={`shrink-0 ${zone === "portal" && !compact ? "w-5 h-5" : "w-4 h-4"}`}
        />
      ) : (
        <Moon
          className={`shrink-0 ${zone === "portal" && !compact ? "w-5 h-5" : "w-4 h-4"}`}
        />
      )}
      {!collapsed && !compact && <span>{label}</span>}
    </button>
  );
}

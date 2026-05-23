import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateLanguage } from "@/store/slices/portalSlice";
import { fetchClientMe } from "@/store/slices/clientAuthSlice";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface LanguageSwitcherProps {
  /** compact = icon-only button, full = icon + label */
  variant?: "compact" | "full";
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
] as const;

export default function LanguageSwitcher({
  variant = "compact",
}: LanguageSwitcherProps) {
  const { i18n, t } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.clientAuth.user);

  const current =
    LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  const handleSelect = async (code: "en" | "es") => {
    if (code === i18n.language) return;
    // Apply locally first for instant feedback
    await i18n.changeLanguage(code);
    // If a client is logged in, persist preference to DB
    if (user) {
      await dispatch(updateLanguage({ language: code }));
      dispatch(fetchClientMe());
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground px-2"
          aria-label={t("languageSwitcher.label")}
        >
          <Globe className="w-4 h-4 shrink-0" />
          {variant === "full" && (
            <span className="text-xs font-medium">{current.label}</span>
          )}
          {variant === "compact" && (
            <span className="text-xs font-semibold uppercase">
              {i18n.language}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[8rem]">
        {LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleSelect(lang.code)}
            className={`text-sm cursor-pointer ${
              lang.code === i18n.language
                ? "font-semibold text-foreground"
                : "text-muted-foreground"
            }`}
          >
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

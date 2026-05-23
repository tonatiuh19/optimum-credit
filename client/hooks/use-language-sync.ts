import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "@/store/hooks";

/**
 * Syncs the i18n language to the authenticated user's preferred_language.
 * Call this once at the App root level.
 */
export function useLanguageSync() {
  const { i18n } = useTranslation();
  const user = useAppSelector((s) => s.clientAuth.user);

  useEffect(() => {
    const lang = user?.preferred_language;
    if (lang && (lang === "en" || lang === "es") && lang !== i18n.language) {
      i18n.changeLanguage(lang);
    }
  }, [user?.preferred_language, i18n]);
}

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Palmtree } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchOutOfOffice } from "@/store/slices/outOfOfficeSlice";
import { formatReturnDay } from "@/components/admin/out-of-office/outOfOfficeFormat";

/** Thin banner across the admin while anyone is out of office: who, until when, who covers. */
export function OutOfOfficeBanner() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const data = useAppSelector((s) => s.outOfOffice.data);
  useEffect(() => {
    if (!data) void dispatch(fetchOutOfOffice());
  }, [data, dispatch]);
  const away = (data?.everyone ?? []).filter((p) => p.active);
  if (!away.length) return null;
  const es = i18n.language?.startsWith("es");
  return (
    <div className="mb-4 space-y-1.5" data-testid="ooo-banner">
      {away.map((p) => (
        <Link
          key={p.id}
          to="/admin/profile#out-of-office"
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-foreground transition-colors hover:bg-accent/15 animate-in fade-in slide-in-from-top-1"
        >
          <Palmtree className="h-4 w-4 shrink-0 text-accent" />
          <span className="font-semibold">{t("outOfOffice.bannerAway", { name: p.first_name, day: formatReturnDay(p.returns_on, es) })}</span>
          {p.backup_en && <span className="text-muted-foreground">· {t("outOfOffice.bannerEn", { name: p.backup_en.name })}</span>}
          {p.backup_es && <span className="text-muted-foreground">· {t("outOfOffice.bannerEs", { name: p.backup_es.name })}</span>}
        </Link>
      ))}
    </div>
  );
}

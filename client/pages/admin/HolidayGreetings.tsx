import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Gift, Loader2, ShieldCheck } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { HolidayGreetingCard } from "@/components/admin/holiday-greetings/HolidayGreetingCard";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchHolidayGreetings } from "@/store/slices/holidayGreetingsSlice";

/** Holiday greetings (Nov 17, 2026): one approved text per holiday per year, nothing sends unapproved. */
export default function HolidayGreetings() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { items, loading, error } = useAppSelector((s) => s.holidayGreetings);

  useEffect(() => {
    void dispatch(fetchHolidayGreetings());
  }, [dispatch]);

  // The next holiday that has not gone out yet opens by default.
  const nextId = items.find((g) => g.status === "draft" || g.status === "approved" || g.status === "sending")?.id;

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
      <AdminPageHeader icon={Gift} title={t("holidayGreetings.title")} description={t("holidayGreetings.description")} />
      <div className="flex items-start gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-3 text-xs text-foreground">
        <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-primary" />
        <p>{t("holidayGreetings.rules")}</p>
      </div>
      {loading && !items.length ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <div className="space-y-3">
          {items.map((g) => (
            <HolidayGreetingCard key={g.id} g={g} defaultOpen={g.id === nextId} />
          ))}
        </div>
      )}
    </div>
  );
}

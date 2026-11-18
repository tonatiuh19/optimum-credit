import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CalendarHeart, Check, Loader2, Plane, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchStaffPermissions, saveStaffPermissions } from "@/store/slices/staffPermissionsSlice";
import type { StaffPermissionKey } from "@shared/api";
import { cn } from "@/lib/utils";
import { logger } from "@/utils/logger";

const LISTS: { key: StaffPermissionKey; icon: typeof Plane }[] = [
  { key: "out_of_office_manager_ids", icon: Plane },
  { key: "holiday_greeting_approver_ids", icon: CalendarHeart },
];

/** Super admin: choose who can manage out of office / client care and who approves holiday greetings. */
export default function StaffPermissionsPanel() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { data, loading, saving, error } = useAppSelector((s) => s.staffPermissions);

  useEffect(() => {
    dispatch(fetchStaffPermissions()).catch((e) => logger.warn("staff permissions load failed", e));
  }, [dispatch]);

  const toggle = async (key: StaffPermissionKey, id: number) => {
    if (!data || saving) return;
    const cur = data.permissions[key];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (!next.length) {
      toast.error(t("adminSettings.staffPermissions.needOne"));
      return;
    }
    if (next.length > 10) {
      toast.error(t("adminSettings.staffPermissions.max"));
      return;
    }
    const r = await dispatch(saveStaffPermissions({ [key]: next }));
    if (saveStaffPermissions.fulfilled.match(r)) toast.success(t("adminSettings.staffPermissions.saved"));
    else toast.error(String(r.payload ?? t("adminSettings.staffPermissions.saveFailed")));
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{t("adminSettings.staffPermissions.title")}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t("adminSettings.staffPermissions.subtitle")}</p>
        </div>
        {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
      </div>

      {loading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !data ? (
        <p className="text-sm text-destructive">{error ?? t("adminSettings.staffPermissions.loadFailed")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {LISTS.map(({ key, icon: Icon }) => {
            const selected = data.permissions[key];
            return (
              <div key={key} className="rounded-xl border border-border bg-background/50 p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold text-foreground inline-flex items-center gap-2">
                    <Icon className="w-4 h-4 text-primary" />
                    {t(`adminSettings.staffPermissions.${key}.label`)}
                    <span className="text-xs font-medium text-muted-foreground">({selected.length})</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t(`adminSettings.staffPermissions.${key}.hint`)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.staff.map((p) => {
                    const on = selected.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={saving}
                        aria-pressed={on}
                        onClick={() => void toggle(key, p.id)}
                        className={cn(
                          "inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full border transition-all active:scale-95 disabled:opacity-60",
                          on
                            ? "bg-primary/10 text-primary border-primary/30 shadow-sm"
                            : "bg-muted/40 text-muted-foreground border-border hover:border-primary/30 hover:text-foreground",
                        )}
                      >
                        {on && <Check className="w-3 h-3" />}
                        {p.name || `#${p.id}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

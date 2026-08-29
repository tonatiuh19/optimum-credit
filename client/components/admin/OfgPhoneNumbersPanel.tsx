import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Phone, RefreshCw } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminTeam } from "@/store/slices/adminSlice";
import {
  assignAdminPhoneNumber,
  fetchAdminPhoneNumbers,
  syncAdminPhoneNumbersFromTwilio,
} from "@/store/slices/conversationsSlice";
import { Skeleton } from "@/components/ui/skeleton";
import FieldHint from "@/components/admin/FieldHint";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/utils/logger";

/**
 * Super-admin inventory: Twilio OFG numbers + owner assignment.
 */
export default function OfgPhoneNumbersPanel() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const me = useAppSelector((s) => s.adminAuth.user);
  const { team } = useAppSelector((s) => s.admin);
  const { phoneNumbers, phoneNumbersLoading } = useAppSelector(
    (s) => s.conversations,
  );
  const [syncing, setSyncing] = useState(false);
  const [assigningId, setAssigningId] = useState<number | null>(null);

  const isSuperAdmin = me?.role === "super_admin";

  useEffect(() => {
    if (!isSuperAdmin) return;
    dispatch(fetchAdminPhoneNumbers()).catch((e) =>
      logger.warn("phone numbers load failed", e),
    );
    dispatch(fetchAdminTeam({})).catch((e) =>
      logger.warn("team load failed", e),
    );
  }, [dispatch, isSuperAdmin]);

  if (!isSuperAdmin) return null;

  const staff = team.filter(
    (m) => m.role !== "affiliate" && m.status === "active",
  );

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await dispatch(syncAdminPhoneNumbersFromTwilio());
      if (syncAdminPhoneNumbersFromTwilio.fulfilled.match(res)) {
        toast({
          title: t("adminSettings.ofgPhonesSyncOk"),
          description: t("adminSettings.ofgPhonesSyncCount", {
            count: res.payload.upserted,
          }),
        });
      } else {
        toast({
          title: t("adminSettings.ofgPhonesSyncError"),
          description: String(res.payload || ""),
          variant: "destructive",
        });
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleAssign = async (id: number, assigned: number | null) => {
    setAssigningId(id);
    try {
      const res = await dispatch(
        assignAdminPhoneNumber({ id, assigned_admin_id: assigned }),
      );
      if (assignAdminPhoneNumber.fulfilled.match(res)) {
        toast({
          title: t("adminSettings.ofgPhonesTitle"),
          description: assigned
            ? res.payload.assigned_admin_name || t("adminSettings.ofgPhonesAssigned")
            : t("adminSettings.ofgPhonesUnassigned"),
        });
      } else {
        toast({
          title: t("adminSettings.ofgPhonesAssignError"),
          description: String(res.payload || ""),
          variant: "destructive",
        });
      }
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Phone className="w-5 h-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">
            {t("adminSettings.ofgPhonesTitle")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("adminSettings.ofgPhonesHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncing}
          className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-40 shrink-0"
        >
          {syncing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {t("adminSettings.ofgPhonesSync")}
        </button>
      </div>

      <FieldHint>{t("adminSettings.ofgPhonesFieldHint")}</FieldHint>

      {phoneNumbersLoading && phoneNumbers.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : phoneNumbers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("adminSettings.ofgPhonesEmpty")}
        </p>
      ) : (
        <div className="space-y-2">
          {phoneNumbers.map((n) => (
            <div
              key={n.id}
              className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between rounded-xl border border-border px-3 py-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground font-mono">
                  {n.e164}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {n.friendly_name || "—"}
                  {n.assigned_admin_name ? (
                    <span className="text-foreground">
                      {" · "}
                      {t("adminSettings.ofgPhonesOwner", {
                        name: n.assigned_admin_name,
                      })}
                    </span>
                  ) : (
                    <span>
                      {" · "}
                      {t("adminSettings.ofgPhonesUnassigned")}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {assigningId === n.id && (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                )}
                <select
                  value={n.assigned_admin_id ?? ""}
                  disabled={assigningId === n.id}
                  onChange={(e) => {
                    const raw = e.target.value;
                    void handleAssign(n.id, raw === "" ? null : Number(raw));
                  }}
                  className="h-9 min-w-[200px] px-2 rounded-lg border border-input bg-background text-sm"
                >
                  <option value="">
                    {t("adminSettings.ofgPhonesUnassigned")}
                  </option>
                  {n.assigned_admin_id != null &&
                    !staff.some((m) => m.id === n.assigned_admin_id) && (
                      <option value={n.assigned_admin_id}>
                        {n.assigned_admin_name || `#${n.assigned_admin_id}`}
                      </option>
                    )}
                  {staff.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.first_name} {m.last_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

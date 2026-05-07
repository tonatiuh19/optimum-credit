import { useEffect, useState } from "react";
import { Save, Settings, Lock, LockOpen, Loader2, Tag } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchSettings,
  saveSetting,
  fetchSectionLocks,
  updateSectionLock,
} from "@/store/slices/adminSlice";
import { useToast } from "@/hooks/use-toast";

export default function AdminSettings() {
  const dispatch = useAppDispatch();
  const { settings, sectionLocks, sectionLocksSaving } = useAppSelector(
    (s) => s.admin,
  );
  const appVersion =
    settings.find((s) => s.setting_key === "app_version")?.setting_value ??
    null;
  const visibleSettings = settings.filter(
    (s) => s.setting_key !== "app_version",
  );

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [lockReasonEdits, setLockReasonEdits] = useState<
    Record<string, string>
  >({});
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    dispatch(fetchSettings());
    dispatch(fetchSectionLocks());
  }, [dispatch]);

  const save = async (k: string) => {
    const v = edits[k];
    if (v === undefined) return;
    await dispatch(saveSetting({ setting_key: k, setting_value: v }));
    setEdits((p) => {
      const next = { ...p };
      delete next[k];
      return next;
    });
    dispatch(fetchSettings());
  };

  const toggleLock = async (
    section_key: string,
    current: boolean,
    lock_reason: string | null,
  ) => {
    setTogglingKey(section_key);
    try {
      await dispatch(
        updateSectionLock({
          key: section_key,
          is_locked: !current,
          lock_reason: lockReasonEdits[section_key] ?? lock_reason,
        }),
      ).unwrap();
      toast({
        title: current ? "Section unlocked" : "Section locked",
        description: sectionLocks.find((l) => l.section_key === section_key)
          ?.label,
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to update section lock",
        variant: "destructive",
      });
    } finally {
      setTogglingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Settings}
        title="Settings"
        description="Global app configuration and section access controls."
      />

      {/* ── App Version ───────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Tag className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-0.5">
            Production Version
          </p>
          <div className="flex items-center gap-3">
            {appVersion ? (
              <span className="font-mono text-xl font-bold text-foreground">
                {appVersion}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground italic">
                Not set — run{" "}
                <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  npm run deploy:prod
                </code>{" "}
                to deploy and set a version.
              </span>
            )}
            {appVersion && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                Live
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Section Locks ─────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Lock className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">Section Access Controls</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Lock sections to hide them from all admins and redirect direct URL
              access.
            </p>
          </div>
        </div>

        <div className="divide-y divide-border">
          {sectionLocks.map((lock) => {
            const isToggling = togglingKey === lock.section_key;
            const reasonValue =
              lockReasonEdits[lock.section_key] ?? lock.lock_reason ?? "";
            return (
              <div
                key={lock.section_key}
                className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{lock.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {lock.section_key}
                    </span>
                    {lock.is_locked && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
                        <Lock className="w-2.5 h-2.5" /> Locked
                      </span>
                    )}
                  </div>
                  {lock.is_locked && (
                    <input
                      type="text"
                      placeholder="Lock reason shown to admins…"
                      value={reasonValue}
                      onChange={(e) =>
                        setLockReasonEdits((p) => ({
                          ...p,
                          [lock.section_key]: e.target.value,
                        }))
                      }
                      className="mt-2 w-full h-8 px-2.5 text-xs rounded-lg border border-input bg-background text-foreground"
                    />
                  )}
                </div>
                <button
                  onClick={() =>
                    toggleLock(
                      lock.section_key,
                      lock.is_locked,
                      lock.lock_reason,
                    )
                  }
                  disabled={isToggling || sectionLocksSaving}
                  className={[
                    "shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors border",
                    lock.is_locked
                      ? "bg-accent/10 text-accent border-accent/30 hover:bg-accent/20"
                      : "bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20",
                    isToggling || sectionLocksSaving
                      ? "opacity-60 cursor-not-allowed"
                      : "",
                  ].join(" ")}
                >
                  {isToggling ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : lock.is_locked ? (
                    <LockOpen className="w-3.5 h-3.5" />
                  ) : (
                    <Lock className="w-3.5 h-3.5" />
                  )}
                  {lock.is_locked ? "Unlock" : "Lock"}
                </button>
              </div>
            );
          })}
          {sectionLocks.length === 0 && (
            <p className="px-5 py-8 text-sm text-muted-foreground text-center">
              No sections found. Apply the migration to seed section data.
            </p>
          )}
        </div>
      </div>

      {/* ── System Settings ───────────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
          System Settings
        </h2>
        {visibleSettings.map((s) => {
          const val = edits[s.setting_key] ?? s.setting_value ?? "";
          const long = (s.setting_value || "").length > 80;
          return (
            <div
              key={s.setting_key}
              className="bg-card rounded-2xl border border-border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm break-all">
                    {s.setting_key}
                  </div>
                  {s.description && (
                    <div className="text-xs text-muted-foreground">
                      {s.description}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => save(s.setting_key)}
                  disabled={edits[s.setting_key] === undefined}
                  className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-40 shrink-0"
                >
                  <Save className="w-4 h-4" /> Save
                </button>
              </div>
              {long ? (
                <textarea
                  rows={5}
                  value={val}
                  onChange={(e) =>
                    setEdits((p) => ({ ...p, [s.setting_key]: e.target.value }))
                  }
                  className="w-full p-3 rounded-lg border border-input bg-background text-sm text-foreground font-mono"
                />
              ) : (
                <input
                  value={val}
                  onChange={(e) =>
                    setEdits((p) => ({ ...p, [s.setting_key]: e.target.value }))
                  }
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

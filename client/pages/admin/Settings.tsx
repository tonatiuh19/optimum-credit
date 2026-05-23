import { useEffect, useState } from "react";
import { Save, Settings, Tag } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchSettings, saveSetting } from "@/store/slices/adminSlice";

export default function AdminSettings() {
  const dispatch = useAppDispatch();
  const { settings } = useAppSelector((s) => s.admin);
  const appVersion =
    settings.find((s) => s.setting_key === "app_version")?.setting_value ??
    null;
  const visibleSettings = settings.filter(
    (s) =>
      s.setting_key !== "app_version" &&
      s.setting_key !== "contract_template_html",
  );

  const [edits, setEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    dispatch(fetchSettings());
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

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Settings}
        title="Settings"
        description="Global app configuration."
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

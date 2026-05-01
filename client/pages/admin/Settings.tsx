import { useEffect, useState } from "react";
import { Save, Settings } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchSettings, saveSetting } from "@/store/slices/adminSlice";

export default function AdminSettings() {
  const dispatch = useAppDispatch();
  const { settings } = useAppSelector((s) => s.admin);
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
        description="Global app and contract configuration."
      />

      <div className="space-y-3">
        {settings.map((s) => {
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

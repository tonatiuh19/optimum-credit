import { useEffect, useState } from "react";
import { Mailbox, Save } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchTemplates, updateTemplate } from "@/store/slices/adminSlice";

export default function AdminTemplates() {
  const dispatch = useAppDispatch();
  const { templates } = useAppSelector((s) => s.admin);
  const [editing, setEditing] = useState<Record<number, any>>({});

  useEffect(() => {
    dispatch(fetchTemplates());
  }, [dispatch]);

  const setField = (id: number, k: string, v: any) =>
    setEditing((p) => ({ ...p, [id]: { ...p[id], [k]: v } }));

  const save = async (id: number) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const patch = editing[id] || {};
    await dispatch(
      updateTemplate({
        id,
        subject: patch.subject ?? t.subject,
        body: patch.body ?? t.body,
        is_active: patch.is_active ?? t.is_active,
      }),
    );
    setEditing((p) => ({ ...p, [id]: undefined }));
    dispatch(fetchTemplates());
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Mailbox}
        title="Templates"
        description="Edit message bodies for email and SMS automation."
      />

      <div className="space-y-3">
        {templates.map((t) => {
          const e = editing[t.id] || {};
          return (
            <details
              key={t.id}
              className="bg-card rounded-2xl border border-border group"
            >
              <summary className="cursor-pointer p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground uppercase">
                    {t.template_type} · {t.code}
                  </div>
                </div>
                <span className="text-xs uppercase bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                  {t.is_active ? "active" : "off"}
                </span>
              </summary>
              <div className="p-4 border-t border-border space-y-3">
                {t.template_type === "email" && (
                  <input
                    placeholder="Subject"
                    value={e.subject ?? t.subject ?? ""}
                    onChange={(ev) =>
                      setField(t.id, "subject", ev.target.value)
                    }
                    className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground"
                  />
                )}
                <textarea
                  rows={6}
                  value={e.body ?? t.body ?? ""}
                  onChange={(ev) => setField(t.id, "body", ev.target.value)}
                  className="w-full p-3 rounded-lg border border-input bg-background text-sm text-foreground font-mono"
                />
                <div className="flex justify-between items-center">
                  <label className="text-sm text-muted-foreground inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={e.is_active ?? t.is_active}
                      onChange={(ev) =>
                        setField(t.id, "is_active", ev.target.checked)
                      }
                    />
                    Active
                  </label>
                  <button
                    onClick={() => save(t.id)}
                    className="btn-primary text-sm inline-flex items-center gap-1.5"
                  >
                    <Save className="w-4 h-4" /> Save
                  </button>
                </div>
                {t.variables_json && (
                  <div className="text-xs text-muted-foreground">
                    Variables: {JSON.stringify(t.variables_json)}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createConversationTemplate,
  deleteConversationTemplate,
  fetchConversationTemplates,
  updateConversationTemplate,
} from "@/store/slices/conversationsSlice";
import { CONVERSATION_TEMPLATE_VARS } from "@/lib/conversationTemplateVars";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { ConversationTemplate } from "@shared/api";

type Channel = "sms" | "internal";

export default function ConversationTemplatesAdmin() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { templates, templatesLoading } = useAppSelector((s) => s.conversations);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ConversationTemplate | null>(null);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>("sms");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dispatch(fetchConversationTemplates({ all: true }));
  }, [dispatch]);

  const visibleTemplates = templates.filter((tpl) => tpl.channel !== "email");

  const resetForm = (tpl?: ConversationTemplate | null) => {
    setEditing(tpl || null);
    setName(tpl?.name || "");
    const ch = tpl?.channel === "internal" ? "internal" : "sms";
    setChannel(ch);
    setBody(tpl?.body || "");
  };

  const openCreate = () => {
    resetForm(null);
    setOpen(true);
  };

  const openEdit = (tpl: ConversationTemplate) => {
    resetForm(tpl);
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim() || !body.trim()) return;
    setSaving(true);
    const vars = CONVERSATION_TEMPLATE_VARS.map((v) => v.key).filter((k) =>
      body.includes(`{{${k}}}`),
    );
    if (editing) {
      const res = await dispatch(
        updateConversationTemplate({
          id: editing.id,
          name: name.trim(),
          channel,
          subject: null,
          body,
          variables: vars,
        }),
      );
      setSaving(false);
      if (updateConversationTemplate.fulfilled.match(res)) {
        toast({ title: t("conversations.templateSaved") });
        setOpen(false);
      } else {
        toast({
          title: t("conversations.templateSaveFailed"),
          variant: "destructive",
        });
      }
      return;
    }
    const res = await dispatch(
      createConversationTemplate({
        name: name.trim(),
        channel,
        subject: null,
        body,
        variables: vars,
      }),
    );
    setSaving(false);
    if (createConversationTemplate.fulfilled.match(res)) {
      toast({ title: t("conversations.templateSaved") });
      setOpen(false);
    } else {
      toast({
        title: t("conversations.templateSaveFailed"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">
            {t("conversations.templatesSectionTitle")}
          </h3>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("conversations.templatesSectionHint")}
          </p>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="w-4 h-4" />
          {t("conversations.newTemplate")}
        </Button>
      </div>

      {templatesLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("conversations.loading")}
        </div>
      ) : visibleTemplates.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6">
          {t("conversations.noTemplates")}
        </p>
      ) : (
        <div className="space-y-2">
          {visibleTemplates.map((tpl) => (
            <div
              key={tpl.id}
              className="rounded-xl border border-border bg-card p-4 flex flex-wrap gap-3 justify-between"
            >
              <button
                type="button"
                onClick={() => openEdit(tpl)}
                className="text-left min-w-0 flex-1"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{tpl.name}</span>
                  <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {tpl.channel}
                  </span>
                  {!tpl.is_active && (
                    <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                      {t("conversations.inactive")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap">
                  {tpl.body}
                </p>
              </button>
              <div className="flex items-center gap-2">
                <Switch
                  checked={tpl.is_active}
                  onCheckedChange={(v) =>
                    void dispatch(
                      updateConversationTemplate({
                        id: tpl.id,
                        is_active: v,
                      }),
                    )
                  }
                />
                <button
                  type="button"
                  onClick={async () => {
                    await dispatch(deleteConversationTemplate(tpl.id));
                  }}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title={t("conversations.deleteTemplate")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("conversations.editTemplate")
                : t("conversations.newTemplate")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("conversations.templateName")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>{t("conversations.channelLabel")}</Label>
              <div className="flex gap-1 mt-1">
                {(["sms", "internal"] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChannel(ch)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase ${
                      channel === ch
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {t(`conversations.channels.${ch}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>{t("conversations.templateBody")}</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="font-mono text-sm"
              />
              <div className="flex flex-wrap gap-1 mt-2">
                {CONVERSATION_TEMPLATE_VARS.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setBody((b) => `${b}{{${v.key}}}`)}
                    className="text-[10px] px-1.5 py-0.5 rounded-md border border-primary/20 bg-primary/5 text-primary font-mono"
                  >
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("conversations.cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t("conversations.saveTemplate")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

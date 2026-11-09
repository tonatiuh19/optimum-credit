import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardList, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearEventImport, importEventSignInSheet } from "@/store/slices/eventMarketingSlice";
import { parseSignInSheet } from "@/lib/eventSignInSheet";

/** Paste a paper sign-in sheet → registrations for one session (no texts sent). */
export function EventImportDialog({
  sessionId,
  sessionTitle,
  open,
  onOpenChange,
}: {
  sessionId: number;
  sessionTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { importing, importResult, importError } = useAppSelector((s) => s.eventMarketing);
  const [text, setText] = useState("");
  const [attended, setAttended] = useState(true);
  const [lang, setLang] = useState<"en" | "es">("es");
  const parsed = useMemo(() => parseSignInSheet(text, { attended, lang }), [text, attended, lang]);

  const close = (next: boolean) => {
    if (!next) {
      dispatch(clearEventImport());
      setText("");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            {t("eventMarketing.admin.import.title")}
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{sessionTitle}</span>
            {" — "}
            {t("eventMarketing.admin.import.description")}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("eventMarketing.admin.import.placeholder")}
          rows={8}
          className="font-mono text-xs"
          data-testid="event-import-text"
        />
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={attended} onCheckedChange={setAttended} />
            {t("eventMarketing.admin.import.attended")}
          </label>
          <div className="flex items-center gap-2">
            <Label className="text-sm">{t("eventMarketing.admin.import.language")}</Label>
            <Select value={lang} onValueChange={(v) => setLang(v === "en" ? "en" : "es")}>
              <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {text.trim() && (
          <div className="space-y-1 text-xs">
            <p className="text-accent font-medium">{t("eventMarketing.admin.import.preview", { count: parsed.rows.length })}</p>
            {parsed.errors.slice(0, 6).map((e) => (
              <p key={e.line} className="text-destructive">
                {t("eventMarketing.admin.import.rowError", { line: e.line, error: t(`eventMarketing.admin.import.errors.${e.error}`) })}
              </p>
            ))}
          </div>
        )}
        {importResult && (
          <p className="text-sm rounded-lg bg-accent/10 text-accent px-3 py-2 animate-in fade-in" data-testid="event-import-done">
            {t("eventMarketing.admin.import.done", importResult)}
          </p>
        )}
        {importError && <p className="text-sm text-destructive">{importError}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>{t("eventMarketing.admin.cancel")}</Button>
          <Button
            disabled={importing || parsed.rows.length === 0}
            onClick={() => {
              void dispatch(importEventSignInSheet({ sessionId, rows: parsed.rows })).then((r) => {
                if (importEventSignInSheet.fulfilled.match(r)) setText("");
              });
            }}
          >
            {importing && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {t("eventMarketing.admin.import.submit", { count: parsed.rows.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

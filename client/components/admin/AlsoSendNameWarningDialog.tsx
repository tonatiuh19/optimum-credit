import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { AlsoRecipient } from "@/lib/conversationAlsoSend";

interface Props {
  warning: { clientName: string; recipients: AlsoRecipient[] } | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Shown before an "Also send to" copy goes out with text written to the
 * client by name — the extra recipients get it word for word.
 */
export function AlsoSendNameWarningDialog({ warning, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const name = warning?.clientName || t("conversations.alsoNameWarning.theClient");
  return (
    <AlertDialog open={!!warning} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </span>
            {t("conversations.alsoNameWarning.title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("conversations.alsoNameWarning.body", { name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="space-y-1.5" data-testid="also-name-warning-recipients">
          {(warning?.recipients || []).map((r) => (
            <li
              key={r.key}
              className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm animate-in fade-in slide-in-from-bottom-1"
            >
              <span className="font-medium text-foreground">{r.label}</span>
              <span className="text-muted-foreground"> · {r.phone}</span>
              {r.phoneClientName && (
                <span className="mt-0.5 block text-xs text-destructive">
                  {t("conversations.composeAlsoSharedPhone", { name: r.phoneClientName })}
                </span>
              )}
            </li>
          ))}
        </ul>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel data-testid="also-name-warning-cancel">
            {t("conversations.alsoNameWarning.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="also-name-warning-confirm"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            {t("conversations.alsoNameWarning.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

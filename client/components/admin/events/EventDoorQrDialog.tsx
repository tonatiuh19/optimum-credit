import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import { Copy, Download, DoorOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppDispatch } from "@/store/hooks";
import { fetchEventCheckInLink } from "@/store/slices/eventMarketingSlice";
import { logger } from "@/utils/logger";

/** Door self check-in QR for one session: shows, copies and downloads it. */
export function EventDoorQrDialog({
  sessionId,
  sessionTitle,
  shortCode,
  open,
  onOpenChange,
}: {
  sessionId: number;
  sessionTitle: string;
  shortCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void dispatch(fetchEventCheckInLink(sessionId)).then(async (r) => {
      if (fetchEventCheckInLink.fulfilled.match(r)) {
        setUrl(r.payload.url);
        try {
          setQr(await QRCode.toDataURL(r.payload.url, { width: 720, margin: 2, errorCorrectionLevel: "M" }));
        } catch (e) {
          logger.error("door QR render failed", e);
        }
      } else {
        setError(String(r.payload || ""));
      }
    });
  }, [open, sessionId, dispatch]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DoorOpen className="w-4 h-4 text-primary" />
            {t("eventMarketing.admin.doorQr")}
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{sessionTitle}</span>
            {" — "}
            {t("eventMarketing.admin.doorQrHint")}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !qr ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-3 animate-in fade-in zoom-in-95">
            <img src={qr} alt={t("eventMarketing.admin.doorQr")} className="mx-auto w-56 h-56 rounded-xl border border-border bg-background p-2" />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  void navigator.clipboard?.writeText(url).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  });
                }}
              >
                <Copy className="w-4 h-4 mr-1.5" />
                {copied ? t("eventMarketing.admin.doorQrCopied") : t("eventMarketing.admin.doorQrCopy")}
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = qr;
                  a.download = `door-qr-${shortCode}.png`;
                  a.click();
                }}
              >
                <Download className="w-4 h-4 mr-1.5" />
                {t("eventMarketing.admin.doorQrDownload")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

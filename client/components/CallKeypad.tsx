import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Grid3x3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { sendThreeWayDigits } from "@/store/slices/voiceSlice";
import { DTMF_KEYS, playDtmfTone } from "@/lib/dtmfTone";
import { cn } from "@/lib/utils";

/**
 * In-call keypad (DTMF) for any connected softphone call — extensions,
 * phone menus, voicemail options ("press # to re-record").
 * Normal call: Twilio Voice SDK `sendDigits` (relayed to the other party).
 * Three-way active: the call is a conference (DTMF does not cross it), so
 * digits go to the third party through the server instead.
 */
export function CallKeypad({ call }: { call: { sendDigits: (digits: string) => void } | null }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const threeWay = useAppSelector((s) => s.voice.threeWay);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState("");
  const viaConference = threeWay.status === "active" && !!threeWay.sessionId;

  const press = (key: string) => {
    if (!DTMF_KEYS.includes(key as (typeof DTMF_KEYS)[number])) return;
    playDtmfTone(key);
    setSent((s) => `${s}${key}`.slice(-20));
    if (viaConference) {
      void dispatch(sendThreeWayDigits({ sessionId: threeWay.sessionId!, digits: key })).then((r) => {
        if (sendThreeWayDigits.rejected.match(r)) {
          toast({ title: t("conversations.voice.keypad.error"), variant: "destructive" });
        }
      });
      return;
    }
    try {
      call?.sendDigits(key);
    } catch {
      toast({ title: t("conversations.voice.keypad.error"), variant: "destructive" });
    }
  };

  // Physical keyboard while the keypad is open (0-9 * #).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (DTMF_KEYS.includes(e.key as (typeof DTMF_KEYS)[number])) {
        e.preventDefault();
        press(e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, viaConference, call]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSent(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn("h-10 w-10 rounded-full transition-colors", open && "bg-primary/10 border-primary/40 text-primary")}
          disabled={!call && !viaConference}
          title={t("conversations.voice.keypad.open")}
          aria-label={t("conversations.voice.keypad.open")}
          data-testid="call-keypad-trigger"
        >
          <Grid3x3 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="center">
        <div className="h-8 rounded-lg bg-secondary/60 flex items-center justify-center font-mono text-lg tracking-[0.3em] text-foreground overflow-hidden" data-testid="call-keypad-display">
          {sent || <span className="text-xs tracking-normal font-sans text-muted-foreground">{t("conversations.voice.keypad.hint")}</span>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {DTMF_KEYS.map((k) => (
            <Button
              key={k}
              type="button"
              variant="outline"
              className="h-12 text-lg font-semibold active:scale-95 transition-transform"
              onClick={() => press(k)}
              data-testid={`call-keypad-${k}`}
            >
              {k}
            </Button>
          ))}
        </div>
        {viaConference && (
          <p className="text-[11px] text-muted-foreground text-center">{t("conversations.voice.keypad.threeWay")}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

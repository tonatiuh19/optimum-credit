import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import { Grid3x3, Loader2, PhoneCall, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchThreeWayPresets,
  removeThreeWayCaller,
  sendThreeWayDigits,
  startThreeWayCall,
} from "@/store/slices/voiceSlice";
import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

/** US / Canada number (10 digits, optional +1). */
const US_PHONE = /^\+?1?[\s.-]*\(?[2-9]\d{2}\)?[\s.-]*\d{3}[\s.-]*\d{4}$/;

const schema = Yup.object({
  number: Yup.string().trim().required("required").matches(US_PHONE, "invalid"),
});

/**
 * "Add caller" for a live softphone call: brings a third party (e.g.
 * SmartCredit / MyFreeScoreNow support) into the call via Twilio Conference,
 * with a keypad for their phone menu. Shown only while connected.
 */
export function ThreeWayCallControl({ callSid }: { callSid: string | null }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const presets = useAppSelector((s) => s.voice.threeWayPresets);
  const threeWay = useAppSelector((s) => s.voice.threeWay);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState("");

  useEffect(() => {
    if (open && presets.length === 0) void dispatch(fetchThreeWayPresets());
  }, [open, presets.length, dispatch]);

  const add = async (to: string, label?: string | null) => {
    if (!callSid) return;
    const res = await dispatch(startThreeWayCall({ callSid, to, label }));
    if (startThreeWayCall.rejected.match(res)) {
      toast({
        title: t("conversations.voice.threeWay.addError"),
        description: String(res.payload || ""),
        variant: "destructive",
      });
    }
  };

  const form = useFormik({
    initialValues: { number: "" },
    validationSchema: schema,
    onSubmit: async (v, helpers) => {
      await add(v.number.trim(), null);
      helpers.resetForm();
    },
  });

  const press = async (key: string) => {
    if (!threeWay.sessionId) return;
    setSent((s) => `${s}${key}`.slice(-16));
    const res = await dispatch(sendThreeWayDigits({ sessionId: threeWay.sessionId, digits: key }));
    if (sendThreeWayDigits.rejected.match(res)) {
      toast({ title: t("conversations.voice.threeWay.digitsError"), variant: "destructive" });
    }
  };

  const remove = async () => {
    if (!threeWay.sessionId) return;
    const res = await dispatch(removeThreeWayCaller({ sessionId: threeWay.sessionId }));
    if (removeThreeWayCaller.rejected.match(res)) {
      toast({ title: t("conversations.voice.threeWay.removeError"), variant: "destructive" });
    } else {
      setSent("");
    }
  };

  const active = threeWay.status === "active" || threeWay.status === "removing";
  const who = threeWay.label || threeWay.number || "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn(
            "h-10 w-10 rounded-full transition-colors",
            active && "bg-primary/10 border-primary/40 text-primary",
          )}
          disabled={!callSid}
          title={t("conversations.voice.threeWay.addCaller")}
          data-testid="three-way-trigger"
        >
          {threeWay.status === "adding" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="center">
        {active ? (
          <div className="space-y-3 animate-in fade-in">
            <div className="flex items-center gap-2 text-sm">
              <PhoneCall className="h-4 w-4 text-accent" />
              <span className="font-medium text-foreground truncate">
                {t("conversations.voice.threeWay.onCallWith", { name: who })}
              </span>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Grid3x3 className="h-3.5 w-3.5" />
              {t("conversations.voice.threeWay.keypadHint")}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {KEYS.map((k) => (
                <Button
                  key={k}
                  type="button"
                  variant="outline"
                  className="h-10 text-base font-semibold active:scale-95 transition-transform"
                  onClick={() => void press(k)}
                  disabled={threeWay.status === "removing"}
                  data-testid={`three-way-key-${k}`}
                >
                  {k}
                </Button>
              ))}
            </div>
            {sent && (
              <p className="text-center font-mono text-xs tracking-widest text-muted-foreground">
                {sent}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => void remove()}
              disabled={threeWay.status === "removing"}
            >
              {threeWay.status === "removing" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserMinus className="h-4 w-4" />
              )}
              {t("conversations.voice.threeWay.remove", { name: who })}
            </Button>
          </div>
        ) : threeWay.status === "adding" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("conversations.voice.threeWay.calling", { name: who })}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">
              {t("conversations.voice.threeWay.addCaller")}
            </p>
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <Button
                    key={p.number}
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 text-xs"
                    onClick={() => void add(p.number, p.label)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            )}
            <form onSubmit={form.handleSubmit} className="space-y-2">
              <Input
                type="tel"
                placeholder="(877) 555-0100"
                {...form.getFieldProps("number")}
                data-testid="three-way-number"
              />
              {form.touched.number && form.errors.number && (
                <p className="text-xs text-destructive">
                  {t(`conversations.voice.threeWay.validation.${form.errors.number}`)}
                </p>
              )}
              <Button type="submit" size="sm" className="w-full gap-1.5" disabled={form.isSubmitting}>
                <UserPlus className="h-4 w-4" />
                {t("conversations.voice.threeWay.call")}
              </Button>
            </form>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("conversations.voice.threeWay.recordedNote")}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

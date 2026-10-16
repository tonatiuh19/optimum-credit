import { useEffect, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { Loader2, Mail, Monitor, PhoneForwarded, Voicemail, Wrench } from "lucide-react";
import FieldHint from "@/components/admin/FieldHint";
import { isInternationalForwardingNumber } from "@/lib/callForwarding";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchCallForwardingSettings,
  fetchVoicemailSettings,
  fixCallSetup,
  saveCallForwardingSettings,
  saveVoicemailSettings,
  setVoiceAvailable,
  type VoicemailSettingsResponse,
} from "@/store/slices/voiceSlice";
import { fetchNotificationPrefs } from "@/store/slices/adminNotificationsSlice";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const forwardingSchema = (t: (key: string) => string) =>
  Yup.object({
    enabled: Yup.boolean(),
    phone: Yup.string().when("enabled", {
      is: true,
      then: (schema) =>
        schema
          .min(10, t("conversations.voice.validationPhone"))
          .required(t("conversations.voice.validationPhoneRequired")),
      otherwise: (schema) => schema,
    }),
  });

const voicemailSchema = (t: (key: string) => string) =>
  Yup.object({
    enabled: Yup.boolean().nullable(),
    greeting_text: Yup.string().max(500),
    greeting_url: Yup.string()
      .transform((v) => (typeof v === "string" && v.trim() === "" ? null : v))
      .nullable()
      .url(t("conversations.voice.validationUrl")),
  });

export default function ConversationVoiceSettingsModal({
  open,
  onOpenChange,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const isAvailable = useAppSelector((s) => s.voice.isAvailable);
  const deviceStatus = useAppSelector((s) => s.voice.deviceStatus);
  const emailChannelAvailable = useAppSelector(
    (s) => s.adminNotifications.channels?.email?.available ?? true,
  );

  const [fwdLoading, setFwdLoading] = useState(false);
  const [vmLoading, setVmLoading] = useState(false);
  const [vmData, setVmData] = useState<VoicemailSettingsResponse | null>(null);
  const [fixingSetup, setFixingSetup] = useState(false);

  const forwardingForm = useFormik({
    enableReinitialize: true,
    initialValues: { enabled: false, phone: "" },
    validationSchema: forwardingSchema(t),
    onSubmit: async (values, { setSubmitting }) => {
      try {
        const data = await dispatch(
          saveCallForwardingSettings({
            enabled: values.enabled,
            phone: values.phone.trim(),
          }),
        ).unwrap();
        if (data.success) {
          forwardingForm.setFieldValue(
            "phone",
            data.call_forwarding_phone ?? values.phone,
          );
          toast({
            title: t("conversations.voice.forwardingSaved"),
            description: values.enabled
              ? t("conversations.voice.forwardingSavedOn", {
                  phone: data.call_forwarding_phone ?? values.phone,
                })
              : t("conversations.voice.forwardingSavedOff"),
          });
        } else {
          throw new Error(data.error || t("conversations.voice.saveFailed"));
        }
      } catch (err: unknown) {
        toast({
          title: t("conversations.voice.saveFailed"),
          description:
            typeof err === "string"
              ? err
              : err instanceof Error
                ? err.message
                : t("conversations.voice.saveFailed"),
          variant: "destructive",
        });
      } finally {
        setSubmitting(false);
      }
    },
  });

  const voicemailForm = useFormik({
    enableReinitialize: true,
    initialValues: {
      enabled: null as boolean | null,
      greeting_text: "",
      greeting_url: "",
    },
    validationSchema: voicemailSchema(t),
    onSubmit: async (values, { setSubmitting }) => {
      try {
        await dispatch(
          saveVoicemailSettings({
            enabled: values.enabled,
            greeting_text: values.greeting_text.trim()
              ? values.greeting_text.trim()
              : null,
            greeting_url: values.greeting_url.trim()
              ? values.greeting_url.trim()
              : null,
          }),
        ).unwrap();
        toast({
          title: t("conversations.voice.voicemailSaved"),
          description: t("conversations.voice.voicemailSavedBody"),
        });
        const refreshed = await dispatch(fetchVoicemailSettings()).unwrap();
        if (refreshed?.success) setVmData(refreshed);
      } catch (err: unknown) {
        toast({
          title: t("conversations.voice.saveFailed"),
          description:
            typeof err === "string"
              ? err
              : err instanceof Error
                ? err.message
                : t("conversations.voice.saveFailed"),
          variant: "destructive",
        });
      } finally {
        setSubmitting(false);
      }
    },
  });

  useEffect(() => {
    if (!open) return;

    dispatch(fetchNotificationPrefs());

    setFwdLoading(true);
    dispatch(fetchCallForwardingSettings())
      .unwrap()
      .then((data) => {
        if (data.success) {
          forwardingForm.setValues({
            enabled: !!data.call_forwarding_enabled,
            phone: data.call_forwarding_number ?? "",
          });
        }
      })
      .catch(() => {})
      .finally(() => setFwdLoading(false));

    setVmLoading(true);
    dispatch(fetchVoicemailSettings())
      .unwrap()
      .then((data) => {
        if (data?.success) {
          setVmData(data);
          const admin = data.admin ?? (data as { broker?: typeof data.admin }).broker;
          if (admin) {
            voicemailForm.setValues({
              enabled: admin.voicemail_enabled,
              greeting_text: admin.voicemail_greeting_text ?? "",
              greeting_url: admin.voicemail_greeting_url ?? "",
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => setVmLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dispatch]);

  const availabilityLabel = !isAvailable
    ? t("conversations.voice.unavailable")
    : deviceStatus === "registered"
      ? t("conversations.voice.available")
      : deviceStatus === "connecting"
        ? t("conversations.voice.connecting")
        : deviceStatus === "error"
          ? t("conversations.voice.voipError")
          : t("conversations.voice.available");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("conversations.voice.settingsTitle")}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="availability" className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto">
            <TabsTrigger value="availability" className="text-xs sm:text-sm">
              {t("conversations.voice.tabAvailability")}
            </TabsTrigger>
            <TabsTrigger value="forwarding" className="text-xs sm:text-sm">
              {t("conversations.voice.tabForwarding")}
            </TabsTrigger>
            <TabsTrigger value="voicemail" className="text-xs sm:text-sm">
              {t("conversations.voice.tabVoicemail")}
            </TabsTrigger>
            <TabsTrigger value="notifications" className="text-xs sm:text-sm">
              {t("conversations.voice.tabNotifications")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="availability" className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              {t("conversations.voice.availabilityHint")}
            </p>
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Monitor className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("conversations.voice.browserSoftphone")}
                  </p>
                  <p
                    className={cn(
                      "text-xs",
                      deviceStatus === "error"
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {availabilityLabel}
                  </p>
                </div>
              </div>
              <Switch
                checked={isAvailable}
                onCheckedChange={(checked) =>
                  dispatch(setVoiceAvailable(checked))
                }
                aria-label={t("conversations.voice.tabAvailability")}
              />
            </div>
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Wrench className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {t("conversations.voice.fixSetupTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("conversations.voice.fixSetupHint")}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={fixingSetup}
                onClick={async () => {
                  setFixingSetup(true);
                  try {
                    const data = await dispatch(fixCallSetup()).unwrap();
                    const numbers = Array.isArray(
                      (data as { numbers?: unknown[] }).numbers,
                    )
                      ? (data as { numbers: Array<{ ok?: boolean }> }).numbers
                      : [];
                    const okCount = numbers.filter((n) => n.ok).length;
                    toast({
                      title: t("conversations.voice.fixSetupSuccess"),
                      description:
                        numbers.length > 0
                          ? t("conversations.voice.fixSetupNumbers", {
                              ok: okCount,
                              total: numbers.length,
                            })
                          : t("conversations.voice.fixSetupTwimlOnly"),
                    });
                  } catch (err: unknown) {
                    toast({
                      title: t("conversations.voice.fixSetupFailed"),
                      description:
                        typeof err === "string"
                          ? err
                          : err instanceof Error
                            ? err.message
                            : t("conversations.voice.fixSetupFailed"),
                      variant: "destructive",
                    });
                  } finally {
                    setFixingSetup(false);
                  }
                }}
              >
                {fixingSetup ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Wrench className="h-4 w-4 mr-2" />
                )}
                {t("conversations.voice.fixSetupCta")}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="forwarding" className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              {t("conversations.voice.forwardingHint")}
            </p>
            {fwdLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("conversations.voice.loading")}
              </div>
            ) : (
              <form
                onSubmit={forwardingForm.handleSubmit}
                className="space-y-4"
              >
                <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                  <div className="flex items-center gap-3">
                    <PhoneForwarded className="h-4 w-4 text-primary shrink-0" />
                    <Label htmlFor="fwd-enabled" className="text-sm font-medium">
                      {t("conversations.voice.forwardToPhone")}
                    </Label>
                  </div>
                  <Switch
                    id="fwd-enabled"
                    checked={forwardingForm.values.enabled}
                    onCheckedChange={(checked) =>
                      forwardingForm.setFieldValue("enabled", checked)
                    }
                  />
                </div>
                {forwardingForm.values.enabled && (
                  <div className="space-y-1.5">
                    <Label htmlFor="fwd-phone" className="text-xs">
                      {t("conversations.voice.forwardPhoneLabel")}
                    </Label>
                    <Input
                      id="fwd-phone"
                      type="tel"
                      placeholder="+1 555 123 4567"
                      {...forwardingForm.getFieldProps("phone")}
                    />
                    {forwardingForm.touched.phone &&
                      forwardingForm.errors.phone && (
                        <p className="text-xs text-destructive">
                          {forwardingForm.errors.phone}
                        </p>
                      )}
                    {isInternationalForwardingNumber(
                      forwardingForm.values.phone,
                    ) && (
                      <FieldHint tone="warning">
                        {t("conversations.voice.forwardIntlWarning")}
                      </FieldHint>
                    )}
                    <FieldHint>
                      {t("conversations.voice.forwardScreenHint")}
                    </FieldHint>
                  </div>
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={forwardingForm.isSubmitting}
                >
                  {forwardingForm.isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t("conversations.voice.saveForwarding")}
                </Button>
              </form>
            )}
          </TabsContent>

          <TabsContent value="voicemail" className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              {t("conversations.voice.voicemailHint")}
            </p>
            {vmLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("conversations.voice.loading")}
              </div>
            ) : !vmData?.admin?.has_personal_line &&
              !(vmData as { broker?: { has_personal_line?: boolean } })?.broker
                ?.has_personal_line ? (
              <p className="text-sm text-muted-foreground rounded-lg border border-border bg-muted/30 p-3">
                {t("conversations.voice.noPersonalLine")}
              </p>
            ) : (
              <form
                onSubmit={voicemailForm.handleSubmit}
                className="space-y-4"
              >
                <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Voicemail className="h-4 w-4 text-primary shrink-0" />
                    <Label htmlFor="vm-enabled" className="text-sm font-medium">
                      {t("conversations.voice.voicemailEnabled")}
                    </Label>
                  </div>
                  <Switch
                    id="vm-enabled"
                    checked={voicemailForm.values.enabled ?? true}
                    onCheckedChange={(checked) =>
                      voicemailForm.setFieldValue("enabled", checked)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vm-greeting-text" className="text-xs">
                    {t("conversations.voice.greetingText")}
                  </Label>
                  <Textarea
                    id="vm-greeting-text"
                    rows={3}
                    placeholder={t("conversations.voice.greetingTextPlaceholder")}
                    {...voicemailForm.getFieldProps("greeting_text")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vm-greeting-url" className="text-xs">
                    {t("conversations.voice.greetingUrl")}
                  </Label>
                  <Input
                    id="vm-greeting-url"
                    type="url"
                    placeholder="https://…"
                    {...voicemailForm.getFieldProps("greeting_url")}
                  />
                  {voicemailForm.touched.greeting_url &&
                    voicemailForm.errors.greeting_url && (
                      <p className="text-xs text-destructive">
                        {voicemailForm.errors.greeting_url}
                      </p>
                    )}
                  <p className="text-[11px] text-muted-foreground">
                    {t("conversations.voice.greetingUrlHint")}
                  </p>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={voicemailForm.isSubmitting}
                >
                  {voicemailForm.isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {t("conversations.voice.saveVoicemail")}
                </Button>
              </form>
            )}
          </TabsContent>

          <TabsContent value="notifications" className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              {t("conversations.voice.notificationsHint")}
            </p>
            <div className="space-y-3">
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary shrink-0" />
                  <p className="text-sm font-medium text-foreground">
                    {t("conversations.voice.notifyMissedCallTitle")}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("conversations.voice.notifyMissedCallBody")}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Voicemail className="h-4 w-4 text-primary shrink-0" />
                  <p className="text-sm font-medium text-foreground">
                    {t("conversations.voice.notifyVoicemailTitle")}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("conversations.voice.notifyVoicemailBody")}
                </p>
              </div>
              {!emailChannelAvailable && (
                <p className="text-xs text-destructive">
                  {t("conversations.voice.emailChannelUnavailable")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("conversations.voice.notificationsProfileLink")}
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

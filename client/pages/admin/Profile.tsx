import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Loader2,
  MessageSquare,
  Mail,
  Smartphone,
  Sparkles,
  Volume2,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchNotificationPrefs,
  saveNotificationPrefs,
} from "@/store/slices/adminNotificationsSlice";
import {
  fetchMcpConnections,
  revokeMcpConnection,
} from "@/store/slices/adminMcpSlice";
import type {
  AdminNotifyChannel,
  AdminNotifyEventKey,
} from "@shared/api";
import { logger } from "@/utils/logger";
import {
  isNotificationSoundMuted,
  previewNotificationChime,
  setNotificationSoundMuted,
} from "@/lib/notification-sound";
import { isInboundSmsInAppEnabled } from "@/lib/inboundSmsNotification";

const EVENT_ORDER: AdminNotifyEventKey[] = [
  "purchase_enrollment",
  "payment_installment",
  "submission_ready_review",
  "submission_doc_upload",
  "submission_info_request",
  "doc_upload_link",
  "round_calendar",
  "work_task_assigned",
  "work_task_overdue",
  "inbound_sms",
  "missed_call",
  "voicemail",
  "call_transcript",
  "funding_doc_upload",
  "funding_application_created",
  "get_credit_report_lead",
  "event_registration",
  "prospect_temperature",
  "progress_report_alerts",
  "morning_digest",
];

const CHANNELS: {
  key: AdminNotifyChannel;
  icon: typeof Mail;
}[] = [
  { key: "email", icon: Mail },
  { key: "in_app", icon: MessageSquare },
  { key: "sms", icon: Smartphone },
];

export default function AdminProfile() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { prefs, channels, prefsLoading, prefsSaving, prefsError } =
    useAppSelector((s) => s.adminNotifications);
  const user = useAppSelector((s) => s.adminAuth.user);
  const {
    connections: mcpConnections,
    loading: mcpLoading,
    revokingId,
  } = useAppSelector((s) => s.adminMcp);
  const [soundEnabled, setSoundEnabled] = useState(
    () => !isNotificationSoundMuted(),
  );

  useEffect(() => {
    const sync = () => setSoundEnabled(!isNotificationSoundMuted());
    window.addEventListener("ofg:notification-sound-mute", sync);
    return () => window.removeEventListener("ofg:notification-sound-mute", sync);
  }, []);

  const inboundSmsInApp = isInboundSmsInAppEnabled(prefs);

  useEffect(() => {
    dispatch(fetchNotificationPrefs()).catch((e) =>
      logger.warn("prefs load failed", e),
    );
    dispatch(fetchMcpConnections()).catch((e) =>
      logger.warn("mcp connections load failed", e),
    );
  }, [dispatch]);

  const toggle = (
    channel: AdminNotifyChannel,
    eventKey: AdminNotifyEventKey,
    value: boolean,
  ) => {
    if (!prefs) return;
    if (channels?.[channel] && !channels[channel].available) return;
    void dispatch(
      saveNotificationPrefs({
        [channel]: { [eventKey]: value },
      }),
    );
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <AdminPageHeader
        title={t("adminProfile.title")}
        description={t("adminProfile.description")}
        icon={Bell}
      />

      <div className="rounded-xl border border-border bg-card px-4 py-3 sm:px-5">
        <div className="text-sm font-semibold text-foreground">
          {user
            ? `${user.first_name} ${user.last_name}`.trim()
            : t("adminProfile.you")}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {user?.email}
          {user?.role
            ? ` · ${t(`adminNav.roles.${user.role}`, { defaultValue: user.role })}`
            : ""}
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">
            {t("adminProfile.prefsTitle")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("adminProfile.prefsSubtitle")}
          </p>
        </div>

        {prefsLoading && !prefs ? (
          <div className="p-5 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : prefsError && !prefs ? (
          <div className="p-5 text-sm text-destructive">{prefsError}</div>
        ) : prefs && channels ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left font-semibold text-foreground px-4 py-3 w-[40%]">
                    {t("adminProfile.colEvent")}
                  </th>
                  {CHANNELS.map(({ key, icon: Icon }) => {
                    const meta = channels[key];
                    const locked = !meta.available;
                    return (
                      <th
                        key={key}
                        className="text-center font-semibold text-foreground px-3 py-3"
                      >
                        <div className="inline-flex flex-col items-center gap-1">
                          <span className="inline-flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                            {t(`adminProfile.channel.${key}`)}
                          </span>
                          {locked && (
                            <span className="text-[10px] font-medium text-muted-foreground normal-case tracking-normal">
                              {t("adminProfile.smsDisabledHint")}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {EVENT_ORDER.map((eventKey) => (
                  <tr
                    key={eventKey}
                    className="border-b border-border/70 last:border-0"
                  >
                    <td className="px-4 py-3 align-middle">
                      <div className="font-medium text-foreground">
                        {t(`adminProfile.events.${eventKey}.label`)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t(`adminProfile.events.${eventKey}.hint`)}
                      </div>
                    </td>
                    {CHANNELS.map(({ key: channel }) => {
                      const locked = !channels[channel].available;
                      const checked = prefs[channel][eventKey];
                      return (
                        <td
                          key={channel}
                          className="px-3 py-3 text-center align-middle"
                        >
                          <div className="inline-flex justify-center">
                            <Switch
                              checked={checked}
                              disabled={locked || prefsSaving}
                              onCheckedChange={(v) =>
                                toggle(channel, eventKey, v)
                              }
                              aria-label={`${t(`adminProfile.channel.${channel}`)} — ${t(`adminProfile.events.${eventKey}.label`)}`}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {prefsSaving && (
          <div className="flex items-center gap-2 px-4 py-2 border-t border-border text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t("adminProfile.saving")}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground inline-flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-primary" />
            {t("adminProfile.soundTitle")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("adminProfile.soundSubtitle")}
          </p>
        </div>
        <div className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {t("adminProfile.soundToggleLabel")}
            </div>
            {!inboundSmsInApp && (
              <p className="text-xs text-muted-foreground mt-1">
                {t("adminProfile.soundRequiresInApp")}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Switch
              checked={soundEnabled}
              disabled={!inboundSmsInApp}
              onCheckedChange={(enabled) => {
                setNotificationSoundMuted(!enabled);
                setSoundEnabled(enabled);
                if (enabled) previewNotificationChime();
              }}
              aria-label={t("adminProfile.soundToggleLabel")}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!soundEnabled || !inboundSmsInApp}
              onClick={() => previewNotificationChime()}
            >
              {t("adminProfile.soundPreview")}
            </Button>
          </div>
        </div>
      </section>

      {user?.ai_ask_enabled ? (
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-border">
            <h2 className="text-base font-semibold text-foreground inline-flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {t("adminMcp.connectionsTitle")}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t("adminMcp.connectionsSubtitle")}
            </p>
          </div>
          {mcpLoading && mcpConnections.length === 0 ? (
            <div className="p-5 space-y-3">
              <Skeleton className="h-10 w-full" />
            </div>
          ) : mcpConnections.length === 0 ? (
            <div className="p-5 text-sm text-muted-foreground">
              {t("adminMcp.connectionsEmpty")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {mcpConnections.map((c) => (
                <li
                  key={c.id}
                  className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {c.client_name}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {c.last_used_at
                        ? t("adminMcp.lastUsed", {
                            when: new Date(c.last_used_at).toLocaleString(),
                          })
                        : t("adminMcp.neverUsed")}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={revokingId === c.id}
                    onClick={() =>
                      void dispatch(revokeMcpConnection(c.id)).catch((e) =>
                        logger.warn("mcp revoke failed", e),
                      )
                    }
                  >
                    {revokingId === c.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      t("adminMcp.revoke")
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {t("adminProfile.otpNote")}
      </p>
    </div>
  );
}

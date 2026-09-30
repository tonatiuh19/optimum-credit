import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Smartphone,
  Trash2,
  Users,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addNotifyExtraEmail,
  deleteNotifyExtraEmail,
  fetchNotifyExtraEmails,
  updateNotifyExtraEmail,
  updateStaffNotifyPrefs,
} from "@/store/slices/adminSlice";
import {
  ADMIN_NOTIFY_EVENT_KEYS,
  adminNotifyChannelMasterOn,
} from "@/lib/adminNotifyPrefs";
import type {
  AdminNotifyChannel,
  AdminNotifyEventKey,
  AdminNotifyExtraEmail,
  AdminNotifyStaffRecipient,
} from "@shared/api";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/utils";

const CHANNELS: {
  key: AdminNotifyChannel;
  icon: typeof Mail;
}[] = [
  { key: "email", icon: Mail },
  { key: "in_app", icon: MessageSquare },
  { key: "sms", icon: Smartphone },
];

/** Primary alert types shown in Settings (matches Resend / team emails). */
const EVENT_ORDER: AdminNotifyEventKey[] = [...ADMIN_NOTIFY_EVENT_KEYS];

function extraAllowsEvent(
  row: AdminNotifyExtraEmail,
  eventKey: AdminNotifyEventKey,
): boolean {
  if (row.events == null) return true;
  return row.events.includes(eventKey);
}

function EventTypeToggles(props: {
  checked: (key: AdminNotifyEventKey) => boolean;
  disabled?: boolean;
  onToggle: (key: AdminNotifyEventKey, value: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {EVENT_ORDER.map((eventKey) => {
        const on = props.checked(eventKey);
        return (
          <button
            key={eventKey}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onToggle(eventKey, !on)}
            className={cn(
              "text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors",
              on
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-muted/40 text-muted-foreground border-border",
              props.disabled && "opacity-50 cursor-not-allowed",
            )}
            aria-pressed={on}
          >
            {t(`adminProfile.events.${eventKey}.label`)}
          </button>
        );
      })}
    </div>
  );
}

export default function NotifyExtraEmailsPanel() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    notifyStaff,
    notifyExtraEmails,
    notifyExtraEmailsLoading,
    notifyExtraEmailsSaving,
    notifyExtraEmailsError,
  } = useAppSelector((s) => s.admin);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [expandedStaff, setExpandedStaff] = useState<number | null>(null);
  const [expandedExtra, setExpandedExtra] = useState<number | null>(null);

  useEffect(() => {
    dispatch(fetchNotifyExtraEmails()).catch((e) =>
      logger.warn("notify recipients load failed", e),
    );
  }, [dispatch]);

  const add = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    const result = await dispatch(
      addNotifyExtraEmail({
        email: trimmed,
        label: label.trim() || undefined,
      }),
    );
    if (addNotifyExtraEmail.fulfilled.match(result)) {
      setEmail("");
      setLabel("");
    }
  };

  const toggleStaffChannel = (
    staff: AdminNotifyStaffRecipient,
    channel: AdminNotifyChannel,
    value: boolean,
  ) => {
    if (staff.channels?.[channel] && !staff.channels[channel].available) return;
    void dispatch(
      updateStaffNotifyPrefs({
        id: staff.id,
        channel_masters: { [channel]: value },
      }),
    );
  };

  const toggleStaffEmailEvent = (
    staff: AdminNotifyStaffRecipient,
    eventKey: AdminNotifyEventKey,
    value: boolean,
  ) => {
    void dispatch(
      updateStaffNotifyPrefs({
        id: staff.id,
        email: { [eventKey]: value },
      }),
    );
  };

  const toggleExtraEvent = (
    row: AdminNotifyExtraEmail,
    eventKey: AdminNotifyEventKey,
    value: boolean,
  ) => {
    const base =
      row.events == null ? [...EVENT_ORDER] : [...row.events];
    const next = value
      ? Array.from(new Set([...base, eventKey]))
      : base.filter((k) => k !== eventKey);
    // All selected → store null (all events)
    const events =
      next.length === EVENT_ORDER.length ? null : next;
    void dispatch(updateNotifyExtraEmail({ id: row.id, events }));
  };

  return (
    <div className="space-y-4">
      <div className="px-1">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Bell className="w-4 h-4" />
          {t("adminSettings.notifyPanelTitle")}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          {t("adminSettings.notifyPanelSubtitle")}
        </p>
      </div>

      {notifyExtraEmailsError && (
        <p className="text-sm text-destructive px-1">{notifyExtraEmailsError}</p>
      )}

      {/* Staff team */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-border flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <div>
            <div className="text-sm font-semibold text-foreground">
              {t("adminSettings.notifyStaffTitle")}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("adminSettings.notifyStaffSubtitle")}
            </p>
          </div>
        </div>

        {notifyExtraEmailsLoading && notifyStaff.length === 0 ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : notifyStaff.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            {t("adminSettings.notifyStaffEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {notifyStaff.map((row) => {
              const name =
                `${row.first_name} ${row.last_name}`.trim() || row.email;
              const open = expandedStaff === row.id;
              return (
                <li key={row.id} className="px-4 sm:px-5 py-3 space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() =>
                        setExpandedStaff(open ? null : row.id)
                      }
                    >
                      <div className="text-sm font-medium text-foreground truncate">
                        {name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {row.email}
                        {" · "}
                        {t(`adminNav.roles.${row.role}`, {
                          defaultValue: row.role,
                        })}
                        {" · "}
                        <span className="text-primary">
                          {open
                            ? t("adminSettings.notifyHideTypes")
                            : t("adminSettings.notifyShowTypes")}
                        </span>
                      </div>
                    </button>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 shrink-0">
                      {CHANNELS.map(({ key, icon: Icon }) => {
                        const locked = !row.channels?.[key]?.available;
                        const checked = adminNotifyChannelMasterOn(
                          row.prefs,
                          key,
                        );
                        return (
                          <div
                            key={key}
                            className={cn(
                              "inline-flex items-center gap-2",
                              locked && "opacity-50",
                            )}
                            title={
                              locked
                                ? t("adminSettings.notifyChannelLocked")
                                : undefined
                            }
                          >
                            <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">
                              {t(`adminProfile.channel.${key}`)}
                            </span>
                            <Switch
                              checked={checked}
                              disabled={locked || notifyExtraEmailsSaving}
                              onCheckedChange={(v) =>
                                toggleStaffChannel(row, key, v)
                              }
                              aria-label={`${name} — ${t(`adminProfile.channel.${key}`)}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {open && (
                    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {t("adminSettings.notifyStaffEventHint")}
                      </p>
                      <EventTypeToggles
                        disabled={notifyExtraEmailsSaving}
                        checked={(k) => !!row.prefs.email[k]}
                        onToggle={(k, v) => toggleStaffEmailEvent(row, k, v)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Extra emails */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-border">
          <div className="text-sm font-semibold text-foreground">
            {t("adminSettings.notifyEmailsTitle")}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("adminSettings.notifyEmailsSubtitle")}
          </p>
        </div>

        <div className="p-4 sm:p-5 border-b border-border space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_minmax(0,10rem)_auto] gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("adminSettings.notifyEmailsEmailPlaceholder")}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
            />
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("adminSettings.notifyEmailsLabelPlaceholder")}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
            />
            <Button
              type="button"
              onClick={() => void add()}
              disabled={!email.trim() || notifyExtraEmailsSaving}
              className="h-10"
            >
              {notifyExtraEmailsSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              {t("adminSettings.notifyEmailsAdd")}
            </Button>
          </div>
        </div>

        {notifyExtraEmailsLoading && notifyExtraEmails.length === 0 ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : notifyExtraEmails.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            {t("adminSettings.notifyEmailsEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {notifyExtraEmails.map((row) => {
              const open = expandedExtra === row.id;
              return (
                <li key={row.id} className="px-4 sm:px-5 py-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() =>
                        setExpandedExtra(open ? null : row.id)
                      }
                    >
                      <div className="text-sm font-medium text-foreground truncate">
                        {row.email}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {row.label ? `${row.label} · ` : ""}
                        {row.events == null
                          ? t("adminSettings.notifyEventsAll")
                          : t("adminSettings.notifyEventsSelected", {
                              count: row.events.length,
                            })}
                        {" · "}
                        <span className="text-primary">
                          {open
                            ? t("adminSettings.notifyHideTypes")
                            : t("adminSettings.notifyShowTypes")}
                        </span>
                      </div>
                    </button>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {row.is_active
                            ? t("adminSettings.notifyEmailsActive")
                            : t("adminSettings.notifyEmailsPaused")}
                        </span>
                        <Switch
                          checked={row.is_active}
                          disabled={notifyExtraEmailsSaving}
                          onCheckedChange={(v) =>
                            void dispatch(
                              updateNotifyExtraEmail({
                                id: row.id,
                                is_active: v,
                              }),
                            )
                          }
                          aria-label={t("adminSettings.notifyEmailsToggleAria", {
                            email: row.email,
                          })}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={notifyExtraEmailsSaving}
                        onClick={() =>
                          void dispatch(deleteNotifyExtraEmail({ id: row.id }))
                        }
                        aria-label={t("adminSettings.notifyEmailsRemoveAria", {
                          email: row.email,
                        })}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  {open && (
                    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {t("adminSettings.notifyExtraEventHint")}
                      </p>
                      <EventTypeToggles
                        disabled={notifyExtraEmailsSaving || !row.is_active}
                        checked={(k) => extraAllowsEvent(row, k)}
                        onToggle={(k, v) => toggleExtraEvent(row, k, v)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

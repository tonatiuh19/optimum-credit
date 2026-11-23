import type { ReactNode } from "react";
import { Facebook, Instagram, Lock, MessageSquare, SlidersHorizontal, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SocialPlatformFilter } from "@shared/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { activeFilterCount, type ConversationsFilterPrefs } from "@/lib/conversationsFilterPrefs";
import { cn } from "@/lib/utils";

export interface ConversationsFilterBarProps {
  prefs: ConversationsFilterPrefs;
  onChange: (next: ConversationsFilterPrefs) => void;
  socialLive: boolean;
  unread: { sms: number; social: number };
}

function UnreadDot({ n, active }: { n: number; active: boolean }) {
  const { t } = useTranslation();
  if (n <= 0) return null;
  return (
    <>
    <span className="sr-only">{t("conversations.filters.unreadCount", { count: n })}</span>
    <span
      className={cn(
        "min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold leading-none inline-flex items-center justify-center animate-in zoom-in-50 duration-200",
        active ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground",
      )}
      aria-hidden
    >
      {n > 99 ? "99+" : n}
    </span>
    </>
  );
}

/** Small segmented control: one choice, sliding active pill. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = "md",
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: LucideIcon; trailing?: ReactNode; testId?: string; title?: string }>;
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: "md" | "sm";
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex w-full rounded-xl bg-muted p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={o.testId}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-[10px] font-semibold transition-all duration-200",
              size === "md" ? "h-8 text-xs" : "h-7 text-[11px]",
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
            {o.label}
            {o.trailing}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Inbox controls: SMS | Social tabs (unread badges), Open | Closed status, and a Filters
 * popover whose options combine (owner, unread, unknown, platform), echoed as removable chips.
 */
export function ConversationsFilterBar({ prefs, onChange, socialLive, unread }: ConversationsFilterBarProps) {
  const { t } = useTranslation();
  const social = prefs.hub === "social";
  const set = (patch: Partial<ConversationsFilterPrefs>) => onChange({ ...prefs, ...patch });
  const count = activeFilterCount(prefs, social);
  const showListControls = !social || socialLive;

  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (prefs.owner !== "any") chips.push({ key: "owner", label: t(`conversations.filters.owner.${prefs.owner}`), clear: () => set({ owner: "any" }) });
  if (prefs.unread) chips.push({ key: "unread", label: t("conversations.filters.unread"), clear: () => set({ unread: false }) });
  if (prefs.unknownOnly) chips.push({ key: "unknown", label: t("conversations.filters.unknownOnly"), clear: () => set({ unknownOnly: false }) });
  if (social && prefs.platform)
    chips.push({
      key: "platform",
      label: t(prefs.platform === "instagram" ? "conversations.social.platformInstagram" : "conversations.social.platformFacebook"),
      clear: () => set({ platform: null }),
    });

  const platformOptions: Array<{ value: SocialPlatformFilter | null; label: string; icon?: LucideIcon }> = [
    { value: null, label: t("conversations.social.platformAll") },
    { value: "instagram", label: t("conversations.social.platformInstagram"), icon: Instagram },
    { value: "messenger", label: t("conversations.social.platformFacebook"), icon: Facebook },
  ];

  return (
    <div className="space-y-2" data-testid="conversations-filter-bar">
      <Segmented
        ariaLabel={t("conversations.filters.inboxAria")}
        value={prefs.hub}
        onChange={(hub) => set({ hub })}
        options={[
          {
            value: "sms",
            label: t("conversations.hubChannels.sms"),
            icon: MessageSquare,
            trailing: <UnreadDot n={unread.sms} active={!social} />,
          },
          {
            value: "social",
            label: t("conversations.hubChannels.social"),
            icon: Instagram,
            testId: "conversations-hub-social",
            title: socialLive ? t("conversations.social.chipLiveHint") : t("conversations.social.chipSoonHint"),
            trailing: socialLive ? <UnreadDot n={unread.social} active={social} /> : <Lock className="h-3 w-3 opacity-70" aria-hidden />,
          },
        ]}
      />

      {showListControls && (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <Segmented
              size="sm"
              ariaLabel={t("conversations.filters.statusAria")}
              value={prefs.status}
              onChange={(status) => set({ status })}
              options={[
                { value: "open", label: t("conversations.filters.open") },
                { value: "closed", label: t("conversations.filters.closed") },
              ]}
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "h-8 shrink-0 inline-flex items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition-colors",
                  count ? "border-primary/40 bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
                data-testid="conversations-filters-button"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                {t("conversations.filters.button")}
                {count > 0 && (
                  <span className="min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold inline-flex items-center justify-center">
                    {count}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3 space-y-3">
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("conversations.filters.ownerTitle")}</div>
                <Segmented
                  size="sm"
                  ariaLabel={t("conversations.filters.ownerTitle")}
                  value={prefs.owner}
                  onChange={(owner) => set({ owner })}
                  options={[
                    { value: "any", label: t("conversations.filters.owner.any") },
                    { value: "mine", label: t("conversations.filters.owner.mine") },
                    { value: "unassigned", label: t("conversations.filters.owner.unassigned") },
                  ]}
                />
              </div>
              {social && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("conversations.filters.platformTitle")}</div>
                  <div className="flex gap-1">
                    {platformOptions.map((o) => {
                      const active = prefs.platform === o.value;
                      const Icon = o.icon;
                      return (
                        <button
                          key={o.label}
                          type="button"
                          aria-pressed={active}
                          onClick={() => set({ platform: o.value })}
                          className={cn(
                            "flex-1 h-7 inline-flex items-center justify-center gap-1 rounded-lg text-[11px] font-semibold transition-colors",
                            active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>{t("conversations.filters.unread")}</span>
                <Switch checked={prefs.unread} onCheckedChange={(v) => set({ unread: v })} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {t("conversations.filters.unknownOnly")}
                  <span className="block text-[11px] text-muted-foreground">{t("conversations.filters.unknownHint")}</span>
                </span>
                <Switch checked={prefs.unknownOnly} onCheckedChange={(v) => set({ unknownOnly: v })} />
              </label>
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => set({ owner: "any", unread: false, unknownOnly: false, platform: null })}
                  className="w-full text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {t("conversations.filters.reset")}
                </button>
              )}
            </PopoverContent>
          </Popover>
        </div>
      )}

      {showListControls && chips.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid="conversations-active-filters">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.clear}
              aria-label={t("conversations.filters.removeAria", { name: c.label })}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-primary/20 animate-in fade-in-0 zoom-in-95 duration-150"
            >
              {c.label}
              <X className="h-3 w-3 opacity-70" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

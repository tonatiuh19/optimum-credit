import type { SocialPlatformFilter } from "@shared/api";

/** What the inbox remembers per staff member (this browser only). */
export interface ConversationsFilterPrefs {
  hub: "sms" | "social";
  status: "open" | "closed";
  owner: "any" | "mine" | "unassigned";
  unread: boolean;
  unknownOnly: boolean;
  platform: SocialPlatformFilter | null;
}

export const DEFAULT_FILTER_PREFS: ConversationsFilterPrefs = {
  hub: "sms",
  status: "open",
  owner: "any",
  unread: false,
  unknownOnly: false,
  platform: null,
};

const key = (adminId: number) => `ofg.conversations.filters.v1.${adminId}`;

/** Never trusts storage: unknown or malformed values fall back to the defaults. */
export function parseFilterPrefs(raw: string | null): ConversationsFilterPrefs {
  let v: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") v = parsed as Record<string, unknown>;
  } catch {
    return { ...DEFAULT_FILTER_PREFS };
  }
  return {
    hub: v.hub === "social" ? "social" : "sms",
    status: v.status === "closed" ? "closed" : "open",
    owner: v.owner === "mine" || v.owner === "unassigned" ? v.owner : "any",
    unread: v.unread === true,
    unknownOnly: v.unknownOnly === true,
    platform: v.platform === "instagram" || v.platform === "messenger" ? v.platform : null,
  };
}

export function loadFilterPrefs(adminId: number | null | undefined): ConversationsFilterPrefs {
  if (!adminId) return { ...DEFAULT_FILTER_PREFS };
  try {
    return parseFilterPrefs(window.localStorage.getItem(key(adminId)));
  } catch {
    return { ...DEFAULT_FILTER_PREFS };
  }
}

export function saveFilterPrefs(adminId: number | null | undefined, prefs: ConversationsFilterPrefs): void {
  if (!adminId) return;
  try {
    window.localStorage.setItem(key(adminId), JSON.stringify(prefs));
  } catch {
    // Private mode / storage blocked: the inbox still works, it just won't remember.
  }
}

/** How many filters beyond the defaults are on (badge on the Filters button). */
export function activeFilterCount(p: Pick<ConversationsFilterPrefs, "owner" | "unread" | "unknownOnly" | "platform">, social: boolean): number {
  return (p.owner !== "any" ? 1 : 0) + (p.unread ? 1 : 0) + (p.unknownOnly ? 1 : 0) + (social && p.platform ? 1 : 0);
}

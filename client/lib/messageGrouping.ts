/**
 * iMessage-style grouping: consecutive bubbles from the same side, sender and channel,
 * sent within GROUP_WINDOW_MS of each other, render as one stack (header on the first,
 * tail + timestamp/status on the last).
 */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export type GroupableMessage = {
  direction: string;
  channel?: string | null;
  sent_by_admin_name?: string | null;
  created_at: string;
};

export type GroupPosition = { first: boolean; last: boolean };

/** Internal notes, system events and calls always stand alone. */
function isStandalone(m: GroupableMessage): boolean {
  return m.direction === "system" || m.direction === "internal" || m.channel === "internal" || m.channel === "call";
}

export function sameGroup(a: GroupableMessage, b: GroupableMessage): boolean {
  if (isStandalone(a) || isStandalone(b)) return false;
  if (a.direction !== b.direction) return false;
  if ((a.channel ?? null) !== (b.channel ?? null)) return false;
  if ((a.sent_by_admin_name ?? null) !== (b.sent_by_admin_name ?? null)) return false;
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(tb - ta) <= GROUP_WINDOW_MS;
}

export function messageGroupPositions(messages: GroupableMessage[]): GroupPosition[] {
  return messages.map((m, i) => ({
    first: i === 0 || !sameGroup(messages[i - 1], m),
    last: i === messages.length - 1 || !sameGroup(m, messages[i + 1]),
  }));
}

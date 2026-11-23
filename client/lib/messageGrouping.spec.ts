import { describe, expect, it } from "vitest";
import { messageGroupPositions, sameGroup } from "@/lib/messageGrouping";

const at = (min: number) => new Date(Date.UTC(2026, 10, 22, 10, min)).toISOString();
const out = (min: number, by = "Cesar") => ({ direction: "outbound", channel: "sms", sent_by_admin_name: by, created_at: at(min) });
const inb = (min: number) => ({ direction: "inbound", channel: "sms", created_at: at(min) });

describe("messageGroupPositions", () => {
  it("groups consecutive same-side messages within 5 minutes", () => {
    expect(messageGroupPositions([out(0), out(2), out(4)])).toEqual([
      { first: true, last: false },
      { first: false, last: false },
      { first: false, last: true },
    ]);
  });

  it("breaks on side change, sender change and time gap", () => {
    expect(sameGroup(out(0), inb(1))).toBe(false);
    expect(sameGroup(out(0), out(1, "Lecca"))).toBe(false);
    expect(sameGroup(out(0), out(6))).toBe(false);
  });

  it("never groups notes, calls or system events", () => {
    const note = { direction: "internal", channel: "internal", created_at: at(1) };
    const call = { direction: "outbound", channel: "call", sent_by_admin_name: "Cesar", created_at: at(1) };
    expect(sameGroup(out(0), note)).toBe(false);
    expect(sameGroup(out(0), call)).toBe(false);
  });

  it("never groups on an unparseable date", () => {
    expect(sameGroup(out(0), { ...out(1), created_at: "nope" })).toBe(false);
  });
});

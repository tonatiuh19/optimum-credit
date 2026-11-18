/** Out of office + client care (Nov 17, 2026): business hours, wording, validation. Pure rules. */
import { describe, expect, it } from "vitest";
import { clientCareHasCheckReaction, clientCareThreadNeedsCheck, validateOutOfOffice } from "./index";
import { CLIENT_CARE_DEFAULT_SETTINGS, normalizeClientCareSettings } from "../shared/clientCareTemplate";
import { businessMinutesBetween, clientCareText, clientCareWhen, prettyUsPhone, returnDayLabel } from "../shared/clientCareTemplate";

const la = (s: string) => new Date(`${s}Z`); // LA wall clock stored as UTC fields

describe("businessMinutesBetween (Mon-Fri 8 AM-6 PM Pacific)", () => {
  it.each([
    ["same morning", "2026-11-17T09:00:00", "2026-11-17T11:00:00", 120],
    ["a night text counts from 8 AM", "2026-11-16T21:00:00", "2026-11-17T10:00:00", 120],
    ["Friday 5 PM → Monday 9 AM = 2h", "2026-11-20T17:00:00", "2026-11-23T09:00:00", 120],
    ["weekend only = 0", "2026-11-21T10:00:00", "2026-11-22T16:00:00", 0],
    ["backwards = 0", "2026-11-17T11:00:00", "2026-11-17T09:00:00", 0],
  ])("%s", (_n, a, b, want) => {
    expect(businessMinutesBetween(la(a), la(b))).toBe(want);
  });
});

describe("clientCareWhen", () => {
  it.each([
    ["Tue 10 AM", "2026-11-17T10:00:00", "en", "today"],
    ["Tue 6 AM", "2026-11-17T06:00:00", "en", "this morning"],
    ["Tue 7 PM", "2026-11-17T19:00:00", "en", "tomorrow morning"],
    ["Fri 6 PM", "2026-11-20T18:00:00", "en", "Monday morning"],
    ["Sat noon", "2026-11-21T12:00:00", "es", "el lunes en la mañana"],
    ["Wed 3 PM", "2026-11-18T15:00:00", "es", "hoy"],
  ] as const)("%s", (_n, at, lang, want) => {
    expect(clientCareWhen(la(at), lang)).toBe(want);
  });
});

describe("clientCareText", () => {
  it("English, with topic, owner + line, the line owner away", () => {
    expect(
      clientCareText({ kind: "message", lang: "en", firstName: "MARIA", topic: "your progress report", owner: { name: "Lecca", phone: "+19497365644" }, away: { name: "Cesar", returnsLabel: "Wednesday 11/25" }, when: "today" }),
    ).toBe("Hi Maria! We got your message about your progress report. Cesar is out of the office until Wednesday 11/25; Lecca (English, 949-736-5644) will reply today. - Optimum Financial Group");
  });
  it("Spanish, no name, no topic, nobody away", () => {
    expect(clientCareText({ kind: "message", lang: "es", owner: { name: "Ángel", phone: "+19495419309" }, when: "mañana en la mañana" })).toBe(
      "¡Hola! Recibimos tu mensaje. Ángel (español, 949-541-9309) te responderá mañana en la mañana. - Optimum Financial Group",
    );
  });
  it("missed call wording", () => {
    expect(clientCareText({ kind: "missed_call", lang: "en", firstName: "jo", owner: { name: "Lecca" }, when: "today" })).toBe("Hi Jo! We missed your call. Lecca will call you back today. - Optimum Financial Group");
    expect(clientCareText({ kind: "missed_call", lang: "es", owner: { name: "Ángel" }, away: { name: "Cesar", returnsLabel: "miércoles, 25 de noviembre" }, when: "hoy" })).toBe(
      "¡Hola! Vimos tu llamada. Cesar está fuera de la oficina hasta el miércoles, 25 de noviembre; Ángel te devolverá la llamada hoy. - Optimum Financial Group",
    );
  });
});

describe("clientCareText with the away person's own message", () => {
  it("sends it exactly as written for messages and missed calls; template otherwise", () => {
    const away = { name: "Cesar", returnsLabel: "Wednesday 11/25", autoReply: "Hi, it's Cesar. I'm away until Wednesday, Nov 25." };
    for (const kind of ["message", "missed_call"] as const) {
      expect(clientCareText({ kind, lang: "en", firstName: "Maria", owner: { name: "Lecca" }, away, when: "today" })).toBe(away.autoReply);
    }
    expect(clientCareText({ kind: "message", lang: "en", owner: { name: "Lecca" }, away: { ...away, autoReply: "  " }, when: "today" })).toContain("Cesar is out of the office until Wednesday 11/25");
  });
});

describe("helpers", () => {
  it("prettyUsPhone / returnDayLabel", () => {
    expect(prettyUsPhone("+19497365644")).toBe("949-736-5644");
    expect(prettyUsPhone("+5299310968")).toBe("+5299310968");
    expect(returnDayLabel("2026-11-25", "en")).toBe("Wednesday 11/25");
    expect(returnDayLabel("2026-11-25", "es")).toMatch(/miércoles.*25.*noviembre/);
  });
});

describe("validateOutOfOffice", () => {
  const today = "2026-11-17";
  it("accepts Cesar's trip (Thu-Tue, back Wed 25) with both backups", () => {
    expect(validateOutOfOffice({ starts_on: "2026-11-19", returns_on: "2026-11-25", backup_en_admin_id: 150002, backup_es_admin_id: 120001, note_en: " Mexico " }, today)).toEqual({
      ok: true,
      v: { starts_on: "2026-11-19", returns_on: "2026-11-25", backup_en_admin_id: 150002, backup_es_admin_id: 120001, note_en: "Mexico", note_es: null, auto_reply_en: null, auto_reply_es: null },
    });
  });
  it("keeps the away person's own auto-reply (trimmed, max 320)", () => {
    const r = validateOutOfOffice({ starts_on: "2026-11-19", returns_on: "2026-11-25", backup_en_admin_id: 150002, auto_reply_en: "  Hi, it's Cesar.\n Back Nov 25. ", auto_reply_es: "" }, today);
    expect(r.ok && r.v).toMatchObject({ auto_reply_en: "Hi, it's Cesar. Back Nov 25.", auto_reply_es: null });
    const long = validateOutOfOffice({ starts_on: "2026-11-19", returns_on: "2026-11-25", backup_en_admin_id: 1, auto_reply_es: "x".repeat(321) }, today);
    expect(long.ok === false && long.error).toMatch(/320/);
  });
  it.each([
    [{ starts_on: "2026-11-25", returns_on: "2026-11-19", backup_en_admin_id: 1 }, /after/],
    [{ starts_on: "2026-11-01", returns_on: "2026-11-10", backup_en_admin_id: 1 }, /already over/],
    [{ starts_on: "2026-11-19", returns_on: "2027-02-01", backup_en_admin_id: 1 }, /60 days/],
    [{ starts_on: "2026-11-19", returns_on: "2026-11-25" }, /at least one backup/],
    [{ starts_on: "11/19/2026", returns_on: "2026-11-25", backup_en_admin_id: 1 }, /YYYY-MM-DD/],
    [{ starts_on: "2026-11-19", returns_on: "2026-11-25", backup_en_admin_id: "x" }, /staff ids/],
  ])("refuses %o", (b, msg) => {
    const r = validateOutOfOffice(b as Record<string, unknown>, today);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(msg);
  });
});

describe("Slack ✅ check helpers", () => {
  it("any check-mark reaction counts; others do not", () => {
    expect(clientCareHasCheckReaction({ reactions: [{ name: "white_check_mark" }] })).toBe(true);
    expect(clientCareHasCheckReaction({ reactions: [{ name: "heavy_check_mark" }] })).toBe(true);
    expect(clientCareHasCheckReaction({ reactions: [{ name: "eyes" }] })).toBe(false);
    expect(clientCareHasCheckReaction(undefined)).toBe(false);
  });
  it("only opens a thread when a person replied (not just the bot's own reminder)", () => {
    expect(clientCareThreadNeedsCheck({ ts: "1", reply_count: 0 }, "UBOT")).toBe(false);
    expect(clientCareThreadNeedsCheck({ ts: "1", reply_count: 1, reply_users: ["UBOT"] }, "UBOT")).toBe(false);
    expect(clientCareThreadNeedsCheck({ ts: "1", reply_count: 2, reply_users: ["UBOT", "ULECCA"] }, "UBOT")).toBe(true);
  });
});

describe("auto_close_after_days setting", () => {
  it("defaults to 3, accepts 0-30, refuses the rest", () => {
    expect(CLIENT_CARE_DEFAULT_SETTINGS.auto_close_after_days).toBe(3);
    const ok = normalizeClientCareSettings({ auto_close_after_days: 0 }, CLIENT_CARE_DEFAULT_SETTINGS);
    expect(ok.ok && ok.settings.auto_close_after_days).toBe(0);
    expect(normalizeClientCareSettings({ auto_close_after_days: 31 }, CLIENT_CARE_DEFAULT_SETTINGS).ok).toBe(false);
    expect(normalizeClientCareSettings({ auto_close_after_days: 1.5 }, CLIENT_CARE_DEFAULT_SETTINGS).ok).toBe(false);
  });
  it("saved settings from before this field keep working (default fills in)", () => {
    const { auto_close_after_days: _drop, ...old } = CLIENT_CARE_DEFAULT_SETTINGS;
    const n = normalizeClientCareSettings(old, CLIENT_CARE_DEFAULT_SETTINGS);
    expect(n.ok && n.settings.auto_close_after_days).toBe(3);
  });
});

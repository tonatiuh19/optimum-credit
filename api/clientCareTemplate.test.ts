/** Client care settings + templates (Nov 17, 2026): renderer, validation, settings rules, custom hours. */
import { describe, expect, it } from "vitest";
import {
  CLIENT_CARE_DEFAULT_SETTINGS as D,
  businessMinutesBetween,
  clientCareText,
  clientCareWhen,
  normalizeClientCareSettings,
  renderClientCareTemplate,
  validateClientCareTemplate,
} from "../shared/clientCareTemplate";

const la = (s: string) => new Date(`${s}Z`);

describe("renderClientCareTemplate", () => {
  it("fills placeholders and drops optional parts with an empty placeholder", () => {
    const tpl = "Hi[[ {first_name}]]! [[About {topic}. ]]{owner} replies {when}.";
    expect(renderClientCareTemplate(tpl, { first_name: "Ana", topic: "fees", owner: "Lecca", when: "today" })).toBe("Hi Ana! About fees. Lecca replies today.");
    expect(renderClientCareTemplate(tpl, { owner: "Lecca", when: "today" })).toBe("Hi! Lecca replies today.");
  });
  it("an optional part with two placeholders needs both", () => {
    expect(renderClientCareTemplate("X[[ ({away_name} until {return_day})]].", { away_name: "Cesar" })).toBe("X.");
  });
  it("tidies spaces before punctuation", () => {
    expect(renderClientCareTemplate("{owner} , ok !", { owner: "Lecca" })).toBe("Lecca, ok!");
  });
});

describe("validateClientCareTemplate", () => {
  it("accepts every default template", () => {
    for (const lang of ["en", "es"] as const) for (const kind of ["message", "missed_call"] as const) expect(validateClientCareTemplate(D.templates[lang][kind])).toBeNull();
  });
  it.each([
    ["", /empty/],
    ["{owner} {when} {nope}", /Unknown placeholder \{nope\}/],
    ["{owner} [[a [[b]] ]] {when}", /nested/],
    ["{owner} [[ {first_name} {when}", /not closed/],
    ["{owner} ]] {when}", /no matching/],
    ["Hi [[{owner}]] {when}", /\{owner\} is required/],
    ["{owner} later", /\{when\} is required/],
    ["{owner} {when} {", /not part of a placeholder/],
    [`{owner} {when} ${"x".repeat(320)}`, /too long/],
  ])("refuses %s", (tpl, msg) => {
    expect(validateClientCareTemplate(tpl)).toMatch(msg);
  });
});

describe("normalizeClientCareSettings", () => {
  it("merges a partial update over the current settings", () => {
    const r = normalizeClientCareSettings({ remind_after_min: 90, templates: { en: { message: "Hey! {owner} answers {when}." } } });
    expect(r.ok).toBe(true);
    const s = (r as { settings: typeof D }).settings;
    expect(s.remind_after_min).toBe(90);
    expect(s.templates.en.message).toBe("Hey! {owner} answers {when}.");
    expect(s.templates.es.message).toBe(D.templates.es.message);
    expect(D.remind_after_min).toBe(120); // defaults untouched
  });
  it.each([
    [{ business_days: [] }, /at least one/],
    [{ business_days: [7] }, /0-6/],
    [{ business_start: "9:00" }, /HH:MM/],
    [{ business_start: "18:00", business_end: "08:00" }, /end after/],
    [{ reply_today_until: "19:00" }, /within business hours/],
    [{ remind_after_min: 240, escalate_after_min: 120 }, /after the reminder/],
    [{ remind_after_min: 5 }, /15 to 1440/],
    [{ auto_reply_gap_hours: 0 }, /1 to 72/],
    [{ escalate_admin_ids: [] }, /1 to 5/],
    [{ auto_reply_enabled: "yes" }, /true or false/],
    [{ templates: { es: { missed_call: "Hola" } } }, /es missed call: \{owner\} is required/],
    [{ when_labels: { en: { day_morning: "next morning" } } }, /\{weekday\}/],
  ])("refuses %o", (input, msg) => {
    const r = normalizeClientCareSettings(input);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(msg);
  });
});

describe("custom business hours", () => {
  const sixDays = { ...D, business_days: [1, 2, 3, 4, 5, 6], business_start: "09:00", business_end: "17:00", reply_today_until: "16:00" };
  it("counts Saturday when it is a business day", () => {
    expect(businessMinutesBetween(la("2026-11-21T09:00:00"), la("2026-11-21T11:00:00"), sixDays)).toBe(120);
    expect(businessMinutesBetween(la("2026-11-21T09:00:00"), la("2026-11-21T11:00:00"))).toBe(0);
  });
  it("names the next business day ('Saturday morning' after Friday close; 'Monday' after Saturday)", () => {
    expect(clientCareWhen(la("2026-11-20T16:30:00"), "en", sixDays)).toBe("tomorrow morning");
    expect(clientCareWhen(la("2026-11-21T16:30:00"), "en", sixDays)).toBe("Monday morning");
    expect(clientCareWhen(la("2026-11-21T16:30:00"), "es", { ...sixDays, business_days: [1, 2, 3] })).toBe("el lunes en la mañana");
    expect(clientCareWhen(la("2026-11-18T16:30:00"), "en", { ...sixDays, business_days: [1, 3] })).toBe("Monday morning");
  });
  it("custom templates and labels flow into the text", () => {
    const s = { ...D, templates: { ...D.templates, en: { ...D.templates.en, message: "Hello[[ {first_name}]]! {owner} gets back to you {when}.[[ {away_note}]]" } } };
    expect(
      clientCareText({ kind: "message", lang: "en", firstName: "ana", owner: { name: "Lecca" }, when: "soon", away: { name: "Cesar", returnsLabel: "Wed", note: "Cesar is in Mexico." } }, s),
    ).toBe("Hello Ana! Lecca gets back to you soon. Cesar is in Mexico.");
  });
});

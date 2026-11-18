/** Holiday greetings (Nov 17, 2026): dates, text rendering, edit validation, quiet replies. Pure rules. */
import { describe, expect, it } from "vitest";
import { HOLIDAY_KEYS, holidayDate, isHolidayReplyText, renderHolidayGreeting, validateHolidayGreetingEdit } from "./index";

describe("holidayDate", () => {
  it.each([
    ["thanksgiving", 2026, "2026-11-26"],
    ["thanksgiving", 2027, "2027-11-25"],
    ["thanksgiving", 2030, "2030-11-28"],
    ["mothers_day", 2026, "2026-05-10"],
    ["mothers_day", 2027, "2027-05-09"],
    ["fathers_day", 2026, "2026-06-21"],
    ["fathers_day", 2027, "2027-06-20"],
    ["christmas", 2026, "2026-12-25"],
    ["new_year", 2027, "2027-01-01"],
    ["independence_day", 2027, "2027-07-04"],
    ["valentines", 2027, "2027-02-14"],
  ] as const)("%s %i → %s", (key, year, want) => {
    expect(holidayDate(key, year)).toBe(want);
  });
  it("Thanksgiving is always a Thursday; Mother's / Father's Day always Sundays", () => {
    for (let y = 2025; y <= 2040; y++) {
      expect(new Date(`${holidayDate("thanksgiving", y)}T12:00:00Z`).getUTCDay()).toBe(4);
      expect(new Date(`${holidayDate("mothers_day", y)}T12:00:00Z`).getUTCDay()).toBe(0);
      expect(new Date(`${holidayDate("fathers_day", y)}T12:00:00Z`).getUTCDay()).toBe(0);
    }
    expect(HOLIDAY_KEYS).toHaveLength(7);
  });
});

describe("renderHolidayGreeting", () => {
  const tpl = "Happy Thanksgiving, {{first_name}}! 🦃 From the OFG family to yours ❤️";
  it("puts the first name in (title case, first word only) and adds the STOP line", () => {
    expect(renderHolidayGreeting(tpl, "MARIA elena", "en")).toBe("Happy Thanksgiving, Maria! 🦃 From the OFG family to yours ❤️\nReply STOP to opt out.");
  });
  it("leaves the name out cleanly when there is none", () => {
    expect(renderHolidayGreeting(tpl, "", "en")).toBe("Happy Thanksgiving! 🦃 From the OFG family to yours ❤️\nReply STOP to opt out.");
    expect(renderHolidayGreeting("Feliz Navidad {{first_name}}!", null, "es")).toBe("Feliz Navidad!\nResponde STOP para no recibir mensajes.");
  });
  it("Spanish footer for Spanish texts", () => {
    expect(renderHolidayGreeting("¡Feliz Navidad, {{ first_name }}!", "josé", "es")).toBe("¡Feliz Navidad, José!\nResponde STOP para no recibir mensajes.");
  });
});

describe("validateHolidayGreetingEdit", () => {
  const d = "2099-11-26";
  it("accepts texts, an https image and a time between 08:00 and 19:59 on the holiday", () => {
    const r = validateHolidayGreetingEdit({ body_en: " Hi ", media_url: "https://cdn.example/x.png", media_content_type: "image/png", send_time: "9:30" }, d);
    expect(r).toEqual({ ok: true, set: { body_en: "Hi", media_url: "https://cdn.example/x.png", media_content_type: "image/png", send_at: "2099-11-26 09:30:00" } });
    expect(validateHolidayGreetingEdit({ media_url: null }, d)).toEqual({ ok: true, set: { media_url: null, media_content_type: null } });
  });
  it.each([
    [{ body_en: "  " }, /cannot be empty/],
    [{ body_es: "x".repeat(601) }, /too long/],
    [{ media_url: "http://insecure/x.png" }, /https/],
    [{ send_time: "07:59" }, /between 08:00 and 19:59/],
    [{ send_time: "20:00" }, /between 08:00 and 19:59/],
    [{ send_time: "nine" }, /HH:MM/],
  ])("refuses %o", (body, msg) => {
    const r = validateHolidayGreetingEdit(body as Record<string, unknown>, d);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(msg);
  });
});

describe("isHolidayReplyText (quiet replies to a holiday text)", () => {
  it.each(["Happy Thanksgiving to you too!", "Gracias igualmente 🙏", "Thank you, same to you", "❤️🦃", "", "Feliz Navidad a todos ustedes, bendiciones", "you too!!"])("quiet: %s", (t) => {
    expect(isHolidayReplyText(t)).toBe(true);
  });
  it.each(["Happy Thanksgiving! When is my next report?", "Thanks, can you call me", "gracias, cuando sale mi reporte", "I want to make a payment", "Thanks for the update"])("not quiet (needs the normal flow): %s", (t) => {
    // "Thanks for the update" is handled by the existing thank-you filter, not this one.
    expect(isHolidayReplyText(t)).toBe(t === "Thanks for the update");
  });
});

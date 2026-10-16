import { describe, expect, it } from "vitest";
import {
  applyEventMarketingTemplate,
  buildClassNote,
  buildComicNote,
  eventCompanyPublicPath,
  eventSessionPublicPath,
  pickNextEventSessionId,
  slugifyEventCode,
} from "./eventMarketing";

describe("eventMarketing helpers", () => {
  it("builds public paths", () => {
    expect(eventCompanyPublicPath("ofy")).toBe("/e/ofy");
    expect(eventSessionPublicPath("ofy", "ofy-chino-1001")).toBe(
      "/e/ofy/s/ofy-chino-1001",
    );
  });

  it("applies merge tokens", () => {
    const out = applyEventMarketingTemplate(
      "Hi {{first_name}} — {{session_title}} {{report_url}}",
      { first_name: "Ana", session_title: "Chino", report_url: "https://x.test" },
    );
    expect(out).toBe("Hi Ana — Chino https://x.test");
  });

  it("picks next upcoming session (2h grace)", () => {
    const now = new Date("2026-10-01T18:00:00-07:00");
    const id = pickNextEventSessionId(
      [
        {
          id: 1,
          starts_at: "2026-10-01T17:00:00",
          status: "scheduled",
        },
        {
          id: 2,
          starts_at: "2026-10-08T17:00:00",
          status: "scheduled",
        },
        {
          id: 3,
          starts_at: "2026-10-07T17:30:00",
          status: "cancelled",
        },
      ],
      now,
    );
    // Oct 1 5pm is within 2h grace of 6pm → still selected
    expect(id).toBe(1);
  });

  it("slugifies short codes", () => {
    expect(slugifyEventCode("OFY Chino 10/01")).toBe("ofy-chino-10-01");
  });

  it("builds class/comic notes", () => {
    expect(
      buildClassNote({ lang: "en", classLink: "https://zoom.test", scheduleNote: "Tuesdays" }),
    ).toMatch(/Zoom/);
    expect(buildComicNote({ lang: "en", offerComic: true })).toMatch(/comic/i);
    expect(buildComicNote({ lang: "en", offerComic: false })).toBe("");
  });
});

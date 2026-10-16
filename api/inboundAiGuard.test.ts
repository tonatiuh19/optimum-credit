import { describe, expect, it } from "vitest";
import {
  checkInboundAiReply,
  inboundAiDisclosurePrefix,
  inboundAiIsBillingQuestion,
  inboundAiSystemPrompt,
} from "./inboundAi";

const PORTAL = "https://www.ofgllc.com/portal/reports";
const PDF = "https://www.ofgllc.com/api/public/round-report-pdf/abc123";
const ground =
  "current_round=3 of 5; next_round_expected=2026-11-20 (11/20/2026); latest_report=Round 2 published 2026-10-02 (10/02/2026); portal_reports_link=" +
  PORTAL +
  "; FAQ: Payments are $250 per month. Call (844) 401-9494.";
const allowedUrls = [PORTAL, PDF];

describe("checkInboundAiReply (SMS AI reply guard)", () => {
  it("allows round status, the portal link and the secure PDF link", () => {
    expect(
      checkInboundAiReply(
        `You're in Round 3 of 5; your next round is expected 11/20/2026. Your Round 2 report: ${PDF}`,
        { allowedUrls, groundingText: ground },
      ),
    ).toBeNull();
    expect(checkInboundAiReply(`See your reports here: ${PORTAL}.`, { allowedUrls, groundingText: ground })).toBeNull();
  });

  it("blocks any other link or domain", () => {
    expect(checkInboundAiReply("Go to https://evil.example/login", { allowedUrls, groundingText: ground })).toBe("unapproved_link");
    expect(checkInboundAiReply("Visit annualcreditreport.com", { allowedUrls, groundingText: ground })).toBe("unapproved_link");
  });

  it("allows FAQ amounts and phone numbers, blocks invented ones", () => {
    expect(checkInboundAiReply("It's $250 per month. Questions? (844) 401-9494", { allowedUrls, groundingText: ground })).toBeNull();
    expect(checkInboundAiReply("Your balance is $1,200", { allowedUrls, groundingText: ground })).toBe("unverified_amount");
  });

  it("blocks invented scores and dates", () => {
    expect(checkInboundAiReply("Your score should reach 720", { allowedUrls, groundingText: ground })).toBe("unverified_score");
    expect(checkInboundAiReply("Round 4 starts 12/01/2026", { allowedUrls, groundingText: ground })).toBe("unverified_date");
  });

  it("blocks promises of deletions or guaranteed results (en + es)", () => {
    expect(checkInboundAiReply("We will remove that collection", { allowedUrls, groundingText: ground })).toBe("promise");
    expect(checkInboundAiReply("Le garantizamos resultados", { allowedUrls, groundingText: ground })).toBe("promise");
    expect(checkInboundAiReply("Eliminaremos esa cuenta", { allowedUrls, groundingText: ground })).toBe("promise");
  });
});

describe("billing + disclosure", () => {
  it("detects billing questions in English and Spanish", () => {
    expect(inboundAiIsBillingQuestion("When will I be billed?")).toBe(true);
    expect(inboundAiIsBillingQuestion("¿Cuándo es mi próximo pago?")).toBe(true);
    expect(inboundAiIsBillingQuestion("How do I upload my ID?")).toBe(false);
  });
  it("discloses the automated assistant and no longer hides it", () => {
    expect(inboundAiDisclosurePrefix("en")).toMatch(/automated assistant/);
    expect(inboundAiDisclosurePrefix("es")).toMatch(/Asistente automático/);
    expect(inboundAiSystemPrompt("en")).not.toMatch(/Never say you are an AI/);
    expect(inboundAiSystemPrompt("en")).toMatch(/portal_reports_link/);
  });
});

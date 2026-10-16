import { describe, expect, it } from "vitest";
import {
  WHATSAPP_DEFAULT_ASSIGNEE_PHONE_LAST10,
  WHATSAPP_MAX_BODY_CHARS,
  mapWhatsapp360ProviderStatus,
  parseWhatsapp360WebhookPayload,
  whatsapp360dialogEnabled,
  whatsappBodyWithinLimit,
  whatsappDigits,
  whatsappToE164,
} from "./whatsapp360dialog";

describe("whatsapp360dialog helpers", () => {
  it("gates on flag + API key", () => {
    expect(
      whatsapp360dialogEnabled({
        WHATSAPP_360DIALOG_ENABLED: "1",
        D360_API_KEY: "secret",
      }),
    ).toBe(true);
    expect(
      whatsapp360dialogEnabled({
        WHATSAPP_360DIALOG_ENABLED: "1",
        D360_API_KEY: "",
      }),
    ).toBe(false);
    expect(
      whatsapp360dialogEnabled({
        WHATSAPP_360DIALOG_ENABLED: "0",
        D360_API_KEY: "secret",
      }),
    ).toBe(false);
  });

  it("normalizes wa ids to E.164", () => {
    expect(whatsappDigits("+1 (951) 378-3429")).toBe("19513783429");
    expect(whatsappToE164("9513783429")).toBe("+19513783429");
    expect(whatsappToE164("19513783429")).toBe("+19513783429");
    expect(WHATSAPP_DEFAULT_ASSIGNEE_PHONE_LAST10).toBe("9513783429");
  });

  it("parses Cloud API webhook messages + statuses", () => {
    const parsed = parseWhatsapp360WebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [
                  {
                    wa_id: "15551234567",
                    profile: { name: "Alex" },
                  },
                ],
                messages: [
                  {
                    from: "15551234567",
                    id: "wamid.ABC",
                    timestamp: "1710000000",
                    type: "text",
                    text: { body: "Hola" },
                  },
                  {
                    from: "15551234567",
                    id: "wamid.IMG",
                    type: "image",
                    image: { id: "media1" },
                  },
                ],
                statuses: [
                  {
                    id: "wamid.OUT",
                    status: "delivered",
                    recipient_id: "15551234567",
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]).toMatchObject({
      providerMessageId: "wamid.ABC",
      fromE164: "+15551234567",
      textBody: "Hola",
      profileName: "Alex",
    });
    expect(parsed.messages[1].textBody).toBe("[image]");
    expect(parsed.statuses).toEqual([
      {
        providerMessageId: "wamid.OUT",
        status: "delivered",
        recipientId: "15551234567",
        errors: null,
      },
    ]);
  });

  it("maps provider statuses and enforces body limit", () => {
    expect(mapWhatsapp360ProviderStatus("READ")).toBe("read");
    expect(mapWhatsapp360ProviderStatus("accepted")).toBe("accepted");
    expect(whatsappBodyWithinLimit("hi")).toBe(true);
    expect(
      whatsappBodyWithinLimit("x".repeat(WHATSAPP_MAX_BODY_CHARS + 1)),
    ).toBe(false);
  });

  it("handles empty / malformed webhook bodies", () => {
    expect(parseWhatsapp360WebhookPayload(null)).toEqual({
      messages: [],
      statuses: [],
    });
    expect(parseWhatsapp360WebhookPayload({ entry: [] })).toEqual({
      messages: [],
      statuses: [],
    });
  });
});

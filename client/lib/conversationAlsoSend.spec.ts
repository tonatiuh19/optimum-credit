import { describe, expect, it } from "vitest";
import {
  dedupeAlsoRecipients,
  filterAlsoRecipientsForRetry,
  messageAddressesClient,
  phoneDedupeKey,
} from "./conversationAlsoSend";

describe("conversationAlsoSend", () => {
  it("phoneDedupeKey normalizes US to last 10", () => {
    expect(phoneDedupeKey("+1 (555) 123-4567")).toBe("5551234567");
    expect(phoneDedupeKey("(555) 123-4567")).toBe("5551234567");
  });

  it("phoneDedupeKey keeps full digits for international", () => {
    expect(phoneDedupeKey("+52 55 1234 5678")).toBe("525512345678");
  });

  it("dedupes US numbers across +1 and local formats", () => {
    const out = dedupeAlsoRecipients([
      { key: "a", phone: "+15551234567", label: "A" },
      { key: "b", phone: "(555) 123-4567", label: "B" },
      { key: "c", phone: "+525512345678", label: "C" },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.label)).toEqual(["A", "C"]);
  });

  it("filters failed labels for retry", () => {
    const recipients = [
      { key: "a", phone: "+15551111111", label: "Ann" },
      { key: "b", phone: "+15552222222", label: "Bob" },
    ];
    expect(filterAlsoRecipientsForRetry(recipients, ["Bob"])).toEqual([
      recipients[1],
    ]);
  });

  it("messageAddressesClient flags name merge fields and the client's first name", () => {
    expect(messageAddressesClient("Hi {{first_name}}, your report is ready", "Julianna")).toBe(true);
    expect(messageAddressesClient("Hello! Julianna, this is Lecca", "Julianna")).toBe(true);
    expect(messageAddressesClient("Hi Carlos, this is Lecca", "Carlos Jr")).toBe(true);
    expect(messageAddressesClient("hola josé, ya quedó", "Jose")).toBe(true);
    expect(messageAddressesClient("Hi Carlos, this is Lecca", "Carlos Jr")).toBe(true);
  });

  it("messageAddressesClient ignores general messages and partial matches", () => {
    expect(messageAddressesClient("Reminder: office closed Friday", "Julianna")).toBe(false);
    expect(messageAddressesClient("Carlson called", "Carl")).toBe(false);
    expect(messageAddressesClient("Hi there", "")).toBe(false);
  });

  it("messageAddressesClient skips names that are everyday words or mid-sentence mentions", () => {
    expect(messageAddressesClient("Will you send the documents today?", "Will")).toBe(false);
    expect(messageAddressesClient("Wishing you joy this season!", "Joy")).toBe(false);
    expect(messageAddressesClient("We spoke with Rosa about the file.", "Rosa")).toBe(false);
    expect(messageAddressesClient("Hope this helps", "Hope")).toBe(false);
  });

  it("messageAddressesClient still catches greetings and direct address", () => {
    expect(messageAddressesClient("Good morning Will, your report is ready", "Will")).toBe(true);
    expect(messageAddressesClient("Joy, your report is ready", "Joy")).toBe(true);
    expect(messageAddressesClient("Thanks for waiting. Rosa, please call us", "Rosa")).toBe(true);
    expect(messageAddressesClient("Buenas tardes Ángel, ya quedó", "Angel")).toBe(true);
    expect(messageAddressesClient("Hey, Ana! Quick update", "Ana")).toBe(true);
    expect(messageAddressesClient("Hi (Mary) test", "M.ry")).toBe(false);
  });
});

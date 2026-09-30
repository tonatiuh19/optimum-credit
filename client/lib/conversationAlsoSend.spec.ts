import { describe, expect, it } from "vitest";
import {
  dedupeAlsoRecipients,
  filterAlsoRecipientsForRetry,
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
});

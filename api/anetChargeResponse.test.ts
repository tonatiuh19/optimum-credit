import { describe, expect, it } from "vitest";
import { parseAnetChargeResponse } from "./index";

describe("parseAnetChargeResponse", () => {
  it("treats responseCode 1 with a transId as approved (Monterrubio Oct 7)", () => {
    expect(
      parseAnetChargeResponse({
        transactionResponse: {
          responseCode: "1",
          authCode: "00779Z",
          transId: "121858247922",
        },
        messages: { resultCode: "Ok", message: [{ code: "I00001" }] },
      }),
    ).toEqual({ ok: true, transactionId: "121858247922" });
  });

  it("explains duplicate submissions (error 11) instead of a generic decline", () => {
    const r = parseAnetChargeResponse({
      transactionResponse: {
        responseCode: "3",
        transId: "0",
        errors: {
          error: [
            {
              errorCode: "11",
              errorText: "A duplicate transaction has been submitted.",
            },
          ],
        },
      },
      messages: {
        resultCode: "Error",
        message: [{ text: "The transaction was unsuccessful." }],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/just submitted/);
  });

  it("returns the processor decline text", () => {
    const r = parseAnetChargeResponse({
      transactionResponse: {
        responseCode: "2",
        transId: "0",
        errors: {
          error: [{ errorCode: "2", errorText: "This transaction has been declined." }],
        },
      },
      messages: { resultCode: "Error" },
    });
    expect(r).toEqual({
      ok: false,
      error: "This transaction has been declined.",
    });
  });

  it("never approves when transId is missing or 0", () => {
    expect(
      parseAnetChargeResponse({ transactionResponse: { responseCode: "1" } })
        .ok,
    ).toBe(false);
    expect(parseAnetChargeResponse(null).ok).toBe(false);
  });
});

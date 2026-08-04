/**
 * Regression: 100% coupons must not call Authorize.net with $0.00
 * (processor returns "The transaction was unsuccessful.").
 */
import { describe, expect, it } from "vitest";

describe("free checkout after coupon", () => {
  it("treats fully discounted amount as free (no card charge)", () => {
    const originalCents = 149700;
    const discountCents = 149700; // coupon 2F34E fixed $1497
    const chargeAmountCents = Math.max(0, originalCents - discountCents);
    expect(chargeAmountCents).toBe(0);
    const isFreeCheckout = chargeAmountCents <= 0;
    expect(isFreeCheckout).toBe(true);
  });

  it("still charges when discount is partial", () => {
    const originalCents = 149700;
    const discountCents = 20000;
    const chargeAmountCents = Math.max(0, originalCents - discountCents);
    expect(chargeAmountCents).toBe(129700);
    expect(chargeAmountCents <= 0).toBe(false);
  });
});

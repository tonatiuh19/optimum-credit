import { describe, expect, it } from "vitest";
import { isUndeliverableNotifyEmail } from "./index";

describe("isUndeliverableNotifyEmail", () => {
  it("blocks RFC 2606 and integration-test domains", () => {
    expect(
      isUndeliverableNotifyEmail("shared-inbox-xemail-123@example.test"),
    ).toBe(true);
    expect(isUndeliverableNotifyEmail("team@example.com")).toBe(true);
    expect(isUndeliverableNotifyEmail("x@mail.test")).toBe(true);
  });

  it("allows real inboxes", () => {
    expect(isUndeliverableNotifyEmail("alerts@optimum-financial-group.com")).toBe(
      false,
    );
    expect(isUndeliverableNotifyEmail("ops@gmail.com")).toBe(false);
  });
});

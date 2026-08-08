import { describe, expect, it } from "vitest";
import { escapeLikePattern, likeContains } from "./index";

describe("escapeLikePattern / likeContains", () => {
  it("escapes %, _, and ! for ESCAPE '!'", () => {
    expect(escapeLikePattern("100%_ready!")).toBe("100!%!_ready!!");
  });

  it("wraps with percent wildcards after escaping", () => {
    expect(likeContains("a_b%c")).toBe("%a!_b!%c%");
  });

  it("leaves plain text unchanged aside from wrapping", () => {
    expect(likeContains("Jose")).toBe("%Jose%");
  });
});

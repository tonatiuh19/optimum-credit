/**
 * Friendly API errors — never surface raw MySQL/TiDB messages to clients.
 */
import { describe, expect, it } from "vitest";
import { isDuplicateKeyError, mapFriendlyError } from "./index";

describe("isDuplicateKeyError", () => {
  it("detects ER_DUP_ENTRY code", () => {
    expect(isDuplicateKeyError({ code: "ER_DUP_ENTRY", message: "x" })).toBe(
      true,
    );
  });

  it("detects errno 1062", () => {
    expect(isDuplicateKeyError({ errno: 1062 })).toBe(true);
  });

  it("detects TiDB prepared-statement Duplicate entry '?' message", () => {
    expect(
      isDuplicateKeyError({
        message: "Duplicate entry '?' for key 'admins.email'",
      }),
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isDuplicateKeyError({ code: "ER_BAD_FIELD", message: "x" })).toBe(
      false,
    );
  });
});

describe("mapFriendlyError", () => {
  it("maps duplicate email to 409 with friendly copy", () => {
    const mapped = mapFriendlyError({
      code: "ER_DUP_ENTRY",
      message: "Duplicate entry '?' for key 'admins.email'",
    });
    expect(mapped).toEqual({
      status: 409,
      error: "An account with this email already exists",
    });
  });

  it("uses duplicateLabel context when key name is missing", () => {
    const mapped = mapFriendlyError(
      { code: "ER_DUP_ENTRY", message: "Duplicate entry '?' for key 'PRIMARY'" },
      { duplicateLabel: "slug" },
    );
    expect(mapped?.status).toBe(409);
    expect(mapped?.error).toBe("This slug is already in use");
  });

  it("maps foreign key errors to 400", () => {
    const mapped = mapFriendlyError({
      code: "ER_NO_REFERENCED_ROW_2",
      message: "Cannot add or update a child row: a foreign key constraint fails",
    });
    expect(mapped).toEqual({
      status: 400,
      error: "Related record not found or still in use",
    });
  });

  it("passes through intentional HTTP errors", () => {
    const mapped = mapFriendlyError({
      status: 402,
      message: "Card declined",
    });
    expect(mapped).toEqual({ status: 402, error: "Card declined" });
  });

  it("returns null for unknown errors (global handler uses generic 500)", () => {
    expect(mapFriendlyError({ message: "boom" })).toBeNull();
  });
});

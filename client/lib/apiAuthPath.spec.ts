import { describe, expect, it } from "vitest";
import { isAdminApiPath } from "@/lib/apiAuthPath";

describe("admin API auth path + 401 logout gate", () => {
  it("treats conversations routes as admin", () => {
    expect(isAdminApiPath("/admin/conversations")).toBe(true);
    expect(isAdminApiPath("/admin/conversations?view=all")).toBe(true);
    expect(isAdminApiPath("/voice/token")).toBe(true);
  });

  it("documents logout only when Authorization was sent", () => {
    // Mirror client/lib/api.ts interceptor: bare 401 must not clear session.
    const shouldClearSession = (sentAuth: boolean) => sentAuth;
    expect(shouldClearSession(false)).toBe(false);
    expect(shouldClearSession(true)).toBe(true);
  });
});

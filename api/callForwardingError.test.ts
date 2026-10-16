import { describe, expect, it } from "vitest";
import { explainCallForwardingError } from "./index";

describe("explainCallForwardingError", () => {
  it("explains missing international permission (Angel, MX, 13227)", () => {
    expect(explainCallForwardingError("13227", "en")).toMatch(/Geo permissions/);
    expect(explainCallForwardingError("13227", "es")).toMatch(/permiso/);
  });
  it("explains invalid numbers", () => {
    expect(explainCallForwardingError("13224", "en")).toMatch(/invalid/);
  });
  it("falls back to a generic message with the code", () => {
    expect(explainCallForwardingError("99999", "en")).toMatch(/99999/);
    expect(explainCallForwardingError(null, "es")).toMatch(/falló/);
  });
});

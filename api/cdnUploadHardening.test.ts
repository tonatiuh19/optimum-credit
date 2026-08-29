/**
 * Documents CDN failure classification used by uploadToCDN (inline in index.ts).
 * Live HostGator probes are intentional outside this suite — Vitest must not call CDN.
 */
import { describe, expect, it } from "vitest";

function isTransientCdnFailure(err: unknown, status?: number): boolean {
  if (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return true;
  }
  const msg = String(
    (err as { message?: string })?.message ?? err ?? "",
  ).toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("aborted") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("socket") ||
    msg.includes("tls") ||
    msg.includes("cert")
  );
}

describe("CDN hardening classification", () => {
  it("treats HostGator-style fetch/SSL failures as transient", () => {
    expect(isTransientCdnFailure(new Error("fetch failed"))).toBe(true);
    expect(
      isTransientCdnFailure(new Error("CDN upload timed out after 15000ms")),
    ).toBe(true);
    expect(isTransientCdnFailure(new Error("unable to verify the first certificate"))).toBe(
      true,
    );
    expect(isTransientCdnFailure(undefined, 502)).toBe(true);
    expect(isTransientCdnFailure(undefined, 429)).toBe(true);
  });

  it("does not retry permanent API shape errors", () => {
    expect(
      isTransientCdnFailure(
        new Error(
          "CDN upload returned no URL: Unsupported file type: text/plain",
        ),
      ),
    ).toBe(false);
    expect(isTransientCdnFailure(undefined, 401)).toBe(false);
    expect(isTransientCdnFailure(undefined, 403)).toBe(false);
  });
});

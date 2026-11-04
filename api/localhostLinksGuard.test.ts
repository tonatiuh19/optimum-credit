/**
 * Nov 3, 2026: staff received emails with http://localhost links. Production builds links from
 * the live domain; a local server (sharing the production database and real keys) did not.
 */
import { afterEach, describe, expect, it } from "vitest";
import { productionLinks, realMessagingBlocked, resolvePublicAppUrl } from "./index";

describe("realMessagingBlocked", () => {
  it.each([
    ["vitest", { VITEST: "true", VERCEL: "1" }, "vitest"],
    ["local server", {}, "local"],
    ["local server, explicitly allowed", { LOCAL_SEND_REAL_MESSAGES: "1" }, null],
    ["local server, any other value is not allowed", { LOCAL_SEND_REAL_MESSAGES: "true" }, "local"],
    ["Vercel (production / preview)", { VERCEL: "1" }, null],
  ])("%s", (_n, env, want) => {
    expect(realMessagingBlocked(env as any)).toBe(want);
  });
});

describe("productionLinks", () => {
  it.each([
    ["http://localhost:8080/portal/onboarding/abc", "https://www.ofgllc.com/portal/onboarding/abc"],
    ['<a href="http://localhost:5173/admin/login">Log in</a>', '<a href="https://www.ofgllc.com/admin/login">Log in</a>'],
    ["https://127.0.0.1:8080/x and http://[::1]:3000/y", "https://www.ofgllc.com/x and https://www.ofgllc.com/y"],
    ["http://LOCALHOST/admin", "https://www.ofgllc.com/admin"],
  ])("%s", (input, want) => {
    expect(productionLinks(input)).toBe(want);
  });
  it("leaves real links and text alone", () => {
    const s = "Visit https://www.ofgllc.com/portal; localhost is just a word here, mylocalhost.com stays";
    expect(productionLinks(s)).toBe(s);
  });
});

describe("resolvePublicAppUrl", () => {
  const keep = { ...process.env };
  afterEach(() => {
    process.env = { ...keep };
  });
  const run = (env: Record<string, string | undefined>) => {
    for (const k of ["PUBLIC_APP_URL", "VERCEL", "VERCEL_ENV", "VERCEL_URL"]) delete process.env[k];
    Object.assign(process.env, env);
    return resolvePublicAppUrl();
  };
  it.each([
    ["production with a copied localhost setting", { VERCEL: "1", VERCEL_ENV: "production", PUBLIC_APP_URL: "http://localhost:8080" }, "https://www.ofgllc.com"],
    ["production with 127.0.0.1", { VERCEL: "1", VERCEL_ENV: "production", PUBLIC_APP_URL: "http://127.0.0.1:8080/" }, "https://www.ofgllc.com"],
    ["preview with localhost uses the preview host", { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "ofg-abc.vercel.app", PUBLIC_APP_URL: "http://localhost:8080" }, "https://ofg-abc.vercel.app"],
    ["production with the real domain (unchanged)", { VERCEL: "1", VERCEL_ENV: "production", PUBLIC_APP_URL: "https://www.ofgllc.com" }, "https://www.ofgllc.com"],
    ["local server keeps localhost (unchanged)", { PUBLIC_APP_URL: "http://localhost:8080" }, "http://localhost:8080"],
  ])("%s", (_n, env, want) => {
    expect(run(env)).toBe(want);
  });
});

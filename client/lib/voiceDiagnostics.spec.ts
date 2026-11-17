import { describe, expect, it } from "vitest";
import { describeUserAgent, twilioErrorCode } from "./voiceDiagnostics";

describe("describeUserAgent", () => {
  it.each([
    ["iPhone Safari", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", { is_mobile: true, platform: "iPhone", browser: "Safari" }],
    ["iPhone Chrome", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1", { is_mobile: true, platform: "iPhone", browser: "Chrome" }],
    ["Android Chrome", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36", { is_mobile: true, platform: "Android", browser: "Chrome" }],
    ["Mac Chrome", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", { is_mobile: false, platform: "Mac", browser: "Chrome" }],
    ["Windows Edge", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0", { is_mobile: false, platform: "Windows", browser: "Edge" }],
    ["iPad (desktop mode)", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", { is_mobile: true, platform: "iPad", browser: "Safari" }],
    ["empty", "", { is_mobile: false, platform: "Other", browser: "Other" }],
  ])("%s", (_n, ua, want) => {
    expect(describeUserAgent(ua)).toEqual(want);
  });
});

describe("twilioErrorCode", () => {
  it("reads the SDK's numeric code, nothing else", () => {
    expect(twilioErrorCode({ code: 53405, message: "ConnectionError" })).toBe(53405);
    expect(twilioErrorCode(new Error("plain"))).toBeNull();
    expect(twilioErrorCode({ code: "53405" })).toBeNull();
    expect(twilioErrorCode(null)).toBeNull();
  });
});

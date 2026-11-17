/**
 * Device context for a browser softphone event (Nov 17, 2026): which device / browser, whether the tab
 * was visible, the network type (when the browser exposes it — Safari does not) and mic permission.
 * Pure parsing is split out for tests; reading the browser never throws.
 */
export type VoiceDeviceContext = {
  is_mobile: boolean;
  platform: string;
  browser: string;
  network_type: string | null;
  visibility: string | null;
  online: boolean | null;
};

/** Platform + browser from a user-agent string. */
export function describeUserAgent(ua: string): { is_mobile: boolean; platform: string; browser: string } {
  const s = String(ua || "");
  const platform = /iPhone|iPod/.test(s)
    ? "iPhone"
    : /iPad/.test(s) || (/Macintosh/.test(s) && /Mobile\//.test(s))
      ? "iPad"
      : /Android/.test(s)
        ? "Android"
        : /Windows/.test(s)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(s)
            ? "Mac"
            : /Linux/.test(s)
              ? "Linux"
              : "Other";
  const browser = /EdgiOS|Edg\//.test(s)
    ? "Edge"
    : /CriOS|Chrome\//.test(s) && !/Chromium/.test(s)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(s)
        ? "Firefox"
        : /Safari\//.test(s)
          ? "Safari"
          : "Other";
  return { is_mobile: /iPhone|iPod|Android|Mobile/.test(s) || platform === "iPad", platform, browser };
}

export function readVoiceDeviceContext(): VoiceDeviceContext {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const ua = describeUserAgent(nav?.userAgent ?? "");
  let network_type: string | null = null;
  try {
    const c = (nav as Navigator & { connection?: { type?: string; effectiveType?: string } } | undefined)?.connection;
    network_type = c ? [c.type, c.effectiveType].filter(Boolean).join("/") || null : null;
  } catch {
    network_type = null;
  }
  return {
    ...ua,
    network_type,
    visibility: typeof document !== "undefined" ? document.visibilityState : null,
    online: typeof nav?.onLine === "boolean" ? nav.onLine : null,
  };
}

/** "granted" | "denied" | "prompt" | null (Safari may not answer the query). */
export async function readMicPermission(): Promise<string | null> {
  try {
    const p = await (navigator as Navigator).permissions?.query({ name: "microphone" as PermissionName });
    return p?.state ?? null;
  } catch {
    return null;
  }
}

/** Twilio SDK errors carry a numeric code; plain errors do not. */
export function twilioErrorCode(err: unknown): number | null {
  const c = (err as { code?: unknown } | null)?.code;
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

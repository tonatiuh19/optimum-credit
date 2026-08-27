import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNotificationSoundMuted,
  setNotificationSoundMuted,
} from "./notification-sound";

function mockLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    clear: () => store.clear(),
  });
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
  });
}

describe("notification-sound", () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists mute preference in localStorage", () => {
    expect(isNotificationSoundMuted()).toBe(false);
    setNotificationSoundMuted(true);
    expect(isNotificationSoundMuted()).toBe(true);
    setNotificationSoundMuted(false);
    expect(isNotificationSoundMuted()).toBe(false);
  });

  it("broadcasts mute changes for shell sync", () => {
    const dispatch = vi.fn();
    vi.stubGlobal("window", { dispatchEvent: dispatch });
    setNotificationSoundMuted(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ofg:notification-sound-mute" }),
    );
  });
});

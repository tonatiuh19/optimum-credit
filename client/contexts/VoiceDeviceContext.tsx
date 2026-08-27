import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";
import type { Device } from "@twilio/voice-sdk";

type VoiceDeviceContextValue = {
  /** Synchronous read — set as soon as the Device is constructed (before register). */
  getDevice: () => Device | null;
  /** Poll until GlobalVoiceManager finishes token setup or timeout. */
  waitForDevice: (timeoutMs?: number) => Promise<Device | null>;
};

const VoiceDeviceContext = createContext<VoiceDeviceContextValue | null>(null);

export function VoiceDeviceProvider({
  children,
  deviceRef,
}: {
  children: React.ReactNode;
  deviceRef: React.RefObject<Device | null>;
}) {
  const waitForDevice = useCallback(
    async (timeoutMs = 15000): Promise<Device | null> => {
      const existing = deviceRef.current;
      if (existing) return existing;
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 100));
        if (deviceRef.current) return deviceRef.current;
      }
      return null;
    },
    [deviceRef],
  );

  const getDevice = useCallback(() => deviceRef.current, [deviceRef]);

  const value = useMemo(
    () => ({ getDevice, waitForDevice }),
    [getDevice, waitForDevice],
  );

  return (
    <VoiceDeviceContext.Provider value={value}>
      {children}
    </VoiceDeviceContext.Provider>
  );
}

export function useVoiceDevice(): VoiceDeviceContextValue {
  const ctx = useContext(VoiceDeviceContext);
  if (!ctx) {
    throw new Error("useVoiceDevice must be used within VoiceDeviceProvider");
  }
  return ctx;
}

/** Safe optional hook for components that may render outside the provider. */
export function useVoiceDeviceOptional(): VoiceDeviceContextValue | null {
  return useContext(VoiceDeviceContext);
}

import React, { useEffect, useRef, useCallback, useState } from "react";
import { Device, Call } from "@twilio/voice-sdk";
import type { RealtimeChannel } from "ably";
import { getSharedAblyClient } from "@/lib/ably-client";
import api from "@/lib/api";
import { Phone, PhoneOff, PhoneIncoming } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  setDeviceStatus,
  endOutboundCall,
  resolveOutboundCallName,
  fetchVoiceToken,
  updateVoiceAvailability,
  lookupContact,
} from "@/store/slices/voiceSlice";
import VoiceCallPanel from "@/components/VoiceCallPanel";
import { VoiceDeviceProvider } from "@/contexts/VoiceDeviceContext";
import { logger } from "@/utils/logger";

/**
 * GlobalVoiceManager — mounted once inside AdminLayout when conversations_enabled
 * so the Twilio Device (identity admin_{id}) stays alive across admin pages.
 */
const GlobalVoiceManager: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const token = useAppSelector((s) => s.adminAuth.token);
  const isAvailable = useAppSelector((s) => s.voice.isAvailable);
  const outboundCall = useAppSelector((s) => s.voice.outboundCall);

  const deviceRef = useRef<Device | null>(null);
  const deviceReadyRef = useRef(false);
  const ringingCallRef = useRef<Call | null>(null);
  const ringingCallSidRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  const [ringingCall, setRingingCall] = useState<Call | null>(null);
  const [ringingPhone, setRingingPhone] = useState<string>("");
  const [ringingClientName, setRingingClientName] = useState<string | null>(
    null,
  );
  const [ringingClientId, setRingingClientId] = useState<number | null>(null);
  const [activeIncomingCall, setActiveIncomingCall] = useState<Call | null>(
    null,
  );
  const [deviceAudio, setDeviceAudio] = useState<Device["audio"] | null>(null);

  const reportAvailability = useCallback(
    (available: boolean) => {
      dispatch(updateVoiceAvailability(available));
    },
    [dispatch],
  );

  const fetchToken = useCallback(async (): Promise<string | null> => {
    try {
      return await dispatch(fetchVoiceToken()).unwrap();
    } catch {
      return null;
    }
  }, [dispatch]);

  useEffect(() => {
    busyRef.current = !!activeIncomingCall || !!outboundCall;
  }, [activeIncomingCall, outboundCall]);

  useEffect(() => {
    if (!outboundCall || outboundCall.clientName) return;
    const { phone } = outboundCall;
    dispatch(lookupContact(phone))
      .unwrap()
      .then((data) => {
        if (data.found) {
          dispatch(
            resolveOutboundCallName({
              clientName: data.client_name ?? null,
              clientId: data.client_id ?? null,
            }),
          );
        }
      })
      .catch(() => {});
  }, [outboundCall?.phone, dispatch]);

  useEffect(() => {
    if (!token) return;

    let device: Device | null = null;

    const setup = async () => {
      reportAvailability(false);
      dispatch(setDeviceStatus("connecting"));

      const voiceToken = await fetchToken();
      if (!voiceToken) {
        logger.error("[GlobalVoiceManager] Failed to fetch voice token");
        dispatch(setDeviceStatus("error"));
        return;
      }

      device = new Device(voiceToken, {
        logLevel: 1,
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        closeProtection: true,
        maxAverageBitrate: 40000,
        enableImprovedSignalingErrorPrecision: true,
        allowIncomingWhileBusy: false,
      } as ConstructorParameters<typeof Device>[1]);
      deviceRef.current = device;

      setDeviceAudio(device.audio);

      device.on("registered", () => {
        logger.info("[GlobalVoiceManager] Device registered (admin softphone)");
        dispatch(setDeviceStatus("registered"));
        reportAvailability(true);
      });

      device.on("unregistered", () => {
        logger.info("[GlobalVoiceManager] Device unregistered");
        dispatch(setDeviceStatus("idle"));
        reportAvailability(false);
      });

      device.on("error", (err) => {
        logger.error("[GlobalVoiceManager] Device error:", err);
        dispatch(setDeviceStatus("error"));
      });

      device.on("tokenAboutToExpire", async () => {
        logger.info("[GlobalVoiceManager] Token about to expire — refreshing");
        try {
          const newToken = await fetchToken();
          if (newToken) {
            device?.updateToken(newToken);
          } else {
            logger.error("[GlobalVoiceManager] Token refresh returned null");
          }
        } catch (err) {
          logger.error(
            "[GlobalVoiceManager] tokenAboutToExpire refresh failed:",
            err,
          );
        }
      });

      device.on("tokenExpired", async () => {
        logger.warn("[GlobalVoiceManager] Token expired — refreshing");
        try {
          const newToken = await fetchToken();
          if (newToken) {
            device?.updateToken(newToken);
          } else {
            logger.error(
              "[GlobalVoiceManager] Token refresh returned null after expiry",
            );
            dispatch(setDeviceStatus("error"));
          }
        } catch (err) {
          logger.error(
            "[GlobalVoiceManager] tokenExpired refresh failed:",
            err,
          );
          dispatch(setDeviceStatus("error"));
        }
      });

      device.on("incoming", (call: Call) => {
        if (ringingCallRef.current || busyRef.current) {
          logger.warn(
            "[GlobalVoiceManager] Busy — rejecting incoming call for voicemail/fallback",
          );
          call.reject();
          return;
        }

        const from =
          call.parameters?.From || call.customParameters?.get("from") || "";
        logger.info("[GlobalVoiceManager] Incoming call from:", from);
        ringingCallRef.current = call;
        ringingCallSidRef.current = call.parameters?.CallSid ?? null;
        setRingingPhone(from);
        setRingingClientName(null);
        setRingingClientId(null);
        setRingingCall(call);

        if (from && token) {
          api
            .get(
              `/conversations/lookup-contact?phone=${encodeURIComponent(from)}`,
              { headers: { Authorization: `Bearer ${token}` } },
            )
            .then(({ data }) => {
              if (data.found) {
                setRingingClientName(data.client_name ?? null);
                setRingingClientId(data.client_id ?? null);
              }
            })
            .catch(() => {});
        }

        const clearRinging = () => {
          ringingCallRef.current = null;
          ringingCallSidRef.current = null;
          setRingingCall(null);
          setRingingPhone("");
          setRingingClientName(null);
          setRingingClientId(null);
        };

        call.on("cancel", clearRinging);
        call.on("reject", clearRinging);
        call.on("disconnect", () => {
          ringingCallRef.current = null;
          setActiveIncomingCall(null);
        });
      });

      deviceReadyRef.current = true;
      if (isAvailable) {
        device.register().catch((err) => {
          logger.error("[GlobalVoiceManager] register() failed:", err);
          dispatch(setDeviceStatus("error"));
        });
      } else {
        dispatch(setDeviceStatus("idle"));
      }
    };

    setup();

    return () => {
      deviceReadyRef.current = false;
      device?.removeAllListeners();
      device?.destroy();
      deviceRef.current = null;
      setDeviceAudio(null);
      dispatch(setDeviceStatus("idle"));
      reportAvailability(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!deviceReadyRef.current || !deviceRef.current) return;
    const device = deviceRef.current;

    if (isAvailable) {
      dispatch(setDeviceStatus("connecting"));
      device.register().catch((err) => {
        logger.error("[GlobalVoiceManager] register() failed on toggle:", err);
        dispatch(setDeviceStatus("error"));
      });
    } else {
      device.unregister().catch(() => {});
      if (ringingCallRef.current) {
        ringingCallRef.current.reject();
        ringingCallRef.current = null;
        setRingingCall(null);
        setRingingPhone("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAvailable]);

  useEffect(() => {
    if (!token) return;
    let channel: RealtimeChannel | null = null;

    const connect = async () => {
      try {
        const ablyClient = await getSharedAblyClient(token);
        if (!ablyClient) return;

        channel = ablyClient.channels.get("voice:incoming");
        await channel.subscribe("call-answered", (msg) => {
          const { callSid } = (msg.data ?? {}) as { callSid?: string };
          if (
            ringingCallRef.current &&
            (!callSid || ringingCallSidRef.current === callSid)
          ) {
            logger.info(
              "[GlobalVoiceManager] Ably: call answered by another admin — dismissing ringing UI",
            );
            ringingCallRef.current.reject();
            ringingCallRef.current = null;
            ringingCallSidRef.current = null;
            setRingingCall(null);
            setRingingPhone("");
            setRingingClientName(null);
            setRingingClientId(null);
          }
        });
      } catch {
        // Twilio SDK cancel event is the fallback
      }
    };

    connect();

    return () => {
      channel?.unsubscribe("call-answered");
    };
  }, [token]);

  const handleAccept = () => {
    if (!ringingCall) return;
    const sid = ringingCallSidRef.current;
    ringingCall.accept({
      rtcConstraints: {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      },
    });
    setActiveIncomingCall(ringingCall);
    ringingCallRef.current = null;
    ringingCallSidRef.current = null;
    setRingingCall(null);

    if (sid && token) {
      api
        .post(
          "/voice/call-answered",
          { callSid: sid },
          { headers: { Authorization: `Bearer ${token}` } },
        )
        .catch(() => {});
    }
  };

  const handleDecline = () => {
    if (!ringingCall) return;
    ringingCall.reject();
    ringingCallRef.current = null;
    setRingingCall(null);
    setRingingPhone("");
    setRingingClientName(null);
    setRingingClientId(null);
  };

  const handleCloseActive = () => {
    setActiveIncomingCall(null);
    setRingingPhone("");
    setRingingClientName(null);
    setRingingClientId(null);
  };

  if (!token) return null;

  return (
    <VoiceDeviceProvider deviceRef={deviceRef}>
      {ringingCall && (
        <div className="fixed bottom-6 left-6 z-50 animate-in slide-in-from-bottom-4 duration-300">
          <div className="bg-card border border-accent/30 shadow-2xl rounded-2xl p-4 w-80 space-y-3">
            <div className="flex items-center gap-3">
              <div className="relative flex-shrink-0">
                <div className="p-3 bg-accent/10 rounded-full">
                  <PhoneIncoming className="h-5 w-5 text-accent" />
                </div>
                <span className="absolute inset-0 rounded-full animate-ping bg-accent/30 opacity-50" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {t("conversations.voice.incomingCall")}
                </p>
                {ringingClientName ? (
                  <>
                    <p className="text-sm font-medium text-accent truncate">
                      {ringingClientName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {ringingPhone || t("conversations.voice.unknownNumber")}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground truncate">
                    {ringingPhone || t("conversations.voice.unknownNumber")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1 bg-accent hover:bg-accent/90 text-accent-foreground h-9 text-sm gap-1.5"
                onClick={handleAccept}
              >
                <Phone className="h-4 w-4" />
                {t("conversations.voice.accept")}
              </Button>
              <Button
                variant="destructive"
                className="flex-1 h-9 text-sm gap-1.5"
                onClick={handleDecline}
              >
                <PhoneOff className="h-4 w-4" />
                {t("conversations.voice.decline")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {activeIncomingCall && (
        <div className="fixed bottom-6 left-6 z-50 w-80 animate-in slide-in-from-bottom-4 duration-300">
          <VoiceCallPanel
            phone={ringingPhone || t("conversations.voice.unknownNumber")}
            clientName={
              ringingClientName || ringingPhone || t("conversations.voice.client")
            }
            clientId={ringingClientId ?? undefined}
            activeCall={activeIncomingCall}
            direction="inbound"
            deviceAudio={deviceAudio}
            onClose={handleCloseActive}
          />
        </div>
      )}

      {outboundCall && (
        <div className="fixed bottom-6 right-6 z-50 w-80 shadow-2xl rounded-xl overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
          <VoiceCallPanel
            phone={outboundCall.phone}
            clientName={outboundCall.clientName}
            clientId={outboundCall.clientId}
            onClose={() => dispatch(endOutboundCall())}
          />
        </div>
      )}
    </VoiceDeviceProvider>
  );
};

export default GlobalVoiceManager;

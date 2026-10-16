import React, { useState, useEffect, useRef, useCallback } from "react";
import { Device, Call } from "@twilio/voice-sdk";
import { useAppDispatch } from "@/store/hooks";
import { logVoiceCall } from "@/store/slices/voiceSlice";
import {
  Phone,
  PhoneOff,
  PhoneMissed,
  Mic,
  MicOff,
  Volume2,
  Volume1,
  VolumeX,
  Settings2,
  X,
  Radio,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { logger } from "@/utils/logger";
import { useAppSelector } from "@/store/hooks";
import { useVoiceDeviceOptional } from "@/contexts/VoiceDeviceContext";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThreeWayCallControl } from "@/components/ThreeWayCallControl";
import { resetThreeWay } from "@/store/slices/voiceSlice";

export type CallState =
  | "idle"
  | "initializing"
  | "connecting"
  | "ringing"
  | "in-call"
  | "ending"
  | "ended"
  | "error";

interface VoiceCallPanelProps {
  /** Phone number to call (E.164 preferred) */
  phone: string;
  /** Display name shown in the panel */
  clientName?: string | null;
  clientId?: number | null;
  onClose: () => void;
  /**
   * When provided, the panel manages an already-accepted incoming call
   * instead of dialling a new outbound call.
   */
  activeCall?: Call | null;
  /** Direction to record in the call log. Defaults to "outbound". */
  direction?: "inbound" | "outbound";
  /**
   * The Twilio Device's audio helper — required for inbound calls where the
   * Device lives in GlobalVoiceManager. Outbound calls use the shared Device.
   */
  deviceAudio?: Device["audio"] | null;
}

const VoiceCallPanel: React.FC<VoiceCallPanelProps> = ({
  phone,
  clientName,
  clientId,
  onClose,
  activeCall,
  direction = "outbound",
  deviceAudio,
}) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const voiceDevice = useVoiceDeviceOptional();
  const deviceStatus = useAppSelector((s) => s.voice.deviceStatus);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Keep duration/CallSid in refs so disconnect handlers don't close over stale
  // React state (otherwise voice/log gets null CallSid → Twilio recording
  // callback can never attach recording_url).
  const durationRef = useRef(0);
  const callSidRef = useRef<string | null>(null);
  // Prevents double-logging: when the broker clicks hang-up, handleHangUp calls
  // logCall() AND callRef.current.disconnect(), which fires the "disconnect" event
  // that would call logCall() a second time — resulting in two DB rows for one call.
  const callAlreadyLoggedRef = useRef(false);

  const [callState, setCallState] = useState<CallState>(
    activeCall ? "in-call" : "idle",
  );
  const [duration, setDuration] = useState(0);
  // Forget any third caller once this call is no longer connected.
  useEffect(() => {
    if (callState !== "in-call") dispatch(resetThreeWay());
  }, [callState, dispatch]);
  const [isMuted, setIsMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [callSid, setCallSid] = useState<string | null>(null);
  const [closeCountdown, setCloseCountdown] = useState<number | null>(null);

  // Mic preemption watchdog: true when the OS has paused the browser's mic
  // input (e.g. an incoming cell-phone call on macOS/iOS preempts the audio
  // session). While preempted the customer cannot hear the banker — we show
  // a banner, mute the Twilio leg, and auto-end the call after 8 s of silence.
  const [micPreempted, setMicPreempted] = useState(false);
  const micPreemptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Device selection
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [speakerDevices, setSpeakerDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState("default");
  const [selectedSpeakerId, setSelectedSpeakerId] = useState("default");
  // Speaker volume: 0–1, persisted in localStorage
  const [speakerVolume, setSpeakerVolume] = useState<number>(() => {
    const stored = localStorage.getItem("voice_speaker_volume");
    return stored !== null ? parseFloat(stored) : 1;
  });
  const [micLevel, setMicLevel] = useState(0); // 0–100 for live mic meter
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micRafRef = useRef<number | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const supportsSinkId =
    typeof (document.createElement("audio") as any).setSinkId === "function";

  const formattedDuration = `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`;

  // Live microphone level meter — shows the broker whether their mic is picking up audio.
  // Uses the Web Audio API to read RMS volume from the active input stream.
  const stopMicMeter = useCallback(() => {
    if (micRafRef.current) {
      cancelAnimationFrame(micRafRef.current);
      micRafRef.current = null;
    }
    micAnalyserRef.current = null;
    // Stop all tracks so the browser releases the OS mic indicator
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micAudioCtxRef.current?.close();
    micAudioCtxRef.current = null;
    setMicLevel(0);
  }, []);

  const startMicMeter = useCallback(
    async (deviceId: string) => {
      // Always stop the previous meter first so we don't leak streams
      stopMicMeter();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio:
            deviceId !== "default"
              ? {
                  deviceId: { exact: deviceId },
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                }
              : {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                },
        });
        micStreamRef.current = stream;
        const ctx = new AudioContext();
        micAudioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        micAnalyserRef.current = analyser;
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const rms = Math.sqrt(
            data.reduce((s, v) => s + v * v, 0) / data.length,
          );
          setMicLevel(Math.min(100, Math.round((rms / 128) * 100)));
          micRafRef.current = requestAnimationFrame(tick);
        };
        micRafRef.current = requestAnimationFrame(tick);
      } catch {
        // Mic meter is cosmetic — don't block the call
      }
    },
    [stopMicMeter],
  );
  const getAudioHelper = useCallback(
    () => deviceAudio ?? deviceRef.current?.audio ?? null,
    [deviceAudio],
  );

  // Pre-call: enumerate audio devices and start mic meter preview for the settings screen.
  // We run this once on mount for outbound calls so the user sees real device labels
  // and a live mic level bar before clicking "Start Call".
  useEffect(() => {
    if (activeCall) return; // inbound calls skip the pre-call screen
    const setup = async () => {
      try {
        // getUserMedia (inside startMicMeter) grants mic permission so that
        // enumerateDevices returns real human-readable device labels.
        await startMicMeter("default");
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicDevices(devices.filter((d) => d.kind === "audioinput"));
        setSpeakerDevices(devices.filter((d) => d.kind === "audiooutput"));
      } catch {
        // Mic permission denied — selectors will fall back to showing "Default"
      }
    };
    setup();
    return () => stopMicMeter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enumerate available audio devices and keep the list live while the call is active.
  // Bluetooth devices (AirPods, etc.) fire a 'devicechange' event when they connect —
  // we re-enumerate immediately so they appear in the picker without a page reload.
  // If the OS switches the default input (e.g. AirPods just connected and became the
  // new default), we also transparently re-apply the currently selected device so the
  // Twilio stream stays on whatever the user picked.
  useEffect(() => {
    if (callState !== "in-call") return;

    const enumerate = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          setMicDevices(devices.filter((d) => d.kind === "audioinput"));
          setSpeakerDevices(devices.filter((d) => d.kind === "audiooutput"));
        })
        .catch(() => {});
    };

    const handleDeviceChange = () => {
      enumerate();
      // Re-apply the selected input device so Twilio doesn't silently stay
      // on the old one after the OS switches defaults (common with AirPods).
      const audio = getAudioHelper();
      if (audio) {
        audio.setInputDevice(selectedMicId).catch(() => {});
      }
    };

    enumerate();
    startMicMeter(selectedMicId);
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      stopMicMeter();
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, [callState, getAudioHelper, selectedMicId, startMicMeter, stopMicMeter]);

  // ── Mic preemption watchdog ─────────────────────────────────────────
  // Watches the active microphone MediaStreamTrack while in-call. When the
  // OS preempts the mic (most commonly an incoming cell call on macOS/iOS),
  // the track fires "mute" and audio output is silenced. We:
  //   1. Show a red banner so the banker knows the customer can't hear them.
  //   2. Mute the Twilio call leg so any junk noise (when the OS releases the
  //      track mid-cell-conversation) doesn't bleed in.
  //   3. After 8 s of sustained loss, hang up — the customer is better off
  //      reaching voicemail than listening to silence.
  // If the mic returns within the window, the banner clears and we restore
  // the previous mute state.
  useEffect(() => {
    if (callState !== "in-call") return;
    const stream = micStreamRef.current;
    const track = stream?.getAudioTracks()?.[0];
    if (!track) return;

    let preMuteState = isMuted;

    const onMute = () => {
      logger.warn(
        "[VoiceCallPanel] Mic preempted by OS — caller is hearing silence",
      );
      setMicPreempted(true);
      preMuteState = isMuted;
      // Force-mute Twilio leg so we don't emit garbage audio.
      try {
        callRef.current?.mute(true);
      } catch {
        /* noop */
      }
      // Auto-hangup after 8s if mic doesn't come back.
      if (micPreemptTimeoutRef.current) {
        clearTimeout(micPreemptTimeoutRef.current);
      }
      micPreemptTimeoutRef.current = setTimeout(() => {
        logger.warn(
          "[VoiceCallPanel] Mic still unavailable after 8s — ending call",
        );
        try {
          callRef.current?.disconnect();
        } catch {
          /* noop */
        }
      }, 8000);
    };

    const onUnmute = () => {
      logger.info("[VoiceCallPanel] Mic restored");
      setMicPreempted(false);
      if (micPreemptTimeoutRef.current) {
        clearTimeout(micPreemptTimeoutRef.current);
        micPreemptTimeoutRef.current = null;
      }
      // Restore the user's intended mute state.
      try {
        callRef.current?.mute(preMuteState);
      } catch {
        /* noop */
      }
    };

    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
    // Some platforms mark the track as muted before listeners attach.
    if (track.muted) onMute();

    return () => {
      track.removeEventListener("mute", onMute);
      track.removeEventListener("unmute", onUnmute);
      if (micPreemptTimeoutRef.current) {
        clearTimeout(micPreemptTimeoutRef.current);
        micPreemptTimeoutRef.current = null;
      }
    };
    // We intentionally re-run when the meter restarts (selectedMicId change)
    // so we attach to the fresh track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callState, selectedMicId]);

  const handleMicChange = useCallback(
    async (deviceId: string) => {
      setSelectedMicId(deviceId);
      // Always restart the mic meter so the level bar reflects the new device,
      // both in the pre-call settings screen and during an active call.
      startMicMeter(deviceId);
      const audio = getAudioHelper();
      if (!audio) return; // pre-call: no Twilio device yet, meter restart is enough
      try {
        await audio.setInputDevice(deviceId);
      } catch (e) {
        logger.error("[VoiceCallPanel] Failed to set input device:", e);
      }
    },
    [getAudioHelper, startMicMeter],
  );

  const handleSpeakerChange = useCallback(
    async (deviceId: string) => {
      setSelectedSpeakerId(deviceId);
      const audio = getAudioHelper();
      if (!audio) return;
      try {
        await audio.speakerDevices.set([deviceId]);
      } catch (e) {
        logger.error("[VoiceCallPanel] Failed to set speaker device:", e);
      }
    },
    [getAudioHelper],
  );

  // Apply speaker volume to all <audio> elements Twilio creates.
  // Twilio injects hidden <audio> elements into the DOM for playback;
  // setting .volume directly is the only reliable cross-browser way to boost them.
  const applyVolumeToAudioElements = useCallback((vol: number) => {
    document.querySelectorAll<HTMLAudioElement>("audio").forEach((el) => {
      el.volume = vol;
    });
  }, []);

  const handleSpeakerVolumeChange = useCallback(
    (vol: number) => {
      setSpeakerVolume(vol);
      localStorage.setItem("voice_speaker_volume", String(vol));
      applyVolumeToAudioElements(vol);
    },
    [applyVolumeToAudioElements],
  );

  // Re-apply stored volume whenever call becomes active
  // (Twilio creates its audio elements at connection time)
  useEffect(() => {
    if (callState === "in-call") {
      applyVolumeToAudioElements(speakerVolume);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callState]);

  // Log the call to the server after it ends
  const logCall = useCallback(
    async (status: string, durationSec: number, sid?: string | null) => {
      // Guard: ensure we log exactly once per call regardless of how many
      // events fire (handleHangUp + disconnect event both call logCall).
      if (callAlreadyLoggedRef.current) return;
      callAlreadyLoggedRef.current = true;
      try {
        await dispatch(
          logVoiceCall({
            phone,
            duration: durationSec,
            call_status: status,
            call_sid: sid ?? undefined,
            client_id: clientId ?? undefined,
            client_name: clientName ?? undefined,
            direction,
          }),
        );
      } catch (err) {
        logger.error("[VoiceCallPanel] Failed to log call:", err);
      }
    },
    [phone, clientId, clientName, direction, dispatch],
  );

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    durationRef.current = 0;
    setDuration(0);
    timerRef.current = setInterval(() => {
      durationRef.current += 1;
      setDuration(durationRef.current);
    }, 1000);
  }, [stopTimer]);

  const rememberCallSid = useCallback((sid: string | null | undefined) => {
    const next = sid ? String(sid) : null;
    callSidRef.current = next;
    setCallSid(next);
  }, []);

  /** Prefer live Twilio params — never trust a stale closed-over callSid state. */
  const resolveCallSid = useCallback((fallback?: string | null) => {
    return (
      callRef.current?.parameters?.CallSid ||
      fallback ||
      callSidRef.current ||
      null
    );
  }, []);

  const cleanupDevice = useCallback(() => {
    stopTimer();
    stopMicMeter();
    if (callRef.current) {
      callRef.current.removeAllListeners();
      callRef.current = null;
    }
    deviceRef.current = null;
  }, [stopTimer, stopMicMeter]);

  const handleHangUp = useCallback(
    (status = "completed") => {
      setCallState("ending");
      stopTimer();
      const sid = resolveCallSid(callSid);
      const dur = durationRef.current;
      if (callRef.current) {
        callRef.current.disconnect();
      }
      logCall(status, dur, sid).finally(() => {
        cleanupDevice();
        setCallState("ended");
      });
    },
    [callSid, logCall, stopTimer, cleanupDevice, resolveCallSid],
  );

  const initiateCall = useCallback(async () => {
    setCallState("initializing");
    setErrorMsg(null);
    callAlreadyLoggedRef.current = false;

    try {
      if (!voiceDevice) {
        throw new Error(
          "Voice system is not ready. Refresh the page and try again.",
        );
      }

      const device =
        voiceDevice.getDevice() ?? (await voiceDevice.waitForDevice(15000));
      if (!device) {
        throw new Error(
          deviceStatus === "error"
            ? "Voice connection failed. Check your network or refresh the page."
            : "Voice system is still connecting. Wait a moment and try again.",
        );
      }

      deviceRef.current = device;

      if (device.state !== Device.State.Registered) {
        await device.register();
      }

      const preCallAudio = device.audio;
      if (preCallAudio) {
        if (selectedMicId !== "default") {
          await preCallAudio.setInputDevice(selectedMicId).catch(() => {});
        }
        if (supportsSinkId && selectedSpeakerId !== "default") {
          await preCallAudio.speakerDevices
            .set([selectedSpeakerId])
            .catch(() => {});
        }
      }

      setCallState("connecting");

      const call = await device.connect({
        params: { To: phone },
        rtcConstraints: {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        },
      });
      callRef.current = call;

      call.on("ringing", () => setCallState("ringing"));

      call.on("accept", async (c: Call) => {
        rememberCallSid(c.parameters?.CallSid);
        setCallState("in-call");
        startTimer();

        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          setMicDevices(devices.filter((d) => d.kind === "audioinput"));
          setSpeakerDevices(devices.filter((d) => d.kind === "audiooutput"));
        } catch {
          // Non-fatal
        }
      });

      call.on("disconnect", () => {
        stopTimer();
        setCallState("ended");
        logCall(
          "completed",
          durationRef.current,
          resolveCallSid(call.parameters?.CallSid),
        ).finally(cleanupDevice);
      });

      call.on("cancel", () => {
        stopTimer();
        setCallState("ended");
        logCall(
          "no-answer",
          durationRef.current,
          resolveCallSid(call.parameters?.CallSid),
        ).finally(cleanupDevice);
      });

      call.on("error", (err: Error) => {
        logger.error("[VoiceCallPanel] Call error:", err);
        setErrorMsg(err.message || "Call error");
        stopTimer();
        setCallState("error");
        logCall(
          "failed",
          durationRef.current,
          resolveCallSid(call.parameters?.CallSid),
        ).finally(cleanupDevice);
      });
    } catch (err: any) {
      logger.error("[VoiceCallPanel] Failed to initiate call:", err);
      setErrorMsg(err?.message || "Failed to start call");
      setCallState("error");
      cleanupDevice();
    }
  }, [
    voiceDevice,
    deviceStatus,
    phone,
    selectedMicId,
    selectedSpeakerId,
    supportsSinkId,
    startTimer,
    stopTimer,
    cleanupDevice,
    logCall,
    rememberCallSid,
    resolveCallSid,
  ]);

  // Auto-start call when component mounts (outbound only)
  useEffect(() => {
    if (activeCall) {
      // Incoming call already accepted — wire up event listeners & start timer
      callAlreadyLoggedRef.current = false; // Reset for this new call leg
      callRef.current = activeCall;
      rememberCallSid(activeCall.parameters?.CallSid);
      startTimer();

      activeCall.on("disconnect", () => {
        stopTimer();
        setCallState("ended");
        logCall(
          "completed",
          durationRef.current,
          resolveCallSid(activeCall.parameters?.CallSid),
        ).finally(cleanupDevice);
      });

      activeCall.on("cancel", () => {
        stopTimer();
        setCallState("ended");
        logCall(
          "no-answer",
          durationRef.current,
          resolveCallSid(activeCall.parameters?.CallSid),
        ).finally(cleanupDevice);
      });

      activeCall.on("error", (err: Error) => {
        logger.error("[VoiceCallPanel] Incoming call error:", err);
        setErrorMsg(err.message || "Call error");
        stopTimer();
        setCallState("error");
        logCall(
          "failed",
          durationRef.current,
          resolveCallSid(activeCall.parameters?.CallSid),
        ).finally(cleanupDevice);
      });

      return () => {
        stopTimer();
      };
    }

    // Outbound: stay in the pre-call settings screen. User clicks "Start Call" to dial.
    return () => {
      cleanupDevice();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-close panel 5 seconds after call ends
  useEffect(() => {
    if (callState !== "ended") return;
    setCloseCountdown(5);
    const interval = setInterval(() => {
      setCloseCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    const timeout = setTimeout(() => {
      onClose();
    }, 5000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [callState, onClose]);

  const toggleMute = () => {
    if (callRef.current) {
      const newMuted = !isMuted;
      callRef.current.mute(newMuted);
      setIsMuted(newMuted);
    }
  };

  const getStateLabel = (): string => {
    switch (callState) {
      case "initializing":
        return "Setting up…";
      case "connecting":
        return "Connecting…";
      case "ringing":
        return "Ringing…";
      case "in-call":
        return formattedDuration;
      case "ending":
        return "Ending call…";
      case "ended":
        return "Call ended";
      case "error":
        return "Error";
      default:
        return "";
    }
  };

  const stateColor: Record<CallState, string> = {
    idle: "bg-background",
    initializing: "bg-amber-50 border-amber-200",
    connecting: "bg-amber-50 border-amber-200",
    ringing: "bg-amber-50 border-amber-200",
    "in-call": "bg-green-50 border-green-200",
    ending: "bg-muted border-border",
    ended: "bg-muted border-border",
    error: "bg-red-50 border-red-200",
  };

  // Resolved display labels for the currently selected devices
  const selectedMicLabel =
    micDevices.find((d) => d.deviceId === selectedMicId)?.label ||
    "System Default";
  const selectedSpeakerLabel =
    speakerDevices.find((d) => d.deviceId === selectedSpeakerId)?.label ||
    "System Default";

  return (
    <div
      className={cn(
        "border rounded-xl p-4 space-y-4 transition-all duration-300",
        stateColor[callState],
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "p-2 rounded-full",
              callState === "in-call"
                ? "bg-green-100"
                : callState === "error"
                  ? "bg-red-100"
                  : "bg-primary/10",
            )}
          >
            {callState === "error" ? (
              <PhoneMissed className="h-4 w-4 text-red-500" />
            ) : callState === "ended" ? (
              <PhoneOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Phone
                className={cn(
                  "h-4 w-4",
                  callState === "in-call"
                    ? "text-green-600 animate-pulse"
                    : "text-primary",
                )}
              />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {clientName || phone}
            </p>
            <p className="text-xs text-muted-foreground">{phone}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            if (
              callState === "in-call" ||
              callState === "ringing" ||
              callState === "connecting"
            ) {
              handleHangUp();
            } else {
              onClose();
            }
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Status label — hidden in idle (pre-call) state */}
      {callState !== "idle" && (
        <div className="flex items-center justify-center py-2">
          <Badge
            variant="outline"
            className={cn(
              "text-sm px-4 py-1 font-mono",
              callState === "in-call" &&
                "bg-green-100 text-green-700 border-green-300",
              callState === "error" && "bg-red-100 text-red-600 border-red-200",
              (callState === "connecting" || callState === "ringing") &&
                "bg-amber-100 text-amber-700 border-amber-300",
            )}
          >
            {getStateLabel()}
          </Badge>
        </div>
      )}

      {errorMsg && (
        <p className="text-xs text-red-600 text-center bg-red-50 rounded px-3 py-2">
          {errorMsg}
        </p>
      )}

      {/* Mic preemption banner — shows when the OS has paused the browser's
          microphone (most often: an incoming cell-phone call on macOS/iOS). */}
      {micPreempted && callState === "in-call" && (
        <div className="flex items-start gap-2 text-xs bg-red-50 border border-red-200 rounded px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <MicOff className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 leading-snug">
            <p className="font-semibold text-red-700">Microphone unavailable</p>
            <p className="text-red-600/90">
              Another app (likely a phone call) is using your mic. The caller
              can't hear you. Call will end automatically if not restored.
            </p>
          </div>
        </div>
      )}

      {/* Pre-call settings screen (Teams-style) — keep visible while initializing */}
      {(callState === "idle" || callState === "initializing") && (
        <div className="space-y-3 relative">
          {callState === "initializing" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span>Connecting voice…</span>
              </div>
            </div>
          )}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Settings2 className="h-3 w-3" />
              Audio Settings
            </p>

            {/* Microphone */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Mic className="h-3.5 w-3.5" />
                Microphone
              </Label>
              <Select value={selectedMicId} onValueChange={handleMicChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="System Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">System Default</SelectItem>
                  {micDevices
                    .filter((d) => d.deviceId !== "default")
                    .map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {/* Live mic level bar */}
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  {micLevel > 5 ? (
                    <>
                      <Mic className="h-2.5 w-2.5 text-green-500" /> Mic active
                    </>
                  ) : (
                    <>
                      <MicOff className="h-2.5 w-2.5 text-muted-foreground" />{" "}
                      Speak to test
                    </>
                  )}
                </p>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-75",
                      micLevel > 60
                        ? "bg-green-500"
                        : micLevel > 20
                          ? "bg-green-400"
                          : "bg-muted-foreground/30",
                    )}
                    style={{ width: `${micLevel}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Speaker */}
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5" />
                Speaker
              </Label>
              {supportsSinkId ? (
                <Select
                  value={selectedSpeakerId}
                  onValueChange={handleSpeakerChange}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="System Default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">System Default</SelectItem>
                    {speakerDevices
                      .filter((d) => d.deviceId !== "default")
                      .map((d) => (
                        <SelectItem key={d.deviceId} value={d.deviceId}>
                          {d.label || `Speaker ${d.deviceId.slice(0, 6)}`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Speaker selection not supported in this browser.
                </p>
              )}
              {/* Volume slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                    {speakerVolume === 0 ? (
                      <VolumeX className="h-3 w-3" />
                    ) : speakerVolume < 0.5 ? (
                      <Volume1 className="h-3 w-3" />
                    ) : (
                      <Volume2 className="h-3 w-3" />
                    )}
                    Volume
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    {Math.round(speakerVolume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={speakerVolume}
                  onChange={(e) =>
                    handleSpeakerVolumeChange(parseFloat(e.target.value))
                  }
                  className="w-full h-1.5 accent-primary cursor-pointer"
                />
                {speakerVolume < 0.5 && speakerVolume > 0 && (
                  <p className="text-[10px] text-amber-600 flex items-center gap-1">
                    <Volume1 className="h-3 w-3" />
                    Volume is low
                  </p>
                )}
              </div>
            </div>

            {/* Quality indicator badges */}
            <div className="flex items-center gap-3 border-t pt-2 flex-wrap">
              <span className="text-[10px] flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-3 w-3" /> HD Audio
              </span>
              <span className="text-[10px] flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-3 w-3" /> Echo Cancel
              </span>
              <span className="text-[10px] flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-3 w-3" /> Noise Reduction
              </span>
            </div>
          </div>

          {/* Call button with settings summary tooltip */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white gap-2 h-10"
                  onClick={initiateCall}
                  disabled={
                    callState === "initializing" || deviceStatus === "error"
                  }
                >
                  <Phone className="h-4 w-4" />
                  Start Call
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="center"
                className="max-w-[220px] p-3"
              >
                <div className="space-y-1.5 text-xs">
                  <p className="flex items-center gap-2">
                    <Mic className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{selectedMicLabel}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Volume2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{selectedSpeakerLabel}</span>
                    <span className="shrink-0 text-muted-foreground">
                      · {Math.round(speakerVolume * 100)}%
                    </span>
                  </p>
                  <p className="flex items-center gap-1.5 text-green-500 border-t pt-1.5">
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    HD · Echo Cancel · Noise Reduction
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Controls */}
      {(callState === "in-call" ||
        callState === "ringing" ||
        callState === "connecting") && (
        <div className="flex items-center justify-center gap-3">
          {/* Mute */}
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "h-10 w-10 rounded-full transition-colors",
              isMuted && "bg-amber-100 border-amber-300 text-amber-700",
            )}
            onClick={toggleMute}
            disabled={callState !== "in-call"}
            title={
              isMuted
                ? t("conversations.voice.unmute")
                : t("conversations.voice.mute")
            }
          >
            {isMuted ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>

          {/* Add caller (three-way) — only once connected */}
          {callState === "in-call" && <ThreeWayCallControl callSid={callSid} />}

          {/* Hang Up */}
          <Button
            variant="destructive"
            size="icon"
            className="h-12 w-12 rounded-full shadow-md"
            onClick={() => handleHangUp()}
            title={t("conversations.voice.hangUp")}
          >
            <PhoneOff className="h-5 w-5" />
          </Button>

          {/* Audio device settings */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-full transition-colors relative"
                title="Audio settings"
                disabled={callState !== "in-call"}
              >
                <Settings2 className="h-4 w-4" />
                {/* Green dot when mic is picking up sound */}
                {micLevel > 5 && (
                  <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-green-500 border border-background" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              className="w-72 space-y-4 p-4"
            >
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Audio Settings
              </p>

              {/* Microphone */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Mic className="h-3.5 w-3.5" />
                  Microphone
                </Label>
                <Select
                  value={selectedMicId}
                  onValueChange={handleMicChange}
                  disabled={micDevices.length === 0}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    {micDevices.length === 0 ? (
                      <SelectItem value="default">Default</SelectItem>
                    ) : (
                      micDevices.map((d) => (
                        <SelectItem key={d.deviceId} value={d.deviceId}>
                          {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {/* Live mic level bar */}
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    {micLevel > 5 ? (
                      <>
                        <Mic className="h-2.5 w-2.5 text-green-500" /> Mic
                        active
                      </>
                    ) : (
                      <>
                        <MicOff className="h-2.5 w-2.5 text-muted-foreground" />{" "}
                        Speak to test
                      </>
                    )}
                  </p>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-75",
                        micLevel > 60
                          ? "bg-green-500"
                          : micLevel > 20
                            ? "bg-green-400"
                            : "bg-muted-foreground/30",
                      )}
                      style={{ width: `${micLevel}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Speaker */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Volume2 className="h-3.5 w-3.5" />
                  Speaker
                </Label>
                {supportsSinkId ? (
                  <Select
                    value={selectedSpeakerId}
                    onValueChange={handleSpeakerChange}
                    disabled={speakerDevices.length === 0}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Default" />
                    </SelectTrigger>
                    <SelectContent>
                      {speakerDevices.length === 0 ? (
                        <SelectItem value="default">Default</SelectItem>
                      ) : (
                        speakerDevices.map((d) => (
                          <SelectItem key={d.deviceId} value={d.deviceId}>
                            {d.label || `Speaker ${d.deviceId.slice(0, 6)}`}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Speaker selection not supported in this browser.
                  </p>
                )}
              </div>

              {/* Speaker volume slider */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    {speakerVolume === 0 ? (
                      <VolumeX className="h-3.5 w-3.5" />
                    ) : speakerVolume < 0.5 ? (
                      <Volume1 className="h-3.5 w-3.5" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" />
                    )}
                    Speaker Volume
                  </span>
                  <span className="text-muted-foreground font-normal">
                    {Math.round(speakerVolume * 100)}%
                  </span>
                </Label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={speakerVolume}
                  onChange={(e) =>
                    handleSpeakerVolumeChange(parseFloat(e.target.value))
                  }
                  className="w-full h-1.5 accent-primary cursor-pointer"
                />
                {speakerVolume < 0.5 && (
                  <p className="text-[10px] text-amber-600 flex items-center gap-1">
                    <Volume1 className="h-3 w-3" />
                    Volume is low — try raising it or check your OS settings
                  </p>
                )}
              </div>

              {/* Quality hint */}
              <p className="text-[10px] text-muted-foreground flex items-start gap-1.5 border-t pt-2">
                <Radio className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
                For best quality, use a headset. Calls use HD Opus audio when
                both sides support it.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Ended / Error actions */}
      {(callState === "ended" || callState === "error") && (
        <div className="flex justify-center gap-2">
          {callState === "error" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCallState("idle");
                setErrorMsg(null);
                setDuration(0);
                initiateCall();
              }}
            >
              <Phone className="h-3.5 w-3.5 mr-1.5" />
              Retry
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            {callState === "ended" && closeCountdown !== null
              ? `Close (${closeCountdown})`
              : "Close"}
          </Button>
        </div>
      )}
    </div>
  );
};

export default VoiceCallPanel;

import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import type { RootState } from "../index";
import type { ThreeWayPresetsResponse, ThreeWayStartResponse } from "@shared/api";

function authHeaders(getState: () => unknown) {
  const token = (getState() as RootState).adminAuth.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Async thunks ──────────────────────────────────────────────────────────────

export const fetchVoiceToken = createAsyncThunk(
  "voice/fetchToken",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { data } = await api.post<{ token: string }>(
        "/voice/token",
        {},
        { headers: authHeaders(getState) },
      );
      return data.token;
    } catch (error: unknown) {
      const ax = error as {
        response?: { status?: number; data?: Record<string, string> };
      };
      const data = ax.response?.data;
      const message =
        data?.detail ||
        data?.headline ||
        data?.message ||
        (ax.response?.status === 402
          ? "Voice minutes quota exceeded or billing action required"
          : "Failed to fetch voice token");
      return rejectWithValue(message);
    }
  },
);

interface VoiceLogPayload {
  phone: string;
  duration: number;
  call_status: string;
  call_sid?: string;
  client_id?: number;
  client_name?: string;
  direction?: string;
}

export const logVoiceCall = createAsyncThunk(
  "voice/logCall",
  async (payload: VoiceLogPayload, { getState, rejectWithValue }) => {
    try {
      await api.post("/voice/log", payload, {
        headers: authHeaders(getState),
      });
      return true;
    } catch (error: unknown) {
      return rejectWithValue(
        formatAxiosError(error, "Failed to log call"),
      );
    }
  },
);

export const fetchAblyToken = createAsyncThunk(
  "voice/fetchAblyToken",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { data } = await api.get("/admin/me/ably-token", {
        headers: authHeaders(getState),
      });
      return data;
    } catch (error: unknown) {
      return rejectWithValue(
        formatAxiosError(error, "Failed to fetch Ably token"),
      );
    }
  },
);

export const updateVoiceAvailability = createAsyncThunk(
  "voice/updateAvailability",
  async (available: boolean, { getState }) => {
    api
      .post(
        "/voice/availability",
        { available },
        { headers: authHeaders(getState) },
      )
      .catch(() => {});
    return available;
  },
);

export const lookupContact = createAsyncThunk(
  "voice/lookupContact",
  async (phone: string, { getState, rejectWithValue }) => {
    try {
      const { data } = await api.get(
        `/conversations/lookup-contact?phone=${encodeURIComponent(phone)}`,
        { headers: authHeaders(getState) },
      );
      return data as {
        found: boolean;
        client_name?: string | null;
        client_id?: number | null;
      };
    } catch {
      return rejectWithValue("Lookup failed");
    }
  },
);

export const checkRecordingUrl = createAsyncThunk(
  "voice/checkRecordingUrl",
  async (sid: string, { getState, rejectWithValue }) => {
    try {
      const { data } = await api.get(`/voice/recording-check/${sid}`, {
        headers: authHeaders(getState),
      });
      return data as {
        ready: boolean;
        recording_url?: string;
        recording_duration?: number | null;
        sid: string;
      };
    } catch {
      return rejectWithValue("Recording check failed");
    }
  },
);

export const fetchCallForwardingSettings = createAsyncThunk(
  "voice/fetchCallForwardingSettings",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { data } = await api.get("/voice/call-forwarding", {
        headers: authHeaders(getState),
      });
      return data as {
        success: boolean;
        call_forwarding_enabled: boolean;
        call_forwarding_number: string | null;
      };
    } catch (error: unknown) {
      return rejectWithValue(
        formatAxiosError(error, "Failed to load call-forwarding settings"),
      );
    }
  },
);

export const saveCallForwardingSettings = createAsyncThunk(
  "voice/saveCallForwardingSettings",
  async (
    payload: { enabled: boolean; phone: string },
    { getState, rejectWithValue },
  ) => {
    try {
      const { data } = await api.put(
        "/voice/call-forwarding",
        { enabled: payload.enabled, phone: payload.phone },
        { headers: authHeaders(getState) },
      );
      return data;
    } catch (error: unknown) {
      return rejectWithValue(
        formatAxiosError(error, "Failed to save call-forwarding settings"),
      );
    }
  },
);

export interface VoicemailSettingsResponse {
  success: boolean;
  admin: {
    voicemail_enabled: boolean | null;
    voicemail_greeting_text: string | null;
    voicemail_greeting_url: string | null;
    has_personal_line: boolean;
  };
  tenant: {
    voicemail_enabled: boolean;
    voicemail_greeting_text: string | null;
    voicemail_greeting_url: string | null;
    voicemail_max_seconds: number;
    voicemail_transcribe: boolean;
  };
}

export const fetchVoicemailSettings = createAsyncThunk(
  "voice/fetchVoicemailSettings",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { data } = await api.get<VoicemailSettingsResponse>(
        "/voice/voicemail-settings",
        { headers: authHeaders(getState) },
      );
      return data;
    } catch (error: unknown) {
      return rejectWithValue(
        formatAxiosError(error, "Failed to load voicemail settings"),
      );
    }
  },
);

export const saveVoicemailSettings = createAsyncThunk(
  "voice/saveVoicemailSettings",
  async (
    payload: {
      enabled?: boolean | null;
      greeting_text?: string | null;
      greeting_url?: string | null;
    },
    { getState, rejectWithValue },
  ) => {
    try {
      const { data } = await api.put(
        "/voice/voicemail-settings",
        payload,
        { headers: authHeaders(getState) },
      );
      return data as { success: boolean; error?: string };
    } catch (error: unknown) {
      return rejectWithValue(
        formatAxiosError(error, "Failed to save voicemail settings"),
      );
    }
  },
);

export const saveTenantVoicemailSettings = createAsyncThunk(
  "voice/saveTenantVoicemailSettings",
  async (
    payload: {
      enabled?: boolean;
      greeting_text?: string | null;
      greeting_url?: string | null;
      max_seconds?: number;
      transcribe?: boolean;
    },
    { getState, rejectWithValue },
  ) => {
    try {
      const { data } = await api.put(
        "/voice/voicemail-settings/tenant",
        payload,
        { headers: authHeaders(getState) },
      );
      return data as { success: boolean; error?: string };
    } catch (error: unknown) {
      return rejectWithValue(
        formatAxiosError(error, "Failed to save tenant voicemail settings"),
      );
    }
  },
);

export const fixCallSetup = createAsyncThunk(
  "voice/fixCallSetup",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { data } = await api.post(
        "/voice/fix-call-setup",
        {},
        { headers: authHeaders(getState) },
      );
      return data;
    } catch (error: unknown) {
      return rejectWithValue(
        formatAxiosError(error, "Failed to sync voice configuration"),
      );
    }
  },
);

// ── Three-way calls ("Add caller") ───────────────────────────────────────────

export const fetchThreeWayPresets = createAsyncThunk<
  ThreeWayPresetsResponse["presets"],
  void,
  { rejectValue: string }
>("voice/threeWayPresets", async (_, { getState, rejectWithValue }) => {
  try {
    const { data } = await api.get<ThreeWayPresetsResponse>("/voice/three-way/presets", {
      headers: authHeaders(getState),
    });
    return data.presets;
  } catch (error: unknown) {
    return rejectWithValue(formatAxiosError(error, "Could not load quick numbers"));
  }
});

export const startThreeWayCall = createAsyncThunk<
  ThreeWayStartResponse,
  { callSid: string; to: string; label?: string | null },
  { rejectValue: string }
>("voice/threeWayStart", async ({ callSid, to, label }, { getState, rejectWithValue }) => {
  try {
    const { data } = await api.post<ThreeWayStartResponse>(
      "/voice/three-way/start",
      { call_sid: callSid, to, label: label ?? null },
      { headers: authHeaders(getState) },
    );
    return data;
  } catch (error: unknown) {
    return rejectWithValue(formatAxiosError(error, "Could not add the caller"));
  }
});

export const sendThreeWayDigits = createAsyncThunk<
  true,
  { sessionId: number; digits: string },
  { rejectValue: string }
>("voice/threeWayDigits", async ({ sessionId, digits }, { getState, rejectWithValue }) => {
  try {
    await api.post(
      "/voice/three-way/digits",
      { session_id: sessionId, digits },
      { headers: authHeaders(getState) },
    );
    return true;
  } catch (error: unknown) {
    return rejectWithValue(formatAxiosError(error, "Could not send the digits"));
  }
});

export const removeThreeWayCaller = createAsyncThunk<
  true,
  { sessionId: number },
  { rejectValue: string }
>("voice/threeWayRemove", async ({ sessionId }, { getState, rejectWithValue }) => {
  try {
    await api.post(
      "/voice/three-way/remove",
      { session_id: sessionId },
      { headers: authHeaders(getState) },
    );
    return true;
  } catch (error: unknown) {
    return rejectWithValue(formatAxiosError(error, "Could not remove the caller"));
  }
});

export interface ThreeWayState {
  sessionId: number | null;
  label: string | null;
  number: string | null;
  status: "idle" | "adding" | "active" | "removing";
  error: string | null;
}

export type DeviceStatus = "idle" | "connecting" | "registered" | "error";

export interface OutboundCallTarget {
  phone: string;
  clientName?: string | null;
  clientId?: number | null;
}

interface VoiceState {
  isAvailable: boolean;
  deviceStatus: DeviceStatus;
  outboundCall: OutboundCallTarget | null;
  threeWayPresets: ThreeWayPresetsResponse["presets"];
  threeWay: ThreeWayState;
}

const IDLE_THREE_WAY: ThreeWayState = {
  sessionId: null,
  label: null,
  number: null,
  status: "idle",
  error: null,
};

const stored = localStorage.getItem("voice_available");

const initialState: VoiceState = {
  isAvailable: stored === null ? true : stored === "true",
  deviceStatus: "idle",
  outboundCall: null,
  threeWayPresets: [],
  threeWay: IDLE_THREE_WAY,
};

const voiceSlice = createSlice({
  name: "voice",
  initialState,
  reducers: {
    setVoiceAvailable(state, action: PayloadAction<boolean>) {
      state.isAvailable = action.payload;
      localStorage.setItem("voice_available", String(action.payload));
    },
    setDeviceStatus(state, action: PayloadAction<DeviceStatus>) {
      state.deviceStatus = action.payload;
    },
    startOutboundCall(state, action: PayloadAction<OutboundCallTarget>) {
      state.outboundCall = action.payload;
    },
    resolveOutboundCallName(
      state,
      action: PayloadAction<{
        clientName: string | null;
        clientId?: number | null;
      }>,
    ) {
      if (state.outboundCall) {
        state.outboundCall.clientName = action.payload.clientName;
        if (action.payload.clientId != null) {
          state.outboundCall.clientId = action.payload.clientId;
        }
      }
    },
    endOutboundCall(state) {
      state.outboundCall = null;
    },
    /** Call ended / panel closed: forget the third caller. */
    resetThreeWay(state) {
      state.threeWay = IDLE_THREE_WAY;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchThreeWayPresets.fulfilled, (s, a) => {
      s.threeWayPresets = a.payload;
    });
    b.addCase(startThreeWayCall.pending, (s, a) => {
      s.threeWay = {
        sessionId: null,
        label: a.meta.arg.label ?? null,
        number: a.meta.arg.to,
        status: "adding",
        error: null,
      };
    });
    b.addCase(startThreeWayCall.fulfilled, (s, a) => {
      s.threeWay = {
        sessionId: a.payload.session_id,
        label: a.payload.third_party.label,
        number: a.payload.third_party.number,
        status: "active",
        error: null,
      };
    });
    b.addCase(startThreeWayCall.rejected, (s, a) => {
      s.threeWay = { ...IDLE_THREE_WAY, error: a.payload ?? "Could not add the caller" };
    });
    b.addCase(removeThreeWayCaller.pending, (s) => {
      s.threeWay.status = "removing";
    });
    b.addCase(removeThreeWayCaller.fulfilled, (s) => {
      s.threeWay = IDLE_THREE_WAY;
    });
    b.addCase(removeThreeWayCaller.rejected, (s, a) => {
      s.threeWay.status = "active";
      s.threeWay.error = a.payload ?? "Could not remove the caller";
    });
  },
});

export const {
  setVoiceAvailable,
  setDeviceStatus,
  startOutboundCall,
  resolveOutboundCallName,
  endOutboundCall,
  resetThreeWay,
} = voiceSlice.actions;
export default voiceSlice.reducer;

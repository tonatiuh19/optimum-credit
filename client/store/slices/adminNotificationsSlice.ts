import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import type {
  AdminInAppNotification,
  AdminNotificationPrefs,
  AdminNotificationPrefsResponse,
  AdminNotifyChannel,
  AdminNotifyEventKey,
} from "@shared/api";

interface AdminNotificationsState {
  prefs: AdminNotificationPrefs | null;
  channels: AdminNotificationPrefsResponse["channels"] | null;
  events: AdminNotifyEventKey[];
  prefsLoading: boolean;
  prefsSaving: boolean;
  prefsError: string | null;
  inbox: AdminInAppNotification[];
  unreadCount: number;
  inboxLoading: boolean;
  inboxError: string | null;
}

const initialState: AdminNotificationsState = {
  prefs: null,
  channels: null,
  events: [],
  prefsLoading: false,
  prefsSaving: false,
  prefsError: null,
  inbox: [],
  unreadCount: 0,
  inboxLoading: false,
  inboxError: null,
};

function authHeaders(getState: () => unknown) {
  const token = (
    getState() as { adminAuth: { token: string | null } }
  ).adminAuth.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const fetchNotificationPrefs = createAsyncThunk<
  AdminNotificationPrefsResponse,
  void,
  { rejectValue: string }
>("adminNotifications/fetchPrefs", async (_arg, { getState, rejectWithValue }) => {
  try {
    const { data } = await api.get<AdminNotificationPrefsResponse>(
      "/admin/me/notification-prefs",
      { headers: authHeaders(getState) },
    );
    return data;
  } catch (e: any) {
    return rejectWithValue(formatAxiosError(e, "Failed to load preferences"));
  }
});

export const saveNotificationPrefs = createAsyncThunk<
  AdminNotificationPrefsResponse,
  Partial<Record<AdminNotifyChannel, Partial<Record<AdminNotifyEventKey, boolean>>>>,
  { rejectValue: string }
>("adminNotifications/savePrefs", async (body, { getState, rejectWithValue }) => {
  try {
    const { data } = await api.put<AdminNotificationPrefsResponse>(
      "/admin/me/notification-prefs",
      body,
      { headers: authHeaders(getState) },
    );
    return data;
  } catch (e: any) {
    return rejectWithValue(formatAxiosError(e, "Failed to save preferences"));
  }
});

export const fetchAdminInbox = createAsyncThunk<
  { notifications: AdminInAppNotification[]; unread_count: number },
  void,
  { rejectValue: string }
>("adminNotifications/fetchInbox", async (_arg, { getState, rejectWithValue }) => {
  try {
    const { data } = await api.get("/admin/me/notifications", {
      headers: authHeaders(getState),
      params: { limit: 20 },
    });
    return data;
  } catch (e: any) {
    return rejectWithValue(formatAxiosError(e, "Failed to load notifications"));
  }
});

export const markAdminNotificationsRead = createAsyncThunk<
  { unread_count: number },
  { ids?: number[]; all?: boolean },
  { rejectValue: string }
>(
  "adminNotifications/markRead",
  async (payload, { getState, rejectWithValue }) => {
    try {
      const { data } = await api.post(
        "/admin/me/notifications/read",
        payload,
        { headers: authHeaders(getState) },
      );
      return data;
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to mark read"));
    }
  },
);

const slice = createSlice({
  name: "adminNotifications",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchNotificationPrefs.pending, (s) => {
      s.prefsLoading = true;
      s.prefsError = null;
    });
    b.addCase(fetchNotificationPrefs.fulfilled, (s, a) => {
      s.prefsLoading = false;
      s.prefs = a.payload.prefs;
      s.channels = a.payload.channels;
      s.events = a.payload.events;
    });
    b.addCase(fetchNotificationPrefs.rejected, (s, a) => {
      s.prefsLoading = false;
      s.prefsError = a.payload || "Failed";
    });

    b.addCase(saveNotificationPrefs.pending, (s) => {
      s.prefsSaving = true;
      s.prefsError = null;
    });
    b.addCase(saveNotificationPrefs.fulfilled, (s, a) => {
      s.prefsSaving = false;
      s.prefs = a.payload.prefs;
      s.channels = a.payload.channels;
      s.events = a.payload.events;
    });
    b.addCase(saveNotificationPrefs.rejected, (s, a) => {
      s.prefsSaving = false;
      s.prefsError = a.payload || "Failed";
    });

    b.addCase(fetchAdminInbox.pending, (s) => {
      s.inboxLoading = true;
      s.inboxError = null;
    });
    b.addCase(fetchAdminInbox.fulfilled, (s, a) => {
      s.inboxLoading = false;
      s.inbox = a.payload.notifications;
      s.unreadCount = a.payload.unread_count;
    });
    b.addCase(fetchAdminInbox.rejected, (s, a) => {
      s.inboxLoading = false;
      s.inboxError = a.payload || "Failed";
    });

    b.addCase(markAdminNotificationsRead.fulfilled, (s, a) => {
      s.unreadCount = a.payload.unread_count;
      if (a.meta.arg.all) {
        s.inbox = s.inbox.map((n) => ({
          ...n,
          read_at: n.read_at || new Date().toISOString(),
        }));
      } else if (a.meta.arg.ids?.length) {
        const set = new Set(a.meta.arg.ids);
        s.inbox = s.inbox.map((n) =>
          set.has(n.id)
            ? { ...n, read_at: n.read_at || new Date().toISOString() }
            : n,
        );
      }
    });
  },
});

export default slice.reducer;

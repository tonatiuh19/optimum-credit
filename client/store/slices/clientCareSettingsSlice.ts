import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import type { ClientCareSettings } from "@shared/clientCareTemplate";

type Loaded = { settings: ClientCareSettings; defaults: ClientCareSettings; tokens: string[]; can_edit: boolean };

/** Client care settings (Nov 17, 2026): auto-reply texts, business hours, reminder / escalation. */
export const fetchClientCareSettings = createAsyncThunk("clientCareSettings/fetch", async (_: void, { rejectWithValue }) => {
  try {
    const { data } = await api.get<Loaded>("/admin/client-care/settings");
    return data;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load client care settings"));
  }
});

export const saveClientCareSettings = createAsyncThunk(
  "clientCareSettings/save",
  async (body: Partial<ClientCareSettings> | { reset: true }, { rejectWithValue }) => {
    try {
      const { data } = await api.put<{ settings: ClientCareSettings }>("/admin/client-care/settings", body);
      return data.settings;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Could not save"));
    }
  },
);

type State = { data: Loaded | null; loading: boolean; saving: boolean; error: string | null };
const initialState: State = { data: null, loading: false, saving: false, error: null };

const clientCareSettingsSlice = createSlice({
  name: "clientCareSettings",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchClientCareSettings.pending, (s) => {
      s.loading = true;
    });
    b.addCase(fetchClientCareSettings.fulfilled, (s, a) => {
      s.loading = false;
      s.data = a.payload;
      s.error = null;
    });
    b.addCase(fetchClientCareSettings.rejected, (s, a) => {
      s.loading = false;
      s.error = String(a.payload ?? "Could not load");
    });
    b.addCase(saveClientCareSettings.pending, (s) => {
      s.saving = true;
    });
    b.addCase(saveClientCareSettings.fulfilled, (s, a) => {
      s.saving = false;
      if (s.data) s.data.settings = a.payload;
    });
    b.addCase(saveClientCareSettings.rejected, (s) => {
      s.saving = false;
    });
  },
});

export default clientCareSettingsSlice.reducer;

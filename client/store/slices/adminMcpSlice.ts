import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";

export type McpConnection = {
  id: number;
  client_id: string;
  client_name: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  access_expires_at: string;
  refresh_expires_at: string | null;
};

export type McpConsentParams = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method?: string;
  scope?: string;
  resource?: string;
  state?: string;
  approve: boolean;
};

interface AdminMcpState {
  connections: McpConnection[];
  loading: boolean;
  revokingId: number | null;
  consentBusy: boolean;
  error: string | null;
}

const initialState: AdminMcpState = {
  connections: [],
  loading: false,
  revokingId: null,
  consentBusy: false,
  error: null,
};

export const fetchMcpConnections = createAsyncThunk(
  "adminMcp/fetchConnections",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get<{ connections: McpConnection[] }>(
        "/admin/me/mcp-connections",
      );
      return data.connections || [];
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Failed to load connections"));
    }
  },
);

export const revokeMcpConnection = createAsyncThunk(
  "adminMcp/revoke",
  async (id: number, { rejectWithValue }) => {
    try {
      await api.delete(`/admin/me/mcp-connections/${id}`);
      return id;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Failed to revoke"));
    }
  },
);

export const approveMcpConsent = createAsyncThunk(
  "adminMcp/approveConsent",
  async (params: McpConsentParams, { rejectWithValue }) => {
    try {
      const { data } = await api.post<{ redirect_to: string }>(
        "/mcp/oauth/approve",
        params,
      );
      if (!data?.redirect_to) {
        return rejectWithValue("Missing redirect");
      }
      return data.redirect_to;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Consent failed"));
    }
  },
);

const adminMcpSlice = createSlice({
  name: "adminMcp",
  initialState,
  reducers: {
    clearMcpError(s) {
      s.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchMcpConnections.pending, (s) => {
      s.loading = true;
      s.error = null;
    });
    b.addCase(fetchMcpConnections.fulfilled, (s, a) => {
      s.loading = false;
      s.connections = a.payload;
    });
    b.addCase(fetchMcpConnections.rejected, (s, a) => {
      s.loading = false;
      s.error = String(a.payload || a.error.message || "Error");
    });
    b.addCase(revokeMcpConnection.pending, (s, a) => {
      s.revokingId = a.meta.arg;
      s.error = null;
    });
    b.addCase(revokeMcpConnection.fulfilled, (s, a) => {
      s.revokingId = null;
      s.connections = s.connections.filter((c) => c.id !== a.payload);
    });
    b.addCase(revokeMcpConnection.rejected, (s, a) => {
      s.revokingId = null;
      s.error = String(a.payload || a.error.message || "Error");
    });
    b.addCase(approveMcpConsent.pending, (s) => {
      s.consentBusy = true;
      s.error = null;
    });
    b.addCase(approveMcpConsent.fulfilled, (s) => {
      s.consentBusy = false;
    });
    b.addCase(approveMcpConsent.rejected, (s, a) => {
      s.consentBusy = false;
      s.error = String(a.payload || a.error.message || "Error");
    });
  },
});

export const { clearMcpError } = adminMcpSlice.actions;
export default adminMcpSlice.reducer;

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import type { LeadCreditInsightsResponse, ReferralPartnerLeaderboardResponse } from "@shared/api";

type State = {
  byClient: Record<number, LeadCreditInsightsResponse>;
  loading: Record<number, boolean>;
  leaderboard: ReferralPartnerLeaderboardResponse | null;
  leaderboardLoading: boolean;
  backfilling: boolean;
  error: string | null;
};

const initialState: State = { byClient: {}, loading: {}, leaderboard: null, leaderboardLoading: false, backfilling: false, error: null };

export const fetchLeadInsights = createAsyncThunk("leadInsights/client", async (clientId: number, { rejectWithValue }) => {
  try {
    const { data } = await api.get<LeadCreditInsightsResponse>(`/admin/clients/${clientId}/credit-insights`);
    return { clientId, data };
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load credit insights"));
  }
});

export const fetchPartnerLeaderboard = createAsyncThunk("leadInsights/leaderboard", async (days: number, { rejectWithValue }) => {
  try {
    const { data } = await api.get<ReferralPartnerLeaderboardResponse>("/admin/referral-partners/leaderboard", { params: { days } });
    return data;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load the partner leaderboard"));
  }
});

export const backfillLeadInsights = createAsyncThunk("leadInsights/backfill", async (_: void, { rejectWithValue }) => {
  try {
    const { data } = await api.post<{ scanned: number; built: number; failed: number }>("/admin/credit-insights/backfill", { limit: 300 });
    return data;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not build credit insights"));
  }
});

const leadInsightsSlice = createSlice({
  name: "leadInsights",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchLeadInsights.pending, (s, a) => {
      s.loading[a.meta.arg] = true;
    })
      .addCase(fetchLeadInsights.fulfilled, (s, a) => {
        s.loading[a.payload.clientId] = false;
        s.byClient[a.payload.clientId] = a.payload.data;
      })
      .addCase(fetchLeadInsights.rejected, (s, a) => {
        s.loading[a.meta.arg] = false;
        s.error = String(a.payload ?? "");
      })
      .addCase(fetchPartnerLeaderboard.pending, (s) => {
        s.leaderboardLoading = true;
      })
      .addCase(fetchPartnerLeaderboard.fulfilled, (s, a) => {
        s.leaderboardLoading = false;
        s.leaderboard = a.payload;
      })
      .addCase(fetchPartnerLeaderboard.rejected, (s, a) => {
        s.leaderboardLoading = false;
        s.error = String(a.payload ?? "");
      })
      .addCase(backfillLeadInsights.pending, (s) => {
        s.backfilling = true;
      })
      .addCase(backfillLeadInsights.fulfilled, (s) => {
        s.backfilling = false;
      })
      .addCase(backfillLeadInsights.rejected, (s, a) => {
        s.backfilling = false;
        s.error = String(a.payload ?? "");
      });
  },
});

export default leadInsightsSlice.reducer;

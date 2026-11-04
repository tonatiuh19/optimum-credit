import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";

export type ProductivityLevel = "bronze" | "silver" | "gold";
export type ProductivityGrade = "A" | "B" | "C" | "D" | "F";

export type ProductivityEvidence = { label: string; done: boolean; at?: string | null; client_id?: number | null };

export type ProductivityMetric = {
  key: string;
  weight: number;
  tier: ProductivityLevel;
  kind: "ratio" | "count" | "zero";
  target: number;
  done: number;
  total: number | null;
  score: number | null;
  locked: boolean;
  graded: boolean;
  reason: "locked" | "nothing_pending" | "slack_not_connected" | null;
  evidence: ProductivityEvidence[];
};

export type ProductivityScorecard = {
  today: {
    admin_id: number;
    name: string;
    profile: "ops" | "sales";
    date: string;
    status: "graded" | "day_off" | "weekend" | "no_work";
    total: number | null;
    grade: ProductivityGrade | null;
    level: ProductivityLevel;
    metrics: ProductivityMetric[];
  };
  level: { level: ProductivityLevel; progress: { days: number; needed: number; avg: number | null } | null };
  streak: number;
  week: { start: string; average: number | null; grade: ProductivityGrade | null };
  history: Array<{ date: string; total: number | null; level: ProductivityLevel }>;
  badges: Array<{ key: string; earned_at: string }>;
  slack_connected: boolean;
};

export type ProductivityTeamMember = Omit<ProductivityScorecard, "badges"> & {
  admin_id: number;
  name: string;
  profile: "ops" | "sales";
  badges: number;
};

export type ProductivityDayOff = { id: number; admin_id: number; day: string; reason: string | null; name: string };

type State = {
  access: { canView: boolean; isManager: boolean; scored: boolean } | null;
  card: ProductivityScorecard | null;
  cardAdminId: number | null;
  loading: boolean;
  error: string | null;
  team: ProductivityTeamMember[];
  teamLoading: boolean;
  daysOff: ProductivityDayOff[];
};

const initialState: State = {
  access: null,
  card: null,
  cardAdminId: null,
  loading: false,
  error: null,
  team: [],
  teamLoading: false,
  daysOff: [],
};

export const fetchProductivityAccess = createAsyncThunk("productivity/access", async () => {
  try {
    const { data } = await api.get<{ can_view: boolean; is_manager: boolean; scored: boolean }>("/admin/productivity/access");
    return { canView: !!data.can_view, isManager: !!data.is_manager, scored: !!data.scored };
  } catch {
    return { canView: false, isManager: false, scored: false };
  }
});

export const fetchProductivityScorecard = createAsyncThunk(
  "productivity/me",
  async (adminId: number | undefined, { rejectWithValue }) => {
    try {
      const { data } = await api.get<ProductivityScorecard>("/admin/productivity/me", { params: adminId ? { admin_id: adminId } : {} });
      return { data, adminId: adminId ?? null };
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Could not load the scorecard"));
    }
  },
);

export const fetchProductivityTeam = createAsyncThunk("productivity/team", async (_: void, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ date: string; members: ProductivityTeamMember[] }>("/admin/productivity/team");
    return data.members;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load the scorecard"));
  }
});

export const fetchProductivityDaysOff = createAsyncThunk("productivity/daysOff", async (_: void, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ days_off: ProductivityDayOff[] }>("/admin/productivity/days-off");
    return data.days_off;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load the scorecard"));
  }
});

export const addProductivityDayOff = createAsyncThunk(
  "productivity/addDayOff",
  async (body: { admin_id: number; day: string; reason?: string }, { dispatch, rejectWithValue }) => {
    try {
      await api.post("/admin/productivity/days-off", body);
      await dispatch(fetchProductivityDaysOff());
      return true;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Could not load the scorecard"));
    }
  },
);

export const removeProductivityDayOff = createAsyncThunk(
  "productivity/removeDayOff",
  async (id: number, { dispatch, rejectWithValue }) => {
    try {
      await api.delete(`/admin/productivity/days-off/${id}`);
      await dispatch(fetchProductivityDaysOff());
      return id;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Could not load the scorecard"));
    }
  },
);

const productivitySlice = createSlice({
  name: "productivity",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchProductivityAccess.fulfilled, (s, a) => {
      s.access = a.payload;
    });
    b.addCase(fetchProductivityScorecard.pending, (s) => {
      s.loading = true;
      s.error = null;
    });
    b.addCase(fetchProductivityScorecard.fulfilled, (s, a) => {
      s.loading = false;
      s.card = a.payload.data;
      s.cardAdminId = a.payload.adminId;
    });
    b.addCase(fetchProductivityScorecard.rejected, (s, a) => {
      s.loading = false;
      s.error = String(a.payload || a.error.message || "Error");
    });
    b.addCase(fetchProductivityTeam.pending, (s) => {
      s.teamLoading = true;
    });
    b.addCase(fetchProductivityTeam.fulfilled, (s, a) => {
      s.teamLoading = false;
      s.team = a.payload;
    });
    b.addCase(fetchProductivityTeam.rejected, (s) => {
      s.teamLoading = false;
    });
    b.addCase(fetchProductivityDaysOff.fulfilled, (s, a) => {
      s.daysOff = a.payload;
    });
  },
});

export default productivitySlice.reducer;

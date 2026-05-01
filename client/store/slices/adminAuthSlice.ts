import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { getAdminToken, setAdminToken } from "@/lib/api";
import type { AdminUser } from "@shared/api";

interface AdminAuthState {
  user: AdminUser | null;
  token: string | null;
  loading: boolean;
  requestingOtp: boolean;
  verifyingOtp: boolean;
  error: string | null;
  otpSentTo: string | null;
}

const initialState: AdminAuthState = {
  user: null,
  token: getAdminToken(),
  loading: false,
  requestingOtp: false,
  verifyingOtp: false,
  error: null,
  otpSentTo: null,
};

export const requestAdminOtp = createAsyncThunk<
  { email: string },
  { email: string },
  { rejectValue: string }
>("adminAuth/requestOtp", async ({ email }, { rejectWithValue }) => {
  try {
    await api.post("/auth/admin/request-otp", { email });
    return { email };
  } catch (e: any) {
    return rejectWithValue(e?.response?.data?.error || "Could not send code");
  }
});

export const verifyAdminOtp = createAsyncThunk<
  { token: string; user: AdminUser },
  { email: string; code: string },
  { rejectValue: string }
>("adminAuth/verifyOtp", async ({ email, code }, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/auth/admin/verify-otp", { email, code });
    setAdminToken(data.token);
    return data;
  } catch (e: any) {
    return rejectWithValue(e?.response?.data?.error || "Invalid code");
  }
});

export const fetchAdminMe = createAsyncThunk<{ user: AdminUser }>(
  "adminAuth/me",
  async () => {
    const { data } = await api.get("/auth/admin/me");
    return data;
  },
);

export const adminLogout = createAsyncThunk("adminAuth/logout", async () => {
  try {
    await api.post("/auth/logout");
  } catch {}
  setAdminToken(null);
});

const slice = createSlice({
  name: "adminAuth",
  initialState,
  reducers: {
    clearAdminError(state) {
      state.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(requestAdminOtp.pending, (s) => {
      s.requestingOtp = true;
      s.error = null;
    });
    b.addCase(requestAdminOtp.fulfilled, (s, a) => {
      s.requestingOtp = false;
      s.otpSentTo = a.payload.email;
    });
    b.addCase(requestAdminOtp.rejected, (s, a) => {
      s.requestingOtp = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(verifyAdminOtp.pending, (s) => {
      s.verifyingOtp = true;
      s.error = null;
    });
    b.addCase(verifyAdminOtp.fulfilled, (s, a) => {
      s.verifyingOtp = false;
      s.token = a.payload.token;
      s.user = a.payload.user;
    });
    b.addCase(verifyAdminOtp.rejected, (s, a) => {
      s.verifyingOtp = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(fetchAdminMe.pending, (s) => {
      s.loading = true;
    });
    b.addCase(fetchAdminMe.fulfilled, (s, a) => {
      s.loading = false;
      s.user = a.payload.user;
    });
    b.addCase(fetchAdminMe.rejected, (s) => {
      s.loading = false;
      s.token = null;
      s.user = null;
      setAdminToken(null);
    });

    b.addCase(adminLogout.fulfilled, (s) => {
      s.token = null;
      s.user = null;
    });
  },
});

export const { clearAdminError } = slice.actions;
export default slice.reducer;

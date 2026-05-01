import {
  createAsyncThunk,
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";
import api, { getClientToken, setClientToken } from "@/lib/api";
import type { ClientUser } from "@shared/api";

interface ClientAuthState {
  user: ClientUser | null;
  token: string | null;
  loading: boolean;
  requestingOtp: boolean;
  verifyingOtp: boolean;
  error: string | null;
  otpSentTo: string | null;
}

const initialState: ClientAuthState = {
  user: null,
  token: getClientToken(),
  loading: false,
  requestingOtp: false,
  verifyingOtp: false,
  error: null,
  otpSentTo: null,
};

export const requestClientOtp = createAsyncThunk<
  { email: string },
  { email: string },
  { rejectValue: string }
>("clientAuth/requestOtp", async ({ email }, { rejectWithValue }) => {
  try {
    await api.post("/auth/client/request-otp", { email });
    return { email };
  } catch (e: any) {
    return rejectWithValue(e?.response?.data?.error || "Could not send code");
  }
});

export const verifyClientOtp = createAsyncThunk<
  { token: string; user: ClientUser },
  { email: string; code: string },
  { rejectValue: string }
>("clientAuth/verifyOtp", async ({ email, code }, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/auth/client/verify-otp", { email, code });
    setClientToken(data.token);
    return data;
  } catch (e: any) {
    return rejectWithValue(e?.response?.data?.error || "Invalid code");
  }
});

export const fetchClientMe = createAsyncThunk<{ user: ClientUser }>(
  "clientAuth/me",
  async () => {
    const { data } = await api.get("/auth/client/me");
    return data;
  },
);

export const clientLogout = createAsyncThunk("clientAuth/logout", async () => {
  try {
    await api.post("/auth/logout");
  } catch {}
  setClientToken(null);
});

export const redeemOnboardingToken = createAsyncThunk<
  { token: string; user: ClientUser },
  string,
  { rejectValue: string }
>("clientAuth/redeemOnboardingToken", async (rawToken, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/auth/onboarding/${rawToken}`);
    setClientToken(data.token);
    return data;
  } catch (e: any) {
    return rejectWithValue(
      e?.response?.data?.error || "Link has expired or already been used.",
    );
  }
});

const slice = createSlice({
  name: "clientAuth",
  initialState,
  reducers: {
    clearError(state) {
      state.error = null;
    },
    setUserLocal(state, action: PayloadAction<ClientUser | null>) {
      state.user = action.payload;
    },
  },
  extraReducers: (b) => {
    b.addCase(requestClientOtp.pending, (s) => {
      s.requestingOtp = true;
      s.error = null;
    });
    b.addCase(requestClientOtp.fulfilled, (s, a) => {
      s.requestingOtp = false;
      s.otpSentTo = a.payload.email;
    });
    b.addCase(requestClientOtp.rejected, (s, a) => {
      s.requestingOtp = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(verifyClientOtp.pending, (s) => {
      s.verifyingOtp = true;
      s.error = null;
    });
    b.addCase(verifyClientOtp.fulfilled, (s, a) => {
      s.verifyingOtp = false;
      s.token = a.payload.token;
      s.user = a.payload.user;
    });
    b.addCase(verifyClientOtp.rejected, (s, a) => {
      s.verifyingOtp = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(fetchClientMe.pending, (s) => {
      s.loading = true;
    });
    b.addCase(fetchClientMe.fulfilled, (s, a) => {
      s.loading = false;
      s.user = a.payload.user;
    });
    b.addCase(fetchClientMe.rejected, (s) => {
      s.loading = false;
      s.token = null;
      s.user = null;
      setClientToken(null);
    });

    b.addCase(clientLogout.fulfilled, (s) => {
      s.token = null;
      s.user = null;
    });

    b.addCase(redeemOnboardingToken.pending, (s) => {
      s.loading = true;
      s.error = null;
    });
    b.addCase(redeemOnboardingToken.fulfilled, (s, a) => {
      s.loading = false;
      s.token = a.payload.token;
      s.user = a.payload.user;
    });
    b.addCase(redeemOnboardingToken.rejected, (s, a) => {
      s.loading = false;
      s.error = a.payload || "Failed";
    });
  },
});

export const { clearError, setUserLocal } = slice.actions;
export default slice.reducer;

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api from "@/lib/api";
import type {
  CreditPackage,
  RegistrationPayload,
  RegistrationResponse,
} from "@shared/api";

interface PackagesState {
  packages: CreditPackage[];
  loading: boolean;
  registration: RegistrationResponse | null;
  registering: boolean;
  error: string | null;
}

const initialState: PackagesState = {
  packages: [],
  loading: false,
  registration: null,
  registering: false,
  error: null,
};

export const fetchPackages = createAsyncThunk<{ packages: CreditPackage[] }>(
  "packages/fetch",
  async () => {
    const { data } = await api.get("/packages");
    return data;
  },
);

export const submitRegistration = createAsyncThunk<
  RegistrationResponse,
  RegistrationPayload,
  { rejectValue: string }
>("packages/register", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post<RegistrationResponse>(
      "/registration",
      payload,
    );
    return data;
  } catch (e: any) {
    return rejectWithValue(e?.response?.data?.error || "Registration failed");
  }
});

export const confirmMockPayment = createAsyncThunk<
  void,
  { clientId: number; transactionId: string }
>("packages/confirmMock", async (args) => {
  await api.post("/registration/confirm-mock", args);
});

const slice = createSlice({
  name: "packages",
  initialState,
  reducers: {
    resetRegistration(state) {
      state.registration = null;
      state.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchPackages.pending, (s) => {
      s.loading = true;
    });
    b.addCase(fetchPackages.fulfilled, (s, a) => {
      s.loading = false;
      s.packages = a.payload.packages;
    });
    b.addCase(fetchPackages.rejected, (s) => {
      s.loading = false;
    });

    b.addCase(submitRegistration.pending, (s) => {
      s.registering = true;
      s.error = null;
    });
    b.addCase(submitRegistration.fulfilled, (s, a) => {
      s.registering = false;
      s.registration = a.payload;
    });
    b.addCase(submitRegistration.rejected, (s, a) => {
      s.registering = false;
      s.error = a.payload || "Failed";
    });
  },
});

export const { resetRegistration } = slice.actions;
export default slice.reducer;

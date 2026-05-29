import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api from "@/lib/api";
import type {
  CouponValidateResponse,
  CreditPackage,
  RegistrationPayload,
  RegistrationResponse,
  TradelineProduct,
} from "@shared/api";

interface PackagesState {
  packages: CreditPackage[];
  tradelineProducts: TradelineProduct[];
  tradelineLoading: boolean;
  loading: boolean;
  registration: RegistrationResponse | null;
  registering: boolean;
  error: string | null;
  couponValidation: CouponValidateResponse | null;
  couponValidating: boolean;
}

const initialState: PackagesState = {
  packages: [],
  tradelineProducts: [],
  tradelineLoading: false,
  loading: false,
  registration: null,
  registering: false,
  error: null,
  couponValidation: null,
  couponValidating: false,
};

export const fetchPackages = createAsyncThunk<{ packages: CreditPackage[] }>(
  "packages/fetch",
  async () => {
    const { data } = await api.get("/packages");
    return data;
  },
);

export const fetchTradelineProducts = createAsyncThunk<{
  products: TradelineProduct[];
}>("packages/tradelineProducts", async () => {
  const { data } = await api.get("/tradeline-products");
  return data;
});

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

export const validateCoupon = createAsyncThunk<
  CouponValidateResponse,
  { code: string; package_id?: number; amount_cents?: number },
  { rejectValue: string }
>("packages/validateCoupon", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post<CouponValidateResponse>(
      "/validate-coupon",
      payload,
    );
    return data;
  } catch (e: any) {
    return rejectWithValue(
      e?.response?.data?.error || "Could not validate coupon",
    );
  }
});

const slice = createSlice({
  name: "packages",
  initialState,
  reducers: {
    resetRegistration(state) {
      state.registration = null;
      state.error = null;
    },
    clearCoupon(state) {
      state.couponValidation = null;
      state.couponValidating = false;
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

    b.addCase(fetchTradelineProducts.pending, (s) => {
      s.tradelineLoading = true;
    });
    b.addCase(fetchTradelineProducts.fulfilled, (s, a) => {
      s.tradelineLoading = false;
      s.tradelineProducts = a.payload.products;
    });
    b.addCase(fetchTradelineProducts.rejected, (s) => {
      s.tradelineLoading = false;
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

    b.addCase(validateCoupon.pending, (s) => {
      s.couponValidating = true;
      s.couponValidation = null;
    });
    b.addCase(validateCoupon.fulfilled, (s, a) => {
      s.couponValidating = false;
      s.couponValidation = a.payload;
    });
    b.addCase(validateCoupon.rejected, (s) => {
      s.couponValidating = false;
      s.couponValidation = null;
    });
  },
});

export const { resetRegistration, clearCoupon } = slice.actions;
export default slice.reducer;

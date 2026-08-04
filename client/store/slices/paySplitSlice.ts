import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

export interface PaySplitInfo {
  split: {
    id: number;
    case_number: string | null;
    label: string;
    amount_cents: number;
    currency: string;
    due_date: string;
    status: string;
    notes: string | null;
  };
  client_first_name: string;
  client_last_name: string;
  has_stored_card: boolean;
  preferred_language: string;
}

export const fetchPaySplit = createAsyncThunk(
  "paySplit/fetch",
  async (token: string, { rejectWithValue }) => {
    try {
      const { data } = await axios.get<PaySplitInfo>(`/api/pay/${token}`);
      return data;
    } catch (err: any) {
      return rejectWithValue(
        err.response?.data?.error || "Payment link not found or expired.",
      );
    }
  },
);

export const chargePaySplit = createAsyncThunk(
  "paySplit/charge",
  async (
    payload: {
      token: string;
      method: "stored_profile" | "new_card";
      data_descriptor?: string;
      data_value?: string;
    },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await axios.post(`/api/pay/${payload.token}`, {
        method: payload.method,
        data_descriptor: payload.data_descriptor,
        data_value: payload.data_value,
      });
      return data;
    } catch (err: any) {
      return rejectWithValue(
        err.response?.data?.error || "Payment failed. Please try again.",
      );
    }
  },
);

interface PaySplitState {
  info: PaySplitInfo | null;
  loading: boolean;
  charging: boolean;
  loadError: string | null;
  chargeError: string | null;
  success: boolean;
}

const initialState: PaySplitState = {
  info: null,
  loading: false,
  charging: false,
  loadError: null,
  chargeError: null,
  success: false,
};

const paySplitSlice = createSlice({
  name: "paySplit",
  initialState,
  reducers: {
    resetPaySplit() {
      return initialState;
    },
    clearChargeError(state) {
      state.chargeError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPaySplit.pending, (state) => {
        state.loading = true;
        state.loadError = null;
        state.info = null;
        state.success = false;
      })
      .addCase(fetchPaySplit.fulfilled, (state, action) => {
        state.loading = false;
        state.info = action.payload;
      })
      .addCase(fetchPaySplit.rejected, (state, action) => {
        state.loading = false;
        state.loadError = String(action.payload || action.error.message);
      })
      .addCase(chargePaySplit.pending, (state) => {
        state.charging = true;
        state.chargeError = null;
      })
      .addCase(chargePaySplit.fulfilled, (state) => {
        state.charging = false;
        state.success = true;
      })
      .addCase(chargePaySplit.rejected, (state, action) => {
        state.charging = false;
        state.chargeError = String(action.payload || action.error.message);
      });
  },
});

export const { resetPaySplit, clearChargeError } = paySplitSlice.actions;
export default paySplitSlice.reducer;

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import api, { formatAxiosError, setClientToken } from "@/lib/api";
import type {
  CreatePrepaidOnboardInvitePayload,
  PrepaidOnboardInvite,
  PrepaidOnboardPublicInvite,
  RedeemPrepaidOnboardPayload,
  RedeemPrepaidOnboardResponse,
} from "@shared/api";

const publicApi = axios.create({ baseURL: "/api" });

interface PrepaidOnboardState {
  invites: PrepaidOnboardInvite[];
  listLoading: boolean;
  minting: boolean;
  mintError: string | null;
  lastCreated: PrepaidOnboardInvite | null;
  publicInvite: PrepaidOnboardPublicInvite | null;
  publicLoading: boolean;
  publicError: string | null;
  redeeming: boolean;
  redeemError: string | null;
  redeemSuccess: RedeemPrepaidOnboardResponse | null;
}

const initialState: PrepaidOnboardState = {
  invites: [],
  listLoading: false,
  minting: false,
  mintError: null,
  lastCreated: null,
  publicInvite: null,
  publicLoading: false,
  publicError: null,
  redeeming: false,
  redeemError: null,
  redeemSuccess: null,
};

export const fetchPrepaidOnboardInvites = createAsyncThunk(
  "prepaidOnboard/fetchInvites",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get<{ invites: PrepaidOnboardInvite[] }>(
        "/admin/prepaid-onboard-invites",
      );
      return data.invites;
    } catch (e: any) {
      return rejectWithValue(
        formatAxiosError(e, "Failed to load prepaid invites"),
      );
    }
  },
);

export const createPrepaidOnboardInvite = createAsyncThunk(
  "prepaidOnboard/createInvite",
  async (
    payload: CreatePrepaidOnboardInvitePayload,
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.post<{ invite: PrepaidOnboardInvite }>(
        "/admin/prepaid-onboard-invites",
        payload,
      );
      return data.invite;
    } catch (e: any) {
      return rejectWithValue(
        formatAxiosError(e, "Failed to create prepaid invite"),
      );
    }
  },
);

export const revokePrepaidOnboardInvite = createAsyncThunk(
  "prepaidOnboard/revokeInvite",
  async (id: number, { rejectWithValue }) => {
    try {
      const { data } = await api.post<{ invite: PrepaidOnboardInvite }>(
        `/admin/prepaid-onboard-invites/${id}/revoke`,
      );
      return data.invite;
    } catch (e: any) {
      return rejectWithValue(formatAxiosError(e, "Failed to revoke invite"));
    }
  },
);

export const fetchPublicPrepaidOnboardInvite = createAsyncThunk(
  "prepaidOnboard/fetchPublic",
  async (token: string, { rejectWithValue }) => {
    try {
      const { data } = await publicApi.get<PrepaidOnboardPublicInvite>(
        `/public/prepaid-onboard/${encodeURIComponent(token)}`,
      );
      return data;
    } catch (e: any) {
      return rejectWithValue(
        e?.response?.data?.error ||
          "This invite link has expired or is no longer valid.",
      );
    }
  },
);

export const redeemPrepaidOnboardInvite = createAsyncThunk(
  "prepaidOnboard/redeem",
  async (
    args: { token: string; payload: RedeemPrepaidOnboardPayload },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await publicApi.post<RedeemPrepaidOnboardResponse>(
        `/public/prepaid-onboard/${encodeURIComponent(args.token)}`,
        args.payload,
      );
      if (data.token) setClientToken(data.token);
      return data;
    } catch (e: any) {
      return rejectWithValue(
        e?.response?.data?.error ||
          "Could not complete onboarding. Please try again.",
      );
    }
  },
);

const slice = createSlice({
  name: "prepaidOnboard",
  initialState,
  reducers: {
    clearPrepaidMintState(state) {
      state.mintError = null;
      state.lastCreated = null;
    },
    clearPrepaidPublicState(state) {
      state.publicInvite = null;
      state.publicError = null;
      state.redeemError = null;
      state.redeemSuccess = null;
      state.redeeming = false;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchPrepaidOnboardInvites.pending, (s) => {
      s.listLoading = true;
    });
    b.addCase(fetchPrepaidOnboardInvites.fulfilled, (s, a) => {
      s.listLoading = false;
      s.invites = a.payload;
    });
    b.addCase(fetchPrepaidOnboardInvites.rejected, (s) => {
      s.listLoading = false;
    });

    b.addCase(createPrepaidOnboardInvite.pending, (s) => {
      s.minting = true;
      s.mintError = null;
    });
    b.addCase(createPrepaidOnboardInvite.fulfilled, (s, a) => {
      s.minting = false;
      s.lastCreated = a.payload;
      s.invites = [a.payload, ...s.invites];
    });
    b.addCase(createPrepaidOnboardInvite.rejected, (s, a) => {
      s.minting = false;
      s.mintError = String(a.payload || "Failed");
    });

    b.addCase(revokePrepaidOnboardInvite.fulfilled, (s, a) => {
      s.invites = s.invites.map((i) =>
        i.id === a.payload.id ? a.payload : i,
      );
    });

    b.addCase(fetchPublicPrepaidOnboardInvite.pending, (s) => {
      s.publicLoading = true;
      s.publicError = null;
      s.publicInvite = null;
    });
    b.addCase(fetchPublicPrepaidOnboardInvite.fulfilled, (s, a) => {
      s.publicLoading = false;
      s.publicInvite = a.payload;
    });
    b.addCase(fetchPublicPrepaidOnboardInvite.rejected, (s, a) => {
      s.publicLoading = false;
      s.publicError = String(a.payload || "Invalid link");
    });

    b.addCase(redeemPrepaidOnboardInvite.pending, (s) => {
      s.redeeming = true;
      s.redeemError = null;
      s.redeemSuccess = null;
    });
    b.addCase(redeemPrepaidOnboardInvite.fulfilled, (s, a) => {
      s.redeeming = false;
      s.redeemSuccess = a.payload;
    });
    b.addCase(redeemPrepaidOnboardInvite.rejected, (s, a) => {
      s.redeeming = false;
      s.redeemError = String(a.payload || "Failed");
    });
  },
});

export const { clearPrepaidMintState, clearPrepaidPublicState } = slice.actions;
export default slice.reducer;

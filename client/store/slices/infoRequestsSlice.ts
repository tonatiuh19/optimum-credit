import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import type {
  ClientInfoRequest,
  CreateInfoRequestPayload,
} from "@shared/api";

interface InfoRequestsState {
  // Portal
  portalRequests: ClientInfoRequest[];
  actionableCount: number;
  portalLoading: boolean;
  portalSubmitting: boolean;
  portalError: string | null;
  // Admin (keyed by case)
  adminByCase: Record<number, ClientInfoRequest[]>;
  adminLoading: boolean;
  adminSaving: boolean;
  adminError: string | null;
}

const initialState: InfoRequestsState = {
  portalRequests: [],
  actionableCount: 0,
  portalLoading: false,
  portalSubmitting: false,
  portalError: null,
  adminByCase: {},
  adminLoading: false,
  adminSaving: false,
  adminError: null,
};

export const fetchPortalInfoRequests = createAsyncThunk(
  "infoRequests/fetchPortal",
  async () => {
    const { data } = await api.get("/portal/info-requests");
    return data as {
      requests: ClientInfoRequest[];
      actionable_count: number;
    };
  },
);

export const submitPortalInfoRequest = createAsyncThunk(
  "infoRequests/submitPortal",
  async (
    {
      requestId,
      formData,
    }: { requestId: number; formData: FormData },
    { rejectWithValue, dispatch },
  ) => {
    try {
      const { data } = await api.post(
        `/portal/info-requests/${requestId}/submit`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      dispatch(fetchPortalInfoRequests());
      return data;
    } catch (err: unknown) {
      return rejectWithValue(
        formatAxiosError(err, "Failed to submit request"),
      );
    }
  },
);

export const fetchCaseInfoRequests = createAsyncThunk(
  "infoRequests/fetchCase",
  async (caseId: number) => {
    const { data } = await api.get(`/admin/cases/${caseId}/info-requests`);
    return {
      caseId,
      requests: data.requests as ClientInfoRequest[],
    };
  },
);

export const createCaseInfoRequest = createAsyncThunk(
  "infoRequests/create",
  async (
    payload: CreateInfoRequestPayload,
    { rejectWithValue, dispatch },
  ) => {
    try {
      const { case_id, ...body } = payload;
      const { data } = await api.post(
        `/admin/cases/${case_id}/info-requests`,
        body,
      );
      dispatch(fetchCaseInfoRequests(case_id));
      return data.request as ClientInfoRequest;
    } catch (err: unknown) {
      return rejectWithValue(
        formatAxiosError(err, "Failed to create request"),
      );
    }
  },
);

export const reviewInfoRequest = createAsyncThunk(
  "infoRequests/review",
  async (
    {
      requestId,
      caseId,
      status,
      rejection_reason,
    }: {
      requestId: number;
      caseId: number;
      status: "approved" | "rejected";
      rejection_reason?: string;
    },
    { rejectWithValue, dispatch },
  ) => {
    try {
      await api.post(`/admin/info-requests/${requestId}/review`, {
        status,
        rejection_reason,
      });
      dispatch(fetchCaseInfoRequests(caseId));
      return { requestId, status };
    } catch (err: unknown) {
      return rejectWithValue(
        formatAxiosError(err, "Failed to review request"),
      );
    }
  },
);

export const cancelInfoRequest = createAsyncThunk(
  "infoRequests/cancel",
  async (
    { requestId, caseId }: { requestId: number; caseId: number },
    { rejectWithValue, dispatch },
  ) => {
    try {
      await api.post(`/admin/info-requests/${requestId}/cancel`);
      dispatch(fetchCaseInfoRequests(caseId));
      return { requestId };
    } catch (err: unknown) {
      return rejectWithValue(
        formatAxiosError(err, "Failed to cancel request"),
      );
    }
  },
);

export const fetchAdminInfoRequestDetail = createAsyncThunk(
  "infoRequests/adminDetail",
  async (
    { requestId, includeSecrets }: { requestId: number; includeSecrets?: boolean },
  ) => {
    const { data } = await api.get(`/admin/info-requests/${requestId}`, {
      params: includeSecrets ? { include_secrets: 1 } : undefined,
    });
    return data.request as ClientInfoRequest;
  },
);

const slice = createSlice({
  name: "infoRequests",
  initialState,
  reducers: {
    clearInfoRequestErrors(state) {
      state.portalError = null;
      state.adminError = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchPortalInfoRequests.pending, (s) => {
      s.portalLoading = true;
      s.portalError = null;
    });
    b.addCase(fetchPortalInfoRequests.fulfilled, (s, a) => {
      s.portalLoading = false;
      s.portalRequests = a.payload.requests;
      s.actionableCount = a.payload.actionable_count;
    });
    b.addCase(fetchPortalInfoRequests.rejected, (s) => {
      s.portalLoading = false;
    });

    b.addCase(submitPortalInfoRequest.pending, (s) => {
      s.portalSubmitting = true;
      s.portalError = null;
    });
    b.addCase(submitPortalInfoRequest.fulfilled, (s) => {
      s.portalSubmitting = false;
    });
    b.addCase(submitPortalInfoRequest.rejected, (s, a) => {
      s.portalSubmitting = false;
      s.portalError = (a.payload as string) || "Failed to submit";
    });

    b.addCase(fetchCaseInfoRequests.pending, (s) => {
      s.adminLoading = true;
      s.adminError = null;
    });
    b.addCase(fetchCaseInfoRequests.fulfilled, (s, a) => {
      s.adminLoading = false;
      s.adminByCase[a.payload.caseId] = a.payload.requests;
    });
    b.addCase(fetchCaseInfoRequests.rejected, (s) => {
      s.adminLoading = false;
    });

    b.addCase(createCaseInfoRequest.pending, (s) => {
      s.adminSaving = true;
      s.adminError = null;
    });
    b.addCase(createCaseInfoRequest.fulfilled, (s) => {
      s.adminSaving = false;
    });
    b.addCase(createCaseInfoRequest.rejected, (s, a) => {
      s.adminSaving = false;
      s.adminError = (a.payload as string) || "Failed to create";
    });

    b.addCase(reviewInfoRequest.pending, (s) => {
      s.adminSaving = true;
    });
    b.addCase(reviewInfoRequest.fulfilled, (s) => {
      s.adminSaving = false;
    });
    b.addCase(reviewInfoRequest.rejected, (s, a) => {
      s.adminSaving = false;
      s.adminError = (a.payload as string) || "Failed to review";
    });

    b.addCase(cancelInfoRequest.fulfilled, (s) => {
      s.adminSaving = false;
    });
  },
});

export const { clearInfoRequestErrors } = slice.actions;
export default slice.reducer;

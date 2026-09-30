import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import api, { formatAxiosError } from "@/lib/api";
import type {
  CreditAnalysisMode,
  CreditAnalysisResult,
  ProspectLeadPayload,
} from "@shared/api";

/**
 * Public endpoints (no auth) — deliberately bypass `@/lib/api`'s interceptors
 * so an already-logged-in admin/client session never attaches a Bearer token
 * to these anonymous marketing-site requests.
 */
const publicApi = axios.create({ baseURL: "/api" });

export interface CreditAnalysisSubmitPayload {
  mode: CreditAnalysisMode;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  client_goal?: string;
  text_language: "en" | "es";
  notes?: string;
  agent_phone?: string;
  rep_name?: string;
  email_opt_in: boolean;
  report_file: File;
  /** First-touch affiliate referral slug — see `client/lib/affiliateAttribution.ts` */
  affiliateCode?: string | null;
}

interface CreditAnalysisState {
  submitting: boolean;
  error: string | null;
  result: CreditAnalysisResult | null;
  leadSubmitting: boolean;
  leadError: string | null;
  leadSubmitted: boolean;
  gcrSubmitting: boolean;
  gcrError: string | null;
  gcrResult: {
    ok: boolean;
    mfsn_url: string;
    short_url?: string;
    event_kind?: "golf" | "vegas" | null;
  } | null;
  adminLoading: boolean;
  adminSubmitting: boolean;
  adminError: string | null;
  adminResult: CreditAnalysisResult | null;
  portalLoading: boolean;
  portalSubmitting: boolean;
  portalError: string | null;
  portalResult: CreditAnalysisResult | null;
}

const initialState: CreditAnalysisState = {
  submitting: false,
  error: null,
  result: null,
  leadSubmitting: false,
  leadError: null,
  leadSubmitted: false,
  gcrSubmitting: false,
  gcrError: null,
  gcrResult: null,
  adminLoading: false,
  adminSubmitting: false,
  adminError: null,
  adminResult: null,
  portalLoading: false,
  portalSubmitting: false,
  portalError: null,
  portalResult: null,
};

export const submitCreditAnalysis = createAsyncThunk<
  CreditAnalysisResult,
  CreditAnalysisSubmitPayload,
  { rejectValue: string }
>("creditAnalysis/submit", async (payload, { rejectWithValue }) => {
  try {
    const fd = new FormData();
    fd.append("mode", payload.mode);
    fd.append("first_name", payload.first_name);
    fd.append("last_name", payload.last_name);
    fd.append("email", payload.email);
    fd.append("phone", payload.phone);
    if (payload.client_goal) fd.append("client_goal", payload.client_goal);
    fd.append("text_language", payload.text_language);
    if (payload.notes) fd.append("notes", payload.notes);
    if (payload.agent_phone) fd.append("agent_phone", payload.agent_phone);
    if (payload.rep_name) fd.append("rep_name", payload.rep_name);
    fd.append("email_opt_in", String(payload.email_opt_in));
    fd.append("report_file", payload.report_file);
    if (payload.affiliateCode) fd.append("affiliate_code", payload.affiliateCode);

    const { data } = await publicApi.post<CreditAnalysisResult>(
      "/public/credit-analysis",
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return data;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "We couldn't generate your analysis. Please try again."),
    );
  }
});

export interface AdminClientCreditAnalysisPayload {
  clientId: number;
  report_file: File;
  client_goal?: string;
  text_language: "en" | "es";
  notes?: string;
  email_opt_in?: boolean;
}

export const fetchAdminClientCreditAnalysis = createAsyncThunk<
  CreditAnalysisResult | null,
  number,
  { rejectValue: string }
>("creditAnalysis/fetchAdmin", async (clientId, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ analysis: CreditAnalysisResult | null }>(
      `/admin/clients/${clientId}/credit-analysis`,
    );
    return data.analysis;
  } catch (err: unknown) {
    return rejectWithValue(formatAxiosError(err, "Could not load analysis"));
  }
});

export const submitAdminClientCreditAnalysis = createAsyncThunk<
  CreditAnalysisResult,
  AdminClientCreditAnalysisPayload,
  { rejectValue: string }
>("creditAnalysis/submitAdmin", async (payload, { rejectWithValue }) => {
  try {
    const fd = new FormData();
    fd.append("text_language", payload.text_language);
    if (payload.client_goal) fd.append("client_goal", payload.client_goal);
    if (payload.notes) fd.append("notes", payload.notes);
    fd.append("email_opt_in", String(payload.email_opt_in ?? false));
    fd.append("report_file", payload.report_file);
    const { data } = await api.post<CreditAnalysisResult>(
      `/admin/clients/${payload.clientId}/credit-analysis`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return data;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "We couldn't generate the analysis. Please try again."),
    );
  }
});

export interface PortalCreditAnalysisPayload {
  report_file: File;
  client_goal?: string;
  text_language: "en" | "es";
  notes?: string;
  email_opt_in?: boolean;
}

export const fetchPortalCreditAnalysis = createAsyncThunk<
  CreditAnalysisResult | null,
  void,
  { rejectValue: string }
>("creditAnalysis/fetchPortal", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ analysis: CreditAnalysisResult | null }>(
      "/portal/credit-analysis",
    );
    return data.analysis;
  } catch (err: unknown) {
    if (
      axios.isAxiosError(err) &&
      err.response?.status === 403 &&
      (err.response.data as { code?: string })?.code === "prospect_only"
    ) {
      return null;
    }
    return rejectWithValue(formatAxiosError(err, "Could not load analysis"));
  }
});

export const submitPortalCreditAnalysis = createAsyncThunk<
  CreditAnalysisResult,
  PortalCreditAnalysisPayload,
  { rejectValue: string }
>("creditAnalysis/submitPortal", async (payload, { rejectWithValue }) => {
  try {
    const fd = new FormData();
    fd.append("text_language", payload.text_language);
    if (payload.client_goal) fd.append("client_goal", payload.client_goal);
    if (payload.notes) fd.append("notes", payload.notes);
    fd.append("email_opt_in", String(payload.email_opt_in ?? false));
    fd.append("report_file", payload.report_file);
    const { data } = await api.post<CreditAnalysisResult>(
      "/portal/credit-analysis",
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return data;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "We couldn't generate your analysis. Please try again."),
    );
  }
});

export const submitProspectLead = createAsyncThunk<
  { ok: boolean },
  ProspectLeadPayload,
  { rejectValue: string }
>("creditAnalysis/submitLead", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await publicApi.post("/public/prospect-lead", payload);
    return data as { ok: boolean };
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "We couldn't submit your info. Please try again."),
    );
  }
});

export type GetCreditReportLeadPayload = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  preferred_language: "en" | "es";
  hear_about?: string;
  notes?: string;
};

export const submitGetCreditReportLead = createAsyncThunk<
  {
    ok: boolean;
    mfsn_url: string;
    short_url?: string;
    event_kind?: "golf" | "vegas" | null;
  },
  GetCreditReportLeadPayload,
  { rejectValue: string }
>("creditAnalysis/submitGetCreditReportLead", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await publicApi.post(
      "/public/get-credit-report-lead",
      payload,
    );
    return data as {
      ok: boolean;
      mfsn_url: string;
      short_url?: string;
      event_kind?: "golf" | "vegas" | null;
    };
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "We couldn't submit your info. Please try again."),
    );
  }
});

const slice = createSlice({
  name: "creditAnalysis",
  initialState,
  reducers: {
    clearCreditAnalysisResult(s) {
      s.result = null;
      s.error = null;
    },
    clearLeadState(s) {
      s.leadSubmitted = false;
      s.leadError = null;
    },
    clearGetCreditReportLead(s) {
      s.gcrResult = null;
      s.gcrError = null;
    },
    clearAdminCreditAnalysis(s) {
      s.adminResult = null;
      s.adminError = null;
    },
    clearPortalCreditAnalysis(s) {
      s.portalResult = null;
      s.portalError = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(submitCreditAnalysis.pending, (s) => {
      s.submitting = true;
      s.error = null;
    });
    b.addCase(submitCreditAnalysis.rejected, (s, a) => {
      s.submitting = false;
      s.error = a.payload ?? "Something went wrong";
    });
    b.addCase(submitCreditAnalysis.fulfilled, (s, a) => {
      s.submitting = false;
      s.result = a.payload;
    });

    b.addCase(submitProspectLead.pending, (s) => {
      s.leadSubmitting = true;
      s.leadError = null;
    });
    b.addCase(submitProspectLead.rejected, (s, a) => {
      s.leadSubmitting = false;
      s.leadError = a.payload ?? "Something went wrong";
    });
    b.addCase(submitProspectLead.fulfilled, (s) => {
      s.leadSubmitting = false;
      s.leadSubmitted = true;
    });

    b.addCase(submitGetCreditReportLead.pending, (s) => {
      s.gcrSubmitting = true;
      s.gcrError = null;
    });
    b.addCase(submitGetCreditReportLead.rejected, (s, a) => {
      s.gcrSubmitting = false;
      s.gcrError = a.payload ?? "Something went wrong";
    });
    b.addCase(submitGetCreditReportLead.fulfilled, (s, a) => {
      s.gcrSubmitting = false;
      s.gcrResult = a.payload;
    });

    b.addCase(fetchAdminClientCreditAnalysis.pending, (s) => {
      s.adminLoading = true;
      s.adminError = null;
    });
    b.addCase(fetchAdminClientCreditAnalysis.fulfilled, (s, a) => {
      s.adminLoading = false;
      s.adminResult = a.payload;
    });
    b.addCase(fetchAdminClientCreditAnalysis.rejected, (s, a) => {
      s.adminLoading = false;
      s.adminError = a.payload ?? "Could not load analysis";
    });
    b.addCase(submitAdminClientCreditAnalysis.pending, (s) => {
      s.adminSubmitting = true;
      s.adminError = null;
    });
    b.addCase(submitAdminClientCreditAnalysis.fulfilled, (s, a) => {
      s.adminSubmitting = false;
      s.adminResult = a.payload;
    });
    b.addCase(submitAdminClientCreditAnalysis.rejected, (s, a) => {
      s.adminSubmitting = false;
      s.adminError = a.payload ?? "Something went wrong";
    });

    b.addCase(fetchPortalCreditAnalysis.pending, (s) => {
      s.portalLoading = true;
      s.portalError = null;
    });
    b.addCase(fetchPortalCreditAnalysis.fulfilled, (s, a) => {
      s.portalLoading = false;
      s.portalResult = a.payload;
    });
    b.addCase(fetchPortalCreditAnalysis.rejected, (s, a) => {
      s.portalLoading = false;
      s.portalError = a.payload ?? "Could not load analysis";
    });
    b.addCase(submitPortalCreditAnalysis.pending, (s) => {
      s.portalSubmitting = true;
      s.portalError = null;
    });
    b.addCase(submitPortalCreditAnalysis.fulfilled, (s, a) => {
      s.portalSubmitting = false;
      s.portalResult = a.payload;
    });
    b.addCase(submitPortalCreditAnalysis.rejected, (s, a) => {
      s.portalSubmitting = false;
      s.portalError = a.payload ?? "Something went wrong";
    });
  },
});

export const {
  clearCreditAnalysisResult,
  clearLeadState,
  clearGetCreditReportLead,
  clearAdminCreditAnalysis,
  clearPortalCreditAnalysis,
} = slice.actions;
export default slice.reducer;

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import { formatAxiosError } from "@/lib/api";
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
}

const initialState: CreditAnalysisState = {
  submitting: false,
  error: null,
  result: null,
  leadSubmitting: false,
  leadError: null,
  leadSubmitted: false,
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
  },
});

export const { clearCreditAnalysisResult, clearLeadState } = slice.actions;
export default slice.reducer;

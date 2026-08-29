import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api from "@/lib/api";
import type {
  OfGReportData,
  OfGReportWizardOptions,
  ReportWizardBeforeContext,
  ReportWizardDraftSummary,
  ReportWizardSession,
} from "@shared/api";

interface ReportWizardState {
  session: ReportWizardSession | null;
  drafts: ReportWizardDraftSummary[];
  beforeContext: ReportWizardBeforeContext | null;
  beforeContextKey: string | null;
  loading: boolean;
  loadingDrafts: boolean;
  loadingSession: boolean;
  loadingBeforeContext: boolean;
  downloadingSource: "before" | "after" | null;
  publishing: boolean;
  previewing: boolean;
  reExtracting: boolean;
  enhancing: boolean;
  error: string | null;
  previewUrl: string | null;
}

const initialState: ReportWizardState = {
  session: null,
  drafts: [],
  beforeContext: null,
  beforeContextKey: null,
  loading: false,
  loadingDrafts: false,
  loadingSession: false,
  loadingBeforeContext: false,
  downloadingSource: null,
  publishing: false,
  previewing: false,
  reExtracting: false,
  enhancing: false,
  error: null,
  previewUrl: null,
};

function normalizeSession(raw: ReportWizardSession): ReportWizardSession {
  const parse = <T,>(val: unknown): T | null | undefined => {
    if (val == null) return val as null | undefined;
    if (typeof val === "object") return val as T;
    try {
      return JSON.parse(String(val)) as T;
    } catch {
      return null;
    }
  };
  return {
    ...raw,
    options_json: parse(raw.options_json),
    extracted_json: parse<OfGReportData>(raw.extracted_json),
    reviewed_json: parse<OfGReportData>(raw.reviewed_json),
    extraction_meta: parse<Record<string, unknown>>(raw.extraction_meta),
  };
}

export const fetchReportWizardDrafts = createAsyncThunk<
  ReportWizardDraftSummary[],
  number,
  { rejectValue: string }
>("reportWizard/fetchDrafts", async (caseId, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ sessions: ReportWizardDraftSummary[] }>(
      `/admin/cases/${caseId}/report-wizard/sessions`,
    );
    return data.sessions ?? [];
  } catch (e: any) {
    return rejectWithValue(
      e?.response?.data?.error || "Failed to load draft sessions",
    );
  }
});

export const fetchReportWizardSession = createAsyncThunk<
  ReportWizardSession,
  number,
  { rejectValue: string }
>("reportWizard/fetchSession", async (sessionId, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ session: ReportWizardSession }>(
      `/admin/report-wizard/sessions/${sessionId}`,
    );
    return normalizeSession(data.session);
  } catch (e: any) {
    return rejectWithValue(
      e?.response?.data?.error || "Failed to load wizard session",
    );
  }
});

export const downloadReportWizardSourcePdf = createAsyncThunk<
  string,
  { sessionId: number; role: "before" | "after" },
  { rejectValue: string }
>("reportWizard/downloadSource", async (args, { rejectWithValue }) => {
  try {
    const resp = await api.get(
      `/admin/report-wizard/sessions/${args.sessionId}/source/${args.role}`,
      { responseType: "blob" },
    );
    return URL.createObjectURL(resp.data as Blob);
  } catch (e: any) {
    return rejectWithValue(
      e?.response?.data?.error || "Failed to open source PDF",
    );
  }
});

export const fetchReportWizardBeforeContext = createAsyncThunk<
  ReportWizardBeforeContext,
  { caseId: number; roundNumber: number },
  { rejectValue: string }
>("reportWizard/fetchBeforeContext", async (args, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ context: ReportWizardBeforeContext }>(
      `/admin/cases/${args.caseId}/report-wizard/before-context`,
      { params: { round_number: args.roundNumber } },
    );
    return data.context;
  } catch (e: any) {
    return rejectWithValue(
      e?.response?.data?.error || "Failed to load before-report context",
    );
  }
});

export const createReportWizardSession = createAsyncThunk<
  ReportWizardSession,
  {
    caseId: number;
    roundNumber: number;
    beforePdf?: File | null;
    afterPdf: File;
    reuseBeforeSessionId?: number | null;
    options?: OfGReportWizardOptions;
  },
  { rejectValue: string }
>("reportWizard/createSession", async (args, { rejectWithValue }) => {
  const fd = new FormData();
  if (args.beforePdf) fd.append("before_pdf", args.beforePdf);
  fd.append("after_pdf", args.afterPdf);
  fd.append("round_number", String(args.roundNumber));
  if (args.reuseBeforeSessionId) {
    fd.append("reuse_before_session_id", String(args.reuseBeforeSessionId));
  }
  if (args.options?.highlight_win) {
    fd.append("highlight_win", args.options.highlight_win);
  }
  if (args.options?.tradeline_rec) fd.append("tradeline_rec", "true");
  if (args.options?.funding_note) fd.append("funding_note", "true");
  if (args.options?.spanish) fd.append("spanish", "true");
  // Explicit true/false so API default-on stays in sync with the checkbox
  if (args.options?.enhance_with_claude === false) {
    fd.append("enhance_with_claude", "false");
  } else {
    fd.append("enhance_with_claude", "true");
  }
  try {
    const { data } = await api.post<{ session: ReportWizardSession }>(
      `/admin/cases/${args.caseId}/report-wizard/sessions`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return normalizeSession(data.session);
  } catch (e: any) {
    return rejectWithValue(
      e?.response?.data?.error || "Failed to start report wizard",
    );
  }
});

export const reExtractReportWizard = createAsyncThunk<
  ReportWizardSession,
  { sessionId: number; enhanceWithClaude?: boolean },
  { rejectValue: string }
>("reportWizard/reExtract", async (args, { rejectWithValue }) => {
  try {
    const body: { enhance_with_claude?: boolean } = {};
    if (args.enhanceWithClaude === true) body.enhance_with_claude = true;
    if (args.enhanceWithClaude === false) body.enhance_with_claude = false;
    const { data } = await api.post<{ session: ReportWizardSession }>(
      `/admin/report-wizard/sessions/${args.sessionId}/extract`,
      body,
    );
    return normalizeSession(data.session);
  } catch (e: any) {
    return rejectWithValue(
      e?.response?.data?.error || "Failed to re-run extraction",
    );
  }
});

export const enhanceReportWizardNarrative = createAsyncThunk<
  ReportWizardSession,
  { sessionId: number; reviewedJson?: OfGReportData },
  { rejectValue: string }
>("reportWizard/enhanceNarrative", async (args, { rejectWithValue }) => {
  try {
    const { data } = await api.post<{ session: ReportWizardSession }>(
      `/admin/report-wizard/sessions/${args.sessionId}/enhance`,
      args.reviewedJson ? { reviewed_json: args.reviewedJson } : {},
    );
    return normalizeSession(data.session);
  } catch (e: any) {
    return rejectWithValue(
      e?.response?.data?.error || "Failed to enhance report with Claude",
    );
  }
});

export const saveReportWizardReview = createAsyncThunk<
  ReportWizardSession,
  { sessionId: number; reviewedJson: OfGReportData },
  { rejectValue: string }
>("reportWizard/saveReview", async (args, { rejectWithValue }) => {
  try {
    const { data } = await api.patch<{ session: ReportWizardSession }>(
      `/admin/report-wizard/sessions/${args.sessionId}/review`,
      { reviewed_json: args.reviewedJson },
    );
    return normalizeSession(data.session);
  } catch (e: any) {
    return rejectWithValue(e?.response?.data?.error || "Failed to save review");
  }
});

export const previewReportWizard = createAsyncThunk<
  string,
  { sessionId: number; reviewedJson?: OfGReportData },
  { rejectValue: string }
>("reportWizard/preview", async (args, { rejectWithValue }) => {
  try {
    const resp = await api.post(
      `/admin/report-wizard/sessions/${args.sessionId}/preview`,
      args.reviewedJson ? { reviewed_json: args.reviewedJson } : {},
      { responseType: "blob" },
    );
    return URL.createObjectURL(resp.data as Blob);
  } catch (e: any) {
    if (e?.response?.data instanceof Blob) {
      try {
        const text = await e.response.data.text();
        const parsed = JSON.parse(text);
        const issues = Array.isArray(parsed.issues)
          ? parsed.issues.join("; ")
          : "";
        return rejectWithValue(
          [parsed.error || "Preview failed", issues].filter(Boolean).join(": "),
        );
      } catch {
        // fall through
      }
    }
    const issues = Array.isArray(e?.response?.data?.issues)
      ? e.response.data.issues.join("; ")
      : "";
    return rejectWithValue(
      [e?.response?.data?.error || "Failed to generate preview", issues]
        .filter(Boolean)
        .join(": "),
    );
  }
});

export const finalizeReportWizard = createAsyncThunk<
  {
    ok: boolean;
    pipeline_stage: string;
    alerts?: Array<{
      type: string;
      severity: string;
      title: string;
      detail: string;
    }>;
    alerts_count?: number;
  },
  { sessionId: number; acknowledgeScoreAnomalies?: boolean },
  { rejectValue: string }
>("reportWizard/finalize", async (args, { rejectWithValue }) => {
  try {
    const { data } = await api.post<{
      ok: boolean;
      pipeline_stage: string;
      alerts?: Array<{
        type: string;
        severity: string;
        title: string;
        detail: string;
      }>;
      alerts_count?: number;
    }>(`/admin/report-wizard/sessions/${args.sessionId}/finalize`, {
      compliance_acknowledged: true,
      acknowledge_score_anomalies: !!args.acknowledgeScoreAnomalies,
    });
    return data;
  } catch (e: any) {
    const issues = Array.isArray(e?.response?.data?.issues)
      ? e?.response?.data?.issues.join("; ")
      : "";
    return rejectWithValue(
      [e?.response?.data?.error || "Failed to publish report", issues]
        .filter(Boolean)
        .join(": "),
    );
  }
});

function wizardStepForStatus(status: ReportWizardSession["status"]): number {
  // generating without a live previewUrl → land on review so user can re-preview
  if (status === "review" || status === "failed" || status === "generating") {
    return 3;
  }
  return 1;
}

export { wizardStepForStatus };

const reportWizardSlice = createSlice({
  name: "reportWizard",
  initialState,
  reducers: {
    clearReportWizard(state) {
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.session = null;
      state.drafts = [];
      state.beforeContext = null;
      state.beforeContextKey = null;
      state.error = null;
      state.loading = false;
      state.loadingDrafts = false;
      state.loadingSession = false;
      state.loadingBeforeContext = false;
      state.downloadingSource = null;
      state.publishing = false;
      state.previewing = false;
      state.reExtracting = false;
      state.previewUrl = null;
    },
    /** Start-over: drop active session/preview but keep draft list + beforeContext. */
    clearWizardSession(state) {
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.session = null;
      state.previewUrl = null;
      state.error = null;
      state.loading = false;
      state.publishing = false;
      state.previewing = false;
      state.reExtracting = false;
      state.downloadingSource = null;
    },
    setReviewedData(state, action: { payload: OfGReportData }) {
      if (state.session) {
        state.session = {
          ...state.session,
          reviewed_json: action.payload,
        };
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchReportWizardBeforeContext.pending, (state, action) => {
        state.loadingBeforeContext = true;
        state.beforeContext = null;
        state.beforeContextKey = `${action.meta.arg.caseId}:${action.meta.arg.roundNumber}`;
      })
      .addCase(fetchReportWizardBeforeContext.fulfilled, (state, action) => {
        const key = `${action.meta.arg.caseId}:${action.meta.arg.roundNumber}`;
        if (state.beforeContextKey !== key) return;
        state.loadingBeforeContext = false;
        state.beforeContext = action.payload;
      })
      .addCase(fetchReportWizardBeforeContext.rejected, (state, action) => {
        const key = `${action.meta.arg.caseId}:${action.meta.arg.roundNumber}`;
        if (state.beforeContextKey !== key) return;
        state.loadingBeforeContext = false;
        state.beforeContext = null;
        state.error = action.payload || "Failed to load before context";
      })
      .addCase(fetchReportWizardDrafts.pending, (state) => {
        state.loadingDrafts = true;
        state.error = null;
      })
      .addCase(fetchReportWizardDrafts.fulfilled, (state, action) => {
        state.loadingDrafts = false;
        state.drafts = action.payload;
      })
      .addCase(fetchReportWizardDrafts.rejected, (state, action) => {
        state.loadingDrafts = false;
        state.error = action.payload || "Failed to load drafts";
      })
      .addCase(fetchReportWizardSession.pending, (state) => {
        state.loadingSession = true;
        state.error = null;
      })
      .addCase(fetchReportWizardSession.fulfilled, (state, action) => {
        state.loadingSession = false;
        state.session = action.payload;
      })
      .addCase(fetchReportWizardSession.rejected, (state, action) => {
        state.loadingSession = false;
        state.error = action.payload || "Failed to load session";
      })
      .addCase(downloadReportWizardSourcePdf.pending, (state, action) => {
        state.downloadingSource = action.meta.arg.role;
      })
      .addCase(downloadReportWizardSourcePdf.fulfilled, (state) => {
        state.downloadingSource = null;
      })
      .addCase(downloadReportWizardSourcePdf.rejected, (state, action) => {
        state.downloadingSource = null;
        state.error = action.payload || "Failed to open PDF";
      })
      .addCase(createReportWizardSession.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createReportWizardSession.fulfilled, (state, action) => {
        state.loading = false;
        state.session = action.payload;
      })
      .addCase(createReportWizardSession.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "Failed";
      })
      .addCase(reExtractReportWizard.pending, (state) => {
        state.reExtracting = true;
        state.error = null;
      })
      .addCase(reExtractReportWizard.fulfilled, (state, action) => {
        state.reExtracting = false;
        state.session = action.payload;
      })
      .addCase(reExtractReportWizard.rejected, (state, action) => {
        state.reExtracting = false;
        state.error = action.payload || "Re-extract failed";
      })
      .addCase(enhanceReportWizardNarrative.pending, (state) => {
        state.enhancing = true;
        state.error = null;
      })
      .addCase(enhanceReportWizardNarrative.fulfilled, (state, action) => {
        state.enhancing = false;
        state.session = action.payload;
      })
      .addCase(enhanceReportWizardNarrative.rejected, (state, action) => {
        state.enhancing = false;
        state.error = action.payload || "Claude enhance failed";
      })
      .addCase(saveReportWizardReview.fulfilled, (state, action) => {
        state.session = action.payload;
      })
      .addCase(previewReportWizard.pending, (state) => {
        state.previewing = true;
        state.error = null;
      })
      .addCase(previewReportWizard.fulfilled, (state, action) => {
        state.previewing = false;
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = action.payload;
      })
      .addCase(previewReportWizard.rejected, (state, action) => {
        state.previewing = false;
        state.error = action.payload || "Preview failed";
      })
      .addCase(finalizeReportWizard.pending, (state) => {
        state.publishing = true;
        state.error = null;
      })
      .addCase(finalizeReportWizard.fulfilled, (state) => {
        state.publishing = false;
        if (state.session) {
          state.session = { ...state.session, status: "published" };
        }
      })
      .addCase(finalizeReportWizard.rejected, (state, action) => {
        state.publishing = false;
        state.error = action.payload || "Publish failed";
      });
  },
});

export const { clearReportWizard, clearWizardSession, setReviewedData } =
  reportWizardSlice.actions;
export default reportWizardSlice.reducer;

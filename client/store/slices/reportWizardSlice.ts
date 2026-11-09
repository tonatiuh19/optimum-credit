import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { ReportSelfCheck } from "@/store/slices/reportApprovalSlice";
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
  /** Progress Report v2 validation flags from the last preview. */
  previewFlags: Array<{ code: string; message: string }>;
  /** Spec v1.1 §9 self-check from the last preview (failures hold delivery). */
  previewSelfCheck: { pass: boolean; checks: ReportSelfCheck[] } | null;
  /** GF-84: suggested "Notify client" for this round (old rounds = silent). */
  notifyDefault: { notify_client: boolean; reasons: string[] } | null;
  /** Engine Spec v1 PR-P0-1: account-level reads gate Preview / Publish. */
  reads: WizardReadsStatus | null;
  /** Upload was refused as an incomplete SmartCredit print — a Score update can continue it. */
  scoreUpdateOffer: boolean;
  /** Switching a draft between Score update and the full report. */
  switchingScoreUpdate: boolean;
}

export type WizardReadState = {
  status: "missing" | "queued" | "reading" | "ready" | "failed";
  error: string | null;
  reused: boolean;
  /** SmartCredit PDF saved before the accounts loaded. */
  code?: "incomplete_print";
  /** Seconds since the read started (queued / reading). */
  elapsedSec?: number | null;
  /** How it ran: direct | chunked | batch | reused (ready), or batch while reading. */
  mode?: string | null;
};
export type WizardReadsStatus = {
  ready: boolean;
  reads: { before: WizardReadState; after: WizardReadState };
  blocked_data_integrity: string | null;
  report_dates: { before: string | null; after: string | null };
  /** This draft publishes a Score update (scores + verified inquiries only). */
  score_update?: boolean;
  /** Both reads settled and one is flagged incomplete — a Score update can be sent. */
  score_update_available?: boolean;
  incomplete_sides?: Array<"before" | "after">;
  starting_point?: boolean;
  /** Same accounts + scores as the earlier pull, later date: publishes a "No changes yet" report. */
  no_changes_yet?: boolean;
  /** The server filled the review scores from the reads (once per extraction). */
  scores_from_reads?: boolean;
  read_scores?: { before: Record<"TU" | "EX" | "EQ", number | null> | null; after: Record<"TU" | "EX" | "EQ", number | null> | null };
};

const initialState: ReportWizardState = {
  reads: null,
  scoreUpdateOffer: false,
  switchingScoreUpdate: false,
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
  previewFlags: [],
  previewSelfCheck: null,
  notifyDefault: null,
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
>("reportWizard/createSession", async (args, { rejectWithValue, dispatch }) => {
  const { assertEachFileUnderUploadLimit } = await import("@/lib/uploadLimits");
  const sizeCheck = assertEachFileUnderUploadLimit(
    [args.beforePdf, args.afterPdf].filter(Boolean) as File[],
  );
  if (sizeCheck.ok === false) {
    return rejectWithValue(sizeCheck.message);
  }

  let stagedBeforeId: number | null = null;
  // Two Ultra credit-report PDFs often exceed Vercel’s ~4.5 MB body limit when
  // sent together — stage Before first, then create with After only.
  if (args.beforePdf && !args.reuseBeforeSessionId) {
    try {
      const stageFd = new FormData();
      stageFd.append("pdf", args.beforePdf);
      const { data: staged } = await api.post<{
        staged_id: number;
        file_name: string;
        byte_size: number;
      }>(`/admin/cases/${args.caseId}/report-wizard/stage-pdf`, stageFd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      stagedBeforeId = staged.staged_id;
    } catch (e: any) {
      return rejectWithValue(
        e?.response?.data?.error || "Failed to upload Before PDF",
      );
    }
  }

  const fd = new FormData();
  if (stagedBeforeId) {
    fd.append("staged_before_id", String(stagedBeforeId));
  } else if (args.beforePdf) {
    fd.append("before_pdf", args.beforePdf);
  }
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
  if (args.options?.score_update) fd.append("score_update", "true");
  if (args.options?.starting_point) fd.append("starting_point", "true");
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
    // Incomplete SmartCredit print: offer to continue it as a Score update.
    if (e?.response?.data?.score_update_available === true) {
      dispatch(reportWizardSlice.actions.setScoreUpdateOffer(true));
    }
    return rejectWithValue(
      e?.response?.data?.error || "Failed to start report wizard",
    );
  }
});

/** Score update on/off for a draft (server checks a read is flagged incomplete). */
export const setReportWizardScoreUpdate = createAsyncThunk<
  ReportWizardSession,
  { sessionId: number; enabled: boolean },
  { rejectValue: string }
>("reportWizard/setScoreUpdate", async ({ sessionId, enabled }, { rejectWithValue, dispatch }) => {
  try {
    const { data } = await api.post<{ session: ReportWizardSession }>(
      `/admin/report-wizard/sessions/${sessionId}/score-update`,
      { enabled },
    );
    void dispatch(fetchWizardReads(sessionId));
    return normalizeSession(data.session);
  } catch (e: any) {
    return rejectWithValue(e?.response?.data?.error || "Could not change the report type");
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

/** GF-84: should publishing this round email/text the client? */
export const fetchWizardNotifyDefault = createAsyncThunk<
  { notify_client: boolean; reasons: string[] },
  number,
  { rejectValue: string }
>("reportWizard/notifyDefault", async (sessionId, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ notify_client: boolean; reasons: string[] }>(
      `/admin/report-wizard/sessions/${sessionId}/notify-default`,
    );
    return data;
  } catch (e: any) {
    return rejectWithValue(e?.response?.data?.error || "Could not check this round");
  }
});

/** Read status (also (re)queues missing reads server-side). */
/** Client mirror of the server's reviewDataWithReadScores (a side with no read scores is left alone). */
function applyReadScores(data: OfGReportData, reads: NonNullable<WizardReadsStatus["read_scores"]>) {
  const keys = { TU: "transunion", EX: "experian", EQ: "equifax" } as const;
  for (const side of ["before", "after"] as const) {
    const r = reads[side];
    if (!r || !Object.values(r).some((v) => v != null)) continue;
    for (const b of ["TU", "EX", "EQ"] as const) data.bureauScores[keys[b]][side] = r[b] ?? 0;
    const vals = (["TU", "EX", "EQ"] as const).map((b) => r[b]).filter((v): v is number => v != null).sort((x, y) => x - y);
    // A middle score needs all three bureaus, otherwise it stays "--" (0).
    data.middleScore[side] = vals.length === 3 ? vals[1] : 0;
  }
}

export const fetchWizardReads = createAsyncThunk<WizardReadsStatus, number, { rejectValue: string }>(
  "reportWizard/reads",
  async (sessionId, { rejectWithValue }) => {
    try {
      const { data } = await api.get<WizardReadsStatus>(`/admin/report-wizard/sessions/${sessionId}/reads`);
      return data;
    } catch (e: any) {
      return rejectWithValue(e?.response?.data?.error || "Could not load read status");
    }
  },
);

export const previewReportWizard = createAsyncThunk<
  { url: string; flags: Array<{ code: string; message: string }>; selfCheck: { pass: boolean; checks: ReportSelfCheck[] } | null },
  { sessionId: number; reviewedJson?: OfGReportData },
  { rejectValue: string }
>("reportWizard/preview", async (args, { rejectWithValue }) => {
  try {
    const resp = await api.post(
      `/admin/report-wizard/sessions/${args.sessionId}/preview`,
      args.reviewedJson ? { reviewed_json: args.reviewedJson } : {},
      { responseType: "blob" },
    );
    let flags: Array<{ code: string; message: string }> = [];
    try {
      const raw = resp.headers?.["x-report-review-flags"];
      if (raw) flags = JSON.parse(decodeURIComponent(String(raw)));
    } catch {
      flags = [];
    }
    let selfCheck: { pass: boolean; checks: ReportSelfCheck[] } | null = null;
    try {
      const raw = resp.headers?.["x-report-self-check"];
      if (raw) selfCheck = JSON.parse(decodeURIComponent(String(raw)));
    } catch {
      selfCheck = null;
    }
    return { url: URL.createObjectURL(resp.data as Blob), flags, selfCheck };
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
    notify_partners?: boolean;
    partners_emailed?: number;
    partners_linked?: number;
    partners_with_email?: number;
    partners_pdf_load_failed?: boolean;
    /** Spec v1.1 P0-1: publish never sends; the report waits for approval. */
    round_report_id?: number;
    delivery_status?: "pending_approval" | "needs_review";
    self_check?: { pass: boolean; checks: ReportSelfCheck[] };
  },
  {
    sessionId: number;
    acknowledgeScoreAnomalies?: boolean;
    notifyPartners?: boolean;
    /** GF-84: false = publish silently (old / backfilled round). */
    notifyClient?: boolean;
  },
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
      notify_partners?: boolean;
      partners_emailed?: number;
      partners_linked?: number;
      partners_with_email?: number;
      partners_pdf_load_failed?: boolean;
      round_report_id?: number;
      delivery_status?: "pending_approval" | "needs_review";
      self_check?: { pass: boolean; checks: ReportSelfCheck[] };
    }>(`/admin/report-wizard/sessions/${args.sessionId}/finalize`, {
      compliance_acknowledged: true,
      acknowledge_score_anomalies: !!args.acknowledgeScoreAnomalies,
      notify_partners: args.notifyPartners !== false,
      ...(typeof args.notifyClient === "boolean" ? { notify_client: args.notifyClient } : {}),
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
      state.reads = null;
      state.scoreUpdateOffer = false;
      state.switchingScoreUpdate = false;
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
      state.reads = null;
      state.scoreUpdateOffer = false;
      state.switchingScoreUpdate = false;
    },
    setScoreUpdateOffer(state, action: { payload: boolean }) {
      state.scoreUpdateOffer = action.payload;
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
        state.scoreUpdateOffer = false;
      })
      .addCase(setReportWizardScoreUpdate.pending, (state) => {
        state.switchingScoreUpdate = true;
        state.error = null;
      })
      .addCase(setReportWizardScoreUpdate.fulfilled, (state, action) => {
        state.switchingScoreUpdate = false;
        state.session = action.payload;
        // Any earlier preview was the other report type.
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = null;
        state.previewSelfCheck = null;
        state.previewFlags = [];
      })
      .addCase(setReportWizardScoreUpdate.rejected, (state, action) => {
        state.switchingScoreUpdate = false;
        state.error = action.payload || "Could not change the report type";
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
      .addCase(fetchWizardNotifyDefault.pending, (state) => {
        state.notifyDefault = null;
      })
      .addCase(fetchWizardNotifyDefault.fulfilled, (state, action) => {
        state.notifyDefault = action.payload;
      })
      .addCase(fetchWizardReads.fulfilled, (state, action) => {
        // Ignore a late response for a session that is no longer open.
        if (!state.session || state.session.id === action.meta.arg) state.reads = action.payload;
        // This open draft was loaded before the server filled the scores from the reads:
        // apply the same scores once. A reloaded draft already has them (and any staff edits).
        const s = state.session;
        const meta = s?.extraction_meta as Record<string, unknown> | null | undefined;
        if (s && s.id === action.meta.arg && action.payload.scores_from_reads && action.payload.read_scores && !meta?.scores_from_reads) {
          for (const data of [s.extracted_json, s.reviewed_json]) {
            if (data) applyReadScores(data, action.payload.read_scores);
          }
          s.extraction_meta = { ...(meta ?? {}), scores_from_reads: true };
        }
      })
      .addCase(previewReportWizard.pending, (state) => {
        state.previewing = true;
        state.error = null;
      })
      .addCase(previewReportWizard.fulfilled, (state, action) => {
        state.previewing = false;
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = action.payload.url;
        state.previewFlags = action.payload.flags;
        state.previewSelfCheck = action.payload.selfCheck;
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

export const { clearReportWizard, clearWizardSession, setReviewedData, setScoreUpdateOffer } =
  reportWizardSlice.actions;
export default reportWizardSlice.reducer;

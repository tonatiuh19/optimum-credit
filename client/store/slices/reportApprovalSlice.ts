import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";

/** Spec v1.1 §9 self-check row (pass null = not applicable). */
export type ReportSelfCheck = { key: string; pass: boolean | null; detail: string; suspects?: SuspectedReadRow[] };

/** An AI-read row the text reader did not find (a row read twice, a partial row): staff decide. */
export type SuspectedReadRow = {
  bureau: "TU" | "EX" | "EQ";
  creditor: string;
  mask: string | null;
  balance: number | null;
  dateOpened: string | null;
  fragment: boolean;
  extraction_id: number;
  side: "before" | "after";
};

export type ExcludeReadOutcome = "ready" | "still_held" | "current" | "skipped" | "failed";

export type ReportDeliveryStatus = "pending_approval" | "needs_review" | "sending" | "sent" | "silent";

export type ReportApproval = {
  id: number;
  round_number: number;
  delivery_status: ReportDeliveryStatus | null;
  checks: ReportSelfCheck[];
  options: { notify_client: boolean; notify_partners: boolean } | null;
  approved_at: string | null;
  approved_by: string | null;
  can_approve: boolean;
  can_override: boolean;
  /** Opening a held report rebuilt it with the latest engine: this is the new report (was that id). */
  rebuilt_from?: number | null;
};

export type PendingReportApproval = {
  id: number;
  client_id: number;
  case_id: number | null;
  round_number: number;
  locale: string;
  delivery_status: "pending_approval" | "needs_review";
  failed_checks: ReportSelfCheck[];
  client_name: string;
  published_by: string | null;
  created_at: string;
  can_approve: boolean;
  can_override: boolean;
  /** Score update = scores + verified inquiries only (incomplete SmartCredit print). */
  report_kind?: "progress_report" | "score_update";
};

type State = {
  byId: Record<number, ReportApproval>;
  pending: PendingReportApproval[];
  pendingLoaded: boolean;
  approving: Record<number, boolean>;
  error: string | null;
};

const initialState: State = { byId: {}, pending: [], pendingLoaded: false, approving: {}, error: null };

export const fetchPendingReportApprovals = createAsyncThunk("reportApproval/pending", async (_: void, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ items: PendingReportApproval[] }>("/admin/round-reports/pending-approval");
    return data.items;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load reports waiting for approval"));
  }
});

export const fetchReportApproval = createAsyncThunk("reportApproval/one", async (id: number, { rejectWithValue }) => {
  try {
    const { data } = await api.get<ReportApproval>(`/admin/round-reports/${id}/approval`);
    return data;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load the approval status"));
  }
});

export const approveRoundReport = createAsyncThunk(
  "reportApproval/approve",
  async (args: { id: number; overrideReason?: string }, { dispatch, rejectWithValue }) => {
    try {
      const { data } = await api.post<{ ok: boolean; delivery_status: ReportDeliveryStatus; partners_emailed: number }>(
        `/admin/round-reports/${args.id}/approve`,
        args.overrideReason ? { override_reason: args.overrideReason } : {},
      );
      void dispatch(fetchReportApproval(args.id));
      void dispatch(fetchPendingReportApprovals());
      return { id: args.id, ...data };
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Approval failed"));
    }
  },
);

/**
 * A held / waiting report goes back to its Review step (same reads, no re-upload); publishing again
 * rebuilds it with the latest reader and self-check.
 */
export const rebuildRoundReport = createAsyncThunk("reportApproval/rebuild", async (id: number, { dispatch, rejectWithValue }) => {
  try {
    const { data } = await api.post<{ ok: boolean; client_id: number; round_number: number; session_id: number }>(`/admin/round-reports/${id}/rebuild`);
    void dispatch(fetchPendingReportApprovals());
    return { id, ...data };
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not rebuild the report"));
  }
});

/** Marks a suspected row "not a real account" on its pull; the report re-checks at once. */
export const excludeReadRow = createAsyncThunk(
  "reportApproval/excludeRead",
  async ({ reportId, row }: { reportId: number; row: SuspectedReadRow }, { dispatch, rejectWithValue }) => {
    try {
      const { data } = await api.post<{ ok: boolean; outcome: ExcludeReadOutcome; reason: string | null; round_report_id: number }>(
        `/admin/round-reports/${reportId}/exclude-read`,
        { extraction_id: row.extraction_id, bureau: row.bureau, creditor: row.creditor, mask: row.mask, balance: row.balance, date_opened: row.dateOpened },
      );
      void dispatch(fetchPendingReportApprovals());
      return data;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Could not save the correction"));
    }
  },
);

const reportApprovalSlice = createSlice({
  name: "reportApproval",
  initialState,
  reducers: {
    /** A held report replaced by a new one (it passed after a correction): show the new one under the old id too. */
    setApprovalAlias(s, a: { payload: { fromId: number; approval: ReportApproval } }) {
      s.byId[a.payload.fromId] = a.payload.approval;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchPendingReportApprovals.fulfilled, (s, a) => {
      s.pending = a.payload;
      s.pendingLoaded = true;
    });
    b.addCase(fetchPendingReportApprovals.rejected, (s) => {
      s.pendingLoaded = true;
    });
    b.addCase(fetchReportApproval.fulfilled, (s, a) => {
      // Stored under the id asked for too: a held report that rebuilt itself answers with its new id.
      s.byId[a.payload.id] = a.payload;
      s.byId[a.meta.arg] = a.payload;
    });
    b.addCase(approveRoundReport.pending, (s, a) => {
      s.approving[a.meta.arg.id] = true;
      s.error = null;
    });
    b.addCase(approveRoundReport.fulfilled, (s, a) => {
      s.approving[a.payload.id] = false;
      s.pending = s.pending.filter((p) => p.id !== a.payload.id);
    });
    b.addCase(approveRoundReport.rejected, (s, a) => {
      s.approving[a.meta.arg.id] = false;
      s.error = String(a.payload || a.error.message || "Approval failed");
    });
    b.addCase(rebuildRoundReport.pending, (s, a) => {
      s.approving[a.meta.arg] = true;
      s.error = null;
    });
    b.addCase(rebuildRoundReport.fulfilled, (s, a) => {
      s.approving[a.payload.id] = false;
      s.pending = s.pending.filter((p) => p.id !== a.payload.id);
      delete s.byId[a.payload.id];
    });
    b.addCase(rebuildRoundReport.rejected, (s, a) => {
      s.approving[a.meta.arg] = false;
      s.error = String(a.payload || a.error.message || "Could not rebuild the report");
    });
  },
});

export const { setApprovalAlias } = reportApprovalSlice.actions;
export default reportApprovalSlice.reducer;

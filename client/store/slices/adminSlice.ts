import { createAsyncThunk, createSlice, isPending, isRejected } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import { normalizeAdminCalendarResponse } from "@/lib/adminCalendarPayload";
import { applyAdminNotifyPrefsPatch } from "@/lib/adminNotifyPrefs";
import type { RootState } from "@/store";
import type {
  AdminClientListItem,
  AdminClientsListResponse,
  AdminClientsListQuery,
  AdminDocumentsListResponse,
  AdminDocumentsStatusCounts,
  AdminTicketsListResponse,
  AdminReferrer,
  ClientReferrerLink,
  ClientCmsCredentialsPublic,
  ClientCmsCredentialsSecrets,
  AdminDashboardStats,
  AdminDashboardTicket,
  AdminDashboardPayment,
  AdminDashboardUpcomingRound,
  AdminDashboardInboxItem,
  AdminDashboardPulseWeek,
  AdminDashboardActivity,
  ReportDeliveryRound,
  AdminDashboardWorkTask,
  AdminCalendarResponse,
  CalendarSplit,
  CalendarRoundEvent,
  CalendarWorkTaskEvent,
  AdminPaymentsResponse,
  AdminPipelineResponse,
  AdminPipelineQuery,
  AdminPipelineColumnMoreResponse,
  PipelineColumnPage,
  AdminSubscriptionsResponse,
  AdminUserListItem,
  CommunicationTemplate,
  Conversation,
  ConversationMessage,
  Coupon,
  CouponValidateResponse,
  CreateCouponPayload,
  CreditRepairCase,
  EducationalVideo,
  Payment,
  PipelineStage,
  Prospect,
  SupportFaq,
  SupportTicket,
  SectionLock,
  SystemSetting,
  AdminNotifyExtraEmail,
  AdminNotifyStaffRecipient,
  AdminNotifyRecipientsResponse,
  AdminNotifyChannel,
  AdminNotifyEventKey,
  UpdateCouponPayload,
  PaymentSplit,
  CreateCasePayload,
  TradelineProduct,
  TradelineProductInput,
  ReferralCategory,
  RoundScheduleInput,
  AdminClientNoteResponse,
  AdminClientPauseResponse,
  LeadSignalsResponse,
} from "@shared/api";

interface AdminState {
  dashboard: {
    stats: AdminDashboardStats | null;
    stages: { pipeline_stage: PipelineStage; count: number }[];
    recent_clients: AdminClientListItem[];
    recent_tickets: AdminDashboardTicket[];
    recent_payments: AdminDashboardPayment[];
    upcoming_rounds: AdminDashboardUpcomingRound[];
    my_work_tasks: AdminDashboardWorkTask[];
    scope: "everyone" | "mine";
    is_super: boolean;
    inbox: AdminDashboardInboxItem[];
    pulse: { weeks: AdminDashboardPulseWeek[] } | null;
    activity: AdminDashboardActivity[];
  };
  /** Case panel: progress-report delivery timelines, by client id → round. */
  reportDeliveries: Record<number, Record<number, ReportDeliveryRound>>;
  reportDeliveriesLoading: Record<number, boolean>;
  /** True once the dashboard has loaded at least once. */
  dashboardLoaded: boolean;
  dashboardRefreshing: boolean;
  clients: AdminClientListItem[];
  clientsPagination: AdminClientsListResponse["pagination"] | null;
  clientsListQuery: AdminClientsListQuery | null;
  clientsLoading: boolean;
  clientsExporting: boolean;
  pipelineClients: AdminClientListItem[];
  pipelineCases: CreditRepairCase[];
  pipelineProspects: Prospect[];
  pipelineColumns: Record<string, PipelineColumnPage>;
  pipelineLoading: boolean;
  pipelineLoadingMore: string | null;
  pipelinePageLimit: number;
  selectedClient: any | null;
  panelClient: {
    case_info?: {
      id: number;
      case_number: string;
      status: string;
      pipeline_stage: string;
      created_at?: string;
      max_rounds?: number;
      next_dispute_target_date?: string | null;
      report_compare_mode?: "baseline" | "chain";
      highest_published_round?: number;
      extended_rounds_legend?: string | null;
      /** Engine Spec v1 PR-P2-3: case hygiene alerts (shown on the case, never in reports). */
      hygiene_alerts?: Array<{ code: "status_behind_stage" | "proof_of_address_pending" | "no_round_schedule" | "id_docs_pending"; days?: number }>;
      available_rounds?: number[];
    };
    client: any;
    documents: any[];
    reports: any[];
    wizard_sessions?: Array<{
      id: number;
      round_number: number;
      status: string;
      created_at?: string;
      published_at?: string | null;
    }>;
    payments: any[];
    pipeline_history: any[];
    sibling_cases?: Array<{
      id: number;
      case_number: string;
      pipeline_stage: string;
      status: string;
    }>;
  } | null;
  panelLoading: boolean;
  pendingDocuments: any[];
  allDocuments: any[];
  documentsPagination: AdminDocumentsListResponse["pagination"] | null;
  documentsStatusCounts: AdminDocumentsStatusCounts | null;
  documentsLoading: boolean;
  conversations: Conversation[];
  conversationMessages: Record<number, ConversationMessage[]>;
  tickets: SupportTicket[];
  ticketsPagination: AdminTicketsListResponse["pagination"] | null;
  ticketsLoading: boolean;
  selectedTicket: any | null;
  ticketReplies: any[];
  faqs: SupportFaq[];
  templates: CommunicationTemplate[];
  videos: EducationalVideo[];
  settings: SystemSetting[];
  notifyStaff: AdminNotifyStaffRecipient[];
  /** Snapshot to roll back optimistic staff prefs on save failure. */
  notifyStaffPrefsSnapshot: AdminNotifyStaffRecipient[] | null;
  notifyExtraEmails: AdminNotifyExtraEmail[];
  notifyExtraEmailsLoading: boolean;
  notifyExtraEmailsSaving: boolean;
  notifyExtraEmailsError: string | null;
  reports: {
    revenueByMonth: any[];
    signupsByMonth: any[];
    packageBreakdown: any[];
  };
  team: AdminUserListItem[];
  payments: Payment[];
  paymentsSummary: AdminPaymentsResponse["summary"] | null;
  paymentsPagination: AdminPaymentsResponse["pagination"] | null;
  paymentsLoading: boolean;
  subscriptions: AdminSubscriptionsResponse["subscriptions"];
  subscriptionsSummary: AdminSubscriptionsResponse["summary"] | null;
  subscriptionsPagination: AdminSubscriptionsResponse["pagination"] | null;
  subscriptionsLoading: boolean;
  coupons: Coupon[];
  couponsSaving: boolean;
  couponPreview: CouponValidateResponse | null;
  couponPreviewing: boolean;
  sectionLocks: SectionLock[];
  sectionLocksLoading: boolean;
  sectionLocksInitialized: boolean;
  sectionLocksSaving: boolean;
  // Payment splits
  paymentSplits: PaymentSplit[];
  paymentSplitsLoading: boolean;
  paymentSplitsPagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  } | null;
  caseSplits: PaymentSplit[];
  caseSplitsLoading: boolean;
  calendarSplits: CalendarSplit[];
  calendarRoundEvents: CalendarRoundEvent[];
  calendarWorkTasks: CalendarWorkTaskEvent[];
  calendarLoading: boolean;
  clientSearchResults: AdminClientListItem[];
  clientSearchLoading: boolean;
  referrers: AdminReferrer[];
  referrersLoading: boolean;
  clientReferrers: ClientReferrerLink[];
  clientReferrersLoading: boolean;
  clientReferrersSaving: boolean;
  caseDocuments: any[];
  caseDocumentsLoading: boolean;
  caseDocumentsUploading: boolean;
  tradelineProducts: TradelineProduct[];
  tradelineProductsSaving: boolean;
  loading: boolean;
  saving: boolean;
}

const initialState: AdminState = {
  dashboard: {
    stats: null,
    stages: [],
    recent_clients: [],
    recent_tickets: [],
    recent_payments: [],
    upcoming_rounds: [],
    my_work_tasks: [],
    scope: "everyone",
    is_super: false,
    inbox: [],
    pulse: null,
    activity: [],
  },
  reportDeliveries: {},
  reportDeliveriesLoading: {},
  dashboardLoaded: false,
  dashboardRefreshing: false,
  clients: [],
  clientsPagination: null,
  clientsListQuery: null,
  clientsLoading: false,
  clientsExporting: false,
  pipelineClients: [],
  pipelineCases: [],
  pipelineProspects: [],
  pipelineColumns: {},
  pipelineLoading: false,
  pipelineLoadingMore: null,
  pipelinePageLimit: 20,
  selectedClient: null,
  panelClient: null,
  panelLoading: false,
  pendingDocuments: [],
  allDocuments: [],
  documentsPagination: null,
  documentsStatusCounts: null,
  documentsLoading: false,
  conversations: [],
  conversationMessages: {},
  tickets: [],
  ticketsPagination: null,
  ticketsLoading: false,
  selectedTicket: null,
  ticketReplies: [],
  faqs: [],
  templates: [],
  videos: [],
  settings: [],
  notifyStaff: [],
  notifyStaffPrefsSnapshot: null,
  notifyExtraEmails: [],
  notifyExtraEmailsLoading: false,
  notifyExtraEmailsSaving: false,
  notifyExtraEmailsError: null,
  reports: { revenueByMonth: [], signupsByMonth: [], packageBreakdown: [] },
  team: [],
  payments: [],
  paymentsSummary: null,
  paymentsPagination: null,
  paymentsLoading: false,
  subscriptions: [],
  subscriptionsSummary: null,
  subscriptionsPagination: null,
  subscriptionsLoading: false,
  coupons: [],
  couponsSaving: false,
  couponPreview: null,
  couponPreviewing: false,
  sectionLocks: [],
  sectionLocksLoading: true,
  sectionLocksInitialized: false,
  sectionLocksSaving: false,
  paymentSplits: [],
  paymentSplitsLoading: false,
  paymentSplitsPagination: null,
  caseSplits: [],
  caseSplitsLoading: false,
  calendarSplits: [],
  calendarRoundEvents: [],
  calendarWorkTasks: [],
  calendarLoading: false,
  clientSearchResults: [],
  clientSearchLoading: false,
  referrers: [],
  referrersLoading: false,
  clientReferrers: [],
  clientReferrersLoading: false,
  clientReferrersSaving: false,
  caseDocuments: [],
  caseDocumentsLoading: false,
  caseDocumentsUploading: false,
  tradelineProducts: [],
  tradelineProductsSaving: false,
  loading: false,
  saving: false,
};

export const fetchAdminDashboard = createAsyncThunk(
  "admin/dashboard",
  async (opts: { mine?: boolean } | void) => {
    const { data } = await api.get("/admin/dashboard", { params: opts && opts.mine ? { mine: 1 } : {} });
    return data;
  },
);

export const fetchAdminClients = createAsyncThunk<
  AdminClientsListResponse,
  AdminClientsListQuery | undefined
>("admin/clients", async (args) => {
  const params: Record<string, string | number> = {};
  if (args?.stage) params.stage = args.stage;
  if (args?.search) params.search = args.search;
  if (args?.status) params.status = args.status;
  if (args?.language) params.language = args.language;
  if (args?.billing) params.billing = args.billing;
  if (args?.joined_from) params.joined_from = args.joined_from;
  if (args?.joined_to) params.joined_to = args.joined_to;
  if (args?.has_notes) params.has_notes = args.has_notes;
  if (args?.labels && args.labels.length > 0)
    params.labels = args.labels.join(",");
  if (args?.page) params.page = args.page;
  if (args?.limit) params.limit = args.limit;
  if (args?.sort_by) params.sort_by = args.sort_by;
  if (args?.sort_dir) params.sort_dir = args.sort_dir;
  const { data } = await api.get("/admin/clients", { params });
  return data as AdminClientsListResponse;
});

/** Full CSV for Google Sheet reconcile — same filters as list, no page cap. */
export const exportAdminClientsCsv = createAsyncThunk<
  { csv: string; filename: string; truncated: boolean },
  AdminClientsListQuery | undefined,
  { rejectValue: string }
>("admin/clients/exportCsv", async (args, { rejectWithValue }) => {
  try {
    const params: Record<string, string> = {};
    if (args?.stage) params.stage = args.stage;
    if (args?.search) params.search = args.search;
    if (args?.status) params.status = args.status;
    if (args?.language) params.language = args.language;
    if (args?.billing) params.billing = args.billing;
    if (args?.joined_from) params.joined_from = args.joined_from;
    if (args?.joined_to) params.joined_to = args.joined_to;
    if (args?.has_notes) params.has_notes = args.has_notes;
    if (args?.labels && args.labels.length > 0)
      params.labels = args.labels.join(",");
    if (args?.sort_by) params.sort_by = args.sort_by;
    if (args?.sort_dir) params.sort_dir = args.sort_dir;
    const res = await api.get<string>("/admin/clients/export", {
      params,
      responseType: "text",
    });
    const disposition = String(res.headers?.["content-disposition"] || "");
    const match = /filename="([^"]+)"/i.exec(disposition);
    const filename =
      match?.[1] ||
      `ofg-clients-${new Date().toISOString().slice(0, 10)}.csv`;
    const truncated =
      String(res.headers?.["x-export-truncated"] || "") === "1";
    return { csv: String(res.data ?? ""), filename, truncated };
  } catch (err: any) {
    return rejectWithValue(
      formatAxiosError(err, "Could not download clients CSV."),
    );
  }
});

export const refetchAdminClients = createAsyncThunk<
  AdminClientsListResponse,
  void,
  { state: RootState }
>("admin/clients/refetch", async (_, { getState, dispatch }) => {
  const q = getState().admin.clientsListQuery;
  return dispatch(fetchAdminClients(q ?? { page: 1, limit: 50 })).unwrap();
});

export const searchClients = createAsyncThunk<
  AdminClientListItem[],
  string | { query: string; status?: string; unconvertedLead?: boolean }
>("admin/clients/search", async (args) => {
  const query = typeof args === "string" ? args : args.query;
  const status = typeof args === "string" ? undefined : args.status;
  const unconvertedLead =
    typeof args === "string" ? undefined : args.unconvertedLead;
  const { data } = await api.get("/admin/clients", {
    params: {
      search: query,
      limit: 10,
      ...(status ? { status } : {}),
      ...(unconvertedLead ? { unconverted_lead: "1" } : {}),
    },
  });
  return data.clients as AdminClientListItem[];
});

export const fetchAdminClient = createAsyncThunk<any, { id: number }>(
  "admin/client",
  async ({ id }) => {
    const { data } = await api.get(`/admin/clients/${id}`);
    return data;
  },
);

function pipelineQueryParams(
  args?: AdminPipelineQuery,
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (args?.search) params.search = args.search;
  if (args?.language) params.language = args.language;
  if (args?.billing) params.billing = args.billing;
  if (args?.package_id) params.package_id = args.package_id;
  if (args?.assigned_admin_id)
    params.assigned_admin_id = args.assigned_admin_id;
  if (args?.referral_category)
    params.referral_category = args.referral_category;
  if (args?.client_status) params.client_status = args.client_status;
  if (args?.lead_temperature) params.lead_temperature = args.lead_temperature;
  if (args?.case_status) params.case_status = args.case_status;
  if (args?.stage) params.stage = args.stage;
  if (args?.payment_badge) params.payment_badge = args.payment_badge;
  if (args?.tasks) params.tasks = args.tasks;
  if (args?.info_requests) params.info_requests = args.info_requests;
  if (args?.has_notes) params.has_notes = args.has_notes;
  if (args?.labels && args.labels.length > 0)
    params.labels = args.labels.join(",");
  if (args?.limit != null) params.limit = args.limit;
  if (args?.column) params.column = args.column;
  if (args?.offset != null) params.offset = args.offset;
  if (args?.prospect_sort) params.prospect_sort = args.prospect_sort;
  return params;
}

export const fetchPipeline = createAsyncThunk(
  "admin/pipeline",
  async (args?: AdminPipelineQuery) => {
    const params = pipelineQueryParams({
      ...args,
      limit: args?.limit ?? 20,
      column: undefined,
      offset: undefined,
    });
    const { data } = await api.get("/admin/pipeline", { params });
    return data as AdminPipelineResponse;
  },
);

export const fetchMorePipelineColumn = createAsyncThunk(
  "admin/pipelineMore",
  async (args: AdminPipelineQuery & { column: string; offset: number }) => {
    const params = pipelineQueryParams({
      ...args,
      limit: args.limit ?? 20,
      column: args.column,
      offset: args.offset,
    });
    const { data } = await api.get("/admin/pipeline", { params });
    return data as AdminPipelineColumnMoreResponse;
  },
);

export const updateClientStage = createAsyncThunk<
  void,
  { clientId: number; stage: PipelineStage; notes?: string }
>("admin/updateStage", async ({ clientId, stage, notes }) => {
  await api.post(`/admin/clients/${clientId}/stage`, { stage, notes });
});

export const updateCaseStage = createAsyncThunk<
  void,
  { caseId: number; stage: PipelineStage; notes?: string }
>("admin/updateCaseStage", async ({ caseId, stage, notes }) => {
  await api.post(`/admin/cases/${caseId}/stage`, { stage, notes });
});

export const updateCaseExtendedRounds = createAsyncThunk(
  "admin/updateCaseExtendedRounds",
  async (
    {
      caseId,
      max_rounds,
      next_dispute_target_date,
      report_compare_mode,
    }: {
      caseId: number;
      max_rounds?: number;
      next_dispute_target_date?: string | null;
      report_compare_mode?: "baseline" | "chain";
    },
    { rejectWithValue },
  ) => {
    try {
      const body: Record<string, unknown> = {};
      if (max_rounds !== undefined) body.max_rounds = max_rounds;
      if (next_dispute_target_date !== undefined) {
        body.next_dispute_target_date = next_dispute_target_date;
      }
      if (report_compare_mode !== undefined) {
        body.report_compare_mode = report_compare_mode;
      }
      const { data } = await api.patch(
        `/admin/cases/${caseId}/extended-rounds`,
        body,
      );
      return data as {
        ok: boolean;
        case: {
          id: number;
          client_id: number;
          max_rounds: number;
          next_dispute_target_date: string | null;
          report_compare_mode: "baseline" | "chain";
          highest_published_round: number;
          pipeline_stage: string;
          reopened_to_round_5: boolean;
          extended_rounds_legend: string | null;
          available_rounds: number[];
          is_extended: boolean;
        };
      };
    } catch (err) {
      return rejectWithValue(
        formatAxiosError(err, "Could not save round settings"),
      );
    }
  },
);

export const fetchPanelCase = createAsyncThunk(
  "admin/panelCase",
  async (id: number) => {
    const { data } = await api.get(`/admin/cases/${id}`);
    return data;
  },
);

export const fetchPendingDocuments = createAsyncThunk(
  "admin/pendingDocs",
  async () => {
    const { data } = await api.get("/admin/documents", {
      params: { status: "pending", limit: 100 },
    });
    return (data as AdminDocumentsListResponse).documents;
  },
);

export const reviewDocument = createAsyncThunk<
  void,
  { id: number; decision: "approved" | "rejected"; reason?: string }
>("admin/reviewDoc", async ({ id, decision, reason }) => {
  await api.post(`/admin/documents/${id}/review`, { decision, reason });
});

export const fetchPanelClient = createAsyncThunk(
  "admin/panelClient",
  async (id: number) => {
    const { data } = await api.get(`/admin/clients/${id}`);
    return data;
  },
);

export const fetchAllDocuments = createAsyncThunk<
  AdminDocumentsListResponse,
  | {
      status?: string;
      search?: string;
      doc_type?: string;
      page?: number;
      limit?: number;
      sort_by?: string;
      sort_dir?: "ASC" | "DESC";
    }
  | undefined
>("admin/allDocs", async (params) => {
  const query: Record<string, string | number> = {
    status: params?.status || "all",
  };
  if (params?.search) query.search = params.search;
  if (params?.doc_type && params.doc_type !== "all")
    query.doc_type = params.doc_type;
  if (params?.page) query.page = params.page;
  if (params?.limit) query.limit = params.limit;
  if (params?.sort_by) query.sort_by = params.sort_by;
  if (params?.sort_dir) query.sort_dir = params.sort_dir;
  const { data } = await api.get("/admin/documents", { params: query });
  return data as AdminDocumentsListResponse;
});

export const fetchCaseDocuments = createAsyncThunk<
  { caseId: number; documents: any[] },
  number
>("admin/fetchCaseDocuments", async (caseId) => {
  const { data } = await api.get(`/admin/cases/${caseId}/documents`);
  return { caseId, documents: data.documents };
});

export const uploadCaseDocuments = createAsyncThunk<
  { caseId: number; documents: any[] },
  { caseId: number; doc_type: string; files: File[] },
  { rejectValue: string }
>("admin/uploadCaseDocuments", async ({ caseId, doc_type, files }, { rejectWithValue }) => {
  const { assertFilesUnderUploadLimit } = await import("@/lib/uploadLimits");
  const sizeCheck = assertFilesUnderUploadLimit(files);
  if (sizeCheck.ok === false) {
    return rejectWithValue(sizeCheck.message);
  }
  // One file per request so each stays under the Vercel ~4.5MB body limit.
  const documents: any[] = [];
  try {
    for (const file of files) {
      const fd = new FormData();
      fd.append("doc_type", doc_type);
      fd.append("files", file);
      const { data } = await api.post(`/admin/cases/${caseId}/documents`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (Array.isArray(data?.documents)) {
        documents.push(...data.documents);
      }
    }
    return { caseId, documents };
  } catch (err) {
    return rejectWithValue(
      formatAxiosError(err, "Could not upload document"),
    );
  }
});

export const deleteCaseDocument = createAsyncThunk<
  { id: number; caseId: number | null },
  { id: number; caseId?: number | null },
  { rejectValue: string }
>("admin/deleteCaseDocument", async ({ id, caseId }, { rejectWithValue }) => {
  try {
    const { data } = await api.delete(`/admin/client-documents/${id}`);
    return {
      id,
      caseId:
        caseId != null
          ? Number(caseId)
          : data?.case_id != null
            ? Number(data.case_id)
            : null,
    };
  } catch (err) {
    return rejectWithValue(
      formatAxiosError(err, "Could not delete document"),
    );
  }
});

export const deleteArchiveDocument = createAsyncThunk<
  { id: number },
  number,
  { rejectValue: string }
>("admin/deleteArchiveDocument", async (id, { rejectWithValue }) => {
  try {
    await api.delete(`/admin/documents/${id}`);
    return { id };
  } catch (err) {
    return rejectWithValue(
      formatAxiosError(err, "Could not delete document"),
    );
  }
});

export type RoundReportResetPreview = {
  client_id: number;
  client_name: string;
  case_id: number | null;
  reset_from_round: number;
  rounds_to_clear: number[];
  rounds_with_data: number[];
  report_ids: number[];
  pdf_ids: number[];
  session_ids: number[];
  staged_pdf_ids?: number[];
  pipeline: { from: string; to: string };
  warnings: string[];
};

export type RoundReportResetResult = {
  ok: boolean;
  dry_run: boolean;
  preview?: RoundReportResetPreview;
  reset?: RoundReportResetPreview;
  guidance?: string;
};

export const previewRoundReportReset = createAsyncThunk<
  RoundReportResetResult,
  { clientId: number; roundNumber: number },
  { rejectValue: string }
>("admin/previewRoundReportReset", async (args, { rejectWithValue }) => {
  try {
    const { data } = await api.post<RoundReportResetResult>(
      `/admin/clients/${args.clientId}/round-reports/${args.roundNumber}/reset`,
      { confirm: false },
    );
    return data;
  } catch (e: any) {
    return rejectWithValue(
      formatAxiosError(e, "Failed to preview round reset"),
    );
  }
});

export const confirmRoundReportReset = createAsyncThunk<
  RoundReportResetResult,
  { clientId: number; roundNumber: number },
  { rejectValue: string }
>("admin/confirmRoundReportReset", async (args, { rejectWithValue }) => {
  try {
    const { data } = await api.post<RoundReportResetResult>(
      `/admin/clients/${args.clientId}/round-reports/${args.roundNumber}/reset`,
      { confirm: true },
    );
    return data;
  } catch (e: any) {
    return rejectWithValue(formatAxiosError(e, "Failed to reset round"));
  }
});

export type ResendRoundReportPdfResult = {
  ok: boolean;
  pdf_id: number;
  client_id: number;
  round_number: number;
  email_sent: boolean;
  sms_sent: boolean;
  partners_emailed: number;
  partners_linked: number;
  partners_with_email: number;
  notify_partners: boolean;
  secure_pdf_url?: string | null;
};

export const fetchRoundReportDeliveries = createAsyncThunk(
  "admin/roundReportDeliveries",
  async (clientId: number, { rejectWithValue }) => {
    try {
      const { data } = await api.get<{ client_id: number; rounds: Record<number, ReportDeliveryRound> }>(
        `/admin/clients/${clientId}/round-report-deliveries`,
      );
      return { clientId, rounds: data.rounds ?? {} };
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Failed to load report deliveries"));
    }
  },
);

export const resendRoundReportPdf = createAsyncThunk<
  ResendRoundReportPdfResult,
  {
    pdfId: number;
    alsoEmail?: boolean;
    alsoSms?: boolean;
    attachPdf?: boolean;
    notifyPartners?: boolean;
  },
  { rejectValue: string }
>("admin/resendRoundReportPdf", async (args, { rejectWithValue }) => {
  try {
    const { data } = await api.post<ResendRoundReportPdfResult>(
      `/admin/round-report-pdfs/${args.pdfId}/resend`,
      {
        also_email: args.alsoEmail !== false,
        also_sms: args.alsoSms !== false,
        attach_pdf: args.attachPdf !== false,
        notify_partners: args.notifyPartners !== false,
      },
    );
    return data;
  } catch (err) {
    return rejectWithValue(
      formatAxiosError(err, "Could not resend round report"),
    );
  }
});

export const fetchConversations = createAsyncThunk("admin/convs", async () => {
  const { data } = await api.get("/admin/conversations");
  return data.conversations as Conversation[];
});

export const fetchConversationMessages = createAsyncThunk<
  { id: number; messages: ConversationMessage[] },
  { id: number }
>("admin/convMsgs", async ({ id }) => {
  const { data } = await api.get(`/admin/conversations/${id}/messages`);
  return { id, messages: data.messages };
});

export const sendConversationMessage = createAsyncThunk<
  { conversation_id: number },
  {
    client_id: number;
    channel: "sms";
    body: string;
  }
>("admin/sendConv", async (args) => {
  const { data } = await api.post("/admin/conversations/send", args);
  return data;
});

export const fetchAdminTickets = createAsyncThunk<
  AdminTicketsListResponse,
  | {
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    }
  | undefined
>("admin/tickets", async (args) => {
  const params: Record<string, string | number> = {};
  if (args?.status) params.status = args.status;
  if (args?.search) params.search = args.search;
  if (args?.page) params.page = args.page;
  if (args?.limit) params.limit = args.limit;
  const { data } = await api.get("/admin/tickets", { params });
  return data as AdminTicketsListResponse;
});

export const fetchAdminTicket = createAsyncThunk<any, { id: number }>(
  "admin/ticket",
  async ({ id }) => {
    const { data } = await api.get(`/admin/tickets/${id}`);
    return data;
  },
);

export const replyAdminTicket = createAsyncThunk<
  void,
  { ticketId: number; body: string; is_internal_note?: boolean }
>("admin/replyTicket", async ({ ticketId, body, is_internal_note }) => {
  await api.post(`/admin/tickets/${ticketId}/replies`, {
    body,
    is_internal_note,
  });
});

export const updateTicketStatus = createAsyncThunk<
  void,
  { ticketId: number; status: string }
>("admin/ticketStatus", async ({ ticketId, status }) => {
  await api.post(`/admin/tickets/${ticketId}/status`, { status });
});

export const fetchAdminFaqs = createAsyncThunk("admin/faqs", async () => {
  const { data } = await api.get("/admin/support-faq");
  return data.faqs as SupportFaq[];
});

export const createAdminFaq = createAsyncThunk<
  { id: number },
  {
    question: string;
    answer: string;
    category: string;
    sort_order?: number;
    is_active?: boolean;
  }
>("admin/createFaq", async (args) => {
  const { data } = await api.post("/admin/support-faq", args);
  return data;
});

export const updateAdminFaq = createAsyncThunk<
  void,
  {
    id: number;
    question?: string;
    answer?: string;
    category?: string;
    sort_order?: number;
    is_active?: boolean;
  }
>("admin/updateFaq", async ({ id, ...rest }) => {
  await api.put(`/admin/support-faq/${id}`, rest);
});

export const deleteAdminFaq = createAsyncThunk<void, number>(
  "admin/deleteFaq",
  async (id) => {
    await api.delete(`/admin/support-faq/${id}`);
  },
);

export const fetchTemplates = createAsyncThunk("admin/templates", async () => {
  const { data } = await api.get("/admin/templates");
  return data.templates as CommunicationTemplate[];
});

export const updateTemplate = createAsyncThunk<
  void,
  {
    id: number;
    name?: string;
    subject?: string;
    body?: string;
    is_active?: boolean;
  }
>("admin/updateTemplate", async ({ id, ...rest }) => {
  await api.post(`/admin/templates/${id}`, rest);
});

export const createTemplate = createAsyncThunk<
  { id: number },
  {
    slug: string;
    name: string;
    channel: string;
    subject?: string;
    body: string;
    variables?: string[];
  }
>("admin/createTemplate", async (args) => {
  const { data } = await api.post("/admin/templates", args);
  return data as { id: number };
});

export const deleteTemplate = createAsyncThunk<
  void,
  { id: number },
  { rejectValue: { error: string; flows: string[] } }
>("admin/deleteTemplate", async ({ id }, { rejectWithValue }) => {
  try {
    await api.delete(`/admin/templates/${id}`);
  } catch (e: any) {
    if (e?.response?.status === 409) {
      return rejectWithValue(
        e.response.data as { error: string; flows: string[] },
      );
    }
    throw e;
  }
});

export const fetchAdminVideos = createAsyncThunk("admin/videos", async () => {
  const { data } = await api.get("/admin/videos");
  return data.videos as EducationalVideo[];
});

export const uploadEducationalFile = createAsyncThunk<
  { url: string; mime_type: string; size: number },
  File
>("admin/uploadEducationalFile", async (file) => {
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await api.post("/admin/educational-content/upload", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
});

export const createVideo = createAsyncThunk<void, Partial<EducationalVideo>>(
  "admin/createVideo",
  async (args) => {
    await api.post("/admin/videos", args);
  },
);

export const updateVideo = createAsyncThunk<
  void,
  { id: number } & Partial<EducationalVideo>
>("admin/updateVideo", async ({ id, ...args }) => {
  await api.put(`/admin/videos/${id}`, args);
});

export const deleteVideo = createAsyncThunk<void, { id: number }>(
  "admin/deleteVideo",
  async ({ id }) => {
    await api.delete(`/admin/videos/${id}`);
  },
);

export const fetchSettings = createAsyncThunk("admin/settings", async () => {
  const { data } = await api.get("/admin/settings");
  return data.settings as SystemSetting[];
});

export const saveSetting = createAsyncThunk<
  void,
  { setting_key: string; setting_value: string }
>("admin/saveSetting", async (args) => {
  await api.post("/admin/settings", args);
});

export const fetchNotifyExtraEmails = createAsyncThunk<
  AdminNotifyRecipientsResponse,
  void,
  { rejectValue: string }
>("admin/notifyExtraEmails/fetch", async (_arg, { rejectWithValue }) => {
  try {
    const { data } = await api.get<AdminNotifyRecipientsResponse>(
      "/admin/notify-recipients",
    );
    return data;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Failed to load notification recipients"),
    );
  }
});

export const updateStaffNotifyPrefs = createAsyncThunk<
  AdminNotifyStaffRecipient,
  {
    id: number;
    channel_masters?: Partial<Record<AdminNotifyChannel, boolean>>;
    email?: Partial<Record<AdminNotifyEventKey, boolean>>;
    in_app?: Partial<Record<AdminNotifyEventKey, boolean>>;
    sms?: Partial<Record<AdminNotifyEventKey, boolean>>;
  },
  { rejectValue: string }
>("admin/notifyStaff/updatePrefs", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const { data } = await api.put(`/admin/admins/${id}/notification-prefs`, body);
    return data.staff as AdminNotifyStaffRecipient;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Failed to update staff notification prefs"),
    );
  }
});

export const addNotifyExtraEmail = createAsyncThunk<
  AdminNotifyExtraEmail,
  { email: string; label?: string },
  { rejectValue: string }
>("admin/notifyExtraEmails/add", async (args, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/admin/notify-extra-emails", args);
    return data.email as AdminNotifyExtraEmail;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Failed to add notification email"),
    );
  }
});

export const updateNotifyExtraEmail = createAsyncThunk<
  AdminNotifyExtraEmail,
  {
    id: number;
    email?: string;
    label?: string | null;
    is_active?: boolean;
    events?: AdminNotifyEventKey[] | null;
  },
  { rejectValue: string }
>("admin/notifyExtraEmails/update", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const { data } = await api.patch(`/admin/notify-extra-emails/${id}`, body);
    return data.email as AdminNotifyExtraEmail;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Failed to update notification email"),
    );
  }
});

export const deleteNotifyExtraEmail = createAsyncThunk<
  number,
  { id: number },
  { rejectValue: string }
>("admin/notifyExtraEmails/delete", async ({ id }, { rejectWithValue }) => {
  try {
    await api.delete(`/admin/notify-extra-emails/${id}`);
    return id;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Failed to remove notification email"),
    );
  }
});

export const fetchAdminReports = createAsyncThunk("admin/reports", async () => {
  const { data } = await api.get("/admin/reports");
  return data;
});

export const fetchAdminTeam = createAsyncThunk(
  "admin/team",
  async (params?: { search?: string; role?: string }) => {
    const { data } = await api.get("/admin/admins", { params });
    return data.admins as AdminUserListItem[];
  },
);

export const createAdminTeamMember = createAsyncThunk<
  void,
  {
    email: string;
    first_name: string;
    last_name: string;
    phone?: string;
    role: string;
    preferred_language?: "en" | "es";
    language_owner_for?: "en" | "es" | null;
  },
  { rejectValue: string }
>("admin/team/create", async (args, { rejectWithValue }) => {
  try {
    await api.post("/admin/admins", args);
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Failed to add team member"),
    );
  }
});

export const resendAdminWelcomeEmail = createAsyncThunk<
  { emailed: string },
  { id: number },
  { rejectValue: string }
>("admin/team/resendWelcome", async ({ id }, { rejectWithValue }) => {
  try {
    const { data } = await api.post(`/admin/admins/${id}/resend-welcome`);
    return { emailed: data.emailed as string };
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Failed to resend welcome email"),
    );
  }
});

export const updateAdminTeamMember = createAsyncThunk<
  void,
  {
    id: number;
    first_name?: string;
    last_name?: string;
    phone?: string;
    role?: string;
    status?: string;
    preferred_language?: "en" | "es";
    language_owner_for?: "en" | "es" | null;
  },
  { rejectValue: string }
>("admin/team/update", async ({ id, ...rest }) => {
  await api.put(`/admin/admins/${id}`, rest);
});

export const deleteAdminTeamMember = createAsyncThunk<void, { id: number }>(
  "admin/team/delete",
  async ({ id }) => {
    await api.delete(`/admin/admins/${id}`);
  },
);

export const fetchReferrers = createAsyncThunk<
  AdminReferrer[],
  { category?: string } | void,
  { rejectValue: string }
>("admin/referrers/fetch", async (args, { rejectWithValue }) => {
  try {
    const params: Record<string, string> = {};
    if (args && "category" in args && args.category) {
      params.category = args.category;
    }
    const { data } = await api.get("/admin/referrers", { params });
    return data.referrers as AdminReferrer[];
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Failed to load referrers"),
    );
  }
});

export type UpdateReferrerPayload = {
  id: number;
  category?: ReferralCategory;
  first_name?: string;
  last_name?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  affiliate_id?: number | null;
  preferred_language?: "en" | "es";
  notes?: string | null;
  status?: "active" | "inactive";
};

export const updateReferrer = createAsyncThunk<
  AdminReferrer,
  UpdateReferrerPayload,
  { rejectValue: string }
>("admin/referrers/update", async ({ id, ...rest }, { rejectWithValue }) => {
  try {
    const { data } = await api.put(`/admin/referrers/${id}`, rest);
    return data.referrer as AdminReferrer;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Failed to update referrer"),
    );
  }
});

/** Payload item for linking partners (existing id or inline create). */
export type ClientReferrerWriteItem = {
  referrer_id?: number;
  notify_on_round?: boolean;
  role?: string;
  category?: ReferralCategory;
  first_name?: string;
  last_name?: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  preferred_language?: "en" | "es";
};

export type ClientCmsCredentialsWrite = {
  smart_credit?: { email?: string | null; password?: string | null };
  myfreescorenow?: { email?: string | null; password?: string | null };
};

export const fetchClientReferrers = createAsyncThunk<
  ClientReferrerLink[],
  { clientId: number },
  { rejectValue: string }
>("admin/clients/referrers/fetch", async ({ clientId }, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/admin/clients/${clientId}/referrers`);
    return data.referrers as ClientReferrerLink[];
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Failed to load client referrers"),
    );
  }
});

export const replaceClientReferrers = createAsyncThunk<
  ClientReferrerLink[],
  { clientId: number; referrers: ClientReferrerWriteItem[] },
  { rejectValue: string }
>(
  "admin/clients/referrers/replace",
  async ({ clientId, referrers }, { rejectWithValue }) => {
    try {
      const { data } = await api.put(`/admin/clients/${clientId}/referrers`, {
        referrers,
      });
      return data.referrers as ClientReferrerLink[];
    } catch (err: unknown) {
      return rejectWithValue(
        formatAxiosError(err, "Failed to save referral partners"),
      );
    }
  },
);

export const fetchClientCmsCredentials = createAsyncThunk<
  {
    credentials: ClientCmsCredentialsPublic;
    secrets?: ClientCmsCredentialsSecrets;
  },
  { clientId: number; includeSecrets?: boolean },
  { rejectValue: string }
>(
  "admin/clients/cmsCredentials/fetch",
  async ({ clientId, includeSecrets }, { rejectWithValue }) => {
    try {
      const { data } = await api.get(
        `/admin/clients/${clientId}/cms-credentials`,
        {
          params: includeSecrets
            ? { include_secrets: 1, confirm_reveal: 1 }
            : undefined,
        },
      );
      return {
        credentials: data.credentials as ClientCmsCredentialsPublic,
        secrets: data.secrets as ClientCmsCredentialsSecrets | undefined,
      };
    } catch (err: unknown) {
      return rejectWithValue(
        formatAxiosError(err, "Failed to load CMS credentials"),
      );
    }
  },
);

export const saveClientCmsCredentials = createAsyncThunk<
  ClientCmsCredentialsPublic,
  { clientId: number; credentials: ClientCmsCredentialsWrite },
  { rejectValue: string }
>(
  "admin/clients/cmsCredentials/save",
  async ({ clientId, credentials }, { rejectWithValue }) => {
    try {
      const { data } = await api.put(
        `/admin/clients/${clientId}/cms-credentials`,
        credentials,
      );
      return data.credentials as ClientCmsCredentialsPublic;
    } catch (err: unknown) {
      return rejectWithValue(
        formatAxiosError(err, "Failed to save CMS credentials"),
      );
    }
  },
);

export const createAdminClient = createAsyncThunk<
  AdminClientListItem,
  {
    first_name: string;
    last_name: string;
    email?: string | null;
    phone?: string | null;
    package_id?: number | null;
    status?: string;
    admin_notes?: string | null;
    preferred_language?: "en" | "es";
    referral_category?: ReferralCategory | null;
    referrer_id?: number | null;
    referrers?: ClientReferrerWriteItem[];
    cms_credentials?: ClientCmsCredentialsWrite;
    /** When true (or when round_schedule has dates), create a credit repair case. */
    create_case?: boolean;
    round_schedule?: RoundScheduleInput | null;
  },
  { rejectValue: string }
>("admin/clients/create", async (args, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/admin/clients", args);
    return data.client as AdminClientListItem;
  } catch (err: unknown) {
    return rejectWithValue(formatAxiosError(err, "Failed to create client"));
  }
});

/** Prospect traffic light: mark analysis reviewed / schedule a call. */
export const updateLeadSignals = createAsyncThunk<
  LeadSignalsResponse,
  { id: number; analysis_reviewed?: boolean; call_scheduled_at?: string | null },
  { rejectValue: string }
>("admin/clients/leadSignals", async ({ id, ...body }, { rejectWithValue }) => {
  try {
    const { data } = await api.post<LeadSignalsResponse>(
      `/admin/clients/${id}/lead-signals`,
      body,
    );
    return data;
  } catch (err: unknown) {
    return rejectWithValue(formatAxiosError(err, "Could not update the prospect"));
  }
});

export const addAdminClientNote = createAsyncThunk<
  AdminClientNoteResponse,
  { id: number; note: string },
  { rejectValue: string }
>("admin/clients/addNote", async ({ id, note }, { rejectWithValue }) => {
  try {
    const { data } = await api.post<AdminClientNoteResponse>(
      `/admin/clients/${id}/notes`,
      { note },
    );
    return data;
  } catch (err: unknown) {
    return rejectWithValue(formatAxiosError(err, "Failed to add note"));
  }
});

export const setAdminClientPaused = createAsyncThunk<
  AdminClientPauseResponse,
  {
    id: number;
    paused: boolean;
    reason?: string;
    /** When paused=true: which hold to apply (default paused). */
    holdStatus?: "paused" | "blocked";
  },
  { rejectValue: string }
>(
  "admin/clients/setPaused",
  async ({ id, paused, reason, holdStatus }, { rejectWithValue }) => {
    try {
      const { data } = await api.post<AdminClientPauseResponse>(
        `/admin/clients/${id}/pause`,
        { paused, reason: reason || "", hold_status: holdStatus || "paused" },
      );
      return data;
    } catch (err: unknown) {
      return rejectWithValue(
        formatAxiosError(err, "Failed to update client status"),
      );
    }
  },
);

export const updateAdminClient = createAsyncThunk<
  AdminClientListItem,
  {
    id: number;
    first_name?: string;
    last_name?: string;
    email?: string | null;
    phone?: string | null;
    package_id?: number | null;
    status?: string;
    admin_notes?: string | null;
    preferred_language?: "en" | "es";
    referral_category?: ReferralCategory | null;
    referrer_id?: number | null;
    referrers?: ClientReferrerWriteItem[];
    cms_credentials?: ClientCmsCredentialsWrite;
  },
  { rejectValue: string }
>("admin/clients/update", async ({ id, ...rest }, { rejectWithValue }) => {
  try {
    const { data } = await api.put(`/admin/clients/${id}`, rest);
    return data.client as AdminClientListItem;
  } catch (err: unknown) {
    return rejectWithValue(formatAxiosError(err, "Failed to update client"));
  }
});

export const deleteAdminClient = createAsyncThunk<void, { id: number }>(
  "admin/clients/delete",
  async ({ id }) => {
    await api.delete(`/admin/clients/${id}`);
  },
);

export const fetchAdminCoupons = createAsyncThunk<Coupon[], void>(
  "admin/coupons/fetch",
  async () => {
    const { data } = await api.get("/admin/coupons");
    return data.coupons as Coupon[];
  },
);

export const createAdminCoupon = createAsyncThunk<Coupon, CreateCouponPayload>(
  "admin/coupons/create",
  async (payload) => {
    const { data } = await api.post("/admin/coupons", payload);
    return data.coupon as Coupon;
  },
);

export const updateAdminCoupon = createAsyncThunk<
  Coupon,
  { id: number } & UpdateCouponPayload
>("admin/coupons/update", async ({ id, ...rest }) => {
  const { data } = await api.put(`/admin/coupons/${id}`, rest);
  return data.coupon as Coupon;
});

export const deleteAdminCoupon = createAsyncThunk<void, { id: number }>(
  "admin/coupons/delete",
  async ({ id }) => {
    await api.delete(`/admin/coupons/${id}`);
  },
);

export const fetchAdminTradelineProducts = createAsyncThunk<
  TradelineProduct[],
  void
>("admin/tradelineProducts/fetch", async () => {
  const { data } = await api.get("/admin/tradeline-products");
  return data.products as TradelineProduct[];
});

export const createTradelineProduct = createAsyncThunk<
  TradelineProduct,
  TradelineProductInput
>("admin/tradelineProducts/create", async (payload) => {
  const { data } = await api.post("/admin/tradeline-products", payload);
  return data.product as TradelineProduct;
});

export const updateTradelineProduct = createAsyncThunk<
  TradelineProduct,
  { id: number } & TradelineProductInput
>("admin/tradelineProducts/update", async ({ id, ...rest }) => {
  const { data } = await api.put(`/admin/tradeline-products/${id}`, rest);
  return data.product as TradelineProduct;
});

export const deleteTradelineProduct = createAsyncThunk<void, number>(
  "admin/tradelineProducts/delete",
  async (id) => {
    await api.delete(`/admin/tradeline-products/${id}`);
  },
);

export const adminValidateCoupon = createAsyncThunk<
  CouponValidateResponse,
  { code: string; package_id?: number; amount_cents?: number }
>("admin/coupons/validate", async (payload) => {
  const { data } = await api.post<CouponValidateResponse>(
    "/validate-coupon",
    payload,
  );
  return data;
});

export const fetchAdminPayments = createAsyncThunk<
  AdminPaymentsResponse,
  | {
      status?: string;
      search?: string;
      provider?: string;
      page?: number;
      limit?: number;
    }
  | undefined
>("admin/payments", async (args) => {
  const params: any = {};
  if (args?.status) params.status = args.status;
  if (args?.search) params.search = args.search;
  if (args?.provider) params.provider = args.provider;
  if (args?.page) params.page = args.page;
  if (args?.limit) params.limit = args.limit;
  const { data } = await api.get("/admin/payments", { params });
  return data as AdminPaymentsResponse;
});

export const fetchAdminSubscriptions = createAsyncThunk<
  AdminSubscriptionsResponse,
  | {
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    }
  | undefined
>("admin/subscriptions", async (args) => {
  const params: Record<string, string | number> = {};
  if (args?.status) params.status = args.status;
  if (args?.search) params.search = args.search;
  if (args?.page) params.page = args.page;
  if (args?.limit) params.limit = args.limit;
  const { data } = await api.get("/admin/subscriptions", { params });
  return data as AdminSubscriptionsResponse;
});

// ── Cases ──────────────────────────────────────────────────────────────────
export const createAdminCase = createAsyncThunk(
  "admin/createAdminCase",
  async (payload: CreateCasePayload, { rejectWithValue }) => {
    try {
      const { data } = await api.post("/admin/cases", payload);
      return data.case;
    } catch (e: any) {
      return rejectWithValue(
        e?.response?.data?.error ?? e?.message ?? "Failed to create case",
      );
    }
  },
);

export const fetchCaseRoundSchedule = createAsyncThunk(
  "admin/fetchCaseRoundSchedule",
  async (caseId: number) => {
    const { data } = await api.get(`/admin/cases/${caseId}/round-schedule`);
    return data.schedule as import("@shared/api").CaseRoundSchedule | null;
  },
);

export const saveCaseRoundSchedule = createAsyncThunk(
  "admin/saveCaseRoundSchedule",
  async ({
    caseId,
    schedule,
  }: {
    caseId: number;
    schedule: import("@shared/api").RoundScheduleInput;
  }) => {
    const { data } = await api.put(`/admin/cases/${caseId}/round-schedule`, schedule);
    return data as {
      schedule: import("@shared/api").CaseRoundSchedule;
      sent_to: string[];
      send_errors: string[];
    };
  },
);

export const sendCaseRoundCalendar = createAsyncThunk(
  "admin/sendCaseRoundCalendar",
  async (caseId: number) => {
    const { data } = await api.post(
      `/admin/cases/${caseId}/round-schedule/send`,
    );
    return data as { sent_to: string[]; send_errors: string[] };
  },
);

// ── Payment Splits (per case) ──────────────────────────────────────────────
export const fetchCaseSplits = createAsyncThunk(
  "admin/fetchCaseSplits",
  async (caseId: number) => {
    const { data } = await api.get(`/admin/cases/${caseId}/splits`);
    return data.splits as PaymentSplit[];
  },
);

export const createCaseSplit = createAsyncThunk(
  "admin/createCaseSplit",
  async ({ caseId, split }: { caseId: number; split: any }) => {
    const { data } = await api.post(`/admin/cases/${caseId}/splits`, split);
    return data.split as PaymentSplit;
  },
);

export const updateCaseSplit = createAsyncThunk(
  "admin/updateCaseSplit",
  async ({
    caseId,
    splitId,
    updates,
  }: {
    caseId: number;
    splitId: number;
    updates: any;
  }) => {
    const { data } = await api.put(
      `/admin/cases/${caseId}/splits/${splitId}`,
      updates,
    );
    return data.split as PaymentSplit;
  },
);

export const deleteCaseSplit = createAsyncThunk(
  "admin/deleteCaseSplit",
  async ({ caseId, splitId }: { caseId: number; splitId: number }) => {
    await api.delete(`/admin/cases/${caseId}/splits/${splitId}`);
    return splitId;
  },
);

export const markSplitPaid = createAsyncThunk(
  "admin/markSplitPaid",
  async ({ caseId, splitId }: { caseId: number; splitId: number }) => {
    const { data } = await api.put(`/admin/cases/${caseId}/splits/${splitId}`, {
      status: "paid",
      completion_source: "manual",
    });
    return data.split as PaymentSplit;
  },
);

// ── Payment Splits overview (all cases) ───────────────────────────────────
export const fetchAdminPaymentSplits = createAsyncThunk(
  "admin/fetchAdminPaymentSplits",
  async (args?: { status?: string; page?: number; limit?: number }) => {
    const params: any = {};
    if (args?.status) params.status = args.status;
    if (args?.page) params.page = args.page;
    if (args?.limit) params.limit = args.limit;
    const { data } = await api.get("/admin/payment-splits", { params });
    return data;
  },
);

// ── Calendar ──────────────────────────────────────────────────────────────
export const fetchAdminCalendar = createAsyncThunk(
  "admin/fetchAdminCalendar",
  async ({ from, to }: { from: string; to: string }) => {
    const { data } = await api.get<AdminCalendarResponse>("/admin/calendar", {
      params: { from, to },
    });
    return normalizeAdminCalendarResponse(data);
  },
);

const slice = createSlice({
  name: "admin",
  initialState,
  reducers: {
    clearPanelClient(s) {
      s.panelClient = null;
      s.caseDocuments = [];
    },
    clearCouponPreview(s) {
      s.couponPreview = null;
      s.couponPreviewing = false;
    },
  },
  extraReducers: (b) => {
    // ── loading flag (pending + rejected only — fulfilled handled per-case) ──
    const setLoading = (s: AdminState) => {
      s.loading = true;
    };
    const clearLoading = (s: AdminState) => {
      s.loading = false;
    };
    [
      fetchAdminTeam,
      fetchAdminDashboard,
      fetchAdminReports,
      fetchSettings,
      fetchTemplates,
      fetchAdminVideos,
    ].forEach((thunk) => {
      b.addCase(thunk.pending, setLoading);
      b.addCase(thunk.rejected, clearLoading);
    });

    b.addCase(fetchAdminClients.pending, (s) => {
      s.clientsLoading = true;
    });
    b.addCase(fetchAdminClients.rejected, (s) => {
      s.clientsLoading = false;
    });
    b.addCase(exportAdminClientsCsv.pending, (s) => {
      s.clientsExporting = true;
    });
    b.addCase(exportAdminClientsCsv.fulfilled, (s) => {
      s.clientsExporting = false;
    });
    b.addCase(exportAdminClientsCsv.rejected, (s) => {
      s.clientsExporting = false;
    });
    b.addCase(fetchAllDocuments.pending, (s) => {
      s.documentsLoading = true;
    });
    b.addCase(fetchAllDocuments.rejected, (s) => {
      s.documentsLoading = false;
    });
    b.addCase(fetchAdminTickets.pending, (s) => {
      s.ticketsLoading = true;
    });
    b.addCase(fetchAdminTickets.rejected, (s) => {
      s.ticketsLoading = false;
    });

    b.addCase(fetchPipeline.pending, (s) => {
      s.pipelineLoading = true;
    });
    b.addCase(fetchPipeline.rejected, (s) => {
      s.pipelineLoading = false;
    });
    b.addCase(fetchPipeline.fulfilled, (s, a) => {
      s.pipelineLoading = false;
      s.pipelineCases = a.payload.cases ?? [];
      s.pipelineProspects = a.payload.prospects ?? [];
      s.pipelineColumns = a.payload.columns ?? {};
      s.pipelinePageLimit = a.payload.limit ?? 20;
    });
    b.addCase(fetchMorePipelineColumn.pending, (s, a) => {
      s.pipelineLoadingMore = a.meta.arg.column;
    });
    b.addCase(fetchMorePipelineColumn.rejected, (s) => {
      s.pipelineLoadingMore = null;
    });
    b.addCase(fetchMorePipelineColumn.fulfilled, (s, a) => {
      s.pipelineLoadingMore = null;
      const colKey = a.payload.column;
      const prev = s.pipelineColumns[colKey] ?? {
        items: [],
        total: 0,
        offset: 0,
        limit: a.payload.limit,
        has_more: false,
      };
      const seen = new Set(
        (prev.items as Array<{ id: number }>).map((x) => x.id),
      );
      const appended = (a.payload.items as Array<{ id: number }>).filter(
        (x) => !seen.has(x.id),
      );
      s.pipelineColumns[colKey] = {
        items: [...prev.items, ...appended] as any,
        total: a.payload.total,
        offset: a.payload.offset,
        limit: a.payload.limit,
        has_more: a.payload.has_more,
      };
      if (colKey === "prospect") {
        const pSeen = new Set(s.pipelineProspects.map((p) => p.id));
        s.pipelineProspects = [
          ...s.pipelineProspects,
          ...(a.payload.items as Prospect[]).filter((p) => !pSeen.has(p.id)),
        ];
      } else {
        const cSeen = new Set(s.pipelineCases.map((c) => c.id));
        s.pipelineCases = [
          ...s.pipelineCases,
          ...(a.payload.items as CreditRepairCase[]).filter(
            (c) => !cSeen.has(c.id),
          ),
        ];
      }
    });

    b.addCase(fetchAdminDashboard.fulfilled, (s, a) => {
      s.loading = false;
      s.dashboardLoaded = true;
      s.dashboardRefreshing = false;
      s.dashboard = {
        ...a.payload,
        scope: a.payload.scope ?? "everyone",
        is_super: !!a.payload.is_super,
        inbox: a.payload.inbox ?? [],
        pulse: a.payload.pulse ?? null,
        activity: a.payload.activity ?? [],
        upcoming_rounds: a.payload.upcoming_rounds ?? [],
        my_work_tasks: a.payload.my_work_tasks ?? [],
      };
    });
    b.addCase(fetchAdminClients.fulfilled, (s, a) => {
      s.clientsLoading = false;
      s.clients = a.payload.clients;
      s.clientsPagination = a.payload.pagination;
      if (a.meta.arg) s.clientsListQuery = a.meta.arg;
    });
    b.addCase(searchClients.pending, (s) => {
      s.clientSearchLoading = true;
    });
    b.addCase(searchClients.rejected, (s) => {
      s.clientSearchLoading = false;
    });
    b.addCase(searchClients.fulfilled, (s, a) => {
      s.clientSearchLoading = false;
      s.clientSearchResults = a.payload;
    });
    b.addCase(fetchReferrers.pending, (s) => {
      s.referrersLoading = true;
    });
    b.addCase(fetchReferrers.rejected, (s) => {
      s.referrersLoading = false;
    });
    b.addCase(fetchReferrers.fulfilled, (s, a) => {
      s.referrersLoading = false;
      s.referrers = a.payload;
    });
    b.addCase(updateReferrer.fulfilled, (s, a) => {
      const idx = s.referrers.findIndex((r) => r.id === a.payload.id);
      if (idx !== -1) s.referrers[idx] = a.payload;
      s.clientReferrers = s.clientReferrers.map((link) =>
        link.referrer_id === a.payload.id
          ? { ...link, referrer: a.payload }
          : link,
      );
    });
    b.addCase(fetchClientReferrers.pending, (s) => {
      s.clientReferrersLoading = true;
      s.clientReferrers = [];
    });
    b.addCase(fetchClientReferrers.rejected, (s) => {
      s.clientReferrersLoading = false;
    });
    b.addCase(fetchClientReferrers.fulfilled, (s, a) => {
      s.clientReferrersLoading = false;
      s.clientReferrers = a.payload;
    });
    b.addCase(replaceClientReferrers.pending, (s) => {
      s.clientReferrersSaving = true;
    });
    b.addCase(replaceClientReferrers.rejected, (s) => {
      s.clientReferrersSaving = false;
    });
    b.addCase(replaceClientReferrers.fulfilled, (s, a) => {
      s.clientReferrersSaving = false;
      s.clientReferrers = a.payload;
    });
    b.addCase(fetchAdminClient.fulfilled, (s, a) => {
      s.selectedClient = a.payload;
    });
    b.addCase(fetchPanelClient.pending, (s) => {
      s.panelLoading = true;
    });
    b.addCase(fetchPanelClient.fulfilled, (s, a) => {
      s.panelClient = a.payload;
      s.panelLoading = false;
    });
    b.addCase(fetchPanelClient.rejected, (s) => {
      s.panelLoading = false;
    });
    b.addCase(fetchPanelCase.pending, (s) => {
      s.panelLoading = true;
    });
    b.addCase(fetchPanelCase.fulfilled, (s, a) => {
      s.panelClient = a.payload;
      s.panelLoading = false;
    });
    b.addCase(fetchPanelCase.rejected, (s) => {
      s.panelLoading = false;
    });
    b.addCase(fetchPendingDocuments.fulfilled, (s, a) => {
      s.pendingDocuments = a.payload;
    });
    b.addCase(fetchAllDocuments.fulfilled, (s, a) => {
      s.documentsLoading = false;
      s.allDocuments = a.payload.documents;
      s.documentsPagination = a.payload.pagination;
      s.documentsStatusCounts = a.payload.status_counts;
    });
    b.addCase(fetchCaseDocuments.pending, (s) => {
      s.caseDocumentsLoading = true;
    });
    b.addCase(fetchCaseDocuments.rejected, (s) => {
      s.caseDocumentsLoading = false;
    });
    b.addCase(fetchCaseDocuments.fulfilled, (s, a) => {
      s.caseDocumentsLoading = false;
      s.caseDocuments = a.payload.documents;
    });
    b.addCase(uploadCaseDocuments.pending, (s) => {
      s.caseDocumentsUploading = true;
    });
    b.addCase(uploadCaseDocuments.rejected, (s) => {
      s.caseDocumentsUploading = false;
    });
    b.addCase(uploadCaseDocuments.fulfilled, (s, a) => {
      s.caseDocumentsUploading = false;
      const incoming = a.payload.documents ?? [];
      const existingIds = new Set(s.caseDocuments.map((d) => d.id));
      const merged = [
        ...incoming.filter((d: { id: number }) => !existingIds.has(d.id)),
        ...s.caseDocuments,
      ];
      s.caseDocuments = merged;
    });
    b.addCase(deleteCaseDocument.fulfilled, (s, a) => {
      s.caseDocuments = s.caseDocuments.filter((d) => d.id !== a.payload.id);
    });
    b.addCase(deleteArchiveDocument.fulfilled, (s, a) => {
      s.allDocuments = s.allDocuments.filter((d: any) => d.id !== a.payload.id);
      if (s.documentsPagination) {
        s.documentsPagination = {
          ...s.documentsPagination,
          total: Math.max(0, Number(s.documentsPagination.total || 0) - 1),
        };
      }
    });
    b.addCase(fetchConversations.fulfilled, (s, a) => {
      s.conversations = a.payload;
    });
    b.addCase(fetchConversationMessages.fulfilled, (s, a) => {
      s.conversationMessages[a.payload.id] = a.payload.messages;
    });
    b.addCase(fetchAdminTickets.fulfilled, (s, a) => {
      s.ticketsLoading = false;
      s.tickets = a.payload.tickets;
      s.ticketsPagination = a.payload.pagination;
    });
    b.addCase(fetchAdminTicket.fulfilled, (s, a) => {
      s.selectedTicket = a.payload.ticket;
      s.ticketReplies = a.payload.replies;
    });
    b.addCase(fetchAdminFaqs.fulfilled, (s, a) => {
      s.faqs = a.payload;
    });
    b.addCase(createAdminFaq.fulfilled, (_s, _a) => {
      /* refetch after create */
    });
    b.addCase(updateAdminFaq.fulfilled, (_s, _a) => {
      /* refetch after update */
    });
    b.addCase(deleteAdminFaq.fulfilled, (s, a) => {
      s.faqs = s.faqs.filter((f) => f.id !== (a.meta.arg as number));
    });
    b.addCase(fetchTemplates.fulfilled, (s, a) => {
      s.loading = false;
      s.templates = a.payload;
    });
    b.addCase(deleteTemplate.fulfilled, (s, a) => {
      const id = (a.meta.arg as { id: number }).id;
      s.templates = s.templates.filter((t) => t.id !== id);
    });
    b.addCase(fetchAdminVideos.fulfilled, (s, a) => {
      s.loading = false;
      s.videos = a.payload;
    });
    b.addCase(fetchSettings.fulfilled, (s, a) => {
      s.loading = false;
      s.settings = a.payload;
    });
    b.addCase(fetchNotifyExtraEmails.pending, (s) => {
      s.notifyExtraEmailsLoading = true;
      s.notifyExtraEmailsError = null;
    });
    b.addCase(fetchNotifyExtraEmails.fulfilled, (s, a) => {
      s.notifyExtraEmailsLoading = false;
      // Skip staff overwrite while an optimistic prefs PUT is in flight.
      if (!s.notifyExtraEmailsSaving) {
        s.notifyStaff = a.payload.staff || [];
      }
      s.notifyExtraEmails = a.payload.extras || [];
    });
    b.addCase(fetchNotifyExtraEmails.rejected, (s, a) => {
      s.notifyExtraEmailsLoading = false;
      s.notifyExtraEmailsError = a.payload || "Failed";
    });
    b.addCase(updateStaffNotifyPrefs.pending, (s, a) => {
      s.notifyExtraEmailsSaving = true;
      s.notifyExtraEmailsError = null;
      // Optimistic: controlled Switches stay Off while PUT is in flight.
      // Without this, checked={old} + disabled snaps the toggle back On.
      s.notifyStaffPrefsSnapshot = s.notifyStaff.map((row) => ({
        ...row,
        prefs: {
          email: { ...row.prefs.email },
          in_app: { ...row.prefs.in_app },
          sms: { ...row.prefs.sms },
        },
      }));
      const { id, ...patch } = a.meta.arg;
      s.notifyStaff = s.notifyStaff.map((row) =>
        row.id === id
          ? { ...row, prefs: applyAdminNotifyPrefsPatch(row.prefs, patch) }
          : row,
      );
    });
    b.addCase(updateStaffNotifyPrefs.fulfilled, (s, a) => {
      s.notifyExtraEmailsSaving = false;
      s.notifyStaffPrefsSnapshot = null;
      s.notifyStaff = s.notifyStaff.map((row) =>
        row.id === a.payload.id ? { ...row, ...a.payload } : row,
      );
    });
    b.addCase(updateStaffNotifyPrefs.rejected, (s, a) => {
      s.notifyExtraEmailsSaving = false;
      s.notifyExtraEmailsError = a.payload || "Failed";
      if (s.notifyStaffPrefsSnapshot) {
        s.notifyStaff = s.notifyStaffPrefsSnapshot;
        s.notifyStaffPrefsSnapshot = null;
      }
    });
    b.addCase(addNotifyExtraEmail.pending, (s) => {
      s.notifyExtraEmailsSaving = true;
      s.notifyExtraEmailsError = null;
    });
    b.addCase(addNotifyExtraEmail.fulfilled, (s, a) => {
      s.notifyExtraEmailsSaving = false;
      const idx = s.notifyExtraEmails.findIndex((e) => e.id === a.payload.id);
      if (idx >= 0) s.notifyExtraEmails[idx] = a.payload;
      else s.notifyExtraEmails = [...s.notifyExtraEmails, a.payload];
    });
    b.addCase(addNotifyExtraEmail.rejected, (s, a) => {
      s.notifyExtraEmailsSaving = false;
      s.notifyExtraEmailsError = a.payload || "Failed";
    });
    b.addCase(updateNotifyExtraEmail.pending, (s) => {
      s.notifyExtraEmailsSaving = true;
      s.notifyExtraEmailsError = null;
    });
    b.addCase(updateNotifyExtraEmail.fulfilled, (s, a) => {
      s.notifyExtraEmailsSaving = false;
      s.notifyExtraEmails = s.notifyExtraEmails.map((e) =>
        e.id === a.payload.id ? a.payload : e,
      );
    });
    b.addCase(updateNotifyExtraEmail.rejected, (s, a) => {
      s.notifyExtraEmailsSaving = false;
      s.notifyExtraEmailsError = a.payload || "Failed";
    });
    b.addCase(deleteNotifyExtraEmail.pending, (s) => {
      s.notifyExtraEmailsSaving = true;
      s.notifyExtraEmailsError = null;
    });
    b.addCase(deleteNotifyExtraEmail.fulfilled, (s, a) => {
      s.notifyExtraEmailsSaving = false;
      s.notifyExtraEmails = s.notifyExtraEmails.filter((e) => e.id !== a.payload);
    });
    b.addCase(deleteNotifyExtraEmail.rejected, (s, a) => {
      s.notifyExtraEmailsSaving = false;
      s.notifyExtraEmailsError = a.payload || "Failed";
    });
    b.addCase(fetchAdminReports.fulfilled, (s, a) => {
      s.loading = false;
      s.reports = a.payload;
    });
    b.addCase(fetchAdminTeam.fulfilled, (s, a) => {
      s.loading = false;
      s.team = a.payload;
    });
    b.addCase(createAdminClient.fulfilled, () => {
      /* list refresh via refetchAdminClients / onSaved */
    });
    b.addCase(updateAdminClient.fulfilled, (s, a) => {
      const idx = s.clients.findIndex((c) => c.id === a.payload.id);
      if (idx !== -1) s.clients[idx] = a.payload;
      if (s.selectedClient?.client?.id === a.payload.id) {
        s.selectedClient.client = { ...s.selectedClient.client, ...a.payload };
      }
    });
    b.addCase(deleteAdminClient.fulfilled, (s, a) => {
      const id = a.meta.arg.id;
      s.clients = s.clients.filter((c) => c.id !== id);
      if (s.clientsPagination) {
        s.clientsPagination.total = Math.max(0, s.clientsPagination.total - 1);
        s.clientsPagination.totalPages = Math.max(
          1,
          Math.ceil(s.clientsPagination.total / s.clientsPagination.limit),
        );
      }
    });
    b.addCase(fetchAdminPayments.pending, (s) => {
      s.paymentsLoading = true;
    });
    b.addCase(fetchAdminPayments.rejected, (s) => {
      s.paymentsLoading = false;
    });
    b.addCase(fetchAdminPayments.fulfilled, (s, a) => {
      s.paymentsLoading = false;
      s.payments = a.payload.payments;
      s.paymentsSummary = a.payload.summary;
      s.paymentsPagination = a.payload.pagination;
    });
    b.addCase(fetchAdminSubscriptions.pending, (s) => {
      s.subscriptionsLoading = true;
    });
    b.addCase(fetchAdminSubscriptions.rejected, (s) => {
      s.subscriptionsLoading = false;
    });
    b.addCase(fetchAdminSubscriptions.fulfilled, (s, a) => {
      s.subscriptionsLoading = false;
      s.subscriptions = a.payload.subscriptions;
      s.subscriptionsSummary = a.payload.summary;
      s.subscriptionsPagination = a.payload.pagination;
    });
    b.addCase(fetchAdminCoupons.fulfilled, (s, a) => {
      s.coupons = a.payload;
    });
    b.addCase(createAdminCoupon.pending, (s) => {
      s.couponsSaving = true;
    });
    b.addCase(createAdminCoupon.rejected, (s) => {
      s.couponsSaving = false;
    });
    b.addCase(createAdminCoupon.fulfilled, (s, a) => {
      s.couponsSaving = false;
      s.coupons.unshift(a.payload);
    });
    b.addCase(updateAdminCoupon.pending, (s) => {
      s.couponsSaving = true;
    });
    b.addCase(updateAdminCoupon.rejected, (s) => {
      s.couponsSaving = false;
    });
    b.addCase(updateAdminCoupon.fulfilled, (s, a) => {
      s.couponsSaving = false;
      const idx = s.coupons.findIndex((c) => c.id === a.payload.id);
      if (idx !== -1) s.coupons[idx] = a.payload;
    });
    b.addCase(deleteAdminCoupon.fulfilled, (s, a) => {
      s.coupons = s.coupons.filter((c) => c.id !== a.meta.arg.id);
    });
    b.addCase(adminValidateCoupon.pending, (s) => {
      s.couponPreviewing = true;
      s.couponPreview = null;
    });
    b.addCase(adminValidateCoupon.rejected, (s) => {
      s.couponPreviewing = false;
    });
    b.addCase(adminValidateCoupon.fulfilled, (s, a) => {
      s.couponPreviewing = false;
      s.couponPreview = a.payload;
    });
    b.addCase(fetchSectionLocks.pending, (s) => {
      s.sectionLocksLoading = true;
    });
    b.addCase(fetchSectionLocks.rejected, (s) => {
      s.sectionLocksLoading = false;
    });
    b.addCase(fetchSectionLocks.fulfilled, (s, a) => {
      s.sectionLocks = a.payload;
      s.sectionLocksLoading = false;
      s.sectionLocksInitialized = true;
    });
    b.addCase(updateSectionLock.pending, (s) => {
      s.sectionLocksSaving = true;
    });
    b.addCase(updateSectionLock.rejected, (s) => {
      s.sectionLocksSaving = false;
    });
    b.addCase(updateSectionLock.fulfilled, (s, a) => {
      s.sectionLocksSaving = false;
      const idx = s.sectionLocks.findIndex(
        (l) => l.section_key === a.payload.section_key,
      );
      if (idx !== -1) s.sectionLocks[idx] = a.payload;
      else s.sectionLocks.push(a.payload);
    });
    // Payment splits
    b.addCase(fetchCaseSplits.pending, (s) => {
      s.caseSplitsLoading = true;
    });
    b.addCase(fetchCaseSplits.rejected, (s) => {
      s.caseSplitsLoading = false;
    });
    b.addCase(fetchCaseSplits.fulfilled, (s, a) => {
      s.caseSplitsLoading = false;
      s.caseSplits = a.payload;
    });
    b.addCase(createCaseSplit.fulfilled, (s, a) => {
      s.caseSplits.push(a.payload);
    });
    b.addCase(updateCaseSplit.fulfilled, (s, a) => {
      const idx = s.caseSplits.findIndex((sp) => sp.id === a.payload.id);
      if (idx !== -1) s.caseSplits[idx] = a.payload;
      const idx2 = s.paymentSplits.findIndex((sp) => sp.id === a.payload.id);
      if (idx2 !== -1) s.paymentSplits[idx2] = a.payload as any;
      const idx3 = s.calendarSplits.findIndex((sp) => sp.id === a.payload.id);
      if (idx3 !== -1) {
        s.calendarSplits[idx3] = {
          ...s.calendarSplits[idx3],
          label: a.payload.label,
          amount_cents: a.payload.amount_cents,
          due_date: a.payload.due_date,
          status: a.payload.status,
          completion_source: a.payload.completion_source,
        };
      }
    });
    b.addCase(markSplitPaid.fulfilled, (s, a) => {
      const idx = s.caseSplits.findIndex((sp) => sp.id === a.payload.id);
      if (idx !== -1) s.caseSplits[idx] = a.payload;
      const idx2 = s.paymentSplits.findIndex((sp) => sp.id === a.payload.id);
      if (idx2 !== -1) s.paymentSplits[idx2] = a.payload;
      const idx3 = s.calendarSplits.findIndex((sp) => sp.id === a.payload.id);
      if (idx3 !== -1) {
        s.calendarSplits[idx3] = {
          ...s.calendarSplits[idx3],
          status: a.payload.status,
          completion_source: a.payload.completion_source,
        };
      }
    });
    b.addCase(deleteCaseSplit.fulfilled, (s, a) => {
      s.caseSplits = s.caseSplits.filter((sp) => sp.id !== a.payload);
      s.paymentSplits = s.paymentSplits.filter((sp) => sp.id !== a.payload);
      s.calendarSplits = s.calendarSplits.filter((sp) => sp.id !== a.payload);
    });
    b.addCase(fetchAdminPaymentSplits.pending, (s) => {
      s.paymentSplitsLoading = true;
    });
    b.addCase(fetchAdminPaymentSplits.rejected, (s) => {
      s.paymentSplitsLoading = false;
    });
    b.addCase(fetchAdminPaymentSplits.fulfilled, (s, a) => {
      s.paymentSplitsLoading = false;
      s.paymentSplits = a.payload.splits;
      s.paymentSplitsPagination = a.payload.pagination;
    });
    b.addCase(fetchAdminCalendar.pending, (s) => {
      s.calendarLoading = true;
    });
    b.addCase(fetchAdminCalendar.rejected, (s) => {
      s.calendarLoading = false;
    });
    b.addCase(fetchAdminCalendar.fulfilled, (s, a) => {
      s.calendarLoading = false;
      s.calendarSplits = a.payload.splits;
      s.calendarRoundEvents = a.payload.round_events ?? [];
      s.calendarWorkTasks = a.payload.work_tasks ?? [];
    });
    b.addCase(fetchAdminTradelineProducts.fulfilled, (s, a) => {
      s.tradelineProducts = a.payload;
    });
    b.addCase(createTradelineProduct.pending, (s) => {
      s.tradelineProductsSaving = true;
    });
    b.addCase(createTradelineProduct.rejected, (s) => {
      s.tradelineProductsSaving = false;
    });
    b.addCase(createTradelineProduct.fulfilled, (s, a) => {
      s.tradelineProductsSaving = false;
      s.tradelineProducts.push(a.payload);
    });
    b.addCase(updateTradelineProduct.pending, (s) => {
      s.tradelineProductsSaving = true;
    });
    b.addCase(updateTradelineProduct.rejected, (s) => {
      s.tradelineProductsSaving = false;
    });
    b.addCase(updateTradelineProduct.fulfilled, (s, a) => {
      s.tradelineProductsSaving = false;
      const idx = s.tradelineProducts.findIndex((p) => p.id === a.payload.id);
      if (idx !== -1) s.tradelineProducts[idx] = a.payload;
    });
    b.addCase(deleteTradelineProduct.fulfilled, (s, a) => {
      s.tradelineProducts = s.tradelineProducts.filter(
        (p) => p.id !== a.meta.arg,
      );
    });
    b.addCase(fetchRoundReportDeliveries.fulfilled, (s, a) => {
      s.reportDeliveries[a.payload.clientId] = a.payload.rounds;
      s.reportDeliveriesLoading[a.payload.clientId] = false;
    });
    // Report delivery timelines (case panel).
    b.addMatcher(isPending(fetchRoundReportDeliveries), (s, a) => {
      s.reportDeliveriesLoading[a.meta.arg] = true;
    });
    b.addMatcher(isRejected(fetchRoundReportDeliveries), (s, a) => {
      s.reportDeliveriesLoading[a.meta.arg] = false;
    });
    // Dashboard refresh spinner (pending/rejected cases are registered by the loading loop above).
    b.addMatcher(isPending(fetchAdminDashboard), (s) => {
      s.dashboardRefreshing = true;
    });
    b.addMatcher(isRejected(fetchAdminDashboard), (s) => {
      s.dashboardRefreshing = false;
    });
  },
});

export const fetchSectionLocks = createAsyncThunk<SectionLock[], void>(
  "admin/fetchSectionLocks",
  async () => {
    const { data } = await api.get("/admin/section-locks");
    return data.section_locks as SectionLock[];
  },
);

export const updateSectionLock = createAsyncThunk<
  SectionLock,
  { key: string; is_locked: boolean; lock_reason?: string | null }
>("admin/updateSectionLock", async ({ key, is_locked, lock_reason }) => {
  const { data } = await api.put(`/admin/section-locks/${key}`, {
    is_locked,
    lock_reason: lock_reason ?? null,
  });
  return data.section_lock as SectionLock;
});

export const { clearPanelClient, clearCouponPreview } = slice.actions;
export default slice.reducer;

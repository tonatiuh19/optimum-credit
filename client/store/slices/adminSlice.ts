import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api from "@/lib/api";
import type {
  AdminClientListItem,
  AdminDashboardStats,
  AdminDashboardTicket,
  AdminDashboardPayment,
  AdminPaymentsResponse,
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
  SupportFaq,
  SupportTicket,
  SectionLock,
  SystemSetting,
  UpdateCouponPayload,
  PaymentSplit,
  CreateCasePayload,
  CalendarSplit,
  TradelineProduct,
  TradelineProductInput,
} from "@shared/api";

interface AdminState {
  dashboard: {
    stats: AdminDashboardStats | null;
    stages: { pipeline_stage: PipelineStage; count: number }[];
    recent_clients: AdminClientListItem[];
    recent_tickets: AdminDashboardTicket[];
    recent_payments: AdminDashboardPayment[];
  };
  clients: AdminClientListItem[];
  pipelineClients: AdminClientListItem[];
  pipelineCases: CreditRepairCase[];
  selectedClient: any | null;
  panelClient: {
    case_info?: {
      id: number;
      case_number: string;
      status: string;
      pipeline_stage: string;
    };
    client: any;
    documents: any[];
    reports: any[];
    payments: any[];
    pipeline_history: any[];
  } | null;
  panelLoading: boolean;
  pendingDocuments: any[];
  allDocuments: any[];
  conversations: Conversation[];
  conversationMessages: Record<number, ConversationMessage[]>;
  tickets: SupportTicket[];
  selectedTicket: any | null;
  ticketReplies: any[];
  faqs: SupportFaq[];
  templates: CommunicationTemplate[];
  videos: EducationalVideo[];
  settings: SystemSetting[];
  reports: {
    revenueByMonth: any[];
    signupsByMonth: any[];
    packageBreakdown: any[];
  };
  team: AdminUserListItem[];
  payments: Payment[];
  paymentsSummary: AdminPaymentsResponse["summary"] | null;
  paymentsPagination: AdminPaymentsResponse["pagination"] | null;
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
  calendarLoading: boolean;
  clientSearchResults: AdminClientListItem[];
  clientSearchLoading: boolean;
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
  },
  clients: [],
  pipelineClients: [],
  pipelineCases: [],
  selectedClient: null,
  panelClient: null,
  panelLoading: false,
  pendingDocuments: [],
  allDocuments: [],
  conversations: [],
  conversationMessages: {},
  tickets: [],
  selectedTicket: null,
  ticketReplies: [],
  faqs: [],
  templates: [],
  videos: [],
  settings: [],
  reports: { revenueByMonth: [], signupsByMonth: [], packageBreakdown: [] },
  team: [],
  payments: [],
  paymentsSummary: null,
  paymentsPagination: null,
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
  calendarLoading: false,
  clientSearchResults: [],
  clientSearchLoading: false,
  tradelineProducts: [],
  tradelineProductsSaving: false,
  loading: false,
  saving: false,
};

export const fetchAdminDashboard = createAsyncThunk(
  "admin/dashboard",
  async () => {
    const { data } = await api.get("/admin/dashboard");
    return data;
  },
);

export const fetchAdminClients = createAsyncThunk<
  AdminClientListItem[],
  | {
      stage?: string;
      search?: string;
      status?: string;
      language?: string;
      billing?: string;
      joined_from?: string;
      joined_to?: string;
      has_notes?: string;
    }
  | undefined
>("admin/clients", async (args) => {
  const params: any = {};
  if (args?.stage) params.stage = args.stage;
  if (args?.search) params.search = args.search;
  if (args?.status) params.status = args.status;
  if (args?.language) params.language = args.language;
  if (args?.billing) params.billing = args.billing;
  if (args?.joined_from) params.joined_from = args.joined_from;
  if (args?.joined_to) params.joined_to = args.joined_to;
  if (args?.has_notes) params.has_notes = args.has_notes;
  const { data } = await api.get("/admin/clients", { params });
  return data.clients;
});

export const searchClients = createAsyncThunk<AdminClientListItem[], string>(
  "admin/clients/search",
  async (query) => {
    const { data } = await api.get("/admin/clients", {
      params: { search: query, limit: 10 },
    });
    return data.clients as AdminClientListItem[];
  },
);

export const fetchAdminClient = createAsyncThunk<any, { id: number }>(
  "admin/client",
  async ({ id }) => {
    const { data } = await api.get(`/admin/clients/${id}`);
    return data;
  },
);

export const fetchPipeline = createAsyncThunk("admin/pipeline", async () => {
  const { data } = await api.get("/admin/pipeline");
  return data.cases as CreditRepairCase[];
});

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
      params: { status: "pending" },
    });
    return data.documents;
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

export const fetchAllDocuments = createAsyncThunk(
  "admin/allDocs",
  async (params?: { status?: string; search?: string }) => {
    const { data } = await api.get("/admin/documents", {
      params: { status: params?.status || "all", search: params?.search },
    });
    return data.documents;
  },
);

export const createRoundReport = createAsyncThunk<
  void,
  {
    clientId: number;
    round_number: number;
    score_before?: number;
    score_after?: number;
    items_removed?: number;
    items_disputed?: number;
    summary_md?: string;
  }
>("admin/createRoundReport", async ({ clientId, ...rest }) => {
  await api.post(`/admin/clients/${clientId}/round-reports`, rest);
});

export const uploadRoundReportPdf = createAsyncThunk<
  { pdf: any; report: any },
  { clientId: number; roundNumber: number; file: File }
>("admin/uploadRoundReportPdf", async ({ clientId, roundNumber, file }) => {
  const fd = new FormData();
  fd.append("pdf", file);
  const { data } = await api.post(
    `/admin/clients/${clientId}/round-reports/${roundNumber}/pdf`,
    fd,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return data; // { ok, pdf, report }
});

export const deleteRoundReportPdf = createAsyncThunk<
  { pdfId: number; roundNumber: number },
  { pdfId: number; roundNumber: number }
>("admin/deleteRoundReportPdf", async ({ pdfId, roundNumber }) => {
  await api.delete(`/admin/round-report-pdfs/${pdfId}`);
  return { pdfId, roundNumber };
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
    channel: "sms" | "email";
    body: string;
    subject?: string;
  }
>("admin/sendConv", async (args) => {
  const { data } = await api.post("/admin/conversations/send", args);
  return data;
});

export const fetchAdminTickets = createAsyncThunk(
  "admin/tickets",
  async (args: { status?: string } | undefined) => {
    const { data } = await api.get("/admin/tickets", {
      params: args?.status ? { status: args.status } : {},
    });
    return data.tickets as SupportTicket[];
  },
);

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
  }
>("admin/team/create", async (args) => {
  await api.post("/admin/admins", args);
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
  }
>("admin/team/update", async ({ id, ...rest }) => {
  await api.put(`/admin/admins/${id}`, rest);
});

export const deleteAdminTeamMember = createAsyncThunk<void, { id: number }>(
  "admin/team/delete",
  async ({ id }) => {
    await api.delete(`/admin/admins/${id}`);
  },
);

export const createAdminClient = createAsyncThunk<
  AdminClientListItem,
  {
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    package_id?: number | null;
    status?: string;
  }
>("admin/clients/create", async (args) => {
  const { data } = await api.post("/admin/clients", args);
  return data.client as AdminClientListItem;
});

export const updateAdminClient = createAsyncThunk<
  AdminClientListItem,
  {
    id: number;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    package_id?: number | null;
    status?: string;
  }
>("admin/clients/update", async ({ id, ...rest }) => {
  const { data } = await api.put(`/admin/clients/${id}`, rest);
  return data.client as AdminClientListItem;
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
  async (payload: CreateCasePayload) => {
    const { data } = await api.post("/admin/cases", payload);
    return data.case;
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
    const { data } = await api.get("/admin/calendar", { params: { from, to } });
    return data.splits as CalendarSplit[];
  },
);

const slice = createSlice({
  name: "admin",
  initialState,
  reducers: {
    clearPanelClient(s) {
      s.panelClient = null;
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
      fetchAdminClients,
      fetchAllDocuments,
      fetchAdminTeam,
      fetchPipeline,
      fetchAdminDashboard,
      fetchAdminReports,
      fetchSettings,
      fetchTemplates,
      fetchAdminVideos,
      fetchAdminTickets,
    ].forEach((thunk) => {
      b.addCase(thunk.pending, setLoading);
      b.addCase(thunk.rejected, clearLoading);
    });

    b.addCase(fetchAdminDashboard.fulfilled, (s, a) => {
      s.loading = false;
      s.dashboard = a.payload;
    });
    b.addCase(fetchAdminClients.fulfilled, (s, a) => {
      s.loading = false;
      s.clients = a.payload;
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
    b.addCase(fetchPipeline.fulfilled, (s, a) => {
      s.loading = false;
      s.pipelineCases = a.payload;
    });
    b.addCase(fetchPendingDocuments.fulfilled, (s, a) => {
      s.pendingDocuments = a.payload;
    });
    b.addCase(fetchAllDocuments.fulfilled, (s, a) => {
      s.loading = false;
      s.allDocuments = a.payload;
    });
    b.addCase(fetchConversations.fulfilled, (s, a) => {
      s.conversations = a.payload;
    });
    b.addCase(fetchConversationMessages.fulfilled, (s, a) => {
      s.conversationMessages[a.payload.id] = a.payload.messages;
    });
    b.addCase(fetchAdminTickets.fulfilled, (s, a) => {
      s.loading = false;
      s.tickets = a.payload;
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
    b.addCase(fetchAdminReports.fulfilled, (s, a) => {
      s.loading = false;
      s.reports = a.payload;
    });
    b.addCase(fetchAdminTeam.fulfilled, (s, a) => {
      s.loading = false;
      s.team = a.payload;
    });
    b.addCase(createAdminClient.fulfilled, (s, a) => {
      s.clients.unshift(a.payload);
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
    });
    b.addCase(fetchAdminPayments.pending, (s) => {
      s.loading = true;
    });
    b.addCase(fetchAdminPayments.rejected, (s) => {
      s.loading = false;
    });
    b.addCase(fetchAdminPayments.fulfilled, (s, a) => {
      s.loading = false;
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
    b.addCase(uploadRoundReportPdf.fulfilled, (s, a) => {
      if (s.panelClient && a.payload.report) {
        const updated = a.payload.report;
        const idx = s.panelClient.reports.findIndex(
          (r: any) => r.round_number === updated.round_number,
        );
        if (idx !== -1) {
          s.panelClient.reports[idx] = updated;
        } else {
          s.panelClient.reports.push(updated);
        }
      }
    });
    b.addCase(deleteRoundReportPdf.fulfilled, (s, a) => {
      if (!s.panelClient) return;
      const { pdfId, roundNumber } = a.payload;
      const report = s.panelClient.reports.find(
        (r: any) => r.round_number === roundNumber,
      );
      if (report && report.pdfs) {
        report.pdfs = report.pdfs.filter((p: any) => p.id !== pdfId);
      }
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
    });
    b.addCase(markSplitPaid.fulfilled, (s, a) => {
      const idx = s.caseSplits.findIndex((sp) => sp.id === a.payload.id);
      if (idx !== -1) s.caseSplits[idx] = a.payload;
      const idx2 = s.paymentSplits.findIndex((sp) => sp.id === a.payload.id);
      if (idx2 !== -1) s.paymentSplits[idx2] = a.payload;
    });
    b.addCase(deleteCaseSplit.fulfilled, (s, a) => {
      s.caseSplits = s.caseSplits.filter((sp) => sp.id !== a.payload);
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
      s.calendarSplits = a.payload;
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

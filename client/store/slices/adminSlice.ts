import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api from "@/lib/api";
import type {
  AdminClientListItem,
  AdminDashboardStats,
  AdminPaymentsResponse,
  AdminUserListItem,
  CommunicationTemplate,
  Conversation,
  ConversationMessage,
  Coupon,
  CreateCouponPayload,
  EducationalVideo,
  Payment,
  PipelineStage,
  SupportTicket,
  SectionLock,
  SystemSetting,
  UpdateCouponPayload,
} from "@shared/api";

interface AdminState {
  dashboard: {
    stats: AdminDashboardStats | null;
    stages: { pipeline_stage: PipelineStage; count: number }[];
    recent_clients: AdminClientListItem[];
  };
  clients: AdminClientListItem[];
  pipelineClients: AdminClientListItem[];
  selectedClient: any | null;
  panelClient: {
    client: any;
    documents: any[];
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
  coupons: Coupon[];
  couponsSaving: boolean;
  sectionLocks: SectionLock[];
  sectionLocksLoading: boolean;
  sectionLocksSaving: boolean;
  loading: boolean;
  saving: boolean;
}

const initialState: AdminState = {
  dashboard: { stats: null, stages: [], recent_clients: [] },
  clients: [],
  pipelineClients: [],
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
  templates: [],
  videos: [],
  settings: [],
  reports: { revenueByMonth: [], signupsByMonth: [], packageBreakdown: [] },
  team: [],
  payments: [],
  paymentsSummary: null,
  paymentsPagination: null,
  coupons: [],
  couponsSaving: false,
  sectionLocks: [],
  sectionLocksLoading: true,
  sectionLocksSaving: false,
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
  { stage?: string; search?: string } | undefined
>("admin/clients", async (args) => {
  const params: any = {};
  if (args?.stage) params.stage = args.stage;
  if (args?.search) params.search = args.search;
  const { data } = await api.get("/admin/clients", { params });
  return data.clients;
});

export const fetchAdminClient = createAsyncThunk<any, { id: number }>(
  "admin/client",
  async ({ id }) => {
    const { data } = await api.get(`/admin/clients/${id}`);
    return data;
  },
);

export const fetchPipeline = createAsyncThunk("admin/pipeline", async () => {
  const { data } = await api.get("/admin/pipeline");
  return data.clients as AdminClientListItem[];
});

export const updateClientStage = createAsyncThunk<
  void,
  { clientId: number; stage: PipelineStage; notes?: string }
>("admin/updateStage", async ({ clientId, stage, notes }) => {
  await api.post(`/admin/clients/${clientId}/stage`, { stage, notes });
});

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

export const createVideo = createAsyncThunk<void, Partial<EducationalVideo>>(
  "admin/createVideo",
  async (args) => {
    await api.post("/admin/videos", args);
  },
);

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

const slice = createSlice({
  name: "admin",
  initialState,
  reducers: {
    clearPanelClient(s) {
      s.panelClient = null;
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
    b.addCase(fetchPipeline.fulfilled, (s, a) => {
      s.loading = false;
      s.pipelineClients = a.payload;
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
    b.addCase(fetchSectionLocks.pending, (s) => {
      s.sectionLocksLoading = true;
    });
    b.addCase(fetchSectionLocks.rejected, (s) => {
      s.sectionLocksLoading = false;
    });
    b.addCase(fetchSectionLocks.fulfilled, (s, a) => {
      s.sectionLocks = a.payload;
      s.sectionLocksLoading = false;
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

export const { clearPanelClient } = slice.actions;
export default slice.reducer;

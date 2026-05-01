import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api from "@/lib/api";
import type {
  AdminClientListItem,
  AdminDashboardStats,
  CommunicationTemplate,
  Conversation,
  ConversationMessage,
  EducationalVideo,
  PipelineStage,
  SupportTicket,
  SystemSetting,
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

const slice = createSlice({
  name: "admin",
  initialState,
  reducers: {
    clearPanelClient(s) {
      s.panelClient = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchAdminDashboard.fulfilled, (s, a) => {
      s.dashboard = a.payload;
    });
    b.addCase(fetchAdminClients.fulfilled, (s, a) => {
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
      s.pipelineClients = a.payload;
    });
    b.addCase(fetchPendingDocuments.fulfilled, (s, a) => {
      s.pendingDocuments = a.payload;
    });
    b.addCase(fetchAllDocuments.fulfilled, (s, a) => {
      s.allDocuments = a.payload;
    });
    b.addCase(fetchConversations.fulfilled, (s, a) => {
      s.conversations = a.payload;
    });
    b.addCase(fetchConversationMessages.fulfilled, (s, a) => {
      s.conversationMessages[a.payload.id] = a.payload.messages;
    });
    b.addCase(fetchAdminTickets.fulfilled, (s, a) => {
      s.tickets = a.payload;
    });
    b.addCase(fetchAdminTicket.fulfilled, (s, a) => {
      s.selectedTicket = a.payload.ticket;
      s.ticketReplies = a.payload.replies;
    });
    b.addCase(fetchTemplates.fulfilled, (s, a) => {
      s.templates = a.payload;
    });
    b.addCase(fetchAdminVideos.fulfilled, (s, a) => {
      s.videos = a.payload;
    });
    b.addCase(fetchSettings.fulfilled, (s, a) => {
      s.settings = a.payload;
    });
    b.addCase(fetchAdminReports.fulfilled, (s, a) => {
      s.reports = a.payload;
    });
  },
});

export const { clearPanelClient } = slice.actions;
export default slice.reducer;

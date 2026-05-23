import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api from "@/lib/api";
import type {
  ClientDocument,
  ClientPayment,
  ClientPaymentSplit,
  RoundReport,
  SectionLock,
  SupportFaq,
  SupportTicket,
  AiChatSession,
  AiChatMessage,
  EducationalVideo,
  ClientTaskWithStatus,
} from "@shared/api";

interface PortalState {
  dashboard: any | null;
  documents: ClientDocument[];
  reports: RoundReport[];
  tickets: SupportTicket[];
  faqs: SupportFaq[];
  videos: EducationalVideo[];
  chatSessions: AiChatSession[];
  chatMessages: AiChatMessage[];
  sectionLocks: SectionLock[];
  sectionLocksInitialized: boolean;
  tasks: ClientTaskWithStatus[];
  tasksLoading: boolean;
  tasksSaving: boolean;
  payments: ClientPayment[];
  paymentsLoading: boolean;
  splits: ClientPaymentSplit[];
  splitsLoading: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: PortalState = {
  dashboard: null,
  documents: [],
  reports: [],
  tickets: [],
  faqs: [],
  videos: [],
  chatSessions: [],
  chatMessages: [],
  sectionLocks: [],
  sectionLocksInitialized: false,
  tasks: [],
  tasksLoading: false,
  tasksSaving: false,
  payments: [],
  paymentsLoading: false,
  splits: [],
  splitsLoading: false,
  loading: false,
  error: null,
};

export const fetchDashboard = createAsyncThunk("portal/dashboard", async () => {
  const { data } = await api.get("/portal/dashboard");
  return data;
});

export const fetchPortalSectionLocks = createAsyncThunk(
  "portal/sectionLocks",
  async () => {
    const { data } = await api.get("/portal/section-locks");
    return data.section_locks as SectionLock[];
  },
);

export const uploadDocuments = createAsyncThunk<
  { documents: any[] },
  { docType: string; files: FileList }
>("portal/uploadDocs", async ({ docType, files }) => {
  const fd = new FormData();
  fd.append("doc_type", docType);
  Array.from(files).forEach((f) => fd.append("files", f));
  const { data } = await api.post("/portal/documents", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
});

export const signContract = createAsyncThunk<
  { ok: true; signed_at: string },
  { signature_name: string; signature_data_url?: string }
>("portal/signContract", async (args) => {
  const { data } = await api.post("/portal/contract/sign", args);
  return data;
});

export const submitSmartCredit = createAsyncThunk<
  void,
  { smart_credit_email: string }
>("portal/smartCredit", async (args) => {
  await api.post("/portal/smart-credit", args);
});

export const updateProfile = createAsyncThunk<
  void,
  { first_name: string; last_name: string; phone?: string }
>("portal/updateProfile", async (args) => {
  await api.put("/portal/profile", args);
});

export const updateLanguage = createAsyncThunk<
  { language: "en" | "es" },
  { language: "en" | "es" }
>("portal/updateLanguage", async (args) => {
  await api.put("/portal/language", args);
  return args;
});

export const fetchTickets = createAsyncThunk("portal/tickets", async () => {
  const { data } = await api.get("/portal/tickets");
  return data.tickets as SupportTicket[];
});

export const createTicket = createAsyncThunk<
  { id: number },
  { subject: string; body: string; category?: string; priority?: string }
>("portal/createTicket", async (args) => {
  const { data } = await api.post("/portal/tickets", args);
  return data;
});

export const replyTicket = createAsyncThunk<
  void,
  { ticketId: number; body: string }
>("portal/replyTicket", async ({ ticketId, body }) => {
  await api.post(`/portal/tickets/${ticketId}/replies`, { body });
});

export const fetchChatSessions = createAsyncThunk(
  "portal/chatSessions",
  async () => {
    const { data } = await api.get("/portal/ai-chat/sessions");
    return data.sessions as AiChatSession[];
  },
);

export const fetchChatMessages = createAsyncThunk<
  AiChatMessage[],
  { sessionId: number }
>("portal/chatMessages", async ({ sessionId }) => {
  const { data } = await api.get(
    `/portal/ai-chat/sessions/${sessionId}/messages`,
  );
  return data.messages;
});

export const sendChatMessage = createAsyncThunk<
  { session_id: number; reply: string },
  { content: string; session_id?: number; language?: string }
>("portal/sendChat", async (args) => {
  const { data } = await api.post("/portal/ai-chat/message", args);
  return data;
});

export const fetchFaqs = createAsyncThunk("portal/faqs", async () => {
  const { data } = await api.get("/portal/support-faq");
  return data.faqs as SupportFaq[];
});

export const fetchVideos = createAsyncThunk("portal/videos", async () => {
  const { data } = await api.get("/portal/videos");
  return data.videos as EducationalVideo[];
});

export const fetchPortalTasks = createAsyncThunk(
  "portal/fetchTasks",
  async () => {
    const { data } = await api.get("/portal/tasks");
    return data.tasks as ClientTaskWithStatus[];
  },
);

export const completePortalTask = createAsyncThunk(
  "portal/completeTask",
  async (
    {
      taskId,
      formData,
      signatureName,
      file,
    }: {
      taskId: number;
      formData?: Record<string, unknown>;
      signatureName?: string;
      file?: File;
    },
    { rejectWithValue, dispatch },
  ) => {
    try {
      const fd = new FormData();
      if (file) fd.append("file", file);
      if (formData) fd.append("form_data", JSON.stringify(formData));
      if (signatureName) fd.append("signature_name", signatureName);
      const { data } = await api.post(`/portal/tasks/${taskId}/complete`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      dispatch(fetchPortalTasks());
      return { taskId, completed_at: data.completed_at };
    } catch (err: any) {
      return rejectWithValue(
        err?.response?.data?.error ?? "Failed to submit task",
      );
    }
  },
);

const slice = createSlice({
  name: "portal",
  initialState,
  reducers: {
    addLocalChatMessage(state, action) {
      state.chatMessages.push(action.payload);
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchDashboard.pending, (s) => {
      s.loading = true;
    });
    b.addCase(fetchDashboard.fulfilled, (s, a) => {
      s.loading = false;
      s.dashboard = a.payload;
      s.documents = a.payload.documents || [];
      s.reports = a.payload.reports || [];
      s.tickets = a.payload.tickets || [];
    });
    b.addCase(fetchDashboard.rejected, (s) => {
      s.loading = false;
    });

    b.addCase(fetchTickets.fulfilled, (s, a) => {
      s.tickets = a.payload;
    });
    b.addCase(fetchFaqs.fulfilled, (s, a) => {
      s.faqs = a.payload;
    });
    b.addCase(fetchVideos.fulfilled, (s, a) => {
      s.videos = a.payload;
    });
    b.addCase(fetchChatSessions.fulfilled, (s, a) => {
      s.chatSessions = a.payload;
    });
    b.addCase(fetchChatMessages.fulfilled, (s, a) => {
      s.chatMessages = a.payload;
    });
    b.addCase(fetchPortalSectionLocks.fulfilled, (s, a) => {
      s.sectionLocks = a.payload;
      s.sectionLocksInitialized = true;
    });

    b.addCase(fetchPortalTasks.pending, (s) => {
      s.tasksLoading = true;
    });
    b.addCase(fetchPortalTasks.fulfilled, (s, a) => {
      s.tasksLoading = false;
      s.tasks = a.payload;
    });
    b.addCase(fetchPortalTasks.rejected, (s) => {
      s.tasksLoading = false;
    });

    b.addCase(completePortalTask.pending, (s) => {
      s.tasksSaving = true;
    });
    b.addCase(completePortalTask.fulfilled, (s) => {
      s.tasksSaving = false;
    });
    b.addCase(completePortalTask.rejected, (s) => {
      s.tasksSaving = false;
    });

    b.addCase(fetchClientPayments.pending, (s) => {
      s.paymentsLoading = true;
    });
    b.addCase(fetchClientPayments.fulfilled, (s, a) => {
      s.paymentsLoading = false;
      s.payments = a.payload;
    });
    b.addCase(fetchClientPayments.rejected, (s) => {
      s.paymentsLoading = false;
    });
    b.addCase(fetchClientPaymentSplits.pending, (s) => {
      s.splitsLoading = true;
    });
    b.addCase(fetchClientPaymentSplits.fulfilled, (s, a) => {
      s.splitsLoading = false;
      s.splits = a.payload;
    });
    b.addCase(fetchClientPaymentSplits.rejected, (s) => {
      s.splitsLoading = false;
    });
  },
});

export const fetchClientPayments = createAsyncThunk<ClientPayment[]>(
  "portal/payments",
  async () => {
    const { data } = await api.get("/portal/payments");
    return data.payments as ClientPayment[];
  },
);

export const fetchClientPaymentSplits = createAsyncThunk<ClientPaymentSplit[]>(
  "portal/paymentSplits",
  async () => {
    const { data } = await api.get("/portal/payment-splits");
    return data.splits as ClientPaymentSplit[];
  },
);

export const { addLocalChatMessage } = slice.actions;
export default slice.reducer;

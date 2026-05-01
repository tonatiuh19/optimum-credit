import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api from "@/lib/api";
import type {
  ClientDocument,
  RoundReport,
  SupportTicket,
  AiChatSession,
  AiChatMessage,
  EducationalVideo,
} from "@shared/api";

interface PortalState {
  dashboard: any | null;
  documents: ClientDocument[];
  reports: RoundReport[];
  tickets: SupportTicket[];
  videos: EducationalVideo[];
  chatSessions: AiChatSession[];
  chatMessages: AiChatMessage[];
  loading: boolean;
  error: string | null;
}

const initialState: PortalState = {
  dashboard: null,
  documents: [],
  reports: [],
  tickets: [],
  videos: [],
  chatSessions: [],
  chatMessages: [],
  loading: false,
  error: null,
};

export const fetchDashboard = createAsyncThunk("portal/dashboard", async () => {
  const { data } = await api.get("/portal/dashboard");
  return data;
});

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

export const fetchVideos = createAsyncThunk("portal/videos", async () => {
  const { data } = await api.get("/portal/videos");
  return data.videos as EducationalVideo[];
});

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
    b.addCase(fetchVideos.fulfilled, (s, a) => {
      s.videos = a.payload;
    });
    b.addCase(fetchChatSessions.fulfilled, (s, a) => {
      s.chatSessions = a.payload;
    });
    b.addCase(fetchChatMessages.fulfilled, (s, a) => {
      s.chatMessages = a.payload;
    });
  },
});

export const { addLocalChatMessage } = slice.actions;
export default slice.reducer;

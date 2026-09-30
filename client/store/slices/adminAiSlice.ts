import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import { decodeLiteralUnicodeEscapes } from "@/lib/decodeLiteralUnicodeEscapes";
import type {
  AdminAiChatContext,
  AdminAiChatMessage,
  AdminAiChatResponse,
  AdminAiCitation,
} from "@shared/api";

export type AdminAiUiMessage = AdminAiChatMessage & {
  citations?: AdminAiCitation[];
};

interface AdminAiState {
  open: boolean;
  context: AdminAiChatContext | null;
  messages: AdminAiUiMessage[];
  sending: boolean;
  error: string | null;
}

const initialState: AdminAiState = {
  open: false,
  context: null,
  messages: [],
  sending: false,
  error: null,
};

export const sendAdminAiChat = createAsyncThunk<
  AdminAiChatResponse,
  { content: string },
  { state: { adminAi: AdminAiState }; rejectValue: string }
>("adminAi/chat", async ({ content }, { getState, rejectWithValue }) => {
  const { messages, context } = getState().adminAi;
  const nextMessages: AdminAiChatMessage[] = [
    ...messages.map(({ role, content: c }) => ({ role, content: c })),
    { role: "user", content },
  ];
  try {
    const { data } = await api.post<AdminAiChatResponse>("/admin/ai/chat", {
      messages: nextMessages,
      context,
    });
    return data;
  } catch (e) {
    const ax = e as { response?: { data?: { code?: string; error?: string } } };
    const errCode = ax.response?.data?.code;
    if (errCode === "ai_not_provisioned") {
      return rejectWithValue("adminAsk.notProvisioned");
    }
    if (errCode === "ai_billing") {
      return rejectWithValue("adminAsk.billing");
    }
    if (errCode === "ai_model_config") {
      return rejectWithValue("adminAsk.modelConfig");
    }
    return rejectWithValue(formatAxiosError(e, "Ask failed"));
  }
});

const adminAiSlice = createSlice({
  name: "adminAi",
  initialState,
  reducers: {
    openAdminAsk(
      s,
      a: PayloadAction<AdminAiChatContext | null | undefined>,
    ) {
      s.open = true;
      s.error = null;
      // Always replace context — global Ask must not keep a prior case chip.
      s.context = a.payload ?? null;
    },
    closeAdminAsk(s) {
      s.open = false;
    },
    setAdminAskContext(s, a: PayloadAction<AdminAiChatContext | null>) {
      s.context = a.payload;
    },
    clearAdminAsk(s) {
      s.messages = [];
      s.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(sendAdminAiChat.pending, (s, a) => {
      s.sending = true;
      s.error = null;
      s.messages.push({ role: "user", content: a.meta.arg.content });
    });
    b.addCase(sendAdminAiChat.fulfilled, (s, a) => {
      s.sending = false;
      s.messages.push({
        role: "assistant",
        content: decodeLiteralUnicodeEscapes(String(a.payload.reply || "")),
        citations: a.payload.citations,
      });
    });
    b.addCase(sendAdminAiChat.rejected, (s, a) => {
      s.sending = false;
      s.error = a.payload || a.error.message || "Ask failed";
      // Drop the optimistic user bubble so retries don't stack duplicates.
      const last = s.messages[s.messages.length - 1];
      if (last?.role === "user" && last.content === a.meta.arg.content) {
        s.messages.pop();
      }
    });
  },
});

export const {
  openAdminAsk,
  closeAdminAsk,
  setAdminAskContext,
  clearAdminAsk,
} = adminAiSlice.actions;
export default adminAiSlice.reducer;

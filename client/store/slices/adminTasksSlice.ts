import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api from "@/lib/api";
import type {
  OnboardingTaskTemplate,
  CreateTaskTemplatePayload,
} from "@shared/api";

interface AdminTasksState {
  templates: OnboardingTaskTemplate[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  // per-case task completions (keyed by caseId)
  caseCompletions: Record<number, any[]>;
  caseCompletionsLoading: boolean;
  /** @deprecated use caseCompletions */
  clientCompletions: Record<number, any[]>;
  clientCompletionsLoading: boolean;
}

const initialState: AdminTasksState = {
  templates: [],
  loading: false,
  saving: false,
  error: null,
  caseCompletions: {},
  caseCompletionsLoading: false,
  clientCompletions: {},
  clientCompletionsLoading: false,
};

// ── Thunks ───────────────────────────────────────────────────────────────────

export const fetchAdminTaskTemplates = createAsyncThunk(
  "adminTasks/fetchTemplates",
  async (params?: { search?: string; type?: string; active?: string }) => {
    const { data } = await api.get("/admin/task-templates", { params });
    return data.tasks as OnboardingTaskTemplate[];
  },
);

export const createTaskTemplate = createAsyncThunk(
  "adminTasks/create",
  async (payload: CreateTaskTemplatePayload, { rejectWithValue }) => {
    try {
      const { data } = await api.post("/admin/task-templates", payload);
      return data.task as OnboardingTaskTemplate;
    } catch (err: any) {
      return rejectWithValue(
        err?.response?.data?.error ?? "Failed to create task",
      );
    }
  },
);

export const updateTaskTemplate = createAsyncThunk(
  "adminTasks/update",
  async (
    {
      id,
      payload,
    }: {
      id: number;
      payload: Partial<CreateTaskTemplatePayload> & {
        is_active?: boolean;
        sort_order?: number;
      };
    },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.put(`/admin/task-templates/${id}`, payload);
      return data.task as OnboardingTaskTemplate;
    } catch (err: any) {
      return rejectWithValue(
        err?.response?.data?.error ?? "Failed to update task",
      );
    }
  },
);

export const deleteTaskTemplate = createAsyncThunk(
  "adminTasks/delete",
  async (id: number, { rejectWithValue }) => {
    try {
      await api.delete(`/admin/task-templates/${id}`);
      return id;
    } catch (err: any) {
      return rejectWithValue(
        err?.response?.data?.error ?? "Failed to delete task",
      );
    }
  },
);

export const fetchCaseTaskCompletions = createAsyncThunk(
  "adminTasks/fetchCaseCompletions",
  async (caseId: number) => {
    const { data } = await api.get(`/admin/cases/${caseId}/task-completions`);
    return { caseId, tasks: data.tasks };
  },
);

export const fetchClientTaskCompletions = createAsyncThunk(
  "adminTasks/fetchClientCompletions",
  async (clientId: number) => {
    const { data } = await api.get(
      `/admin/clients/${clientId}/task-completions`,
    );
    return { clientId, tasks: data.tasks };
  },
);

export const reviewTaskCompletion = createAsyncThunk(
  "adminTasks/reviewCompletion",
  async (
    {
      completionId,
      admin_review_status,
      admin_notes,
      clientId,
      caseId,
    }: {
      completionId: number;
      admin_review_status: "approved" | "rejected";
      admin_notes?: string;
      clientId: number;
      caseId: number;
    },
    { rejectWithValue, dispatch },
  ) => {
    try {
      await api.put(`/admin/task-completions/${completionId}/review`, {
        admin_review_status,
        admin_notes: admin_notes ?? null,
        case_id: caseId,
      });
      dispatch(fetchCaseTaskCompletions(caseId));
      return { completionId, admin_review_status };
    } catch (err: any) {
      return rejectWithValue(
        err?.response?.data?.error ?? "Failed to review task",
      );
    }
  },
);

const adminTasksSlice = createSlice({
  name: "adminTasks",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    // fetch
    builder.addCase(fetchAdminTaskTemplates.pending, (s) => {
      s.loading = true;
      s.error = null;
    });
    builder.addCase(fetchAdminTaskTemplates.fulfilled, (s, a) => {
      s.loading = false;
      s.templates = a.payload;
    });
    builder.addCase(fetchAdminTaskTemplates.rejected, (s, a) => {
      s.loading = false;
      s.error = String(a.error.message);
    });

    // create
    builder.addCase(createTaskTemplate.pending, (s) => {
      s.saving = true;
    });
    builder.addCase(createTaskTemplate.fulfilled, (s, a) => {
      s.saving = false;
      s.templates.push(a.payload);
      s.templates.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    });
    builder.addCase(createTaskTemplate.rejected, (s) => {
      s.saving = false;
    });

    // update
    builder.addCase(updateTaskTemplate.pending, (s) => {
      s.saving = true;
    });
    builder.addCase(updateTaskTemplate.fulfilled, (s, a) => {
      s.saving = false;
      const idx = s.templates.findIndex((t) => t.id === a.payload.id);
      if (idx !== -1) s.templates[idx] = a.payload;
      s.templates.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    });
    builder.addCase(updateTaskTemplate.rejected, (s) => {
      s.saving = false;
    });

    // delete
    builder.addCase(deleteTaskTemplate.fulfilled, (s, a) => {
      s.templates = s.templates.filter((t) => t.id !== a.payload);
    });

    // case completions
    builder.addCase(fetchCaseTaskCompletions.pending, (s) => {
      s.caseCompletionsLoading = true;
    });
    builder.addCase(fetchCaseTaskCompletions.fulfilled, (s, a) => {
      s.caseCompletionsLoading = false;
      s.caseCompletions[a.payload.caseId] = a.payload.tasks;
    });
    builder.addCase(fetchCaseTaskCompletions.rejected, (s) => {
      s.caseCompletionsLoading = false;
    });

    // client completions (legacy)
    builder.addCase(fetchClientTaskCompletions.pending, (s) => {
      s.clientCompletionsLoading = true;
    });
    builder.addCase(fetchClientTaskCompletions.fulfilled, (s, a) => {
      s.clientCompletionsLoading = false;
      s.clientCompletions[a.payload.clientId] = a.payload.tasks;
    });
    builder.addCase(fetchClientTaskCompletions.rejected, (s) => {
      s.clientCompletionsLoading = false;
    });

    // review
    builder.addCase(reviewTaskCompletion.pending, (s) => {
      s.saving = true;
    });
    builder.addCase(reviewTaskCompletion.fulfilled, (s) => {
      s.saving = false;
    });
    builder.addCase(reviewTaskCompletion.rejected, (s) => {
      s.saving = false;
    });
  },
});

export default adminTasksSlice.reducer;

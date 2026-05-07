import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api from "@/lib/api";
import type {
  ReminderFlow,
  ReminderFlowStep,
  ReminderFlowExecution,
} from "@shared/api";

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

interface ReminderFlowsState {
  flows: ReminderFlow[];
  selectedFlow: (ReminderFlow & { steps: ReminderFlowStep[] }) | null;
  executions: ReminderFlowExecution[];
  flowExecutions: ReminderFlowExecution[];
  flowTemplates: { slug: string; name: string; subject: string | null }[];
  loading: boolean;
  saving: boolean;
}

const initialState: ReminderFlowsState = {
  flows: [],
  selectedFlow: null,
  executions: [],
  flowExecutions: [],
  flowTemplates: [],
  loading: false,
  saving: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Thunks
// ─────────────────────────────────────────────────────────────────────────────

export const fetchReminderFlows = createAsyncThunk(
  "reminderFlows/fetchAll",
  async () => {
    const { data } = await api.get("/admin/reminder-flows");
    return data.flows as ReminderFlow[];
  },
);

export const fetchReminderFlow = createAsyncThunk(
  "reminderFlows/fetchOne",
  async (id: number) => {
    const { data } = await api.get(`/admin/reminder-flows/${id}`);
    return data as {
      flow: ReminderFlow & { steps: ReminderFlowStep[] };
      executions: ReminderFlowExecution[];
    };
  },
);

export const createReminderFlow = createAsyncThunk(
  "reminderFlows/create",
  async (payload: {
    name: string;
    description?: string;
    trigger_event: string;
  }) => {
    const { data } = await api.post("/admin/reminder-flows", payload);
    return data.flow as ReminderFlow;
  },
);

export const updateReminderFlow = createAsyncThunk(
  "reminderFlows/update",
  async ({
    id,
    ...rest
  }: {
    id: number;
    name?: string;
    description?: string;
    is_active?: boolean;
  }) => {
    const { data } = await api.put(`/admin/reminder-flows/${id}`, rest);
    return data.flow as ReminderFlow;
  },
);

export const toggleReminderFlow = createAsyncThunk(
  "reminderFlows/toggle",
  async (id: number) => {
    const { data } = await api.post(`/admin/reminder-flows/${id}/toggle`);
    return data as { id: number; is_active: number };
  },
);

export const deleteReminderFlow = createAsyncThunk(
  "reminderFlows/delete",
  async (id: number) => {
    await api.delete(`/admin/reminder-flows/${id}`);
    return id;
  },
);

export const addFlowStep = createAsyncThunk(
  "reminderFlows/addStep",
  async ({
    flowId,
    ...step
  }: {
    flowId: number;
    step_type: string;
    delay_days?: number;
    label?: string;
    subject?: string;
    body?: string;
    template_slug?: string;
  }) => {
    const { data } = await api.post(
      `/admin/reminder-flows/${flowId}/steps`,
      step,
    );
    return data.step as ReminderFlowStep;
  },
);

export const updateFlowStep = createAsyncThunk(
  "reminderFlows/updateStep",
  async ({
    flowId,
    stepId,
    ...rest
  }: {
    flowId: number;
    stepId: number;
    step_type?: string;
    delay_days?: number;
    label?: string;
    subject?: string;
    body?: string;
    template_slug?: string;
  }) => {
    const { data } = await api.put(
      `/admin/reminder-flows/${flowId}/steps/${stepId}`,
      rest,
    );
    return data.step as ReminderFlowStep;
  },
);

export const deleteFlowStep = createAsyncThunk(
  "reminderFlows/deleteStep",
  async ({ flowId, stepId }: { flowId: number; stepId: number }) => {
    await api.delete(`/admin/reminder-flows/${flowId}/steps/${stepId}`);
    return stepId;
  },
);

export const triggerFlowForClient = createAsyncThunk(
  "reminderFlows/triggerForClient",
  async ({ flowId, clientId }: { flowId: number; clientId: number }) => {
    const { data } = await api.post(`/admin/reminder-flows/${flowId}/trigger`, {
      client_id: clientId,
    });
    return data;
  },
);

// Bulk-save the canvas state: syncs nodes (order + config) with the server
export const saveFlowCanvas = createAsyncThunk(
  "reminderFlows/saveCanvas",
  async (
    payload: {
      flowId: number;
      name: string;
      description: string;
      is_active: boolean;
      // ordered list of step nodes (already sorted by Y position or edge traversal)
      steps: Array<{
        step_id?: number; // undefined = new
        step_type: string;
        delay_days: number;
        label?: string;
        subject?: string;
        body?: string;
        template_slug?: string;
      }>;
      existingStepIds: number[];
    },
    { rejectWithValue },
  ) => {
    try {
      const { flowId, name, description, is_active, steps, existingStepIds } =
        payload;

      // 1. Update flow metadata
      await api.put(`/admin/reminder-flows/${flowId}`, {
        name,
        description,
        is_active,
      });

      // 2. Delete steps removed from canvas
      const keptIds = new Set(
        steps.filter((s) => s.step_id).map((s) => s.step_id!),
      );
      const toDelete = existingStepIds.filter((id) => !keptIds.has(id));
      for (const id of toDelete) {
        await api.delete(`/admin/reminder-flows/${flowId}/steps/${id}`);
      }

      // 3. Add new / update existing steps in order
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const stepData = {
          step_type: s.step_type,
          delay_days: s.delay_days ?? 0,
          label: s.label || null,
          subject: s.subject || null,
          body: s.body || null,
          template_slug: s.template_slug || null,
          step_order: i + 1,
        };
        if (!s.step_id) {
          await api.post(`/admin/reminder-flows/${flowId}/steps`, stepData);
        } else {
          await api.put(
            `/admin/reminder-flows/${flowId}/steps/${s.step_id}`,
            stepData,
          );
        }
      }

      // 4. Reload fresh data
      const { data } = await api.get(`/admin/reminder-flows/${flowId}`);
      return data as {
        flow: ReminderFlow & { steps: ReminderFlowStep[] };
        executions: ReminderFlowExecution[];
      };
    } catch (err: any) {
      return rejectWithValue(err?.response?.data?.error ?? "Save failed");
    }
  },
);

export const fetchFlowTemplates = createAsyncThunk(
  "reminderFlows/fetchTemplates",
  async () => {
    const { data } = await api.get("/admin/reminder-flows/meta/templates");
    return data.templates as {
      slug: string;
      name: string;
      subject: string | null;
    }[];
  },
);

export const fetchAllExecutions = createAsyncThunk(
  "reminderFlows/fetchAllExecutions",
  async () => {
    const { data } = await api.get("/admin/reminder-flows/meta/executions");
    return data.executions as ReminderFlowExecution[];
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Slice
// ─────────────────────────────────────────────────────────────────────────────

const reminderFlowsSlice = createSlice({
  name: "reminderFlows",
  initialState,
  reducers: {
    clearSelectedFlow(s) {
      s.selectedFlow = null;
      s.flowExecutions = [];
    },
  },
  extraReducers: (b) => {
    // Loading flags
    b.addCase(fetchReminderFlows.pending, (s) => {
      s.loading = true;
    });
    b.addCase(fetchReminderFlows.rejected, (s) => {
      s.loading = false;
    });
    b.addCase(fetchReminderFlows.fulfilled, (s, a) => {
      s.loading = false;
      s.flows = a.payload;
    });

    b.addCase(fetchReminderFlow.pending, (s) => {
      s.loading = true;
    });
    b.addCase(fetchReminderFlow.rejected, (s) => {
      s.loading = false;
    });
    b.addCase(fetchReminderFlow.fulfilled, (s, a) => {
      s.loading = false;
      s.selectedFlow = a.payload.flow;
      s.flowExecutions = a.payload.executions;
    });

    b.addCase(createReminderFlow.fulfilled, (s, a) => {
      s.flows = [...s.flows, a.payload];
    });

    b.addCase(updateReminderFlow.fulfilled, (s, a) => {
      s.flows = s.flows.map((f) =>
        f.id === a.payload.id ? { ...f, ...a.payload } : f,
      );
      if (s.selectedFlow?.id === a.payload.id) {
        s.selectedFlow = { ...s.selectedFlow, ...a.payload };
      }
    });

    b.addCase(toggleReminderFlow.fulfilled, (s, a) => {
      s.flows = s.flows.map((f) =>
        f.id === a.payload.id ? { ...f, is_active: a.payload.is_active } : f,
      );
      if (s.selectedFlow?.id === a.payload.id) {
        s.selectedFlow = { ...s.selectedFlow, is_active: a.payload.is_active };
      }
    });

    b.addCase(deleteReminderFlow.fulfilled, (s, a) => {
      s.flows = s.flows.filter((f) => f.id !== a.payload);
      if (s.selectedFlow?.id === a.payload) s.selectedFlow = null;
    });

    b.addCase(addFlowStep.fulfilled, (s, a) => {
      if (s.selectedFlow) {
        s.selectedFlow = {
          ...s.selectedFlow,
          steps: [...(s.selectedFlow.steps ?? []), a.payload],
        };
      }
    });

    b.addCase(updateFlowStep.fulfilled, (s, a) => {
      if (s.selectedFlow) {
        s.selectedFlow = {
          ...s.selectedFlow,
          steps: (s.selectedFlow.steps ?? []).map((st) =>
            st.id === a.payload.id ? a.payload : st,
          ),
        };
      }
    });

    b.addCase(deleteFlowStep.fulfilled, (s, a) => {
      if (s.selectedFlow) {
        s.selectedFlow = {
          ...s.selectedFlow,
          steps: (s.selectedFlow.steps ?? []).filter(
            (st) => st.id !== a.payload,
          ),
        };
      }
    });

    b.addCase(fetchFlowTemplates.fulfilled, (s, a) => {
      s.flowTemplates = a.payload;
    });

    b.addCase(fetchAllExecutions.fulfilled, (s, a) => {
      s.executions = a.payload;
    });

    b.addCase(saveFlowCanvas.pending, (s) => {
      s.saving = true;
    });
    b.addCase(saveFlowCanvas.rejected, (s) => {
      s.saving = false;
    });
    b.addCase(saveFlowCanvas.fulfilled, (s, a) => {
      s.saving = false;
      s.selectedFlow = a.payload.flow;
      s.flowExecutions = a.payload.executions;
      // Update in the flows list too
      s.flows = s.flows.map((f) =>
        f.id === a.payload.flow.id
          ? {
              ...f,
              ...a.payload.flow,
              step_count: a.payload.flow.steps?.length,
            }
          : f,
      );
    });
  },
});

export const { clearSelectedFlow } = reminderFlowsSlice.actions;
export default reminderFlowsSlice.reducer;

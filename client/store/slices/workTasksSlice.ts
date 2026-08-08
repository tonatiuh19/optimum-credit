import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import type {
  AdminWorkTask,
  CreateWorkTaskPayload,
  HubspotConnectionStatus,
  HubspotPermissionRow,
  UpdateWorkTaskPayload,
  WorkTaskAssignee,
  WorkTaskCaseOption,
  WorkTasksSyncResult,
} from "@shared/api";

function authHeaders(getState: () => unknown) {
  const token = (getState() as { adminAuth: { token: string | null } })
    .adminAuth.token;
  return { Authorization: `Bearer ${token}` };
}

export const fetchWorkTasks = createAsyncThunk(
  "workTasks/fetch",
  async (_, { getState }) => {
    const { data } = await axios.get<{ tasks: AdminWorkTask[] }>(
      "/api/admin/work-tasks",
      { headers: authHeaders(getState) },
    );
    return data.tasks;
  },
);

export const fetchWorkAssignees = createAsyncThunk(
  "workTasks/assignees",
  async (_, { getState }) => {
    const { data } = await axios.get<{ assignees: WorkTaskAssignee[] }>(
      "/api/admin/work-tasks/assignees",
      { headers: authHeaders(getState) },
    );
    return data.assignees;
  },
);

export const fetchWorkBadge = createAsyncThunk(
  "workTasks/badge",
  async (_, { getState }) => {
    const { data } = await axios.get<{
      mine_open: number;
      mine_overdue: number;
    }>("/api/admin/work-tasks/badge", { headers: authHeaders(getState) });
    return data;
  },
);

export const searchWorkTaskCases = createAsyncThunk(
  "workTasks/caseSearch",
  async (query: string, { getState }) => {
    const { data } = await axios.get<{ cases: WorkTaskCaseOption[] }>(
      "/api/admin/work-tasks/case-search",
      {
        params: { q: query },
        headers: authHeaders(getState),
      },
    );
    return data.cases;
  },
);

export const createWorkTask = createAsyncThunk(
  "workTasks/create",
  async (payload: CreateWorkTaskPayload, { getState, rejectWithValue }) => {
    try {
      const { data } = await axios.post<{ task: AdminWorkTask }>(
        "/api/admin/work-tasks",
        payload,
        { headers: authHeaders(getState) },
      );
      return data.task;
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || "Create failed");
    }
  },
);

export const updateWorkTask = createAsyncThunk(
  "workTasks/update",
  async (
    args: { id: number } & UpdateWorkTaskPayload,
    { getState, rejectWithValue },
  ) => {
    try {
      const { id, ...body } = args;
      const { data } = await axios.put<{ task: AdminWorkTask }>(
        `/api/admin/work-tasks/${id}`,
        body,
        { headers: authHeaders(getState) },
      );
      return data.task;
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || "Update failed");
    }
  },
);

export const deleteWorkTask = createAsyncThunk(
  "workTasks/delete",
  async (id: number, { getState, rejectWithValue }) => {
    try {
      await axios.delete(`/api/admin/work-tasks/${id}`, {
        headers: authHeaders(getState),
      });
      return id;
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || "Delete failed");
    }
  },
);

export const fetchHubspotStatus = createAsyncThunk(
  "workTasks/hubspotStatus",
  async (_, { getState }) => {
    const { data } = await axios.get<HubspotConnectionStatus>(
      "/api/admin/hubspot/status",
      { headers: authHeaders(getState) },
    );
    return data;
  },
);

export const startHubspotOAuth = createAsyncThunk(
  "workTasks/hubspotOAuthStart",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { data } = await axios.get<{ authorize_url: string }>(
        "/api/admin/hubspot/oauth/start",
        { headers: authHeaders(getState) },
      );
      return data.authorize_url;
    } catch (err: any) {
      return rejectWithValue(
        err.response?.data?.error || "Could not start HubSpot OAuth",
      );
    }
  },
);

export const disconnectHubspot = createAsyncThunk(
  "workTasks/hubspotDisconnect",
  async (_, { getState }) => {
    await axios.post(
      "/api/admin/hubspot/disconnect",
      {},
      { headers: authHeaders(getState) },
    );
  },
);

export const syncHubspotTasks = createAsyncThunk(
  "workTasks/hubspotSync",
  async (_, { getState, rejectWithValue }) => {
    try {
      const { data } = await axios.post<WorkTasksSyncResult>(
        "/api/admin/hubspot/sync",
        {},
        { headers: authHeaders(getState) },
      );
      return data;
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || "Sync failed");
    }
  },
);

export const fetchHubspotPermissions = createAsyncThunk(
  "workTasks/hubspotPermissions",
  async (_, { getState }) => {
    const { data } = await axios.get<{ permissions: HubspotPermissionRow[] }>(
      "/api/admin/hubspot/permissions",
      { headers: authHeaders(getState) },
    );
    return data.permissions;
  },
);

export const setHubspotPermission = createAsyncThunk(
  "workTasks/setHubspotPermission",
  async (
    args: { adminId: number; can_extract: boolean },
    { getState, rejectWithValue },
  ) => {
    try {
      await axios.put(
        `/api/admin/hubspot/permissions/${args.adminId}`,
        { can_extract: args.can_extract },
        { headers: authHeaders(getState) },
      );
      return args;
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || "Permission update failed");
    }
  },
);

interface WorkTasksState {
  tasks: AdminWorkTask[];
  assignees: WorkTaskAssignee[];
  loading: boolean;
  saving: boolean;
  syncing: boolean;
  error: string | null;
  badge: { mine_open: number; mine_overdue: number };
  hubspot: HubspotConnectionStatus | null;
  permissions: HubspotPermissionRow[];
  lastSync: WorkTasksSyncResult | null;
  caseSearchResults: WorkTaskCaseOption[];
  caseSearchLoading: boolean;
}

const initialState: WorkTasksState = {
  tasks: [],
  assignees: [],
  loading: false,
  saving: false,
  syncing: false,
  error: null,
  badge: { mine_open: 0, mine_overdue: 0 },
  hubspot: null,
  permissions: [],
  lastSync: null,
  caseSearchResults: [],
  caseSearchLoading: false,
};

const workTasksSlice = createSlice({
  name: "workTasks",
  initialState,
  reducers: {
    clearWorkTasksError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchWorkTasks.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchWorkTasks.fulfilled, (state, action) => {
        state.loading = false;
        state.tasks = action.payload;
      })
      .addCase(fetchWorkTasks.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to load tasks";
      })
      .addCase(fetchWorkAssignees.fulfilled, (state, action) => {
        state.assignees = action.payload;
      })
      .addCase(fetchWorkBadge.fulfilled, (state, action) => {
        state.badge = action.payload;
      })
      .addCase(searchWorkTaskCases.pending, (state) => {
        state.caseSearchLoading = true;
      })
      .addCase(searchWorkTaskCases.fulfilled, (state, action) => {
        state.caseSearchLoading = false;
        state.caseSearchResults = action.payload;
      })
      .addCase(searchWorkTaskCases.rejected, (state) => {
        state.caseSearchLoading = false;
        state.caseSearchResults = [];
      })
      .addCase(createWorkTask.pending, (state) => {
        state.saving = true;
      })
      .addCase(createWorkTask.fulfilled, (state, action) => {
        state.saving = false;
        state.tasks.unshift(action.payload);
      })
      .addCase(createWorkTask.rejected, (state, action) => {
        state.saving = false;
        state.error = String(action.payload || "Create failed");
      })
      .addCase(updateWorkTask.fulfilled, (state, action) => {
        const idx = state.tasks.findIndex((t) => t.id === action.payload.id);
        if (idx >= 0) state.tasks[idx] = action.payload;
        else state.tasks.unshift(action.payload);
      })
      .addCase(deleteWorkTask.fulfilled, (state, action) => {
        state.tasks = state.tasks.filter((t) => t.id !== action.payload);
      })
      .addCase(fetchHubspotStatus.fulfilled, (state, action) => {
        state.hubspot = action.payload;
      })
      .addCase(syncHubspotTasks.pending, (state) => {
        state.syncing = true;
      })
      .addCase(syncHubspotTasks.fulfilled, (state, action) => {
        state.syncing = false;
        state.lastSync = action.payload;
      })
      .addCase(syncHubspotTasks.rejected, (state, action) => {
        state.syncing = false;
        state.error = String(action.payload || "Sync failed");
      })
      .addCase(disconnectHubspot.fulfilled, (state) => {
        if (state.hubspot) {
          state.hubspot = {
            ...state.hubspot,
            connected: false,
            hub_domain: null,
            connected_at: null,
          };
        }
      })
      .addCase(fetchHubspotPermissions.fulfilled, (state, action) => {
        state.permissions = action.payload;
      })
      .addCase(setHubspotPermission.fulfilled, (state, action) => {
        const row = state.permissions.find(
          (p) => p.admin_id === action.payload.adminId,
        );
        if (row) row.can_extract = action.payload.can_extract;
      });
  },
});

export const { clearWorkTasksError } = workTasksSlice.actions;
export default workTasksSlice.reducer;

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
  WorkTaskColumnPage,
  WorkTaskStatus,
  WorkTasksBoardResponse,
  WorkTasksColumnMoreResponse,
  WorkTasksSyncResult,
} from "@shared/api";

function authHeaders(getState: () => unknown) {
  const token = (getState() as { adminAuth: { token: string | null } })
    .adminAuth.token;
  return { Authorization: `Bearer ${token}` };
}

const EMPTY_COLUMN = (limit = 20): WorkTaskColumnPage => ({
  tasks: [],
  total: 0,
  offset: 0,
  limit,
  has_more: false,
});

export const fetchWorkTasks = createAsyncThunk(
  "workTasks/fetch",
  async (args: { q?: string; limit?: number } | void, { getState }) => {
    const q = args && typeof args === "object" ? (args.q ?? "") : "";
    const limit =
      args && typeof args === "object" ? (args.limit ?? 20) : 20;
    const { data } = await axios.get<WorkTasksBoardResponse>(
      "/api/admin/work-tasks",
      {
        params: { q: q || undefined, limit },
        headers: authHeaders(getState),
      },
    );
    return data;
  },
);

export const fetchMoreWorkTasks = createAsyncThunk(
  "workTasks/fetchMore",
  async (
    args: { status: WorkTaskStatus; offset: number; q?: string; limit?: number },
    { getState },
  ) => {
    const { data } = await axios.get<WorkTasksColumnMoreResponse>(
      "/api/admin/work-tasks",
      {
        params: {
          status: args.status,
          offset: args.offset,
          limit: args.limit ?? 20,
          q: args.q || undefined,
        },
        headers: authHeaders(getState),
      },
    );
    return data;
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
      return rejectWithValue(
        err.response?.data?.error || "Permission update failed",
      );
    }
  },
);

function upsertTaskInColumns(
  columns: Record<WorkTaskStatus, WorkTaskColumnPage>,
  task: AdminWorkTask,
) {
  for (const st of Object.keys(columns) as WorkTaskStatus[]) {
    columns[st].tasks = columns[st].tasks.filter((t) => t.id !== task.id);
  }
  const col = columns[task.status];
  if (!col) return;
  col.tasks = [task, ...col.tasks];
  col.total += 1;
}

interface WorkTasksState {
  /** Flattened tasks currently loaded (all columns). */
  tasks: AdminWorkTask[];
  columns: Record<WorkTaskStatus, WorkTaskColumnPage>;
  query: string;
  pageLimit: number;
  assignees: WorkTaskAssignee[];
  loading: boolean;
  loadingMore: WorkTaskStatus | null;
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
  columns: {
    backlog: EMPTY_COLUMN(),
    doing: EMPTY_COLUMN(),
    done: EMPTY_COLUMN(),
  },
  query: "",
  pageLimit: 20,
  assignees: [],
  loading: false,
  loadingMore: null,
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

function syncFlatTasks(state: WorkTasksState) {
  state.tasks = (
    ["backlog", "doing", "done"] as WorkTaskStatus[]
  ).flatMap((st) => state.columns[st].tasks);
}

const workTasksSlice = createSlice({
  name: "workTasks",
  initialState,
  reducers: {
    clearWorkTasksError(state) {
      state.error = null;
    },
    setWorkTasksQuery(state, action: { payload: string }) {
      state.query = action.payload;
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
        state.query = action.payload.q || "";
        state.pageLimit = action.payload.limit || 20;
        const cols = action.payload.columns;
        state.columns = {
          backlog: cols?.backlog ?? EMPTY_COLUMN(state.pageLimit),
          doing: cols?.doing ?? EMPTY_COLUMN(state.pageLimit),
          done: cols?.done ?? EMPTY_COLUMN(state.pageLimit),
        };
        syncFlatTasks(state);
      })
      .addCase(fetchWorkTasks.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to load tasks";
      })
      .addCase(fetchMoreWorkTasks.pending, (state, action) => {
        state.loadingMore = action.meta.arg.status;
      })
      .addCase(fetchMoreWorkTasks.fulfilled, (state, action) => {
        state.loadingMore = null;
        const st = action.payload.status;
        const col = state.columns[st];
        if (!col) return;
        const seen = new Set(col.tasks.map((t) => t.id));
        const appended = action.payload.tasks.filter((t) => !seen.has(t.id));
        col.tasks = [...col.tasks, ...appended];
        col.total = action.payload.total;
        col.offset = action.payload.offset;
        col.limit = action.payload.limit;
        col.has_more = action.payload.has_more;
        syncFlatTasks(state);
      })
      .addCase(fetchMoreWorkTasks.rejected, (state, action) => {
        state.loadingMore = null;
        state.error = String(action.error.message || "Failed to load more");
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
        upsertTaskInColumns(state.columns, action.payload);
        const col = state.columns[action.payload.status];
        // Keep page size visually stable; still bump total
        if (col.tasks.length > state.pageLimit) {
          col.tasks = col.tasks.slice(0, state.pageLimit);
          col.has_more = col.total > col.tasks.length;
        }
        syncFlatTasks(state);
      })
      .addCase(createWorkTask.rejected, (state, action) => {
        state.saving = false;
        state.error = String(action.payload || "Create failed");
      })
      .addCase(updateWorkTask.fulfilled, (state, action) => {
        const task = action.payload;
        let wasPresent = false;
        for (const st of Object.keys(state.columns) as WorkTaskStatus[]) {
          const before = state.columns[st].tasks.length;
          state.columns[st].tasks = state.columns[st].tasks.filter(
            (t) => t.id !== task.id,
          );
          if (state.columns[st].tasks.length < before) {
            wasPresent = true;
            state.columns[st].total = Math.max(0, state.columns[st].total - 1);
          }
        }
        const col = state.columns[task.status];
        if (col) {
          col.tasks = [task, ...col.tasks];
          if (wasPresent) col.total += 1;
          else col.total += 1;
          if (col.tasks.length > state.pageLimit) {
            col.tasks = col.tasks.slice(0, state.pageLimit);
            col.has_more = col.total > col.tasks.length;
          }
        }
        syncFlatTasks(state);
      })
      .addCase(deleteWorkTask.fulfilled, (state, action) => {
        for (const st of Object.keys(state.columns) as WorkTaskStatus[]) {
          const before = state.columns[st].tasks.length;
          state.columns[st].tasks = state.columns[st].tasks.filter(
            (t) => t.id !== action.payload,
          );
          if (state.columns[st].tasks.length < before) {
            state.columns[st].total = Math.max(0, state.columns[st].total - 1);
            state.columns[st].has_more =
              state.columns[st].tasks.length < state.columns[st].total;
          }
        }
        syncFlatTasks(state);
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

export const { clearWorkTasksError, setWorkTasksQuery } =
  workTasksSlice.actions;
export default workTasksSlice.reducer;

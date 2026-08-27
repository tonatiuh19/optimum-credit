import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import api, { formatAxiosError } from "@/lib/api";
import type {
  AdminFundingBoardResponse,
  AdminFundingColumnMoreResponse,
  AdminFundingQuery,
  FundingApplication,
  FundingApplicationStatus,
  FundingDocSlot,
  FundingType,
  PipelineColumnPage,
} from "@shared/api";

/**
 * Public endpoints (no auth) — bypass `@/lib/api` interceptors so a logged-in
 * admin/client session never attaches a Bearer token to anonymous requests.
 */
const publicApi = axios.create({ baseURL: "/api" });

export const FUNDING_TOKEN_STORAGE_KEY = "funding_public_token";

export function getStoredFundingToken(): string | null {
  try {
    return sessionStorage.getItem(FUNDING_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredFundingToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(FUNDING_TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(FUNDING_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ─── Public ───────────────────────────────────────────────────────────────────

export interface StartFundingPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  funding_type: FundingType;
  preferred_language: "en" | "es";
}

export interface CreateAdminFundingPayload extends StartFundingPayload {
  status?: FundingApplicationStatus;
  postal_code?: string | null;
  state?: string | null;
  llc_name?: string | null;
  llc_address?: string | null;
  client_id?: number;
}

export interface UpdateFundingPayload {
  token: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string | null;
  postal_code?: string | null;
  state?: string | null;
  funding_type?: FundingType;
  preferred_language?: "en" | "es";
  llc_name?: string | null;
  llc_address?: string | null;
  ssn?: string;
  ein?: string;
}

interface FundingState {
  // Public wizard
  publicApplication: FundingApplication | null;
  publicLoading: boolean;
  publicSaving: boolean;
  publicUploading: boolean;
  publicSubmitting: boolean;
  publicError: string | null;

  // Admin board
  adminList: FundingApplication[];
  adminColumns: Record<string, PipelineColumnPage<FundingApplication>>;
  adminListLoading: boolean;
  adminListError: string | null;
  adminLoadingMore: string | null;
  adminPageLimit: number;
  adminDetail: FundingApplication | null;
  adminDetailLoading: boolean;
  adminDetailError: string | null;
  adminActionLoading: boolean;

  // Portal
  portalApplication: FundingApplication | null;
  portalLoading: boolean;
  portalUploading: boolean;
  portalError: string | null;
  portalInitialized: boolean;
}

const initialState: FundingState = {
  publicApplication: null,
  publicLoading: false,
  publicSaving: false,
  publicUploading: false,
  publicSubmitting: false,
  publicError: null,

  adminList: [],
  adminColumns: {},
  adminListLoading: false,
  adminListError: null,
  adminLoadingMore: null,
  adminPageLimit: 20,
  adminDetail: null,
  adminDetailLoading: false,
  adminDetailError: null,
  adminActionLoading: false,

  portalApplication: null,
  portalLoading: false,
  portalUploading: false,
  portalError: null,
  portalInitialized: false,
};

function unwrapApplication(data: unknown): FundingApplication {
  if (data && typeof data === "object" && "application" in data) {
    return (data as { application: FundingApplication }).application;
  }
  return data as FundingApplication;
}

/** Pick the portal funding row to show (exported for unit tests). */
export function pickPortalFundingApplication(
  data: unknown,
): FundingApplication | null {
  if (data == null) return null;
  if (typeof data === "object" && "applications" in data) {
    const list = (data as { applications?: FundingApplication[] }).applications;
    if (!Array.isArray(list) || list.length === 0) return null;
    const open = list.find(
      (a) =>
        a &&
        !["converted", "cancelled", "complete"].includes(String(a.status)),
    );
    return open || list[0] || null;
  }
  if (typeof data === "object" && "application" in data) {
    return (data as { application: FundingApplication | null }).application;
  }
  return null;
}

export const startFundingApplication = createAsyncThunk<
  FundingApplication,
  StartFundingPayload,
  { rejectValue: string }
>("funding/start", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await publicApi.post("/public/funding", payload);
    const application = unwrapApplication(data);
    if (application.public_token) {
      setStoredFundingToken(application.public_token);
    }
    return application;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not start your funding application."),
    );
  }
});

export const fetchFundingByToken = createAsyncThunk<
  FundingApplication,
  string,
  { rejectValue: string }
>("funding/fetchByToken", async (token, { rejectWithValue }) => {
  try {
    const { data } = await publicApi.get(`/public/funding/${token}`);
    const application = unwrapApplication(data);
    if (application.public_token) {
      setStoredFundingToken(application.public_token);
    }
    return application;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not load your funding application."),
    );
  }
});

export const updateFundingApplication = createAsyncThunk<
  FundingApplication,
  UpdateFundingPayload,
  { rejectValue: string }
>("funding/update", async ({ token, ...fields }, { rejectWithValue }) => {
  try {
    const { data } = await publicApi.patch(`/public/funding/${token}`, fields);
    return unwrapApplication(data);
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not save your information."),
    );
  }
});

export const uploadFundingDocument = createAsyncThunk<
  FundingApplication,
  { token: string; doc_type: FundingDocSlot; file: File },
  { rejectValue: string }
>("funding/uploadDoc", async ({ token, doc_type, file }, { rejectWithValue }) => {
  try {
    const fd = new FormData();
    fd.append("doc_type", doc_type);
    fd.append("file", file);
    const { data } = await publicApi.post(
      `/public/funding/${token}/documents`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return unwrapApplication(data);
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not upload document."),
    );
  }
});

export const submitFundingApplication = createAsyncThunk<
  FundingApplication,
  string,
  { rejectValue: string }
>("funding/submit", async (token, { rejectWithValue }) => {
  try {
    const { data } = await publicApi.post(`/public/funding/${token}/submit`);
    return unwrapApplication(data);
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not submit your application."),
    );
  }
});

// ─── Admin ────────────────────────────────────────────────────────────────────

function fundingQueryParams(
  args?: AdminFundingQuery,
): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (args?.search) params.search = args.search;
  if (args?.funding_type && args.funding_type !== "all") {
    params.funding_type = args.funding_type;
  }
  if (args?.language && args.language !== "all") {
    params.language = args.language;
  }
  if (args?.limit != null) params.limit = args.limit;
  if (args?.column) params.column = args.column;
  if (args?.offset != null) params.offset = args.offset;
  return params;
}

export const fetchFundingApplications = createAsyncThunk<
  AdminFundingBoardResponse,
  AdminFundingQuery | void,
  { rejectValue: string }
>("funding/adminList", async (args, { rejectWithValue }) => {
  try {
    const query = (args || {}) as AdminFundingQuery;
    const { data } = await api.get("/admin/funding", {
      params: fundingQueryParams({
        ...query,
        limit: query.limit ?? 20,
        column: undefined,
        offset: undefined,
      }),
    });
    if (Array.isArray(data)) {
      return { applications: data as FundingApplication[] };
    }
    return {
      applications: (data.applications || []) as FundingApplication[],
      columns: data.columns as AdminFundingBoardResponse["columns"],
      limit: data.limit,
    };
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not load funding applications."),
    );
  }
});

export const fetchMoreFundingColumn = createAsyncThunk<
  AdminFundingColumnMoreResponse,
  AdminFundingQuery & { column: string; offset: number },
  { rejectValue: string }
>("funding/adminListMore", async (args, { rejectWithValue }) => {
  try {
    const { data } = await api.get("/admin/funding", {
      params: fundingQueryParams({
        ...args,
        limit: args.limit ?? 20,
        column: args.column,
        offset: args.offset,
      }),
    });
    return data as AdminFundingColumnMoreResponse;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not load more applications."),
    );
  }
});

export const createAdminFundingApplication = createAsyncThunk<
  FundingApplication,
  CreateAdminFundingPayload,
  { rejectValue: string }
>("funding/adminCreate", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/admin/funding", payload);
    return unwrapApplication(data);
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not create funding application."),
    );
  }
});

export const fetchFundingApplication = createAsyncThunk<
  FundingApplication,
  number,
  { rejectValue: string }
>("funding/adminDetail", async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/admin/funding/${id}`);
    return unwrapApplication(data);
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not load application."),
    );
  }
});

export const setFundingApplicationStatus = createAsyncThunk<
  FundingApplication,
  { id: number; status: FundingApplicationStatus },
  { rejectValue: string }
>("funding/adminStatus", async ({ id, status }, { rejectWithValue }) => {
  try {
    const { data } = await api.post(`/admin/funding/${id}/status`, { status });
    return unwrapApplication(data);
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not update status."),
    );
  }
});

export const convertFundingApplication = createAsyncThunk<
  FundingApplication,
  number,
  { rejectValue: string }
>("funding/adminConvert", async (id, { rejectWithValue }) => {
  try {
    const { data } = await api.post(`/admin/funding/${id}/convert`);
    return unwrapApplication(data);
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not convert to prospect."),
    );
  }
});

// ─── Portal ───────────────────────────────────────────────────────────────────

export const fetchPortalFunding = createAsyncThunk<
  FundingApplication | null,
  void,
  { rejectValue: string }
>("funding/portalFetch", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get("/portal/funding");
    return pickPortalFundingApplication(data);
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Could not load funding status."),
    );
  }
});

export const uploadPortalFundingDocument = createAsyncThunk<
  FundingApplication,
  { id: number; doc_type: FundingDocSlot; file: File },
  { rejectValue: string }
>(
  "funding/portalUpload",
  async ({ id, doc_type, file }, { rejectWithValue }) => {
    try {
      const fd = new FormData();
      fd.append("doc_type", doc_type);
      fd.append("file", file);
      const { data } = await api.post(`/portal/funding/${id}/documents`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return unwrapApplication(data);
    } catch (err: unknown) {
      return rejectWithValue(
        formatAxiosError(err, "Could not upload document."),
      );
    }
  },
);

const slice = createSlice({
  name: "funding",
  initialState,
  reducers: {
    clearPublicFundingError(s) {
      s.publicError = null;
    },
    clearPublicFunding(s) {
      s.publicApplication = null;
      s.publicError = null;
      s.publicLoading = false;
      s.publicSaving = false;
      s.publicUploading = false;
      s.publicSubmitting = false;
    },
    clearAdminFundingDetail(s) {
      s.adminDetail = null;
      s.adminDetailError = null;
    },
  },
  extraReducers: (b) => {
    // Public start
    b.addCase(startFundingApplication.pending, (s) => {
      s.publicSaving = true;
      s.publicError = null;
    });
    b.addCase(startFundingApplication.fulfilled, (s, a) => {
      s.publicSaving = false;
      s.publicApplication = a.payload;
    });
    b.addCase(startFundingApplication.rejected, (s, a) => {
      s.publicSaving = false;
      s.publicError = a.payload ?? "Something went wrong";
    });

    // Public fetch
    b.addCase(fetchFundingByToken.pending, (s) => {
      s.publicLoading = true;
      s.publicError = null;
    });
    b.addCase(fetchFundingByToken.fulfilled, (s, a) => {
      s.publicLoading = false;
      s.publicApplication = a.payload;
    });
    b.addCase(fetchFundingByToken.rejected, (s, a) => {
      s.publicLoading = false;
      s.publicError = a.payload ?? "Something went wrong";
    });

    // Public update
    b.addCase(updateFundingApplication.pending, (s) => {
      s.publicSaving = true;
      s.publicError = null;
    });
    b.addCase(updateFundingApplication.fulfilled, (s, a) => {
      s.publicSaving = false;
      s.publicApplication = a.payload;
    });
    b.addCase(updateFundingApplication.rejected, (s, a) => {
      s.publicSaving = false;
      s.publicError = a.payload ?? "Something went wrong";
    });

    // Public upload
    b.addCase(uploadFundingDocument.pending, (s) => {
      s.publicUploading = true;
      s.publicError = null;
    });
    b.addCase(uploadFundingDocument.fulfilled, (s, a) => {
      s.publicUploading = false;
      s.publicApplication = a.payload;
    });
    b.addCase(uploadFundingDocument.rejected, (s, a) => {
      s.publicUploading = false;
      s.publicError = a.payload ?? "Something went wrong";
    });

    // Public submit
    b.addCase(submitFundingApplication.pending, (s) => {
      s.publicSubmitting = true;
      s.publicError = null;
    });
    b.addCase(submitFundingApplication.fulfilled, (s, a) => {
      s.publicSubmitting = false;
      s.publicApplication = a.payload;
    });
    b.addCase(submitFundingApplication.rejected, (s, a) => {
      s.publicSubmitting = false;
      s.publicError = a.payload ?? "Something went wrong";
    });

    // Admin list
    b.addCase(fetchFundingApplications.pending, (s) => {
      s.adminListLoading = true;
      s.adminListError = null;
    });
    b.addCase(fetchFundingApplications.fulfilled, (s, a) => {
      s.adminListLoading = false;
      s.adminList = a.payload.applications;
      s.adminColumns = a.payload.columns ?? {};
      s.adminPageLimit = a.payload.limit ?? 20;
    });
    b.addCase(fetchFundingApplications.rejected, (s, a) => {
      s.adminListLoading = false;
      s.adminListError = a.payload ?? "Something went wrong";
    });

    b.addCase(fetchMoreFundingColumn.pending, (s, a) => {
      s.adminLoadingMore = a.meta.arg.column;
    });
    b.addCase(fetchMoreFundingColumn.fulfilled, (s, a) => {
      s.adminLoadingMore = null;
      const colKey = a.payload.column;
      const prev = s.adminColumns[colKey] ?? {
        items: [],
        total: 0,
        offset: 0,
        limit: s.adminPageLimit,
        has_more: false,
      };
      const mergedIds = new Set(prev.items.map((x) => x.id));
      const newItems = a.payload.items.filter((x) => !mergedIds.has(x.id));
      s.adminColumns[colKey] = {
        items: [...prev.items, ...newItems],
        total: a.payload.total,
        offset: a.payload.offset,
        limit: a.payload.limit,
        has_more: a.payload.has_more,
      };
      const listIds = new Set(s.adminList.map((x) => x.id));
      for (const item of newItems) {
        if (!listIds.has(item.id)) s.adminList.push(item);
      }
    });
    b.addCase(fetchMoreFundingColumn.rejected, (s) => {
      s.adminLoadingMore = null;
    });

    b.addCase(createAdminFundingApplication.pending, (s) => {
      s.adminActionLoading = true;
      s.adminListError = null;
    });
    b.addCase(createAdminFundingApplication.fulfilled, (s, a) => {
      s.adminActionLoading = false;
      const idx = s.adminList.findIndex((x) => x.id === a.payload.id);
      if (idx >= 0) s.adminList[idx] = a.payload;
      else s.adminList.unshift(a.payload);
    });
    b.addCase(createAdminFundingApplication.rejected, (s, a) => {
      s.adminActionLoading = false;
      s.adminListError = a.payload ?? "Something went wrong";
    });

    // Admin detail
    b.addCase(fetchFundingApplication.pending, (s) => {
      s.adminDetailLoading = true;
      s.adminDetailError = null;
    });
    b.addCase(fetchFundingApplication.fulfilled, (s, a) => {
      s.adminDetailLoading = false;
      s.adminDetail = a.payload;
      const idx = s.adminList.findIndex((x) => x.id === a.payload.id);
      if (idx >= 0) s.adminList[idx] = a.payload;
    });
    b.addCase(fetchFundingApplication.rejected, (s, a) => {
      s.adminDetailLoading = false;
      s.adminDetailError = a.payload ?? "Something went wrong";
    });

    // Admin status / convert
    const bumpAdminApp = (
      s: FundingState,
      app: FundingApplication,
    ) => {
      s.adminDetail = app;
      const idx = s.adminList.findIndex((x) => x.id === app.id);
      if (idx >= 0) s.adminList[idx] = app;
      else s.adminList.unshift(app);
    };

    b.addCase(setFundingApplicationStatus.pending, (s) => {
      s.adminActionLoading = true;
      s.adminDetailError = null;
    });
    b.addCase(setFundingApplicationStatus.fulfilled, (s, a) => {
      s.adminActionLoading = false;
      bumpAdminApp(s, a.payload);
    });
    b.addCase(setFundingApplicationStatus.rejected, (s, a) => {
      s.adminActionLoading = false;
      s.adminDetailError = a.payload ?? "Something went wrong";
    });

    b.addCase(convertFundingApplication.pending, (s) => {
      s.adminActionLoading = true;
      s.adminDetailError = null;
    });
    b.addCase(convertFundingApplication.fulfilled, (s, a) => {
      s.adminActionLoading = false;
      bumpAdminApp(s, a.payload);
    });
    b.addCase(convertFundingApplication.rejected, (s, a) => {
      s.adminActionLoading = false;
      s.adminDetailError = a.payload ?? "Something went wrong";
    });

    // Portal
    b.addCase(fetchPortalFunding.pending, (s) => {
      s.portalLoading = true;
      s.portalError = null;
    });
    b.addCase(fetchPortalFunding.fulfilled, (s, a) => {
      s.portalLoading = false;
      s.portalApplication = a.payload;
      s.portalInitialized = true;
    });
    b.addCase(fetchPortalFunding.rejected, (s, a) => {
      s.portalLoading = false;
      s.portalError = a.payload ?? "Something went wrong";
      s.portalInitialized = true;
    });

    b.addCase(uploadPortalFundingDocument.pending, (s) => {
      s.portalUploading = true;
      s.portalError = null;
    });
    b.addCase(uploadPortalFundingDocument.fulfilled, (s, a) => {
      s.portalUploading = false;
      s.portalApplication = a.payload;
    });
    b.addCase(uploadPortalFundingDocument.rejected, (s, a) => {
      s.portalUploading = false;
      s.portalError = a.payload ?? "Something went wrong";
    });
  },
});

export const {
  clearPublicFundingError,
  clearPublicFunding,
  clearAdminFundingDetail,
} = slice.actions;
export default slice.reducer;

import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import api, { formatAxiosError } from "@/lib/api";
import type {
  EventCheckInTokenResponse,
  EventCompany,
  EventCompanyDetail,
  EventCompanyResults,
  EventImportResponse,
  EventImportRow,
  EventFormField,
  EventFormFieldType,
  EventQrSource,
  EventRegistration,
  EventSeries,
  EventSeriesKind,
  EventSession,
  EventSessionStatus,
  PublicEventCheckInInfo,
  PublicEventCheckInRequest,
  PublicEventCheckInResponse,
  PublicEventLandingResponse,
  PublicEventRegisterRequest,
  PublicEventRegisterResponse,
} from "@shared/api";

/**
 * Public endpoints (no auth) — bypass `@/lib/api` interceptors so a logged-in
 * admin/client session never attaches a Bearer token to anonymous requests.
 */
const publicApi = axios.create({ baseURL: "/api" });

// ─── State ────────────────────────────────────────────────────────────────────

interface EventMarketingState {
  // Public landing
  publicCompanies: PublicEventLandingResponse["companies"];
  publicLanding: PublicEventLandingResponse | null;
  publicLoading: boolean;
  publicError: string | null;
  publicRegistering: boolean;
  publicRegisterError: string | null;
  publicRegisterResult: PublicEventRegisterResponse | null;

  // Admin
  companies: EventCompany[];
  companiesLoading: boolean;
  companiesError: string | null;
  detail: EventCompanyDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  saving: boolean;
  saveError: string | null;
  results: EventCompanyResults | null;
  resultsLoading: boolean;
  resultsError: string | null;
  importing: boolean;
  importResult: EventImportResponse | null;
  importError: string | null;

  // Public door check-in
  checkInInfo: PublicEventCheckInInfo | null;
  checkInLoading: boolean;
  checkInError: string | null;
  checkInSubmitting: boolean;
  checkInStatus: PublicEventCheckInResponse["status"] | null;
  checkInSubmitError: string | null;
}

const initialState: EventMarketingState = {
  publicCompanies: [],
  publicLanding: null,
  publicLoading: false,
  publicError: null,
  publicRegistering: false,
  publicRegisterError: null,
  publicRegisterResult: null,

  companies: [],
  companiesLoading: false,
  companiesError: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  saving: false,
  saveError: null,
  results: null,
  resultsLoading: false,
  resultsError: null,
  importing: false,
  importResult: null,
  importError: null,

  checkInInfo: null,
  checkInLoading: false,
  checkInError: null,
  checkInSubmitting: false,
  checkInStatus: null,
  checkInSubmitError: null,
};

// ─── Public thunks ────────────────────────────────────────────────────────────

export const fetchPublicEventCompanies = createAsyncThunk(
  "eventMarketing/fetchPublicCompanies",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await publicApi.get<{
        companies: PublicEventLandingResponse["companies"];
      }>("/public/event-marketing");
      return data.companies;
    } catch (err) {
      return rejectWithValue(
        formatAxiosError(err, "Could not load event companies."),
      );
    }
  },
);

export const fetchPublicEventLanding = createAsyncThunk(
  "eventMarketing/fetchPublicLanding",
  async (
    args: { slug: string; session?: string },
    { rejectWithValue },
  ) => {
    try {
      const slug = args.slug.trim();
      const session = args.session?.trim();
      const { data } = await publicApi.get<PublicEventLandingResponse>(
        `/public/event-marketing/${encodeURIComponent(slug)}`,
        { params: session ? { session } : undefined },
      );
      return data;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not load event landing."));
    }
  },
);

export const registerPublicEvent = createAsyncThunk(
  "eventMarketing/registerPublic",
  async (payload: PublicEventRegisterRequest, { rejectWithValue }) => {
    try {
      const { data } = await publicApi.post<PublicEventRegisterResponse>(
        "/public/event-marketing/register",
        payload,
      );
      return data;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not complete registration."));
    }
  },
);

export const clearPublicEventRegister = createAsyncThunk(
  "eventMarketing/clearPublicRegister",
  async () => null,
);

// ─── Admin thunks ─────────────────────────────────────────────────────────────

export const fetchEventCompanies = createAsyncThunk(
  "eventMarketing/fetchCompanies",
  async (_, { rejectWithValue }) => {
    try {
      const { data } = await api.get<{ companies: EventCompany[] }>(
        "/admin/event-marketing/companies",
      );
      return data.companies;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not load event companies."));
    }
  },
);

export const fetchEventCompanyDetail = createAsyncThunk(
  "eventMarketing/fetchCompanyDetail",
  async (id: number, { rejectWithValue }) => {
    try {
      const { data } = await api.get<EventCompanyDetail>(
        `/admin/event-marketing/companies/${id}`,
      );
      return data;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not load company detail."));
    }
  },
);

export type CreateEventCompanyPayload = {
  slug: string;
  name: string;
  name_es?: string | null;
  label_slug: string;
  is_active?: boolean;
  sort_order?: number;
  welcome_heading_en: string;
  welcome_heading_es: string;
  welcome_body_en: string;
  welcome_body_es: string;
  offer_free_report?: boolean;
  offer_comic?: boolean;
  class_link_url?: string | null;
  class_schedule_note_en?: string | null;
  class_schedule_note_es?: string | null;
  email_subject_en: string;
  email_subject_es: string;
  email_body_en: string;
  email_body_es: string;
  sms_body_en: string;
  sms_body_es: string;
};

export const createEventCompany = createAsyncThunk(
  "eventMarketing/createCompany",
  async (payload: CreateEventCompanyPayload, { rejectWithValue }) => {
    try {
      const { data } = await api.post<EventCompanyDetail>(
        "/admin/event-marketing/companies",
        payload,
      );
      return data;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not create company."));
    }
  },
);

export const updateEventCompany = createAsyncThunk(
  "eventMarketing/updateCompany",
  async (
    { id, ...rest }: Partial<CreateEventCompanyPayload> & { id: number },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.put<EventCompanyDetail>(
        `/admin/event-marketing/companies/${id}`,
        rest,
      );
      return data;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not update company."));
    }
  },
);

export type CreateEventSeriesPayload = {
  companyId: number;
  slug: string;
  name_en: string;
  name_es: string;
  kind?: EventSeriesKind;
  is_active?: boolean;
  sort_order?: number;
};

export const createEventSeries = createAsyncThunk(
  "eventMarketing/createSeries",
  async ({ companyId, ...payload }: CreateEventSeriesPayload, { rejectWithValue }) => {
    try {
      const { data } = await api.post<{ series: EventSeries }>(
        `/admin/event-marketing/companies/${companyId}/series`,
        payload,
      );
      return data.series;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not create series."));
    }
  },
);

export const updateEventSeries = createAsyncThunk(
  "eventMarketing/updateSeries",
  async (
    {
      id,
      ...rest
    }: {
      id: number;
      slug?: string;
      name_en?: string;
      name_es?: string;
      kind?: EventSeriesKind;
      is_active?: boolean;
      sort_order?: number;
    },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.put<{ series: EventSeries }>(
        `/admin/event-marketing/series/${id}`,
        rest,
      );
      return data.series;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not update series."));
    }
  },
);

export type CreateEventSessionPayload = {
  companyId: number;
  series_id: number;
  short_code: string;
  title_en: string;
  title_es: string;
  starts_at: string;
  ends_at?: string | null;
  location_en?: string | null;
  location_es?: string | null;
  capacity?: number | null;
  status?: EventSessionStatus;
};

export const createEventSession = createAsyncThunk(
  "eventMarketing/createSession",
  async ({ companyId, ...payload }: CreateEventSessionPayload, { rejectWithValue }) => {
    try {
      const { data } = await api.post<{ session: EventSession }>(
        `/admin/event-marketing/companies/${companyId}/sessions`,
        payload,
      );
      return data.session;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not create session."));
    }
  },
);

export const updateEventSession = createAsyncThunk(
  "eventMarketing/updateSession",
  async (
    {
      id,
      ...rest
    }: {
      id: number;
      series_id?: number;
      short_code?: string;
      title_en?: string;
      title_es?: string;
      starts_at?: string;
      ends_at?: string | null;
      location_en?: string | null;
      location_es?: string | null;
      capacity?: number | null;
      status?: EventSessionStatus;
    },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.put<{ session: EventSession }>(
        `/admin/event-marketing/sessions/${id}`,
        rest,
      );
      return data.session;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not update session."));
    }
  },
);

export type CreateEventFormFieldPayload = {
  companyId: number;
  field_key: string;
  label_en: string;
  label_es: string;
  field_type: EventFormFieldType;
  options_json?: string[] | null;
  is_required?: boolean;
  is_active?: boolean;
  sort_order?: number;
};

export const createEventFormField = createAsyncThunk(
  "eventMarketing/createFormField",
  async ({ companyId, ...payload }: CreateEventFormFieldPayload, { rejectWithValue }) => {
    try {
      const { data } = await api.post<{ field: EventFormField }>(
        `/admin/event-marketing/companies/${companyId}/form-fields`,
        payload,
      );
      return data.field;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not create form field."));
    }
  },
);

export const updateEventFormField = createAsyncThunk(
  "eventMarketing/updateFormField",
  async (
    {
      id,
      ...rest
    }: {
      id: number;
      field_key?: string;
      label_en?: string;
      label_es?: string;
      field_type?: EventFormFieldType;
      options_json?: string[] | null;
      is_required?: boolean;
      is_active?: boolean;
      sort_order?: number;
    },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.put<{ field: EventFormField }>(
        `/admin/event-marketing/form-fields/${id}`,
        rest,
      );
      return data.field;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not update form field."));
    }
  },
);

export const deleteEventFormField = createAsyncThunk(
  "eventMarketing/deleteFormField",
  async (id: number, { rejectWithValue }) => {
    try {
      await api.delete(`/admin/event-marketing/form-fields/${id}`);
      return id;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not delete form field."));
    }
  },
);

export const checkInEventRegistration = createAsyncThunk(
  "eventMarketing/checkInRegistration",
  async (id: number, { rejectWithValue }) => {
    try {
      const { data } = await api.post<{ registration: EventRegistration }>(
        `/admin/event-marketing/registrations/${id}/check-in`,
      );
      return data.registration;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not check in registration."));
    }
  },
);

export const undoEventCheckIn = createAsyncThunk(
  "eventMarketing/undoCheckIn",
  async (id: number, { rejectWithValue }) => {
    try {
      const { data } = await api.delete<{ registration: EventRegistration }>(
        `/admin/event-marketing/registrations/${id}/check-in`,
      );
      return data.registration;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not undo check-in."));
    }
  },
);

/** Cancels a registration; the freed seat goes to the next waitlisted person. */
export const cancelEventRegistration = createAsyncThunk(
  "eventMarketing/cancelRegistration",
  async (id: number, { rejectWithValue }) => {
    try {
      const { data } = await api.post<EventCompanyDetail>(
        `/admin/event-marketing/registrations/${id}/cancel`,
      );
      return data;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not cancel registration."));
    }
  },
);

/** Door QR link for a session (created once, then reused). */
export const fetchEventCheckInLink = createAsyncThunk(
  "eventMarketing/fetchCheckInLink",
  async (sessionId: number, { rejectWithValue }) => {
    try {
      const { data } = await api.post<EventCheckInTokenResponse>(
        `/admin/event-marketing/sessions/${sessionId}/checkin-token`,
      );
      return { sessionId, ...data };
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not create the door QR."));
    }
  },
);

/** Paper sign-in sheet rows → registrations (+ attended). */
export const importEventSignInSheet = createAsyncThunk(
  "eventMarketing/importSheet",
  async (
    { sessionId, rows }: { sessionId: number; rows: EventImportRow[] },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.post<EventImportResponse>(
        `/admin/event-marketing/sessions/${sessionId}/import`,
        { rows },
      );
      return data;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not import the sign-in sheet."));
    }
  },
);

export const fetchEventResults = createAsyncThunk(
  "eventMarketing/fetchResults",
  async (companyId: number, { rejectWithValue }) => {
    try {
      const { data } = await api.get<EventCompanyResults>(
        `/admin/event-marketing/companies/${companyId}/results`,
      );
      return data;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Could not load results."));
    }
  },
);

export const fetchPublicCheckIn = createAsyncThunk(
  "eventMarketing/fetchPublicCheckIn",
  async (token: string, { rejectWithValue }) => {
    try {
      const { data } = await publicApi.get<PublicEventCheckInInfo>(
        `/public/event-marketing/check-in/${encodeURIComponent(token)}`,
      );
      return data;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "Check-in not found."));
    }
  },
);

export const submitPublicCheckIn = createAsyncThunk(
  "eventMarketing/submitPublicCheckIn",
  async (
    { token, body }: { token: string; body: PublicEventCheckInRequest },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await publicApi.post<PublicEventCheckInResponse>(
        `/public/event-marketing/check-in/${encodeURIComponent(token)}`,
        body,
      );
      return data;
    } catch (err) {
      return rejectWithValue(formatAxiosError(err, "We couldn't check you in."));
    }
  },
);

// ─── Slice ────────────────────────────────────────────────────────────────────

const eventMarketingSlice = createSlice({
  name: "eventMarketing",
  initialState,
  reducers: {
    clearPublicRegisterLocal(state) {
      state.publicRegisterResult = null;
      state.publicRegisterError = null;
    },
    clearSaveError(state) {
      state.saveError = null;
    },
    clearEventImport(state) {
      state.importResult = null;
      state.importError = null;
    },
    resetPublicCheckIn(state) {
      state.checkInStatus = null;
      state.checkInSubmitError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPublicEventCompanies.pending, (state) => {
        state.publicLoading = true;
        state.publicError = null;
      })
      .addCase(fetchPublicEventCompanies.fulfilled, (state, action) => {
        state.publicLoading = false;
        state.publicCompanies = action.payload;
      })
      .addCase(fetchPublicEventCompanies.rejected, (state, action) => {
        state.publicLoading = false;
        state.publicError =
          (action.payload as string) || action.error.message || "Failed to load";
      })
      .addCase(fetchPublicEventLanding.pending, (state) => {
        state.publicLoading = true;
        state.publicError = null;
      })
      .addCase(fetchPublicEventLanding.fulfilled, (state, action) => {
        state.publicLoading = false;
        state.publicLanding = action.payload;
        state.publicCompanies = action.payload.companies;
        state.publicRegisterResult = null;
        state.publicRegisterError = null;
      })
      .addCase(fetchPublicEventLanding.rejected, (state, action) => {
        state.publicLoading = false;
        state.publicError =
          (action.payload as string) || action.error.message || "Failed to load";
        state.publicLanding = null;
      })
      .addCase(registerPublicEvent.pending, (state) => {
        state.publicRegistering = true;
        state.publicRegisterError = null;
      })
      .addCase(registerPublicEvent.fulfilled, (state, action) => {
        state.publicRegistering = false;
        state.publicRegisterResult = action.payload;
      })
      .addCase(registerPublicEvent.rejected, (state, action) => {
        state.publicRegistering = false;
        state.publicRegisterError =
          (action.payload as string) ||
          action.error.message ||
          "Registration failed";
      })
      .addCase(clearPublicEventRegister.fulfilled, (state) => {
        state.publicRegisterResult = null;
        state.publicRegisterError = null;
      })

      .addCase(fetchEventCompanies.pending, (state) => {
        state.companiesLoading = true;
        state.companiesError = null;
      })
      .addCase(fetchEventCompanies.fulfilled, (state, action) => {
        state.companiesLoading = false;
        state.companies = action.payload;
      })
      .addCase(fetchEventCompanies.rejected, (state, action) => {
        state.companiesLoading = false;
        state.companiesError =
          (action.payload as string) || action.error.message || "Failed to load";
      })
      .addCase(fetchEventCompanyDetail.pending, (state) => {
        state.detailLoading = true;
        state.detailError = null;
      })
      .addCase(fetchEventCompanyDetail.fulfilled, (state, action) => {
        state.detailLoading = false;
        state.detail = action.payload;
      })
      .addCase(fetchEventCompanyDetail.rejected, (state, action) => {
        state.detailLoading = false;
        state.detailError =
          (action.payload as string) || action.error.message || "Failed to load";
        state.detail = null;
      })

      .addCase(createEventCompany.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(createEventCompany.fulfilled, (state, action) => {
        state.saving = false;
        state.detail = action.payload;
        state.companies = [
          ...state.companies.filter((c) => c.id !== action.payload.company.id),
          action.payload.company,
        ].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      })
      .addCase(createEventCompany.rejected, (state, action) => {
        state.saving = false;
        state.saveError =
          (action.payload as string) || action.error.message || "Save failed";
      })
      .addCase(updateEventCompany.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(updateEventCompany.fulfilled, (state, action) => {
        state.saving = false;
        state.detail = action.payload;
        state.companies = state.companies.map((c) =>
          c.id === action.payload.company.id
            ? { ...c, ...action.payload.company }
            : c,
        );
      })
      .addCase(updateEventCompany.rejected, (state, action) => {
        state.saving = false;
        state.saveError =
          (action.payload as string) || action.error.message || "Save failed";
      })

      .addCase(createEventSeries.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(createEventSeries.fulfilled, (state, action) => {
        state.saving = false;
        if (state.detail) {
          state.detail = {
            ...state.detail,
            series: [...state.detail.series, action.payload].sort(
              (a, b) => a.sort_order - b.sort_order || a.id - b.id,
            ),
          };
        }
      })
      .addCase(createEventSeries.rejected, (state, action) => {
        state.saving = false;
        state.saveError =
          (action.payload as string) || action.error.message || "Save failed";
      })
      .addCase(updateEventSeries.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(updateEventSeries.fulfilled, (state, action) => {
        state.saving = false;
        if (state.detail) {
          state.detail = {
            ...state.detail,
            series: state.detail.series.map((s) =>
              s.id === action.payload.id ? action.payload : s,
            ),
          };
        }
      })
      .addCase(updateEventSeries.rejected, (state, action) => {
        state.saving = false;
        state.saveError =
          (action.payload as string) || action.error.message || "Save failed";
      })

      .addCase(createEventSession.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(createEventSession.fulfilled, (state, action) => {
        state.saving = false;
        if (state.detail) {
          state.detail = {
            ...state.detail,
            sessions: [...state.detail.sessions, action.payload].sort((a, b) =>
              String(a.starts_at).localeCompare(String(b.starts_at)),
            ),
          };
        }
      })
      .addCase(createEventSession.rejected, (state, action) => {
        state.saving = false;
        state.saveError =
          (action.payload as string) || action.error.message || "Save failed";
      })
      .addCase(updateEventSession.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(updateEventSession.fulfilled, (state, action) => {
        state.saving = false;
        if (state.detail) {
          state.detail = {
            ...state.detail,
            sessions: state.detail.sessions
              .map((s) => (s.id === action.payload.id ? action.payload : s))
              .sort((a, b) =>
                String(a.starts_at).localeCompare(String(b.starts_at)),
              ),
          };
        }
      })
      .addCase(updateEventSession.rejected, (state, action) => {
        state.saving = false;
        state.saveError =
          (action.payload as string) || action.error.message || "Save failed";
      })

      .addCase(createEventFormField.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(createEventFormField.fulfilled, (state, action) => {
        state.saving = false;
        if (state.detail) {
          state.detail = {
            ...state.detail,
            form_fields: [...state.detail.form_fields, action.payload].sort(
              (a, b) => a.sort_order - b.sort_order || a.id - b.id,
            ),
          };
        }
      })
      .addCase(createEventFormField.rejected, (state, action) => {
        state.saving = false;
        state.saveError =
          (action.payload as string) || action.error.message || "Save failed";
      })
      .addCase(updateEventFormField.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(updateEventFormField.fulfilled, (state, action) => {
        state.saving = false;
        if (state.detail) {
          state.detail = {
            ...state.detail,
            form_fields: state.detail.form_fields
              .map((f) => (f.id === action.payload.id ? action.payload : f))
              .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
          };
        }
      })
      .addCase(updateEventFormField.rejected, (state, action) => {
        state.saving = false;
        state.saveError =
          (action.payload as string) || action.error.message || "Save failed";
      })
      .addCase(deleteEventFormField.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(deleteEventFormField.fulfilled, (state, action) => {
        state.saving = false;
        if (state.detail) {
          state.detail = {
            ...state.detail,
            form_fields: state.detail.form_fields.filter(
              (f) => f.id !== action.payload,
            ),
          };
        }
      })
      .addCase(deleteEventFormField.rejected, (state, action) => {
        state.saving = false;
        state.saveError =
          (action.payload as string) || action.error.message || "Delete failed";
      })

      .addCase(checkInEventRegistration.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(undoEventCheckIn.fulfilled, (state, action) => {
        if (state.detail) {
          state.detail = {
            ...state.detail,
            registrations: state.detail.registrations.map((r) =>
              r.id === action.payload.id ? { ...r, ...action.payload } : r,
            ),
          };
        }
      })
      .addCase(undoEventCheckIn.rejected, (state, action) => {
        state.saveError = (action.payload as string) || "Could not undo check-in.";
      })
      .addCase(cancelEventRegistration.pending, (state) => {
        state.saving = true;
        state.saveError = null;
      })
      .addCase(cancelEventRegistration.fulfilled, (state, action) => {
        state.saving = false;
        state.detail = action.payload;
      })
      .addCase(cancelEventRegistration.rejected, (state, action) => {
        state.saving = false;
        state.saveError = (action.payload as string) || "Could not cancel registration.";
      })
      .addCase(fetchEventCheckInLink.fulfilled, (state, action) => {
        if (state.detail) {
          state.detail = {
            ...state.detail,
            sessions: state.detail.sessions.map((s) =>
              s.id === action.payload.sessionId ? { ...s, has_checkin_token: true } : s,
            ),
          };
        }
      })
      .addCase(fetchEventCheckInLink.rejected, (state, action) => {
        state.saveError = (action.payload as string) || "Could not create the door QR.";
      })
      .addCase(importEventSignInSheet.pending, (state) => {
        state.importing = true;
        state.importError = null;
        state.importResult = null;
      })
      .addCase(importEventSignInSheet.fulfilled, (state, action) => {
        state.importing = false;
        state.importResult = action.payload;
        state.detail = action.payload.detail;
      })
      .addCase(importEventSignInSheet.rejected, (state, action) => {
        state.importing = false;
        state.importError = (action.payload as string) || "Could not import the sign-in sheet.";
      })
      .addCase(fetchEventResults.pending, (state) => {
        state.resultsLoading = true;
        state.resultsError = null;
      })
      .addCase(fetchEventResults.fulfilled, (state, action) => {
        state.resultsLoading = false;
        state.results = action.payload;
      })
      .addCase(fetchEventResults.rejected, (state, action) => {
        state.resultsLoading = false;
        state.resultsError = (action.payload as string) || "Could not load results.";
      })
      .addCase(fetchPublicCheckIn.pending, (state) => {
        state.checkInLoading = true;
        state.checkInError = null;
      })
      .addCase(fetchPublicCheckIn.fulfilled, (state, action) => {
        state.checkInLoading = false;
        state.checkInInfo = action.payload;
      })
      .addCase(fetchPublicCheckIn.rejected, (state, action) => {
        state.checkInLoading = false;
        state.checkInInfo = null;
        state.checkInError = (action.payload as string) || "Check-in not found.";
      })
      .addCase(submitPublicCheckIn.pending, (state) => {
        state.checkInSubmitting = true;
        state.checkInSubmitError = null;
      })
      .addCase(submitPublicCheckIn.fulfilled, (state, action) => {
        state.checkInSubmitting = false;
        state.checkInStatus = action.payload.status;
      })
      .addCase(submitPublicCheckIn.rejected, (state, action) => {
        state.checkInSubmitting = false;
        state.checkInSubmitError = (action.payload as string) || "We couldn't check you in.";
      })
      .addCase(checkInEventRegistration.fulfilled, (state, action) => {
        state.saving = false;
        if (state.detail) {
          state.detail = {
            ...state.detail,
            registrations: state.detail.registrations.map((r) =>
              r.id === action.payload.id ? { ...r, ...action.payload } : r,
            ),
          };
        }
      })
      .addCase(checkInEventRegistration.rejected, (state, action) => {
        state.saving = false;
        state.saveError =
          (action.payload as string) || action.error.message || "Check-in failed";
      });
  },
});

export const {
  clearPublicRegisterLocal,
  clearSaveError,
  clearEventImport,
  resetPublicCheckIn,
} =
  eventMarketingSlice.actions;

export type { EventQrSource };

export default eventMarketingSlice.reducer;

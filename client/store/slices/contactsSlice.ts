import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { RootState } from "../index";
import api, { formatAxiosError } from "@/lib/api";
import type {
  AdminCrmContact,
  AdminCrmContactWritePayload,
  AdminCrmContactsListQuery,
  AdminCrmContactsListResponse,
  ConvertCrmContactResponse,
} from "@shared/api";

type ContactsState = {
  contacts: AdminCrmContact[];
  contactsPagination: AdminCrmContactsListResponse["pagination"] | null;
  contactsListQuery: AdminCrmContactsListQuery | null;
  contactsLoading: boolean;
  contactsError: string | null;
  panelContact: AdminCrmContact | null;
  panelLoading: boolean;
  contactSearchResults: AdminCrmContact[];
  contactSearchLoading: boolean;
  mutating: boolean;
};

const initialState: ContactsState = {
  contacts: [],
  contactsPagination: null,
  contactsListQuery: null,
  contactsLoading: false,
  contactsError: null,
  panelContact: null,
  panelLoading: false,
  contactSearchResults: [],
  contactSearchLoading: false,
  mutating: false,
};

export const fetchAdminContacts = createAsyncThunk<
  AdminCrmContactsListResponse,
  AdminCrmContactsListQuery | undefined,
  { rejectValue: string }
>("contacts/list", async (args, { rejectWithValue }) => {
  try {
    const params: Record<string, string | number | boolean> = {};
    if (args?.search) params.search = args.search;
    if (args?.language) params.language = args.language;
    if (args?.has_notes) params.has_notes = args.has_notes;
    if (args?.include_deleted) params.include_deleted = "1";
    if (args?.include_converted) params.include_converted = "1";
    if (args?.page) params.page = args.page;
    if (args?.limit) params.limit = args.limit;
    if (args?.sort_by) params.sort_by = args.sort_by;
    if (args?.sort_dir) params.sort_dir = args.sort_dir;
    const { data } = await api.get("/admin/contacts", { params });
    return data as AdminCrmContactsListResponse;
  } catch (err: unknown) {
    return rejectWithValue(formatAxiosError(err, "Failed to load contacts"));
  }
});

export const refetchAdminContacts = createAsyncThunk<
  AdminCrmContactsListResponse,
  void,
  { state: RootState; rejectValue: string }
>("contacts/refetch", async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    const q = getState().contacts.contactsListQuery;
    return await dispatch(
      fetchAdminContacts(q ?? { page: 1, limit: 50 }),
    ).unwrap();
  } catch (err: unknown) {
    return rejectWithValue(
      typeof err === "string" ? err : "Failed to reload contacts",
    );
  }
});

export const searchAdminContacts = createAsyncThunk<
  AdminCrmContact[],
  string,
  { rejectValue: string }
>("contacts/search", async (query, { rejectWithValue }) => {
  try {
    const { data } = await api.get("/admin/contacts", {
      params: { search: query, limit: 10 },
    });
    return (data as AdminCrmContactsListResponse).contacts;
  } catch (err: unknown) {
    return rejectWithValue(formatAxiosError(err, "Failed to search contacts"));
  }
});

export const fetchPanelContact = createAsyncThunk<
  AdminCrmContact,
  { id: number },
  { rejectValue: string }
>("contacts/panel", async ({ id }, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/admin/contacts/${id}`);
    return data.contact as AdminCrmContact;
  } catch (err: unknown) {
    return rejectWithValue(formatAxiosError(err, "Failed to load contact"));
  }
});

export const createAdminContact = createAsyncThunk<
  AdminCrmContact,
  AdminCrmContactWritePayload,
  { rejectValue: string | { error: string; code?: string; duplicates?: unknown } }
>("contacts/create", async (args, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/admin/contacts", args);
    return data.contact as AdminCrmContact;
  } catch (err: unknown) {
    const ax = err as {
      response?: { data?: { error?: string; duplicates?: unknown; message?: string }; status?: number };
    };
    if (ax.response?.status === 409 && ax.response.data?.error === "duplicate") {
      return rejectWithValue({
        error: "duplicate",
        code: "duplicate",
        duplicates: ax.response.data.duplicates,
      });
    }
    return rejectWithValue(formatAxiosError(err, "Failed to create contact"));
  }
});

export const updateAdminContact = createAsyncThunk<
  AdminCrmContact,
  { id: number } & Partial<AdminCrmContactWritePayload>,
  { rejectValue: string | { error: string; code?: string; duplicates?: unknown } }
>("contacts/update", async ({ id, ...rest }, { rejectWithValue }) => {
  try {
    const { data } = await api.put(`/admin/contacts/${id}`, rest);
    return data.contact as AdminCrmContact;
  } catch (err: unknown) {
    const ax = err as {
      response?: { data?: { error?: string; duplicates?: unknown }; status?: number };
    };
    if (ax.response?.status === 409 && ax.response.data?.error === "duplicate") {
      return rejectWithValue({
        error: "duplicate",
        code: "duplicate",
        duplicates: ax.response.data.duplicates,
      });
    }
    return rejectWithValue(formatAxiosError(err, "Failed to update contact"));
  }
});

export const deleteAdminContact = createAsyncThunk<
  { id: number },
  { id: number },
  { rejectValue: string }
>("contacts/delete", async ({ id }, { rejectWithValue }) => {
  try {
    await api.delete(`/admin/contacts/${id}`);
    return { id };
  } catch (err: unknown) {
    return rejectWithValue(formatAxiosError(err, "Failed to delete contact"));
  }
});

export const convertAdminContact = createAsyncThunk<
  ConvertCrmContactResponse,
  { id: number; confirm_duplicate?: boolean },
  { rejectValue: string | { error: string; duplicates?: unknown } }
>("contacts/convert", async ({ id, confirm_duplicate }, { rejectWithValue }) => {
  try {
    const { data } = await api.post(`/admin/contacts/${id}/convert`, {
      confirm_duplicate: confirm_duplicate === true,
    });
    return data as ConvertCrmContactResponse;
  } catch (err: unknown) {
    const ax = err as {
      response?: { data?: { error?: string; duplicates?: unknown }; status?: number };
    };
    if (
      ax.response?.status === 409 &&
      (ax.response.data?.error === "duplicate_phone" ||
        ax.response.data?.error === "duplicate")
    ) {
      return rejectWithValue({
        error: String(ax.response.data.error),
        duplicates: ax.response.data.duplicates,
      });
    }
    return rejectWithValue(
      formatAxiosError(err, "Failed to add contact to pipeline"),
    );
  }
});

const contactsSlice = createSlice({
  name: "contacts",
  initialState,
  reducers: {
    clearPanelContact(state) {
      state.panelContact = null;
    },
    clearContactSearch(state) {
      state.contactSearchResults = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAdminContacts.pending, (state, action) => {
        state.contactsLoading = true;
        state.contactsError = null;
        state.contactsListQuery = action.meta.arg ?? { page: 1, limit: 50 };
      })
      .addCase(fetchAdminContacts.fulfilled, (state, action) => {
        state.contactsLoading = false;
        state.contacts = action.payload.contacts;
        state.contactsPagination = action.payload.pagination;
      })
      .addCase(fetchAdminContacts.rejected, (state, action) => {
        state.contactsLoading = false;
        state.contactsError =
          typeof action.payload === "string"
            ? action.payload
            : "Failed to load contacts";
      })
      .addCase(searchAdminContacts.pending, (state) => {
        state.contactSearchLoading = true;
      })
      .addCase(searchAdminContacts.fulfilled, (state, action) => {
        state.contactSearchLoading = false;
        state.contactSearchResults = action.payload;
      })
      .addCase(searchAdminContacts.rejected, (state) => {
        state.contactSearchLoading = false;
        state.contactSearchResults = [];
      })
      .addCase(fetchPanelContact.pending, (state) => {
        state.panelLoading = true;
      })
      .addCase(fetchPanelContact.fulfilled, (state, action) => {
        state.panelLoading = false;
        state.panelContact = action.payload;
      })
      .addCase(fetchPanelContact.rejected, (state) => {
        state.panelLoading = false;
        state.panelContact = null;
      })
      .addCase(createAdminContact.pending, (state) => {
        state.mutating = true;
      })
      .addCase(createAdminContact.fulfilled, (state, action) => {
        state.mutating = false;
        state.contacts = [action.payload, ...state.contacts];
      })
      .addCase(createAdminContact.rejected, (state) => {
        state.mutating = false;
      })
      .addCase(updateAdminContact.pending, (state) => {
        state.mutating = true;
      })
      .addCase(updateAdminContact.fulfilled, (state, action) => {
        state.mutating = false;
        const updated = action.payload;
        state.contacts = state.contacts.map((c) =>
          c.id === updated.id ? updated : c,
        );
        if (state.panelContact?.id === updated.id) {
          state.panelContact = updated;
        }
      })
      .addCase(updateAdminContact.rejected, (state) => {
        state.mutating = false;
      })
      .addCase(deleteAdminContact.fulfilled, (state, action) => {
        state.contacts = state.contacts.filter((c) => c.id !== action.payload.id);
        if (state.panelContact?.id === action.payload.id) {
          state.panelContact = null;
        }
      })
      .addCase(convertAdminContact.pending, (state) => {
        state.mutating = true;
      })
      .addCase(convertAdminContact.fulfilled, (state, action) => {
        state.mutating = false;
        state.contacts = state.contacts.filter(
          (c) => c.id !== action.payload.contact_id,
        );
        if (state.panelContact?.id === action.payload.contact_id) {
          state.panelContact = null;
        }
      })
      .addCase(convertAdminContact.rejected, (state) => {
        state.mutating = false;
      });
  },
});

export const { clearPanelContact, clearContactSearch } = contactsSlice.actions;
export default contactsSlice.reducer;

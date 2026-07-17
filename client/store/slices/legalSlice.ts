import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import type { LegalDocument, LegalDocumentSummary } from "@shared/api";

interface LegalState {
  bySlug: Record<string, LegalDocument>;
  list: LegalDocumentSummary[];
  loadingSlug: string | null;
  listLoading: boolean;
  savingSlug: string | null;
  error: string | null;
}

const initialState: LegalState = {
  bySlug: {},
  list: [],
  loadingSlug: null,
  listLoading: false,
  savingSlug: null,
  error: null,
};

export const fetchLegalDocument = createAsyncThunk<
  LegalDocument,
  string,
  { rejectValue: string }
>("legal/fetchDocument", async (slug, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ document: LegalDocument }>(
      `/legal/${encodeURIComponent(slug)}`,
    );
    return data.document;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Failed to load document"));
  }
});

export const fetchLegalList = createAsyncThunk<
  LegalDocumentSummary[],
  void,
  { rejectValue: string }
>("legal/fetchList", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ documents: LegalDocumentSummary[] }>(
      "/legal",
    );
    return data.documents;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Failed to load documents"));
  }
});

export const fetchAdminLegalDocuments = createAsyncThunk<
  LegalDocument[],
  void,
  { rejectValue: string }
>("legal/fetchAdmin", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ documents: LegalDocument[] }>(
      "/admin/legal",
    );
    return data.documents;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Failed to load documents"));
  }
});

export const saveLegalDocument = createAsyncThunk<
  LegalDocument,
  { slug: string; title: string; content_md: string; source_url?: string | null },
  { rejectValue: string }
>("legal/save", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.put<{ document: LegalDocument }>(
      `/admin/legal/${encodeURIComponent(payload.slug)}`,
      {
        title: payload.title,
        content_md: payload.content_md,
        source_url: payload.source_url,
      },
    );
    return data.document;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Failed to save document"));
  }
});

const slice = createSlice({
  name: "legal",
  initialState,
  reducers: {
    clearLegalError(state) {
      state.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchLegalDocument.pending, (s, a) => {
      s.loadingSlug = a.meta.arg;
      s.error = null;
    });
    b.addCase(fetchLegalDocument.fulfilled, (s, a) => {
      s.loadingSlug = null;
      s.bySlug[a.payload.slug] = a.payload;
    });
    b.addCase(fetchLegalDocument.rejected, (s, a) => {
      s.loadingSlug = null;
      s.error = a.payload || "Failed";
    });

    b.addCase(fetchLegalList.pending, (s) => {
      s.listLoading = true;
    });
    b.addCase(fetchLegalList.fulfilled, (s, a) => {
      s.listLoading = false;
      s.list = a.payload;
    });
    b.addCase(fetchLegalList.rejected, (s) => {
      s.listLoading = false;
    });

    b.addCase(fetchAdminLegalDocuments.pending, (s) => {
      s.listLoading = true;
      s.error = null;
    });
    b.addCase(fetchAdminLegalDocuments.fulfilled, (s, a) => {
      s.listLoading = false;
      s.list = a.payload.map(({ slug, title, updated_at }) => ({
        slug,
        title,
        updated_at,
      }));
      for (const doc of a.payload) {
        s.bySlug[doc.slug] = doc;
      }
    });
    b.addCase(fetchAdminLegalDocuments.rejected, (s, a) => {
      s.listLoading = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(saveLegalDocument.pending, (s, a) => {
      s.savingSlug = a.meta.arg.slug;
      s.error = null;
    });
    b.addCase(saveLegalDocument.fulfilled, (s, a) => {
      s.savingSlug = null;
      s.bySlug[a.payload.slug] = a.payload;
      const idx = s.list.findIndex((d) => d.slug === a.payload.slug);
      const summary = {
        slug: a.payload.slug,
        title: a.payload.title,
        updated_at: a.payload.updated_at,
      };
      if (idx >= 0) s.list[idx] = summary;
      else s.list.push(summary);
    });
    b.addCase(saveLegalDocument.rejected, (s, a) => {
      s.savingSlug = null;
      s.error = a.payload || "Failed";
    });
  },
});

export const { clearLegalError } = slice.actions;
export default slice.reducer;

import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import type {
  BulkImportCommitOptions,
  BulkImportCommitResponse,
  BulkImportEntityType,
  BulkImportValidateResponse,
} from "@shared/api";
import type { BulkImportTableFilter } from "@shared/bulkImport";

export interface BulkImportPreviewState {
  jobId: number | null;
  entity: BulkImportEntityType | null;
  fileName: string | null;
  rowCount: number;
  willCreateCount: number;
  skippedCount: number;
  errorCount: number;
  previewRows: NonNullable<BulkImportValidateResponse["preview_rows"]>;
  breakdown: Record<string, number> | null;
  expiresAt: string | null;
}

interface BulkImportState {
  wizardOpen: boolean;
  wizardStep: 0 | 1 | 2 | 3 | 4;
  entity: BulkImportEntityType | null;
  preview: BulkImportPreviewState | null;
  commitResult: BulkImportCommitResponse | null;
  commitOptions: BulkImportCommitOptions;
  validating: boolean;
  committing: boolean;
  downloadingTemplate: boolean;
  error: string | null;
  tableFilter: BulkImportTableFilter;
  searchQuery: string;
}

const initialState: BulkImportState = {
  wizardOpen: false,
  wizardStep: 0,
  entity: null,
  preview: null,
  commitResult: null,
  commitOptions: { send_welcome_emails: false },
  validating: false,
  committing: false,
  downloadingTemplate: false,
  error: null,
  tableFilter: "all",
  searchQuery: "",
};

export const downloadBulkImportTemplate = createAsyncThunk(
  "bulkImport/downloadTemplate",
  async (_entity: BulkImportEntityType, { rejectWithValue }) => {
    try {
      const response = await api.get("/admin/bulk-import/templates/clients.csv", {
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "optimum_clients_import_template.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      return rejectWithValue(formatAxiosError(err, "Failed to download template"));
    }
  },
);

export const validateBulkImport = createAsyncThunk(
  "bulkImport/validate",
  async (
    { file, entity }: { file: File; entity: BulkImportEntityType },
    { rejectWithValue },
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("entity", entity);
    try {
      const { data } = await api.post<BulkImportValidateResponse>(
        "/admin/bulk-import/validate",
        form,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      if (!data.success) {
        return rejectWithValue(
          data.message || data.file_error || "Validation failed",
        );
      }
      return { data, fileName: file.name, entity };
    } catch (err: unknown) {
      return rejectWithValue(formatAxiosError(err, "Validation failed"));
    }
  },
);

export const commitBulkImport = createAsyncThunk(
  "bulkImport/commit",
  async (
    {
      jobId,
      options,
    }: { jobId: number; options: BulkImportCommitOptions },
    { rejectWithValue },
  ) => {
    try {
      const { data } = await api.post<BulkImportCommitResponse>(
        `/admin/bulk-import/${jobId}/commit`,
        options,
      );
      if (!data.success) {
        return rejectWithValue(data.message || "Import failed");
      }
      return data;
    } catch (err: unknown) {
      return rejectWithValue(formatAxiosError(err, "Import failed"));
    }
  },
);

const bulkImportSlice = createSlice({
  name: "bulkImport",
  initialState,
  reducers: {
    openBulkImportWizard(
      state,
      action: PayloadAction<BulkImportEntityType>,
    ) {
      state.wizardOpen = true;
      state.entity = action.payload;
      state.wizardStep = 0;
      state.preview = null;
      state.commitResult = null;
      state.error = null;
      state.tableFilter = "all";
      state.searchQuery = "";
      state.commitOptions = { send_welcome_emails: false };
    },
    closeBulkImportWizard(state) {
      state.wizardOpen = false;
    },
    resetBulkImportWizard(state) {
      state.wizardStep = 0;
      state.preview = null;
      state.commitResult = null;
      state.error = null;
      state.tableFilter = "all";
      state.searchQuery = "";
    },
    setBulkImportStep(state, action: PayloadAction<0 | 1 | 2 | 3 | 4>) {
      state.wizardStep = action.payload;
    },
    setBulkImportTableFilter(
      state,
      action: PayloadAction<BulkImportTableFilter>,
    ) {
      state.tableFilter = action.payload;
    },
    setBulkImportSearchQuery(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload;
    },
    setBulkImportCommitOptions(
      state,
      action: PayloadAction<Partial<BulkImportCommitOptions>>,
    ) {
      state.commitOptions = { ...state.commitOptions, ...action.payload };
    },
  },
  extraReducers: (b) => {
    b.addCase(downloadBulkImportTemplate.pending, (s) => {
      s.downloadingTemplate = true;
      s.error = null;
    });
    b.addCase(downloadBulkImportTemplate.fulfilled, (s) => {
      s.downloadingTemplate = false;
    });
    b.addCase(downloadBulkImportTemplate.rejected, (s, a) => {
      s.downloadingTemplate = false;
      s.error = (a.payload as string) || "Failed to download template";
    });

    b.addCase(validateBulkImport.pending, (s) => {
      s.validating = true;
      s.error = null;
      s.commitResult = null;
    });
    b.addCase(validateBulkImport.fulfilled, (s, a) => {
      s.validating = false;
      const d = a.payload.data;
      s.preview = {
        jobId: d.job_id ?? null,
        entity: a.payload.entity,
        fileName: a.payload.fileName,
        rowCount: d.row_count ?? 0,
        willCreateCount: d.will_create_count ?? 0,
        skippedCount: d.skipped_count ?? 0,
        errorCount: d.error_count ?? 0,
        previewRows: d.preview_rows ?? [],
        breakdown: d.breakdown ?? null,
        expiresAt: d.expires_at ?? null,
      };
      s.wizardStep = 2;
    });
    b.addCase(validateBulkImport.rejected, (s, a) => {
      s.validating = false;
      s.error = (a.payload as string) || "Validation failed";
    });

    b.addCase(commitBulkImport.pending, (s) => {
      s.committing = true;
      s.error = null;
    });
    b.addCase(commitBulkImport.fulfilled, (s, a) => {
      s.committing = false;
      s.commitResult = a.payload;
      s.wizardStep = 4;
    });
    b.addCase(commitBulkImport.rejected, (s, a) => {
      s.committing = false;
      s.error = (a.payload as string) || "Import failed";
    });
  },
});

export const {
  openBulkImportWizard,
  closeBulkImportWizard,
  resetBulkImportWizard,
  setBulkImportStep,
  setBulkImportTableFilter,
  setBulkImportSearchQuery,
  setBulkImportCommitOptions,
} = bulkImportSlice.actions;

export default bulkImportSlice.reducer;

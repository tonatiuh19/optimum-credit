import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import type {
  AdminClientListItem,
  ConvertProspectPayload,
  Label,
  Prospect,
  SetClientLabelsPayload,
} from "@shared/api";
import { fetchMorePipelineColumn, fetchPipeline } from "./adminSlice";

interface ProspectsState {
  prospects: Prospect[];
  labels: Label[];
  loading: boolean;
  labelsLoading: boolean;
  converting: boolean;
  savingLabels: boolean;
}

const initialState: ProspectsState = {
  prospects: [],
  labels: [],
  loading: false,
  labelsLoading: false,
  converting: false,
  savingLabels: false,
};

export const fetchProspects = createAsyncThunk<Prospect[], void>(
  "prospects/fetchAll",
  async () => {
    const { data } = await api.get("/admin/prospects");
    return data.prospects as Prospect[];
  },
);

export const convertProspect = createAsyncThunk<
  AdminClientListItem,
  ConvertProspectPayload,
  { rejectValue: string }
>("prospects/convert", async ({ id, ...rest }, { rejectWithValue }) => {
  try {
    const { data } = await api.post(`/admin/prospects/${id}/convert`, rest);
    return data.client as AdminClientListItem;
  } catch (err: unknown) {
    return rejectWithValue(
      formatAxiosError(err, "Failed to convert prospect"),
    );
  }
});

export const fetchLabels = createAsyncThunk<Label[], void>(
  "prospects/fetchLabels",
  async () => {
    const { data } = await api.get("/admin/labels");
    return data.labels as Label[];
  },
);

export const setClientLabels = createAsyncThunk<
  { clientId: number; labels: Label[] },
  SetClientLabelsPayload,
  { rejectValue: string }
>("prospects/setClientLabels", async ({ clientId, add, remove }, { rejectWithValue }) => {
  try {
    const { data } = await api.post(`/admin/clients/${clientId}/labels`, {
      add,
      remove,
    });
    return { clientId, labels: data.labels as Label[] };
  } catch (err: unknown) {
    return rejectWithValue(formatAxiosError(err, "Failed to update labels"));
  }
});

const slice = createSlice({
  name: "prospects",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchProspects.pending, (s) => {
      s.loading = true;
    });
    b.addCase(fetchProspects.rejected, (s) => {
      s.loading = false;
    });
    b.addCase(fetchProspects.fulfilled, (s, a) => {
      s.loading = false;
      s.prospects = a.payload;
    });

    // The combined pipeline endpoint returns { cases, prospects } — keep
    // the prospect list in sync whenever the Pipeline board is refreshed,
    // without a second network round-trip.
    b.addCase(fetchPipeline.fulfilled, (s, a) => {
      s.prospects = a.payload.prospects ?? [];
    });
    b.addCase(fetchMorePipelineColumn.fulfilled, (s, a) => {
      if (a.payload.column !== "prospect") return;
      const seen = new Set(s.prospects.map((p) => p.id));
      s.prospects = [
        ...s.prospects,
        ...(a.payload.items as Prospect[]).filter((p) => !seen.has(p.id)),
      ];
    });

    b.addCase(convertProspect.pending, (s) => {
      s.converting = true;
    });
    b.addCase(convertProspect.rejected, (s) => {
      s.converting = false;
    });
    b.addCase(convertProspect.fulfilled, (s, a) => {
      s.converting = false;
      s.prospects = s.prospects.filter((p) => p.id !== a.meta.arg.id);
    });

    b.addCase(fetchLabels.pending, (s) => {
      s.labelsLoading = true;
    });
    b.addCase(fetchLabels.rejected, (s) => {
      s.labelsLoading = false;
    });
    b.addCase(fetchLabels.fulfilled, (s, a) => {
      s.labelsLoading = false;
      s.labels = a.payload;
    });

    b.addCase(setClientLabels.pending, (s) => {
      s.savingLabels = true;
    });
    b.addCase(setClientLabels.rejected, (s) => {
      s.savingLabels = false;
    });
    b.addCase(setClientLabels.fulfilled, (s, a) => {
      s.savingLabels = false;
      const idx = s.prospects.findIndex((p) => p.id === a.payload.clientId);
      if (idx !== -1) s.prospects[idx].labels = a.payload.labels;
    });
  },
});

export default slice.reducer;

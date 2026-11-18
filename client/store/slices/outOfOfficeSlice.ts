import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import type { OutOfOfficeInput, OutOfOfficeResponse } from "@shared/api";

/** Out of office (Nov 17, 2026): auto-replies and Slack #client-care route to the backups. */
export const fetchOutOfOffice = createAsyncThunk("outOfOffice/fetch", async (_: void, { rejectWithValue }) => {
  try {
    const { data } = await api.get<OutOfOfficeResponse>("/admin/out-of-office");
    return data;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load out of office"));
  }
});

export const saveOutOfOffice = createAsyncThunk("outOfOffice/save", async (input: OutOfOfficeInput, { dispatch, rejectWithValue }) => {
  try {
    await api.post("/admin/out-of-office", input);
    await dispatch(fetchOutOfOffice());
    return true;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not save"));
  }
});

export const cancelOutOfOffice = createAsyncThunk("outOfOffice/cancel", async (id: number, { dispatch, rejectWithValue }) => {
  try {
    await api.delete(`/admin/out-of-office/${id}`);
    await dispatch(fetchOutOfOffice());
    return id;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not cancel"));
  }
});

type State = { data: OutOfOfficeResponse | null; loading: boolean; saving: boolean; error: string | null };
const initialState: State = { data: null, loading: false, saving: false, error: null };

const outOfOfficeSlice = createSlice({
  name: "outOfOffice",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchOutOfOffice.pending, (s) => {
      s.loading = true;
    });
    b.addCase(fetchOutOfOffice.fulfilled, (s, a) => {
      s.loading = false;
      s.data = a.payload;
      s.error = null;
    });
    b.addCase(fetchOutOfOffice.rejected, (s, a) => {
      s.loading = false;
      s.error = String(a.payload ?? "Could not load");
    });
    b.addCase(saveOutOfOffice.pending, (s) => {
      s.saving = true;
    });
    b.addCase(saveOutOfOffice.fulfilled, (s) => {
      s.saving = false;
    });
    b.addCase(saveOutOfOffice.rejected, (s) => {
      s.saving = false;
    });
  },
});

export default outOfOfficeSlice.reducer;

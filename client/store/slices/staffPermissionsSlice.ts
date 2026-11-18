import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import type { StaffPermissions, StaffPermissionsResponse } from "@shared/api";

/** Who can approve holiday greetings / manage out of office (super admin, Settings). */
export const fetchStaffPermissions = createAsyncThunk("staffPermissions/fetch", async (_: void, { rejectWithValue }) => {
  try {
    const { data } = await api.get<StaffPermissionsResponse>("/admin/settings/staff-permissions");
    return data;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load permissions"));
  }
});

export const saveStaffPermissions = createAsyncThunk(
  "staffPermissions/save",
  async (body: Partial<StaffPermissions>, { rejectWithValue }) => {
    try {
      const { data } = await api.put<{ permissions: StaffPermissions }>("/admin/settings/staff-permissions", body);
      return data.permissions;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Could not save"));
    }
  },
);

type State = { data: StaffPermissionsResponse | null; loading: boolean; saving: boolean; error: string | null };
const initialState: State = { data: null, loading: false, saving: false, error: null };

const staffPermissionsSlice = createSlice({
  name: "staffPermissions",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchStaffPermissions.pending, (s) => {
      s.loading = true;
    });
    b.addCase(fetchStaffPermissions.fulfilled, (s, a) => {
      s.loading = false;
      s.data = a.payload;
      s.error = null;
    });
    b.addCase(fetchStaffPermissions.rejected, (s, a) => {
      s.loading = false;
      s.error = String(a.payload ?? "Could not load");
    });
    b.addCase(saveStaffPermissions.pending, (s) => {
      s.saving = true;
      s.error = null;
    });
    b.addCase(saveStaffPermissions.fulfilled, (s, a) => {
      s.saving = false;
      if (s.data) s.data.permissions = a.payload;
    });
    b.addCase(saveStaffPermissions.rejected, (s, a) => {
      s.saving = false;
      s.error = String(a.payload ?? "Could not save");
    });
  },
});

export default staffPermissionsSlice.reducer;

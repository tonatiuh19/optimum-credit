import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";
import type { HolidayGreeting, HolidayGreetingAudienceResponse, HolidayGreetingsListResponse } from "@shared/api";

/** Holiday greetings (Nov 17, 2026): one approved SMS per holiday per year. */
export const fetchHolidayGreetings = createAsyncThunk("holidayGreetings/list", async (_: void, { rejectWithValue }) => {
  try {
    const { data } = await api.get<HolidayGreetingsListResponse>("/admin/holiday-greetings");
    return data;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load holiday greetings"));
  }
});

export const fetchHolidayAudience = createAsyncThunk("holidayGreetings/audience", async (id: number, { rejectWithValue }) => {
  try {
    const { data } = await api.get<HolidayGreetingAudienceResponse>(`/admin/holiday-greetings/${id}/audience`);
    return { id, data };
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load the audience"));
  }
});

export const saveHolidayGreeting = createAsyncThunk(
  "holidayGreetings/save",
  async (args: { id: number; body_en?: string; body_es?: string; media_url?: string | null; media_content_type?: string | null; send_time?: string }, { rejectWithValue }) => {
    try {
      const { id, ...body } = args;
      const { data } = await api.put<{ greeting: HolidayGreeting }>(`/admin/holiday-greetings/${id}`, body);
      return data.greeting;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Could not save"));
    }
  },
);

export const holidayGreetingAction = createAsyncThunk(
  "holidayGreetings/action",
  async (args: { id: number; action: "approve" | "unapprove" | "skip" | "restore" }, { rejectWithValue }) => {
    try {
      const { data } = await api.post<{ greeting: HolidayGreeting }>(`/admin/holiday-greetings/${args.id}/${args.action}`);
      return data.greeting;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Could not update"));
    }
  },
);

export const sendHolidayGreetingTest = createAsyncThunk(
  "holidayGreetings/test",
  async (args: { id: number; lang: "en" | "es" }, { rejectWithValue }) => {
    try {
      await api.post(`/admin/holiday-greetings/${args.id}/test`, { lang: args.lang });
      return true;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Could not send the test"));
    }
  },
);

type State = {
  items: HolidayGreeting[];
  canApprove: boolean;
  stopFooter: { en: string; es: string };
  loading: boolean;
  error: string | null;
  audience: Record<number, HolidayGreetingAudienceResponse | undefined>;
  audienceLoading: Record<number, boolean>;
  busy: Record<number, boolean>;
};

const initialState: State = {
  items: [],
  canApprove: false,
  stopFooter: { en: "Reply STOP to opt out.", es: "Responde STOP para no recibir mensajes." },
  loading: false,
  error: null,
  audience: {},
  audienceLoading: {},
  busy: {},
};

const replace = (s: State, g: HolidayGreeting) => {
  s.items = s.items.map((x) => (x.id === g.id ? g : x));
  delete s.audience[g.id];
};

const holidayGreetingsSlice = createSlice({
  name: "holidayGreetings",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchHolidayGreetings.pending, (s) => {
      s.loading = true;
      s.error = null;
    });
    b.addCase(fetchHolidayGreetings.fulfilled, (s, a) => {
      s.loading = false;
      s.items = a.payload.greetings;
      s.canApprove = a.payload.can_approve;
      s.stopFooter = a.payload.stop_footer;
    });
    b.addCase(fetchHolidayGreetings.rejected, (s, a) => {
      s.loading = false;
      s.error = String(a.payload ?? "Could not load holiday greetings");
    });
    b.addCase(fetchHolidayAudience.pending, (s, a) => {
      s.audienceLoading[a.meta.arg] = true;
    });
    b.addCase(fetchHolidayAudience.fulfilled, (s, a) => {
      s.audienceLoading[a.payload.id] = false;
      s.audience[a.payload.id] = a.payload.data;
    });
    b.addCase(fetchHolidayAudience.rejected, (s, a) => {
      s.audienceLoading[a.meta.arg] = false;
    });
    for (const thunk of [saveHolidayGreeting, holidayGreetingAction] as const) {
      b.addCase(thunk.pending, (s, a) => {
        s.busy[a.meta.arg.id] = true;
      });
      b.addCase(thunk.fulfilled, (s, a) => {
        s.busy[a.payload.id] = false;
        replace(s, a.payload);
      });
      b.addCase(thunk.rejected, (s, a) => {
        s.busy[a.meta.arg.id] = false;
      });
    }
  },
});

export default holidayGreetingsSlice.reducer;

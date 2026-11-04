import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api, { formatAxiosError } from "@/lib/api";

export type BillingLine = {
  action: string;
  unit: string;
  quantity: number;
  unit_price_usd: number;
  amount_usd: number;
  billed_days?: number;
  days_in_month?: number;
};

export type BillingInvoice = {
  id: number;
  period_month?: string;
  status: string;
  total_usd: number;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
  error_message: string | null;
  paid_at?: string | null;
  created_at: string;
};

export type BillingSummary = {
  month: string;
  billing_start_at: string | null;
  stripe_configured: boolean;
  customer_email: string | null;
  lines: BillingLine[];
  total_usd: number;
  plan: Array<{ action: string; service: string; unit: string; unit_price_usd: number }>;
  projection: { lines: BillingLine[]; total_usd: number } | null;
  is_owner: boolean;
  invoice: BillingInvoice | null;
  usage: {
    ai: Array<{ action: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number }>;
    ai_total_cost_usd: number;
    mcp_by_tool: Array<{ tool: string; calls: number }>;
    by_admin: Array<{ admin_id: number; name: string; mcp_calls: number; ai_calls: number; ai_cost_usd: number }>;
    daily: Array<{ date: string; mcp_calls: number; ai_calls: number; ai_cost_usd: number }>;
  };
};

export type BillingPrice = {
  action: string;
  service: string;
  unit: string;
  unit_price_usd: number;
  markup: number;
  billable: boolean;
  calls_30d: number;
  avg_cost_usd: number | null;
  suggested_price_usd: number | null;
};

export type BillingPaymentMethod = {
  id: string;
  type: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  bank_name: string | null;
};

export type BillingPlatform = {
  month: string;
  live_since: string | null;
  system: { api_routes: number; db_tables: number; scheduled_jobs: number; roles: number; languages: number; max_request_seconds: number };
  accounts: { clients: number; active_clients: number; pipeline: number; staff: number; affiliates: number };
  activity: Record<string, number>;
};

interface BillingState {
  /** null = not checked yet */
  canView: boolean | null;
  /** Platform owner: edits prices, sees provider cost. */
  isOwner: boolean;
  summary: BillingSummary | null;
  prices: BillingPrice[];
  invoices: BillingInvoice[];
  platform: BillingPlatform | null;
  loading: boolean;
  savingAction: string | null;
  portalBusy: boolean;
  retryingMonth: string | null;
  error: string | null;
  stripeConfigured: boolean;
  publishableKey: string | null;
  paymentMethod: BillingPaymentMethod | null;
  paymentMethodLoaded: boolean;
  setupClientSecret: string | null;
  setupBusy: boolean;
}

const initialState: BillingState = {
  canView: null,
  isOwner: false,
  summary: null,
  prices: [],
  invoices: [],
  platform: null,
  loading: false,
  savingAction: null,
  portalBusy: false,
  retryingMonth: null,
  error: null,
  stripeConfigured: false,
  publishableKey: null,
  paymentMethod: null,
  paymentMethodLoaded: false,
  setupClientSecret: null,
  setupBusy: false,
};

export const fetchBillingAccess = createAsyncThunk("billing/access", async () => {
  try {
    const { data } = await api.get<{ can_view_billing: boolean; is_owner?: boolean }>("/admin/billing/access");
    return { canView: !!data.can_view_billing, isOwner: !!data.is_owner };
  } catch {
    return { canView: false, isOwner: false };
  }
});

export const fetchBillingSummary = createAsyncThunk(
  "billing/summary",
  async (month: string | undefined, { rejectWithValue }) => {
    try {
      const { data } = await api.get<BillingSummary>("/admin/billing/summary", { params: month ? { month } : {} });
      return data;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Failed to load billing"));
    }
  },
);

export const fetchBillingPlatform = createAsyncThunk(
  "billing/platform",
  async (month: string | undefined, { rejectWithValue }) => {
    try {
      const { data } = await api.get<BillingPlatform>("/admin/billing/platform", { params: month ? { month } : {} });
      return data;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Failed to load platform details"));
    }
  },
);

export const fetchBillingPrices = createAsyncThunk("billing/prices", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ prices: BillingPrice[] }>("/admin/billing/prices");
    return data.prices;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Failed to load prices"));
  }
});

export const fetchBillingInvoices = createAsyncThunk("billing/invoices", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ invoices: BillingInvoice[] }>("/admin/billing/invoices");
    return data.invoices;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Failed to load invoices"));
  }
});

export const saveBillingPrice = createAsyncThunk(
  "billing/savePrice",
  async (p: { action: string; unit_price_usd?: number; markup?: number; billable?: boolean }, { rejectWithValue, dispatch }) => {
    try {
      const { action, ...body } = p;
      await api.put(`/admin/billing/prices/${encodeURIComponent(action)}`, body);
      dispatch(fetchBillingPrices());
      return action;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Failed to save price"));
    }
  },
);

export const saveBillingCustomerEmail = createAsyncThunk(
  "billing/saveEmail",
  async (customer_email: string, { rejectWithValue }) => {
    try {
      await api.put("/admin/billing/settings", { customer_email });
      return customer_email;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Failed to save email"));
    }
  },
);

export const openBillingPortal = createAsyncThunk("billing/portal", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.post<{ url: string }>("/admin/billing/portal");
    return data.url;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not open the billing portal"));
  }
});

export const retryBillingInvoice = createAsyncThunk(
  "billing/retryInvoice",
  async (month: string, { rejectWithValue, dispatch }) => {
    try {
      await api.post(`/admin/billing/invoices/${month}/retry`);
      dispatch(fetchBillingInvoices());
      return month;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Could not issue the invoice"));
    }
  },
);

export const fetchBillingPaymentMethod = createAsyncThunk("billing/paymentMethod", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get<{ configured: boolean; publishable_key: string | null; payment_method: BillingPaymentMethod | null }>(
      "/admin/billing/payment-method",
    );
    return data;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not load the payment method"));
  }
});

/** Starts a SetupIntent; the client secret feeds the Stripe Payment Element. */
export const createBillingSetupIntent = createAsyncThunk("billing/setupIntent", async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.post<{ client_secret: string }>("/admin/billing/setup-intent");
    return data.client_secret;
  } catch (e) {
    return rejectWithValue(formatAxiosError(e, "Could not start the payment form"));
  }
});

export const saveBillingPaymentMethod = createAsyncThunk(
  "billing/savePaymentMethod",
  async (payment_method_id: string, { rejectWithValue }) => {
    try {
      const { data } = await api.post<{ payment_method: BillingPaymentMethod }>("/admin/billing/payment-method", { payment_method_id });
      return data.payment_method;
    } catch (e) {
      return rejectWithValue(formatAxiosError(e, "Could not save the payment method"));
    }
  },
);

const billingSlice = createSlice({
  name: "billing",
  initialState,
  reducers: {
    clearBillingSetup(s) {
      s.setupClientSecret = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchBillingAccess.fulfilled, (s, a) => {
      s.canView = a.payload.canView;
      s.isOwner = a.payload.isOwner;
    });
    b.addCase(fetchBillingSummary.pending, (s) => {
      s.loading = true;
      s.error = null;
    });
    b.addCase(fetchBillingSummary.fulfilled, (s, a) => {
      s.loading = false;
      s.summary = a.payload;
    });
    b.addCase(fetchBillingSummary.rejected, (s, a) => {
      s.loading = false;
      s.error = String(a.payload || "Failed to load billing");
    });
    b.addCase(fetchBillingPlatform.fulfilled, (s, a) => {
      s.platform = a.payload;
    });
    b.addCase(fetchBillingPrices.fulfilled, (s, a) => {
      s.prices = a.payload;
    });
    b.addCase(fetchBillingInvoices.fulfilled, (s, a) => {
      s.invoices = a.payload;
    });
    b.addCase(saveBillingPrice.pending, (s, a) => {
      s.savingAction = a.meta.arg.action;
    });
    b.addCase(saveBillingPrice.fulfilled, (s) => {
      s.savingAction = null;
    });
    b.addCase(saveBillingPrice.rejected, (s) => {
      s.savingAction = null;
    });
    b.addCase(saveBillingCustomerEmail.fulfilled, (s, a) => {
      if (s.summary) s.summary.customer_email = a.payload;
    });
    b.addCase(openBillingPortal.pending, (s) => {
      s.portalBusy = true;
    });
    b.addCase(openBillingPortal.fulfilled, (s) => {
      s.portalBusy = false;
    });
    b.addCase(openBillingPortal.rejected, (s) => {
      s.portalBusy = false;
    });
    b.addCase(retryBillingInvoice.pending, (s, a) => {
      s.retryingMonth = a.meta.arg;
    });
    b.addCase(retryBillingInvoice.fulfilled, (s) => {
      s.retryingMonth = null;
    });
    b.addCase(retryBillingInvoice.rejected, (s) => {
      s.retryingMonth = null;
    });
    b.addCase(fetchBillingPaymentMethod.fulfilled, (s, a) => {
      s.stripeConfigured = a.payload.configured;
      s.publishableKey = a.payload.publishable_key;
      s.paymentMethod = a.payload.payment_method;
      s.paymentMethodLoaded = true;
    });
    b.addCase(fetchBillingPaymentMethod.rejected, (s) => {
      s.paymentMethodLoaded = true;
    });
    b.addCase(createBillingSetupIntent.pending, (s) => {
      s.setupBusy = true;
    });
    b.addCase(createBillingSetupIntent.fulfilled, (s, a) => {
      s.setupBusy = false;
      s.setupClientSecret = a.payload;
    });
    b.addCase(createBillingSetupIntent.rejected, (s) => {
      s.setupBusy = false;
    });
    b.addCase(saveBillingPaymentMethod.pending, (s) => {
      s.setupBusy = true;
    });
    b.addCase(saveBillingPaymentMethod.fulfilled, (s, a) => {
      s.setupBusy = false;
      s.paymentMethod = a.payload;
      s.setupClientSecret = null;
    });
    b.addCase(saveBillingPaymentMethod.rejected, (s) => {
      s.setupBusy = false;
    });
  },
});

export const { clearBillingSetup } = billingSlice.actions;
export default billingSlice.reducer;

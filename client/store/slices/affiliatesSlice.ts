import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";
import api, { formatAxiosError } from "@/lib/api";
import type {
  AffiliateCommission,
  AffiliateDetailResponse,
  AffiliateInviteJoinPayload,
  AffiliateInviteJoinResponse,
  AffiliateInviteLink,
  AffiliateInvitePublicResolve,
  AffiliateLeadPayload,
  AffiliateMeResponse,
  AffiliateProfile,
  AffiliatePublicResolve,
  AffiliateSelfUpdatePayload,
  AffiliateSuggestionsResponse,
  CreateAffiliateInviteLinkPayload,
  CreateAffiliatePayload,
  UpdateAffiliateInviteLinkPayload,
  UpdateAffiliatePayload,
} from "@shared/api";

/**
 * Public endpoints (no auth) — bypass `@/lib/api`'s Bearer-token interceptors
 * so an already-logged-in admin/client session never attaches a token to
 * these anonymous referral-link requests.
 */
const publicApi = axios.create({ baseURL: "/api" });

interface AffiliatesState {
  list: AffiliateProfile[];
  listLoading: boolean;
  selected: AffiliateDetailResponse | null;
  selectedLoading: boolean;
  suggestions: AffiliateSuggestionsResponse | null;
  suggestionsLoading: boolean;
  commissions: AffiliateCommission[];
  commissionsLoading: boolean;
  myProfile: AffiliateMeResponse | null;
  myProfileLoading: boolean;
  mySubscribing: boolean;
  myCommissions: AffiliateCommission[];
  myCommissionsLoading: boolean;
  leadSubmitting: boolean;
  inviteSubmitting: boolean;
  inviteLinks: AffiliateInviteLink[];
  inviteLinksLoading: boolean;
  inviteLinkSaving: boolean;
  inviteParentMasters: AffiliateProfile[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  publicResolve: AffiliatePublicResolve | null;
  publicResolving: boolean;
  publicError: string | null;
  publicInvite: AffiliateInvitePublicResolve | null;
  publicInviteLoading: boolean;
  publicInviteError: string | null;
  publicJoinSubmitting: boolean;
}

const initialState: AffiliatesState = {
  list: [],
  listLoading: false,
  selected: null,
  selectedLoading: false,
  suggestions: null,
  suggestionsLoading: false,
  commissions: [],
  commissionsLoading: false,
  myProfile: null,
  myProfileLoading: false,
  mySubscribing: false,
  myCommissions: [],
  myCommissionsLoading: false,
  leadSubmitting: false,
  inviteSubmitting: false,
  inviteLinks: [],
  inviteLinksLoading: false,
  inviteLinkSaving: false,
  inviteParentMasters: [],
  loading: false,
  saving: false,
  error: null,
  publicResolve: null,
  publicResolving: false,
  publicError: null,
  publicInvite: null,
  publicInviteLoading: false,
  publicInviteError: null,
  publicJoinSubmitting: false,
};

// ── Public: /r/:slug resolve + click logging ─────────────────────────────

export const resolvePublicAffiliate = createAsyncThunk<
  AffiliatePublicResolve,
  { slug: string; to?: string | null },
  { rejectValue: string }
>("affiliates/resolvePublic", async ({ slug, to }, { rejectWithValue }) => {
  try {
    const { data } = await publicApi.get<AffiliatePublicResolve>(
      `/public/affiliates/${encodeURIComponent(slug)}`,
      { params: to ? { to } : undefined },
    );
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "This referral link is invalid or expired."));
  }
});

export const logAffiliateClick = createAsyncThunk<
  { ok: boolean; slug: string },
  { slug: string; landing?: "credit_analysis" | "pricing" | "other" }
>("affiliates/logClick", async ({ slug, landing }) => {
  const { data } = await publicApi.post(
    `/public/affiliates/${encodeURIComponent(slug)}/click`,
    { landing: landing || "other" },
  );
  return data;
});

export const resolveAffiliateInvite = createAsyncThunk<
  AffiliateInvitePublicResolve,
  { token: string },
  { rejectValue: string }
>("affiliates/resolveInvite", async ({ token }, { rejectWithValue }) => {
  try {
    const { data } = await publicApi.get<AffiliateInvitePublicResolve>(
      `/public/affiliate-invite/${encodeURIComponent(token)}`,
    );
    return data;
  } catch (e: unknown) {
    return rejectWithValue(
      formatAxiosError(e, "This invite link is invalid or expired."),
    );
  }
});

export const joinAffiliateInvite = createAsyncThunk<
  AffiliateInviteJoinResponse,
  { token: string } & AffiliateInviteJoinPayload,
  { rejectValue: string }
>("affiliates/joinInvite", async ({ token, ...payload }, { rejectWithValue }) => {
  try {
    const { data } = await publicApi.post<AffiliateInviteJoinResponse>(
      `/public/affiliate-invite/${encodeURIComponent(token)}/join`,
      payload,
    );
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not complete signup"));
  }
});

export const fetchAffiliateInviteLinks = createAsyncThunk<
  { links: AffiliateInviteLink[] },
  void,
  { rejectValue: string }
>("affiliates/fetchInviteLinks", async (_arg, { rejectWithValue }) => {
  try {
    const { data } = await api.get("/admin/affiliate-invite-links");
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not load invite links"));
  }
});

export const createAffiliateInviteLink = createAsyncThunk<
  { link: AffiliateInviteLink },
  CreateAffiliateInviteLinkPayload,
  { rejectValue: string }
>("affiliates/createInviteLink", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/admin/affiliate-invite-links", payload);
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not create invite link"));
  }
});

export const fetchInviteParentMasters = createAsyncThunk<
  { affiliates: AffiliateProfile[] },
  void,
  { rejectValue: string }
>("affiliates/fetchInviteParentMasters", async (_arg, { rejectWithValue }) => {
  try {
    const { data } = await api.get("/admin/affiliates", {
      params: { plan: "master", status: "active" },
    });
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not load masters"));
  }
});

export const updateAffiliateInviteLink = createAsyncThunk<
  { link: AffiliateInviteLink },
  { id: number } & UpdateAffiliateInviteLinkPayload,
  { rejectValue: string }
>("affiliates/updateInviteLink", async ({ id, ...rest }, { rejectWithValue }) => {
  try {
    const { data } = await api.patch(`/admin/affiliate-invite-links/${id}`, rest);
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not update invite link"));
  }
});

export const deleteAffiliateInviteLink = createAsyncThunk<
  { id: number },
  number,
  { rejectValue: string }
>("affiliates/deleteInviteLink", async (id, { rejectWithValue }) => {
  try {
    await api.delete(`/admin/affiliate-invite-links/${id}`);
    return { id };
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not delete invite link"));
  }
});

// ── Admin: manage affiliates ─────────────────────────────────────────────

export const fetchAffiliates = createAsyncThunk<
  { affiliates: AffiliateProfile[] },
  { search?: string; plan?: string; status?: string } | void
>("affiliates/fetch", async (params) => {
  const { data } = await api.get("/admin/affiliates", { params: params || {} });
  return data;
});

export const fetchSuggestions = createAsyncThunk<AffiliateSuggestionsResponse>(
  "affiliates/fetchSuggestions",
  async () => {
    const { data } = await api.get("/admin/affiliates/meta/suggestions");
    return data;
  },
);

export const createAffiliate = createAsyncThunk<
  { id: number; admin_id: number; slug: string; referral_code: string },
  CreateAffiliatePayload,
  { rejectValue: string }
>("affiliates/create", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/admin/affiliates", payload);
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not create affiliate"));
  }
});

export const updateAffiliate = createAsyncThunk<
  { affiliate: AffiliateProfile },
  UpdateAffiliatePayload,
  { rejectValue: string }
>("affiliates/update", async ({ id, ...rest }, { rejectWithValue }) => {
  try {
    const { data } = await api.patch(`/admin/affiliates/${id}`, rest);
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not update affiliate"));
  }
});

export const fetchAffiliateDetail = createAsyncThunk<
  AffiliateDetailResponse,
  { id: number },
  { rejectValue: string }
>("affiliates/fetchDetail", async ({ id }, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/admin/affiliates/${id}`);
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not load affiliate"));
  }
});

export const compAffiliate = createAsyncThunk<
  { ok: boolean },
  { id: number },
  { rejectValue: string }
>("affiliates/comp", async ({ id }, { rejectWithValue }) => {
  try {
    const { data } = await api.post(`/admin/affiliates/${id}/comp`);
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not activate affiliate"));
  }
});

export const fetchAffiliateCommissions = createAsyncThunk<
  { commissions: AffiliateCommission[] },
  { id: number },
  { rejectValue: string }
>("affiliates/fetchCommissions", async ({ id }, { rejectWithValue }) => {
  try {
    const { data } = await api.get(`/admin/affiliates/${id}/commissions`);
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not load commissions"));
  }
});

export const updateCommissionStatus = createAsyncThunk<
  { ok: boolean; id: number; status: string },
  { id: number; status: "approved" | "paid" | "void" },
  { rejectValue: string }
>("affiliates/updateCommissionStatus", async ({ id, status }, { rejectWithValue }) => {
  try {
    await api.patch(`/admin/affiliates/commissions/${id}`, { status });
    return { ok: true, id, status };
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not update commission"));
  }
});

// ── Affiliate self-service (role=affiliate, or manager preview) ─────────

export const fetchMyAffiliateProfile = createAsyncThunk<
  AffiliateMeResponse,
  void,
  { rejectValue: string }
>("affiliates/fetchMe", async (_arg, { rejectWithValue }) => {
  try {
    const { data } = await api.get("/admin/affiliate/me");
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not load your affiliate profile"));
  }
});

export const updateMyAffiliateProfile = createAsyncThunk<
  { affiliate: AffiliateProfile },
  AffiliateSelfUpdatePayload,
  { rejectValue: string }
>("affiliates/updateMe", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.patch("/admin/affiliate/me", payload);
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not save your profile"));
  }
});

export const subscribeMyAffiliate = createAsyncThunk<
  { ok: boolean; subscription_id: string },
  { dataDescriptor: string; dataValue: string },
  { rejectValue: string }
>("affiliates/subscribeMe", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/admin/affiliate/me/subscribe", payload);
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Subscription failed"));
  }
});

export const createAffiliateLead = createAsyncThunk<
  { ok: boolean; client_id: number },
  AffiliateLeadPayload,
  { rejectValue: string }
>("affiliates/createLead", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/admin/affiliate/leads", payload);
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not submit lead"));
  }
});

export const inviteSubAffiliate = createAsyncThunk<
  { id: number; admin_id: number; slug: string; referral_code: string },
  AffiliateLeadPayload,
  { rejectValue: string }
>("affiliates/inviteSub", async (payload, { rejectWithValue }) => {
  try {
    const { data } = await api.post("/admin/affiliate/subs", payload);
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not invite sub-affiliate"));
  }
});

export const fetchMyCommissions = createAsyncThunk<
  { commissions: AffiliateCommission[] },
  void,
  { rejectValue: string }
>("affiliates/fetchMyCommissions", async (_arg, { rejectWithValue }) => {
  try {
    const { data } = await api.get("/admin/affiliate/commissions");
    return data;
  } catch (e: unknown) {
    return rejectWithValue(formatAxiosError(e, "Could not load commissions"));
  }
});

const slice = createSlice({
  name: "affiliates",
  initialState,
  reducers: {
    clearSelectedAffiliate(state) {
      state.selected = null;
      state.commissions = [];
    },
    clearAffiliatesError(state) {
      state.error = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchAffiliates.pending, (s) => {
      s.listLoading = true;
      s.loading = true;
    });
    b.addCase(fetchAffiliates.fulfilled, (s, a) => {
      s.listLoading = false;
      s.loading = false;
      s.list = a.payload.affiliates;
    });
    b.addCase(fetchAffiliates.rejected, (s) => {
      s.listLoading = false;
      s.loading = false;
    });

    b.addCase(fetchSuggestions.pending, (s) => {
      s.suggestionsLoading = true;
    });
    b.addCase(fetchSuggestions.fulfilled, (s, a) => {
      s.suggestionsLoading = false;
      s.suggestions = a.payload;
    });
    b.addCase(fetchSuggestions.rejected, (s) => {
      s.suggestionsLoading = false;
    });

    b.addCase(createAffiliate.pending, (s) => {
      s.saving = true;
      s.error = null;
    });
    b.addCase(createAffiliate.fulfilled, (s) => {
      s.saving = false;
    });
    b.addCase(createAffiliate.rejected, (s, a) => {
      s.saving = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(updateAffiliate.pending, (s) => {
      s.saving = true;
      s.error = null;
    });
    b.addCase(updateAffiliate.fulfilled, (s, a) => {
      s.saving = false;
      s.list = s.list.map((aff) =>
        aff.id === a.payload.affiliate.id ? a.payload.affiliate : aff,
      );
      if (s.selected && s.selected.affiliate.id === a.payload.affiliate.id) {
        s.selected.affiliate = a.payload.affiliate;
      }
    });
    b.addCase(updateAffiliate.rejected, (s, a) => {
      s.saving = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(fetchAffiliateDetail.pending, (s) => {
      s.selectedLoading = true;
    });
    b.addCase(fetchAffiliateDetail.fulfilled, (s, a) => {
      s.selectedLoading = false;
      s.selected = a.payload;
    });
    b.addCase(fetchAffiliateDetail.rejected, (s, a) => {
      s.selectedLoading = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(compAffiliate.fulfilled, (s) => {
      if (s.selected) {
        s.selected.affiliate.status = "active";
        s.selected.affiliate.subscription_status = "comped";
        s.selected.affiliate.has_portal_access = true;
      }
    });

    b.addCase(fetchAffiliateCommissions.pending, (s) => {
      s.commissionsLoading = true;
    });
    b.addCase(fetchAffiliateCommissions.fulfilled, (s, a) => {
      s.commissionsLoading = false;
      s.commissions = a.payload.commissions;
    });
    b.addCase(fetchAffiliateCommissions.rejected, (s) => {
      s.commissionsLoading = false;
    });

    b.addCase(updateCommissionStatus.fulfilled, (s, a) => {
      s.commissions = s.commissions.map((c) =>
        c.id === a.payload.id ? { ...c, status: a.payload.status as any } : c,
      );
    });

    // ── Self-service ──
    b.addCase(fetchMyAffiliateProfile.pending, (s) => {
      s.myProfileLoading = true;
    });
    b.addCase(fetchMyAffiliateProfile.fulfilled, (s, a) => {
      s.myProfileLoading = false;
      s.myProfile = a.payload;
    });
    b.addCase(fetchMyAffiliateProfile.rejected, (s, a) => {
      s.myProfileLoading = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(updateMyAffiliateProfile.pending, (s) => {
      s.saving = true;
    });
    b.addCase(updateMyAffiliateProfile.fulfilled, (s, a) => {
      s.saving = false;
      if (s.myProfile) s.myProfile.affiliate = a.payload.affiliate;
    });
    b.addCase(updateMyAffiliateProfile.rejected, (s, a) => {
      s.saving = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(subscribeMyAffiliate.pending, (s) => {
      s.mySubscribing = true;
      s.error = null;
    });
    b.addCase(subscribeMyAffiliate.fulfilled, (s) => {
      s.mySubscribing = false;
      if (s.myProfile) {
        s.myProfile.affiliate.subscription_status = "active";
        s.myProfile.affiliate.status = "active";
        s.myProfile.affiliate.has_portal_access = true;
      }
    });
    b.addCase(subscribeMyAffiliate.rejected, (s, a) => {
      s.mySubscribing = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(createAffiliateLead.pending, (s) => {
      s.leadSubmitting = true;
      s.error = null;
    });
    b.addCase(createAffiliateLead.fulfilled, (s) => {
      s.leadSubmitting = false;
    });
    b.addCase(createAffiliateLead.rejected, (s, a) => {
      s.leadSubmitting = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(inviteSubAffiliate.pending, (s) => {
      s.inviteSubmitting = true;
      s.error = null;
    });
    b.addCase(inviteSubAffiliate.fulfilled, (s) => {
      s.inviteSubmitting = false;
    });
    b.addCase(inviteSubAffiliate.rejected, (s, a) => {
      s.inviteSubmitting = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(fetchMyCommissions.pending, (s) => {
      s.myCommissionsLoading = true;
    });
    b.addCase(fetchMyCommissions.fulfilled, (s, a) => {
      s.myCommissionsLoading = false;
      s.myCommissions = a.payload.commissions;
    });
    b.addCase(fetchMyCommissions.rejected, (s) => {
      s.myCommissionsLoading = false;
    });

    // ── Public redirect ──
    b.addCase(resolvePublicAffiliate.pending, (s) => {
      s.publicResolving = true;
      s.publicError = null;
      s.publicResolve = null;
    });
    b.addCase(resolvePublicAffiliate.fulfilled, (s, a) => {
      s.publicResolving = false;
      s.publicResolve = a.payload;
    });
    b.addCase(resolvePublicAffiliate.rejected, (s, a) => {
      s.publicResolving = false;
      s.publicError = a.payload || "This referral link is invalid or expired.";
    });

    b.addCase(resolveAffiliateInvite.pending, (s) => {
      s.publicInviteLoading = true;
      s.publicInviteError = null;
      s.publicInvite = null;
    });
    b.addCase(resolveAffiliateInvite.fulfilled, (s, a) => {
      s.publicInviteLoading = false;
      s.publicInvite = a.payload;
    });
    b.addCase(resolveAffiliateInvite.rejected, (s, a) => {
      s.publicInviteLoading = false;
      s.publicInviteError = a.payload || "Invite not found";
    });

    b.addCase(joinAffiliateInvite.pending, (s) => {
      s.publicJoinSubmitting = true;
      s.publicInviteError = null;
    });
    b.addCase(joinAffiliateInvite.fulfilled, (s) => {
      s.publicJoinSubmitting = false;
    });
    b.addCase(joinAffiliateInvite.rejected, (s, a) => {
      s.publicJoinSubmitting = false;
      s.publicInviteError = a.payload || "Signup failed";
    });

    b.addCase(fetchAffiliateInviteLinks.pending, (s) => {
      s.inviteLinksLoading = true;
    });
    b.addCase(fetchAffiliateInviteLinks.fulfilled, (s, a) => {
      s.inviteLinksLoading = false;
      s.inviteLinks = a.payload.links;
    });
    b.addCase(fetchAffiliateInviteLinks.rejected, (s) => {
      s.inviteLinksLoading = false;
    });

    b.addCase(fetchInviteParentMasters.fulfilled, (s, a) => {
      s.inviteParentMasters = a.payload.affiliates;
    });

    b.addCase(createAffiliateInviteLink.pending, (s) => {
      s.inviteLinkSaving = true;
    });
    b.addCase(createAffiliateInviteLink.fulfilled, (s, a) => {
      s.inviteLinkSaving = false;
      s.inviteLinks = [a.payload.link, ...s.inviteLinks];
    });
    b.addCase(createAffiliateInviteLink.rejected, (s, a) => {
      s.inviteLinkSaving = false;
      s.error = a.payload || "Failed";
    });

    b.addCase(updateAffiliateInviteLink.fulfilled, (s, a) => {
      s.inviteLinks = s.inviteLinks.map((l) =>
        l.id === a.payload.link.id ? a.payload.link : l,
      );
    });
    b.addCase(deleteAffiliateInviteLink.fulfilled, (s, a) => {
      s.inviteLinks = s.inviteLinks.filter((l) => l.id !== a.payload.id);
    });
  },
});

export const { clearSelectedAffiliate, clearAffiliatesError } = slice.actions;
export default slice.reducer;

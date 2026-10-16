import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Delete,
  HelpCircle,
  ImagePlus,
  Link2,
  Lock,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneOff,
  Plus,
  Search,
  Settings,
  Sparkles,
  StickyNote,
  UserPlus,
  X,
  ChevronDown,
  ChevronUp,
  ArchiveRestore,
  Instagram,
  Loader2,
} from "lucide-react";
import { getSharedAblyClient, isAblyPermanentlyUnavailable } from "@/lib/ably-client";
import type { RealtimeChannel } from "ably";
import AdminPageHeader from "@/components/AdminPageHeader";
import ConversationSocialHub from "@/components/admin/ConversationSocialHub";
import ConversationCallInsights from "@/components/admin/ConversationCallInsights";
import {
  ConversationMediaLightbox,
  ConversationMediaThumb,
  type ConversationMediaPreviewItem,
} from "@/components/admin/ConversationMediaLightbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ClientPanelSheet } from "@/components/admin/ClientPanelSheet";
import ConversationsHubSkeleton, {
  ConversationsContactListSkeleton,
  ConversationsTimelineSkeleton,
} from "@/components/admin/ConversationsHubSkeleton";
import { ConversationMessageComposer } from "@/components/admin/ConversationMessageComposer";
import type { ConversationMediaAttachment } from "@/components/admin/ConversationMessageComposer";
import {
  ConversationComposeTargetPicker,
  type ConversationComposeTarget,
} from "@/components/admin/ConversationComposeTargetPicker";
import {
  ConversationComposeAlsoSend,
  type ComposeAlsoRecipient,
} from "@/components/admin/ConversationComposeAlsoSend";
import { ConversationMessageStatus } from "@/components/admin/ConversationMessageStatus";
import ConversationVoiceSettingsModal from "@/components/admin/ConversationVoiceSettingsModal";
import { ContactPhoneActions } from "@/components/admin/ContactPhoneActions";
import { isOutboundProviderStatusPending } from "@/lib/conversationProviderStatus";
import { normalizeContactPhone } from "@/lib/contactPhoneActions";
import { ClientSearchPicker } from "@/components/ui/client-search-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  assignConversationContact,
  clearActiveConversation,
  createProspectFromUnknown,
  dismissUnknownContact,
  fetchConversationAiSuggestions,
  fetchConversationContacts,
  fetchConversationTemplates,
  fetchConversationsAccess,
  fetchConversationTimeline,
  fetchConversationsNavBadge,
  linkUnknownContact,
  selectConversationContact,
  sendHubMessage,
  setConversationContactStatus,
  setConversationsSearch,
  setConversationsSendError,
  setConversationsView,
  startConversationOutbound,
  uploadConversationMedia,
  contactActivityRealtime,
  messageStatusRealtime,
  callInsightsRealtime,
  callRecordingRealtime,
  type ConversationsView,
} from "@/store/slices/conversationsSlice";
import { fetchClientReferrers } from "@/store/slices/adminSlice";
import {
  applyConversationTemplateVars,
  buildConversationMergeVars,
} from "@/lib/conversationTemplateVars";
import { buildStaticConversationSuggestions } from "@/lib/conversationSuggestedReplies";
import { SMS_MAX_BODY_CHARS } from "@/lib/smsSegments";
import {
  formatConversationAbsoluteTime,
  formatConversationListTime,
} from "@/lib/conversationListTime";
import {
  dedupeAlsoRecipients,
  filterAlsoRecipientsForRetry,
  type AlsoRecipient,
} from "@/lib/conversationAlsoSend";
import { useToast } from "@/hooks/use-toast";
import {
  setVoiceAvailable,
  startOutboundCall,
} from "@/store/slices/voiceSlice";
import type { AdminClientListItem, ClientReferrerLink, ConversationContactHubItem, ConversationMessage } from "@shared/api";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/utils";

const GUIDE_STORAGE_KEY = "ofg.conversations.guide.v2";
const FALLBACK_POLL_MS = 5 * 60 * 1000;
/** Contacts-only poll while Ably is unavailable (not full inbox+timeline every tick). */
const NO_ABLY_POLL_MS = 30_000;
const CONTACTS_THROTTLE_MS = 3_000;

const VIEWS: ConversationsView[] = [
  "all",
  "mine",
  "unassigned",
  "unread",
  "unknown",
  "open",
  "closed",
];

const COMPOSE_STARTER_KEYS = [
  "composeStarterHello",
  "composeStarterDocs",
  "composeStarterCheckIn",
  "composeStarterThanks",
] as const;

function formatWhen(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "";
  }
}

function readGuideDismissed(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function AdminConversations() {
  const { t, i18n } = useTranslation();
  const timeLang = i18n.language?.startsWith("es") ? "es" : "en";
  const [listClock, setListClock] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setListClock(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const authUser = useAppSelector((s) => s.adminAuth.user);
  const {
    accessEnabled,
    accessLoading,
    accessNumbers,
    contacts,
    contactsPagination,
    contactsLoading,
    contactsRefreshing,
    contactsLoadedOnce,
    contactsError,
    view,
    search,
    activeKind,
    activeId,
    activeHubStatus,
    timeline,
    timelineLoading,
    timelineRefreshing,
    sending,
    sendError,
    templates,
    aiSuggestions,
    aiSuggestionsLoading,
  } = useAppSelector((s) => s.conversations);
  const sessionToken = useAppSelector((s) => s.adminAuth.token);
  const isAvailable = useAppSelector((s) => s.voice.isAvailable);
  const deviceStatus = useAppSelector((s) => s.voice.deviceStatus);

  /** Twilio MMS URLs need a tokenized proxy for <img src>. */
  const resolveMediaSrc = (rawUrl: string): string => {
    const u = String(rawUrl || "").trim();
    if (!u) return u;
    if (u.includes("/api/conversations/media/public/")) return u;
    if (u.startsWith("https://disruptinglabs.com/")) return u;
    if (!sessionToken) return u;
    if (
      u.startsWith("https://api.twilio.com/") ||
      u.startsWith("http://api.twilio.com/")
    ) {
      return `/api/conversations/media?url=${encodeURIComponent(u)}&token=${encodeURIComponent(sessionToken)}`;
    }
    return u;
  };

  const resolveCallRecordingSrc = (m: (typeof messages)[number]): string | null => {
    const sid = String(m.provider_message_id || "").trim();
    if (sid && sessionToken) {
      return `/api/voice/recording/${encodeURIComponent(sid)}?token=${encodeURIComponent(sessionToken)}`;
    }
    const raw = String(m.recording_url || "").trim();
    return raw ? resolveMediaSrc(raw) : null;
  };

  const formatCallDuration = (sec?: number | null) => {
    if (sec == null || sec <= 0) return null;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const [channel, setChannel] = useState<"sms" | "internal" | "whatsapp">(
    "sms",
  );
  const [body, setBody] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [linkClient, setLinkClient] = useState<AdminClientListItem | null>(
    null,
  );
  const [prospectFirst, setProspectFirst] = useState("");
  const [prospectLast, setProspectLast] = useState("");
  const [prospectEmail, setProspectEmail] = useState("");
  const [prospectLang, setProspectLang] = useState<"en" | "es">("en");
  const [prospectCreateCase, setProspectCreateCase] = useState(false);
  const [completeProfileClientId, setCompleteProfileClientId] = useState<
    number | null
  >(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTarget, setComposeTarget] =
    useState<ConversationComposeTarget | null>(null);
  const [composeChannel, setComposeChannel] = useState<
    "sms" | "internal" | "whatsapp"
  >("sms");
  const [composeBody, setComposeBody] = useState("");
  const [composeAlsoRecipients, setComposeAlsoRecipients] = useState<
    ComposeAlsoRecipient[]
  >([]);
  const [composeReferrers, setComposeReferrers] = useState<ClientReferrerLink[]>(
    [],
  );
  const [composeReferrersLoading, setComposeReferrersLoading] = useState(false);
  const [composeSending, setComposeSending] = useState(false);
  const [threadAlsoRecipients, setThreadAlsoRecipients] = useState<
    AlsoRecipient[]
  >([]);
  const [threadReferrers, setThreadReferrers] = useState<ClientReferrerLink[]>(
    [],
  );
  const [threadReferrersLoading, setThreadReferrersLoading] = useState(false);
  const [threadSending, setThreadSending] = useState(false);
  const [attachment, setAttachment] =
    useState<ConversationMediaAttachment | null>(null);
  const [mediaPreview, setMediaPreview] =
    useState<ConversationMediaPreviewItem | null>(null);
  const [composeAttachment, setComposeAttachment] =
    useState<ConversationMediaAttachment | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [guideOpen, setGuideOpen] = useState(() => !readGuideDismissed());
  const [ablyLive, setAblyLive] = useState(false);
  const [isDialerOpen, setIsDialerOpen] = useState(false);
  const [dialerNumber, setDialerNumber] = useState("");
  const [dialerClient, setDialerClient] = useState<AdminClientListItem | null>(
    null,
  );
  const [isDialerCallActive, setIsDialerCallActive] = useState(false);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [unknownLeadOpen, setUnknownLeadOpen] = useState(false);
  /** SMS hub vs Social DM (FB/IG) — social locked until credentials. */
  const [hubChannel, setHubChannel] = useState<"sms" | "social">("sms");
  const socialDmMode = authUser?.social_dm_mode || "disabled";
  const socialDmLive = authUser?.social_dm_enabled === true;
  const whatsappEnabled = authUser?.whatsapp_enabled === true;
  const threadChannels = (
    whatsappEnabled
      ? (["sms", "whatsapp", "internal"] as const)
      : (["sms", "internal"] as const)
  ).slice() as Array<"sms" | "internal" | "whatsapp">;
  const outboundChannels = (
    whatsappEnabled
      ? (["sms", "whatsapp"] as const)
      : (["sms"] as const)
  ).slice() as Array<"sms" | "internal" | "whatsapp">;
  const [contactsPage, setContactsPage] = useState(1);
  const [contactsLoadingMore, setContactsLoadingMore] = useState(false);

  const lastContactsFetchRef = useRef(0);
  const ablyRefreshRef = useRef({
    view,
    search,
    activeKind,
    activeId,
    contactsPage,
  });

  const fetchContacts = useCallback(
    (targetPage: number, opts?: { append?: boolean }) => {
      dispatch(
        fetchConversationContacts({
          view,
          q: search.trim() || undefined,
          page: targetPage,
          limit: 25,
          append: !!opts?.append,
        }),
      );
    },
    [dispatch, view, search],
  );

  const refreshContacts = useCallback(() => {
    const now = Date.now();
    if (now - lastContactsFetchRef.current < CONTACTS_THROTTLE_MS) return;
    lastContactsFetchRef.current = now;
    const cur = ablyRefreshRef.current;
    // Soft refresh keeps the first loaded page(s) coherent — reset to page 1.
    setContactsPage(1);
    dispatch(
      fetchConversationContacts({
        view: cur.view,
        q: cur.search.trim() || undefined,
        page: 1,
        limit: 25,
        append: false,
      }),
    );
  }, [dispatch]);

  const loadMoreContacts = useCallback(async () => {
    if (!contactsPagination) return;
    if (contactsPagination.page >= contactsPagination.totalPages) return;
    if (contactsLoading || contactsRefreshing || contactsLoadingMore) return;
    const next = contactsPagination.page + 1;
    setContactsLoadingMore(true);
    try {
      await dispatch(
        fetchConversationContacts({
          view,
          q: search.trim() || undefined,
          page: next,
          limit: 25,
          append: true,
        }),
      ).unwrap();
      setContactsPage(next);
    } catch {
      // Error lands in slice; keep current page.
    } finally {
      setContactsLoadingMore(false);
    }
  }, [
    contactsPagination,
    contactsLoading,
    contactsRefreshing,
    contactsLoadingMore,
    dispatch,
    view,
    search,
  ]);

  const refreshOpenTimeline = useCallback(() => {
    const cur = ablyRefreshRef.current;
    if (cur.activeKind && cur.activeId) {
      dispatch(
        fetchConversationTimeline({
          kind: cur.activeKind,
          id: cur.activeId,
        }),
      );
    }
  }, [dispatch]);

  /** Full sync — use on Ably events or explicit user actions, not background polls. */
  const refreshInbox = useCallback(() => {
    refreshContacts();
    refreshOpenTimeline();
  }, [refreshContacts, refreshOpenTimeline]);

  const dismissGuide = () => {
    setGuideOpen(false);
    try {
      window.localStorage.setItem(GUIDE_STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const pickMedia = async (
    file: File,
    setAtt: (a: ConversationMediaAttachment | null) => void,
    previous?: ConversationMediaAttachment | null,
  ) => {
    if (file.size > 4 * 1024 * 1024) {
      dispatch(setConversationsSendError(t("conversations.mmsTooLarge")));
      return;
    }
    if (previous?.preview_url) {
      URL.revokeObjectURL(previous.preview_url);
    }
    const preview_url =
      file.type.startsWith("image/") || file.type.startsWith("video/")
        ? URL.createObjectURL(file)
        : undefined;
    // Instant local preview (real-state); public URL filled after upload.
    setAtt({
      url: "",
      content_type: file.type || "application/octet-stream",
      filename: file.name,
      preview_url,
    });
    setUploadingMedia(true);
    try {
      const result = await dispatch(uploadConversationMedia(file));
      if (uploadConversationMedia.fulfilled.match(result)) {
        setAtt({
          url: result.payload.url,
          content_type: result.payload.content_type,
          filename: result.payload.filename || file.name,
          preview_url,
        });
      } else {
        if (preview_url) URL.revokeObjectURL(preview_url);
        setAtt(null);
      }
    } catch {
      if (preview_url) URL.revokeObjectURL(preview_url);
      setAtt(null);
    } finally {
      setUploadingMedia(false);
    }
  };

  useEffect(() => {
    dispatch(fetchConversationsAccess());
    dispatch(fetchConversationTemplates());
  }, [dispatch]);

  // Deep link from notification bell: /admin/conversations?client=123 or ?unknown=456
  // Compose deep link: ?composeClient=…&composeContact=…&composePhone=…
  useEffect(() => {
    if (!accessEnabled) return;
    const clientId = Number(searchParams.get("client"));
    const unknownId = Number(searchParams.get("unknown"));
    const contactId = Number(searchParams.get("contact"));
    if (clientId > 0) {
      dispatch(selectConversationContact({ kind: "client", id: clientId }));
      dispatch(fetchConversationTimeline({ kind: "client", id: clientId }));
    } else if (unknownId > 0) {
      dispatch(selectConversationContact({ kind: "unknown", id: unknownId }));
      dispatch(fetchConversationTimeline({ kind: "unknown", id: unknownId }));
    } else if (contactId > 0) {
      dispatch(selectConversationContact({ kind: "contact", id: contactId }));
      dispatch(fetchConversationTimeline({ kind: "contact", id: contactId }));
    }

    const composeClientId = Number(searchParams.get("composeClient"));
    const composeContactId = Number(searchParams.get("composeContact"));
    const composePhoneRaw = searchParams.get("composePhone");
    if (!(composeClientId > 0) && !(composeContactId > 0) && !composePhoneRaw)
      return;

    const normalized = composePhoneRaw
      ? normalizeContactPhone(composePhoneRaw)
      : null;
    let openedCompose = false;
    if (composeClientId > 0) {
      setComposeTarget({
        kind: "client",
        client: {
          id: composeClientId,
          first_name: "",
          last_name: "",
          phone: normalized?.phone || composePhoneRaw || "",
          email: "",
        } as AdminClientListItem,
      });
      dispatch(
        selectConversationContact({ kind: "client", id: composeClientId }),
      );
      dispatch(
        fetchConversationTimeline({ kind: "client", id: composeClientId }),
      );
      openedCompose = true;
    } else if (composeContactId > 0) {
      setComposeTarget({
        kind: "contact",
        contact: {
          id: composeContactId,
          first_name: "",
          last_name: "",
          phone: normalized?.phone || composePhoneRaw || "",
          email: null,
          preferred_language: "en",
          created_at: "",
        },
      });
      dispatch(
        selectConversationContact({ kind: "contact", id: composeContactId }),
      );
      dispatch(
        fetchConversationTimeline({ kind: "contact", id: composeContactId }),
      );
      openedCompose = true;
    } else if (normalized) {
      setComposeTarget({
        kind: "phone",
        phone: normalized.phone,
        label: normalized.label,
      });
      openedCompose = true;
    }
    if (openedCompose) {
      setComposeChannel("sms");
      setComposeOpen(true);
    }
    navigate("/admin/conversations", { replace: true });
  }, [accessEnabled, dispatch, searchParams, navigate]);

  useEffect(() => {
    if (!accessEnabled) return;
    const handle = window.setTimeout(() => {
      setContactsPage(1);
      fetchContacts(1);
    }, search ? 280 : 0);
    return () => window.clearTimeout(handle);
  }, [accessEnabled, view, search, fetchContacts]);

  /** After mutations, reload from page 1 (append list stays coherent). */
  const reloadContactsFromStart = useCallback(() => {
    setContactsPage(1);
    fetchContacts(1);
  }, [fetchContacts]);

  // Keep inbox/timeline refresh targets current without recreating the Ably client
  // (TokenRequest nonces are one-time — recreating + replaying the same request → 40105).
  useEffect(() => {
    ablyRefreshRef.current = { view, search, activeKind, activeId, contactsPage };
  }, [view, search, activeKind, activeId, contactsPage]);

  // Real-time inbox/timeline via shared Ably client (real-state pattern).
  useEffect(() => {
    if (!accessEnabled || !authUser?.id || !sessionToken) return;

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let clientRef: Awaited<ReturnType<typeof getSharedAblyClient>> = null;
    let onConnected: (() => void) | null = null;
    let onFailed: (() => void) | null = null;
    let onSuspended: (() => void) | null = null;

    const applyContactPatch = (
      kind: "client" | "unknown" | "contact",
      contactId: number,
      patch: Partial<ConversationContactHubItem>,
    ) => {
      dispatch(
        contactActivityRealtime({
          kind,
          contact_id: contactId,
          patch,
        }),
      );
    };

    const handleInbound = (msg: { data?: Record<string, unknown> }) => {
      const data = msg.data ?? {};
      const contact = data.contact as Record<string, unknown> | undefined;
      const kind =
        (contact?.kind as "client" | "unknown" | "contact") ||
        (data.client_id != null
          ? "client"
          : data.contact_id != null
            ? "contact"
            : "unknown");
      const contactId =
        Number(contact?.contact_id) ||
        Number(data.client_id) ||
        Number(data.unknown_contact_id) ||
        Number(data.contact_id);
      if (!contactId) {
        refreshContacts();
        return;
      }
      if (contact) {
        applyContactPatch(
          kind,
          contactId,
          contact as Partial<ConversationContactHubItem>,
        );
      } else {
        applyContactPatch(kind, contactId, {
          last_message_at: new Date().toISOString(),
        });
      }
      const cur = ablyRefreshRef.current;
      const open =
        (kind === "client" && cur.activeKind === "client" && cur.activeId === contactId) ||
        (kind === "unknown" &&
          cur.activeKind === "unknown" &&
          cur.activeId === contactId);
      if (open) {
        dispatch(
          fetchConversationTimeline({ kind, id: contactId }),
        );
      }
    };

    const handleMessageStatus = (msg: { data?: Record<string, unknown> }) => {
      const data = msg.data ?? {};
      const messageId = Number(data.message_id);
      const status = String(data.provider_status || "");
      if (messageId && status) {
        dispatch(messageStatusRealtime({ message_id: messageId, provider_status: status }));
      } else {
        refreshContacts();
      }
    };

    const handleCallInsights = (msg: { data?: Record<string, unknown> }) => {
      const data = msg.data ?? {};
      const messageId = Number(data.message_id);
      if (!messageId) {
        refreshOpenTimeline();
        return;
      }
      dispatch(
        callInsightsRealtime({
          message_id: messageId,
          call_insights_status: data.call_insights_status as
            | ConversationMessage["call_insights_status"]
            | undefined,
          call_insights_json: (data.call_insights_json as ConversationMessage["call_insights_json"]) || null,
          call_transcript:
            data.call_transcript != null
              ? String(data.call_transcript)
              : null,
          call_insights_error:
            data.call_insights_error != null
              ? String(data.call_insights_error)
              : data.call_insights_error === null
                ? null
                : undefined,
        }),
      );
    };

    const handleCallRecording = (msg: { data?: Record<string, unknown> }) => {
      const data = msg.data ?? {};
      const messageId = Number(data.message_id);
      if (!messageId) {
        refreshOpenTimeline();
        return;
      }
      dispatch(
        callRecordingRealtime({
          message_id: messageId,
          recording_url:
            data.recording_url != null ? String(data.recording_url) : null,
          call_duration_sec:
            data.call_duration_sec != null
              ? Number(data.call_duration_sec)
              : null,
        }),
      );
      // Patch is a no-op if the call bubble isn't loaded yet — refetch open thread.
      refreshOpenTimeline();
    };

    const handleAssign = (msg: { data?: Record<string, unknown> }) => {
      const clientId = Number(msg.data?.client_id);
      const assignee = msg.data?.assigned_admin_id;
      if (!clientId) {
        refreshContacts();
        return;
      }
      applyContactPatch("client", clientId, {
        assigned_admin_id:
          assignee === null || assignee === undefined
            ? null
            : Number(assignee),
      });
    };

    const handleStatus = (msg: { data?: Record<string, unknown> }) => {
      const data = msg.data ?? {};
      const kind = (data.kind as "client" | "unknown") || "client";
      const contactId = Number(data.contact_id);
      const status = String(data.status || "") as ConversationContactHubItem["status"];
      if (!contactId || !status) {
        refreshContacts();
        return;
      }
      const contact = data.contact as Partial<ConversationContactHubItem> | undefined;
      applyContactPatch(kind, contactId, {
        ...(contact || {}),
        status,
      });
      const cur = ablyRefreshRef.current;
      const open =
        cur.activeKind === kind && cur.activeId === contactId;
      if (open) {
        dispatch(fetchConversationTimeline({ kind, id: contactId }));
      }
    };

    void (async () => {
      if (isAblyPermanentlyUnavailable()) {
        setAblyLive(false);
        return;
      }

      const client = await getSharedAblyClient(sessionToken);
      if (cancelled) return;
      if (!client) {
        setAblyLive(false);
        logger.warn("ably unavailable — inbox uses light polling until ABLY_API_KEY is set");
        return;
      }
      clientRef = client;

      onConnected = () => {
        if (!cancelled) {
          setAblyLive(true);
        }
      };
      onFailed = () => setAblyLive(false);
      onSuspended = () => setAblyLive(false);
      client.connection.on("connected", onConnected);
      client.connection.on("failed", onFailed);
      client.connection.on("suspended", onSuspended);
      if (client.connection.state === "connected") setAblyLive(true);

      channel = client.channels.get(`admin:${authUser.id}:conversations`);
      channel.subscribe("inbound", handleInbound);
      channel.subscribe("inbound_unknown", handleInbound);
      channel.subscribe("message", handleInbound);
      channel.subscribe("message_status", handleMessageStatus);
      channel.subscribe("call_insights", handleCallInsights);
      channel.subscribe("call_recording", handleCallRecording);
      channel.subscribe("assign", handleAssign);
      channel.subscribe("status", handleStatus);
    })();

    return () => {
      cancelled = true;
      setAblyLive(false);
      try {
        if (channel) {
          channel.unsubscribe("inbound", handleInbound);
          channel.unsubscribe("inbound_unknown", handleInbound);
          channel.unsubscribe("message", handleInbound);
          channel.unsubscribe("message_status", handleMessageStatus);
          channel.unsubscribe("call_insights", handleCallInsights);
          channel.unsubscribe("call_recording", handleCallRecording);
          channel.unsubscribe("assign", handleAssign);
          channel.unsubscribe("status", handleStatus);
        }
        if (clientRef && onConnected && onFailed && onSuspended) {
          clientRef.connection.off("connected", onConnected);
          clientRef.connection.off("failed", onFailed);
          clientRef.connection.off("suspended", onSuspended);
        }
      } catch {
        /* ignore */
      }
    };
  }, [accessEnabled, authUser?.id, sessionToken, dispatch, refreshContacts, refreshOpenTimeline]);

  // When Ably is healthy: rare backstop only (real-state NotificationBell pattern).
  useEffect(() => {
    if (!accessEnabled || !ablyLive) return;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") refreshContacts();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshIfVisible();
    };

    const slowId = window.setInterval(refreshIfVisible, FALLBACK_POLL_MS);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", refreshIfVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", refreshIfVisible);
      window.clearInterval(slowId);
    };
  }, [accessEnabled, ablyLive, refreshContacts]);

  // When Ably is down or drops mid-session: contacts-only poll (no timeline spam).
  useEffect(() => {
    if (!accessEnabled || ablyLive) return;

    const pollContacts = () => {
      if (document.visibilityState === "visible") refreshContacts();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") pollContacts();
    };

    const id = window.setInterval(pollContacts, NO_ABLY_POLL_MS);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", pollContacts);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", pollContacts);
    };
  }, [accessEnabled, ablyLive, refreshContacts]);

  const hasPendingOutbound = useMemo(() => {
    const msgs = timeline?.messages || [];
    return msgs.some((m) =>
      isOutboundProviderStatusPending(m.direction, m.provider_status),
    );
  }, [timeline?.messages]);

  // Twilio statusCallback → Ably `message_status` patches ticks in-place.
  // Only HTTP-poll the open timeline when Ably is down and outbound is still pending.
  useEffect(() => {
    if (!accessEnabled || !activeKind || !activeId || !hasPendingOutbound) {
      return;
    }
    if (ablyLive) return;
    let attempts = 0;
    const maxAttempts = 30;
    const interval = window.setInterval(() => {
      attempts += 1;
      dispatch(
        fetchConversationTimeline({ kind: activeKind, id: activeId }),
      );
      if (attempts >= maxAttempts) {
        window.clearInterval(interval);
      }
    }, 4000);
    return () => window.clearInterval(interval);
  }, [
    accessEnabled,
    activeKind,
    activeId,
    hasPendingOutbound,
    ablyLive,
    dispatch,
  ]);

  const activeContact = useMemo(() => {
    const fromList =
      contacts.find(
        (c) => c.kind === activeKind && c.contact_id === activeId,
      ) || null;
    if (fromList) return fromList;
    if (!activeKind || activeId == null || !timeline) return null;
    const c = timeline.contact || {};
    const display =
      activeKind === "client"
        ? `${String((c as any).first_name || "").trim()} ${String((c as any).last_name || "").trim()}`.trim() ||
          "Client"
        : String(
            (c as any).display_name ||
              (c as any).phone_e164 ||
              (c as any).phone ||
              "Unknown",
          );
    return {
      kind: activeKind,
      contact_id: activeId,
      display_name: display,
      phone:
        (c as any).phone ||
        (c as any).phone_e164 ||
        null,
      email: (c as any).email ?? null,
      unread_count: 0,
      status: activeHubStatus || "open",
      channels: ["sms"] as ConversationContactHubItem["channels"],
      client_id: activeKind === "client" ? activeId : null,
      unknown_contact_id: activeKind === "unknown" ? activeId : null,
      crm_contact_id: activeKind === "contact" ? activeId : null,
    } as ConversationContactHubItem;
  }, [contacts, activeKind, activeId, timeline, activeHubStatus]);

  const isThreadClosed =
    activeHubStatus === "closed" || activeHubStatus === "archived";

  useEffect(() => {
    if (!isDialerCallActive || !dialerNumber.trim()) return;
    const normalized = normalizeContactPhone(dialerNumber);
    const phone = normalized?.phone ?? dialerNumber.trim();
    const name = dialerClient
      ? `${dialerClient.first_name} ${dialerClient.last_name}`.trim()
      : null;
    dispatch(
      startOutboundCall({
        phone,
        clientName: name || null,
        clientId: dialerClient?.id ?? null,
      }),
    );
    setIsDialerCallActive(false);
    setIsDialerOpen(false);
    setDialerNumber("");
    setDialerClient(null);
  }, [isDialerCallActive, dialerNumber, dialerClient, dispatch]);

  const mergeContext = useMemo(() => {
    const c = timeline?.contact || {};
    const isUnknown = activeKind === "unknown";
    return {
      first_name: String((c as any).first_name || "").trim() ||
        (isUnknown ? "" : activeContact?.display_name?.split(/\s+/)[0]) ||
        "",
      last_name:
        String((c as any).last_name || "").trim() ||
        (isUnknown
          ? ""
          : activeContact?.display_name?.split(/\s+/).slice(1).join(" ")) ||
        "",
      phone: String(
        (c as any).phone ||
          (c as any).phone_e164 ||
          activeContact?.phone ||
          "",
      ),
      pipeline_stage: String(
        (c as any).pipeline_stage || (isUnknown ? "unknown" : ""),
      ),
      client_status: String(
        (c as any).status ||
          (c as any).client_status ||
          (isUnknown ? "unknown" : ""),
      ),
      preferred_language: String((c as any).preferred_language || "en"),
    };
  }, [timeline?.contact, activeContact, activeKind]);

  const threadAlsoTarget = useMemo((): ConversationComposeTarget | null => {
    if (activeKind !== "client" || !activeId) return null;
    return {
      kind: "client",
      client: {
        id: activeId,
        first_name: mergeContext.first_name,
        last_name: mergeContext.last_name,
        phone: mergeContext.phone,
      } as AdminClientListItem,
    };
  }, [activeKind, activeId, mergeContext]);

  useEffect(() => {
    setThreadAlsoRecipients([]);
  }, [activeId, activeKind]);

  useEffect(() => {
    if (channel === "internal") {
      setThreadAlsoRecipients([]);
    }
  }, [channel]);

  useEffect(() => {
    if (activeKind !== "client" || !activeId) {
      setThreadReferrers([]);
      setThreadReferrersLoading(false);
      return;
    }
    const clientId = activeId;
    let cancelled = false;
    setThreadReferrersLoading(true);
    void dispatch(fetchClientReferrers({ clientId })).then((result) => {
      if (cancelled) return;
      setThreadReferrersLoading(false);
      if (
        fetchClientReferrers.fulfilled.match(result) &&
        activeKind === "client" &&
        activeId === clientId
      ) {
        setThreadReferrers(result.payload);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeKind, activeId, dispatch]);

  const staticSuggestions = useMemo(() => {
    if (!activeKind || !activeId) return [];
    return buildStaticConversationSuggestions({
      kind: activeKind,
      mergeContext,
      pipelineStage: mergeContext.pipeline_stage,
      clientStatus: mergeContext.client_status,
      preferredLanguage: mergeContext.preferred_language,
    });
  }, [activeKind, activeId, mergeContext]);

  const composerSuggestions = useMemo(
    () => [
      ...staticSuggestions,
      ...aiSuggestions.map((s) => ({ ...s, source: "ai" as const })),
    ],
    [staticSuggestions, aiSuggestions],
  );

  const loadAiSuggestions = useCallback(() => {
    if (!activeKind || !activeId) return;
    dispatch(
      fetchConversationAiSuggestions({
        kind: activeKind,
        contact_id: activeId,
        recent_messages: (timeline?.messages || []).map((m) => ({
          direction: m.direction,
          body: m.body,
        })),
      }),
    );
  }, [activeKind, activeId, timeline?.messages, dispatch]);

  const openContact = (
    kind: "client" | "unknown" | "contact",
    id: number,
    status?: ConversationContactHubItem["status"],
  ) => {
    setUnknownLeadOpen(false);
    dispatch(selectConversationContact({ kind, id, status }));
    void dispatch(fetchConversationTimeline({ kind, id })).then((action) => {
      if (fetchConversationTimeline.fulfilled.match(action)) {
        dispatch(fetchConversationsNavBadge());
      }
    });
    // Client panel opens only via name / explicit panel control — not on select or send
    setPanelOpen(false);
  };

  const revokeAttachmentPreview = (
    att: ConversationMediaAttachment | null | undefined,
  ) => {
    if (att?.preview_url) URL.revokeObjectURL(att.preview_url);
  };

  const clearAttachment = () => {
    setAttachment((prev) => {
      revokeAttachmentPreview(prev);
      return null;
    });
  };

  const clearComposeAttachment = () => {
    setComposeAttachment((prev) => {
      revokeAttachmentPreview(prev);
      return null;
    });
  };

  const fanOutAlsoRecipients = async (
    recipients: AlsoRecipient[],
    filledBody: string,
    media?: ConversationMediaAttachment | null,
  ) => {
    const failures: string[] = [];
    for (const recipient of dedupeAlsoRecipients(recipients)) {
      const result = await dispatch(
        startConversationOutbound({
          phone: recipient.phone,
          body: filledBody,
          ofg_number_id: accessNumbers[0]?.id,
          media_url: media?.url,
          media_content_type: media?.content_type,
        }),
      );
      if (startConversationOutbound.rejected.match(result)) {
        failures.push(recipient.label);
      }
    }
    return failures;
  };

  const notifyAlsoSendOutcome = (
    sentCount: number,
    failures: string[],
    recipients: AlsoRecipient[],
  ) => {
    if (failures.length > 0) {
      toast({
        variant: "destructive",
        title: t("conversations.composeAlsoPartialFail", {
          names: failures.join(", "),
        }),
      });
      return;
    }
    if (sentCount === 1) {
      toast({
        title: t("conversations.composeAlsoSuccessOne", {
          name: recipients[0]?.label || "",
        }),
      });
      return;
    }
    if (sentCount > 1) {
      toast({
        title: t("conversations.composeAlsoSuccess", { count: sentCount }),
      });
    }
  };

  const send = async () => {
    if (!activeKind || !activeId || threadSending) return;
    if (!body.trim() && !(channel === "sms" && attachment)) return;
    const vars = buildConversationMergeVars(mergeContext);
    const filledBody = applyConversationTemplateVars(body.trim(), vars);
    if (
      channel === "sms" &&
      [...filledBody].length > SMS_MAX_BODY_CHARS
    ) {
      dispatch(
        setConversationsSendError(
          t("conversations.smsTooLong", { max: SMS_MAX_BODY_CHARS }),
        ),
      );
      return;
    }
    const alsoList =
      activeKind === "client" && channel === "sms"
        ? dedupeAlsoRecipients(threadAlsoRecipients)
        : [];
    setThreadSending(true);
    try {
    const sendChannel =
      channel === "internal"
        ? ("internal" as const)
        : channel === "whatsapp"
          ? ("whatsapp" as const)
          : ("sms" as const);
    const payload =
      activeKind === "client"
        ? {
            client_id: activeId,
            channel: sendChannel,
            body: filledBody,
            is_internal_note: channel === "internal",
            ofg_number_id:
              sendChannel === "whatsapp" ? undefined : accessNumbers[0]?.id,
            media_url: channel === "sms" ? attachment?.url : undefined,
            media_content_type:
              channel === "sms" ? attachment?.content_type : undefined,
          }
        : activeKind === "contact"
          ? {
              contact_id: activeId,
              channel: sendChannel === "internal" ? ("sms" as const) : sendChannel,
              body: filledBody,
              ofg_number_id:
                sendChannel === "whatsapp" ? undefined : accessNumbers[0]?.id,
              media_url:
                sendChannel === "sms" ? attachment?.url : undefined,
              media_content_type:
                sendChannel === "sms" ? attachment?.content_type : undefined,
            }
          : {
              unknown_contact_id: activeId,
              channel: sendChannel === "internal" ? ("sms" as const) : sendChannel,
              body: filledBody,
              ofg_number_id:
                sendChannel === "whatsapp" ? undefined : accessNumbers[0]?.id,
              media_url:
                sendChannel === "sms" ? attachment?.url : undefined,
              media_content_type:
                sendChannel === "sms" ? attachment?.content_type : undefined,
            };
    const result = await dispatch(sendHubMessage(payload));
    if (sendHubMessage.fulfilled.match(result)) {
      let alsoFailures: string[] = [];
      if (alsoList.length > 0) {
        alsoFailures = await fanOutAlsoRecipients(
          alsoList,
          filledBody,
          attachment,
        );
      }
    setBody("");
      clearAttachment();
      dispatch(fetchConversationTimeline({ kind: activeKind, id: activeId }));
      reloadContactsFromStart();
      if (alsoList.length > 0) {
        notifyAlsoSendOutcome(
          alsoList.length - alsoFailures.length,
          alsoFailures,
          alsoList,
        );
        if (alsoFailures.length > 0) {
          setThreadAlsoRecipients(
            filterAlsoRecipientsForRetry(alsoList, alsoFailures),
          );
        } else {
          setThreadAlsoRecipients([]);
        }
      }
    }
    } finally {
      setThreadSending(false);
    }
  };

  const handleComposeTargetChange = (target: ConversationComposeTarget | null) => {
    setComposeTarget(target);
    setComposeAlsoRecipients([]);
    setComposeReferrers([]);
    setComposeReferrersLoading(false);
    if (target?.kind === "phone") {
      setComposeChannel("sms");
    }
  };

  // Hydrate empty composeClient stub names once timeline contact loads
  useEffect(() => {
    if (!composeOpen || composeTarget?.kind !== "client") return;
    if (composeTarget.client.first_name || composeTarget.client.last_name) return;
    if (activeKind !== "client" || activeId !== Number(composeTarget.client.id))
      return;
    const c = timeline?.contact as Record<string, unknown> | undefined;
    if (!c) return;
    const first = String(c.first_name || "").trim();
    const last = String(c.last_name || "").trim();
    const phone = String(c.phone || composeTarget.client.phone || "");
    if (!first && !last && !phone) return;
    setComposeTarget({
      kind: "client",
      client: {
        ...composeTarget.client,
        first_name: first || composeTarget.client.first_name,
        last_name: last || composeTarget.client.last_name,
        phone: phone || composeTarget.client.phone,
      } as AdminClientListItem,
    });
  }, [
    composeOpen,
    composeTarget,
    activeKind,
    activeId,
    timeline?.contact,
  ]);

  useEffect(() => {
    if (!composeOpen || composeTarget?.kind !== "client") {
      setComposeReferrers([]);
      setComposeReferrersLoading(false);
      return;
    }
    const clientId = Number(composeTarget.client.id);
    let cancelled = false;
    setComposeReferrersLoading(true);
    void dispatch(fetchClientReferrers({ clientId })).then((result) => {
      if (cancelled) return;
      setComposeReferrersLoading(false);
      if (
        fetchClientReferrers.fulfilled.match(result) &&
        composeTarget?.kind === "client" &&
        Number(composeTarget.client.id) === clientId
      ) {
        setComposeReferrers(result.payload);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [composeOpen, composeTarget, dispatch]);

  const handleComposeOpenChange = (open: boolean) => {
    setComposeOpen(open);
    if (!open) {
      setComposeTarget(null);
      setComposeBody("");
      setComposeChannel("sms");
      setComposeAlsoRecipients([]);
      setComposeReferrers([]);
      setComposeReferrersLoading(false);
      setComposeSending(false);
      clearComposeAttachment();
      dispatch(setConversationsSendError(null));
    }
  };

  const sendCompose = async () => {
    if (!composeTarget || composeSending) return;
    const composeSms = composeChannel === "sms";
    if (!composeBody.trim() && !(composeSms && composeAttachment)) return;
    if (
      composeSms &&
      [...composeBody].length > SMS_MAX_BODY_CHARS
    ) {
      dispatch(
        setConversationsSendError(
          t("conversations.smsTooLong", { max: SMS_MAX_BODY_CHARS }),
        ),
      );
      return;
    }

    setComposeSending(true);
    try {
    if (composeTarget.kind === "phone") {
      const vars = buildConversationMergeVars({
        first_name: "",
        last_name: "",
        phone: composeTarget.phone,
        pipeline_stage: "unknown",
        client_status: "unknown",
      });
      const filledBody = applyConversationTemplateVars(composeBody.trim(), vars);
      if ([...filledBody].length > SMS_MAX_BODY_CHARS) {
        dispatch(
          setConversationsSendError(
            t("conversations.smsTooLong", { max: SMS_MAX_BODY_CHARS }),
          ),
        );
        return;
      }
      const phoneChannel =
        composeChannel === "whatsapp" ? ("whatsapp" as const) : ("sms" as const);
      const result = await dispatch(
        startConversationOutbound({
          phone: composeTarget.phone,
          body: filledBody,
          channel: phoneChannel,
          ofg_number_id:
            phoneChannel === "whatsapp" ? undefined : accessNumbers[0]?.id,
          media_url:
            phoneChannel === "sms" ? composeAttachment?.url : undefined,
          media_content_type:
            phoneChannel === "sms"
              ? composeAttachment?.content_type
              : undefined,
        }),
      );
      if (startConversationOutbound.fulfilled.match(result)) {
        const data = result.payload;
        setComposeOpen(false);
        setComposeTarget(null);
        setComposeBody("");
        clearComposeAttachment();
        if (data.kind === "client" && data.client_id) {
          openContact("client", data.client_id);
        } else if (data.kind === "contact" && data.contact_id) {
          openContact("contact", data.contact_id);
        } else if (data.unknown_contact_id) {
          openContact("unknown", data.unknown_contact_id);
        }
        reloadContactsFromStart();
      } else if (startConversationOutbound.rejected.match(result)) {
        dispatch(
          setConversationsSendError(
            String(result.payload || "Failed to send"),
          ),
        );
      }
      return;
    }

    if (composeTarget.kind === "contact") {
      const contact = composeTarget.contact;
      const vars = buildConversationMergeVars({
        first_name: contact.first_name,
        last_name: contact.last_name,
        phone: contact.phone,
        pipeline_stage: "",
        client_status: "",
      });
      const filledBody = applyConversationTemplateVars(
        composeBody.trim(),
        vars,
      );
      if ([...filledBody].length > SMS_MAX_BODY_CHARS) {
        dispatch(
          setConversationsSendError(
            t("conversations.smsTooLong", { max: SMS_MAX_BODY_CHARS }),
          ),
        );
        return;
      }
      const contactChannel =
        composeChannel === "whatsapp" ? ("whatsapp" as const) : ("sms" as const);
      const result = await dispatch(
        sendHubMessage({
          contact_id: contact.id,
          channel: contactChannel,
          body: filledBody,
          ofg_number_id:
            contactChannel === "whatsapp" ? undefined : accessNumbers[0]?.id,
          media_url:
            contactChannel === "sms" ? composeAttachment?.url : undefined,
          media_content_type:
            contactChannel === "sms"
              ? composeAttachment?.content_type
              : undefined,
        }),
      );
      if (sendHubMessage.fulfilled.match(result)) {
        setComposeOpen(false);
        setComposeTarget(null);
        setComposeBody("");
        clearComposeAttachment();
        openContact("contact", contact.id);
        reloadContactsFromStart();
      } else if (sendHubMessage.rejected.match(result)) {
        dispatch(
          setConversationsSendError(
            String(result.payload || "Failed to send"),
          ),
        );
      }
      return;
    }

    const client = composeTarget.client;
    const vars = buildConversationMergeVars({
      first_name: client.first_name,
      last_name: client.last_name,
      phone: client.phone,
      pipeline_stage: (client as any).pipeline_stage,
      client_status: (client as any).status,
    });
    const filledBody = applyConversationTemplateVars(composeBody.trim(), vars);
    if (
      composeChannel === "sms" &&
      [...filledBody].length > SMS_MAX_BODY_CHARS
    ) {
      dispatch(
        setConversationsSendError(
          t("conversations.smsTooLong", { max: SMS_MAX_BODY_CHARS }),
        ),
      );
      return;
    }
    const result = await dispatch(
      sendHubMessage({
        client_id: client.id,
        channel:
          composeChannel === "internal"
            ? "internal"
            : composeChannel === "whatsapp"
              ? "whatsapp"
              : "sms",
        body: filledBody,
        is_internal_note: composeChannel === "internal",
        ofg_number_id:
          composeChannel === "whatsapp" ? undefined : accessNumbers[0]?.id,
        media_url:
          composeChannel === "sms" ? composeAttachment?.url : undefined,
        media_content_type:
          composeChannel === "sms"
            ? composeAttachment?.content_type
            : undefined,
      }),
    );
    if (sendHubMessage.fulfilled.match(result)) {
      const alsoList =
        composeChannel === "sms"
          ? dedupeAlsoRecipients(composeAlsoRecipients)
          : [];
      let alsoFailures: string[] = [];
      if (alsoList.length > 0) {
        alsoFailures = await fanOutAlsoRecipients(
          alsoList,
          filledBody,
          composeAttachment,
        );
      }
      setComposeBody("");
      clearComposeAttachment();
      openContact("client", client.id);
      reloadContactsFromStart();
      if (alsoList.length > 0) {
        notifyAlsoSendOutcome(
          alsoList.length - alsoFailures.length,
          alsoFailures,
          alsoList,
        );
      }
      if (alsoFailures.length > 0) {
        setComposeAlsoRecipients(
          filterAlsoRecipientsForRetry(alsoList, alsoFailures),
        );
      } else {
        setComposeOpen(false);
        setComposeTarget(null);
        setComposeAlsoRecipients([]);
      }
    }
    } finally {
      setComposeSending(false);
    }
  };

  const handleCreateProspect = async (confirmDuplicate = false) => {
    if (!activeId || activeKind !== "unknown") return;
    const r = await dispatch(
      createProspectFromUnknown({
        unknownId: activeId,
        first_name: prospectFirst || undefined,
        last_name: prospectLast || undefined,
        email: prospectEmail || undefined,
        preferred_language: prospectLang,
        create_case: prospectCreateCase,
        confirm_duplicate: confirmDuplicate,
      }),
    );
    if (createProspectFromUnknown.rejected.match(r)) {
      try {
        const parsed = JSON.parse(String(r.payload || ""));
        if (parsed.code === "duplicate_phone") {
          const ok = window.confirm(t("conversations.duplicatePhoneConfirm"));
          if (ok) void handleCreateProspect(true);
        }
      } catch {
        /* generic error in sendError */
      }
      return;
    }
    if (createProspectFromUnknown.fulfilled.match(r)) {
      const clientId = r.payload.client_id;
      setCompleteProfileClientId(clientId);
      setPanelOpen(true);
      dispatch(clearActiveConversation());
      reloadContactsFromStart();
      openContact("client", clientId);
    }
  };

  // Thread opens on the newest message. On new messages, follow only when the
  // reader is already near the bottom (don't yank them out of older history).
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const threadStickRef = useRef(true);
  const threadKey = `${activeKind ?? ""}:${activeId ?? ""}`;
  const threadLastKeyRef = useRef("");
  const threadMessageCount = timeline?.messages?.length ?? 0;
  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el || threadMessageCount === 0 || timelineLoading) return;
    const opened = threadLastKeyRef.current !== threadKey;
    if (opened || threadStickRef.current) {
      threadLastKeyRef.current = threadKey;
      threadStickRef.current = true;
      // After layout (images / audio players can change height).
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [threadKey, threadMessageCount, timelineLoading]);

  if (accessLoading || accessEnabled === null) {
  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7rem)] min-h-0">
      <div className="shrink-0 [&>div]:mb-0">
        <AdminPageHeader
          icon={MessageSquare}
          title={t("conversations.title")}
          description={t("conversations.description")}
        />
      </div>
      <ConversationsHubSkeleton />
    </div>
  );
  }

  if (!accessEnabled) {
  return (
    <div className="space-y-4">
      <AdminPageHeader
        icon={MessageSquare}
          title={t("conversations.title")}
          description={t("conversations.description")}
        />
        <div className="rounded-2xl border border-border bg-card p-8 max-w-lg mx-auto text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-muted mx-auto flex items-center justify-center">
            <Lock className="w-5 h-5 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            {t("conversations.lockedTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("conversations.lockedBody")}
          </p>
        </div>
      </div>
    );
  }

  const messages = timeline?.messages || [];

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7rem)] min-h-0">
      <div className="shrink-0 [&>div]:mb-0">
        <AdminPageHeader
          icon={MessageSquare}
          title={t("conversations.title")}
          description={t("conversations.description")}
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <button
              type="button"
              onClick={() => dispatch(setVoiceAvailable(!isAvailable))}
              className={cn(
                "flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-full border text-xs font-medium transition-all duration-200 flex-shrink-0 whitespace-nowrap",
                isAvailable && deviceStatus === "registered"
                  ? "bg-accent/10 border-accent/40 text-accent hover:bg-accent/15"
                  : isAvailable && deviceStatus === "connecting"
                    ? "bg-secondary border-border text-muted-foreground"
                    : isAvailable && deviceStatus === "error"
                      ? "bg-destructive/10 border-destructive/30 text-destructive"
                      : "bg-muted border-border text-muted-foreground hover:bg-muted/80",
              )}
              title={
                !isAvailable
                  ? t("conversations.voice.goAvailable")
                  : deviceStatus === "registered"
                    ? t("conversations.voice.goOffline")
                    : deviceStatus === "connecting"
                      ? t("conversations.voice.connecting")
                      : deviceStatus === "error"
                        ? t("conversations.voice.voipError")
                        : t("conversations.voice.goOffline")
              }
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full flex-shrink-0",
                  isAvailable && deviceStatus === "registered"
                    ? "bg-accent animate-pulse"
                    : isAvailable && deviceStatus === "connecting"
                      ? "bg-muted-foreground animate-pulse"
                      : isAvailable && deviceStatus === "error"
                        ? "bg-destructive"
                        : "bg-muted-foreground",
                )}
              />
              <span className="hidden md:inline">
                {!isAvailable
                  ? t("conversations.voice.unavailable")
                  : deviceStatus === "registered"
                    ? t("conversations.voice.available")
                    : deviceStatus === "connecting"
                      ? t("conversations.voice.connecting")
                      : deviceStatus === "error"
                        ? t("conversations.voice.voipError")
                        : t("conversations.voice.available")}
              </span>
            </button>
            <Button
              size="sm"
              variant="outline"
              className="inline-flex items-center gap-1.5"
              onClick={() => setVoiceSettingsOpen(true)}
              title={t("conversations.voice.settingsTitle")}
            >
              <Settings className="w-4 h-4" />
              <span className="hidden lg:inline">
                {t("conversations.voice.settingsShort")}
              </span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={cn(
                "inline-flex items-center gap-1.5",
                isDialerOpen && "bg-primary/10 border-primary/40 text-primary",
              )}
              onClick={() => {
                setIsDialerOpen((v) => !v);
                setIsDialerCallActive(false);
                setDialerNumber("");
                setDialerClient(null);
              }}
              title={t("conversations.voice.dialpadTitle")}
            >
              <PhoneCall className="w-4 h-4" />
              <span className="hidden lg:inline">
                {t("conversations.voice.dial")}
              </span>
            </Button>
            {!guideOpen && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setGuideOpen(true)}
                className="inline-flex items-center gap-1.5"
              >
                <HelpCircle className="w-4 h-4" />
                {t("conversations.guideShow")}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setComposeOpen(true)}
              className="inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              {t("conversations.newMessage")}
            </Button>
          </div>
        }
      />
      </div>

      {guideOpen && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5 relative shrink-0">
          <button
            type="button"
            onClick={dismissGuide}
            className="absolute top-3 right-3 h-8 w-8 rounded-lg hover:bg-primary/10 inline-flex items-center justify-center text-muted-foreground"
            aria-label={t("conversations.guideDismiss")}
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 mb-3 pr-8">
            <Sparkles className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              {t("conversations.guideTitle")}
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {(
              [
                ["guideStep1Title", "guideStep1Body"],
                ["guideStep2Title", "guideStep2Body"],
                ["guideStep3Title", "guideStep3Body"],
                ["guideStep4Title", "guideStep4Body"],
              ] as const
            ).map(([titleKey, bodyKey], i) => (
              <div
                key={titleKey}
                className="rounded-xl border border-border/60 bg-card/80 p-3"
              >
                <div className="text-[11px] font-bold uppercase tracking-wide text-primary mb-1">
                  {i + 1}. {t(`conversations.${titleKey}`)}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t(`conversations.${bodyKey}`)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setComposeOpen(true)}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              {t("conversations.emptyCta")}
            </Button>
            <Button size="sm" variant="outline" onClick={dismissGuide}>
              {t("conversations.guideDismiss")}
            </Button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-4 flex-1 min-h-0 lg:min-h-[28rem]">
        {/* Inbox list */}
        <div
          className={`bg-card rounded-2xl border border-border flex flex-col overflow-hidden min-h-[75vh] lg:min-h-0 ${
            activeId ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="p-3 border-b border-border space-y-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) =>
                  dispatch(setConversationsSearch(e.target.value))
                }
                placeholder={t("conversations.searchPlaceholder")}
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-input bg-background text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <TooltipProvider delayDuration={200}>
              <button
                  type="button"
                  onClick={() => setHubChannel("sms")}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-wide transition-colors inline-flex items-center gap-1",
                    hubChannel === "sms"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  <MessageSquare className="w-3 h-3" />
                  {t("conversations.hubChannels.sms")}
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setHubChannel("social")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-wide transition-colors inline-flex items-center gap-1",
                        hubChannel === "social"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                        !socialDmLive && "opacity-90",
                      )}
                      data-testid="conversations-hub-social"
                      aria-label={
                        socialDmLive
                          ? t("conversations.hubChannels.social")
                          : t("conversations.social.chipLockedAria")
                      }
                    >
                      <Instagram className="w-3 h-3" />
                      {t("conversations.hubChannels.social")}
                      {!socialDmLive && (
                        <Lock className="w-3 h-3 opacity-80" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                    {socialDmLive
                      ? t("conversations.social.chipLiveHint")
                      : t("conversations.social.chipSoonHint")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {hubChannel === "sms" && (
            <div className="flex flex-wrap gap-1">
              {VIEWS.map((v) => (
              <button
                  key={v}
                  type="button"
                  onClick={() => dispatch(setConversationsView(v))}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                    view === v
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(`conversations.views.${v}`)}
                </button>
              ))}
            </div>
            )}
          </div>

          {hubChannel === "social" ? (
            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-xs text-muted-foreground text-center leading-relaxed px-2">
                {socialDmLive
                  ? t("conversations.social.listLiveEmpty")
                  : t("conversations.social.listSoonEmpty")}
              </p>
            </div>
          ) : (
          <div
            className={cn(
              "flex-1 overflow-y-auto",
              contactsRefreshing && contacts.length > 0 && "opacity-60 transition-opacity",
            )}
          >
            {contactsLoading && !contactsLoadedOnce ? (
              <ConversationsContactListSkeleton />
            ) : contactsError ? (
              <div className="p-6 text-sm text-destructive">{contactsError}</div>
            ) : contacts.length === 0 ? (
              <div
                className={cn(
                  "p-6 space-y-3 text-center transition-opacity",
                  contactsRefreshing && "opacity-60",
                )}
              >
                <div className="w-11 h-11 rounded-2xl bg-muted mx-auto flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {t("conversations.emptyTitle")}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {t("conversations.emptyBody")}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => setComposeOpen(true)}
                  className="inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {t("conversations.emptyCta")}
                </Button>
              </div>
            ) : (
              <>
              {contacts.map((c) => {
                const selected =
                  c.kind === activeKind && c.contact_id === activeId;
                const rowClosed =
                  c.status === "closed" || c.status === "archived";
                const canCloseOrReopen =
                  c.kind === "client" ||
                  c.kind === "unknown" ||
                  c.kind === "contact";
                return (
                  <div
                    key={`${c.kind}-${c.contact_id}`}
                    className={cn(
                      "group relative flex w-full items-start gap-1 border-b border-border/50 p-3.5 transition-colors animate-in fade-in-0 slide-in-from-top-1 duration-300 hover:bg-muted/50",
                      selected ? "bg-muted" : "",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        openContact(c.kind, c.contact_id, c.status)
                      }
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm truncate min-w-0">
                          {c.display_name}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0 pt-0.5">
                          {c.last_message_at ? (
                            <time
                              dateTime={String(c.last_message_at)}
                              title={formatConversationAbsoluteTime(
                                c.last_message_at,
                                timeLang,
                              )}
                              className="text-[10px] font-medium tabular-nums text-muted-foreground/90 leading-none tracking-tight"
                            >
                              {formatConversationListTime(c.last_message_at, {
                                lang: timeLang,
                                now: new Date(listClock),
                              })}
                            </time>
                          ) : null}
                          {c.unread_count > 0 && (
                            <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-accent text-accent-foreground text-[10px] font-bold flex items-center justify-center animate-in zoom-in-50 duration-200">
                              {c.unread_count > 99 ? "99+" : c.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5 pr-1">
                        {c.last_message_preview || "—"}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {c.kind === "unknown" && (
                          <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                            {t("conversations.unknownBadge")}
                          </span>
                        )}
                        {c.kind === "contact" && (
                          <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                            {t("conversations.contactBadge")}
                          </span>
                        )}
                        {(c.channels || []).map((ch) => (
                          <span
                            key={ch}
                            className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                          >
                            {ch}
                          </span>
                        ))}
                        {rowClosed && (
                          <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                            {t("conversations.closedBadge")}
                          </span>
                        )}
                        {!c.assigned_admin_id && c.kind === "client" && (
                          <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                            {t("conversations.unassignedBadge")}
                          </span>
                        )}
                </div>
              </button>
                    {canCloseOrReopen && (
                      <button
                        type="button"
                        data-testid="thread-list-close"
                        title={
                          rowClosed
                            ? t("conversations.reopen")
                            : t("conversations.close")
                        }
                        aria-label={
                          rowClosed
                            ? t("conversations.reopen")
                            : t("conversations.close")
                        }
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void dispatch(
                            setConversationContactStatus({
                              kind: c.kind as "client" | "unknown",
                              contactId: c.contact_id,
                              status: rowClosed ? "open" : "closed",
                            }),
                          );
                        }}
                        className={cn(
                          "shrink-0 mt-0.5 h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selected
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                        )}
                      >
                        {rowClosed ? (
                          <ArchiveRestore className="w-3.5 h-3.5" />
                        ) : (
                          <X className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
              {contactsPagination &&
                contactsPagination.page < contactsPagination.totalPages && (
                  <div className="px-3 py-3">
                    <button
                      type="button"
                      onClick={loadMoreContacts}
                      disabled={
                        contactsLoading ||
                        contactsRefreshing ||
                        contactsLoadingMore
                      }
                      className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-xl border border-border bg-background text-xs font-medium text-foreground hover:bg-muted/80 disabled:opacity-50 transition-colors"
                    >
                      {contactsLoadingMore ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                      ) : null}
                      {t("conversations.loadMore", {
                        shown: contacts.length,
                        total: contactsPagination.total,
                      })}
                    </button>
                  </div>
                )}
              {contactsPagination &&
                contactsPagination.totalPages > 1 &&
                contactsPagination.page >= contactsPagination.totalPages && (
                  <div className="px-3 py-2.5 text-[11px] text-center text-muted-foreground">
                    {t("conversations.showingAll", {
                      total: contactsPagination.total,
                    })}
                  </div>
                )}
              </>
            )}
          </div>
          )}
        </div>

        {/* Timeline + composer (or Social coming-soon) */}
        {hubChannel === "social" ? (
          <div
            className={`bg-card rounded-2xl border border-border flex flex-col min-h-[75vh] lg:min-h-0 lg:h-full overflow-hidden ${
              activeId || hubChannel === "social" ? "flex" : "hidden lg:flex"
            }`}
          >
            <ConversationSocialHub mode={socialDmMode} />
          </div>
        ) : (
        <div
          className={`bg-card rounded-2xl border border-border flex flex-col min-h-[75vh] lg:min-h-0 lg:h-full overflow-hidden ${
            activeId ? "flex" : "hidden lg:flex"
          }`}
        >
          {!activeKind || !activeId ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {t("conversations.selectPromptTitle")}
                </div>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  {t("conversations.selectPromptBody")}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setComposeOpen(true)}
                className="inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                {t("conversations.newMessage")}
              </Button>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-border shrink-0 space-y-3">
                <button
                  type="button"
                  onClick={() => dispatch(clearActiveConversation())}
                  className="lg:hidden flex items-center gap-1 text-sm text-primary"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {t("conversations.backToList")}
                </button>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {activeKind === "client" ? (
                      <button
                        type="button"
                        onClick={() => setPanelOpen(true)}
                        className="font-semibold text-foreground text-left hover:text-primary transition-colors truncate max-w-full"
                        title={t("conversations.openPanel")}
                      >
                        {activeContact?.display_name ||
                          t("conversations.conversation")}
                      </button>
                    ) : (
                      <div className="font-semibold text-foreground">
                        {activeContact?.display_name ||
                          t("conversations.conversation")}
                </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {activeContact?.phone ? (
                        <ContactPhoneActions
                          phone={activeContact.phone}
                          clientId={
                            activeKind === "client" ? activeId : null
                          }
                          clientName={activeContact.display_name}
                          onText={({ phone, clientId, clientName }) => {
                            if (clientId && clientId > 0) {
                              setComposeTarget({
                                kind: "client",
                                client: {
                                  id: clientId,
                                  first_name:
                                    String(clientName || "")
                                      .split(/\s+/)[0] || "",
                                  last_name:
                                    String(clientName || "")
                                      .split(/\s+/)
                                      .slice(1)
                                      .join(" ") || "",
                                  phone,
                                  email: "",
                                } as AdminClientListItem,
                              });
                            } else {
                              const n = normalizeContactPhone(phone);
                              if (!n) return;
                              setComposeTarget({
                                kind: "phone",
                                phone: n.phone,
                                label: n.label,
                              });
                            }
                            setComposeChannel("sms");
                            setComposeOpen(true);
                          }}
                        />
                      ) : (
                        "—"
                      )}
              </div>
                  </div>
                  {(activeKind === "client" ||
                    activeKind === "unknown" ||
                    activeKind === "contact") && (
                    <div className="flex flex-wrap gap-2">
                      {activeKind === "client" && (
                        <button
                          type="button"
                          onClick={() =>
                            dispatch(
                              assignConversationContact({
                                clientId: activeId,
                                assigned_admin_id: authUser?.id ?? null,
                              }),
                            ).then(() => reloadContactsFromStart())
                          }
                          className="h-8 px-3 rounded-lg text-xs font-medium border border-border hover:bg-muted"
                        >
                          {t("conversations.assignToMe")}
                        </button>
                      )}
                      {isThreadClosed ? (
                        <button
                          type="button"
                          onClick={() =>
                            dispatch(
                              setConversationContactStatus({
                                kind: activeKind,
                                contactId: activeId,
                                status: "open",
                              }),
                            )
                          }
                          className="h-8 px-3 rounded-lg text-xs font-medium border border-border hover:bg-muted inline-flex items-center gap-1.5"
                        >
                          <ArchiveRestore className="w-3.5 h-3.5" />
                          {t("conversations.reopen")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            dispatch(
                              setConversationContactStatus({
                                kind: activeKind,
                                contactId: activeId,
                                status: "closed",
                              }),
                            )
                          }
                          className="h-8 px-3 rounded-lg text-xs font-medium border border-border hover:bg-muted"
                        >
                          {t("conversations.close")}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {activeKind === "unknown" && (
                  <div className="rounded-xl border border-border bg-muted/40 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setUnknownLeadOpen((o) => !o)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/60 transition-colors"
                      aria-expanded={unknownLeadOpen}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-foreground">
                          {t("conversations.unknownLeadTitle")}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {t("conversations.unknownActionsHint")}
                        </p>
                      </div>
                      {unknownLeadOpen ? (
                        <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                    {unknownLeadOpen && (
                      <div className="px-3 pb-3 space-y-3 max-h-[min(36vh,280px)] overflow-y-auto border-t border-border">
                        <div className="grid gap-2 sm:grid-cols-2 pt-3">
                          <input
                            value={prospectFirst}
                            onChange={(e) => setProspectFirst(e.target.value)}
                            placeholder={t("conversations.firstName")}
                            className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
                          />
                          <input
                            value={prospectLast}
                            onChange={(e) => setProspectLast(e.target.value)}
                            placeholder={t("conversations.lastName")}
                            className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
                          />
                          <input
                            value={prospectEmail}
                            onChange={(e) => setProspectEmail(e.target.value)}
                            placeholder={t("conversations.emailOptional")}
                            className="h-9 px-3 rounded-lg border border-input bg-background text-sm sm:col-span-2"
                          />
                          <select
                            value={prospectLang}
                            onChange={(e) =>
                              setProspectLang(e.target.value as "en" | "es")
                            }
                            className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
                          >
                            <option value="en">{t("conversations.langEn")}</option>
                            <option value="es">{t("conversations.langEs")}</option>
                          </select>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                            <input
                              type="checkbox"
                              checked={prospectCreateCase}
                              onChange={(e) =>
                                setProspectCreateCase(e.target.checked)
                              }
                              className="rounded border-input"
                            />
                            {t("conversations.createPipelineCase")}
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleCreateProspect()}
                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground"
                          >
                            <UserPlus className="w-3.5 h-3.5" />
                            {t("conversations.createProspect")}
                          </button>
                        </div>
                        <div className="space-y-2 pt-1 border-t border-border">
                          <ClientSearchPicker
                            value={linkClient}
                            onChange={setLinkClient}
                            placeholder={t("conversations.linkClientPlaceholder")}
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={!linkClient}
                              onClick={async () => {
                                if (!linkClient) return;
                                const r = await dispatch(
                                  linkUnknownContact({
                                    unknownId: activeId,
                                    client_id: linkClient.id,
                                  }),
                                );
                                if (linkUnknownContact.fulfilled.match(r)) {
                                  dispatch(clearActiveConversation());
                                  reloadContactsFromStart();
                                  openContact("client", linkClient.id);
                                }
                              }}
                              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium border border-border hover:bg-muted disabled:opacity-50"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                              {t("conversations.linkClient")}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await dispatch(dismissUnknownContact(activeId));
                                dispatch(clearActiveConversation());
                                reloadContactsFromStart();
                              }}
                              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10"
                            >
                              <X className="w-3.5 h-3.5" />
                              {t("conversations.dismiss")}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div
                ref={threadScrollRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  threadStickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
                }}
                data-testid="conversation-thread-scroll"
                className={cn(
                  "flex-1 min-h-0 overflow-y-auto p-4 space-y-2",
                  timelineRefreshing && messages.length > 0 && "opacity-60 transition-opacity",
                )}
              >
                {timelineLoading ? (
                  <ConversationsTimelineSkeleton />
                ) : messages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    {t("conversations.noMessages")}
                  </div>
                ) : (
                  messages.map((m) => {
                    if (m.direction === "system") {
                      const closed = m.body === "closed";
                      return (
                        <div
                          key={m.id}
                          className="flex justify-center py-2"
                          data-testid="conversation-system-event"
                        >
                          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-[11px] text-muted-foreground">
                            {closed ? (
                              <Lock className="w-3 h-3" />
                            ) : (
                              <ArchiveRestore className="w-3 h-3" />
                            )}
                            <span>
                              {closed
                                ? t("conversations.systemClosed")
                                : t("conversations.systemReopened")}
                            </span>
                            <span aria-hidden>·</span>
                            <span>{formatWhen(m.created_at)}</span>
                          </div>
                        </div>
                      );
                    }
                    const isOut = m.direction === "outbound";
                    const isNote = m.direction === "internal" || m.channel === "internal";
                    return (
                  <div
                    key={m.id}
                    className={`flex ${
                          isNote ? "justify-center" : isOut ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                          className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                            isNote
                              ? "bg-secondary text-secondary-foreground border border-border w-full max-w-xl"
                              : isOut
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                          <div className="flex items-center gap-1.5 mb-1 text-[10px] uppercase font-semibold opacity-80">
                            {m.channel === "internal" ? (
                              <StickyNote className="w-3 h-3" />
                            ) : m.channel === "call" ? (
                              <Phone className="w-3 h-3" />
                            ) : (
                              <MessageSquare className="w-3 h-3" />
                            )}
                            {m.channel === "call"
                              ? t("conversations.channels.call")
                              : m.channel === "internal"
                                ? t("conversations.channels.internal")
                                : m.channel === "whatsapp"
                                  ? t("conversations.channels.whatsapp")
                                  : t("conversations.channels.sms")}
                            {m.sent_by_admin_name
                              ? ` · ${m.sent_by_admin_name}`
                              : ""}
                          </div>
                      {m.subject && (
                        <div className="font-semibold mb-1">{m.subject}</div>
                      )}
                          {m.media_url && (
                            <div className="mb-2">
                              {(() => {
                                const src = resolveMediaSrc(m.media_url);
                                const ct = String(m.media_content_type || "");
                                return (
                                  <ConversationMediaThumb
                                    src={src}
                                    contentType={ct}
                                    onOpen={() =>
                                      setMediaPreview({
                                        src,
                                        contentType: ct,
                                        label: t(
                                          "conversations.mediaPreview.attachment",
                                        ),
                                      })
                                    }
                                  />
                                );
                              })()}
                            </div>
                          )}
                          {m.channel === "call" && formatCallDuration(m.call_duration_sec) ? (
                            <div className="text-xs opacity-90 mb-1">
                              {formatCallDuration(m.call_duration_sec)}
                            </div>
                          ) : null}
                          {m.channel === "call" && m.recording_url ? (
                            <div className="mb-2">
                              <audio
                                controls
                                preload="metadata"
                                className="w-full max-w-[260px] h-8"
                              >
                                <source src={resolveCallRecordingSrc(m) || ""} />
                              </audio>
                            </div>
                          ) : null}
                          {m.channel === "call" ? (
                            <ConversationCallInsights message={m} />
                          ) : null}
                          {m.body ? (
                      <div className="whitespace-pre-wrap">{m.body}</div>
                          ) : null}
                          <div className="text-[10px] opacity-70 mt-1 flex flex-wrap items-center gap-x-1">
                            <span>{formatWhen(m.created_at)}</span>
                            {(m.provider_status || m.error_message) && (
                              <>
                                <span aria-hidden>·</span>
                                <ConversationMessageStatus
                                  status={m.provider_status}
                                  errorMessage={m.error_message}
                                  outbound={isOut}
                                />
                              </>
                            )}
                      </div>
                    </div>
                  </div>
                    );
                  })
                )}
              </div>

              {(activeKind === "client" ||
                activeKind === "unknown" ||
                activeKind === "contact") && (
                <div className="shrink-0 border-t border-border">
                  {isThreadClosed && (
                    <div
                      className="px-4 pt-3 pb-0 flex items-start gap-2"
                      data-testid="conversation-closed-banner"
                    >
                      <div className="flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2">
                        <p className="text-xs font-medium text-foreground">
                          {t("conversations.closedBannerTitle")}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {t("conversations.closedBannerBody")}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 shrink-0"
                        onClick={() =>
                          dispatch(
                            setConversationContactStatus({
                              kind: activeKind,
                              contactId: activeId!,
                              status: "open",
                            }),
                          )
                        }
                      >
                        <ArchiveRestore className="h-3.5 w-3.5" />
                        {t("conversations.reopen")}
                      </Button>
                    </div>
                  )}
                  {activeKind === "client" &&
                    channel === "sms" &&
                    threadAlsoTarget && (
                      <div className="px-3 pt-3 pb-2">
                        <ConversationComposeAlsoSend
                          composeTarget={threadAlsoTarget}
                          referrers={threadReferrers}
                          referrersLoading={threadReferrersLoading}
                          selected={threadAlsoRecipients}
                          onChange={setThreadAlsoRecipients}
                          disabled={sending || threadSending}
                        />
                      </div>
                    )}
                  <ConversationMessageComposer
                    collapsible
                    collapseResetKey={`${activeKind}-${activeId}`}
                    channel={channel}
                    onChannelChange={setChannel}
                    body={body}
                    onBodyChange={setBody}
                    templates={templates}
                    mergeContext={mergeContext}
                    attachment={attachment}
                    onAttachmentChange={(next) => {
                      if (!next) clearAttachment();
                      else setAttachment(next);
                    }}
                    onPickMedia={(file) =>
                      pickMedia(file, setAttachment, attachment)
                    }
                    uploadingMedia={uploadingMedia}
                    sending={sending || threadSending}
                    sendError={
                      sendError === "conversation_closed"
                        ? t("conversations.conversationClosedError")
                        : sendError
                    }
                    suggestedReplies={composerSuggestions}
                    onSuggestAi={loadAiSuggestions}
                    aiSuggestionsLoading={aiSuggestionsLoading}
                    allowedChannels={
                      activeKind === "client"
                        ? threadChannels
                        : outboundChannels
                    }
                    onSend={() => void send()}
                  />
                </div>
              )}
            </>
                  )}
                </div>
        )}
      </div>

      <Dialog open={composeOpen} onOpenChange={handleComposeOpenChange}>
        <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden max-h-[90vh] overflow-y-auto">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle>{t("conversations.newMessage")}</DialogTitle>
          </DialogHeader>
          <div className="px-4 pb-2 space-y-3">
            <ConversationComposeTargetPicker
              value={composeTarget}
              onChange={handleComposeTargetChange}
            />
            <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("conversations.composeHelpersTitle")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["composeTipSms", Phone],
                    ["composeTipTemplate", StickyNote],
                    ["composeTipVars", Sparkles],
                    ["composeTipMms", ImagePlus],
                  ] as const
                ).map(([key, Icon]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border bg-card text-muted-foreground"
                  >
                    <Icon className="w-3 h-3 shrink-0" />
                    {t(`conversations.${key}`)}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {composeTarget ? (
            <>
              {composeTarget.kind === "client" && (
                <div className="px-4 pb-2 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("conversations.composeStartersTitle")}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {COMPOSE_STARTER_KEYS.map((key) => {
                      const raw = t(`conversations.${key}`);
                      const preview = applyConversationTemplateVars(
                        raw,
                        buildConversationMergeVars({
                          first_name: composeTarget.client.first_name,
                          last_name: composeTarget.client.last_name,
                          phone: composeTarget.client.phone,
                          portal_url: undefined,
                        }),
                      );
                      return (
                  <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setComposeChannel("sms");
                            setComposeBody(raw);
                          }}
                          className="text-left text-[11px] px-2.5 py-1.5 rounded-lg border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 max-w-full line-clamp-2"
                          title={preview}
                        >
                          {preview.slice(0, 72)}
                          {preview.length > 72 ? "…" : ""}
                  </button>
                      );
                    })}
                </div>
              </div>
              )}
              {composeTarget.kind === "client" && composeChannel === "sms" && (
                <div className="px-4 pb-2">
                  <ConversationComposeAlsoSend
                    composeTarget={composeTarget}
                    referrers={composeReferrers}
                    referrersLoading={composeReferrersLoading}
                    selected={composeAlsoRecipients}
                    onChange={setComposeAlsoRecipients}
                    disabled={sending || composeSending}
                    defaultExpanded
                  />
                </div>
              )}
              <ConversationMessageComposer
                channel={composeChannel}
                onChannelChange={setComposeChannel}
                allowedChannels={
                  composeTarget.kind === "client"
                    ? threadChannels
                    : outboundChannels
                }
                body={composeBody}
                onBodyChange={setComposeBody}
                templates={templates}
                mergeContext={
                  composeTarget.kind === "client"
                    ? {
                        first_name: composeTarget.client.first_name,
                        last_name: composeTarget.client.last_name,
                        phone: composeTarget.client.phone,
                        pipeline_stage: (composeTarget.client as any)
                          .pipeline_stage,
                        client_status: (composeTarget.client as any).status,
                      }
                    : composeTarget.kind === "contact"
                      ? {
                          first_name: composeTarget.contact.first_name,
                          last_name: composeTarget.contact.last_name,
                          phone: composeTarget.contact.phone,
                          pipeline_stage: "",
                          client_status: "",
                        }
                      : {
                          first_name: "",
                          last_name: "",
                          phone: composeTarget.phone,
                          pipeline_stage: "unknown",
                          client_status: "unknown",
                        }
                }
                suggestedReplies={
                  composeTarget.kind === "phone"
                    ? buildStaticConversationSuggestions({
                        kind: "unknown",
                        mergeContext: {
                          first_name: "",
                          last_name: "",
                          phone: composeTarget.phone,
                          pipeline_stage: "unknown",
                          client_status: "unknown",
                        },
                        pipelineStage: "unknown",
                        clientStatus: "unknown",
                      })
                    : []
                }
                attachment={composeAttachment}
                onAttachmentChange={(next) => {
                  if (!next) clearComposeAttachment();
                  else setComposeAttachment(next);
                }}
                onPickMedia={(file) =>
                  pickMedia(file, setComposeAttachment, composeAttachment)
                }
                uploadingMedia={uploadingMedia}
                sending={sending || composeSending}
                sendError={
                  sendError === "conversation_closed"
                    ? t("conversations.conversationClosedError")
                    : sendError
                }
                onSend={() => void sendCompose()}
                footerStart={
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-4 rounded-xl"
                    onClick={() => setComposeOpen(false)}
                  >
                    {t("conversations.cancel")}
                  </Button>
                }
              />
            </>
          ) : (
            <div className="px-4 pb-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("conversations.composePickRecipient")}
              </p>
              <Button variant="outline" onClick={() => setComposeOpen(false)}>
                {t("conversations.cancel")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ClientPanelSheet
        open={
          panelOpen &&
          (activeKind === "client" || completeProfileClientId != null)
        }
        caseId={null}
        clientId={
          completeProfileClientId ??
          (activeKind === "client" ? activeId : null)
        }
        onClose={() => {
          setPanelOpen(false);
          setCompleteProfileClientId(null);
        }}
        onCaseUpdated={() => {
          const cid =
            completeProfileClientId ??
            (activeKind === "client" ? activeId : null);
          if (cid) {
            dispatch(fetchConversationTimeline({ kind: "client", id: cid }));
          }
        }}
      />

      <ConversationMediaLightbox
        item={mediaPreview}
        onClose={() => setMediaPreview(null)}
      />

      <ConversationVoiceSettingsModal
        open={voiceSettingsOpen}
        onOpenChange={setVoiceSettingsOpen}
      />

      {isDialerOpen && (
        <div
          className={cn(
            "fixed z-50 animate-in duration-300",
            // iPhone Safari: bottom sheet so Call stays above the home indicator
            "inset-x-0 bottom-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
            "sm:inset-x-auto sm:bottom-6 sm:right-6 sm:p-0 sm:w-80 sm:animate-in sm:slide-in-from-bottom-4",
          )}
        >
          <div className="bg-card border border-border shadow-2xl rounded-2xl overflow-hidden max-h-[min(85dvh,40rem)] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <PhoneCall className="h-4 w-4 text-primary" />
        </div>
                <p className="text-sm font-semibold text-foreground">
                  {t("conversations.voice.dialpadTitle")}
                </p>
      </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setIsDialerOpen(false);
                  setDialerNumber("");
                  setDialerClient(null);
                }}
                aria-label={t("conversations.cancel")}
              >
                <PhoneOff className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="px-4 pt-3 pb-2 space-y-2 shrink-0 border-b border-border/40">
              <ClientSearchPicker
                value={dialerClient}
                onChange={(client) => {
                  setDialerClient(client);
                  if (client?.phone) {
                    setDialerNumber(String(client.phone));
                  } else if (client && !client.phone) {
                    toast({
                      title: t("conversations.voice.dialpadNoClientPhone"),
                      variant: "destructive",
                    });
                  }
                }}
                placeholder={t("conversations.voice.dialpadSearchClient")}
              />
              <div className="flex items-center gap-2 bg-muted rounded-xl px-4 py-3">
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={dialerNumber}
                  onChange={(e) => {
                    setDialerNumber(e.target.value);
                    if (dialerClient) setDialerClient(null);
                  }}
                  placeholder={t("conversations.voice.dialpadPlaceholder")}
                  className="flex-1 bg-transparent text-lg font-mono tracking-wider text-foreground outline-none placeholder:text-muted-foreground/50"
                />
                {dialerNumber && (
                  <button
                    type="button"
                    onClick={() => {
                      setDialerNumber((n) => n.slice(0, -1));
                      setDialerClient(null);
                    }}
                    className="p-1 rounded hover:bg-muted-foreground/10 transition-colors"
                    aria-label={t("conversations.voice.dialpadBackspace")}
                  >
                    <Delete className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-y-auto overscroll-contain flex-1 min-h-0">
              <div className="px-4 py-2">
                {[
                  ["1", "2", "3"],
                  ["4", "5", "6"],
                  ["7", "8", "9"],
                  ["*", "0", "#"],
                ].map((row, rowIdx) => (
                  <div key={rowIdx} className="grid grid-cols-3 gap-2 mb-2">
                    {row.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setDialerNumber((n) => n + key);
                          setDialerClient(null);
                        }}
                        className="flex flex-col items-center justify-center h-14 rounded-xl bg-muted hover:bg-muted/70 active:scale-95 transition-all duration-100 select-none"
                      >
                        <span className="text-lg font-semibold text-foreground leading-none">
                          {key}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="px-4 pt-2 pb-4 border-t border-border/60 shrink-0 bg-card space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="h-12 rounded-xl gap-2 text-base font-semibold"
                  disabled={!dialerNumber.trim()}
                  onClick={() => {
                    const normalized = normalizeContactPhone(dialerNumber);
                    if (!normalized && dialerNumber.replace(/\D/g, "").length < 10) {
                      toast({
                        title: t("conversations.voice.validationPhone"),
                        variant: "destructive",
                      });
                      return;
                    }
                    const phone =
                      normalized?.phone ?? dialerNumber.trim();
                    if (dialerClient?.id) {
                      setComposeTarget({
                        kind: "client",
                        client: dialerClient,
                      });
                    } else {
                      setComposeTarget({
                        kind: "phone",
                        phone,
                        label: normalized?.label ?? phone,
                      });
                    }
                    setComposeChannel("sms");
                    setComposeOpen(true);
                    setIsDialerOpen(false);
                    setDialerNumber("");
                    setDialerClient(null);
                  }}
                >
                  <MessageSquare className="h-5 w-5" />
                  {t("conversations.phoneActions.text")}
                </Button>
                <Button
                  className="h-12 rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground gap-2 text-base font-semibold shadow-md"
                  disabled={!dialerNumber.trim()}
                  onClick={() => {
                    if (dialerNumber.trim()) setIsDialerCallActive(true);
                  }}
                >
                  <Phone className="h-5 w-5" />
                  {t("conversations.voice.call")}
                </Button>
              </div>
              {!isAvailable && (
                <p className="text-[11px] text-muted-foreground text-center leading-snug">
                  {t("conversations.voice.dialpadNeedAvailable")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

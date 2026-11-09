/**
 * Shared API types (client + server)
 */

// ============================================================
// AUTH
// ============================================================
export interface ClientUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  pipeline_stage: PipelineStage;
  status: ClientStatus;
  package_id?: number | null;
  package_name?: string | null;
  contract_signed_at?: string | null;
  smart_credit_connected_at?: string | null;
  email_verified_at?: string | null;
  preferred_language?: "en" | "es" | null;
  created_at: string;
}

export interface AdminUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  role: "super_admin" | "admin" | "support" | "agent" | "affiliate" | "underwriter";
  status: "active" | "suspended" | "invited" | "inactive";
  /** Admin UI/comms language preference (not client ownership) */
  preferred_language?: "en" | "es" | null;
  /** Present when role=affiliate */
  affiliate?: AffiliateProfile | null;
  /** Present when role=affiliate — whether their portal (pipeline/leads) is unlocked */
  has_portal_access?: boolean;
  /**
   * Admin AI Ask UI (server ADMIN_AI_ENABLED + role super_admin|admin).
   * Live CRM tools roll out separately; chat may still answer process questions.
   */
  ai_ask_enabled?: boolean;
  /** Conversations module: staff has at least one active assigned OFG Twilio number */
  conversations_enabled?: boolean;
  /** Assigned OFG numbers (E.164) for SMS send / OTP SMS option */
  assigned_phone_numbers?: AdminPhoneNumber[];
  /** Can choose SMS OTP on login when true */
  otp_sms_available?: boolean;
  /**
   * Social DM inbox (FB/IG) ready for live threads.
   * False until SOCIAL_DM_INBOX_ENABLED + Meta credentials are set.
   */
  social_dm_enabled?: boolean;
  /** Scaffold status for Social DM UI (locked / coming soon vs live). */
  social_dm_mode?: "disabled" | "needs_credentials" | "ready" | "live";
  /**
   * WhatsApp (360dialog) for this admin — César assignee when
   * WHATSAPP_360DIALOG_ENABLED + D360_API_KEY and profile/(env) match.
   */
  whatsapp_enabled?: boolean;
}

/** One turn in Admin AI Ask (client ↔ API). */
export interface AdminAiChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AdminAiChatContext {
  case_id?: number | null;
  case_number?: string | null;
  client_id?: number | null;
}

export interface AdminAiChatRequest {
  messages: AdminAiChatMessage[];
  context?: AdminAiChatContext | null;
}

export interface AdminAiCitation {
  type: "pipeline" | "case" | "client" | "tasks" | "other";
  label?: string;
  href: string;
}

export interface AdminAiChatResponse {
  reply: string;
  citations: AdminAiCitation[];
  tools_used: string[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Operational alert types admins can mute per channel (OTP/welcome never included). */
export type AdminNotifyEventKey =
  | "purchase_enrollment"
  | "payment_installment"
  | "submission_ready_review"
  | "submission_doc_upload"
  | "submission_info_request"
  | "doc_upload_link"
  | "round_calendar"
  | "work_task_assigned"
  | "work_task_overdue"
  | "inbound_sms"
  | "missed_call"
  | "voicemail"
  | "call_transcript"
  | "funding_doc_upload"
  | "funding_application_created"
  | "get_credit_report_lead"
  | "event_registration"
  | "prospect_temperature"
  | "progress_report_alerts"
  | "credit_analysis_review"
  | "morning_digest";

export type AdminNotifyChannel = "email" | "in_app" | "sms";

export type AdminNotifyEventToggles = Record<AdminNotifyEventKey, boolean>;

export interface AdminNotificationPrefs {
  email: AdminNotifyEventToggles;
  in_app: AdminNotifyEventToggles;
  sms: AdminNotifyEventToggles;
}

export interface AdminNotificationChannelMeta {
  available: boolean;
  /** Why toggles are locked (e.g. Twilio not configured). */
  disabled_reason?: string | null;
}

export interface AdminNotificationPrefsResponse {
  prefs: AdminNotificationPrefs;
  channels: Record<AdminNotifyChannel, AdminNotificationChannelMeta>;
  events: AdminNotifyEventKey[];
}

export interface AdminInAppNotification {
  id: number;
  event_key: string;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AdminInAppNotificationsResponse {
  notifications: AdminInAppNotification[];
  unread_count: number;
}

export type PipelineStage =
  | "prospect"
  | "new_client"
  | "docs_ready"
  | "round_1"
  | "round_2"
  | "round_3"
  | "round_4"
  | "round_5"
  | "completed"
  | "cancelled";

export type ClientStatus =
  | "prospect"
  | "funding"
  | "pending_payment"
  | "onboarding"
  | "active"
  | "paused"
  | "blocked"
  | "cancelled";

// ============================================================
// PACKAGES + REGISTRATION
// ============================================================
export type PackageCheckoutType =
  | "fixed_price"
  | "tradeline_picker"
  | "subscription";

export interface CreditPackage {
  id: number;
  slug: string;
  name: string;
  subtitle?: string | null;
  description?: string | null;
  price_cents: number;
  compare_price_cents?: number | null;
  billing_interval?: "one_time" | "monthly";
  checkout_type?: PackageCheckoutType;
  duration_months: number;
  features_json?: any;
  sort_order: number;
}

export interface TradelineProduct {
  id: number;
  slug: string;
  name: string;
  details: string;
  price_cents: number;
  compare_price_cents?: number | null;
  is_active?: number | boolean;
  sort_order: number;
}

export interface ClientTradelineSelection {
  id: number;
  payment_id: number;
  tradeline_product_id: number;
  product_name: string;
  product_details: string;
  price_cents: number;
  created_at?: string;
}

export interface TradelineProductInput {
  slug: string;
  name: string;
  details: string;
  price_cents: number;
  compare_price_cents?: number | null;
  is_active?: boolean;
  sort_order?: number;
}

export interface RegistrationPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  packageSlug: string;
  tradelineProductIds?: number[];
  // Accept.js nonce — required when amount due > 0; omitted for $0 (100% coupon)
  dataDescriptor?: string;
  dataValue?: string;
  // Collected later during portal onboarding:
  affiliateCode?: string;
  // Optional promotional coupon code
  coupon_code?: string;
}

export interface ClientSubscription {
  id: number;
  package_id: number;
  package_name: string;
  package_slug: string;
  anet_subscription_id: string;
  status: "active" | "cancelled" | "suspended" | "expired";
  amount_cents: number;
  billing_interval: "monthly";
  started_at: string;
  cancelled_at?: string | null;
  next_billing_at?: string | null;
}

export interface PeaceOfMindPlan {
  package: CreditPackage;
  eligible: boolean;
  eligibility_reason?: string;
  has_stored_card?: boolean;
  subscription: ClientSubscription | null;
}

export interface RegistrationResponse {
  clientId: number;
  packageId: number;
  packageName: string;
  amountCents: number;
}

// ============================================================
// DOCUMENTS
// ============================================================
export type DocType =
  | "id_front"
  | "id_back"
  | "ssn_card"
  | "proof_of_address"
  | "other"
  | "funding_drivers_license"
  | "funding_corp_statement"
  | "funding_bank_m1"
  | "funding_bank_m2"
  | "funding_bank_m3"
  | "funding_bank_m4"
  | "funding_bank_m5"
  | "funding_bank_m6";

export type FundingType = "credit_card_stacking" | "bank_statements";

export type FundingApplicationStatus =
  | "draft"
  | "awaiting_docs"
  | "submitted"
  | "under_review"
  | "complete"
  | "converted"
  | "cancelled";

export type FundingDocSlot =
  | "funding_drivers_license"
  | "funding_corp_statement"
  | "funding_bank_m1"
  | "funding_bank_m2"
  | "funding_bank_m3"
  | "funding_bank_m4"
  | "funding_bank_m5"
  | "funding_bank_m6";

export const FUNDING_REQUIRED_DOC_SLOTS: FundingDocSlot[] = [
  "funding_drivers_license",
  "funding_corp_statement",
  "funding_bank_m1",
  "funding_bank_m2",
  "funding_bank_m3",
  "funding_bank_m4",
  "funding_bank_m5",
  "funding_bank_m6",
];

export interface FundingApplication {
  id: number;
  public_token?: string;
  funding_type: FundingType;
  status: FundingApplicationStatus;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  postal_code?: string | null;
  state?: string | null;
  preferred_language: "en" | "es";
  llc_name?: string | null;
  llc_address?: string | null;
  client_id?: number | null;
  has_secrets?: boolean;
  docs_uploaded?: FundingDocSlot[];
  docs_complete?: boolean;
  docs_complete_notified_at?: string | null;
  submitted_at?: string | null;
  converted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AdminFundingQuery {
  search?: string;
  funding_type?: FundingType | "all";
  language?: "en" | "es" | "all";
  limit?: number;
  column?: string;
  offset?: number;
}

export interface AdminFundingBoardResponse {
  applications: FundingApplication[];
  limit?: number;
  columns?: Record<string, PipelineColumnPage<FundingApplication>>;
}

export interface AdminFundingColumnMoreResponse {
  column: string;
  items: FundingApplication[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface ClientDocument {
  id: number;
  client_id: number;
  doc_type: DocType;
  file_name: string;
  file_size?: number;
  mime_type?: string;
  review_status: "pending" | "approved" | "rejected";
  rejection_reason?: string | null;
  uploaded_at: string;
  reviewed_at?: string | null;
  funding_application_id?: number | null;
}

// ============================================================
// REPORTS / TICKETS / CONVERSATIONS / CHAT
// ============================================================
export interface RoundReportPdf {
  id: number;
  client_id: number;
  round_number: number;
  round_report_id?: number | null;
  file_name: string;
  uploaded_at: string;
}

export interface RoundReport {
  id: number;
  round_number: number;
  score_before?: number | null;
  score_after?: number | null;
  items_removed: number;
  items_disputed: number;
  summary_md?: string | null;
  created_at: string;
  /** PDFs uploaded by admin for this round */
  pdfs: RoundReportPdf[];
  /** Legacy single-PDF fields (kept for backward compat) */
  pdf_file_name?: string | null;
  has_pdf?: boolean | 0 | 1;
  pdf_uploaded_at?: string | null;
}

export interface SupportTicket {
  id: number;
  subject: string;
  body?: string;
  category?: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "waiting_client" | "resolved" | "closed";
  created_at: string;
  updated_at: string;
}

export interface TicketReply {
  id: number;
  author_type: "client" | "admin" | "system";
  author_admin_id?: number | null;
  author_client_id?: number | null;
  body: string;
  is_internal_note?: number;
  created_at: string;
}

export interface SupportFaq {
  id: number;
  question: string;
  answer: string;
  category: "billing" | "documents" | "process" | "technical" | "general";
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface AdminPhoneNumber {
  id: number;
  e164: string;
  friendly_name?: string | null;
  twilio_sid?: string | null;
  assigned_admin_id?: number | null;
  assigned_admin_name?: string | null;
  is_active: boolean;
  capabilities?: { sms?: boolean; mms?: boolean; voice?: boolean } | null;
}

/** Contact-centric inbox row (aggregates channel threads for one client or unknown). */
export interface ConversationContactHubItem {
  kind: "client" | "unknown" | "contact";
  /** clients.id, conversation_unknown_contacts.id, or contacts.id */
  contact_id: number;
  display_name: string;
  phone?: string | null;
  email?: string | null;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  unread_count: number;
  status: "open" | "snoozed" | "closed" | "archived";
  assigned_admin_id?: number | null;
  assigned_admin_name?: string | null;
  channels: Array<"sms" | "email" | "call" | "internal" | "whatsapp">;
  /** Primary conversation id for deep links (latest active thread) */
  primary_conversation_id?: number | null;
  client_id?: number | null;
  unknown_contact_id?: number | null;
  /** CRM contacts.id when kind === "contact" */
  crm_contact_id?: number | null;
  pipeline_stage?: string | null;
  client_status?: string | null;
}

export interface Conversation {
  id: number;
  client_id: number | null;
  unknown_contact_id?: number | null;
  contact_id?: number | null;
  ofg_number_id?: number | null;
  channel: "sms" | "call" | "email" | "internal" | "whatsapp";
  status: "open" | "snoozed" | "closed" | "archived";
  last_message_at?: string | null;
  last_message_preview?: string | null;
  unread_count: number;
  assigned_admin_id?: number | null;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

export interface ConversationMessage {
  id: number;
  conversation_id?: number;
  direction: "inbound" | "outbound" | "internal" | "system";
  channel: string;
  body: string;
  media_url?: string | null;
  media_content_type?: string | null;
  subject?: string | null;
  from_address?: string | null;
  to_address?: string | null;
  sent_by_admin_id?: number | null;
  sent_by_admin_name?: string | null;
  provider_message_id?: string | null;
  provider_status?: string | null;
  error_message?: string | null;
  call_duration_sec?: number | null;
  recording_url?: string | null;
  metadata_json?: Record<string, unknown> | null;
  call_insights_status?:
    | "pending"
    | "processing"
    | "ready"
    | "failed"
    | "skipped"
    | null;
  call_insights_error?: string | null;
  call_transcript?: string | null;
  call_insights_json?: {
    locale?: "en" | "es";
    summary_bullets?: string[];
    sentiment?: {
      label?: string;
      score?: number;
      feelings?: string[];
    };
    topics?: string[];
    action_items?: string[];
    risk_flags?: string[];
    interesting?: string[];
    model?: string;
    generated_at?: string;
  } | null;
  created_at: string;
}

export interface AiChatSession {
  id: number;
  title?: string;
  language: string;
  created_at: string;
  updated_at: string;
}

export interface AiChatMessage {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface EducationalVideo {
  id: number;
  title: string;
  content_type: "video" | "pdf" | "image" | "article";
  description?: string | null;
  video_url?: string | null;
  file_url?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  category?: string | null;
  language: string;
  is_published?: number;
  sort_order?: number;
  created_at?: string;
}

// ============================================================
// ADMIN
// ============================================================
export interface AdminClientListItem {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone?: string | null;
  pipeline_stage: PipelineStage;
  pipeline_stage_changed_at?: string | null;
  /**
   * Real round for `round_5` clients: 5, or 6–24 in an extended program
   * (from published reports + case max_rounds). Null for other stages.
   */
  effective_round?: number | null;
  status: ClientStatus;
  created_at: string;
  package_name?: string | null;
  package_slug?: string | null;
  // CRC integration
  crc_client_id?: string | null;
  crc_synced_at?: string | null;
  // language preference
  preferred_language?: "en" | "es" | null;
  // task counts (from pipeline endpoint)
  tasks_total?: number;
  tasks_required_total?: number;
  tasks_approved?: number;
  tasks_pending_review?: number;
  tasks_rejected?: number;
  // admin notes
  admin_notes?: string | null;
  // referral attribution
  referral_category?:
    | "realtor_broker"
    | "one_off"
    | "affiliate_partner"
    | null;
  referrer_id?: number | null;
  /** Up to 3 linked partners (when loaded by detail endpoints). */
  referrers?: ClientReferrerLink[];
  smart_credit_email?: string | null;
  myfreescorenow_email?: string | null;
  /** True when encrypted CMS passwords are stored (never returns plaintext in lists). */
  cms_credentials_stored?: boolean;
  // payment summary (from clients list endpoint)
  total_paid_cents?: number;
  payment_count?: number;
  splits_total?: number;
  splits_paid?: number;
  splits_pending?: number;
  splits_overdue?: number;
  splits_amount_cents?: number;
  splits_paid_cents?: number;
  // labels (source + analysis)
  labels?: Label[];
}

export type ReferralCategory =
  | "realtor_broker"
  | "one_off"
  | "affiliate_partner";

export interface AdminReferrer {
  id: number;
  category: ReferralCategory;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  affiliate_id?: number | null;
  preferred_language?: "en" | "es" | null;
  notes?: string | null;
  status: string;
  created_at?: string;
}

export type ClientReferrerRole = "primary" | "secondary" | "tertiary";

/** Junction row: partner linked to a client (max 3). */
export interface ClientReferrerLink {
  id: number;
  client_id: number;
  referrer_id: number;
  role: ClientReferrerRole;
  sort_order: number;
  notify_on_round: boolean;
  referrer?: AdminReferrer;
}

export type ProgressReportAlertType =
  | "personal_info_mismatch"
  | "closed_still_reporting"
  | "hard_inquiry_open";

export interface ProgressReportAlert {
  type: ProgressReportAlertType;
  severity: "warning" | "critical";
  title: string;
  detail: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface ClientCmsCredentialsPublic {
  smart_credit_email: string | null;
  myfreescorenow_email: string | null;
  has_smart_credit_password: boolean;
  has_myfreescorenow_password: boolean;
}

export interface ClientCmsCredentialsSecrets {
  smart_credit?: {
    email?: string | null;
    password?: string | null;
  };
  myfreescorenow?: {
    email?: string | null;
    password?: string | null;
  };
}

/** Gated MFSN affiliate API probe (no consumer ingest). */
export type MfsnIntegrationMode =
  | "disabled"
  | "needs_credentials"
  | "ready_to_probe";

export interface MfsnIntegrationStatus {
  enabled: boolean;
  credentials_present: boolean;
  client_token_present: boolean;
  base_url: string | null;
  mode: MfsnIntegrationMode;
  warnings: string[];
}

export interface MfsnProbeLoginResponse {
  success: boolean;
  http_status: number;
  message: string;
  token_received: boolean;
}

// ============================================================
// CREDIT REPAIR CASES
// ============================================================
export interface CreditRepairCase {
  /** credit_repair_cases.id (case primary key) */
  id: number;
  /** e.g. "CR-00001" */
  case_number: string;
  client_id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  package_id?: number | null;
  package_name?: string | null;
  package_slug?: string | null;
  crc_client_id?: string | null;
  crc_synced_at?: string | null;
  preferred_language?: "en" | "es" | null;
  pipeline_stage: PipelineStage;
  pipeline_stage_changed_at?: string | null;
  /** Max OFG progress rounds (5 default; up to 24 for special clients). */
  max_rounds?: number;
  /** Optional next dispute target date (extended rounds calendar). */
  next_dispute_target_date?: string | null;
  /** baseline (default) = vs enrollment; chain = vs prior After. */
  report_compare_mode?: ReportCompareMode;
  /** Highest published client_round_reports.round_number for this client. */
  highest_published_round?: number | null;
  /** Pipeline legend when max_rounds > 5, e.g. "Special · R6/8". */
  extended_rounds_legend?: string | null;
  /** active | completed | cancelled | on_hold */
  status: "active" | "completed" | "cancelled" | "on_hold";
  client_status: string;
  created_at: string;
  tasks_total?: number;
  tasks_required_total?: number;
  tasks_approved?: number;
  tasks_pending_review?: number;
  tasks_rejected?: number;
  /** Other active cases for the same client (duplicate case rows) */
  sibling_active_cases?: number;
  sibling_case_numbers?: string[];
  /** Open + rejected info requests awaiting client action */
  info_requests_open?: number;
  /** Submitted info requests awaiting staff review */
  info_requests_pending_review?: number;
  /** True when client has a succeeded payment or paid split */
  is_payment_received?: boolean | number;
  // labels (source + analysis)
  labels?: Label[];
}

// ============================================================
// CREDIT REPAIR CLOUD (CRC)
// ============================================================
export interface CrcSyncLogEntry {
  id: number;
  client_id: number;
  first_name: string;
  last_name: string;
  email: string;
  action: "push_create" | "push_update" | "pull" | "webhook_stage_update";
  crc_client_id?: string | null;
  pipeline_stage?: string | null;
  status: "success" | "error";
  error_message?: string | null;
  created_at: string;
}

export interface CrcStatusResponse {
  configured: boolean;
}

export interface CrcSyncResponse {
  ok: boolean;
  crc_client_id: string | null;
  crc_synced_at: string | null;
}

export interface AdminClientFormPayload {
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  package_id?: number | null;
  status?: ClientStatus;
}

export interface AdminDashboardStats {
  active_clients: number;
  pending_payments: number;
  pending_doc_reviews: number;
  open_tickets: number;
  revenue_cents_30d: number;
  new_clients_30d: number;
  completed_clients: number;
  avg_score_improvement: number;
}

/** Case panel: one event in a round's progress-report delivery timeline. */
export interface ReportDeliveryEvent {
  type: "generated" | "send" | "opened";
  at: string;
  channel?: "email" | "sms" | "whatsapp";
  recipient_type?: string;
  recipient_name?: string | null;
  /** referrers.category for partner recipients */
  recipient_role?: string | null;
  to?: string;
  /** sent | failed | delivered | undelivered | queued … (SMS = live carrier status) */
  status?: string;
  error?: string | null;
  by?: string | null;
  resend?: boolean;
  open_count?: number;
  /** when the download link was issued */
  first_at?: string | null;
}

export interface ReportDeliveryRound {
  events: ReportDeliveryEvent[];
  summary: {
    sends: number;
    failed: number;
    delivered: number;
    recipients: number;
    opened: number;
    last_opened_at: string | null;
    last_sent_at: string | null;
  };
}

/** Dashboard "Needs you" row (only non-zero counts are returned). */
export interface AdminDashboardInboxItem {
  key:
    | "reports_approval"
    | "tasks_overdue"
    | "analyses_review"
    | "conversations_unread"
    | "docs_review"
    | "rounds_due"
    | "tickets_open"
    | "payments_pending";
  count: number;
  tone: "alert" | "warn" | "info";
  to: string;
}

/** One Monday-start week of the dashboard pulse (revenue is 0 for non super admins). */
export interface AdminDashboardPulseWeek {
  week: string;
  new_clients: number;
  enrolled: number;
  completed: number;
  revenue_cents: number;
}

export interface AdminDashboardActivity {
  kind: "client" | "contract" | "document" | "report" | "analysis" | "payment";
  at: string;
  client_id: number;
  name: string;
  /** client status, doc type, round number or amount in cents (by kind) */
  detail: string | null;
}

export interface AdminDashboardTicket {
  id: number;
  subject: string;
  status: "open" | "in_progress" | "waiting_client";
  priority: "low" | "normal" | "high" | "urgent";
  category: string;
  created_at: string;
  first_name: string;
  last_name: string;
  client_id: number;
}

export interface AdminDashboardPayment {
  id: number;
  amount_cents: number;
  status: string;
  paid_at: string | null;
  created_at: string;
  first_name: string;
  last_name: string;
  client_id: number;
}

export interface AdminDashboardUpcomingRound {
  id: string;
  case_id: number;
  case_number: string | null;
  client_id: number;
  first_name: string;
  last_name: string;
  round_number: number;
  target_date: string;
  days_until: number;
  /** schedule = case_round_schedules R1–5; extended = next_dispute_target_date */
  kind?: "schedule" | "extended";
  label?: string;
}

export interface ConversationTemplate {
  id: number;
  name: string;
  channel: "sms" | "email" | "internal";
  subject?: string | null;
  body: string;
  variables?: string[];
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface CommunicationTemplate {
  id: number;
  slug: string;
  name: string;
  channel: "email" | "sms" | "in_app";
  subject?: string | null;
  body: string;
  variables_json?: any;
  is_active: number;
  updated_at: string;
}

export interface SystemSetting {
  setting_key: string;
  setting_value: string | null;
  description?: string | null;
  updated_at: string;
}

/** Settings → Notifications: email-only recipients (need not be admins). */
export interface AdminNotifyExtraEmail {
  id: number;
  email: string;
  label: string | null;
  is_active: boolean;
  /** null = all events; otherwise only these event keys. */
  events?: AdminNotifyEventKey[] | null;
  created_at?: string;
  updated_at?: string;
}

/** Settings → Notifications: active staff who receive team alerts. */
export interface AdminNotifyStaffRecipient {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  phone: string | null;
  prefs: AdminNotificationPrefs;
  channels: Record<AdminNotifyChannel, AdminNotificationChannelMeta>;
}

export interface AdminNotifyRecipientsResponse {
  staff: AdminNotifyStaffRecipient[];
  extras: AdminNotifyExtraEmail[];
  events: AdminNotifyEventKey[];
}

export interface SectionLock {
  id: number;
  section_key: string;
  label: string;
  is_locked: boolean;
  lock_reason: string | null;
  updated_by_admin_id: number | null;
  updated_at: string;
}

// ============================================================
// PAGINATION
// ============================================================
export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ============================================================
// ADMIN TEAM
// ============================================================
export interface AdminUserListItem {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  role: "super_admin" | "admin" | "agent" | "affiliate" | "underwriter";
  status: "active" | "inactive" | "suspended";
  /** Admin UI/comms language preference */
  preferred_language?: "en" | "es" | null;
  /** Client/task language this admin owns (routing); at most one admin per en|es */
  language_owner_for?: "en" | "es" | null;
  last_login_at?: string | null;
  created_at: string;
}

// ============================================================
// AFFILIATES
// ============================================================
export type AffiliatePlan = "standard" | "master" | "sub_affiliate";
export type AffiliateLanding = "credit_analysis" | "pricing";
export type AffiliateStatus = "invited" | "active" | "inactive" | "suspended";
export type AffiliateSubscriptionStatus =
  | "none"
  | "pending"
  | "active"
  | "past_due"
  | "cancelled"
  | "comped";
export type AffiliateCommissionKind = "enrollment" | "override" | "manual";
export type AffiliateCommissionStatus =
  | "pending"
  | "approved"
  | "paid"
  | "void";

export interface AffiliateProfile {
  id: number;
  admin_id?: number | null;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  plan: AffiliatePlan;
  monthly_price_cents: number;
  commission_rate_bps: number;
  parent_override_rate_bps: number;
  parent_affiliate_id?: number | null;
  status: AffiliateStatus;
  subscription_status: AffiliateSubscriptionStatus;
  referral_code: string;
  slug: string;
  default_landing: AffiliateLanding;
  bio?: string | null;
  notes?: string | null;
  has_portal_access: boolean;
  parent_name?: string | null;
  leads_count?: number;
  clicks_count?: number;
  commissions_pending_cents?: number;
  /** Admin list endpoint aggregates */
  clients_count?: number;
  sub_affiliates_count?: number;
  commissions_total_cents?: number;
  created_at: string;
  updated_at?: string;
}

export interface AffiliateLinks {
  short_default: string;
  short_analysis: string;
  short_pricing: string;
  analysis_ref: string;
  pricing_ref: string;
}

export interface AffiliatePublicResolve {
  slug: string;
  first_name: string;
  default_landing: AffiliateLanding;
  redirect_path: string;
  links: AffiliateLinks;
}

export interface AffiliateSubAffiliateSummary {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  slug: string;
  status: AffiliateStatus;
  subscription_status: AffiliateSubscriptionStatus;
}

export interface AffiliateReferredClient {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  pipeline_stage: string;
  created_at: string;
}

export interface AffiliateDetailResponse {
  affiliate: AffiliateProfile;
  links: AffiliateLinks;
  sub_affiliates: AffiliateSubAffiliateSummary[];
  clients: AffiliateReferredClient[];
}

export interface AffiliateSelfStats {
  clicks_total: number;
  referred_clients: number;
  commissions_pending_cents: number;
  commissions_earned_cents: number;
}

export interface AffiliateMeResponse {
  affiliate: AffiliateProfile;
  links: AffiliateLinks;
  stats: AffiliateSelfStats;
}

export interface AffiliateTierSuggestion {
  monthly_price_cents: number;
  commission_rate_bps: number;
  parent_override_rate_bps: number;
}

export interface AffiliateSuggestionsResponse {
  suggestions: Record<AffiliatePlan, AffiliateTierSuggestion>;
  features: Record<string, boolean>;
}

export interface UpdateAffiliatePayload {
  id: number;
  slug?: string;
  plan?: AffiliatePlan;
  monthly_price_cents?: number;
  commission_rate_bps?: number;
  parent_override_rate_bps?: number;
  parent_affiliate_id?: number | null;
  default_landing?: AffiliateLanding;
  status?: AffiliateStatus;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  bio?: string | null;
  notes?: string | null;
}

export interface AffiliateSelfUpdatePayload {
  default_landing?: AffiliateLanding;
  bio?: string | null;
  phone?: string | null;
  social_facebook?: string | null;
  social_instagram?: string | null;
  social_tiktok?: string | null;
  social_linkedin?: string | null;
}

export interface AffiliateLeadPayload {
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
}

export interface CreateAffiliatePayload {
  email: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  plan: AffiliatePlan;
  slug?: string;
  default_landing?: AffiliateLanding;
  parent_affiliate_id?: number | null;
  commission_rate_bps?: number;
  parent_override_rate_bps?: number;
  monthly_price_cents?: number;
  /** Activate without payment */
  comp_subscription?: boolean;
  notes?: string | null;
}

export type AffiliateInviteLinkKind = "evergreen" | "one_time";
export type AffiliateInvitePathMode = "token" | "auto" | "custom";

export interface AffiliateInviteLink {
  id: number;
  token: string;
  /** Human-readable path segment when set; join_url uses slug || token */
  slug: string | null;
  kind: AffiliateInviteLinkKind;
  label: string | null;
  plan: AffiliatePlan;
  parent_affiliate_id: number | null;
  parent_name?: string | null;
  is_enabled: boolean;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  created_by_admin_id: number;
  last_used_at: string | null;
  created_at: string;
  /** Absolute public join URL */
  join_url: string;
}

export interface CreateAffiliateInviteLinkPayload {
  kind: AffiliateInviteLinkKind;
  label?: string | null;
  plan: AffiliatePlan;
  parent_affiliate_id?: number | null;
  expires_at?: string | null;
  /** token = opaque URL; auto = from admin name; custom = provided slug */
  path_mode?: AffiliateInvitePathMode;
  slug?: string | null;
}

export interface UpdateAffiliateInviteLinkPayload {
  is_enabled?: boolean;
  label?: string | null;
  path_mode?: AffiliateInvitePathMode;
  slug?: string | null;
}

export interface AffiliateInvitePublicResolve {
  /** Opaque token is intentionally omitted from public resolve (join uses the URL path key). */
  slug: string | null;
  plan: AffiliatePlan;
  label: string | null;
  parent_name: string | null;
  is_open: boolean;
}

export interface AffiliateInviteJoinPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  agreed_terms: boolean;
  agreed_sms: boolean;
}

export interface AffiliateInviteJoinResponse {
  ok: boolean;
  login_url: string;
  email: string;
  affiliate_id?: number;
}

export interface AffiliateCommission {
  id: number;
  affiliate_id: number;
  client_id?: number | null;
  payment_id?: number | null;
  source_affiliate_id?: number | null;
  kind: AffiliateCommissionKind;
  amount_cents: number;
  rate_bps?: number | null;
  base_amount_cents?: number | null;
  status: AffiliateCommissionStatus;
  notes?: string | null;
  paid_at?: string | null;
  created_at: string;
  client_name?: string | null;
}

// ============================================================
// REMINDER FLOWS
// ============================================================
export type ReminderFlowTriggerEvent =
  | "payment_confirmed"
  | "docs_ready"
  | "round_1_complete"
  | "round_2_complete"
  | "round_3_complete"
  | "round_4_complete"
  | "round_5_complete"
  | "round_extended_complete"
  | "completed"
  | "event_registered";

export type ReportCompareMode = "baseline" | "chain";

export type ReminderFlowStepType = "send_email" | "internal_alert";

export interface ReminderFlowStep {
  id: number;
  flow_id: number;
  step_order: number;
  step_type: ReminderFlowStepType;
  delay_days: number;
  label?: string | null;
  subject?: string | null;
  body?: string | null;
  template_slug?: string | null;
  /** When true (default) and Settings master is on, SMS after email succeeds. */
  also_sms?: number | boolean;
  created_at: string;
  updated_at: string;
}

export interface ReminderFlow {
  id: number;
  name: string;
  description?: string | null;
  trigger_event: ReminderFlowTriggerEvent;
  is_active: number;
  step_count?: number;
  created_at: string;
  updated_at: string;
  steps?: ReminderFlowStep[];
  /** Only run this flow when the client has ALL of these label slugs (empty/undefined = all clients) */
  required_label_slugs?: string[] | null;
}

export interface ReminderFlowExecution {
  id: number;
  flow_id: number;
  client_id: number;
  client_name?: string;
  client_email?: string;
  triggered_at: string;
  status: "completed" | "partial" | "failed";
  steps_executed: number;
  steps_scheduled: number;
  total_steps?: number;
  next_step_label?: string | null;
  next_step_scheduled_for?: string | null;
  error_message?: string | null;
  // present on the global executions list endpoint
  flow_name?: string;
  trigger_event?: string;
}

// ============================================================
// PAYMENTS
// ============================================================
export type PaymentStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "refunded"
  | "cancelled";

export type PaymentProvider = "stripe" | "authorize_net" | "manual";

export interface Payment {
  id: number;
  client_id: number;
  client_first_name?: string | null;
  client_last_name?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  client_pipeline_stage?: PipelineStage | null;
  client_status?: ClientStatus | null;
  package_id?: number | null;
  package_name?: string | null;
  package_slug?: string | null;
  amount_cents: number;
  discount_cents?: number;
  original_amount_cents?: number | null;
  coupon_code?: string | null;
  currency: string;
  status: PaymentStatus;
  provider: PaymentProvider;
  provider_transaction_id?: string | null;
  provider_charge_id?: string | null;
  failure_reason?: string | null;
  paid_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminPaymentsSummary {
  total_count: number;
  succeeded_count: number;
  pending_count: number;
  failed_count: number;
  refunded_count: number;
  total_revenue_cents: number;
  revenue_30d_cents: number;
  revenue_7d_cents: number;
}

export interface AdminClientsListResponse {
  clients: AdminClientListItem[];
  pagination: PaginationInfo;
}

export interface AdminDocumentsStatusCounts {
  all: number;
  pending: number;
  approved: number;
  rejected: number;
}

export interface AdminDocumentsListResponse {
  documents: ClientDocument[];
  pagination: PaginationInfo;
  status_counts: AdminDocumentsStatusCounts;
}

/** GET /api/admin/conversations/ai-stats — how the SMS AI handled texts (Nov 8, 2026). */
export interface ConversationsAiStats {
  days: number;
  /** AI answered on its own (resolve). */
  resolved: number;
  /** Handed to staff. */
  escalated: number;
  /** AI texts that answered (full or partial), excluding "a teammate will follow up" holds. */
  answered: number;
  /** answered / (answered + escalated), 0–100; null when nothing yet. */
  resolve_rate: number | null;
  /** Texts where the AI looked up live data. */
  lookups: number;
  /** Callback tasks the AI created for staff. */
  callbacks: number;
  /** Escalations by reason code, most first. */
  escalated_by_reason: Array<{ reason: string; count: number }>;
}

export interface AdminConversationsListResponse {
  contacts: ConversationContactHubItem[];
  pagination: PaginationInfo;
}

export type AdminClientsListQuery = {
  stage?: string;
  search?: string;
  status?: string;
  language?: string;
  billing?: string;
  joined_from?: string;
  joined_to?: string;
  has_notes?: string;
  labels?: string[];
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_dir?: "ASC" | "DESC";
};

/** CRM address-book contact (independent of pipeline clients). */
export interface AdminCrmContact {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  preferred_language: "en" | "es";
  admin_notes?: string | null;
  assigned_admin_id?: number | null;
  created_by_admin_id?: number | null;
  converted_client_id?: number | null;
  converted_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export type AdminCrmContactsListQuery = {
  search?: string;
  language?: string;
  has_notes?: string;
  /** Include soft-deleted rows (default: exclude). */
  include_deleted?: boolean;
  /** Include converted contacts (default: exclude). */
  include_converted?: boolean;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_dir?: "ASC" | "DESC";
};

export interface AdminCrmContactsListResponse {
  contacts: AdminCrmContact[];
  pagination: PaginationInfo;
}

export type AdminCrmContactWritePayload = {
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  preferred_language?: "en" | "es";
  admin_notes?: string | null;
  /** Soft-warn duplicates; set true to proceed anyway. */
  confirm_duplicate?: boolean;
};

export type ConvertCrmContactPayload = {
  id: number;
  /** Soft-warn phone/email duplicates on clients; set true to proceed. */
  confirm_duplicate?: boolean;
};

export interface ConvertCrmContactResponse {
  ok: boolean;
  contact_id: number;
  client_id: number;
  preferred_language: "en" | "es";
  duplicate_warning?: boolean;
}

export interface AdminTicketsListResponse {
  tickets: SupportTicket[];
  pagination: PaginationInfo;
}

export interface AdminPaymentsResponse {
  payments: Payment[];
  summary: AdminPaymentsSummary;
  pagination: PaginationInfo;
}

export type SubscriptionStatus =
  | "active"
  | "cancelled"
  | "suspended"
  | "expired";

export interface AdminSubscriptionListItem {
  id: number;
  client_id: number;
  client_first_name: string;
  client_last_name: string;
  client_email: string;
  client_phone?: string | null;
  client_pipeline_stage?: PipelineStage | null;
  client_status?: ClientStatus | null;
  package_id: number;
  package_name: string;
  package_slug: string;
  anet_subscription_id: string;
  status: SubscriptionStatus;
  amount_cents: number;
  billing_interval: "monthly";
  started_at: string;
  cancelled_at?: string | null;
  next_billing_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminSubscriptionsSummary {
  total_count: number;
  active_count: number;
  cancelled_count: number;
  suspended_count: number;
  expired_count: number;
  mrr_cents: number;
}

export interface AdminSubscriptionsResponse {
  subscriptions: AdminSubscriptionListItem[];
  summary: AdminSubscriptionsSummary;
  pagination: PaginationInfo;
}

export interface ClientPayment {
  id: number;
  package_name: string | null;
  package_slug?: string | null;
  amount_cents: number;
  discount_cents: number;
  original_amount_cents: number | null;
  currency: string;
  status: PaymentStatus;
  provider: PaymentProvider;
  coupon_code: string | null;
  paid_at: string | null;
  created_at: string;
  tradeline_items?: ClientTradelineSelection[];
}

// ============================================================
// PAYMENT SPLITS
// ============================================================
export type PaymentSplitStatus = "pending" | "paid" | "overdue" | "cancelled";
export type SplitCompletionSource = "authorize_link" | "manual";

export interface PaymentSplit {
  id: number;
  case_id: number;
  case_number: string | null;
  client_id: number;
  client_first_name: string | null;
  client_last_name: string | null;
  client_email: string | null;
  label: string;
  amount_cents: number;
  currency: string;
  due_date: string;
  status: PaymentSplitStatus;
  completion_source: SplitCompletionSource | null;
  paid_at: string | null;
  payments_id: number | null;
  reminder_flow_id: number | null;
  reminder_flow_name: string | null;
  send_payment_link: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Present when a payment_split_tokens row exists. */
  payment_token?: string | null;
  /** Absolute or app-relative public pay URL when a token exists. */
  payment_link?: string | null;
}

export interface CreateSplitPayload {
  label: string;
  amount_cents: number;
  due_date: string;
  send_payment_link: boolean;
  reminder_flow_id: number | null;
  notes?: string | null;
  /** When true, create the split already marked paid (manual). */
  mark_as_paid?: boolean;
}

export interface ClientPaymentSplit {
  id: number;
  case_number: string | null;
  label: string;
  amount_cents: number;
  currency: string;
  due_date: string;
  status: PaymentSplitStatus;
  completion_source: SplitCompletionSource | null;
  paid_at: string | null;
  send_payment_link: boolean;
  payment_token: string | null;
}

// ============================================================
// CASES (manual creation)
// ============================================================
export interface CreateCasePayload {
  client_id: number;
  package_id?: number | null;
  pipeline_stage?: string;
  notes?: string | null;
  send_case_email?: boolean;
  splits?: CreateSplitPayload[];
  /** Optional round-completion calendar schedule (persisted on the case). */
  round_schedule?: RoundScheduleInput | null;
}

// ============================================================
// PREPAID ONBOARD INVITES (already-paid unknown → New Client)
// ============================================================

export type PrepaidOnboardPaymentMethod =
  | "cash"
  | "zelle"
  | "venmo"
  | "card_offline"
  | "other";

export interface PrepaidOnboardRemainingSplit {
  label: string;
  amount_cents: number;
  due_date: string;
  /** Optional later /pay link; public join page never charges. */
  send_payment_link?: boolean;
}

export interface CreatePrepaidOnboardInvitePayload {
  package_id: number;
  paid_amount_cents: number;
  paid_label?: string;
  payment_method: PrepaidOnboardPaymentMethod;
  payment_note?: string | null;
  remaining_splits?: PrepaidOnboardRemainingSplit[];
  preferred_language?: "en" | "es" | null;
  referral_category?: "realtor_broker" | "one_off" | "affiliate_partner" | null;
  referrer_id?: number | null;
  staff_notes?: string | null;
  /** Hours until expiry (default 168 = 7 days). */
  expires_in_hours?: number;
}

export interface PrepaidOnboardInvite {
  id: number;
  package_id: number;
  package_name: string | null;
  paid_amount_cents: number;
  paid_label: string;
  payment_method: PrepaidOnboardPaymentMethod;
  payment_note: string | null;
  remaining_splits: PrepaidOnboardRemainingSplit[];
  preferred_language: "en" | "es" | null;
  referral_category: string | null;
  referrer_id: number | null;
  staff_notes: string | null;
  created_by_admin_id: number;
  expires_at: string;
  revoked_at: string | null;
  redeemed_at: string | null;
  redeemed_client_id: number | null;
  redeemed_case_id: number | null;
  created_at: string;
  /** Only present on create response. */
  url?: string;
  /** Only present on create response. */
  token?: string;
  is_open?: boolean;
}

export interface PrepaidOnboardPublicInvite {
  package_name: string;
  paid_amount_cents: number;
  paid_label: string;
  remaining_count: number;
  preferred_language: "en" | "es" | null;
  expires_at: string;
}

export interface RedeemPrepaidOnboardPayload {
  first_name: string;
  last_name: string;
  /** Required for portal OTP / welcome email. */
  email: string;
  phone?: string | null;
  preferred_language?: "en" | "es";
}

export interface RedeemPrepaidOnboardResponse {
  token: string | null;
  user: {
    id: number;
    email: string | null;
    first_name: string;
    last_name: string;
  };
  case: { id: number; case_number: string };
  redirect: string;
}

/** Five expected round-completion dates (YYYY-MM-DD), all-day calendar targets. */
export interface RoundScheduleDates {
  round_1_date: string;
  round_2_date: string;
  round_3_date: string;
  round_4_date: string;
  round_5_date: string;
}

export interface RoundScheduleInput extends RoundScheduleDates {
  interval_days?: number;
  /** When true, email .ics to client + referrer (if any) + assigned admin. Default false. */
  send_calendar?: boolean;
}

export interface CaseRoundSchedule extends RoundScheduleDates {
  case_id: number;
  interval_days: number;
  calendar_uid_ns: string;
  /** Successful .ics email sends; drives ICS SEQUENCE on the next send. */
  calendar_send_count?: number;
  last_sent_at: string | null;
  last_sent_recipients: string[] | null;
  updated_at: string;
}

export interface AdminCase {
  id: number;
  case_number: string | null;
  client_id: number;
  client_first_name: string | null;
  client_last_name: string | null;
  client_email: string | null;
  package_id: number | null;
  package_name: string | null;
  pipeline_stage: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// CALENDAR
// ============================================================
export interface CalendarSplit {
  id: number;
  case_id: number;
  case_number: string | null;
  client_id: number;
  client_first_name: string | null;
  client_last_name: string | null;
  label: string;
  amount_cents: number;
  currency: string;
  due_date: string;
  status: PaymentSplitStatus;
  completion_source: SplitCompletionSource | null;
  send_payment_link?: boolean;
  payment_token?: string | null;
  payment_link?: string | null;
}

/** Planned round-completion target on the admin calendar. */
export interface CalendarRoundEvent {
  id: string;
  case_id: number;
  case_number: string | null;
  client_id: number;
  client_first_name: string | null;
  client_last_name: string | null;
  round_number: number;
  target_date: string;
  /** schedule = case_round_schedules R1–5; extended = next_dispute_target_date */
  kind?: "schedule" | "extended";
  label?: string;
}

/** Open Work Hub task with a due date on the admin calendar. */
export interface CalendarWorkTaskEvent {
  id: number;
  title: string;
  status: "backlog" | "doing";
  priority: "low" | "medium" | "high" | "urgent";
  due_date: string;
  assignee_admin_id: number | null;
  assignee_name: string | null;
  case_id: number | null;
  case_number: string | null;
  client_id: number | null;
  client_first_name: string | null;
  client_last_name: string | null;
  source: "optimum" | "hubspot";
}

export interface AdminCalendarResponse {
  splits: CalendarSplit[];
  round_events: CalendarRoundEvent[];
  work_tasks: CalendarWorkTaskEvent[];
}

// ============================================================
// COUPONS
// ============================================================
export type CouponDiscountType = "percentage" | "fixed";

export interface Coupon {
  id: number;
  code: string;
  description?: string | null;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_amount_cents: number;
  max_uses?: number | null;
  uses_count: number;
  applicable_packages?: number[] | null;
  valid_from?: string | null;
  expires_at?: string | null;
  is_active: number;
  created_by_admin_id?: number | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CouponValidateResponse {
  valid: boolean;
  coupon?: Coupon;
  discount_cents: number;
  final_amount_cents: number;
  error?: string;
}

export interface CreateCouponPayload {
  code: string;
  description?: string;
  discount_type: CouponDiscountType;
  discount_value: number;
  min_amount_cents?: number;
  max_uses?: number | null;
  applicable_packages?: number[] | null;
  valid_from?: string | null;
  expires_at?: string | null;
  is_active?: number;
}

export type UpdateCouponPayload = Partial<CreateCouponPayload>;

// ============================================================
// ONBOARDING TASKS
// ============================================================
export type OnboardingTaskType = "form" | "upload" | "sign_document";
export type OnboardingTaskStatus = "pending" | "completed" | "skipped";

export interface TaskFormField {
  key: string;
  label_en: string;
  label_es: string;
  type: "text" | "date" | "checkbox" | "select" | "textarea";
  required: boolean;
  options?: string[]; // for select type
  placeholder_en?: string;
  placeholder_es?: string;
}

export interface TaskUploadConfig {
  accept: string; // e.g. "image/*,application/pdf"
  max_mb: number;
}

// ============================================================
// ADMIN WORK HUB (My Tasks Kanban + HubSpot)
// ============================================================
export type {
  WorkTaskStatus,
  WorkTaskPriority,
  WorkTaskSource,
  AdminWorkTask,
  WorkTaskAssignee,
  WorkTaskCaseOption,
  CreateWorkTaskPayload,
  UpdateWorkTaskPayload,
  HubspotConnectionStatus,
  HubspotPermissionRow,
  WorkTasksSyncResult,
  WorkTaskColumnPage,
  WorkTasksBoardResponse,
  WorkTasksColumnMoreResponse,
  AdminDashboardWorkTask,
} from "./workTasks";

export interface OnboardingTaskTemplate {
  id: number;
  slug: string;
  task_type: OnboardingTaskType;
  title_en: string;
  title_es: string;
  description_en?: string | null;
  description_es?: string | null;
  content_html_en?: string | null;
  content_html_es?: string | null;
  form_fields_json?: TaskFormField[] | null;
  upload_config_json?: TaskUploadConfig | null;
  is_required: number;
  is_system: number;
  sort_order: number;
  is_active: number;
  auto_assign: number;
  created_at: string;
  updated_at: string;
}

export interface ClientTaskCompletion {
  id: number;
  client_id: number;
  task_template_id: number;
  status: OnboardingTaskStatus;
  form_data_json?: Record<string, unknown> | null;
  file_storage_key?: string | null;
  file_name?: string | null;
  file_mime?: string | null;
  signature_name?: string | null;
  signature_ip?: string | null;
  completed_at?: string | null;
  admin_review_status?: "pending" | "approved" | "rejected" | null;
  admin_notes?: string | null;
  admin_reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** Template merged with this client's completion (used in portal) */
export interface ClientTaskWithStatus extends OnboardingTaskTemplate {
  completion?: ClientTaskCompletion | null;
}

export interface CreateTaskTemplatePayload {
  slug: string;
  task_type: OnboardingTaskType;
  title_en: string;
  title_es: string;
  description_en?: string;
  description_es?: string;
  content_html_en?: string;
  content_html_es?: string;
  form_fields_json?: TaskFormField[];
  upload_config_json?: TaskUploadConfig;
  is_required?: boolean;
  sort_order?: number;
  is_active?: boolean;
  auto_assign?: boolean;
}

// ============================================================
// OFG PROGRESS REPORT WIZARD
// ============================================================

export type ReportWizardSessionStatus =
  | "draft"
  | "extracting"
  | "review"
  | "generating"
  | "published"
  | "failed";

export interface OfGReportWizardOptions {
  highlight_win?: string;
  tradeline_rec?: boolean;
  funding_note?: boolean;
  spanish?: boolean;
  /** Claude narrative polish during extract (default true when omitted). */
  enhance_with_claude?: boolean;
  /**
   * Score update (Oct 28, 2026): a SmartCredit PDF was saved before its account pages
   * loaded — publish a short scores + verified-inquiries update instead of the full report.
   */
  score_update?: boolean;
  /**
   * Round 1 only: the client has no report from before we started, so the one report is
   * both Before and After. Scores and items to dispute, no comparison.
   */
  starting_point?: boolean;
}

export interface OfGWinRow {
  itemRemoved: string;
  bureaus: ("TU" | "EX" | "EQ")[];
  impact: string;
  status: string;
  highlighted?: boolean;
}

export interface OfGTargetRow {
  item: string;
  bureaus: ("TU" | "EX" | "EQ")[];
  detail: string;
  priority: "high" | "medium" | "low";
}

export interface OfGReportData {
  client: { firstName: string; lastName?: string };
  reportDate: { before: string; after: string };
  bureauScores: {
    transunion: { before: number; after: number };
    experian: { before: number; after: number };
    equifax: { before: number; after: number };
  };
  middleScore: { before: number; after: number };
  /** Primary wins (baseline → since enrollment; chain → this round). */
  wins: OfGWinRow[];
  /** Primary targets (same mode rule as wins). */
  targets: OfGTargetRow[];
  /** Incremental removals this round (vs prior After). */
  winsThisRound?: OfGWinRow[];
  /** Cumulative removals since enrollment / Round 1 Before. */
  winsSinceEnrollment?: OfGWinRow[];
  targetsThisRound?: OfGTargetRow[];
  targetsSinceEnrollment?: OfGTargetRow[];
  /** How Before PDF was selected for score deltas. */
  compareMode?: ReportCompareMode;
  utilization: Array<{
    account: string;
    limit: number;
    balance: number;
    pctUsed: number;
    payTo30: number;
    payTo10: number;
  }>;
  positiveAccounts: string[];
  actionNeeded: string[];
  roadmap: {
    currentRound: number;
    nextRound: number;
    scoreGoal: number;
    gapRemaining: number;
    milestones: string[];
  };
  actionPlan: Array<{
    step: number;
    description: string;
    owner: "ofg" | "client";
  }>;
  fileStrengthScore: number;
  tradelineRecommendation?: { code: string; projectedImpact: string };
  fundingReadinessNote?: string;
  croaDisclosure: string;
  locale?: "en" | "es";
}

export interface ReportWizardDraftSummary {
  id: number;
  case_id: number;
  client_id: number;
  round_number: number;
  status: ReportWizardSessionStatus;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportWizardSession {
  id: number;
  case_id: number;
  client_id: number;
  round_number: number;
  status: ReportWizardSessionStatus;
  before_source?: "upload" | "prior_round" | "enrollment";
  before_reused_from_session_id?: number | null;
  options_json?: OfGReportWizardOptions | null;
  extracted_json?: OfGReportData | null;
  reviewed_json?: OfGReportData | null;
  extraction_meta?: Record<string, unknown> | null;
  output_pdf_id?: number | null;
  round_report_id?: number | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportWizardBeforeContext {
  source: "enrollment" | "prior_round" | "none";
  can_reuse: boolean;
  prior_session_id: number | null;
  prior_round: number | null;
  file_name: string | null;
  report_date_after: string | null;
  score_after: number | null;
  middle_score_after: number | null;
  /** baseline (default) or chain — which PDF is reused as Before. */
  compare_mode?: ReportCompareMode;
  /** Which PDF role to load from prior_session_id when reusing. */
  reuse_pdf_role?: "before" | "after";
  /** Why reuse is off: that PDF was incomplete (published as a Score update). */
  reuse_blocked?: "incomplete_source";
}

// ============================================================
// LEGAL DOCUMENTS (DB-backed markdown)
// ============================================================
export type LegalDocumentSlug = "terms" | "privacy";

export interface LegalDocument {
  slug: LegalDocumentSlug | string;
  title: string;
  content_md: string;
  source_url?: string | null;
  updated_at: string;
}

export interface LegalDocumentSummary {
  slug: string;
  title: string;
  updated_at: string;
}

// ============================================================
// CLIENT INFO REQUESTS (mid-pipeline staff → client data collection)
// ============================================================
export type InfoRequestPresetKey =
  | "smart_credit"
  | "payment_card"
  | "payment_billing"
  | "custom";

export type InfoRequestStatus =
  | "open"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled";

export type InfoRequestFieldType =
  | "text"
  | "email"
  | "password"
  | "textarea"
  | "select"
  | "upload"
  | "smart_credit_block"
  | "payment_card"
  | "billing_confirm";

export interface InfoRequestFieldDef {
  id: string;
  key: string;
  type: InfoRequestFieldType;
  label_en: string;
  label_es: string;
  required?: boolean;
  help_en?: string;
  help_es?: string;
  options?: Array<{
    value: string;
    label_en: string;
    label_es: string;
  }>;
}

export interface InfoRequestFileMeta {
  id: number;
  field_key: string;
  file_name: string;
  mime_type?: string | null;
  file_size?: number | null;
  created_at: string;
}

export interface ClientInfoRequest {
  id: number;
  case_id: number;
  client_id: number;
  created_by_admin_id?: number | null;
  preset_key?: InfoRequestPresetKey | string | null;
  title_en: string;
  title_es: string;
  message_en?: string | null;
  message_es?: string | null;
  fields_json: InfoRequestFieldDef[];
  status: InfoRequestStatus;
  due_at?: string | null;
  response_json?: Record<string, unknown> | null;
  /** Present for admin when secrets were stored (never raw for portal list) */
  has_secrets?: boolean;
  /** Admin-only decrypted secrets when explicitly requested */
  secrets_json?: Record<string, unknown> | null;
  client_consented_at?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by_admin_id?: number | null;
  rejection_reason?: string | null;
  files?: InfoRequestFileMeta[];
  case_number?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInfoRequestPayload {
  case_id: number;
  preset_key?: InfoRequestPresetKey | null;
  title_en: string;
  title_es: string;
  message_en?: string | null;
  message_es?: string | null;
  fields_json: InfoRequestFieldDef[];
  due_at?: string | null;
}

export interface SubmitInfoRequestPayload {
  responses: Record<string, unknown>;
  agreed_terms: boolean;
  agreed_sms: boolean;
  /** Accept.js opaque data when a payment_card field is present */
  dataDescriptor?: string;
  dataValue?: string;
}

// ── Bulk CSV import (admin clients) ──────────────────────────────────────────

export type BulkImportEntityType = "clients";

export interface BulkImportPreviewRow {
  row_number: number;
  status: "will_create" | "skipped" | "error";
  message?: string;
  external_ref?: string | null;
  display_name: string;
  email?: string | null;
  phone?: string | null;
  badge?: string | null;
  conflict_entity_id?: number | null;
}

export interface BulkImportValidateResponse {
  success: boolean;
  message?: string;
  file_error?: string;
  file_error_code?: string;
  job_id?: number;
  expires_at?: string;
  row_count?: number;
  will_create_count?: number;
  skipped_count?: number;
  error_count?: number;
  preview_rows?: BulkImportPreviewRow[];
  breakdown?: Record<string, number>;
  bulk_csv_import_enabled?: boolean;
}

export interface BulkImportCommitOptions {
  send_welcome_emails?: boolean;
}

export interface BulkImportCommitResultRow {
  row_number: number;
  external_ref?: string | null;
  status: "created" | "skipped" | "error";
  entity_id?: number | null;
  message?: string;
}

export interface BulkImportCommitResponse {
  success: boolean;
  message?: string;
  created_count?: number;
  skipped_count?: number;
  error_count?: number;
  results?: BulkImportCommitResultRow[];
}

// ============================================================
// LABELS (source + analysis layers)
// ============================================================
export type LabelLayer = "source" | "analysis";

export interface Label {
  id: number;
  slug: string;
  name_en: string;
  name_es: string;
  layer: LabelLayer;
  color: string;
  is_system?: number | boolean;
  sort_order: number;
  created_at?: string;
}

export interface SetClientLabelsPayload {
  clientId: number;
  add?: string[];
  remove?: string[];
}

// ============================================================
// PROSPECTS
// ============================================================
export interface Prospect {
  /** clients.id */
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  source_label?: string | null;
  preferred_language?: "en" | "es" | null;
  client_goal?: string | null;
  notes?: string | null;
  agent_phone?: string | null;
  rep_name?: string | null;
  labels?: Label[];
  credit_analysis_id?: number | null;
  /** Active prospect-stage case, if New Case → Prospect already ran */
  case_id?: number | null;
  case_number?: string | null;
  created_at: string;
  /** Traffic light (semáforo): hot / warm / cold — prospects only. */
  lead_temperature?: LeadTemperatureColor | null;
  /** Comma-separated reason codes (see LeadTemperatureReason). */
  lead_temperature_reasons?: string | null;
  lead_temperature_at?: string | null;
  analysis_reviewed_at?: string | null;
  call_scheduled_at?: string | null;
  /** Latest lead credit insights (null until a credit report is read). */
  insight_heat_score?: number | null;
  insight_readiness?: LeadReadiness | null;
  insight_middle_score?: number | null;
  insight_target_score?: number | null;
  insight_points_to_target?: number | null;
  insight_projected_middle?: number | null;
  insight_est_value_usd?: number | null;
  insight_active_loan_file?: number | boolean | null;
  insight_next_action?: LeadNextAction | null;
  insight_requested_by?: string | null;
}

// ── Lead credit insights (one snapshot per credit report read) ─────────────
export type LeadReadiness = "ready" | "close" | "long";
export type LeadNextAction =
  | "call_partner_before_underwriting"
  | "call_today_active_loan"
  | "offer_au_after_closing"
  | "start_round1"
  | "pull_full_report"
  | "offer_au"
  | "ready_refer_lender";
export type LeadHeatReason =
  | "active_loan_file"
  | "partner_referred"
  | "shopping_inquiries"
  | "new_account_90d"
  | "close_to_target"
  | "quick_wins"
  | "needs_repair"
  | "already_ready";
export type LeadQuickWin = "duplicate_inquiries" | "inquiries_aging_off" | "paid_collections" | "accuracy_flags" | "personal_info";
type InsightBureau = "TU" | "EX" | "EQ";

/** Mirrors api/leadCreditInsights.ts LeadCreditInsights (typecheck guards drift). */
export interface LeadCreditInsightsData {
  version: number;
  reportDate: string | null;
  reportFormat: "per_bureau" | "merged";
  scoreModel: string | null;
  scores: Record<InsightBureau, number | null>;
  middleScore: number | null;
  targetScore: number;
  pointsToTarget: number;
  projectedMiddle: number | null;
  roundToTarget: 1 | 2 | 3 | 4 | null;
  readiness: LeadReadiness;
  negatives: { total: number; collections: number; chargeOffs: number; lates: number; publicRecords: number; repossessions: number };
  derogBalance: number;
  pastDue: number;
  utilizationPct: number | null;
  lenderUtilizationPct: number | null;
  noOpenCard: boolean;
  inquiries: { last120d: number; last12m: number; sameDayMax: number };
  newAccount90d: { creditor: string; opened: string } | null;
  source: { vendor: string | null; reportId: string | null; company: string | null; requestedBy: string | null; ordered: string | null } | null;
  activeLoanFile: boolean;
  fileStrength: { now: number; projected: number };
  programTier: "standard" | "complex";
  tradelineRecommended: boolean;
  estValueUsd: number;
  heatScore: number;
  heatReasons: LeadHeatReason[];
  quickWins: Array<{ key: LeadQuickWin; count: number }>;
  quickWinsTotal: number;
  nextAction: LeadNextAction;
  scoreFactors: string[];
  oldestAccountMonths: number | null;
  thinFile: boolean;
  studentLoanBalance: number;
  medicalCollections: { count: number; balance: number };
  addressCount: number;
  statesSeen: string[];
  lenderSimulation: string | null;
}

export interface LeadCreditInsightsRow {
  id: number;
  client_id: number;
  credit_file_extraction_id: number;
  /** analysis | progress_before | progress_after | other */
  purpose: string;
  report_date: string | null;
  created_at: string;
  insights: LeadCreditInsightsData;
}

/** GET /api/admin/clients/:id/credit-insights */
export interface LeadCreditInsightsResponse {
  latest: LeadCreditInsightsRow | null;
  history: LeadCreditInsightsRow[];
}

/** GET /api/admin/referral-partners/leaderboard */
export interface ReferralPartnerLeaderboardRow {
  referrer_id: number;
  name: string;
  company: string | null;
  category: string;
  leads: number;
  hot: number;
  converted: number;
  conversion_pct: number;
  avg_middle: number | null;
  open_pipeline_usd: number;
  last_lead_at: string | null;
}
export interface ReferralPartnerLeaderboardResponse {
  days: number;
  partners: ReferralPartnerLeaderboardRow[];
  /** Lender-report "Requested By" names with no partner linked yet. */
  unlinked_requesters: Array<{ name: string; leads: number; last_at: string }>;
}

export type LeadTemperatureColor = "hot" | "warm" | "cold";
export type LeadTemperatureReason =
  | "analysis_reviewed"
  | "call_scheduled"
  | "payment_started"
  | "monitoring_login"
  | "documents_uploaded"
  | "recent_reply"
  | "has_credit_report"
  | "no_reply_14d";

/** POST /api/admin/clients/:id/lead-signals */
export interface LeadSignalsResponse {
  lead_temperature: LeadTemperatureColor | null;
  lead_temperature_reasons: LeadTemperatureReason[];
  lead_temperature_at: string | null;
  analysis_reviewed_at: string | null;
  call_scheduled_at: string | null;
}

export interface ConvertProspectPayload {
  id: number;
  package_id?: number | null;
  notes?: string | null;
  round_schedule?: RoundScheduleInput | null;
}

export interface AdminPipelineQuery {
  search?: string;
  /** Prospect traffic light filter (prospect column only). */
  lead_temperature?: LeadTemperatureColor;
  language?: string;
  billing?: string;
  package_id?: string;
  assigned_admin_id?: string;
  referral_category?: string;
  client_status?: string;
  case_status?: string;
  stage?: string;
  payment_badge?: string;
  tasks?: string;
  info_requests?: string;
  has_notes?: string;
  labels?: string[];
  /** Page size per column (board mode) or for load-more. Default 20. */
  limit?: number;
  /** Load-more: column key (`prospect` | case stage). */
  column?: string;
  /** Load-more offset within that column. */
  offset?: number;
  /** Prospect column order: "heat" = credit insights heat score (default newest). */
  prospect_sort?: "heat";
}

export interface PipelineColumnPage<T = CreditRepairCase | Prospect> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

export interface AdminPipelineResponse {
  cases: CreditRepairCase[];
  prospects: Prospect[];
  /** Public web leads awaiting staff review (excluded from main Prospect). */
  web_review_prospects?: Prospect[];
  limit?: number;
  columns?: Record<string, PipelineColumnPage>;
}

export interface AdminPipelineColumnMoreResponse {
  column: string;
  items: Array<CreditRepairCase | Prospect>;
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

// ============================================================
// CREDIT ANALYSIS (public landing page)
// ============================================================
export type CreditAnalysisMode = "client" | "agent";

/**
 * How well we were able to read text out of the uploaded report.
 * `ok` = usable text extracted; anything else means scores/negatives may be
 * incomplete or absent and the UI/analysis copy should say so honestly
 * instead of implying "no negatives found".
 */
export type CreditAnalysisExtractionStatus =
  | "ok"
  | "empty"
  | "parse_failed"
  | "unsupported_type";

export interface CreditAnalysisScoreSet {
  transunion?: number | null;
  experian?: number | null;
  equifax?: number | null;
}

export interface CreditAnalysisNegativeItem {
  type: string;
  creditor?: string;
  bureaus?: string[];
  detail?: string;
  /** OFG dispute round 1–4 when classified by the rules engine. */
  dispute_round?: 1 | 2 | 3 | 4;
}

export interface ProspectLeadPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  source_label?: string;
  /** Homepage "Get started" CTA — attaches get_started_wizard label. */
  lead_source?: "get_started" | string;
  notes?: string;
  /** First-touch affiliate referral slug — see `client/lib/affiliateAttribution.ts` */
  affiliate_code?: string | null;
}

/**
 * Flat analyst payload from the Optimum credit-analysis algorithm.
 * All values are scalars (no nested objects/arrays) for email templates.
 */
export type CreditAnalysisAnalystFlat = Record<string, string | number | null>;

export interface CreditAnalysisResult {
  id: number;
  client_id: number;
  mode: CreditAnalysisMode;
  scores: CreditAnalysisScoreSet | null;
  negatives: CreditAnalysisNegativeItem[];
  /** Item labels from the new-engine read (empty until it is ready). */
  suggested_labels: string[];
  email_sent: boolean;
  generated_at: string;
  /** Report language (en|es). */
  text_language?: "en" | "es";
  /** True when email_opt_in was set but no valid client email was on file. */
  email_skipped_no_address?: boolean;
  /** New-engine (account-by-account) read is running; email waits for it. */
  enhanced_pending?: boolean;
  /** Secure handle for public / portal new-engine status, analysis and PDF. */
  public_token?: string;
}

// ============================================================
// EVENT MARKETING (CRM section)
// ============================================================
export type EventSeriesKind = "in_person" | "online" | "hybrid";
export type EventSessionStatus = "scheduled" | "cancelled" | "completed";
export type EventFormFieldType =
  | "text"
  | "email"
  | "phone"
  | "textarea"
  | "select"
  | "checkbox"
  | "language";
export type EventQrSource = "company" | "session";
export type EventRegistrationStatus = "registered" | "waitlisted" | "cancelled";
export type EventCheckInMethod = "staff" | "self" | "import";

export interface EventCompany {
  id: number;
  slug: string;
  name: string;
  name_es: string | null;
  label_slug: string;
  is_active: boolean;
  sort_order: number;
  welcome_heading_en: string;
  welcome_heading_es: string;
  welcome_body_en: string;
  welcome_body_es: string;
  offer_free_report: boolean;
  offer_comic: boolean;
  class_link_url: string | null;
  class_schedule_note_en: string | null;
  class_schedule_note_es: string | null;
  email_subject_en: string;
  email_subject_es: string;
  email_body_en: string;
  email_body_es: string;
  sms_body_en: string;
  sms_body_es: string;
  public_url?: string;
  registration_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface EventSeries {
  id: number;
  company_id: number;
  slug: string;
  name_en: string;
  name_es: string;
  kind: EventSeriesKind;
  is_active: boolean;
  sort_order: number;
}

export interface EventSession {
  id: number;
  company_id: number;
  series_id: number;
  short_code: string;
  title_en: string;
  title_es: string;
  starts_at: string;
  ends_at: string | null;
  location_en: string | null;
  location_es: string | null;
  capacity: number | null;
  status: EventSessionStatus;
  /** Seated (registered) people only. */
  registration_count?: number;
  waitlist_count?: number;
  attended_count?: number;
  /** Door self check-in QR has been generated. */
  has_checkin_token?: boolean;
  public_url?: string;
  series_name_en?: string;
  series_name_es?: string;
}

export interface EventFormField {
  id: number;
  company_id: number;
  field_key: string;
  label_en: string;
  label_es: string;
  field_type: EventFormFieldType;
  options_json: string[] | null;
  is_required: boolean;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface EventRegistration {
  id: number;
  client_id: number;
  company_id: number;
  series_id: number | null;
  session_id: number | null;
  answers_json: Record<string, unknown> | null;
  source_qr: EventQrSource;
  checked_in_at: string | null;
  status: EventRegistrationStatus;
  check_in_method: EventCheckInMethod | null;
  /** What was typed differs from the CRM record (CRM kept as is). */
  profile_mismatch: boolean;
  created_at: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  session_title_en?: string | null;
}

export interface EventCompanyDetail {
  company: EventCompany;
  series: EventSeries[];
  sessions: EventSession[];
  form_fields: EventFormField[];
  registrations: EventRegistration[];
}

export interface PublicEventLandingResponse {
  companies: Array<{
    id: number;
    slug: string;
    name: string;
    name_es: string | null;
    sort_order: number;
  }>;
  company: EventCompany;
  series: EventSeries[];
  sessions: EventSession[];
  form_fields: EventFormField[];
  next_session_id: number | null;
  selected_session_id: number | null;
  mfsn_url: string;
}

export interface PublicEventRegisterRequest {
  company_slug: string;
  session_id?: number | null;
  source_qr?: EventQrSource;
  answers: Record<string, unknown>;
}

export interface PublicEventRegisterResponse {
  ok: true;
  client_id: number;
  registration_id: number;
  event_kind: string;
  mfsn_url: string;
  email_sent: boolean;
  sms_sent: boolean;
  /** "waitlisted" when the session was full. */
  status: "registered" | "waitlisted";
  /** Same person + session already registered: nothing re-sent. */
  duplicate: boolean;
  /** .ics download for the picked session (null without a session). */
  calendar_url: string | null;
}

/** GET /api/public/event-marketing/check-in/:token */
export interface PublicEventCheckInInfo {
  company: { slug: string; name: string; name_es: string | null };
  session: {
    title_en: string;
    title_es: string;
    starts_at: string;
    location_en: string | null;
    location_es: string | null;
  };
  form_fields: EventFormField[];
  /** Door check-in only works from 3h before start until 2h after the end. */
  window_open: boolean;
}

/** POST /api/public/event-marketing/check-in/:token */
export interface PublicEventCheckInRequest {
  /** Lookup by phone and/or email; add answers to register a walk-in. */
  phone?: string;
  email?: string;
  answers?: Record<string, unknown>;
}

export interface PublicEventCheckInResponse {
  status: "checked_in" | "already_checked_in" | "needs_registration";
}

/** POST /api/admin/event-marketing/sessions/:id/checkin-token */
export interface EventCheckInTokenResponse {
  token: string;
  url: string;
}

/** One row typed from a paper sign-in sheet. */
export interface EventImportRow {
  first_name: string;
  last_name: string;
  phone: string;
  email?: string;
  preferred_language?: "en" | "es";
  attended?: boolean;
}

export interface EventImportRequest {
  rows: EventImportRow[];
}

export interface EventImportResultRow {
  index: number;
  ok: boolean;
  error?: string;
  client_id?: number;
  duplicate?: boolean;
  new_contact?: boolean;
  profile_mismatch?: boolean;
}

export interface EventImportResponse {
  imported: number;
  duplicates: number;
  failed: number;
  results: EventImportResultRow[];
  detail: EventCompanyDetail;
}

export interface EventSessionResult {
  session_id: number | null;
  title_en: string;
  title_es: string;
  starts_at: string | null;
  status: EventSessionStatus | null;
  capacity: number | null;
  registered: number;
  waitlisted: number;
  attended: number;
  /** Seated, not checked in, session completed. */
  no_show: number;
  /** Contacts created by this event (not already in the CRM). */
  new_contacts: number;
  /** People with a successful payment after registering. */
  paid_clients: number;
  revenue_cents: number;
}

/** GET /api/admin/event-marketing/companies/:id/results */
export interface EventCompanyResults {
  totals: Omit<EventSessionResult, "session_id" | "title_en" | "title_es" | "starts_at" | "status" | "capacity">;
  sessions: EventSessionResult[];
}

/** POST /api/admin/clients/:id/notes */
export interface AdminClientNoteResponse {
  ok: true;
  admin_notes: string | null;
}

/** POST /api/admin/clients/:id/pause — paused=false resumes. */
export interface AdminClientPauseResponse {
  ok: true;
  status: string;
  admin_notes: string | null;
}

/** POST /api/admin/credit-files (202) — upload queued for Claude extraction. */
export interface CreditFileUploadResponse {
  id: number;
  status: "queued";
  /** Recognized layout for the text cross-check; "unknown" is still accepted. */
  provider: string;
  /** Pages printed as images (PDF text check; 0 for images/unknown). */
  image_pages: number;
  total_pages: number;
}

/** GET /api/admin/credit-files/:id — job status + extracted credit file. */
export interface CreditFileExtractionResponse {
  id: number;
  client_id: number | null;
  case_id: number | null;
  purpose: "analysis" | "progress_before" | "progress_after" | "other";
  file_name: string;
  mime_type: string;
  provider: string;
  status: "queued" | "submitted" | "ready" | "failed";
  model: string | null;
  /** CreditFile (api/creditFile.ts) once ready. */
  credit_file: Record<string, unknown> | null;
  issues: Array<{ severity: "error" | "warning"; code: string; message: string }>;
  confidence: number | null;
  image_pages: number | null;
  total_pages: number | null;
  error_message: string | null;
  created_at: string;
  submitted_at: string | null;
  completed_at: string | null;
}

/** GET /api/admin/credit-analyses/:id/enhanced-status */
export interface CreditAnalysisEnhancedStatusResponse {
  /** null = no enhanced read for this analysis (keep today's PDF). */
  /** "review" = public view only: the analysis is held for staff review. */
  status: "queued" | "submitted" | "ready" | "failed" | "review" | null;
  /** Agent context for the analysis PDF (escrow + lender score). */
  context?: CreditAnalysisLenderContext;
  /** Review gate (Spec §11 + Claude audit) once the read is ready. */
  review?: CreditAnalysisReview | null;
}

/** pending/running = automatic check in progress; needs_review = staff must approve; passed/approved = released. */
export type CreditAnalysisReviewStatus = "pending" | "running" | "passed" | "needs_review" | "approved";

export interface CreditAnalysisReview {
  status: CreditAnalysisReviewStatus;
  findings: {
    selfCheck: { ok: boolean; items: Array<{ key: string; label: string; expected: string | null; actual: string; ok: boolean }> } | null;
    audit: Array<{ check: string; severity: "blocking" | "note"; detail: string }>;
    reconciledAdded: number;
    error: string | null;
  } | null;
  reviewedAt: string | null;
}

/**
 * Agent context for the enhanced Credit Analysis: escrow flag (null = auto-
 * detect a mortgage pull in the last 45 days) and the lender's own score.
 */
export interface CreditAnalysisLenderContext {
  escrow: boolean | null;
  lender_score_model: string | null;
  lender_score: number | null;
  lender_target_score: number | null;
}

/**
 * GET /api/admin/credit-analyses/:id/enhanced-analysis — the new engine's
 * analysis (subset used by the on-screen summary; same data as the PDF).
 */
export interface EnhancedCreditAnalysis {
  reportDate: string | null;
  scoreModel: string | null;
  scores: Record<"TU" | "EX" | "EQ", number | null>;
  scoreRatings: Record<"TU" | "EX" | "EQ", string | null>;
  missingBureaus: Array<"TU" | "EX" | "EQ">;
  negatives: Array<{
    creditor: string;
    kind: string;
    bureaus: Array<"TU" | "EX" | "EQ">;
    status: string;
    round: 1 | 2 | 3 | 4;
    hold: boolean;
    legalBasis: string;
    /** Spec v2.1: bureaus not labelled on the source ("Not itemized"). */
    bureausNotItemized?: boolean;
    mask?: string | null;
  }>;
  /** Spec v2.1: inquiries with bureau null = not itemized; action dispute | ages_off | permissible. */
  inquiries?: Array<{ creditor: string; bureau: "TU" | "EX" | "EQ" | null; date: string; action: string; lowerOdds?: string | null }>;
  inquiryClusters: Array<{ count: number; from: string; to: string }>;
  /** Always empty since Spec v2.1 (positives are never dispute targets). */
  accuracyUpdates: Array<{ creditor: string }>;
  identityFlags: Array<{ bureau: "TU" | "EX" | "EQ" | null; field: string }>;
  projections: Array<{ key: string; scores: Record<"TU" | "EX" | "EQ", number | null>; middle?: number | null }>;
  fileStrength: { current: number; postRepair: number };
  programTier: "standard" | "complex";
  escrow: {
    active: boolean;
    source: "agent" | "mortgage_pull" | "mortgage_report" | "lender_report" | "loan_inquiry" | null;
    lenderName?: string | null;
  };
  borrowerName?: string | null;
  middleScore?: number | null;
  vantageScores?: Record<"TU" | "EX" | "EQ", number | null>;
  informational?: Array<{ creditor: string; note: string }>;
  /** Spec §11 self-check against the report's own totals. */
  selfCheck?: { ok: boolean; items: Array<{ key: string; label: string; expected: string | null; actual: string; ok: boolean }> };
  lender: { model: string | null; score: number | null; target: number | null } | null;
  utilizationOverall: { all: number | null; inclClosed?: number | null };
}

/** PATCH /api/admin/credit-analyses/:id/context */
export type CreditAnalysisLenderContextUpdate = Partial<CreditAnalysisLenderContext>;

/** Three-way calls ("Add caller") — GET /api/voice/three-way/presets */
export interface ThreeWayPresetsResponse {
  presets: Array<{ label: string; number: string }>;
}

/** POST /api/voice/three-way/start */
export interface ThreeWayStartResponse {
  session_id: number;
  status: "active";
  third_party: { label: string | null; number: string };
}

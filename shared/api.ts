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
  role: "super_admin" | "admin" | "support" | "agent" | "affiliate";
  status: "active" | "suspended" | "invited" | "inactive";
  /** Present when role=affiliate */
  affiliate?: AffiliateProfile | null;
  /** Present when role=affiliate — whether their portal (pipeline/leads) is unlocked */
  has_portal_access?: boolean;
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
  | "pending_payment"
  | "onboarding"
  | "active"
  | "paused"
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
  | "other";

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

export interface Conversation {
  id: number;
  client_id: number;
  channel: "sms" | "call" | "email" | "internal" | "whatsapp";
  status: "open" | "snoozed" | "closed";
  last_message_at?: string | null;
  last_message_preview?: string | null;
  unread_count: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

export interface ConversationMessage {
  id: number;
  direction: "inbound" | "outbound";
  channel: string;
  body: string;
  from_address?: string | null;
  to_address?: string | null;
  sent_by_admin_id?: number | null;
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
  email: string;
  phone?: string | null;
  pipeline_stage: PipelineStage;
  pipeline_stage_changed_at?: string | null;
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
  email: string;
  phone?: string;
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
  role: "super_admin" | "admin" | "agent" | "affiliate";
  status: "active" | "inactive" | "suspended";
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
  email: string;
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
  | "completed";

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
  CreateWorkTaskPayload,
  UpdateWorkTaskPayload,
  HubspotConnectionStatus,
  HubspotPermissionRow,
  WorkTasksSyncResult,
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
  wins: Array<{
    itemRemoved: string;
    bureaus: ("TU" | "EX" | "EQ")[];
    impact: string;
    status: string;
    highlighted?: boolean;
  }>;
  targets: Array<{
    item: string;
    bureaus: ("TU" | "EX" | "EQ")[];
    detail: string;
    priority: "high" | "medium" | "low";
  }>;
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
  created_at: string;
}

export interface ConvertProspectPayload {
  id: number;
  package_id?: number | null;
  notes?: string | null;
}

export interface AdminPipelineResponse {
  cases: CreditRepairCase[];
  prospects: Prospect[];
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
  suggested_labels: string[];
  analysis_html: string;
  analysis_text?: string | null;
  email_sent: boolean;
  generated_at: string;
  /** How well we were able to read the uploaded report — see CreditAnalysisExtractionStatus. */
  extraction_status: CreditAnalysisExtractionStatus;
  /** Trimmed character count of extracted text (0 for unsupported/failed files). */
  chars_extracted?: number;
  /** Full flat analyst JSON (scores, lending conversion, plan, SMS copy, HTML tables). */
  analyst?: CreditAnalysisAnalystFlat | null;
}

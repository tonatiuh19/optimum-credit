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
  created_at: string;
}

export interface AdminUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  role: "super_admin" | "admin" | "support" | "agent";
  status: "active" | "suspended" | "invited";
}

export type PipelineStage =
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
  | "pending_payment"
  | "onboarding"
  | "active"
  | "paused"
  | "cancelled";

// ============================================================
// PACKAGES + REGISTRATION
// ============================================================
export interface CreditPackage {
  id: number;
  slug: string;
  name: string;
  subtitle?: string | null;
  description?: string | null;
  price_cents: number;
  duration_months: number;
  features_json?: any;
  sort_order: number;
}

export interface RegistrationPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  packageSlug: string;
  // Accept.js nonce — card is tokenized in the browser before this POST is sent
  dataDescriptor: string;
  dataValue: string;
  // Collected later during portal onboarding:
  affiliateCode?: string;
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
export interface RoundReport {
  id: number;
  round_number: number;
  score_before?: number | null;
  score_after?: number | null;
  items_removed: number;
  items_disputed: number;
  summary_md?: string | null;
  created_at: string;
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
  description?: string | null;
  video_url: string;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  category?: string | null;
  language: string;
  is_published?: number;
  sort_order?: number;
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
  // doc task counts (from pipeline endpoint)
  docs_total?: number;
  docs_approved?: number;
  docs_pending?: number;
  docs_rejected?: number;
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
  role: "super_admin" | "admin" | "agent";
  status: "active" | "inactive" | "suspended";
  last_login_at?: string | null;
  created_at: string;
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

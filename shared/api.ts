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
  // Optional promotional coupon code
  coupon_code?: string;
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

export interface ClientPayment {
  id: number;
  package_name: string | null;
  amount_cents: number;
  discount_cents: number;
  original_amount_cents: number | null;
  currency: string;
  status: PaymentStatus;
  provider: PaymentProvider;
  coupon_code: string | null;
  paid_at: string | null;
  created_at: string;
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
}

export interface CreateSplitPayload {
  label: string;
  amount_cents: number;
  due_date: string;
  send_payment_link: boolean;
  reminder_flow_id: number | null;
  notes?: string | null;
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

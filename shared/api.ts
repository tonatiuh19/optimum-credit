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
  phone?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  ssnLast4: string;
  packageSlug: string;
  affiliateCode?: string;
}

export interface RegistrationResponse {
  clientId: number;
  packageId: number;
  packageName: string;
  amountCents: number;
  paymentIntentClientSecret: string;
  isMock: boolean;
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

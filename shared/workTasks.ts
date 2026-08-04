/** Admin Work Hub (My Tasks Kanban) + HubSpot extract types. */

export type WorkTaskStatus = "backlog" | "doing" | "done";
export type WorkTaskPriority = "low" | "medium" | "high" | "urgent";
export type WorkTaskSource = "optimum" | "hubspot";

export interface AdminWorkTask {
  id: number;
  title: string;
  description: string | null;
  status: WorkTaskStatus;
  priority: WorkTaskPriority;
  due_at: string | null;
  labels: string[];
  source: WorkTaskSource;
  hubspot_task_id: string | null;
  hubspot_owner_id: string | null;
  assignee_admin_id: number | null;
  assignee_name: string | null;
  created_by_admin_id: number | null;
  sort_order: number;
  last_synced_at: string | null;
  sync_error: string | null;
  pending_push: boolean;
  due_notified_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkTaskAssignee {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
}

export interface CreateWorkTaskPayload {
  title: string;
  description?: string | null;
  status?: WorkTaskStatus;
  priority?: WorkTaskPriority;
  due_at?: string | null;
  labels?: string[];
  assignee_admin_id?: number | null;
}

export interface UpdateWorkTaskPayload {
  title?: string;
  description?: string | null;
  status?: WorkTaskStatus;
  priority?: WorkTaskPriority;
  due_at?: string | null;
  labels?: string[];
  assignee_admin_id?: number | null;
  sort_order?: number;
}

export interface HubspotConnectionStatus {
  connected: boolean;
  can_extract: boolean;
  hub_domain: string | null;
  connected_at: string | null;
  oauth_configured: boolean;
}

export interface HubspotPermissionRow {
  admin_id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  can_extract: boolean;
  connected: boolean;
  granted_at: string | null;
}

export interface WorkTasksSyncResult {
  pulled: number;
  updated: number;
  created: number;
  pushed: number;
  errors: string[];
}

/** Map HubSpot task status → Work Hub column. */
export function hubspotStatusToWork(status: string | null | undefined): WorkTaskStatus {
  const s = String(status || "").toUpperCase();
  if (s === "COMPLETED") return "done";
  if (s === "IN_PROGRESS") return "doing";
  return "backlog";
}

/** Map Work Hub column → HubSpot task status. */
export function workStatusToHubspot(status: WorkTaskStatus): string {
  if (status === "done") return "COMPLETED";
  if (status === "doing") return "IN_PROGRESS";
  return "NOT_STARTED";
}

export function hubspotPriorityToWork(
  priority: string | null | undefined,
): WorkTaskPriority {
  const p = String(priority || "").toUpperCase();
  if (p === "HIGH" || p === "URGENT") return "high";
  if (p === "LOW") return "low";
  return "medium";
}

export function workPriorityToHubspot(priority: WorkTaskPriority): string {
  if (priority === "urgent" || priority === "high") return "HIGH";
  if (priority === "low") return "LOW";
  return "MEDIUM";
}

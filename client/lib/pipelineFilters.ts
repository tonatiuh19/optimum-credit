import type { AdminPipelineQuery } from "@shared/api";

export const EMPTY_PIPELINE_FILTERS = {
  stage: "all",
  language: "all",
  billing: "all",
  package_id: "all",
  assigned_admin_id: "all",
  referral_category: "all",
  client_status: "all",
  case_status: "all",
  payment_badge: "all",
  tasks: "all",
  info_requests: "all",
  has_notes: "all",
  labels: [] as string[],
};

export type PipelineFilterState = typeof EMPTY_PIPELINE_FILTERS;

/** Map upload task slug → case document type for admin upload prefill. */
export function taskSlugToDocType(
  slug: string | undefined | null,
): string | null {
  const uploadSlugs = ["id_front", "id_back", "ssn_card", "proof_of_address"];
  if (slug && uploadSlugs.includes(slug)) return slug;
  return null;
}

/** Build GET /admin/pipeline query from debounced search + filter panel state. */
export function buildAdminPipelineQuery(
  search: string,
  filters: PipelineFilterState,
): AdminPipelineQuery {
  const q: AdminPipelineQuery = {};
  const trimmed = search.trim();
  if (trimmed) q.search = trimmed;
  if (filters.stage !== "all") q.stage = filters.stage;
  if (filters.language !== "all") q.language = filters.language;
  if (filters.billing !== "all") q.billing = filters.billing;
  if (filters.package_id !== "all") q.package_id = filters.package_id;
  if (filters.assigned_admin_id !== "all")
    q.assigned_admin_id = filters.assigned_admin_id;
  if (filters.referral_category !== "all")
    q.referral_category = filters.referral_category;
  if (filters.client_status !== "all") q.client_status = filters.client_status;
  if (filters.case_status !== "all") q.case_status = filters.case_status;
  if (filters.payment_badge !== "all") q.payment_badge = filters.payment_badge;
  if (filters.tasks !== "all") q.tasks = filters.tasks;
  if (filters.info_requests !== "all") q.info_requests = filters.info_requests;
  if (filters.has_notes !== "all") q.has_notes = filters.has_notes;
  if (filters.labels.length > 0) q.labels = filters.labels;
  return q;
}

export function countActivePipelineFilters(
  filters: PipelineFilterState,
): number {
  return (
    [
      filters.stage !== "all",
      filters.language !== "all",
      filters.billing !== "all",
      filters.package_id !== "all",
      filters.assigned_admin_id !== "all",
      filters.referral_category !== "all",
      filters.client_status !== "all",
      filters.case_status !== "all",
      filters.payment_badge !== "all",
      filters.tasks !== "all",
      filters.info_requests !== "all",
      filters.has_notes !== "all",
      filters.labels.length > 0,
    ] as boolean[]
  ).filter(Boolean).length;
}

/** Human-readable chip label for an active pipeline filter. */
export function pipelineFilterChipLabel(
  key: keyof PipelineFilterState,
  filters: PipelineFilterState,
  opts?: {
    packageName?: string;
    ownerName?: string;
    t?: (key: string, opts?: Record<string, unknown>) => string;
  },
): string {
  const t = opts?.t ?? ((k: string) => k);
  const v = filters[key];
  if (key === "labels") {
    return Array.isArray(v) ? (v as string[]).join(", ") : "";
  }
  const val = String(v);
  const map: Record<string, Record<string, string>> = {
    stage: {
      prospect: "Prospect",
      new_client: "New Client",
      docs_ready: "Docs Verified",
      round_1: "Round 1",
      round_2: "Round 2",
      round_3: "Round 3",
      round_4: "Round 4",
      round_5: "Round 5",
      completed: "Completed",
    },
    language: { en: "EN", es: "ES" },
    billing: {
      split_plan: "Split plan",
      overdue: "Has overdue",
      paid_full: "Paid in full",
      direct_paid: "Direct paid",
      no_payment: "No payment",
    },
    payment_badge: {
      paid: t("adminPipeline.paymentPaid"),
      unpaid: t("adminPipeline.paymentUnpaid"),
    },
    package_id: { none: t("adminPipeline.noPackage") },
    assigned_admin_id: {
      unassigned: t("adminPipeline.unassignedOwner"),
    },
    referral_category: {
      realtor_broker: "Realtor / Broker",
      one_off: "One-off",
      affiliate_partner: "Affiliate partner",
    },
    tasks: {
      incomplete: t("adminPipeline.tasksIncomplete"),
      complete: t("adminPipeline.tasksComplete"),
      pending_review: t("adminPipeline.tasksPendingReview"),
      rejected: t("adminPipeline.tasksRejected"),
    },
    info_requests: {
      open: t("adminPipeline.infoOpen"),
      none: t("adminPipeline.infoNone"),
    },
    has_notes: {
      yes: t("adminPipeline.hasNotes"),
      no: t("adminPipeline.noNotes"),
    },
  };
  if (key === "package_id" && val !== "none" && opts?.packageName) {
    return opts.packageName;
  }
  if (key === "assigned_admin_id" && val !== "unassigned" && opts?.ownerName) {
    return opts.ownerName;
  }
  return map[key]?.[val] ?? val.replace(/_/g, " ");
}

/** Compose reopen success toast fragments (pure — unit tested). */
export function buildReopenToastParts(opts: {
  taskLabel: string;
  notified: boolean;
  emailed: string | null;
  stageRolledBack: boolean;
  notifyError?: string | null;
  body: string;
  notifiedText: string;
  silentText: string;
  rolledBackText: string;
  notifyErrorText: string;
}): string[] {
  const parts = [opts.body];
  if (opts.notified && opts.emailed) parts.push(opts.notifiedText);
  else parts.push(opts.silentText);
  if (opts.stageRolledBack) parts.push(opts.rolledBackText);
  if (opts.notifyError) parts.push(opts.notifyErrorText);
  return parts;
}

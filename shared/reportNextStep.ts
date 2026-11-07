/**
 * The one recommended next step for a progress report, from its facts (Nov 7, 2026). The wizard, the
 * client panel, the approval card and the queue all use this, so staff never get different advice in
 * different places — and never "wait for an OK" or "reset": held reports re-check themselves.
 */
import { explainHeldChecks } from "./heldReport";

export type ReportNextStep =
  | "reading" // both PDFs being read (2-4 min)
  | "read_failed" // a read failed: upload the PDF again
  | "resave_pdf" // the PDF was saved before SmartCredit finished loading
  | "newer_report" // Before and After are the same file
  | "score_update" // only scores are readable: send a Score update
  | "publish" // reads ready: preview and publish
  | "approve" // waiting for approval and this person approves
  | "approve_rebuilt" // rebuilt itself with the latest checks and passes: approve
  | "wait_approver" // waiting for approval by someone else
  | "held_platform" // held, the PDF is fine: nothing to do, notified, re-checks itself
  | "done"; // sent / released

export type ReportNextTone = "info" | "action" | "warning" | "done";

export interface ReportNextInput {
  /** Wizard (before publishing). */
  reads?: {
    ready?: boolean;
    blockedSameFile?: boolean;
    incompletePrint?: boolean;
    scoreUpdateAvailable?: boolean;
    failed?: boolean;
  } | null;
  /** Published report. */
  delivery?: {
    status: "pending_approval" | "needs_review" | "sending" | "sent" | "silent" | null;
    checks?: Array<{ key: string; pass: boolean | null; detail?: string | null }>;
    canApprove?: boolean;
    rebuilt?: boolean;
  } | null;
}

export function reportNextStep(input: ReportNextInput): { step: ReportNextStep; tone: ReportNextTone } {
  const d = input.delivery;
  if (d) {
    if (d.status === "sent" || d.status === "silent" || d.status === "sending" || d.status === null) return { step: "done", tone: "done" };
    if (d.status === "needs_review") {
      const cause = explainHeldChecks(d.checks ?? []).cause;
      return cause === "file" ? { step: "resave_pdf", tone: "warning" } : { step: "held_platform", tone: "info" };
    }
    if (!d.canApprove) return { step: "wait_approver", tone: "info" };
    return d.rebuilt ? { step: "approve_rebuilt", tone: "action" } : { step: "approve", tone: "action" };
  }
  const r = input.reads;
  if (!r) return { step: "reading", tone: "info" };
  if (r.blockedSameFile) return { step: "newer_report", tone: "warning" };
  if (r.incompletePrint) return r.scoreUpdateAvailable ? { step: "score_update", tone: "action" } : { step: "resave_pdf", tone: "warning" };
  if (r.failed) return { step: "read_failed", tone: "warning" };
  if (r.ready) return { step: "publish", tone: "action" };
  return { step: "reading", tone: "info" };
}

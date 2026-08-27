import { describe, expect, it } from "vitest";
import {
  EMPTY_PIPELINE_FILTERS,
  buildAdminPipelineQuery,
  buildReopenToastParts,
  countActivePipelineFilters,
  isProspectLead,
  pipelineFilterChipLabel,
  taskSlugToDocType,
} from "./pipelineFilters";

describe("taskSlugToDocType", () => {
  it("maps known upload slugs", () => {
    expect(taskSlugToDocType("id_front")).toBe("id_front");
    expect(taskSlugToDocType("proof_of_address")).toBe("proof_of_address");
  });
  it("returns null for non-upload / empty", () => {
    expect(taskSlugToDocType("service_agreement")).toBeNull();
    expect(taskSlugToDocType(null)).toBeNull();
    expect(taskSlugToDocType("")).toBeNull();
  });
});

describe("isProspectLead", () => {
  it("treats status=prospect as a lead", () => {
    expect(
      isProspectLead({ status: "prospect", pipeline_stage: "prospect" }),
    ).toBe(true);
  });

  it("treats pending_payment + pipeline_stage=prospect as a lead", () => {
    expect(
      isProspectLead({
        status: "pending_payment",
        pipeline_stage: "prospect",
      }),
    ).toBe(true);
  });

  it("excludes funding lane clients", () => {
    expect(
      isProspectLead({ status: "funding", pipeline_stage: "prospect" }),
    ).toBe(false);
  });

  it("excludes cancelled and enrolled cases", () => {
    expect(
      isProspectLead({ status: "cancelled", pipeline_stage: "prospect" }),
    ).toBe(false);
    expect(
      isProspectLead(
        { status: "pending_payment", pipeline_stage: "prospect" },
        { hasEnrolledCase: true },
      ),
    ).toBe(false);
    expect(
      isProspectLead({ status: "onboarding", pipeline_stage: "new_client" }),
    ).toBe(false);
  });
});

describe("buildAdminPipelineQuery", () => {
  it("returns default page limit when nothing set", () => {
    expect(buildAdminPipelineQuery("", EMPTY_PIPELINE_FILTERS)).toEqual({
      limit: 20,
    });
  });

  it("includes trimmed search and selected filters", () => {
    const q = buildAdminPipelineQuery("  CR-123  ", {
      ...EMPTY_PIPELINE_FILTERS,
      language: "es",
      billing: "overdue",
      package_id: "none",
      assigned_admin_id: "unassigned",
      tasks: "incomplete",
      labels: ["realtor_broker"],
    });
    expect(q).toEqual({
      search: "CR-123",
      language: "es",
      billing: "overdue",
      package_id: "none",
      assigned_admin_id: "unassigned",
      tasks: "incomplete",
      labels: ["realtor_broker"],
      limit: 20,
    });
  });
});

describe("countActivePipelineFilters", () => {
  it("counts non-default filters", () => {
    expect(countActivePipelineFilters(EMPTY_PIPELINE_FILTERS)).toBe(0);
    expect(
      countActivePipelineFilters({
        ...EMPTY_PIPELINE_FILTERS,
        stage: "new_client",
        labels: ["a", "b"],
      }),
    ).toBe(2);
  });
});

describe("pipelineFilterChipLabel", () => {
  it("pretty-prints known enums", () => {
    expect(
      pipelineFilterChipLabel(
        "referral_category",
        { ...EMPTY_PIPELINE_FILTERS, referral_category: "realtor_broker" },
      ),
    ).toBe("Realtor / Broker");
    expect(
      pipelineFilterChipLabel(
        "tasks",
        { ...EMPTY_PIPELINE_FILTERS, tasks: "pending_review" },
        { t: (k) => (k.includes("Pending") ? "Pending review" : k) },
      ),
    ).toContain("Pending");
  });
});

describe("buildReopenToastParts", () => {
  it("includes silent + rollback", () => {
    const parts = buildReopenToastParts({
      taskLabel: "ID Front",
      notified: false,
      emailed: null,
      stageRolledBack: true,
      body: "reopened",
      notifiedText: "emailed",
      silentText: "silent",
      rolledBackText: "rolled",
      notifyErrorText: "err",
    });
    expect(parts).toEqual(["reopened", "silent", "rolled"]);
  });

  it("includes notify error when email failed", () => {
    const parts = buildReopenToastParts({
      taskLabel: "ID",
      notified: false,
      emailed: null,
      stageRolledBack: false,
      notifyError: "forced_email_fail",
      body: "reopened",
      notifiedText: "emailed",
      silentText: "silent",
      rolledBackText: "rolled",
      notifyErrorText: "err",
    });
    expect(parts).toEqual(["reopened", "silent", "err"]);
  });
});

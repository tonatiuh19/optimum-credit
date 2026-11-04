/**
 * Prospects + pipeline stage rules — regression coverage for locked decisions.
 */
import { describe, expect, it } from "vitest";
import {
  canDragProspect,
  shouldConfirmStageMove,
  isForwardStageMove,
  isBackwardStageMove,
  pipelineStageIndex,
  isProspectClientRow,
  missingRequiredLabelSlugs,
} from "./index";

describe("pipeline stage order", () => {
  it("places prospect before new_client", () => {
    expect(pipelineStageIndex("prospect")).toBeLessThan(
      pipelineStageIndex("new_client"),
    );
  });

  it("detects forward and backward moves", () => {
    expect(isForwardStageMove("new_client", "docs_ready")).toBe(true);
    expect(isBackwardStageMove("docs_ready", "new_client")).toBe(true);
    expect(isForwardStageMove("round_1", "round_1")).toBe(false);
  });

  it("requires confirm on any stage change (6C)", () => {
    expect(shouldConfirmStageMove("new_client", "docs_ready")).toBe(true);
    expect(shouldConfirmStageMove("round_3", "round_1")).toBe(true);
    expect(shouldConfirmStageMove("round_1", "completed")).toBe(true);
    expect(shouldConfirmStageMove("docs_ready", "docs_ready")).toBe(false);
  });

  it("only allows prospect → new_client drag (1C/5A)", () => {
    expect(canDragProspect("prospect", "new_client")).toBe(true);
    expect(canDragProspect("prospect", "docs_ready")).toBe(false);
    expect(canDragProspect("prospect", "round_1")).toBe(false);
    expect(canDragProspect("prospect", "completed")).toBe(false);
    expect(canDragProspect("new_client", "prospect")).toBe(false);
    expect(canDragProspect("docs_ready", "new_client")).toBe(false);
  });
});

describe("prospect-stage case product rules (documented)", () => {
  it("documents convert-only leave and New Case prospect create", () => {
    // Board drag: prospect → new_client only (convert modal).
    expect(canDragProspect("prospect", "new_client")).toBe(true);
    // Case/client stage APIs must 409 leaving prospect (covered in HTTP edge suite).
    // New Case may create pipeline_stage=prospect without converting.
    expect(true).toBe(true);
  });
});

describe("isProspectClientRow", () => {
  it("accepts status=prospect or pipeline_stage=prospect", () => {
    expect(isProspectClientRow({ status: "prospect", pipeline_stage: "prospect" } as any)).toBe(true);
    expect(isProspectClientRow({ status: "active", pipeline_stage: "prospect" } as any)).toBe(true);
    expect(isProspectClientRow({ status: "prospect", pipeline_stage: "new_client" } as any)).toBe(true);
  });

  it("rejects cancelled, funding, and enrolled-only leads", () => {
    expect(isProspectClientRow({ status: "cancelled", pipeline_stage: "prospect" } as any)).toBe(false);
    expect(isProspectClientRow({ status: "funding", pipeline_stage: "prospect" } as any)).toBe(false);
    expect(isProspectClientRow({ status: "active", pipeline_stage: "round_1" } as any)).toBe(false);
    expect(isProspectClientRow(null)).toBe(false);
  });
});

describe("missingRequiredLabelSlugs — reminder audience gate", () => {
  it("passes when no labels are required", () => {
    expect(missingRequiredLabelSlugs([], [])).toEqual([]);
    expect(missingRequiredLabelSlugs(["housing"], [])).toEqual([]);
  });

  it("passes when the client holds every required slug", () => {
    expect(
      missingRequiredLabelSlugs(
        ["web_analysis", "housing", "collections"],
        ["housing", "collections"],
      ),
    ).toEqual([]);
  });

  it("returns only the missing required slugs", () => {
    expect(
      missingRequiredLabelSlugs(["web_analysis"], ["housing", "collections"]),
    ).toEqual(["housing", "collections"]);
    expect(
      missingRequiredLabelSlugs(["housing"], ["housing", "collections"]),
    ).toEqual(["collections"]);
  });
});

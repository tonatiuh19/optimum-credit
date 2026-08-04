import { describe, expect, it } from "vitest";
import {
  hubspotPriorityToWork,
  hubspotStatusToWork,
  workPriorityToHubspot,
  workStatusToHubspot,
  workTaskMatchKey,
} from "./index";

describe("hubspotHelpers mapping", () => {
  it("maps HubSpot statuses to work columns", () => {
    expect(hubspotStatusToWork("COMPLETED")).toBe("done");
    expect(hubspotStatusToWork("IN_PROGRESS")).toBe("doing");
    expect(hubspotStatusToWork("NOT_STARTED")).toBe("backlog");
    expect(hubspotStatusToWork("WAITING")).toBe("backlog");
  });

  it("maps work columns back to HubSpot", () => {
    expect(workStatusToHubspot("done")).toBe("COMPLETED");
    expect(workStatusToHubspot("doing")).toBe("IN_PROGRESS");
    expect(workStatusToHubspot("backlog")).toBe("NOT_STARTED");
  });

  it("maps priorities both ways", () => {
    expect(hubspotPriorityToWork("HIGH")).toBe("high");
    expect(hubspotPriorityToWork("LOW")).toBe("low");
    expect(workPriorityToHubspot("urgent")).toBe("HIGH");
    expect(workPriorityToHubspot("medium")).toBe("MEDIUM");
  });

  it("builds stable fuzzy match keys", () => {
    expect(workTaskMatchKey("  Call Client  ", "2026-08-01T12:00:00.000Z")).toBe(
      "call client|2026-08-01",
    );
    expect(workTaskMatchKey("x", null)).toBe("x|");
  });
});

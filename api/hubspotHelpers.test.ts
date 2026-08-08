import { describe, expect, it } from "vitest";
import {
  HUBSPOT_SCOPES,
  HUBSPOT_TASKS_API_BASE,
  buildHubspotAuthorizeUrl,
  hubspotAuthMode,
  hubspotPriorityToWork,
  hubspotStatusToWork,
  isHubspotServiceKeyConfigured,
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

describe("hubspot 2026.03 auth config", () => {
  it("uses contacts scopes (not crm.objects.tasks.*)", () => {
    expect(HUBSPOT_SCOPES).toContain("oauth");
    expect(HUBSPOT_SCOPES).toContain("crm.objects.contacts.read");
    expect(HUBSPOT_SCOPES).toContain("crm.objects.contacts.write");
    expect(HUBSPOT_SCOPES).not.toContain("crm.objects.tasks");
  });

  it("builds authorize URL only when OAuth client credentials exist", () => {
    const prevId = process.env.HUBSPOT_CLIENT_ID;
    const prevSecret = process.env.HUBSPOT_CLIENT_SECRET;
    try {
      delete process.env.HUBSPOT_CLIENT_ID;
      delete process.env.HUBSPOT_CLIENT_SECRET;
      expect(
        buildHubspotAuthorizeUrl({
          redirectUri: "http://localhost:8080/cb",
          state: "abc",
        }),
      ).toBeNull();

      process.env.HUBSPOT_CLIENT_ID = "client-id";
      process.env.HUBSPOT_CLIENT_SECRET = "client-secret";
      const url = buildHubspotAuthorizeUrl({
        redirectUri: "http://localhost:8080/cb",
        state: "abc",
      });
      expect(url).toContain("https://app.hubspot.com/oauth/authorize?");
      expect(url).toContain("client_id=client-id");
      expect(url).toContain(encodeURIComponent("crm.objects.contacts.read"));
      expect(url).not.toContain("tasks.read");
    } finally {
      if (prevId === undefined) delete process.env.HUBSPOT_CLIENT_ID;
      else process.env.HUBSPOT_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.HUBSPOT_CLIENT_SECRET;
      else process.env.HUBSPOT_CLIENT_SECRET = prevSecret;
    }
  });

  it("uses 2026-03 Tasks API base URL", () => {
    expect(HUBSPOT_TASKS_API_BASE).toBe(
      "https://api.hubapi.com/crm/objects/2026-03/tasks",
    );
  });

  it("prefers Service Key auth mode over OAuth when both are set", () => {
    const prevKey = process.env.HUBSPOT_SERVICE_KEY;
    const prevTok = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
    const prevId = process.env.HUBSPOT_CLIENT_ID;
    const prevSecret = process.env.HUBSPOT_CLIENT_SECRET;
    try {
      delete process.env.HUBSPOT_SERVICE_KEY;
      delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
      delete process.env.HUBSPOT_CLIENT_ID;
      delete process.env.HUBSPOT_CLIENT_SECRET;
      expect(hubspotAuthMode()).toBeNull();
      expect(isHubspotServiceKeyConfigured()).toBe(false);

      process.env.HUBSPOT_CLIENT_ID = "id";
      process.env.HUBSPOT_CLIENT_SECRET = "secret";
      expect(hubspotAuthMode()).toBe("oauth");

      process.env.HUBSPOT_SERVICE_KEY = "pat-test";
      expect(isHubspotServiceKeyConfigured()).toBe(true);
      expect(hubspotAuthMode()).toBe("service_key");
    } finally {
      if (prevKey === undefined) delete process.env.HUBSPOT_SERVICE_KEY;
      else process.env.HUBSPOT_SERVICE_KEY = prevKey;
      if (prevTok === undefined) delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
      else process.env.HUBSPOT_PRIVATE_APP_TOKEN = prevTok;
      if (prevId === undefined) delete process.env.HUBSPOT_CLIENT_ID;
      else process.env.HUBSPOT_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.HUBSPOT_CLIENT_SECRET;
      else process.env.HUBSPOT_CLIENT_SECRET = prevSecret;
    }
  });
});

/**
 * #ofg-onboarding alert (Cesar, Nov 6, 2026): every new client is posted once, the first
 * time they become a client. No cron. Tests run dry (never post to the real channel).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { notifyOnboardingNewClient, onboardingClientMessage, onboardingSlackChannel } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const base = {
  clientId: 42,
  name: "Ana Lopez",
  caseNumber: "CR-00042",
  packageName: "Premium",
  language: "es",
  docs: [] as Array<{ doc_type: string; review_status: string }>,
  contractSignedAt: null,
  smartCreditConnectedAt: null,
  smartCreditEmail: null,
  myFreeScoreNowEmail: null,
  staffName: "Lika",
  appUrl: "https://www.ofgllc.com/",
};

describe("onboardingClientMessage", () => {
  it("has Cesar's fields and a link, nothing about payment or contact", () => {
    const t = onboardingClientMessage(base);
    expect(t).toContain("*New client: Ana Lopez* (CR-00042)");
    expect(t).toContain("• Package: Premium");
    expect(t).toContain("• Language: Spanish");
    expect(t).toContain("• Documents: 0/4 approved · missing: ID front, ID back, SSN card, Proof of address");
    expect(t).toContain("• Agreement: not signed yet");
    expect(t).toContain("• Monitoring: not set up yet");
    expect(t).toContain("• Staff: Lika");
    expect(t).toContain("<https://www.ofgllc.com/admin/clients/42|Open in OFG>");
    expect(t).not.toMatch(/\$|payment|card ending|@|phone/i);
  });

  it.each([
    [[{ doc_type: "id_front", review_status: "rejected" }, { doc_type: "id_front", review_status: "approved" }, { doc_type: "id_back", review_status: "approved" }, { doc_type: "ssn_card", review_status: "approved" }, { doc_type: "proof_of_address", review_status: "approved" }], "all 4 approved"],
    [[{ doc_type: "id_front", review_status: "approved" }, { doc_type: "ssn_card", review_status: "pending" }, { doc_type: "id_back", review_status: "rejected" }], "1/4 approved · pending: SSN card · rejected: ID back · missing: Proof of address"],
    [[{ doc_type: "other", review_status: "approved" }], "0/4 approved · missing: ID front, ID back, SSN card, Proof of address"],
  ])("documents %#", (docs, want) => {
    expect(onboardingClientMessage({ ...base, docs })).toContain(`• Documents: ${want}`);
  });

  it("monitoring, agreement, language and missing values", () => {
    expect(onboardingClientMessage({ ...base, smartCreditConnectedAt: new Date(), smartCreditEmail: "x" })).toContain("Monitoring: SmartCredit connected");
    expect(onboardingClientMessage({ ...base, myFreeScoreNowEmail: "x" })).toContain("Monitoring: MyFreeScoreNow on file");
    expect(onboardingClientMessage({ ...base, smartCreditEmail: "x" })).toContain("Monitoring: SmartCredit email on file, not connected yet");
    const t = onboardingClientMessage({ ...base, contractSignedAt: "2026-11-06", language: null, caseNumber: null, packageName: null, staffName: null, name: "A <b>&" });
    expect(t).toContain("Agreement: signed");
    expect(t).toContain("Language: English");
    expect(t).toContain("*New client: A &lt;b&gt;&amp;*\n");
    expect(t).toContain("Package: not set");
    expect(t).toContain("Staff: unassigned");
  });

  it("channel defaults to #ofg-onboarding; env can change it", () => {
    expect(onboardingSlackChannel({} as any)).toBe("C0CFFHR4LKW");
    expect(onboardingSlackChannel({ ONBOARDING_SLACK_CHANNEL: "#other" } as any)).toBe("other");
  });
});

describe("notifyOnboardingNewClient (real tables, dry run)", () => {
  let pool: Pool;
  const ids: number[] = [];
  const make = async (status: string, stage: string) => {
    const [r] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (first_name, last_name, email, status, pipeline_stage) VALUES ('Onb', 'Alert', ?, ?, ?)`,
      [`onboarding-alert-${Date.now()}-${ids.length}@example.test`, status, stage],
    );
    ids.push(r.insertId);
    return r.insertId;
  };
  const stamp = async (id: number) =>
    ((await pool.query<RowDataPacket[]>(`SELECT onboarding_alerted_at FROM clients WHERE id = ?`, [id]))[0] as RowDataPacket[])[0].onboarding_alerted_at;

  beforeAll(() => {
    pool = createIntegrationTestPool();
  });
  afterAll(async () => {
    if (ids.length) await pool.query(`DELETE FROM clients WHERE id IN (?)`, [ids]);
    await pool.end();
  });

  it("a new client is claimed once; a second path does nothing", async () => {
    const id = await make("onboarding", "new_client");
    expect(await notifyOnboardingNewClient(id, "test")).toBe("dry-run");
    expect(await stamp(id)).not.toBeNull();
    expect(await notifyOnboardingNewClient(id, "test-again")).toBe("skipped");
  });

  it("two paths at the same time post once", async () => {
    const id = await make("onboarding", "new_client");
    const r = await Promise.all([notifyOnboardingNewClient(id, "a"), notifyOnboardingNewClient(id, "b"), notifyOnboardingNewClient(id, "c")]);
    expect(r.filter((x) => x === "dry-run")).toHaveLength(1);
  });

  it.each([
    ["prospect", "prospect"],
    ["funding", "prospect"],
    ["pending_payment", "new_client"],
    ["cancelled", "cancelled"],
    ["prospect", "new_client"], // moved on the board but never converted
  ])("%s / %s is not posted and stays unclaimed", async (status, stage) => {
    const id = await make(status, stage);
    expect(await notifyOnboardingNewClient(id, "test")).toBe("skipped");
    expect(await stamp(id)).toBeNull();
  });

  it("unpaid sign-up is posted only once it is paid", async () => {
    const id = await make("pending_payment", "new_client");
    expect(await notifyOnboardingNewClient(id, "registration")).toBe("skipped");
    await pool.query(`UPDATE clients SET status = 'onboarding' WHERE id = ?`, [id]);
    expect(await notifyOnboardingNewClient(id, "payment_succeeded")).toBe("dry-run");
  });

  it("unknown client or id 0 never throws", async () => {
    expect(await notifyOnboardingNewClient(0, "test")).toBe("skipped");
    expect(await notifyOnboardingNewClient(2_000_000_000, "test")).toBe("skipped");
  });
});

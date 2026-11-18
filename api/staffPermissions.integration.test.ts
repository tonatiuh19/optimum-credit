/**
 * Staff permission lists (Nov 17, 2026). Read-only against the shared DB: only GETs and rejected PUTs,
 * so the live lists are never changed by tests.
 */
import "dotenv/config";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { RowDataPacket } from "mysql2/promise";
import { createServer, createSession, normalizeStaffPermissionIds } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";

const CESAR = 90001; // super admin
let OTHER = 0; // any active non-super-admin (e.g. underwriter)
let app: ReturnType<typeof createServer>;
const tokens: Record<number, string> = {};

beforeAll(async () => {
  app = createServer();
  const pool = createIntegrationTestPool();
  const [[o]] = await pool.query<RowDataPacket[]>(`SELECT id FROM admins WHERE status = 'active' AND role <> 'super_admin' ORDER BY id LIMIT 1`);
  await pool.end();
  OTHER = Number(o.id);
  for (const id of [CESAR, OTHER]) tokens[id] = await createSession("admin", id, `sp-${id}@example.test`, "127.0.0.1", "vitest-staff-perms");
}, 60_000);

describe("normalizeStaffPermissionIds", () => {
  it("dedupes, rejects junk, caps at 10", () => {
    expect(normalizeStaffPermissionIds([1, "2", 2])).toEqual([1, 2]);
    expect(normalizeStaffPermissionIds("1,2")).toBeNull();
    expect(normalizeStaffPermissionIds([1, -3])).toBeNull();
    expect(normalizeStaffPermissionIds([1.5])).toBeNull();
    expect(normalizeStaffPermissionIds(Array.from({ length: 12 }, (_, i) => i + 1))).toHaveLength(10);
  });
});

describe("/api/admin/settings/staff-permissions", () => {
  it("super admin reads both lists and the staff picker", async () => {
    const r = await request(app).get("/api/admin/settings/staff-permissions").set("Authorization", `Bearer ${tokens[CESAR]}`);
    expect(r.status).toBe(200);
    expect(r.body.permissions.out_of_office_manager_ids.length).toBeGreaterThan(0);
    expect(r.body.permissions.holiday_greeting_approver_ids.length).toBeGreaterThan(0);
    expect(r.body.staff.some((s: { id: number }) => s.id === CESAR)).toBe(true);
  });

  it("others get 403 on read and write", async () => {
    const g = await request(app).get("/api/admin/settings/staff-permissions").set("Authorization", `Bearer ${tokens[OTHER]}`);
    expect(g.status).toBe(403);
    const p = await request(app).put("/api/admin/settings/staff-permissions").set("Authorization", `Bearer ${tokens[OTHER]}`).send({ out_of_office_manager_ids: [OTHER] });
    expect(p.status).toBe(403);
  });

  it("rejects empty, too long, inactive and empty body (nothing saved)", async () => {
    const put = (body: object) => request(app).put("/api/admin/settings/staff-permissions").set("Authorization", `Bearer ${tokens[CESAR]}`).send(body);
    expect((await put({ out_of_office_manager_ids: [] })).status).toBe(400);
    expect((await put({ holiday_greeting_approver_ids: Array.from({ length: 11 }, (_, i) => CESAR + i) })).status).toBe(400);
    expect((await put({ holiday_greeting_approver_ids: [CESAR, 999999999] })).status).toBe(400);
    expect((await put({ holiday_greeting_approver_ids: "90001" })).status).toBe(400);
    expect((await put({})).status).toBe(400);
  });
});

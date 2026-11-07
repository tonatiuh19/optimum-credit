/**
 * Shared-TiDB test pool retry (Nov 7, 2026): a connection that never opened is retried for any
 * statement; a dropped connection only for reads — a write may already be applied, so repeating it
 * could insert twice. Fake pool, no database.
 */
import { describe, expect, it } from "vitest";
import { withTransientRetry } from "./testDbCleanup";

const err = (code: string) => Object.assign(new Error(code), { code });

function fakePool(failures: string[]) {
  const calls: string[] = [];
  const next = async (sql: string) => {
    calls.push(sql);
    const code = failures.shift();
    if (code) throw err(code);
    return [[{ ok: 1 }], []];
  };
  const pool = { query: next, execute: next, getConnection: async () => next("CONNECT") } as any;
  return { pool: withTransientRetry(pool, 1), calls };
}

describe("withTransientRetry", () => {
  it("a read retries a dropped connection", async () => {
    const { pool, calls } = fakePool(["ECONNRESET", "PROTOCOL_CONNECTION_LOST"]);
    await expect(pool.query("SELECT 1")).resolves.toBeTruthy();
    expect(calls).toHaveLength(3);
  });

  it("a write never repeats after a drop (it may already be saved)", async () => {
    const { pool, calls } = fakePool(["ECONNRESET"]);
    await expect(pool.query("INSERT INTO t VALUES (1)")).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(calls).toHaveLength(1);
  });

  it("a write retries when its connection never opened (statement never sent)", async () => {
    const { pool, calls } = fakePool(["ECONNREFUSED", "ETIMEDOUT"]);
    await expect(pool.execute("UPDATE t SET a = 1")).resolves.toBeTruthy();
    expect(calls).toHaveLength(3);
  });

  it("gives up after two retries; real SQL errors are never retried", async () => {
    const dropped = fakePool(["ECONNRESET", "ECONNRESET", "ECONNRESET"]);
    await expect(dropped.pool.query("SELECT 1")).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(dropped.calls).toHaveLength(3);
    const bad = fakePool(["ER_PARSE_ERROR"]);
    await expect(bad.pool.query("SELECT nope")).rejects.toMatchObject({ code: "ER_PARSE_ERROR" });
    expect(bad.calls).toHaveLength(1);
  });

  it("opening a connection (transactions) retries only connect failures", async () => {
    const ok = fakePool(["ETIMEDOUT"]);
    await expect(ok.pool.getConnection()).resolves.toBeTruthy();
    const dropped = fakePool(["ECONNRESET"]);
    await expect(dropped.pool.getConnection()).rejects.toMatchObject({ code: "ECONNRESET" });
  });
});

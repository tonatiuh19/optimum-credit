/**
 * Read speed (Oct 27, 2026) against the real app + DB: an identical file already read by the
 * current reader is reused instantly (no new read); another reader version never is; the wizard
 * upload guard rejects the same file on both sides. Rows are removed afterwards.
 */
import "dotenv/config";
import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PDFDocument } from "pdf-lib";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createServer, createSession, progressUploadPairProblem } from "./index";
import { createIntegrationTestPool } from "./testDbCleanup";
import { FILE } from "./creditAnalysisFixtures";
import { creditFileExtractVersion } from "./creditFileExtract";

let pool: Pool;
let app: ReturnType<typeof createServer>;
let adminToken = "";
const ids: number[] = [];
const MODEL = String(process.env.ANTHROPIC_MODEL || "").trim() || "claude-sonnet-4-6";

/** A unique 1x1 PNG per test (random tEXt-free trailer bytes change the hash). */
const uniquePng = () =>
  Buffer.concat([
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
    crypto.randomBytes(8),
  ]);
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

async function seedReady(fileSha: string, version: string | null): Promise<number> {
  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO credit_file_extractions
       (purpose, file_name, mime_type, file_size, file_sha256, storage_key, enc_iv, enc_tag,
        provider, status, extracted_json, confidence, extract_version, read_mode, completed_at)
     VALUES ('other', 'seed.png', 'image/png', 1, ?, 'vitest://seed', REPEAT('a',32), REPEAT('b',32),
             'unknown', 'ready', ?, 0.9, ?, 'direct', NOW())`,
    [fileSha, JSON.stringify({ ...FILE, borrowerName: "SEED READ" }), version],
  );
  ids.push(ins.insertId);
  return ins.insertId;
}

const upload = (buf: Buffer) =>
  request(app)
    .post("/api/admin/credit-files")
    .set("Authorization", `Bearer ${adminToken}`)
    .field("purpose", "other")
    .attach("file", buf, { filename: "report-photo.png", contentType: "image/png" });

describe("credit file read speed", () => {
  beforeAll(async () => {
    if (!process.env.DB_HOST || !process.env.JWT_SECRET) throw new Error("DB_HOST / JWT_SECRET required");
    pool = createIntegrationTestPool();
    app = createServer();
    const [admins] = await pool.query<RowDataPacket[]>(
      `SELECT id, email FROM admins WHERE status = 'active' AND role IN ('super_admin','admin','agent') ORDER BY id ASC LIMIT 1`,
    );
    adminToken = await createSession("admin", Number(admins[0].id), String(admins[0].email), "127.0.0.1", "vitest-cfe-speed");
  });

  afterAll(async () => {
    if (ids.length) await pool.query(`DELETE FROM credit_file_extractions WHERE id IN (?) OR reused_from_id IN (?)`, [ids, ids]);
    await pool.end();
  });

  it("the same file already read by the current reader is ready instantly (reused)", async () => {
    const png = uniquePng();
    const seed = await seedReady(sha(png), creditFileExtractVersion(MODEL));
    const res = await upload(png);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "ready", reused: true });
    ids.push(res.body.id);
    const [[row]] = await pool.query<RowDataPacket[]>(
      `SELECT status, read_mode, reused_from_id, storage_key, extract_version, extracted_json FROM credit_file_extractions WHERE id = ?`,
      [res.body.id],
    );
    expect(row).toMatchObject({ status: "ready", read_mode: "reused", reused_from_id: seed, storage_key: "vitest://seed" });
    const read = typeof row.extracted_json === "string" ? JSON.parse(row.extracted_json) : row.extracted_json;
    expect(read.borrowerName).toBe("SEED READ");
    const get = await request(app).get(`/api/admin/credit-files/${res.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.body.status).toBe("ready");
  });

  it.each([
    ["another reader version", "00000000-old"],
    ["no version (read before reuse existed)", null],
  ])("never reuses a read from %s", async (_n, version) => {
    const png = uniquePng();
    await seedReady(sha(png), version);
    const res = await upload(png);
    expect(res.body).toMatchObject({ status: "queued", reused: false });
    ids.push(res.body.id);
  });

  it("a different file is never reused", async () => {
    await seedReady(sha(uniquePng()), creditFileExtractVersion(MODEL));
    const res = await upload(uniquePng());
    expect(res.body.status).toBe("queued");
    ids.push(res.body.id);
  });

  it("a failed or unfinished read of the same file is never reused", async () => {
    const png = uniquePng();
    const [ins] = await pool.query<ResultSetHeader>(
      `INSERT INTO credit_file_extractions (purpose, file_name, mime_type, file_size, file_sha256, storage_key, enc_iv, enc_tag, provider, status, extract_version)
       VALUES ('other', 'f.png', 'image/png', 1, ?, 'vitest://f', REPEAT('a',32), REPEAT('b',32), 'unknown', 'failed', ?)`,
      [sha(png), creditFileExtractVersion(MODEL)],
    );
    ids.push(ins.insertId);
    const res = await upload(png);
    expect(res.body.status).toBe("queued");
    ids.push(res.body.id);
  });

  it("new uploads record the reader version", async () => {
    const res = await upload(uniquePng());
    ids.push(res.body.id);
    const [[row]] = await pool.query<RowDataPacket[]>(`SELECT extract_version FROM credit_file_extractions WHERE id = ?`, [res.body.id]);
    expect(row.extract_version).toBe(creditFileExtractVersion(MODEL));
  });

  it("an analysis read is never reused for a progress upload (progress reads get the reconcile pass)", async () => {
    const png = uniquePng();
    await seedReady(sha(png), creditFileExtractVersion(MODEL)); // purpose 'other'
    const res = await request(app)
      .post("/api/admin/credit-files")
      .set("Authorization", `Bearer ${adminToken}`)
      .field("purpose", "progress_before")
      .attach("file", png, { filename: "r.png", contentType: "image/png" });
    expect(res.body).toMatchObject({ status: "queued", reused: false });
    ids.push(res.body.id);
  });
});

describe("wizard upload pair guard", () => {
  const pdfWith = async (text: string) => {
    const d = await PDFDocument.create();
    const font = await d.embedFont("Helvetica");
    d.addPage([300, 300]).drawText(text, { x: 20, y: 150, size: 12, font });
    return Buffer.from(await d.save());
  };
  it("rejects the same file as Before and After", async () => {
    const a = await pdfWith("Report one");
    expect(await progressUploadPairProblem(a, Buffer.from(a))).toMatchObject({ code: "same_file" });
  });
  it("accepts two different reports", async () => {
    expect(await progressUploadPairProblem(await pdfWith("Report one"), await pdfWith("Report two"))).toBeNull();
  });
});

describe("internal read route", () => {
  it.each([
    ["no secret", {}],
    ["wrong secret", { "x-cron-secret": "nope" }],
  ])("refuses %s", async (_n, headers) => {
    const res = await request(createServer()).post("/api/internal/credit-file-read/1").set(headers as Record<string, string>);
    expect(res.status).toBe(401);
  });
});

import { splitBrakeOpen } from "./index";
describe("split-read cost brake", () => {
  const c = (n: number) => Array(n).fill("chunked");
  const f = (n: number) => Array(n).fill("split_fallback");
  it.each([
    ["no history", [], true],
    ["4 attempts, all fell back (too few to judge)", f(4), true],
    ["5 attempts, all verified", c(5), true],
    ["10 attempts, 3 fell back (30%)", [...f(3), ...c(7)], true],
    ["10 attempts, 4 fell back (40%) → paused", [...f(4), ...c(6)], false],
    ["only the last 20 count", [...c(20), ...f(30)], true],
    ["recent run of fallbacks pauses even after good history", [...f(10), ...c(10), ...c(50)], false],
  ] as Array<[string, string[], boolean]>)("%s", (_n, modes, open) => expect(splitBrakeOpen(modes)).toBe(open));
});

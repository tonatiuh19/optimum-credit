import { describe, expect, it } from "vitest";
import {
  assertFilesUnderUploadLimit,
  VERCEL_SAFE_UPLOAD_MAX_BYTES,
} from "@/lib/uploadLimits";

function fakeFile(name: string, size: number): File {
  const buf = new Uint8Array(Math.min(size, 16));
  const f = new File([buf], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("uploadLimits", () => {
  it("accepts files under the 4 MB cap", () => {
    expect(
      assertFilesUnderUploadLimit([fakeFile("a.pdf", 1000)]).ok,
    ).toBe(true);
  });

  it("rejects a single oversize file", () => {
    const r = assertFilesUnderUploadLimit([
      fakeFile("big.pdf", VERCEL_SAFE_UPLOAD_MAX_BYTES + 1),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toMatch(/4 MB/i);
  });

  it("rejects combined oversize batch", () => {
    const r = assertFilesUnderUploadLimit([
      fakeFile("a.pdf", 3 * 1024 * 1024),
      fakeFile("b.pdf", 2 * 1024 * 1024),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.message).toMatch(/Combined|4 MB/i);
  });
});

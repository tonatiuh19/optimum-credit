/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  canSharePdfFile,
  deliverPdfBlob,
  readBlobErrorMessage,
} from "./deliverPdfBlob";

describe("deliverPdfBlob helpers", () => {
  it("readBlobErrorMessage parses JSON error blobs", async () => {
    const blob = new Blob([JSON.stringify({ error: "Failed to retrieve PDF" })], {
      type: "application/json",
    });
    await expect(readBlobErrorMessage(blob, "fallback")).resolves.toBe(
      "Failed to retrieve PDF",
    );
  });

  it("readBlobErrorMessage falls back for non-json", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], {
      type: "application/pdf",
    });
    await expect(readBlobErrorMessage(blob, "fallback")).resolves.toBe(
      "fallback",
    );
  });
});

describe("deliverPdfBlob", () => {
  const originalOpen = window.open;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    window.open = originalOpen;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevoke;
    vi.unstubAllGlobals();
  });

  it("opens a new tab when share is unavailable", async () => {
    window.open = vi.fn(() => ({}) as Window);
    const result = await deliverPdfBlob({
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
      fileName: "round-1.pdf",
    });
    expect(result).toBe("opened");
    expect(window.open).toHaveBeenCalledWith(
      "blob:mock",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("uses Web Share when canShare accepts the PDF file", async () => {
    window.open = vi.fn(() => ({}) as Window);
    const share = vi.fn(async () => undefined);
    const canShare = vi.fn(() => true);
    vi.stubGlobal("navigator", {
      ...navigator,
      share,
      canShare,
    });
    const result = await deliverPdfBlob({
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
      fileName: "round-1.pdf",
    });
    expect(result).toBe("shared");
    expect(share).toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("treats AbortError from share as shared (user dismissed)", async () => {
    const err = new Error("cancelled");
    err.name = "AbortError";
    vi.stubGlobal("navigator", {
      ...navigator,
      share: vi.fn(async () => {
        throw err;
      }),
      canShare: vi.fn(() => true),
    });
    await expect(
      deliverPdfBlob({
        blob: new Blob(["%PDF"], { type: "application/pdf" }),
        fileName: "round-1.pdf",
      }),
    ).resolves.toBe("shared");
  });

  it("canSharePdfFile is false without share support", () => {
    expect(canSharePdfFile()).toBe(false);
  });
});

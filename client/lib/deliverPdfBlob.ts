/**
 * Deliver a PDF Blob in a mobile-friendly way.
 * Prefer Web Share (iOS/Android Files / Messages), then new-tab open,
 * then <a download>. Avoid silent no-ops on Safari.
 */

export type DeliverPdfBlobResult = "shared" | "opened" | "downloaded";

function ensurePdfBlob(blob: Blob): Blob {
  if (blob.type && blob.type.includes("pdf")) return blob;
  return new Blob([blob], { type: "application/pdf" });
}

function ensurePdfFileName(name: string | undefined | null): string {
  const raw = String(name || "report").trim() || "report";
  return /\.pdf$/i.test(raw) ? raw : `${raw}.pdf`;
}

/** True when the platform can share a PDF file (typical iOS/Android). */
export function canSharePdfFile(): boolean {
  if (typeof navigator === "undefined" || typeof File === "undefined") {
    return false;
  }
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") {
    return false;
  }
  try {
    const probe = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "t.pdf", {
      type: "application/pdf",
    });
    return nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

async function blobToText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") {
    return blob.text();
  }
  // jsdom / older WebViews: Blob.text() missing — use FileReader.
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read_failed"));
    reader.readAsText(blob);
  });
}

/**
 * Parse an Axios/fetch error body when responseType was "blob"
 * (API often returns JSON error with application/json).
 */
export async function readBlobErrorMessage(
  data: unknown,
  fallback: string,
): Promise<string> {
  if (!(data instanceof Blob)) return fallback;
  const type = String(data.type || "").toLowerCase();
  // Skip obvious binary bodies (pdf downloads, images). Empty type still try JSON —
  // Axios blob errors sometimes omit Content-Type.
  if (
    type.includes("pdf") ||
    type.includes("octet-stream") ||
    type.includes("image/") ||
    type.includes("video/") ||
    type.includes("audio/")
  ) {
    return fallback;
  }
  try {
    const text = await blobToText(data);
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return fallback;
    }
    const parsed = JSON.parse(trimmed) as { error?: string; message?: string };
    return String(parsed.error || parsed.message || fallback);
  } catch {
    return fallback;
  }
}

export async function deliverPdfBlob(opts: {
  blob: Blob;
  fileName?: string | null;
}): Promise<DeliverPdfBlobResult> {
  const blob = ensurePdfBlob(opts.blob);
  const fileName = ensurePdfFileName(opts.fileName);

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };

  if (typeof nav.share === "function" && typeof nav.canShare === "function") {
    try {
      const file = new File([blob], fileName, { type: "application/pdf" });
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: fileName });
        return "shared";
      }
    } catch (e: unknown) {
      const name =
        e && typeof e === "object" && "name" in e
          ? String((e as { name?: string }).name)
          : "";
      // User dismissed the sheet — not a failure.
      if (name === "AbortError") return "shared";
      // Fall through to open/download.
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (win) {
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return "opened";
    }

    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return "downloaded";
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("pdf_deliver_failed");
  }
}

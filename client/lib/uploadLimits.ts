/** Match api/index.ts VERCEL_SAFE_UPLOAD_MAX_BYTES — Vercel serverless body ~4.5MB. */
export const VERCEL_SAFE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export function uploadOversizeMessage(fileName?: string): string {
  const label = fileName ? `"${fileName}"` : "This file";
  return `${label} exceeds the 4 MB upload limit. Compress the PDF or split into smaller files.`;
}

/**
 * Per-file check only. Use for flows that upload files in separate requests
 * (e.g. OFG report wizard sequential Before → After).
 */
export function assertEachFileUnderUploadLimit(
  files: File[],
): { ok: true } | { ok: false; message: string } {
  for (const f of files) {
    if (f.size > VERCEL_SAFE_UPLOAD_MAX_BYTES) {
      return { ok: false, message: uploadOversizeMessage(f.name) };
    }
  }
  return { ok: true };
}

/**
 * Per-file + combined size in one request (case docs, MMS, etc.).
 * Report wizard uses assertEachFileUnderUploadLimit + staged Before upload.
 */
export function assertFilesUnderUploadLimit(
  files: File[],
): { ok: true } | { ok: false; message: string } {
  const each = assertEachFileUnderUploadLimit(files);
  if (each.ok === false) return each;
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > VERCEL_SAFE_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      message:
        "Combined upload exceeds the 4 MB limit. Upload one file at a time or compress PDFs.",
    };
  }
  return { ok: true };
}

import { beforeAll, describe, expect, it } from "vitest";
import { ensurePdfParseNodeGlobals } from "./index";

describe("pdf-parse Node globals (report wizard extract)", () => {
  beforeAll(async () => {
    await ensurePdfParseNodeGlobals();
  }, 30_000);

  it("defines DOMMatrix before pdf-parse/pdfjs runs (Vercel/Node)", () => {
    expect(typeof globalThis.DOMMatrix).toBe("function");
  });

  it("can construct PDFParse and extract text from a minimal PDF", async () => {
    const { PDFParse } = await import("pdf-parse");
    // Minimal valid PDF with one page of text (Hello)
    const minimalPdf = Buffer.from(
      `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 24 Tf 100 100 Td (Hello) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000274 00000 n 
0000000362 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
441
%%EOF`,
      "utf8",
    );

    const parser = new PDFParse({ data: minimalPdf });
    try {
      const result = await parser.getText();
      expect(String(result?.text || "")).toMatch(/Hello/i);
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }, 30_000);
});

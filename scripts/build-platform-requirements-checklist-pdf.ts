/**
 * Modern platform requirements discovery checklist PDF.
 * Usage: npx tsx scripts/build-platform-requirements-checklist-pdf.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(
  ROOT,
  "docs",
  "PLATFORM_REQUIREMENTS_DISCOVERY_CHECKLIST.pdf",
);
const SRC = path.join(
  ROOT,
  "docs",
  "PLATFORM_REQUIREMENTS_DISCOVERY_CHECKLIST.txt",
);

/** Ink + teal — professional, modern, cool (not purple / cream / gold agency). */
const INK = rgb(0.067, 0.094, 0.153); // #111827
const INK_SOFT = rgb(0.18, 0.23, 0.31);
const TEAL = rgb(0.051, 0.58, 0.533); // #0D9488
const TEAL_SOFT = rgb(0.94, 0.98, 0.97);
const SLATE = rgb(0.39, 0.45, 0.55);
const MUTED = rgb(0.58, 0.64, 0.72);
const LINE = rgb(0.89, 0.91, 0.94);
const PAGE = rgb(0.973, 0.98, 0.988);
const WHITE = rgb(1, 1, 1);
const CARD = rgb(1, 1, 1);

function safe(s: string) {
  return s
    .replace(/[→←]/g, "->")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[•]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x00-\xFF]/g, "");
}

async function main() {
  const text = fs.readFileSync(SRC, "utf8");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 612;
  const H = 792;
  const M = 44;
  const HEADER_H = 64;
  const FOOTER_H = 36;
  const lines = text.split(/\r?\n/);

  const wrap = (line: string, size: number, bold = false, maxW = W - M * 2) => {
    const f = bold ? fontBold : font;
    const words = safe(line).split(/\s+/);
    const out: string[] = [];
    let cur = "";
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(trial, size) > maxW && cur) {
        out.push(cur);
        cur = w;
      } else cur = trial;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };

  let page = pdf.addPage([W, H]);
  let y = 0;
  let pageNum = 1;
  let isCover = true;

  const drawChrome = (p: PDFPage, num: number, cover: boolean) => {
    p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAGE });

    // Top accent ribbon
    p.drawRectangle({
      x: 0,
      y: H - 6,
      width: W,
      height: 6,
      color: TEAL,
    });

    if (cover) {
      p.drawRectangle({
        x: 0,
        y: H - 132,
        width: W,
        height: 126,
        color: INK,
      });
      p.drawRectangle({
        x: 0,
        y: H - 132,
        width: 8,
        height: 126,
        color: TEAL,
      });
      p.drawText(safe("PLATFORM REQUIREMENTS"), {
        x: M,
        y: H - 48,
        size: 11,
        font: fontBold,
        color: TEAL,
      });
      p.drawText(safe("Discovery Checklist"), {
        x: M,
        y: H - 78,
        size: 26,
        font: fontBold,
        color: WHITE,
      });
      p.drawText(safe("Fill in · return · we scope Phase 1 from your answers"), {
        x: M,
        y: H - 108,
        size: 9,
        font,
        color: rgb(0.7, 0.75, 0.82),
      });
    } else {
      p.drawRectangle({
        x: 0,
        y: H - HEADER_H,
        width: W,
        height: HEADER_H,
        color: INK,
      });
      p.drawRectangle({
        x: 0,
        y: H - HEADER_H,
        width: 6,
        height: HEADER_H,
        color: TEAL,
      });
      p.drawText(safe("Discovery Checklist"), {
        x: M,
        y: H - 28,
        size: 13,
        font: fontBold,
        color: WHITE,
      });
      p.drawText(safe("Platform requirements intake"), {
        x: M,
        y: H - 46,
        size: 8,
        font,
        color: rgb(0.65, 0.72, 0.78),
      });
    }

    p.drawRectangle({
      x: 0,
      y: 0,
      width: W,
      height: FOOTER_H,
      color: WHITE,
    });
    p.drawRectangle({
      x: M,
      y: FOOTER_H - 1,
      width: W - M * 2,
      height: 0.6,
      color: LINE,
    });
    p.drawText(safe("Confidential · client intake"), {
      x: M,
      y: 14,
      size: 7.5,
      font,
      color: MUTED,
    });
    p.drawText(safe(`${num}`), {
      x: W - M - 12,
      y: 14,
      size: 8,
      font: fontBold,
      color: INK_SOFT,
    });
  };

  const contentTop = () => (isCover ? H - 152 : H - HEADER_H - 22);
  const contentBottom = () => FOOTER_H + 16;

  const startPage = () => {
    page = pdf.addPage([W, H]);
    pageNum += 1;
    isCover = false;
    drawChrome(page, pageNum, false);
    y = contentTop();
  };

  drawChrome(page, pageNum, true);
  y = contentTop();

  const drawCheckbox = (p: PDFPage, x: number, cy: number) => {
    p.drawRectangle({
      x,
      y: cy - 1,
      width: 9,
      height: 9,
      borderColor: TEAL,
      borderWidth: 1.1,
      color: WHITE,
    });
  };

  const drawAnswerLine = (p: PDFPage, x: number, cy: number, w: number) => {
    p.drawRectangle({
      x,
      y: cy - 2,
      width: w,
      height: 0.7,
      color: LINE,
    });
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^=+$/.test(line.trim())) {
      y -= 6;
      continue;
    }

    // Skip redundant cover title lines already in the hero
    if (
      line === "Platform Requirements Discovery" ||
      line === "A short intake quiz — fill in and return"
    ) {
      continue;
    }

    const isSection = /^[0-9]{2}\s+[A-Z0-9 /(,&\-]+$/.test(line.trim());
    const isHowTo =
      line.startsWith("HOW TO USE") ||
      line.startsWith("NEXT STEP") ||
      line.startsWith("QUICK GLOSSARY");
    const isHint = line.startsWith("HINT:");
    const isCheck = /^\s*\[\s*\]\s+/.test(line);
    const isBlankLine = /^_{10,}/.test(line.trim());
    const isMeta =
      line.startsWith("Company /") ||
      line.startsWith("Industry:") ||
      line.startsWith("Prepared for:") ||
      line.startsWith("Date:");

    let size = 9;
    let bold = false;
    let color = SLATE;
    let left = M;
    let maxW = W - M * 2;

    if (isSection || isHowTo) {
      size = 11;
      bold = true;
      color = INK;
      y -= 10;
    } else if (isHint) {
      size = 7.8;
      color = INK_SOFT;
      left = M + 10;
      maxW = W - M * 2 - 20;
    } else if (isCheck) {
      size = 8.5;
      color = INK_SOFT;
      left = M + 16;
      maxW = W - M * 2 - 16;
    } else if (isMeta) {
      size = 9;
      color = INK_SOFT;
    } else if (isBlankLine) {
      size = 9;
    }

    if (isSection || isHowTo) {
      if (y < contentBottom() + 36) startPage();
      const label = safe(line.trim());
      const numMatch = /^(\d{2})\s+(.+)$/.exec(label);
      const bandH = 26;
      page.drawRectangle({
        x: M - 6,
        y: y - 8,
        width: W - M * 2 + 12,
        height: bandH,
        color: CARD,
        borderColor: LINE,
        borderWidth: 0.8,
      });
      page.drawRectangle({
        x: M - 6,
        y: y - 8,
        width: 4,
        height: bandH,
        color: TEAL,
      });
      if (numMatch) {
        page.drawText(numMatch[1], {
          x: M + 8,
          y: y,
          size: 10,
          font: fontBold,
          color: TEAL,
        });
        page.drawText(numMatch[2], {
          x: M + 32,
          y: y,
          size: 10,
          font: fontBold,
          color: INK,
        });
      } else {
        page.drawText(label, {
          x: M + 10,
          y: y,
          size: 10,
          font: fontBold,
          color: INK,
        });
      }
      y -= bandH + 6;
      continue;
    }

    if (isHint) {
      const hintBody = line.replace(/^HINT:\s*/, "");
      const chunks = wrap(hintBody, size, false, maxW);
      const blockH = chunks.length * (size + 3.5) + 10;
      if (y - blockH < contentBottom()) startPage();
      page.drawRectangle({
        x: M - 4,
        y: y - blockH + size + 2,
        width: W - M * 2 + 8,
        height: blockH,
        color: TEAL_SOFT,
        borderColor: rgb(0.72, 0.88, 0.84),
        borderWidth: 0.6,
      });
      page.drawText(safe("Why this matters"), {
        x: M + 8,
        y: y,
        size: 6.5,
        font: fontBold,
        color: TEAL,
      });
      y -= 11;
      for (const chunk of chunks) {
        page.drawText(safe(chunk || " "), {
          x: left,
          y,
          size,
          font,
          color: INK_SOFT,
        });
        y -= size + 3.5;
      }
      y -= 4;
      continue;
    }

    if (isBlankLine) {
      if (y < contentBottom() + 18) startPage();
      drawAnswerLine(page, M, y, W - M * 2);
      y -= 16;
      continue;
    }

    const display = isCheck ? line.replace(/^\s*\[\s*\]\s+/, "") : line;
    const chunks = wrap(display || " ", size, bold, maxW);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (y < contentBottom()) startPage();

      if (isCheck && i === 0) {
        drawCheckbox(page, M, y);
      }

      if (isMeta && chunk.includes("____")) {
        const parts = chunk.split(/(_{3,})/);
        let x = left;
        for (const part of parts) {
          if (/^_{3,}$/.test(part)) {
            const lw = Math.max(80, font.widthOfTextAtSize(part, size) * 0.85);
            drawAnswerLine(page, x, y, lw);
            x += lw + 4;
          } else if (part) {
            page.drawText(safe(part), {
              x,
              y,
              size,
              font: bold ? fontBold : font,
              color,
            });
            x += font.widthOfTextAtSize(safe(part), size);
          }
        }
      } else {
        page.drawText(safe(chunk || " "), {
          x: left,
          y,
          size,
          font: bold ? fontBold : font,
          color: chunk.trim() ? color : SLATE,
        });
      }
      y -= size + (isCheck ? 5.5 : 5);
    }
  }

  const bytes = await pdf.save();
  fs.writeFileSync(OUT, bytes);
  console.log(`Wrote ${OUT} (${bytes.length} bytes, ${pageNum} pages)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Builds the current team-setup PDF (CRM wizard — not Claude Project).
 * Usage: npx tsx scripts/build-ofg-team-setup-pdf.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ASSETS = path.join(ROOT, "docs", "assets");
const OUT = path.join(ROOT, "docs", "OFG_PROGRESS_REPORT_TEAM_SETUP.pdf");
const SRC = path.join(ROOT, "docs", "OFG_PROGRESS_REPORT_TEAM_SETUP.txt");

const NAVY = rgb(0.071, 0.094, 0.161);
const GOLD = rgb(0.753, 0.627, 0.416);
const GRAY = rgb(0.35, 0.35, 0.38);
const MUTED = rgb(0.55, 0.55, 0.58);
const WHITE = rgb(1, 1, 1);
const LIGHT = rgb(0.97, 0.975, 0.98);

function safe(s: string) {
  return s
    .replace(/[→←]/g, "->")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[•]/g, "-")
    .replace(/[✓✔]/g, "[OK]")
    .replace(/[✗✘]/g, "[NO]")
    .replace(/…/g, "...")
    .replace(/N−1/g, "N-1")
    .replace(/[^\x00-\xFF]/g, "");
}

async function main() {
  const text = fs.readFileSync(SRC, "utf8");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(
    fs.readFileSync(path.join(ASSETS, "ofg-logo-header.png")),
  );

  const W = 612;
  const H = 792;
  const M = 40;
  const HEADER_H = 56;
  const lines = text.split(/\r?\n/);

  const wrap = (line: string, size: number, bold = false) => {
    const f = bold ? fontBold : font;
    const words = safe(line).split(/\s+/);
    const out: string[] = [];
    let cur = "";
    const max = W - M * 2;
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(trial, size) > max && cur) {
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

  const startPage = () => {
    page = pdf.addPage([W, H]);
    pageNum += 1;
    page.drawRectangle({
      x: 0,
      y: H - HEADER_H,
      width: W,
      height: HEADER_H,
      color: NAVY,
    });
    const logoH = 18;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, { x: M, y: H - 28, width: logoW, height: logoH });
    page.drawText(safe("Team setup - CRM Progress Report Wizard"), {
      x: M,
      y: H - 48,
      size: 8,
      font,
      color: WHITE,
    });
    page.drawRectangle({
      x: 0,
      y: 0,
      width: W,
      height: 32,
      color: LIGHT,
    });
    page.drawText(safe("CONFIDENTIAL - internal only"), {
      x: M,
      y: 14,
      size: 7,
      font: fontBold,
      color: rgb(0.55, 0.2, 0.2),
    });
    page.drawText(safe(`Page ${pageNum}`), {
      x: W - M - 40,
      y: 14,
      size: 8,
      font,
      color: MUTED,
    });
    y = H - HEADER_H - 24;
  };

  // first page header
  page.drawRectangle({
    x: 0,
    y: H - HEADER_H,
    width: W,
    height: HEADER_H,
    color: NAVY,
  });
  {
    const logoH = 18;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, { x: M, y: H - 28, width: logoW, height: logoH });
  }
  page.drawText(safe("Team setup - CRM Progress Report Wizard"), {
    x: M,
    y: H - 48,
    size: 8,
    font,
    color: WHITE,
  });
  page.drawRectangle({ x: 0, y: 0, width: W, height: 32, color: LIGHT });
  page.drawText(safe("CONFIDENTIAL - internal only"), {
    x: M,
    y: 14,
    size: 7,
    font: fontBold,
    color: rgb(0.55, 0.2, 0.2),
  });
  page.drawText(safe(`Page ${pageNum}`), {
    x: W - M - 40,
    y: 14,
    size: 8,
    font,
    color: MUTED,
  });
  y = H - HEADER_H - 24;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const isRule = /^=+$/.test(line.trim());
    const isHeading =
      line === line.toUpperCase() &&
      line.trim().length > 3 &&
      !isRule &&
      !/^\s/.test(line) &&
      /[A-Z]/.test(line);
    const size = isHeading ? 11 : 9;
    const bold = isHeading;
    const color = isHeading ? NAVY : GRAY;
    const chunks = isRule ? [""] : wrap(line || " ", size, bold);

    for (const chunk of chunks) {
      if (y < 56) startPage();
      if (isHeading && chunk) {
        page.drawRectangle({
          x: M,
          y: y - 2,
          width: 24,
          height: 2,
          color: GOLD,
        });
      }
      page.drawText(safe(chunk || " "), {
        x: M,
        y,
        size,
        font: bold ? fontBold : font,
        color,
      });
      y -= size + (isHeading ? 8 : 5);
    }
  }

  const bytes = await pdf.save();
  fs.writeFileSync(OUT, bytes);
  console.log("Wrote", OUT, `(${bytes.length} bytes, ${pdf.getPageCount()} pages)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

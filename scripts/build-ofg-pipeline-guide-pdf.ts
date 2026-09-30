/**
 * Builds staff PDF guide from instructions + real UI screenshots.
 * Usage: npx tsx scripts/build-ofg-pipeline-guide-pdf.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ASSETS = path.join(ROOT, "docs", "assets");
const OUT = path.join(ROOT, "docs", "OFG_PROGRESS_REPORT_PIPELINE_GUIDE.pdf");

const NAVY = rgb(0.071, 0.094, 0.161);
const GOLD = rgb(0.753, 0.627, 0.416);
const GRAY = rgb(0.35, 0.35, 0.38);
const MUTED = rgb(0.55, 0.55, 0.58);
const WHITE = rgb(1, 1, 1);
const ACCENT = rgb(0.06, 0.55, 0.4);

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
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const loadJpg = async (name: string) => {
    const buf = fs.readFileSync(path.join(ASSETS, name));
    return pdf.embedJpg(buf);
  };
  const loadPng = async (name: string) => {
    const buf = fs.readFileSync(path.join(ASSETS, name));
    return pdf.embedPng(buf);
  };

  const logo = await loadPng("ofg-logo-header.png");
  const imgReports = await loadJpg("ofg-real-reports-tab.png");
  const imgRound1 = await loadJpg("ofg-real-round1.png");
  const imgRound2 = await loadJpg("ofg-real-round2.png");

  const W = 612;
  const H = 792;
  const M = 40;
  const TOTAL = 4;
  const HEADER_H = 56;

  const drawHeader = (
    page: ReturnType<PDFDocument["addPage"]>,
    title: string,
  ) => {
    page.drawRectangle({
      x: 0,
      y: H - HEADER_H,
      width: W,
      height: HEADER_H,
      color: NAVY,
    });
    // Logo (gold wordmark on navy)
    const logoH = 18;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, {
      x: M,
      y: H - 28,
      width: logoW,
      height: logoH,
    });
    page.drawText(safe(title), {
      x: M,
      y: H - 48,
      size: 8,
      font,
      color: WHITE,
    });
  };

  const drawFooter = (page: ReturnType<PDFDocument["addPage"]>, n: number) => {
    page.drawText(
      safe("CONFIDENTIAL - for internal team use only"),
      {
        x: M,
        y: 28,
        size: 7,
        font: fontBold,
        color: rgb(0.55, 0.2, 0.2),
      },
    );
    page.drawText(safe(`Staff guide  |  ${n} / ${TOTAL}`), {
      x: M,
      y: 16,
      size: 8,
      font,
      color: MUTED,
    });
  };

  const wrap = (text: string, maxWidth: number, size: number, f = font) => {
    const words = safe(text).split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(trial, size) > maxWidth) {
        if (cur) lines.push(cur);
        cur = w;
      } else {
        cur = trial;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  const drawLines = (
    page: ReturnType<PDFDocument["addPage"]>,
    lines: string[],
    x: number,
    startY: number,
    size: number,
    color = GRAY,
    leading = 4,
    f = font,
  ) => {
    let y = startY;
    for (const line of lines) {
      if (!line) {
        y -= size * 0.6;
        continue;
      }
      page.drawText(safe(line), { x, y, size, font: f, color });
      y -= size + leading;
    }
    return y;
  };

  const fitImage = (
    page: ReturnType<PDFDocument["addPage"]>,
    img: Awaited<ReturnType<typeof pdf.embedJpg>>,
    maxW: number,
    maxH: number,
    x: number,
    topY: number,
  ) => {
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const y = topY - h;
    page.drawImage(img, { x, y, width: w, height: h });
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderColor: rgb(0.85, 0.85, 0.88),
      borderWidth: 0.6,
    });
    return y;
  };

  // ── Page 1: Purpose + chain + where to open + screenshot ─────────────────
  {
    const page = pdf.addPage([W, H]);
    drawHeader(page, "OFG Progress Reports - how to use them in the pipeline");
    let y = H - 78;

    page.drawText(safe("Purpose of this guide"), {
      x: M,
      y,
      size: 13,
      font: fontBold,
      color: NAVY,
    });
    y -= 14;
    page.drawText(safe("CONFIDENTIAL - for internal team use only"), {
      x: M,
      y,
      size: 8,
      font: fontBold,
      color: rgb(0.55, 0.2, 0.2),
    });
    y -= 14;
    y = drawLines(
      page,
      wrap(
        "This document shows staff how to build each round's OFG Progress Report in the pipeline. Every round is a before -> after snapshot. DEFAULT compare mode is BASELINE: Round N Before = enrollment / Round 1 Before so clients see progress since they started. Optional CHAIN mode reuses prior After as Before for mid-program round-to-round stories.",
        W - 2 * M,
        9.5,
      ),
      M,
      y,
      9.5,
      GRAY,
      3,
    );
    y -= 12;

    page.drawText(safe("The chain"), {
      x: M,
      y,
      size: 12,
      font: fontBold,
      color: NAVY,
    });
    y -= 15;
    y = drawLines(
      page,
      [
        "Round 1 Before  =  enrollment credit report (day they started)",
        "Round 1 After   =  report after Round 1 work",
        "Round 2 Before  =  Round 1 After   <- auto-filled for you",
        "Round 2 After   =  report after Round 2 work",
        "...and so on through Round 5.",
      ],
      M + 4,
      y,
      9,
      NAVY,
      3,
      fontBold,
    );
    y -= 8;
    y = drawLines(
      page,
      wrap(
        "The wizard chains the story so each round's After becomes the next round's Before. You only re-upload Before if something is wrong.",
        W - 2 * M,
        9,
      ),
      M,
      y,
      9,
    );
    y -= 12;

    page.drawText(safe("Where to open it"), {
      x: M,
      y,
      size: 12,
      font: fontBold,
      color: NAVY,
    });
    y -= 14;
    y = drawLines(
      page,
      [
        "1. Pipeline -> open the client panel",
        "2. Reports tab",
        "3. Tap Generate (OFG Progress Report Wizard)",
        "",
        "You can generate once the case is in Docs Ready or any Round stage.",
      ],
      M,
      y,
      9.5,
    );
    y -= 8;

    page.drawText(safe("Reports tab"), {
      x: M,
      y,
      size: 8,
      font: fontBold,
      color: ACCENT,
    });
    y -= 4;
    fitImage(page, imgReports, W - 2 * M, y - 32, M, y);
    drawFooter(page, 1);
  }

  // ── Page 2: Round 1 cheat sheet + screenshot ─────────────────────────────
  {
    const page = pdf.addPage([W, H]);
    drawHeader(page, "Round-by-round cheat sheet - Round 1");
    let y = H - 78;

    page.drawText(safe("ROUND 1"), {
      x: M,
      y,
      size: 13,
      font: fontBold,
      color: NAVY,
    });
    y -= 16;
    y = drawLines(
      page,
      [
        "- Upload Before = enrollment / first baseline PDF (SmartCredit, etc.)",
        "- Upload After  = latest report for this round",
        "- Review scores, wins, targets, bureau tags (TU / EX / EQ)",
        "- Fix dates if the PDF date looks wrong",
        "- Preview -> Publish",
        "- Client sees the report in their portal; pipeline advances",
      ],
      M,
      y,
      9.5,
    );
    y -= 12;

    page.drawText(safe("Wizard - Round 1 (both PDFs)"), {
      x: M,
      y,
      size: 8,
      font: fontBold,
      color: ACCENT,
    });
    y -= 4;
    fitImage(page, imgRound1, W - 2 * M, y - 32, M, y);
    drawFooter(page, 2);
  }

  // ── Page 3: Round 2-5 + screenshot ───────────────────────────────────────
  {
    const page = pdf.addPage([W, H]);
    drawHeader(page, "Round-by-round cheat sheet - Rounds 2-5");
    let y = H - 78;

    page.drawText(safe("ROUNDS 2-5"), {
      x: M,
      y,
      size: 13,
      font: fontBold,
      color: NAVY,
    });
    y -= 16;
    y = drawLines(
      page,
      [
        '- Wizard offers: "Using Round N-1 After as Before" - leave that ON',
        "- Upload only the new After PDF",
        "- Override Before only if you must replace the prior file",
        "- If there is no published prior round: upload both Before and After",
        "- Review -> Preview -> Publish",
        "",
        "The timeline strip on Reports shows each round's score and report date",
        "so you can see the chain at a glance.",
      ],
      M,
      y,
      9.5,
    );
    y -= 10;

    page.drawText(safe("Wizard - reuse enrollment Before (baseline)"), {
      x: M,
      y,
      size: 8,
      font: fontBold,
      color: ACCENT,
    });
    y -= 4;
    fitImage(page, imgRound2, W - 2 * M, y - 32, M, y);
    drawFooter(page, 3);
  }

  // ── Page 4: Golden rules + quick flow + troubleshooting ──────────────────
  {
    const page = pdf.addPage([W, H]);
    drawHeader(page, "Golden rules, quick flow, troubleshooting");
    let y = H - 78;

    page.drawText(safe("Golden rules"), {
      x: M,
      y,
      size: 13,
      font: fontBold,
      color: NAVY,
    });
    y -= 16;
    y = drawLines(
      page,
      [
        "[OK] Always publish Round N before starting Round N+1",
        "     (reuse needs a published prior After).",
        "[OK] Compare the review screen against the source PDFs",
        "     (open Before / After with the buttons). Fix low-confidence scores.",
        "[OK] Wins = items that disappeared. Targets = still on the report.",
        "     Tap TU / EX / EQ badges to correct which bureau(s) apply.",
        "[OK] Report dates come from the PDF when possible; edit if needed.",
        "     They print on page 1 of the branded PDF.",
        "[OK] Check the CROA attestation before publish. Large score drops",
        "     need an extra acknowledgment (usually a mis-read - fix first).",
        "",
        "[NO] Don't switch to Chain unless you need round-to-round only",
        "     (Baseline vs enrollment is the product default).",
        "[NO] Don't publish if Before and After look swapped",
        "     (After date earlier, or scores collapsed for no reason).",
      ],
      M,
      y,
      9,
    );
    y -= 12;

    page.drawText(safe("Quick flow (30 seconds)"), {
      x: M,
      y,
      size: 12,
      font: fontBold,
      color: NAVY,
    });
    y -= 15;
    y = drawLines(
      page,
      [
        "Open client -> Reports -> Generate",
        "  -> pick round",
        "  -> Round 1: two PDFs  |  Round 2+: reuse prior + one new After",
        "  -> Continue -> Run extraction",
        "  -> sanity-check scores / wins / dates",
        "  -> Preview -> Publish",
      ],
      M,
      y,
      9.5,
      NAVY,
      3,
      fontBold,
    );
    y -= 12;

    page.drawText(safe("If something looks off"), {
      x: M,
      y,
      size: 12,
      font: fontBold,
      color: NAVY,
    });
    y -= 15;
    y = drawLines(
      page,
      [
        "- Wrong Before? Uncheck reuse and upload a different Before PDF.",
        "- Bad extract? Re-extract, or Start over and try again.",
        "- Resume a draft from the list at the top of the wizard.",
        "- Affiliates cannot run this - staff only.",
      ],
      M,
      y,
      9.5,
    );
    y -= 18;

    page.drawRectangle({
      x: M,
      y: y - 44,
      width: W - 2 * M,
      height: 52,
      color: rgb(0.94, 0.97, 0.95),
      borderColor: ACCENT,
      borderWidth: 1,
    });
    page.drawText(safe("Bottom line"), {
      x: M + 12,
      y: y - 16,
      size: 10,
      font: fontBold,
      color: ACCENT,
    });
    page.drawText(
      safe(
        "One enrollment baseline, then each round's After feeds the next.",
      ),
      { x: M + 12, y: y - 30, size: 9, font, color: NAVY },
    );
    page.drawText(
      safe("The wizard does the chaining; you verify and publish."),
      { x: M + 12, y: y - 44, size: 9, font, color: NAVY },
    );

    drawFooter(page, 4);
  }

  const bytes = await pdf.save();
  fs.writeFileSync(OUT, bytes);
  console.log(`Wrote ${OUT} (${(bytes.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

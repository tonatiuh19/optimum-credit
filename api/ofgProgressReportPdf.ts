/**
 * Branded OFG Progress Report PDF (3 pages).
 * Keep in sync with the inlined copy in api/index.ts (Vercel serverless —
 * do NOT runtime-import this from index.ts).
 *
 * Unit tests + sample scripts import from here.
 */
import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import type { OfGReportData } from "../shared/api";

const NAVY = rgb(0.051, 0.122, 0.235);
const GOLD = rgb(0.788, 0.659, 0.298);
const GRAY = rgb(0.35, 0.35, 0.38);
const MUTED = rgb(0.45, 0.47, 0.52);
const LIGHT = rgb(0.973, 0.976, 0.98);
const BORDER = rgb(0.886, 0.91, 0.941);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0.09, 0.64, 0.29);
const RED = rgb(0.86, 0.15, 0.15);
const AMBER = rgb(0.85, 0.55, 0.13);

const LOGO_CDN =
  "https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_white.png";

type PdfLabels = {
  progressReport: (name: string) => string;
  scoreOverview: string;
  middleScore: string;
  before: string;
  after: string;
  pts: string;
  goalProgress: string;
  winsTitle: string;
  noWins: string;
  winsThisRoundTitle: string;
  winsSinceEnrollmentTitle: string;
  targetsTitle: string;
  targetsThisRoundTitle: string;
  targetsSinceEnrollmentTitle: string;
  noTargets: string;
  utilTitle: string;
  utilEmpty: string;
  utilPayTo30: string;
  utilPayTo10: string;
  positiveTitle: string;
  positiveDefault: string;
  roadmapTitle: (round: number) => string;
  scoreGoal: string;
  gapRemaining: string;
  fileStrength: string;
  actionPlanTitle: string;
  ownerOfg: string;
  ownerClient: string;
  croaTitle: string;
  footer: string;
  page2Header: string;
  page3Header: string;
  reportDates: (before: string, after: string) => string;
  bureauTu: string;
  bureauEx: string;
  bureauEq: string;
  change: string;
  milestones: string;
  tradeline: string;
  funding: string;
  pageOf: (n: number, total: number) => string;
};

const LABELS: Record<"en" | "es", PdfLabels> = {
  en: {
    progressReport: (name) => `Progress Report — ${name}`,
    scoreOverview: "Score progress at a glance",
    middleScore: "Middle score",
    before: "Before",
    after: "After",
    pts: "pts",
    goalProgress: "Progress toward goal",
    winsTitle: "What came off your report (Wins)",
    noWins: "No wins detected — verify against source PDFs.",
    winsThisRoundTitle: "This round (vs prior report)",
    winsSinceEnrollmentTitle: "Since you started (vs enrollment)",
    targetsTitle: "Still on report (Round targets)",
    targetsThisRoundTitle: "Still on report — this round focus",
    targetsSinceEnrollmentTitle: "Still on report — since enrollment",
    noTargets: "None detected",
    utilTitle: "Credit utilization",
    utilEmpty: "Utilization details will appear when account data is available.",
    utilPayTo30: "Pay to 30%",
    utilPayTo10: "Pay to 10%",
    positiveTitle: "Positive accounts working in your favor",
    positiveDefault: "On-time payment history on open accounts",
    roadmapTitle: (round) => `Round ${round} roadmap`,
    scoreGoal: "Score goal",
    gapRemaining: "Gap remaining",
    fileStrength: "File strength",
    actionPlanTitle: "Your action plan",
    ownerOfg: "OFG",
    ownerClient: "You",
    croaTitle: "CROA disclosure",
    footer: "optimum-financial-group.com  |  (949) 736-5644",
    page2Header: "Utilization & what's working",
    page3Header: "Roadmap & action plan",
    reportDates: (b, a) => `Report dates: ${b}  →  ${a}`,
    bureauTu: "TransUnion",
    bureauEx: "Experian",
    bureauEq: "Equifax",
    change: "Change",
    milestones: "Milestones",
    tradeline: "Tradeline recommendation",
    funding: "Funding readiness",
    pageOf: (n, total) => `${n} / ${total}`,
  },
  es: {
    progressReport: (name) => `Informe de Progreso — ${name}`,
    scoreOverview: "Progreso de puntajes de un vistazo",
    middleScore: "Puntaje medio",
    before: "Antes",
    after: "Despues",
    pts: "pts",
    goalProgress: "Progreso hacia la meta",
    winsTitle: "Lo que salio de su reporte (Victorias)",
    noWins: "No se detectaron victorias — verifique los PDFs fuente.",
    winsThisRoundTitle: "Esta ronda (vs reporte anterior)",
    winsSinceEnrollmentTitle: "Desde que empezo (vs inscripcion)",
    targetsTitle: "Aun en el reporte (Objetivos de la ronda)",
    targetsThisRoundTitle: "Aun en el reporte — enfoque de esta ronda",
    targetsSinceEnrollmentTitle: "Aun en el reporte — desde la inscripcion",
    noTargets: "Ninguno detectado",
    utilTitle: "Utilizacion de credito",
    utilEmpty:
      "Los detalles de utilizacion apareceran cuando haya datos de cuentas.",
    utilPayTo30: "Pagar al 30%",
    utilPayTo10: "Pagar al 10%",
    positiveTitle: "Cuentas positivas a su favor",
    positiveDefault: "Historial de pagos puntuales en cuentas abiertas",
    roadmapTitle: (round) => `Hoja de ruta — Ronda ${round}`,
    scoreGoal: "Meta de puntaje",
    gapRemaining: "Brecha restante",
    fileStrength: "Fortaleza del archivo",
    actionPlanTitle: "Su plan de accion",
    ownerOfg: "OFG",
    ownerClient: "Usted",
    croaTitle: "Divulgacion CROA",
    footer: "optimum-financial-group.com  |  (949) 736-5644",
    page2Header: "Utilizacion y lo que funciona",
    page3Header: "Hoja de ruta y plan de accion",
    reportDates: (b, a) => `Fechas del informe: ${b}  ->  ${a}`,
    bureauTu: "TransUnion",
    bureauEx: "Experian",
    bureauEq: "Equifax",
    change: "Cambio",
    milestones: "Hitos",
    tradeline: "Recomendacion de tradeline",
    funding: "Preparacion para fondeo",
    pageOf: (n, total) => `${n} / ${total}`,
  },
};

function resolveLocale(data: OfGReportData): "en" | "es" {
  return data.locale === "es" ? "es" : "en";
}

/** StandardFonts (Helvetica) use WinAnsi — normalize unsafe glyphs. */
export function toPdfSafeText(input: string): string {
  return String(input ?? "")
    .replace(/\u2192|\u21D2|\u2794|\u27A1/g, "->")
    .replace(/\u2190|\u21D0/g, "<-")
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/\u2022|\u00B7|\u25CF|\u25E6/g, "*")
    .replace(/\u2026/g, "...")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\u00A0/g, " ")
    .replace(/—/g, "-")
    // Tabs/newlines are not WinAnsi-encodable (pdf-lib throws 0x0009 / 542004).
    .replace(/[\t\r\n\f\v]+/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Official white OFG wordmark (logo_with_title_white.png) — inlined for Vercel. */
const OFG_LOGO_HEADER_PNG_B64 =
  "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";

let cachedLogoBytes: Uint8Array | null | undefined;

async function loadOfgLogoBytes(): Promise<Uint8Array | null> {
  if (cachedLogoBytes !== undefined) return cachedLogoBytes;

  try {
    cachedLogoBytes = Uint8Array.from(
      Buffer.from(OFG_LOGO_HEADER_PNG_B64, "base64"),
    );
    return cachedLogoBytes;
  } catch {
    /* fall through to disk / CDN */
  }

  const candidates = [
    path.join(process.cwd(), "docs", "assets", "ofg-logo-header.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        cachedLogoBytes = new Uint8Array(fs.readFileSync(p));
        return cachedLogoBytes;
      }
    } catch {
      /* try next */
    }
  }
  try {
    const res = await fetch(LOGO_CDN);
    if (res.ok) {
      cachedLogoBytes = new Uint8Array(await res.arrayBuffer());
      return cachedLogoBytes;
    }
  } catch {
    /* fall through */
  }
  // Do not cache hard failure — next request can retry CDN/disk.
  return null;
}

function scoreTone(after: number, before: number) {
  const delta = after - before;
  if (delta > 0) return GREEN;
  if (delta < 0) return RED;
  return MUTED;
}

function utilTone(pct: number) {
  if (pct <= 30) return GREEN;
  if (pct <= 50) return AMBER;
  return RED;
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function scorePct(score: number) {
  return clamp01((score - 300) / 550);
}

function fmtMoney(n: number) {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const safe = toPdfSafeText(text);
  const words = safe.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export async function generateOfgProgressReportPdf(
  data: OfGReportData,
  fileNameHint: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const locale = resolveLocale(data);
  const L = LABELS[locale];
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logo: PDFImage | null = null;
  const logoBytes = await loadOfgLogoBytes();
  if (logoBytes) {
    try {
      logo = await pdf.embedPng(logoBytes);
    } catch {
      try {
        logo = await pdf.embedJpg(logoBytes);
      } catch {
        logo = null;
      }
    }
  }

  const dateLocale = locale === "es" ? "es-US" : "en-US";
  const monthYear = new Date()
    .toLocaleDateString(dateLocale, { month: "short", year: "numeric" })
    .replace(" ", "");
  const fileName =
    fileNameHint ||
    `${data.client.firstName}_OFG_Progress_Report_${monthYear}.pdf`;

  const W = 612;
  const H = 792;
  const M = 36;
  const CONTENT_W = W - M * 2;
  const HEADER_H = 80;
  const TOTAL_PAGES = 3;

  const drawText = (
    page: PDFPage,
    text: string,
    opts: {
      x: number;
      y: number;
      size: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      maxWidth?: number;
    },
  ) => {
    const f = opts.font ?? font;
    const safe = toPdfSafeText(text);
    const clipped =
      opts.maxWidth != null
        ? (() => {
            let s = safe;
            while (
              s.length > 0 &&
              f.widthOfTextAtSize(s, opts.size) > opts.maxWidth!
            ) {
              s = s.slice(0, -1);
            }
            return s;
          })()
        : safe;
    page.drawText(clipped, {
      x: opts.x,
      y: opts.y,
      size: opts.size,
      font: f,
      color: opts.color ?? GRAY,
    });
  };

  const drawHeader = (page: PDFPage, title: string) => {
    page.drawRectangle({
      x: 0,
      y: H - HEADER_H,
      width: W,
      height: HEADER_H,
      color: NAVY,
    });
    page.drawRectangle({
      x: 0,
      y: H - HEADER_H - 3,
      width: W,
      height: 3,
      color: GOLD,
    });
    let titleX = M;
    if (logo) {
      const logoH = 44;
      const logoW = (logo.width / logo.height) * logoH;
      const logoY = H - HEADER_H + (HEADER_H - logoH) / 2 + 2;
      page.drawImage(logo, {
        x: M,
        y: logoY,
        width: logoW,
        height: logoH,
      });
      titleX = M + logoW + 16;
    } else {
      drawText(page, "Optimum Financial Group", {
        x: M,
        y: H - HEADER_H + 28,
        size: 13,
        font: fontBold,
        color: GOLD,
      });
      titleX = M;
    }
    drawText(page, title, {
      x: titleX,
      y: H - HEADER_H + (logo ? 30 : 14),
      size: 9,
      color: WHITE,
      maxWidth: W - titleX - M,
    });
  };

  const drawFooter = (page: PDFPage, pageNum: number) => {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: W,
      height: 36,
      color: LIGHT,
    });
    page.drawRectangle({
      x: 0,
      y: 36,
      width: W,
      height: 1,
      color: BORDER,
    });
    drawText(page, L.footer, {
      x: M,
      y: 14,
      size: 8,
      color: MUTED,
    });
    const pageLabel = L.pageOf(pageNum, TOTAL_PAGES);
    const pw = font.widthOfTextAtSize(pageLabel, 8);
    drawText(page, pageLabel, {
      x: W - M - pw,
      y: 14,
      size: 8,
      color: MUTED,
    });
  };

  const drawCard = (
    page: PDFPage,
    x: number,
    yBottom: number,
    w: number,
    h: number,
  ) => {
    page.drawRectangle({
      x,
      y: yBottom,
      width: w,
      height: h,
      color: WHITE,
      borderColor: BORDER,
      borderWidth: 1,
    });
  };

  const drawBar = (
    page: PDFPage,
    x: number,
    y: number,
    w: number,
    h: number,
    pct: number,
    fill: ReturnType<typeof rgb>,
  ) => {
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      color: rgb(0.93, 0.94, 0.96),
    });
    const filled = Math.max(2, w * clamp01(pct));
    page.drawRectangle({
      x,
      y,
      width: filled,
      height: h,
      color: fill,
    });
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const beforeDate = data.reportDate?.before || todayIso;
  const afterDate = data.reportDate?.after || todayIso;
  const midBefore = data.middleScore.before;
  const midAfter = data.middleScore.after;
  const midDelta = midAfter - midBefore;
  const midSign = midDelta >= 0 ? "+" : "";
  const goal = data.roadmap.scoreGoal || 720;
  const goalPct = clamp01((midAfter - 300) / Math.max(1, goal - 300));

  const bureaus: Array<{
    label: string;
    before: number;
    after: number;
  }> = [
    {
      label: L.bureauTu,
      before: data.bureauScores.transunion.before,
      after: data.bureauScores.transunion.after,
    },
    {
      label: L.bureauEx,
      before: data.bureauScores.experian.before,
      after: data.bureauScores.experian.after,
    },
    {
      label: L.bureauEq,
      before: data.bureauScores.equifax.before,
      after: data.bureauScores.equifax.after,
    },
  ];

  // ── Page 1: scores + wins + targets ─────────────────────────────────────
  {
    const page = pdf.addPage([W, H]);
    drawHeader(page, L.progressReport(data.client.firstName));
    drawFooter(page, 1);
    let y = H - HEADER_H - 28;

    drawText(page, L.scoreOverview, {
      x: M,
      y,
      size: 14,
      font: fontBold,
      color: NAVY,
    });
    y -= 16;
    drawText(page, L.reportDates(beforeDate, afterDate), {
      x: M,
      y,
      size: 9,
      color: MUTED,
    });
    y -= 18;

    // Middle score hero card
    const heroH = 88;
    drawCard(page, M, y - heroH, CONTENT_W, heroH);
    page.drawRectangle({
      x: M,
      y: y - heroH,
      width: 5,
      height: heroH,
      color: GOLD,
    });
    drawText(page, L.middleScore, {
      x: M + 18,
      y: y - 22,
      size: 9,
      font: fontBold,
      color: MUTED,
    });
    drawText(page, `${midBefore}`, {
      x: M + 18,
      y: y - 48,
      size: 22,
      font: fontBold,
      color: MUTED,
    });
    drawText(page, L.before, {
      x: M + 18,
      y: y - 64,
      size: 8,
      color: MUTED,
    });
    drawText(page, "->", {
      x: M + 90,
      y: y - 44,
      size: 16,
      font: fontBold,
      color: GOLD,
    });
    drawText(page, `${midAfter}`, {
      x: M + 120,
      y: y - 48,
      size: 28,
      font: fontBold,
      color: NAVY,
    });
    drawText(page, L.after, {
      x: M + 120,
      y: y - 64,
      size: 8,
      color: MUTED,
    });

    const deltaLabel = `${midSign}${midDelta} ${L.pts}`;
    const deltaW = Math.max(72, fontBold.widthOfTextAtSize(deltaLabel, 12) + 20);
    const deltaX = W - M - 18 - deltaW;
    page.drawRectangle({
      x: deltaX,
      y: y - 52,
      width: deltaW,
      height: 28,
      color: midDelta >= 0 ? rgb(0.9, 0.98, 0.93) : rgb(0.99, 0.92, 0.92),
      borderColor: midDelta >= 0 ? GREEN : RED,
      borderWidth: 1,
    });
    drawText(page, deltaLabel, {
      x: deltaX + 10,
      y: y - 42,
      size: 12,
      font: fontBold,
      color: midDelta >= 0 ? GREEN : RED,
    });

    drawText(page, L.goalProgress, {
      x: M + 250,
      y: y - 22,
      size: 8,
      color: MUTED,
    });
    drawBar(page, M + 250, y - 72, 140, 8, goalPct, GOLD);
    drawText(page, `${midAfter} / ${goal}`, {
      x: M + 250,
      y: y - 58,
      size: 9,
      font: fontBold,
      color: NAVY,
    });
    y -= heroH + 16;

    // Bureau score cards
    const cardGap = 10;
    const cardW = (CONTENT_W - cardGap * 2) / 3;
    const cardH = 118;
    bureaus.forEach((b, i) => {
      const x = M + i * (cardW + cardGap);
      const bottom = y - cardH;
      drawCard(page, x, bottom, cardW, cardH);
      const delta = b.after - b.before;
      const sign = delta >= 0 ? "+" : "";
      const tone = scoreTone(b.after, b.before);
      drawText(page, b.label, {
        x: x + 12,
        y: y - 18,
        size: 9,
        font: fontBold,
        color: MUTED,
      });
      drawText(page, `${b.after}`, {
        x: x + 12,
        y: y - 44,
        size: 22,
        font: fontBold,
        color: NAVY,
      });
      drawText(page, `${L.before} ${b.before}`, {
        x: x + 12,
        y: y - 60,
        size: 8,
        color: MUTED,
      });
      drawText(page, `${sign}${delta} ${L.pts}`, {
        x: x + 12,
        y: y - 76,
        size: 11,
        font: fontBold,
        color: tone,
      });
      drawBar(
        page,
        x + 12,
        bottom + 14,
        cardW - 24,
        7,
        scorePct(b.after),
        tone,
      );
    });
    y -= cardH + 18;

    // Wins — dual tables when this-round vs since-enrollment differ
    const winsThis = data.winsThisRound ?? data.wins;
    const winsSince = data.winsSinceEnrollment ?? data.wins;
    const showDualWins =
      JSON.stringify(winsThis.map((w) => w.itemRemoved)) !==
      JSON.stringify(winsSince.map((w) => w.itemRemoved));

    const drawWinsBlock = (
      title: string,
      rows: typeof data.wins,
      maxRows: number,
    ) => {
      drawText(page, title, {
        x: M,
        y,
        size: 11,
        font: fontBold,
        color: NAVY,
      });
      y -= 12;
      if (!rows.length) {
        drawText(page, L.noWins, { x: M, y: y - 4, size: 8, color: MUTED });
        y -= 16;
        return;
      }
      for (let i = 0; i < Math.min(rows.length, maxRows); i++) {
        const w = rows[i];
        const rowH = 24;
        if (y - rowH < 50) break;
        drawCard(page, M, y - rowH, CONTENT_W, rowH);
        page.drawEllipse({
          x: M + 14,
          y: y - rowH / 2,
          xScale: 4,
          yScale: 4,
          color: GREEN,
        });
        const line = `${w.itemRemoved}  ·  ${w.bureaus.join("/")}  ·  ${w.status}`;
        drawText(page, line, {
          x: M + 28,
          y: y - 15,
          size: 8,
          color: GRAY,
          maxWidth: CONTENT_W - 40,
        });
        y -= rowH + 4;
      }
      y -= 6;
    };

    if (showDualWins) {
      drawWinsBlock(L.winsThisRoundTitle, winsThis, 4);
      drawWinsBlock(L.winsSinceEnrollmentTitle, winsSince, 4);
    } else {
      drawWinsBlock(L.winsTitle, data.wins, 6);
    }

    const targetsThis = data.targetsThisRound ?? data.targets;
    const targetsSince = data.targetsSinceEnrollment ?? data.targets;
    const showDualTargets =
      JSON.stringify(targetsThis.map((t) => t.item)) !==
      JSON.stringify(targetsSince.map((t) => t.item));

    drawText(page, showDualTargets ? L.targetsSinceEnrollmentTitle : L.targetsTitle, {
      x: M,
      y,
      size: 11,
      font: fontBold,
      color: NAVY,
    });
    y -= 14;
    const targetSource = showDualTargets ? targetsSince : data.targets;
    const targetLines = targetSource.length
      ? targetSource.slice(0, 5).map((t, i) => {
          const pri = t.priority ? ` [${t.priority}]` : "";
          return `${i + 1}. ${t.item}${pri}`;
        })
      : [L.noTargets];
    for (const line of targetLines) {
      if (y < 50) break;
      drawText(page, line, {
        x: M,
        y,
        size: 9,
        color: GRAY,
        maxWidth: CONTENT_W,
      });
      y -= 14;
    }
    if (showDualTargets && targetsThis.length) {
      y -= 4;
      drawText(page, L.targetsThisRoundTitle, {
        x: M,
        y,
        size: 10,
        font: fontBold,
        color: NAVY,
      });
      y -= 12;
      for (const [i, t] of targetsThis.slice(0, 3).entries()) {
        if (y < 50) break;
        const pri = t.priority ? ` [${t.priority}]` : "";
        drawText(page, `${i + 1}. ${t.item}${pri}`, {
          x: M,
          y,
          size: 8,
          color: GRAY,
          maxWidth: CONTENT_W,
        });
        y -= 12;
      }
    }
  }

  // ── Page 2: utilization + positive ──────────────────────────────────────
  {
    const page = pdf.addPage([W, H]);
    drawHeader(page, L.page2Header);
    drawFooter(page, 2);
    let y = H - HEADER_H - 28;

    drawText(page, L.utilTitle, {
      x: M,
      y,
      size: 14,
      font: fontBold,
      color: NAVY,
    });
    y -= 16;

    if (!data.utilization.length) {
      drawText(page, L.utilEmpty, { x: M, y, size: 9, color: MUTED });
      y -= 24;
    } else {
      for (const u of data.utilization.slice(0, 8)) {
        const rowH = 56;
        if (y - rowH < 80) break;
        drawCard(page, M, y - rowH, CONTENT_W, rowH);
        drawText(page, u.account, {
          x: M + 12,
          y: y - 16,
          size: 10,
          font: fontBold,
          color: NAVY,
          maxWidth: CONTENT_W * 0.55,
        });
        drawText(
          page,
          `${fmtMoney(u.balance)} / ${fmtMoney(u.limit)}  ·  ${u.pctUsed}%`,
          {
            x: M + CONTENT_W * 0.55,
            y: y - 16,
            size: 9,
            font: fontBold,
            color: utilTone(u.pctUsed),
          },
        );
        drawBar(
          page,
          M + 12,
          y - 34,
          CONTENT_W - 24,
          8,
          u.pctUsed / 100,
          utilTone(u.pctUsed),
        );
        drawText(
          page,
          `${L.utilPayTo30}: ${fmtMoney(u.payTo30)}   ${L.utilPayTo10}: ${fmtMoney(u.payTo10)}`,
          {
            x: M + 12,
            y: y - 48,
            size: 8,
            color: MUTED,
          },
        );
        y -= rowH + 8;
      }
    }

    y -= 8;
    drawText(page, L.positiveTitle, {
      x: M,
      y,
      size: 12,
      font: fontBold,
      color: NAVY,
    });
    y -= 14;
    const positives = data.positiveAccounts.length
      ? data.positiveAccounts
      : [L.positiveDefault];
    for (const p of positives.slice(0, 10)) {
      if (y < 50) break;
      const lines = wrapText(`* ${p}`, font, 9, CONTENT_W);
      for (const line of lines) {
        if (y < 50) break;
        drawText(page, line, { x: M, y, size: 9, color: GRAY });
        y -= 13;
      }
      y -= 2;
    }

    // Mini comparison chart (before vs after bars for middle + bureaus)
    if (y > 160) {
      y -= 10;
      drawText(page, L.change, {
        x: M,
        y,
        size: 12,
        font: fontBold,
        color: NAVY,
      });
      y -= 10;
      const chartH = 110;
      drawCard(page, M, y - chartH, CONTENT_W, chartH);
      const series = [
        { label: "Mid", before: midBefore, after: midAfter },
        ...bureaus.map((b) => ({
          label: b.label.slice(0, 3),
          before: b.before,
          after: b.after,
        })),
      ];
      const groupW = CONTENT_W / series.length;
      series.forEach((s, i) => {
        const gx = M + i * groupW + 16;
        const maxBar = 70;
        const bb = scorePct(s.before) * maxBar;
        const ba = scorePct(s.after) * maxBar;
        const base = y - chartH + 28;
        page.drawRectangle({
          x: gx,
          y: base,
          width: 12,
          height: bb,
          color: rgb(0.75, 0.78, 0.84),
        });
        page.drawRectangle({
          x: gx + 16,
          y: base,
          width: 12,
          height: ba,
          color: scoreTone(s.after, s.before),
        });
        drawText(page, s.label, {
          x: gx,
          y: base - 14,
          size: 8,
          color: MUTED,
        });
      });
    }
  }

  // ── Page 3: roadmap + action + CROA ─────────────────────────────────────
  {
    const page = pdf.addPage([W, H]);
    drawHeader(page, L.page3Header);
    drawFooter(page, 3);
    let y = H - HEADER_H - 28;

    drawText(page, L.roadmapTitle(data.roadmap.currentRound), {
      x: M,
      y,
      size: 14,
      font: fontBold,
      color: NAVY,
    });
    y -= 16;

    const roadH = 78;
    drawCard(page, M, y - roadH, CONTENT_W, roadH);
    drawText(page, L.scoreGoal, {
      x: M + 14,
      y: y - 20,
      size: 9,
      color: MUTED,
    });
    drawText(page, `${goal}`, {
      x: M + 14,
      y: y - 42,
      size: 22,
      font: fontBold,
      color: NAVY,
    });
    drawText(page, L.gapRemaining, {
      x: M + 120,
      y: y - 20,
      size: 9,
      color: MUTED,
    });
    drawText(page, `${data.roadmap.gapRemaining} ${L.pts}`, {
      x: M + 120,
      y: y - 42,
      size: 18,
      font: fontBold,
      color: GOLD,
    });
    drawBar(page, M + 14, y - 66, CONTENT_W - 28, 10, goalPct, GOLD);
    y -= roadH + 14;

    // File strength
    const fsH = 64;
    drawCard(page, M, y - fsH, CONTENT_W, fsH);
    const strength = Math.min(100, Math.max(0, data.fileStrengthScore || 0));
    drawText(page, L.fileStrength, {
      x: M + 14,
      y: y - 22,
      size: 10,
      font: fontBold,
      color: MUTED,
    });
    drawText(page, `${strength} / 100`, {
      x: M + 14,
      y: y - 44,
      size: 18,
      font: fontBold,
      color: NAVY,
    });
    const strengthTone =
      strength >= 70 ? GREEN : strength >= 45 ? AMBER : RED;
    drawBar(
      page,
      M + 140,
      y - 40,
      CONTENT_W - 168,
      12,
      strength / 100,
      strengthTone,
    );
    y -= fsH + 14;

    if (data.roadmap.milestones?.length) {
      drawText(page, L.milestones, {
        x: M,
        y,
        size: 11,
        font: fontBold,
        color: NAVY,
      });
      y -= 14;
      for (const m of data.roadmap.milestones.slice(0, 5)) {
        if (y < 120) break;
        const lines = wrapText(`* ${m}`, font, 9, CONTENT_W);
        for (const line of lines) {
          drawText(page, line, { x: M, y, size: 9, color: GRAY });
          y -= 12;
        }
      }
      y -= 6;
    }

    drawText(page, L.actionPlanTitle, {
      x: M,
      y,
      size: 12,
      font: fontBold,
      color: NAVY,
    });
    y -= 12;
    for (const a of data.actionPlan.slice(0, 6)) {
      if (y < 110) break;
      const owner =
        a.owner === "ofg" ? L.ownerOfg : L.ownerClient;
      const rowH = 26;
      drawCard(page, M, y - rowH, CONTENT_W, rowH);
      page.drawRectangle({
        x: M + 8,
        y: y - rowH + 6,
        width: 36,
        height: 14,
        color: a.owner === "ofg" ? NAVY : GOLD,
      });
      drawText(page, owner, {
        x: M + 12,
        y: y - 16,
        size: 7,
        font: fontBold,
        color: WHITE,
      });
      drawText(page, `${a.step}. ${a.description}`, {
        x: M + 52,
        y: y - 16,
        size: 9,
        color: GRAY,
        maxWidth: CONTENT_W - 64,
      });
      y -= rowH + 6;
    }

    if (data.tradelineRecommendation) {
      y -= 4;
      drawText(page, L.tradeline, {
        x: M,
        y,
        size: 10,
        font: fontBold,
        color: NAVY,
      });
      y -= 12;
      const tLines = wrapText(
        `${data.tradelineRecommendation.code}: ${data.tradelineRecommendation.projectedImpact}`,
        font,
        9,
        CONTENT_W,
      );
      for (const line of tLines) {
        drawText(page, line, { x: M, y, size: 9, color: GRAY });
        y -= 12;
      }
    }
    if (data.fundingReadinessNote) {
      y -= 4;
      drawText(page, L.funding, {
        x: M,
        y,
        size: 10,
        font: fontBold,
        color: NAVY,
      });
      y -= 12;
      for (const line of wrapText(
        data.fundingReadinessNote,
        font,
        9,
        CONTENT_W,
      )) {
        drawText(page, line, { x: M, y, size: 9, color: GRAY });
        y -= 12;
      }
    }

    y = Math.min(y - 8, 130);
    drawText(page, L.croaTitle, {
      x: M,
      y,
      size: 10,
      font: fontBold,
      color: NAVY,
    });
    y -= 12;
    for (const line of wrapText(data.croaDisclosure || "", font, 7.5, CONTENT_W)) {
      if (y < 48) break;
      drawText(page, line, { x: M, y, size: 7.5, color: MUTED });
      y -= 10;
    }
  }

  const bytes = await pdf.save();
  return { buffer: Buffer.from(bytes), fileName };
}

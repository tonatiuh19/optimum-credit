/**
 * OFG Credit Analysis PDF (Phase 2) — branded, multi-page, built from
 * CreditAnalysisData (api/creditAnalysisFromFile.ts). Same brand as the
 * Progress Report (navy header + gold rule, logo, footer) with a flowing
 * layout (auto page breaks) so any file size renders cleanly.
 *
 * Pure: logo bytes are passed in. Inlined into api/index.ts by
 * scripts/inline-credit-file-engine.mjs (no sibling runtime imports).
 */
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { BUREAUS, type Bureau } from "./creditFile";
import type { ProgressEnhancement } from "./creditFileProgress";
import {
  parseReportDate,
  type AnalysisNegative,
  type AnalysisRound,
  type CreditAnalysisData,
  type ProjectionMilestone,
} from "./creditAnalysisFromFile";

/** Brand palette (namespaced — api/index.ts already has NAVY/GOLD consts). */
const OFG_PDF = {
  navy: rgb(0.051, 0.122, 0.235),
  gold: rgb(0.788, 0.659, 0.298),
  text: rgb(0.2, 0.22, 0.26),
  muted: rgb(0.45, 0.47, 0.52),
  light: rgb(0.973, 0.976, 0.98),
  border: rgb(0.886, 0.91, 0.941),
  white: rgb(1, 1, 1),
  green: rgb(0.09, 0.64, 0.29),
  red: rgb(0.86, 0.15, 0.15),
  amber: rgb(0.85, 0.55, 0.13),
  goldTint: rgb(0.99, 0.97, 0.9),
  redTint: rgb(0.995, 0.94, 0.94),
};

export interface CreditAnalysisPdfOptions {
  clientName: string;
  lang: "en" | "es";
  logoPng?: Uint8Array | null;
  /** Program prices / links shown in the recommendation box. */
  program: { standardPrice: string; complexPrice: string; enrollUrl: string; phone: string; site: string };
}

type Labels = ReturnType<typeof analysisLabels>;

function analysisLabels(lang: "en" | "es") {
  const es = lang === "es";
  return {
    lang,
    originalCreditor: es ? "acreedor orig." : "orig.",
    title: es ? "Analisis de Credito" : "Credit Analysis Report",
    reportDate: es ? "Fecha del reporte" : "Report date",
    s1: es ? "1. Puntajes actuales y resumen del archivo" : "1. Current Scores + File Overview",
    s2: es ? "2. Cuentas negativas - orden de disputa" : "2. Negative Accounts - Dispute Priority",
    s3: es ? "3. Desglose completo de cuentas" : "3. Complete Account Breakdown",
    s4: es ? "4. Proyeccion de puntaje y lineas comerciales" : "4. Projected Score Progression + Tradelines",
    s5: es ? "5. Plan de accion y fortaleza del archivo" : "5. Personalized Action Plan + File Strength",
    scoreSnapshot: es ? "PUNTAJES" : "SCORE SNAPSHOT",
    fileOverview: es ? "RESUMEN DEL ARCHIVO" : "FILE OVERVIEW",
    bureau: es ? "Buro" : "Bureau",
    score: es ? "Puntaje" : "Score",
    rating: es ? "Calificacion" : "Rating",
    notReported: es ? "Sin datos" : "Not reported",
    metric: es ? "Metrica" : "Metric",
    totalAccounts: es ? "Cuentas totales" : "Total accounts",
    positive: es ? "Positivas / al corriente" : "Positive / in good standing",
    negative: es ? "Negativas" : "Negative",
    inquiries: es ? "Consultas (2 anos)" : "Hard inquiries (2 years)",
    utilization: es ? "Utilizacion revolvente" : "Revolving utilization",
    avgAge: es ? "Antiguedad promedio" : "Average account age",
    oldest: es ? "Cuenta mas antigua" : "Oldest account",
    revLimit: es ? "Limite revolvente total" : "Total open revolving limit",
    balances: es ? "Saldos reportados" : "Total balances reported",
    flagged: es ? "ALERTA" : "FLAGGED",
    missingBureau: (b: string) =>
      es
        ? `${b} no devolvio datos: no hay puntaje, cuentas ni consultas. Normalmente es un congelamiento o el buro no se consulto. Levante el congelamiento y saque un reporte de 3 buros antes de disputar.`
        : `${b} returned no data: no score, tradelines or inquiries. This usually means a security freeze or the bureau was not pulled. Lift any freeze and pull a fresh 3-bureau report before filing disputes.`,
    keyObs: es ? "OBSERVACIONES CLAVE" : "KEY OBSERVATIONS",
    roundIntro: es
      ? "Ordenado de mas facil a mas dificil. Rondas de 30 dias; solo se disputa informacion inexacta o no verificable."
      : "Ordered easiest to hardest to remove. Rounds run on 30-day cycles; only inaccurate or unverifiable reporting is disputed.",
    roundTitle: (r: AnalysisRound) =>
      ({
        1: es ? "RONDA 1 - CONSULTAS" : "ROUND 1 - INQUIRIES",
        2: es ? "RONDA 2 - COBRANZAS DE TERCEROS" : "ROUND 2 - THIRD-PARTY COLLECTIONS",
        3: es ? "RONDA 3 - INCONSISTENCIAS ENTRE BUROS" : "ROUND 3 - BUREAU INCONSISTENCIES",
        4: es ? "RONDA 4 - CARGOS A PERDIDA / ATRASOS" : "ROUND 4 - CHARGE-OFFS + LATE PAYMENTS",
      })[r],
    hold: es ? "EN ESPERA - NOTA DE DISPUTA DEL CONSUMIDOR" : "ON HOLD - CONSUMER-DISPUTE REMARK ON FILE",
    holdNote: es
      ? "Estas cuentas muestran 'no disputada' pero las observaciones aun tienen una nota de disputa. Confirme que no hay disputa abierta, pida retirar la nota y luego dispute en la ronda indicada."
      : "These accounts show 'not disputed' while the remarks still carry a dispute notation. Confirm no dispute is open, request removal of the stale notation, then file in the round shown.",
    creditor: es ? "Acreedor" : "Creditor",
    type: es ? "Tipo" : "Type",
    bureaus: es ? "Buros" : "Bureaus",
    detail: es ? "Detalle" : "Detail",
    date: es ? "Fecha" : "Date",
    milestoneHeader: es ? "Etapa" : "Milestone",
    impact: es ? "Impacto estimado" : "Expected impact",
    legal: es ? "Base legal" : "Legal basis",
    noTargets: es ? "Sin objetivos en esta ronda." : "No targets in this round.",
    inquiryAgesOff: (d: string) => (es ? `Se elimina sola el ${d}. No se disputa.` : `Ages off on its own ${d}. No dispute needed.`),
    inquiryPermissible: es ? "Vinculada a una cuenta abierta (proposito permitido). No es objetivo." : "Tied to an opened account (permissible purpose). Not a target.",
    inquiryDispute: es ? "Sin cuenta relacionada - disputar." : "No matching account - dispute.",
    negativesTable: es ? "SECCION A - CUENTAS NEGATIVAS" : "SECTION A - NEGATIVE / DEROGATORY ACCOUNTS",
    positivesTable: es ? "SECCION B - CUENTAS POSITIVAS" : "SECTION B - POSITIVE ACCOUNTS",
    utilTable: es ? "SECCION C - UTILIZACION" : "SECTION C - UTILIZATION BREAKDOWN",
    opened: es ? "Apertura" : "Opened",
    balance: es ? "Saldo" : "Balance",
    status: es ? "Estado" : "Status",
    priority: es ? "Ronda" : "Round",
    limit: es ? "Limite" : "Limit",
    used: es ? "% usado" : "% Used",
    to30: es ? "Saldo para 30%" : "Balance for 30%",
    to10: es ? "Saldo para 10%" : "Balance for 10%",
    orLess: es ? "o menos" : "or less",
    alreadyOk: es ? "Ya esta bien" : "Already OK",
    totalDerog: (v: string) => (es ? `Saldo total negativo: ${v}.` : `Total derogatory balances: ${v}.`),
    utilNote: es
      ? "Utilizacion = saldo / limite x 100. Mas de 30% resta puntos; menos de 10% da el maximo beneficio. Cada tarjeta cuenta por separado ademas del total."
      : "Utilization = Balance / Credit Limit x 100. Over 30% costs points; under 10% earns the maximum benefit. Scoring models weigh each card individually as well as the total.",
    projTitle: es ? "PROGRESION ESTIMADA POR RONDA" : "ESTIMATED SCORE PROGRESSION BY ROUND",
    projNote: es
      ? "Las proyecciones son estimaciones basadas en las cuentas de este reporte. Los resultados reales varian."
      : "Projections are estimates based on the items in this report. Actual results vary by bureau response and how the file is maintained.",
    milestone: (k: ProjectionMilestone["key"], escrow: boolean) =>
      ({
        current: es ? "Actual" : "Current",
        round1: escrow
          ? es ? "Despues del cierre + Ronda 1 (consultas)" : "After closing + Round 1 (inquiries)"
          : es ? "Ronda 1 - Consultas" : "Round 1 - Inquiries",
        round2: es ? "Ronda 2 - Cobranzas" : "Round 2 - Collections",
        round3: es ? "Ronda 3 - Exactitud entre buros" : "Round 3 - Bureau accuracy",
        round4: es ? "Ronda 4 + linea AU" : "Round 4 + AU tradeline",
      })[k],
    tradelineTitle: es ? "RECOMENDACION DE LINEAS COMERCIALES" : "TRADELINE RECOMMENDATION",
    tlPrimary: es ? "Linea revolvente primaria (banco)" : "Primary revolving line (major bank)",
    tlAu: es ? "Linea AU (usuario autorizado) antigua y de alto limite" : "Aged, high-limit AU tradeline",
    tlPrimaryImpact: es ? "+15-25 pts con historial puntual" : "+15-25 pts as on-time history builds",
    tlAuImpact: es ? "+20-40 pts (estimado)" : "+20-40 pts (estimated)",
    actionTitle: es ? "PLAN DE ACCION" : "ACTION PLAN",
    strengthTitle: es ? "FORTALEZA DEL ARCHIVO" : "FILE STRENGTH SCORE",
    factor: es ? "Factor (20 pts c/u)" : "Factor (20 pts each)",
    current: es ? "Actual" : "Current",
    post: es ? "Despues" : "Post-repair",
    factorName: (k: string) =>
      ({
        revolving: es ? "Cuentas revolventes abiertas" : "Open revolving accounts",
        installment: es ? "Mezcla de prestamos" : "Installment mix",
        mortgage: es ? "Hipoteca" : "Mortgage account",
        age: es ? "Antiguedad" : "Account age",
        derogatory: es ? "Cuentas negativas" : "Derogatory items",
      })[k] ?? k,
    total: es ? "TOTAL" : "TOTAL",
    programTitle: es ? "PROGRAMA RECOMENDADO" : "RECOMMENDED PROGRAM",
    programName: (t: string, price: string) =>
      t === "complex" ? (es ? `Reparacion Compleja - ${price}` : `Complex Repair - ${price}`) : es ? `Reparacion Estandar - ${price}` : `Standard Repair - ${price}`,
    enroll: es ? "Inscribase" : "Enroll",
    croaTitle: es ? "DIVULGACION CROA" : "CROA DISCLOSURE",
    croa: es
      ? "Optimum Financial Group presta servicios de reparacion de credito conforme a la Ley de Organizaciones de Reparacion de Credito (CROA), 15 U.S.C. \u00a71679 y ss. No garantizamos mejoras especificas de puntaje. Los resultados varian segun la persona. Este analisis se basa en la informacion proporcionada y no constituye asesoria legal."
      : "Optimum Financial Group provides credit repair services in compliance with the Credit Repair Organizations Act (CROA), 15 U.S.C. \u00a71679 et seq. We do not guarantee specific score improvements. Results vary by individual. This analysis is based on information provided and does not constitute legal advice.",
    escrowTitle: es ? "ESCROW ACTIVO - DISPUTAS EN ESPERA HASTA EL CIERRE" : "ACTIVE ESCROW - DISPUTE FILING ON HOLD UNTIL CLOSING",
    escrowBody: (pulls: string) =>
      es
        ? `El cliente esta en escrow de una hipoteca.${pulls ? ` Las consultas ${pulls} son la solicitud activa del prestamo y NO son objetivos de disputa.` : ""} No se presentan disputas, cuentas nuevas ni lineas comerciales hasta despues del cierre: las notas de disputa pueden provocar revision del suscriptor. Los prestamistas usan modelos FICO hipotecarios, por lo que sus puntajes seran distintos a los VantageScore de este reporte.`
        : `Client is currently in escrow on a mortgage.${pulls ? ` The ${pulls} inquiries are the active loan pull and are NOT dispute targets.` : ""} No disputes, new accounts or tradelines until after closing - dispute remarks on tradelines can trigger underwriting review. Lenders use FICO mortgage models, so the lender's scores will differ from the VantageScore figures above.`,
    lenderTitle: es ? "PUNTAJE DEL PRESTAMISTA" : "LENDER SCORE",
    lenderBody: (model: string, score: string, target: string) =>
      es
        ? `El prestamista usa ${model}: puntaje medio actual ${score}${target ? `; necesita ${target}` : ""}. Los puntajes de este reporte son de otro modelo y no se comparan uno a uno.`
        : `The lender uses ${model}: current middle score ${score}${target ? `; needs ${target}` : ""}. The scores in this report come from a different model and do not compare one-to-one.`,
    posNeg: es ? "Positivas / negativas" : "Positive / Negative",
    utilOpen: es ? "Utilizacion (tarjetas abiertas)" : "Revolving utilization (open cards)",
    utilInclClosed: es ? "Utilizacion incl. tarjetas cerradas con saldo" : "Utilization incl. closed cards with balances",
    pubColl: es ? "Registros publicos / cobranzas" : "Public records / Collections",
    cluster: (from: string, to: string, n: number) =>
      es ? `Grupo de consultas ${from}${to !== from ? ` - ${to}` : ""} (${n} consultas)` : `${from}${to !== from ? ` - ${to}` : ""} inquiry cluster (${n} inquiries)`,
    clusterNote: (older: boolean) =>
      es
        ? `Mismo dia / dias seguidos con varios prestamistas.${older ? " Mas de 12 meses (peso minimo)." : ""} Disputar las que sigan sin proposito permitido.`
        : `Same-day / back-to-back pulls across lenders.${older ? " Over 12 months old (minimal score weight)." : ""} Dispute any still reporting with no permissible purpose.`,
    excluded: es ? "Excluida" : "Excluded",
    excludedMatch: es ? "Coincide con una cuenta abierta - proposito permitido. No es objetivo." : "Matches an opened account - permissible purpose. Not a target.",
    excludedLoan: es ? "Solicitud de hipoteca activa - proposito permitido. No es objetivo." : "Active mortgage application - permissible purpose. Not a target.",
    noneOnFile: es ? "Nada en el archivo." : "None on file.",
    noCollections: es ? "Ningun buro reporta cuentas en cobranza." : "No collection accounts reported by any bureau.",
    identityItem: es ? "Datos personales" : "Personal info",
    identityAction: es ? "Corregir para que coincida con la identificacion verificada." : "Correct to match verified ID.",
    updateItem: (type: string) => (es ? `${type} (positiva)` : `${type} (positive)`),
    updateNote: es ? "Solo actualizacion de exactitud - NO es objetivo de eliminacion." : "Accuracy update only - NOT a deletion target.",
    fallbackNote: es
      ? "Si la Ronda 3 vuelve 'verificada', escalar con disputa directa al proveedor sobre la exactitud del historial de pagos y el saldo."
      : "If Round 3 returns 'verified', escalate with a direct furnisher dispute challenging payment-history accuracy and balance reporting.",
    fileAfterClosing: es ? "La presentacion empieza despues del cierre." : "Filing begins after closing.",
    closedRound: (r: number) => (es ? `Cuenta cerrada - Ronda ${r}` : `Closed account - Round ${r}`),
    totalOpen: es ? "Total (tarjetas abiertas)" : "Total (open cards)",
    totalInclClosed: es ? "Total incl. cerradas" : "Total incl. closed",
    tlLevel: es ? "Nivel" : "Level",
    tlPrice: es ? "Precio" : "Price",
    tlTiming: es ? "Cuando" : "Timing",
    tlNow: es ? "Ahora" : "Now",
    tlAfterClosing: es ? "Despues del cierre" : "After closing",
    tlType: (code: string) =>
      code === "primary" ? (es ? "Linea primaria (Chase / Navy Federal)" : "Primary line (Chase / Navy Federal)") : es ? "Linea AU" : "AU tradeline",
    tlWhyTitle: es ? "POR QUE FUNCIONA PARA ESTE ARCHIVO" : "WHY THIS WORKS FOR THIS FILE",
    confidential: es
      ? "Confidencial - preparado para el cliente nombrado. Las proyecciones son estimaciones."
      : "Confidential - prepared for the named client. Projections are estimates, not guarantees.",
    page: (n: number) => (es ? `Pagina ${n}` : `Page ${n}`),
    years: (m: number) => (es ? `${Math.floor(m / 12)} a ${m % 12} m` : `${Math.floor(m / 12)} yrs ${m % 12} mo`),
    kind: (k: string) =>
      ({
        collection: es ? "Cobranza" : "Collection",
        charge_off: es ? "Cargo a perdida" : "Charge-off",
        late: es ? "Pagos atrasados" : "Late payments",
        repossession: es ? "Reposesion" : "Repossession",
        public_record: es ? "Registro publico" : "Public record",
        derogatory: es ? "Negativa" : "Derogatory",
      })[k] ?? k,
  };
}

const BUREAU_NAME: Record<Bureau, string> = { TU: "TransUnion", EX: "Experian", EQ: "Equifax" };

/** WinAnsi-safe text (Helvetica standard font). */
export function pdfSafe(input: string): string {
  return String(input ?? "")
    .replace(/[–—―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

function pdfMoney(n: number | null | undefined): string {
  return n === null || n === undefined ? "--" : `$${Math.round(n).toLocaleString("en-US")}`;
}

function scoreRating(s: number, es: boolean): string {
  if (s >= 740) return es ? "Excelente" : "Excellent";
  if (s >= 670) return es ? "Bueno" : "Good";
  if (s >= 580) return es ? "Regular" : "Fair";
  return es ? "Bajo" : "Poor";
}

/** Flowing page writer: header/footer per page, auto page breaks. */
class PageFlow {
  page!: PDFPage;
  y = 0;
  pageNo = 0;
  readonly W = 612;
  readonly H = 792;
  readonly M = 40;
  readonly contentW = 612 - 80;
  readonly bottom = 64;

  constructor(
    private pdf: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    private logo: PDFImage | null,
    private headerTitle: string,
    private headerSub: string,
    private L: Labels,
    private footerLine: string,
    private pageLabel: (n: number) => string = (n) => L.page(n),
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.pdf.addPage([this.W, this.H]);
    this.pageNo++;
    const p = this.page;
    p.drawRectangle({ x: 0, y: this.H - 72, width: this.W, height: 72, color: OFG_PDF.navy });
    p.drawRectangle({ x: 0, y: this.H - 75, width: this.W, height: 3, color: OFG_PDF.gold });
    let tx = this.M;
    if (this.logo) {
      const h = 38;
      const w = (this.logo.width / this.logo.height) * h;
      p.drawImage(this.logo, { x: this.M, y: this.H - 72 + 17, width: w, height: h });
      tx = this.M + w + 16;
    }
    this.text(this.headerTitle, tx, this.H - 34, 12, { font: this.bold, color: OFG_PDF.white });
    this.text(this.headerSub, tx, this.H - 50, 8.5, { color: rgb(0.85, 0.87, 0.92) });
    p.drawRectangle({ x: 0, y: 0, width: this.W, height: 40, color: OFG_PDF.light });
    this.text(this.footerLine, this.M, 24, 7.5, { color: OFG_PDF.muted });
    this.text(this.L.confidential, this.M, 13, 7, { color: OFG_PDF.muted });
    const pl = this.pageLabel(this.pageNo);
    this.text(pl, this.W - this.M - this.font.widthOfTextAtSize(pl, 7.5), 24, 7.5, { color: OFG_PDF.muted });
    this.y = this.H - 96;
  }

  ensure(h: number) {
    if (this.y - h < this.bottom) this.newPage();
  }

  text(
    s: string,
    x: number,
    y: number,
    size: number,
    o: { font?: PDFFont; color?: ReturnType<typeof rgb>; maxWidth?: number } = {},
  ) {
    const f = o.font ?? this.font;
    let t = pdfSafe(s);
    if (o.maxWidth) while (t.length > 1 && f.widthOfTextAtSize(t, size) > o.maxWidth) t = t.slice(0, -2) + ".";
    this.page.drawText(t, { x, y, size, font: f, color: o.color ?? OFG_PDF.text });
  }

  wrap(s: string, size: number, maxW: number, f: PDFFont = this.font): string[] {
    const words = pdfSafe(s).split(" ").filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  section(title: string) {
    this.ensure(40);
    this.y -= 6;
    this.text(title, this.M, this.y, 13, { font: this.bold, color: OFG_PDF.navy });
    this.page.drawRectangle({ x: this.M, y: this.y - 6, width: 46, height: 2, color: OFG_PDF.gold });
    this.y -= 22;
  }

  subhead(title: string) {
    this.ensure(30);
    this.text(title, this.M, this.y, 8.5, { font: this.bold, color: OFG_PDF.muted });
    this.y -= 13;
  }

  paragraph(s: string, size = 8.5, color = OFG_PDF.text) {
    for (const line of this.wrap(s, size, this.contentW)) {
      this.ensure(size + 4);
      this.text(line, this.M, this.y, size, { color });
      this.y -= size + 3.5;
    }
    this.y -= 4;
  }

  bullet(s: string) {
    const lines = this.wrap(s, 8.5, this.contentW - 12);
    lines.forEach((line, i) => {
      this.ensure(12);
      if (i === 0) this.page.drawCircle({ x: this.M + 3, y: this.y + 3, size: 1.6, color: OFG_PDF.gold });
      this.text(line, this.M + 12, this.y, 8.5);
      this.y -= 12;
    });
    this.y -= 2;
  }

  callout(title: string, body: string, tone: "warn" | "info" = "info") {
    const lines = this.wrap(body, 8.5, this.contentW - 20);
    const h = 22 + lines.length * 12;
    this.ensure(h + 6);
    const top = this.y + 8;
    this.page.drawRectangle({
      x: this.M,
      y: top - h,
      width: this.contentW,
      height: h,
      color: tone === "warn" ? OFG_PDF.redTint : OFG_PDF.goldTint,
      borderColor: tone === "warn" ? OFG_PDF.red : OFG_PDF.gold,
      borderWidth: 0.8,
    });
    this.text(title, this.M + 10, top - 14, 8.5, { font: this.bold, color: tone === "warn" ? OFG_PDF.red : OFG_PDF.navy });
    let yy = top - 27;
    for (const line of lines) {
      this.text(line, this.M + 10, yy, 8.5);
      yy -= 12;
    }
    this.y = top - h - 10;
  }

  /** Table with wrapped cells; widths are fractions of content width. */
  table(headers: string[], rows: string[][], widths: number[], o: { size?: number } = {}) {
    const size = o.size ?? 7.8;
    const colW = widths.map((w) => w * this.contentW);
    const drawHeader = () => {
      this.ensure(18);
      this.page.drawRectangle({ x: this.M, y: this.y - 5, width: this.contentW, height: 16, color: OFG_PDF.navy });
      let x = this.M + 4;
      headers.forEach((h, i) => {
        this.text(h, x, this.y, size, { font: this.bold, color: OFG_PDF.white, maxWidth: colW[i] - 6 });
        x += colW[i];
      });
      this.y -= 16;
    };
    drawHeader();
    rows.forEach((row, ri) => {
      const cells = row.map((c, i) => this.wrap(c, size, colW[i] - 8));
      const h = Math.max(...cells.map((c) => c.length)) * (size + 3) + 6;
      if (this.y - h < this.bottom) {
        this.newPage();
        drawHeader();
      }
      if (ri % 2 === 1) {
        this.page.drawRectangle({ x: this.M, y: this.y - h + size + 1, width: this.contentW, height: h, color: OFG_PDF.light });
      }
      let x = this.M + 4;
      cells.forEach((lines, i) => {
        let yy = this.y;
        for (const line of lines) {
          this.text(line, x, yy, size);
          yy -= size + 3;
        }
        x += colW[i];
      });
      this.y -= h;
    });
    this.y -= 8;
  }

  scoreBar(label: string, score: number | null, extra: string) {
    this.ensure(18);
    this.text(label, this.M, this.y, 8.5, { font: this.bold });
    const bx = this.M + 140;
    const bw = 220;
    this.page.drawRectangle({ x: bx, y: this.y - 1, width: bw, height: 8, color: OFG_PDF.border });
    if (score !== null) {
      const pct = Math.min(1, Math.max(0, (score - 300) / 550));
      const color = score >= 670 ? OFG_PDF.green : score >= 580 ? OFG_PDF.amber : OFG_PDF.red;
      this.page.drawRectangle({ x: bx, y: this.y - 1, width: bw * pct, height: 8, color });
    }
    this.text(extra, bx + bw + 12, this.y, 8.5, { color: OFG_PDF.muted });
    this.y -= 16;
  }
}

/** Spanish labels for the rule-generated inconsistency prefixes. */
const INCONSISTENCY_ES: Array<[RegExp, string]> = [
  [/^Date opened:/, "Fecha de apertura:"],
  [/^Balance:/, "Saldo:"],
  [/^Last activity:/, "Ultima actividad:"],
  [/^Payment status:/, "Estado de pago:"],
  [/^Late counts \(30\/60\/90\):/, "Atrasos (30/60/90):"],
];

function negativeDetail(n: AnalysisNegative, L: Labels): string {
  const parts = [n.status];
  if (n.originalCreditor) parts.push(`${L.originalCreditor} ${n.originalCreditor}`);
  if (n.inconsistencies.length) {
    parts.push(
      n.inconsistencies
        .map((i) =>
          L.lang === "es"
            ? INCONSISTENCY_ES.reduce((acc, [re, es]) => acc.replace(re, es), i).replace(/ vs /g, " vs ")
            : i,
        )
        .join("; "),
    );
  }
  return `${parts.join(" - ")}${n.balance !== null ? ` (${pdfMoney(n.balance)})` : ""}`;
}

export async function generateOfgCreditAnalysisPdf(
  data: CreditAnalysisData,
  opts: CreditAnalysisPdfOptions,
): Promise<Buffer> {
  const L = analysisLabels(opts.lang);
  const es = opts.lang === "es";
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (opts.logoPng) {
    try {
      logo = await pdf.embedPng(opts.logoPng);
    } catch {
      logo = null;
    }
  }
  const sub = `${opts.clientName}  |  ${L.reportDate}: ${data.reportDate ?? "--"}${data.scoreModel ? `  |  ${data.scoreModel}` : ""}`;
  const f = new PageFlow(pdf, font, bold, logo, `${L.title}`, sub, L, `Optimum Financial Group  |  ${opts.program.phone}  |  ${opts.program.site}`);
  const active = BUREAUS.filter((b) => !data.missingBureaus.includes(b));

  // ── 1. Scores + overview ────────────────────────────────────────────────
  f.section(L.s1);
  f.subhead(L.scoreSnapshot);
  for (const b of BUREAUS) {
    const s = data.scores[b];
    // The rating PRINTED on the report wins; computed band only as a fallback.
    const rating = data.scoreRatings?.[b] || (s === null ? "" : scoreRating(s, es));
    f.scoreBar(BUREAU_NAME[b], s, s === null ? L.notReported : `${s}  ${rating}`);
  }
  f.y -= 4;
  if (data.escrow?.active) {
    const pulls = [...new Set((data.escrow.loanInquiries ?? []).map((q) => `${q.date} ${q.creditor}`))].join(", ");
    f.callout(L.escrowTitle, L.escrowBody(pulls), "warn");
  }
  if (data.lender && data.lender.score) {
    f.callout(
      L.lenderTitle,
      L.lenderBody(data.lender.model || "FICO", String(data.lender.score), data.lender.target ? String(data.lender.target) : ""),
    );
  }
  f.subhead(L.fileOverview);
  const ov = (fn: (b: Bureau) => string) => BUREAUS.map((b) => (data.overview[b].reported ? fn(b) : "--"));
  const collections = (b: Bureau) => data.negatives.filter((n) => n.kind === "collection" && n.bureaus.includes(b)).length;
  const publicRecords = (b: Bureau) => data.negatives.filter((n) => n.kind === "public_record" && n.bureaus.includes(b)).length;
  const closedWithBalance = data.utilization.filter((u) => u.closed);
  f.table(
    [L.metric, ...BUREAUS.map((b) => BUREAU_NAME[b])],
    [
      [L.totalAccounts, ...ov((b) => String(data.overview[b].totalAccounts))],
      [L.posNeg, ...ov((b) => `${data.overview[b].positive} / ${data.overview[b].negative}`)],
      [L.inquiries, ...ov((b) => String(data.overview[b].hardInquiries))],
      [
        L.utilOpen,
        ...ov((b) => {
          const o = data.overview[b];
          return o.utilizationPct === null ? "--" : `${o.utilizationPct}%`;
        }),
      ],
      ...(closedWithBalance.length
        ? [
            [
              L.utilInclClosed,
              ...ov((b) => {
                const o = data.overview[b];
                // Closed cards still carrying a balance on THIS bureau.
                const extra = data.negatives
                  .filter((n) => n.bureaus.includes(b))
                  .map((n) => closedWithBalance.find((u) => u.account === n.creditor))
                  .filter((u): u is NonNullable<typeof u> => !!u);
                if (!extra.length) return "N/A";
                const lim = o.revolvingLimit + extra.reduce((s, u) => s + u.limit, 0);
                const bal = o.revolvingBalance + extra.reduce((s, u) => s + u.balance, 0);
                return lim > 0 ? `${Math.round((bal / lim) * 100)}%` : "--";
              }),
            ],
          ]
        : []),
      [L.avgAge, ...ov((b) => (data.overview[b].avgAgeMonths === null ? "--" : L.years(data.overview[b].avgAgeMonths!)))],
      [L.oldest, ...ov((b) => (data.overview[b].oldest ? data.overview[b].oldest!.opened : "--"))],
      [L.pubColl, ...ov((b) => `${publicRecords(b)} / ${collections(b)}`)],
      [L.revLimit, ...ov((b) => pdfMoney(data.overview[b].revolvingLimit))],
    ],
    [0.31, 0.23, 0.23, 0.23],
  );
  for (const b of data.missingBureaus) {
    f.callout(`${L.flagged} - ${BUREAU_NAME[b].toUpperCase()}`, L.missingBureau(BUREAU_NAME[b]), "warn");
  }
  f.subhead(L.keyObs);
  for (const obs of keyObservations(data, es)) f.bullet(obs);

  // ── 2. Dispute plan (Round 1 → 4, easiest first) ────────────────────────
  f.ensure(180);
  f.section(L.s2);
  f.paragraph(`${L.roundIntro}${data.escrow?.active ? ` ${L.fileAfterClosing}` : ""}`, 8.5, OFG_PDF.muted);

  // Round 1: clusters, standalone targets, then exclusions with the reason.
  f.subhead(L.roundTitle(1));
  const r1Rows: string[][] = [];
  for (const c of data.inquiryClusters ?? []) {
    r1Rows.push([
      L.cluster(c.from, c.to, c.count),
      BUREAUS.filter((b) => c.perBureau[b]).map((b) => `${b} ${c.perBureau[b]}`).join(" / "),
      L.clusterNote(c.older12m),
      LEGAL_ROUND1,
    ]);
  }
  for (const q of data.inquiries.filter((x) => !x.clusterId && x.action !== "permissible")) {
    r1Rows.push([
      `${q.creditor} (${q.date})`,
      q.bureau,
      q.action === "ages_off" ? L.inquiryAgesOff(q.agesOff ?? "--") : L.inquiryDispute,
      q.action === "ages_off" ? "--" : LEGAL_ROUND1,
    ]);
  }
  const excludedSeen = new Set<string>();
  for (const q of data.inquiries.filter((x) => x.action === "permissible")) {
    const k = `${q.creditor}|${q.date}`;
    if (excludedSeen.has(k)) continue;
    excludedSeen.add(k);
    const bureaus = data.inquiries.filter((x) => x.creditor === q.creditor && x.date === q.date).map((x) => x.bureau);
    r1Rows.push([
      `${L.excluded}: ${q.creditor} (${q.date})`,
      bureaus.join(" / "),
      q.excludedReason === "active_loan" ? L.excludedLoan : L.excludedMatch,
      "--",
    ]);
  }
  if (r1Rows.length) f.table([L.creditor, L.bureaus, L.detail, L.legal], r1Rows, [0.3, 0.14, 0.4, 0.16]);
  else f.paragraph(L.noneOnFile, 8.5, OFG_PDF.muted);

  // Round 2: third-party collections only.
  f.subhead(L.roundTitle(2));
  const r2 = data.negatives.filter((n) => n.round === 2 && !n.hold);
  if (r2.length) {
    f.table(
      [L.creditor, L.type, L.bureaus, L.detail, L.legal],
      r2.map((n) => [n.creditor, L.kind(n.kind), n.bureaus.join(", "), negativeDetail(n, L), n.legalBasis]),
      [0.22, 0.13, 0.1, 0.38, 0.17],
    );
  } else f.paragraph(`${L.noneOnFile} ${L.noCollections}`, 8.5, OFG_PDF.muted);

  // Round 3: inconsistencies + personal info + positive-account accuracy updates.
  f.subhead(L.roundTitle(3));
  const r3: string[][] = data.negatives
    .filter((n) => n.round === 3 && !n.hold)
    .map((n) => [n.creditor, L.kind(n.kind), n.bureaus.join(", "), negativeDetail(n, L), n.legalBasis]);
  const idByBureau = new Map<Bureau, string[]>();
  for (const flag of data.identityFlags ?? []) {
    idByBureau.set(flag.bureau, [...(idByBureau.get(flag.bureau) ?? []), flag.detail]);
  }
  for (const [b, details] of idByBureau) {
    r3.push([`${BUREAU_NAME[b]} ${L.identityItem.toLowerCase()}`, L.identityItem, b, `${details.join("; ")}. ${L.identityAction}`, "FCRA §611"]);
  }
  for (const u of data.accuracyUpdates ?? []) {
    r3.push([u.creditor, L.updateItem(u.type ?? L.type), u.bureaus.join(", "), `${u.inconsistencies.join("; ")}. ${L.updateNote}`, "FCRA §611, §623"]);
  }
  if (r3.length) f.table([L.creditor, L.type, L.bureaus, L.detail, L.legal], r3, [0.22, 0.13, 0.1, 0.38, 0.17]);
  else f.paragraph(L.noneOnFile, 8.5, OFG_PDF.muted);

  // Round 4: charge-offs / original-creditor derogatories + fallback for Round 3.
  f.subhead(L.roundTitle(4));
  const r4 = data.negatives.filter((n) => n.round === 4 && !n.hold);
  const fallback = data.negatives.filter((n) => n.round === 3 && !n.hold);
  const r4Rows = [
    ...r4.map((n) => [n.creditor, L.kind(n.kind), n.bureaus.join(", "), negativeDetail(n, L), n.legalBasis]),
    ...fallback.map((n) => [n.creditor, L.kind(n.kind), n.bureaus.join(", "), L.fallbackNote, "FCRA §611, §623"]),
  ];
  if (r4Rows.length) f.table([L.creditor, L.type, L.bureaus, L.detail, L.legal], r4Rows, [0.22, 0.13, 0.1, 0.38, 0.17]);
  else f.paragraph(L.noneOnFile, 8.5, OFG_PDF.muted);

  const held = data.negatives.filter((n) => n.hold);
  if (held.length) {
    f.subhead(L.hold);
    f.table(
      [L.creditor, L.type, L.bureaus, L.detail, L.priority],
      held.map((n) => [n.creditor, L.kind(n.kind), n.bureaus.join(", "), negativeDetail(n, L), `R${n.round}`]),
      [0.24, 0.13, 0.1, 0.43, 0.1],
    );
    f.paragraph(L.holdNote, 7.8, OFG_PDF.muted);
  }

  // ── 3. Account tables ───────────────────────────────────────────────────
  f.ensure(180);
  f.section(L.s3);
  f.subhead(L.negativesTable);
  const openedTime = (d: string | null) => parseReportDate(d)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const oldestFirst = [...data.negatives].sort((a, b) => openedTime(a.opened) - openedTime(b.opened));
  const negRows = oldestFirst.map((n) => [
    n.opened ?? "--",
    n.creditor,
    L.kind(n.kind),
    n.bureaus.join(", "),
    negativeDetail(n, L),
    n.hold ? `HOLD > R${n.round}` : n.round === 3 ? "R3 / R4" : `R${n.round}`,
  ]);
  if (negRows.length) f.table([L.opened, L.creditor, L.type, L.bureaus, L.status, L.priority], negRows, [0.1, 0.2, 0.13, 0.1, 0.35, 0.12]);
  else f.paragraph(L.noneOnFile, 8.5, OFG_PDF.muted);
  f.subhead(L.positivesTable);
  f.table(
    [L.creditor, L.type, L.bureaus, L.opened, L.limit, L.balance, L.status],
    data.positives.map((p) => [p.creditor, p.type ?? "--", p.bureaus.join(", "), p.opened ?? "--", pdfMoney(p.limit), pdfMoney(p.balance), p.status ?? "--"]),
    [0.25, 0.14, 0.11, 0.11, 0.12, 0.12, 0.15],
  );
  f.subhead(L.utilTable);
  const target = (u: (typeof data.utilization)[number], cap: number) =>
    u.derogatory ? L.closedRound(data.negatives.find((n) => n.creditor === u.account)?.round ?? 3) : u.balance <= cap ? L.alreadyOk : `${pdfMoney(cap)} ${L.orLess}`;
  const uRows = data.utilization.map((u) => [
    `${u.account}${u.authorizedUser ? " (AU)" : ""}${u.closed ? (es ? " (cerrada)" : " (closed)") : ""}`,
    pdfMoney(u.limit),
    pdfMoney(u.balance),
    `${u.pctUsed}%`,
    target(u, u.payTo30),
    target(u, u.payTo10),
  ]);
  const totals = (rows: typeof data.utilization) => {
    const lim = rows.reduce((s, u) => s + u.limit, 0);
    const bal = rows.reduce((s, u) => s + u.balance, 0);
    return [pdfMoney(lim), pdfMoney(bal), lim > 0 ? `${Math.round((bal / lim) * 1000) / 10}%` : "--", `${pdfMoney(Math.floor(lim * 0.3))} ${L.orLess}`, `${pdfMoney(Math.floor(lim * 0.1))} ${L.orLess}`];
  };
  const openU = data.utilization.filter((u) => !u.closed);
  if (openU.length) uRows.push([L.totalOpen, ...totals(openU)]);
  if (openU.length !== data.utilization.length) uRows.push([L.totalInclClosed, ...totals(data.utilization)]);
  if (uRows.length) f.table([L.creditor, L.limit, L.balance, L.used, L.to30, L.to10], uRows, [0.3, 0.12, 0.12, 0.1, 0.18, 0.18]);
  f.paragraph(L.utilNote, 7.8, OFG_PDF.muted);

  // ── 4. Projections + tradelines ─────────────────────────────────────────
  f.ensure(180);
  f.section(L.s4);
  f.subhead(L.projTitle);
  f.paragraph(L.projNote, 7.8, OFG_PDF.muted);
  f.table(
    [L.milestoneHeader, ...active.map((b) => BUREAU_NAME[b])],
    data.projections.map((p) => [
      L.milestone(p.key, !!data.escrow?.active),
      ...active.map((b) => {
        const v = p.scores[b];
        return v === null ? "--" : p.key === "current" ? String(v) : `${v}+`;
      }),
    ]),
    [0.4, ...active.map(() => 0.6 / Math.max(1, active.length))],
  );
  if (data.tradelines?.length) {
    f.subhead(L.tradelineTitle);
    f.table(
      [L.type, L.tlLevel, L.impact, L.bureaus, L.tlTiming],
      data.tradelines.map((t) => [
        L.tlType(t.code),
        t.code === "primary" ? "--" : `${t.code}${t.price ? ` (${pdfMoney(t.price)})` : ""}`,
        t.impact,
        t.bureaus.join(", "),
        t.timing === "after_closing" ? L.tlAfterClosing : L.tlNow,
      ]),
      [0.26, 0.15, 0.3, 0.13, 0.16],
    );
    f.subhead(L.tlWhyTitle);
    f.paragraph(tradelineWhy(data, es));
  }

  // ── 5. Action plan + file strength + program ────────────────────────────
  f.ensure(180);
  f.section(L.s5);
  f.subhead(L.actionTitle);
  actionPlan(data, es).forEach((step, i) => f.bullet(`${i + 1}. ${step}`));
  f.subhead(L.strengthTitle);
  f.table(
    [L.factor, L.current, L.post],
    [
      ...data.fileStrength.factors.map((x) => [L.factorName(x.key), `${x.current} / 20`, `${x.postRepair} / 20`]),
      [L.total, `${data.fileStrength.current} / 100`, `${data.fileStrength.postRepair} / 100`],
    ],
    [0.5, 0.25, 0.25],
  );
  f.callout(
    L.programTitle,
    `${L.programName(data.programTier, data.programTier === "complex" ? opts.program.complexPrice : opts.program.standardPrice)}. ${L.enroll}: ${opts.program.enrollUrl}  |  ${opts.program.phone}`,
  );
  f.callout(L.croaTitle, L.croa);

  return Buffer.from(await pdf.save());
}

const LEGAL_ROUND1 = "FCRA §604, §611";

/** "Why this works" paragraph tied to this file's numbers. */
export function tradelineWhy(data: CreditAnalysisData, es: boolean): string {
  const openCards = data.utilization.filter((u) => !u.closed).length;
  const late = data.negatives.find((n) => n.kind === "late");
  const parts: string[] = [];
  parts.push(
    es
      ? `El archivo tiene ${openCards} ${openCards === 1 ? "tarjeta abierta" : "tarjetas abiertas"}${data.utilizationOverall.all !== null ? ` al ${data.utilizationOverall.all}% de utilizacion` : ""}.`
      : `This file has ${openCards} open ${openCards === 1 ? "card" : "cards"}${data.utilizationOverall.all !== null ? ` at ${data.utilizationOverall.all}% utilization` : ""}.`,
  );
  if (late) {
    parts.push(
      es
        ? `Con un perfil revolvente delgado, el atraso de ${late.creditor} pesa mucho; una linea AU antigua y de alto limite agrega historial limpio y diluye ese atraso.`
        : `With a thin revolving profile, the ${late.creditor} late carries outsized weight; a seasoned, high-limit AU line adds clean revolving history and dilutes it.`,
    );
  } else {
    parts.push(
      es
        ? "Una linea AU antigua y de alto limite multiplica el credito disponible y estabiliza la utilizacion."
        : "A seasoned, high-limit AU line multiplies available credit and stabilizes utilization.",
    );
  }
  if (data.escrow?.active) {
    parts.push(
      es
        ? "No se agregan cuentas ni lineas durante el escrow: cualquier cambio puede afectar la suscripcion."
        : "No new accounts or tradelines during escrow - any change to the file can disrupt underwriting.",
    );
  }
  return parts.join(" ");
}

/** Data-driven observations (no free text from the model). */
export function keyObservations(data: CreditAnalysisData, es: boolean): string[] {
  const out: string[] = [];
  const active = BUREAUS.filter((b) => !data.missingBureaus.includes(b));
  if (data.negatives.length) {
    for (const n of data.negatives.slice(0, 3)) {
      const missing = active.filter((b) => !n.bureaus.includes(b));
      out.push(
        es
          ? `${n.creditor}: ${n.status} en ${n.bureaus.join(", ")}${missing.length ? ` (no reportado a ${missing.join(", ")})` : ""}.`
          : `${n.creditor}: ${n.status} on ${n.bureaus.join(", ")}${missing.length ? ` (not reported to ${missing.join(", ")})` : ""}.`,
      );
    }
    if (data.negatives.length > 3) {
      out.push(es ? `${data.negatives.length - 3} cuentas negativas mas en la Seccion 3.` : `${data.negatives.length - 3} more derogatory accounts in Section 3.`);
    }
  } else {
    out.push(es ? "No se encontraron cuentas negativas." : "No derogatory tradelines found.");
  }
  // Score gap between bureaus explained by where an item reports.
  const scored = active.filter((b) => data.scores[b] !== null);
  if (scored.length >= 2 && data.negatives.length) {
    const hi = scored.reduce((a, b) => (data.scores[a]! >= data.scores[b]! ? a : b));
    const lo = scored.filter((b) => b !== hi && data.scores[hi]! - data.scores[b]! >= 40);
    const cause = data.negatives.find((n) => !n.bureaus.includes(hi) && lo.every((b) => n.bureaus.includes(b)));
    if (lo.length && cause) {
      out.push(
        es
          ? `${cause.creditor} explica que ${lo.join("/")} esten por debajo de ${hi}, que no lo reporta.`
          : `${cause.creditor} is the item holding ${lo.join("/")} below ${hi}, which does not report it.`,
      );
    }
  }
  for (const c of data.inquiryClusters ?? []) {
    out.push(
      es
        ? `Grupo de ${c.count} consultas de compra (${c.from}).`
        : `${c.count}-inquiry shopping cluster (${c.from}${c.to !== c.from ? ` - ${c.to}` : ""}).`,
    );
  }
  if ((data.identityFlags ?? []).length) {
    const bs = [...new Set(data.identityFlags.map((x) => x.bureau))];
    out.push(es ? `Variacion de datos personales en ${bs.join(", ")}.` : `Personal-information variation on ${bs.join(", ")}.`);
  }
  for (const u of data.accuracyUpdates ?? []) {
    out.push(es ? `${u.creditor} se reporta distinto entre buros (actualizar, no eliminar).` : `${u.creditor} reports inconsistently across bureaus (update, not a deletion).`);
  }
  const own = data.utilizationOverall.ownCardsOnly;
  if (own !== null && own > 30) {
    out.push(es ? `Sus tarjetas propias estan al ${own}% de utilizacion.` : `Own cards are at ${own}% utilization.`);
  }
  const held = data.negatives.filter((n) => n.hold).length;
  if (held) {
    out.push(
      es
        ? `${held} ${held === 1 ? "cuenta tiene" : "cuentas tienen"} nota de disputa del consumidor; ${held === 1 ? "queda" : "quedan"} EN ESPERA hasta confirmar y retirar la nota.`
        : `${held} ${held === 1 ? "negative carries a consumer-dispute remark and is" : "negatives carry consumer-dispute remarks and are"} placed on HOLD until the notation is cleared.`,
    );
  }
  return out.slice(0, 6);
}

/** Ordered, data-driven action plan: max 6 steps naming the real items. */
export function actionPlan(data: CreditAnalysisData, es: boolean): string[] {
  const steps: string[] = [];
  const names = (rows: Array<{ creditor: string }>) => [...new Set(rows.map((r) => r.creditor))].join(", ");
  if (data.escrow?.active) {
    steps.push(
      es
        ? "Proteger el cierre: sin disputas, cuentas nuevas ni lineas durante el escrow. Coordinar con el oficial de prestamos cualquier rescore."
        : "Protect the closing. No disputes, new accounts, or tradelines while in escrow. Coordinate with the loan officer on any lender-side rescore.",
    );
    steps.push(
      es
        ? "Reporte nuevo de 3 buros despues del cierre para confirmar estados y ver la nueva hipoteca."
        : "Fresh 3-bureau pull after closing to confirm current statuses and see the new mortgage reporting.",
    );
  }
  if (data.missingBureaus.length) {
    steps.push(
      es
        ? `Complete el reporte de 3 buros: levante cualquier congelamiento en ${data.missingBureaus.join(", ")} y saque un reporte nuevo.`
        : `Complete the 3-bureau pull: lift any freeze on ${data.missingBureaus.join(", ")} and pull a fresh report.`,
    );
  }
  const held = data.negatives.filter((n) => n.hold);
  if (held.length) {
    steps.push(es ? `Retire las notas de disputa en ${names(held)}.` : `Clear the hold items: confirm no open disputes and remove the notations on ${names(held)}.`);
  }
  const r1 = (data.inquiryClusters ?? []).length + data.inquiries.filter((q) => !q.clusterId && q.action === "dispute").length;
  if (r1) {
    const c = data.inquiryClusters?.[0];
    steps.push(
      es
        ? `Ronda 1 - Consultas: disputar ${c ? `el grupo de ${c.from}` : "las consultas"} que siga sin proposito permitido.`
        : `Round 1 - Inquiries: dispute ${c ? `the ${c.from} cluster inquiries` : "the inquiries"} still reporting without permissible purpose.`,
    );
  }
  const r2 = data.negatives.filter((n) => n.round === 2 && !n.hold);
  if (r2.length) steps.push(es ? `Ronda 2 - Cobranzas: ${names(r2)}.` : `Round 2 - Collections: ${names(r2)}.`);
  const r3 = data.negatives.filter((n) => n.round === 3 && !n.hold);
  const r3Extra = [
    ...((data.identityFlags ?? []).length ? [es ? "datos personales" : "personal-info variations"] : []),
    ...(data.accuracyUpdates ?? []).map((u) => (es ? `actualizar ${u.creditor}` : `update ${u.creditor}`)),
  ];
  if (r3.length || r3Extra.length) {
    const what = [...(r3.length ? [es ? `inconsistencias de ${names(r3)}` : `${names(r3)} cross-bureau inconsistencies`] : []), ...r3Extra].join("; ");
    steps.push(es ? `Ronda 3 - Exactitud: ${what}.` : `Round 3 - Accuracy: dispute ${what}.`);
  }
  const r4 = data.negatives.filter((n) => n.round === 4 && !n.hold);
  if (r4.length || r3.length) {
    steps.push(
      es
        ? `Ronda 4 - Escalar: ${names([...r4, ...r3])} con el proveedor si vuelven verificadas.`
        : `Round 4 - Escalation: ${names([...r4, ...r3])} directly with the furnisher if verified.`,
    );
  }
  const cards = data.utilization.filter((u) => !u.closed && !u.derogatory && !u.authorizedUser);
  const tl = data.tradelines?.find((t) => t.code === "IH-1");
  if (tl || cards.length) {
    const top = cards.sort((a, b) => b.pctUsed - a.pctUsed)[0];
    steps.push(
      es
        ? `Dar profundidad: ${tl ? "linea AU IH-1 y una linea primaria" : "mantener balances bajos"}${top ? `; mantener ${top.account} en ${pdfMoney(top.payTo10)} o menos` : ""}.`
        : `Build depth: ${tl ? "place the IH-1 AU tradeline and add a primary revolving line" : "keep balances low"}${top ? `; keep ${top.account} at or below ${pdfMoney(top.payTo10)}` : ""}.`,
    );
  }
  if (steps.length < 6) {
    steps.push(
      es
        ? "Mantenga todos los pagos a tiempo y evite nuevas solicitudes de credito durante el programa."
        : "Keep every account paid on time and avoid new credit applications during the program.",
    );
  }
  return steps.slice(0, 6);
}

// ── Progress Report enhancement pages (appended to the existing PDF) ──────

function progressLabels(lang: "en" | "es") {
  const es = lang === "es";
  return {
    title: es ? "Informe de Progreso - Detalle por cuenta" : "Progress Report - Account Detail",
    detailPage: (n: number) => (es ? `Detalle ${n}` : `Account detail ${n}`),
    section: es ? "Resultados cuenta por cuenta" : "Account-by-account results",
    tilesDeleted: es ? "cuentas negativas eliminadas de todos los buros" : "negative accounts deleted from every bureau",
    tilesListings: es ? "registros negativos (TU+EX+EQ)" : "derogatory listings (TU+EX+EQ combined)",
    tilesBalance: es ? "en saldos de cobranzas / cargos a perdida eliminados" : "in collection / charge-off balances removed",
    scores: es ? "PUNTAJES" : "SCORES",
    bureau: es ? "Buro" : "Bureau",
    start: es ? "Inicio" : "Start",
    current: es ? "Actual" : "Current",
    change: es ? "Cambio" : "Points gained",
    removedTitle: es ? "LO QUE SALIO DE SU REPORTE" : "WHAT CAME OFF YOUR REPORT",
    stillTitle: es ? "LO QUE SIGUE EN SU REPORTE (PROXIMOS OBJETIVOS)" : "WHAT IS STILL ON YOUR REPORT (NEXT TARGETS)",
    movedTitle: es ? "QUE MOVIO SU PUNTAJE" : "WHAT MOVED YOUR SCORE",
    item: es ? "Cuenta" : "Item",
    bureaus: es ? "Buros" : "Bureaus",
    impact: es ? "Impacto" : "Impact",
    status: es ? "Estado" : "Status",
    detail: es ? "Detalle" : "Detail",
    round: es ? "Ronda" : "Round",
    factor: es ? "Factor" : "Factor",
    effect: es ? "Efecto" : "Effect",
    positive: es ? "POSITIVO" : "POSITIVE",
    holding: es ? "LO FRENA" : "HOLDING BACK",
    removed: es ? "ELIMINADA" : "REMOVED",
    partial: es ? "PARCIAL" : "PARTIAL",
    stillOn: (b: string) => (es ? `sigue en ${b}` : `still on ${b}`),
    none: es ? "Nada que mostrar." : "Nothing to show.",
    high: es ? "ALTO" : "HIGH",
    medium: es ? "MEDIO" : "MEDIUM",
    kind: (k: string) =>
      ({
        collection: es ? "cobranza" : "collection",
        charge_off: es ? "cargo a perdida" : "charge-off",
        late: es ? "pagos atrasados" : "late payments",
        repossession: es ? "reposesion" : "repossession",
        public_record: es ? "registro publico" : "public record",
        derogatory: es ? "negativa" : "derogatory",
      })[k] ?? k,
    factorText: (f: ProgressEnhancement["factors"][number]): string => {
      const v = f.values;
      switch (f.code) {
        case "deleted":
          return es
            ? `${v.deleted} cuenta(s) negativa(s) eliminada(s)${Number(v.partial) ? `, ${v.partial} corregida(s) parcialmente` : ""}`
            : `${v.deleted} negative account(s) deleted${Number(v.partial) ? `, ${v.partial} partially corrected` : ""}`;
        case "limits_up":
          return es
            ? `Limites revolventes +$${Number(v.amount).toLocaleString("en-US")}`
            : `Revolving limits up $${Number(v.amount).toLocaleString("en-US")}`;
        case "util_down":
          return es ? `Utilizacion bajo de ${v.from}% a ${v.to}%` : `Utilization down from ${v.from}% to ${v.to}%`;
        case "util_up":
          return es ? `Utilizacion subio de ${v.from}% a ${v.to}%` : `Utilization up from ${v.from}% to ${v.to}%`;
        case "new_inquiries":
          return es ? `${v.count} consulta(s) nueva(s)` : `${v.count} new hard inquir${Number(v.count) === 1 ? "y" : "ies"}`;
        case "new_negative":
          return es
            ? `Nueva cuenta negativa: ${v.creditor} (${v.bureaus})`
            : `New negative: ${v.creditor} (${v.bureaus})`;
        default:
          return "";
      }
    },
  };
}

/**
 * Account-detail pages appended to the existing Progress Report PDF. Returns
 * a standalone PDF; the caller copies its pages onto the end of today's PDF.
 */
export async function generateProgressEnhancementPdf(
  enh: ProgressEnhancement,
  opts: { clientName: string; lang: "en" | "es"; logoPng?: Uint8Array | null; phone: string; site: string },
): Promise<Buffer> {
  const P = progressLabels(opts.lang);
  const L = analysisLabels(opts.lang);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (opts.logoPng) {
    try {
      logo = await pdf.embedPng(opts.logoPng);
    } catch {
      logo = null;
    }
  }
  const sub = `${opts.clientName}  |  ${enh.beforeDate ?? "--"} -> ${enh.afterDate ?? "--"}${enh.scoreModel ? `  |  ${enh.scoreModel}` : ""}`;
  const f = new PageFlow(pdf, font, bold, logo, P.title, sub, L, `Optimum Financial Group  |  ${opts.phone}  |  ${opts.site}`, P.detailPage);

  f.section(P.section);
  // Summary tiles.
  const tiles = [
    [String(enh.deletedCount), P.tilesDeleted],
    [`${enh.listings.before} -> ${enh.listings.after}`, P.tilesListings],
    [pdfMoney(enh.balanceRemoved), P.tilesBalance],
  ];
  const tw = (f.contentW - 16) / 3;
  f.ensure(64);
  tiles.forEach(([big, small], i) => {
    const x = f.M + i * (tw + 8);
    f.page.drawRectangle({ x, y: f.y - 44, width: tw, height: 56, color: OFG_PDF.light, borderColor: OFG_PDF.border, borderWidth: 0.8 });
    f.page.drawRectangle({ x, y: f.y + 10, width: tw, height: 2, color: OFG_PDF.gold });
    f.text(big, x + 10, f.y - 10, 16, { font: f.bold, color: OFG_PDF.navy, maxWidth: tw - 20 });
    f.wrap(small, 7.5, tw - 20).slice(0, 2).forEach((line, li) => {
      f.text(line, x + 10, f.y - 25 - li * 9, 7.5, { color: OFG_PDF.muted });
    });
  });
  f.y -= 62;

  f.subhead(P.scores);
  f.table(
    [P.bureau, P.start, P.current, P.change],
    BUREAUS.filter((b) => enh.scores[b].before !== null || enh.scores[b].after !== null).map((b) => {
      const { before, after } = enh.scores[b];
      const d = before !== null && after !== null ? after - before : null;
      return [BUREAU_NAME[b], before === null ? "--" : String(before), after === null ? "--" : String(after), d === null ? "--" : `${d >= 0 ? "+" : ""}${d}`];
    }),
    [0.34, 0.22, 0.22, 0.22],
  );

  f.subhead(P.removedTitle);
  if (enh.removed.length) {
    f.table(
      [P.item, P.bureaus, P.impact, P.status],
      enh.removed.map((r) => [
        `${r.creditor} - ${P.kind(r.kind)}${r.balance !== null ? `, ${pdfMoney(r.balance)}` : ""}`,
        r.removedFrom.join(" / "),
        r.impact === "HIGH" ? P.high : P.medium,
        r.status === "REMOVED" ? P.removed : `${P.partial} (${P.stillOn(r.stillOn.join("/"))})`,
      ]),
      [0.46, 0.16, 0.12, 0.26],
    );
  } else {
    f.paragraph(P.none, 8.5, OFG_PDF.muted);
  }

  f.subhead(P.stillTitle);
  const still = [...enh.stillReporting, ...enh.newNegatives];
  if (still.length) {
    f.table(
      [P.item, P.bureaus, P.detail, P.round],
      still.map((n) => [
        `${n.creditor} - ${P.kind(n.kind)}`,
        n.bureaus.join(" / "),
        `${n.status}${n.balance !== null ? `, ${pdfMoney(n.balance)}` : ""}`,
        n.hold ? `HOLD > R${n.round}` : `R${n.round}`,
      ]),
      [0.36, 0.16, 0.36, 0.12],
    );
  } else {
    f.paragraph(P.none, 8.5, OFG_PDF.muted);
  }

  if (enh.factors.length) {
    f.subhead(P.movedTitle);
    f.table(
      [P.factor, P.effect],
      enh.factors.map((x) => [P.factorText(x), x.effect === "positive" ? P.positive : P.holding]),
      [0.75, 0.25],
    );
  }
  return Buffer.from(await pdf.save());
}

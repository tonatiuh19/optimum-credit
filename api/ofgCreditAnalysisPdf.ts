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
  inGoodStanding,
  parseReportDate,
  PROJECTION_KEYS_MAX,
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
  /** Program prices / links (P0-11: program-specific enrollment link + MFSN sign-up). */
  program: {
    standardPrice: string;
    complexPrice: string;
    standardUrl: string;
    complexUrl: string;
    mfsnUrl?: string | null;
    phone: string;
    site: string;
  };
}

type Labels = ReturnType<typeof analysisLabels>;

function analysisLabels(lang: "en" | "es") {
  const es = lang === "es";
  return {
    lang,
    originalCreditor: es ? "acreedor orig." : "orig.",
    title: es ? "Analisis de Credito" : "Credit Analysis Report",
    reportDate: es ? "Fecha del reporte" : "Report date",
    source: es ? "Fuente" : "Source",
    s1: es ? "1. Puntajes y resumen del archivo" : "1. Scores + File Overview",
    s2: es ? "2. Prioridad de disputas" : "2. Dispute Priority",
    s3: es ? "3. Cuentas" : "3. Accounts",
    s4: es ? "4. Proyeccion de puntaje y lineas comerciales" : "4. Projected Scores + Tradelines",
    s5: es ? "5. Plan de accion, fortaleza y programa" : "5. Action Plan, File Strength + Program",
    scoreTable: es ? "PUNTAJES" : "SCORES",
    bureau: es ? "Buro" : "Bureau",
    score: es ? "Puntaje" : "Score",
    rating: es ? "Calificacion" : "Rating",
    vantage: "VantageScore",
    middle: es ? "Puntaje medio (el que usa el prestamista)" : "Middle score (what a lender uses)",
    notReported: es ? "Sin datos" : "Not reported",
    fileOverview: es ? "RESUMEN DEL ARCHIVO" : "FILE OVERVIEW",
    metric: es ? "Metrica" : "Metric",
    value: es ? "Valor" : "Value",
    accounts: es ? "Cuentas" : "Accounts",
    posNeg: es ? "Positivas / negativas" : "Positive / negative",
    inquiries: es ? "Consultas" : "Hard inquiries",
    notItemized: es ? "No detallado" : "Not itemized",
    utilization: es ? "Utilizacion revolvente" : "Revolving utilization",
    avgAge: es ? "Antiguedad promedio / mas antigua" : "Avg age / oldest",
    avgAgeOnly: es ? "Antiguedad promedio" : "Average account age",
    oldestOnly: es ? "Cuenta mas antigua" : "Oldest account",
    fileTotals: (t: number, wb: number, nt: number, na: number, pd: string) =>
      es
        ? `Archivo completo: ${t} cuentas (${wb} con saldo), ${nt} negativas${na !== nt ? ` (${na} cuentas unicas)` : ""}, ${pd} vencido.`
        : `Whole file: ${t} tradelines (${wb} with balances), ${nt} negative${na !== nt ? ` (${na} unique accounts)` : ""}, ${pd} past due.`,
    collCo: es ? "Cobranzas / cargos a perdida" : "Collections / charge-offs",
    pastDue: es ? "Vencido" : "Past due",
    publicRecords: es ? "Registros publicos" : "Public records",
    revLimit: es ? "Limite revolvente abierto" : "Open revolving limit",
    keyObs: es ? "OBSERVACIONES (SOLO HECHOS)" : "KEY OBSERVATIONS (FACTS ONLY)",
    activeTitle: es ? "ARCHIVO DE PRESTAMO ACTIVO" : "ACTIVE LOAN FILE",
    activeBody: (lender: string | null, date: string | null) =>
      es
        ? `${lender ? `${lender} consulto este reporte${date ? ` el ${date}` : ""}. ` : ""}Coordine el momento de las disputas con el oficial de prestamos. Sin cuentas nuevas hasta despues del cierre.`
        : `${lender ? `${lender} pulled this report${date ? ` on ${date}` : ""}. ` : ""}Coordinate dispute timing with the loan officer. No new credit until after closing.`,
    mortgageBody: (by: string | null, via: string | null, date: string | null) =>
      es
        ? `Archivo hipotecario: consultado${by ? ` por ${by}` : ""}${via ? ` via ${via}` : ""}${date ? ` el ${date}` : ""}. Coordine el momento de las disputas con el oficial de prestamos antes de presentarlas.`
        : `Mortgage file: pulled${by ? ` by ${by}` : ""}${via ? ` via ${via}` : ""}${date ? ` on ${date}` : ""}. Coordinate dispute timing with the loan officer before filing.`,
    lenderTitle: es ? "PUNTAJE DEL PRESTAMISTA" : "LENDER SCORE",
    lenderBody: (model: string, score: string, target: string) =>
      es
        ? `El prestamista usa ${model}: puntaje medio ${score}${target ? `; necesita ${target}` : ""}.`
        : `The lender uses ${model}: middle score ${score}${target ? `; needs ${target}` : ""}.`,
    missingBureau: (b: string) =>
      es
        ? `${b} no devolvio datos (posible congelamiento o no se consulto). Levante el congelamiento y saque un reporte de 3 buros.`
        : `${b} returned no data (likely a freeze or not pulled). Lift any freeze and pull a fresh 3-bureau report.`,
    flagged: es ? "ALERTA" : "FLAGGED",
    roundTitle: (r: AnalysisRound) =>
      ({
        1: es ? "RONDA 1 - CONSULTAS + DATOS PERSONALES" : "ROUND 1 - INQUIRIES + PERSONAL INFO",
        2: es ? "RONDA 2 - COBRANZAS DE TERCEROS" : "ROUND 2 - THIRD-PARTY COLLECTIONS",
        3: es ? "RONDA 3 - PAGOS ATRASADOS / EXACTITUD" : "ROUND 3 - LATE PAYMENTS / ACCURACY",
        4: es ? "RONDA 4 - CARGOS A PERDIDA / DEROGATORIOS DEL ACREEDOR" : "ROUND 4 - CHARGE-OFFS / ORIGINAL-CREDITOR DEROGATORY",
      })[r],
    creditor: es ? "Acreedor" : "Creditor",
    type: es ? "Tipo" : "Type",
    bureaus: es ? "Buros" : "Bureaus",
    issue: es ? "Estado / problema" : "Status / issue",
    legal: es ? "Base legal" : "Legal basis",
    noneOnFile: es ? "Nada en el archivo." : "None on file.",
    inquiry: es ? "Consulta" : "Inquiry",
    moreInquiries: (n: number) => (es ? `${n} consultas mas (lista completa en el sistema)` : `${n} more inquiries (full list on file)`),
    inquiryDispute: es ? "Sin proposito permitido verificado" : "No verified permissible purpose",
    inquiryAgesOff: (d: string) => (es ? `Se elimina sola el ${d}` : `Ages off on its own ${d}`),
    cluster: (d: string, n: number) => (es ? `${n} consultas el mismo dia (${d})` : `${n} same-day inquiries (${d})`),
    duplicateInq: es ? "duplicada (mismo acreedor, buro y fecha)" : "duplicate (same creditor, bureau and date)",
    repeatInq: (auto: boolean) =>
      es
        ? `consulta repetida, ventana de compra ${auto ? "de auto" : "de tasa"}`
        : `repeat pull, ${auto ? "auto" : "rate"}-shopping window`,
    lenderWindow: es
      ? "El archivo del prestamista solo lista los ultimos 120 dias; saque MFSN para 12 meses."
      : "Lender file lists last 120 days only; pull MFSN for 12 months.",
    noBureauItems: (b: string) => (es ? `sin partidas en ${b}` : `no ${b} items`),
    // v2.4 #8: Round 1 personal-info items never move a score; the cell is about inquiries.
    noBureauInquiries: (b: string) => (es ? `sin consultas en ${b}` : `no ${b} inquiries`),
    noLimit: es ? "sin limite" : "no limit",
    excludedLoan: es ? "EXCLUIDA - proposito permitido (transaccion activa)" : "EXCLUDED - permissible purpose (active transaction)",
    excludedMatch: (why: string) =>
      es
        ? `EXCLUIDA - proposito permitido (${why.replace(/^matches/, "coincide con").replace(/ opened /, " abierta ")})`
        : `EXCLUDED - permissible purpose (${why})`,
    personalInfo: es ? "Datos personales" : "Personal info",
    unitMismatch: es ? "numero de unidad distinto" : "unit mismatch",
    fieldName: (f: string) =>
      ({
        name: es ? "variante de nombre" : "name variant",
        address: es ? "direccion" : "address",
        ssn: es ? "SSN distinto" : "SSN variance",
        dob: es ? "fecha de nacimiento" : "date of birth",
      })[f] ?? f,
    informational: es ? "INFORMATIVO - NO SON OBJETIVOS" : "INFORMATIONAL - NOT DISPUTE TARGETS",
    note: es ? "Nota" : "Note",
    joint: es ? "(conjunta)" : "(joint)",
    duplicate: es ? "misma cuenta con 2 nombres de acreedor" : "same account under 2 furnisher names",
    negTable: es ? "SECCION 1 - CUENTAS NEGATIVAS (MAS ANTIGUA PRIMERO)" : "SECTION 1 - NEGATIVE ACCOUNTS (OLDEST FIRST)",
    posTable: es ? "SECCION 2 - CUENTAS POSITIVAS" : "SECTION 2 - POSITIVE ACCOUNTS",
    balLimit: es ? "Saldo / limite" : "Balance / limit",
    origAmt: es ? "monto orig." : "orig. amt",
    perMonth: es ? "/mes" : "/mo",
    utilStatus: (st: string | undefined) =>
      ({
        open: es ? "Abierta" : "Open",
        inactive: es ? "Inactiva" : "Open-reporting, inactive",
        closed: es ? "Cerrada" : "Closed",
        charged_off: es ? "Cargo a perdida - objetivo de disputa" : "Charged off - dispute target",
        terminated: es ? "Terminada (ECOA T) - no cuenta" : "Terminated (ECOA T) - not counted",
      })[st ?? "open"] ?? st ?? "",
    na: "N/A",
    paidOn: es ? "Pagada" : "Paid",
    lenderUtil: (u: number | null | undefined, used: number | null | undefined) =>
      es
        ? `Cifras del prestamista: utilizacion revolvente ${u ?? "--"}%${used != null ? `, credito revolvente usado ${used}%` : ""}.`
        : `Lender summary: revolving utilization ${u ?? "--"}%${used != null ? `, revolving/credit line used ${used}%` : ""}.`,
    noOpenCard: es
      ? "No hay ninguna tarjeta abierta en buen estado reportando actualmente."
      : "No open credit card in good standing is currently reporting.",
    utilNotApplicable: es
      ? "Ninguna tarjeta abierta en buen estado: la utilizacion no aplica."
      : "No open card in good standing - utilization not applicable.",
    notCounted: es ? "No cuenta" : "Not counted",
    allDerogUtil: (names: string, plural: boolean) =>
      es
        ? `Toda la utilizacion de tarjetas de este archivo viene ${plural ? "de los saldos en cargo a perdida de" : "del saldo en cargo a perdida de"} ${names}, por lo que se atiende con la disputa de exactitud de la Ronda 4.`
        : `All card utilization on this file comes from the charged-off ${names} ${plural ? "balances" : "balance"}, so it is addressed through the Round 4 accuracy dispute.`,
    confirmPrior: es ? "confirmar con el cliente antes de disputar" : "confirm with client before disputing",
    tlPerIssuer: es ? "Segun el emisor" : "Per card issuer",
    utilTable: es ? "SECCION 3 - UTILIZACION" : "SECTION 3 - UTILIZATION BREAKDOWN",
    derogDate: es ? "Fecha derog." : "Derog. date",
    niFootnote: es
      ? "* Fecha del primer derogatorio no detallada: se usa la mas antigua entre la ultima actividad y la apertura (nunca una fecha de pago, cierre o reporte)."
      : "* First derogatory date not itemized: the earlier of date of last activity and date opened is used (never a paid, closed or reported date).",
    closedPositives: (n: number) =>
      es ? `${n} cuentas cerradas pagadas segun lo acordado (no se listan).` : `${n} closed accounts paid as agreed (not listed).`,
    round: es ? "Ronda" : "Round",
    opened: es ? "Apertura" : "Opened",
    limit: es ? "Limite" : "Limit",
    balance: es ? "Saldo" : "Balance",
    used: es ? "% usado" : "% used",
    to30: es ? "Saldo para 30%" : "Balance at 30%",
    to10: es ? "Saldo para 10%" : "Balance at 10%",
    alreadyOk: es ? "Ya esta bien" : "Already OK",
    orLess: es ? "o menos" : "or less",
    totalOpen: es ? "Total (abiertas en buen estado)" : "Total (open cards in good standing)",
    moreCards: (n: number) => (es ? `${n} tarjetas mas incluidas en el total.` : `${n} more cards included in the total.`),
    status: es ? "Estado" : "Status",
    projTitle: es ? "PUNTAJE PROYECTADO POR RONDA (ESTIMADO)" : "PROJECTED SCORE BY ROUND (ESTIMATED)",
    projNote: es
      ? "Estimaciones: cada eliminacion solo mueve los buros que la reportan; tope +100 por buro y nunca mas de 760. No es una garantia."
      : "Estimates: each removal only moves the bureaus that report it; capped at +100 per bureau and never past 760. Not a guarantee.",
    step: es ? "Etapa" : "Step",
    middleCol: es ? "Medio" : "Middle",
    milestone: (k: ProjectionMilestone["key"]) =>
      ({
        current: es ? "Actual" : "Current",
        round1: es ? "Ronda 1 - consultas + datos personales" : "Round 1 - inquiries + personal info",
        round2: es ? "Ronda 2 - cobranzas" : "Round 2 - collections",
        round3: es ? "Ronda 3 - pagos atrasados" : "Round 3 - late payments",
        round4: es ? "Ronda 4 - cargos a perdida" : "Round 4 - charge-offs",
        utilization: es ? "Utilizacion menor a 10% / linea AU" : "Utilization under 10% / AU line",
      })[k],
    tradelineTitle: es ? "LINEAS COMERCIALES" : "TRADELINES",
    tlLevel: es ? "Nivel" : "Level",
    impact: es ? "Impacto estimado" : "Expected impact",
    tlTiming: es ? "Cuando" : "Timing",
    tlNow: es ? "Ahora" : "Now",
    tlAfterClosing: es ? "Despues del cierre o antes de la siguiente solicitud" : "After closing or before next application",
    tlHold: es ? "En espera" : "Hold",
    tlType: (code: string) =>
      code === "primary" ? (es ? "Linea primaria (Chase / Navy Federal)" : "Primary line (Chase / Navy Federal)") : es ? "Linea AU" : "AU tradeline",
    tlWhyTitle: es ? "POR QUE FUNCIONA PARA ESTE ARCHIVO" : "WHY IT WORKS FOR THIS FILE",
    actionTitle: es ? "PLAN DE ACCION" : "ACTION PLAN",
    strengthTitle: es ? "FORTALEZA DEL ARCHIVO (0-100)" : "FILE STRENGTH (0-100)",
    factor: es ? "Factor (20 pts c/u)" : "Factor (20 pts each)",
    current: es ? "Actual" : "Current",
    projected: es ? "Proyectado" : "Projected",
    factorName: (k: string) =>
      ({
        revolving: es ? "Cuentas revolventes abiertas" : "Open revolving accounts",
        installment: es ? "Mezcla de prestamos" : "Installment mix",
        mortgage: es ? "Hipoteca" : "Mortgage account",
        age: es ? "Antiguedad" : "Account age",
        derogatory: es ? "Cuentas negativas" : "Derogatory items",
      })[k] ?? k,
    total: "TOTAL",
    programTitle: es ? "PROGRAMA RECOMENDADO" : "RECOMMENDED PROGRAM",
    programName: (t: string, price: string) =>
      t === "complex" ? (es ? `Reparacion Compleja - ${price}` : `Complex Repair - ${price}`) : es ? `Reparacion Estandar - ${price}` : `Standard Repair - ${price}`,
    enroll: es ? "Inscribase" : "Enroll",
    mfsn: es ? "Reporte de 3 buros con historial de 12 meses (MyFreeScoreNow)" : "3-bureau report with 12-month history (MyFreeScoreNow)",
    croaTitle: es ? "DIVULGACION CROA" : "CROA DISCLOSURE",
    croa: es
      ? "Optimum Financial Group presta servicios de reparacion de credito conforme a la Ley de Organizaciones de Reparacion de Credito (CROA), 15 U.S.C. §1679 y ss. No garantizamos mejoras especificas de puntaje. Los resultados varian segun la persona. Este analisis se basa en la informacion proporcionada y no constituye asesoria legal."
      : "Optimum Financial Group provides credit repair services in compliance with the Credit Repair Organizations Act (CROA), 15 U.S.C. §1679 et seq. We do not guarantee specific score improvements. Results vary by individual. This analysis is based on information provided and does not constitute legal advice.",
    confidential: es
      ? "Confidencial - preparado para el cliente nombrado. Las proyecciones son estimaciones."
      : "Confidential - prepared for the named client. Projections are estimates, not guarantees.",
    page: (n: number) => (es ? `Pagina ${n} de 5` : `Page ${n} of 5`),
    years: (m: number) => (es ? `${Math.floor(m / 12)} a ${m % 12} m` : `${Math.floor(m / 12)} yrs ${m % 12} mos`),
    acctType: (k: string) =>
      ({
        auto: "Auto",
        revolving: es ? "Revolvente" : "Revolving",
        installment: es ? "Prestamo" : "Installment",
        mortgage: es ? "Hipoteca" : "Mortgage",
        collection: es ? "Cobranza" : "Collection",
        student_loan: es ? "Prestamo estudiantil" : "Student loan",
        open: es ? "Abierta" : "Open",
      })[k] ?? k,
    kind: (k: string) =>
      ({
        collection: es ? "Cobranza" : "Collection",
        charge_off: es ? "Cargo a perdida" : "Charge-off",
        late: es ? "Pagos atrasados" : "Late payments",
        repossession: es ? "Reposesion" : "Repossession",
        public_record: es ? "Registro publico" : "Public record",
        derogatory: es ? "Derogatorio" : "Derogatory",
      })[k] ?? k,
  };
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
    const subW = this.W - this.M - tx;
    const subLines = this.wrap(this.headerSub, 8, subW);
    const two = subLines.length > 1;
    this.text(this.headerTitle, tx, this.H - (two ? 30 : 34), 12, { font: this.bold, color: OFG_PDF.white });
    subLines.slice(0, 2).forEach((ln, i) =>
      this.text(ln, tx, this.H - (two ? 45 : 50) - i * 10, 8, { color: rgb(0.85, 0.87, 0.92), maxWidth: subW }),
    );
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
    // Heading + a table header + one row: never leave a heading alone at the page bottom.
    this.ensure(60);
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

  /** warn = red (data problems); gold = SOP banner (gold border / accent, navy text, v2.4 #13). */
  callout(title: string, body: string, tone: "warn" | "info" | "gold" = "info") {
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
      borderWidth: tone === "gold" ? 1.4 : 0.8,
    });
    if (tone === "gold") this.page.drawRectangle({ x: this.M, y: top - h, width: 4, height: h, color: OFG_PDF.gold });
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
    const firstRowH = rows.length
      ? Math.max(...rows[0].map((c, i) => this.wrap(c, size, colW[i] - 8).length)) * (size + 3) + 6
      : 0;
    const drawHeader = () => {
      // Header + first row together (no orphan table header).
      this.ensure(18 + firstRowH);
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

  /** Graphic bar (Cesar, Oct 27: keep the graphic over the v2 spec's ASCII bars). */
  scoreBar(label: string, score: number | null, extra: string) {
    this.ensure(18);
    this.text(label, this.M, this.y, 8.5, { font: this.bold, maxWidth: 168 });
    const bx = this.M + 174;
    const bw = 200;
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

const BUREAU_NAME: Record<Bureau, string> = { TU: "TransUnion", EX: "Experian", EQ: "Equifax" };
const LEGAL_ROUND1 = "FCRA §604, §611";
/**
 * OFG contact on every client report (analysis + progress PDFs, emails).
 * Change it HERE only.
 */
export const OFG_REPORT_CONTACT = {
  phone: "(949) 674-0714",
  site: "ofgllc.com",
  address: "2717 W Coast Hwy, Ste C, Newport Beach, CA 92663",
  // Spec v2.3 P2-1: full URLs from program config, never built from the website domain.
  // Reports print OFG redirect links (served by api/index.ts /go/*): a page that moves only changes
  // OFG_ENROLL_TARGETS, and every PDF already sent keeps working.
  standardUrl: "https://www.ofgllc.com/go/enroll-standard",
  complexUrl: "https://www.ofgllc.com/go/enroll-complex",
  freeScoreUrl: "https://www.ofgllc.com/go/free-score",
} as const;

/**
 * Where the /go/enroll-* redirects land (Cesar, Oct 26 R-5: program pages on optimum-financial-group.com).
 * Standard = /standard-repair-payment — /premium-plan-payment does not exist there (it redirects to /home).
 */
export const OFG_ENROLL_TARGETS = {
  standard: "https://www.optimum-financial-group.com/standard-repair-payment",
  complex: "https://www.optimum-financial-group.com/complex-repair-payment",
} as const;

/** Spec §8: the client analysis is exactly 5 pages. */
export const CREDIT_ANALYSIS_PDF_PAGES = 5;

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

/**
 * Spec v2.3 P1-6: never print a cut-off value. Partial dates ("REPORTED 10/24/",
 * "06/- 10/") and masked fragments become "not itemized".
 */
export function completeValuesOnly(text: string, es = false): string {
  return String(text ?? "")
    .replace(/\b\d{1,2}\/(?:\d{1,2}\/)?(?![\d/])(?:\s*-\s*\d{1,2}\/(?:\d{1,2}\/)?(?![\d/]))?/g, es ? "(fecha no detallada)" : "(date not itemized)")
    .replace(/\s*•+\s*/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * R-1: one whole-percent value per figure, from the raw balance / limit (never re-rounding a
 * value already rounded to one decimal: 42.47% → 42.5 → 43).
 */
export function wholePct(balance: number, limit: number): number | null {
  return limit > 0 ? Math.round((balance / limit) * 100) : null;
}

/** File-level card utilization as printed: the same rows the utilization table totals. */
export function printedUtilization(data: CreditAnalysisData): number | null {
  // v2.4 #3: open cards in good standing only, on every format.
  const rows = data.utilization.filter(inGoodStanding);
  if (!rows.length) return null;
  const own = rows.filter((u) => !u.authorizedUser);
  const use = own.length ? own : rows;
  return wholePct(use.reduce((s, u) => s + u.balance, 0), use.reduce((s, u) => s + u.limit, 0));
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

/** One date style everywhere in the client PDF: MM/DD/YYYY (or MM/YYYY when month-only). */
export function displayDate(raw: string | null | undefined, monthOnly = false): string {
  const d = parseReportDate(raw);
  if (!d) return raw ? String(raw) : "--";
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (monthOnly) return `${mm}/${d.getUTCFullYear()}`;
  return `${mm}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** "ALMA YVETTE RICE" → "Alma Y. Rice" (P0-1). */
export function displayBorrowerName(raw: string | null | undefined): string | null {
  const parts = String(raw ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1).toLowerCase()));
  if (!parts.length) return null;
  // Spec v2.3 P2-2: the full borrower name as printed — never abbreviated.
  return parts.join(" ");
}

/** Never print a placeholder name ("TBD", "(last name TBD)", "Client"). */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const t = String(name ?? "").trim();
  return !t || /\btbd\b|\bunknown\b|^client$|\(.*\)/i.test(t);
}

function bureauLabel(bureaus: Bureau[], notItemized: boolean | undefined, L: Labels): string {
  return notItemized ? L.notItemized : bureaus.join(", ");
}

function issueText(n: AnalysisNegative, L: Labels): string {
  const parts = [n.status];
  if (n.originalCreditor) parts.push(`${L.originalCreditor} ${n.originalCreditor}`);
  // Spec v2.3 P1-3: a paid collection is still a target — say when it was paid.
  if (n.paidOn !== undefined && n.paidOn !== null) parts.push(n.paidOn ? `${L.paidOn} ${n.paidOn}` : L.paidOn);
  if (n.joint) parts.push(L.joint);
  if (n.duplicateGroup != null) parts.push(L.duplicate);
  const flags = (n.accuracyFlags ?? []).filter((f) => !/^missing from/.test(f) || !n.bureausNotItemized);
  if (flags.length) parts.push(`[${flags.join("; ")}]`);
  // Only real cross-bureau differences (P1-2).
  const real = n.inconsistencies.filter((i) => !/^Not reported to/.test(i));
  if (real.length) parts.push(real.join("; "));
  const body = parts.join(" - ");
  // v2.4 #15: no trailing balance when the status already prints that amount.
  return `${body}${n.balance && !body.includes(pdfMoney(n.balance)) ? ` (${pdfMoney(n.balance)})` : ""}`;
}

export async function generateOfgCreditAnalysisPdf(
  data: CreditAnalysisData,
  opts: CreditAnalysisPdfOptions,
): Promise<Buffer> {
  return (await generateOfgCreditAnalysisPdfWithMeta(data, opts)).buffer;
}

/** Renders the 5-page contract; retries once in compact mode if the content overflows. */
export async function generateOfgCreditAnalysisPdfWithMeta(
  data: CreditAnalysisData,
  opts: CreditAnalysisPdfOptions,
): Promise<{ buffer: Buffer; pages: number }> {
  let out = await renderAnalysisPdf(data, opts, false);
  if (out.pages > CREDIT_ANALYSIS_PDF_PAGES) out = await renderAnalysisPdf(data, opts, true);
  return out;
}

async function renderAnalysisPdf(
  data: CreditAnalysisData,
  opts: CreditAnalysisPdfOptions,
  compact: boolean,
): Promise<{ buffer: Buffer; pages: number }> {
  const L = analysisLabels(opts.lang);
  const es = opts.lang === "es";
  const T = compact ? 6.9 : 7.6; // table font
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
  const name = displayBorrowerName(data.borrowerName) ?? opts.clientName;
  const src = data.source;
  const ordered = src?.ordered ? displayDate(src.ordered) : null;
  const rd = parseReportDate(data.reportDate);
  const reportDateText = rd
    ? `${String(rd.getUTCMonth() + 1).padStart(2, "0")}/${String(rd.getUTCDate()).padStart(2, "0")}/${rd.getUTCFullYear()}`
    : data.reportDate ?? "--";
  // Spec v2.3 P2-2: 'Xactus tri-merge #94944806 (STATEWIDE)'; v2.4 #16: "ordered <date>" only when it
  // differs from the report date, so the header stays one line.
  const source =
    data.reportFormat === "merged"
      ? `${src?.vendor ? `${src.vendor} tri-merge` : es ? "Tri-merge de prestamista" : "Lender tri-merge"}${src?.reportId ? ` #${src.reportId}` : ""}${
          src?.company ?? data.escrow?.lenderName ? ` (${src?.company ?? data.escrow?.lenderName})` : ""
        }${ordered && ordered !== reportDateText ? `${es ? ", ordenado" : ", ordered"} ${ordered}` : ""}`
      : data.scoreModel || "";
  const sub = `${name}  |  ${L.reportDate}: ${reportDateText}${source ? `  |  ${L.source}: ${source}` : ""}`;
  const f = new PageFlow(pdf, font, bold, logo, `${L.title}`, sub, L, `Optimum Financial Group  |  ${opts.program.phone}  |  ${opts.program.site}  |  ${OFG_REPORT_CONTACT.address}`);
  const active = BUREAUS.filter((b) => !data.missingBureaus.includes(b));
  const totals = data.totals;
  // Section n starts on page n; an overflow from the previous section is absorbed, not added.
  const startSectionPage = (n: number) => {
    if (f.pageNo < n) f.newPage();
  };
  const clip = (t: string, max: number) => (compact && t.length > max ? `${t.slice(0, max - 3)}...` : t);

  // ── Page 1: scores + overview + banner + facts ──────────────────────────
  f.section(L.s1);
  // v2.4 #11: VantageScore column on every report; "Not itemized" when the source has none.
  f.table(
    [L.bureau, data.scoreModel && /fico/i.test(data.scoreModel) ? "FICO" : L.score, L.rating, L.vantage],
    BUREAUS.map((b) => {
      const s = data.scores[b];
      return [
        BUREAU_NAME[b],
        s === null ? L.notReported : String(s),
        s === null ? "--" : data.scoreRatings?.[b] || scoreRating(s, es),
        data.vantageScores?.[b] ? String(data.vantageScores[b]) : L.notItemized,
      ];
    }).concat([[L.middle, data.middleScore != null ? String(data.middleScore) : "--", "", ""]]),
    [0.4, 0.18, 0.18, 0.24],
    { size: T },
  );
  for (const b of active) {
    const s = data.scores[b];
    if (s !== null) f.scoreBar(BUREAU_NAME[b], s, String(s));
  }
  if (data.escrow?.active) {
    const lenderQ = data.escrow.loanInquiries?.[0];
    // Spec v2.3 P1-1: the vendor pulled it for the requester — not a separate loan.
    if (data.reportFormat === "merged" && src && (src.requestedBy || src.vendor || src.company)) {
      const via = [src.company, src.vendor].filter(Boolean).join(" / ") || null;
      f.callout(L.activeTitle, L.mortgageBody(src.requestedBy, via, ordered ?? displayDate(data.reportDate)), "gold");
    } else {
      f.callout(L.activeTitle, L.activeBody(data.escrow.lenderName ?? lenderQ?.creditor ?? null, displayDate(lenderQ?.date ?? data.reportDate)), "gold");
    }
  }
  if (data.lender && data.lender.score) {
    f.callout(L.lenderTitle, L.lenderBody(data.lender.model || "FICO", String(data.lender.score), data.lender.target ? String(data.lender.target) : ""));
  }
  for (const b of data.missingBureaus) f.callout(`${L.flagged} - ${BUREAU_NAME[b].toUpperCase()}`, L.missingBureau(BUREAU_NAME[b]), "warn");
  f.subhead(L.fileOverview);
  // Per bureau (EQ / EX / TU) — Cesar, Oct 22: counts by bureau, never one combined column.
  const OV: Bureau[] = ["EQ", "EX", "TU"];
  const inqItemized = data.inquiries.some((q) => q.bureau);
  const ov = (fn: (b: Bureau) => string) => OV.map((b) => (data.overview[b].reported ? fn(b) : "--"));
  const perBureauInq = (b: Bureau) => {
    if (!inqItemized) return L.notItemized;
    const groups = new Set(data.inquiries.filter((q) => q.bureau === b).map((q) => `${q.creditor.toLowerCase()}|${q.date}`));
    return String(groups.size);
  };
  const overviewRows: string[][] = [
    [L.accounts, ...ov((b) => String(data.overview[b].totalAccounts))],
    [L.posNeg, ...ov((b) => `${data.overview[b].positive} / ${data.overview[b].negative}`)],
    [L.inquiries, ...ov(perBureauInq)],
    [L.utilization, ...ov((b) => {
      const o = data.overview[b];
      return o.utilizationPct === null ? L.na : `${wholePct(o.revolvingBalance, o.revolvingLimit)}% (${pdfMoney(o.revolvingBalance)} / ${pdfMoney(o.revolvingLimit)})`;
    })],
    [L.avgAgeOnly, ...ov((b) => (data.overview[b].avgAgeMonths === null ? "--" : L.years(data.overview[b].avgAgeMonths!)))],
    [L.oldestOnly, ...ov((b) => displayDate(data.overview[b].oldest?.opened, true))],
    [L.collCo, ...ov((b) => `${data.negatives.filter((n) => n.kind === "collection" && n.bureaus.includes(b)).length} / ${data.negatives.filter((n) => n.kind === "charge_off" && n.bureaus.includes(b)).length}`)],
    [L.publicRecords, ...ov((b) => String(data.negatives.filter((n) => n.kind === "public_record" && n.bureaus.includes(b)).length))],
  ];
  f.table([L.metric, ...OV.map((b) => BUREAU_NAME[b])], overviewRows, [0.31, 0.23, 0.23, 0.23], { size: T });
  if (totals) {
    f.paragraph(
      L.fileTotals(totals.tradelines, totals.withBalance, totals.negativeTradelines, totals.negativeAccounts, pdfMoney(totals.pastDue)),
      7.4,
      OFG_PDF.muted,
    );
  }
  f.subhead(L.keyObs);
  for (const obs of keyObservations(data, es).slice(0, compact ? 4 : 5)) f.bullet(obs);

  // ── Page 2: dispute priority ────────────────────────────────────────────
  startSectionPage(2);
  f.section(L.s2);
  const head = [L.creditor, L.type, L.bureaus, L.issue, L.legal];
  const widths = [0.22, 0.12, 0.11, 0.38, 0.17];
  f.subhead(L.roundTitle(1));
  const r1: string[][] = [];
  for (const c of data.inquiryClusters ?? []) {
    // R-2: the cluster row names its creditors (bureau after each) and carries the lower-odds note.
    const members = data.inquiries.filter((q) => q.clusterId === c.id);
    const byBureau = new Map<string, string[]>();
    for (const q of members) {
      const k = q.bureau ?? L.notItemized;
      byBureau.set(k, [...(byBureau.get(k) ?? []), q.creditor]);
    }
    // Compact (overflow) pass: first names per bureau + "+N" so a busy file keeps its 5 pages.
    const nameCap = compact ? 2 : 6;
    const names = [...byBureau.entries()]
      .map(([b, cs]) => {
        const u = [...new Set(cs)];
        return `${u.slice(0, nameCap).join(", ")}${u.length > nameCap ? ` +${u.length - nameCap}` : ""} (${b})`;
      })
      .join("; ");
    const odds = members.map((q) => q.nearAccount || q.lowerOdds).find(Boolean);
    r1.push([
      L.cluster(displayDate(c.from), c.count),
      L.inquiry,
      inqItemized ? BUREAUS.filter((b) => c.perBureau[b]).join(", ") : L.notItemized,
      `${names} - ${L.inquiryDispute}${odds ? ` (${odds})` : ""}`,
      LEGAL_ROUND1,
    ]);
  }
  // One row per creditor + date (bureau copies combined); compact mode caps the list.
  const inqGroups = new Map<string, { q: (typeof data.inquiries)[number]; bureaus: string[] }>();
  for (const q of data.inquiries.filter((x) => !x.clusterId && x.action !== "permissible" && x.duplicateOf == null)) {
    const k = `${q.creditor.toLowerCase()}|${q.date}|${q.action}`;
    const g = inqGroups.get(k) ?? { q, bureaus: [] };
    if (q.bureau && !g.bureaus.includes(q.bureau)) g.bureaus.push(q.bureau);
    inqGroups.set(k, g);
  }
  const inqRows = [...inqGroups.values()];
  const inqCap = compact ? 10 : 16;
  for (const { q, bureaus } of inqRows.slice(0, inqCap)) {
    const dup = q.duplicates && q.duplicates > 1;
    // R-2: one row for the duplicate pulls with every date ("09/18 + 09/21/2026").
    const dupDates = dup
      ? [q, ...data.inquiries.filter((x) => x.duplicateOf != null && data.inquiries[x.duplicateOf] === q)]
          .map((x) => parseReportDate(x.date))
          .filter((d): d is Date => !!d)
          .sort((a, b) => a.getTime() - b.getTime())
      : [];
    const md = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
    const when = dupDates.length > 1 ? `${dupDates.slice(0, -1).map(md).join(" + ")} + ${md(dupDates[dupDates.length - 1])}/${dupDates[dupDates.length - 1].getUTCFullYear()}` : displayDate(q.date);
    r1.push([
      dup ? `${q.creditor} (x${q.duplicates}), ${when}` : `${q.creditor} ${displayDate(q.date)}`,
      L.inquiry,
      bureaus.length ? bureaus.join(", ") : L.notItemized,
      `${dup ? `${q.duplicateKind === "repeat" ? L.repeatInq(!!q.autoPull) : L.duplicateInq} - ` : ""}${q.action === "ages_off" ? L.inquiryAgesOff(q.agesOff ?? "--") : L.inquiryDispute}${q.lowerOdds ? ` (${q.lowerOdds})` : ""}${q.nearAccount ? ` (${q.nearAccount})` : ""}`,
      q.action === "ages_off" ? "--" : LEGAL_ROUND1,
    ]);
  }
  if (inqRows.length > inqCap) r1.push([L.moreInquiries(inqRows.length - inqCap), L.inquiry, "", "", LEGAL_ROUND1]);
  // One row per field (name / address / SSN / DOB), bureaus combined.
  const idGroups = new Map<string, { field: string; kind: string; bureaus: string[]; details: string[]; unlabeled: boolean }>();
  for (const fl of data.identityFlags ?? []) {
    const key = `${fl.field}|${fl.kind ?? ""}`;
    const g = idGroups.get(key) ?? { field: fl.field, kind: fl.kind ?? "", bureaus: [], details: [], unlabeled: false };
    if (fl.bureau) {
      if (!g.bureaus.includes(fl.bureau)) g.bureaus.push(fl.bureau);
    } else g.unlabeled = true;
    if (fl.detail && !g.details.includes(fl.detail)) g.details.push(fl.detail);
    idGroups.set(key, g);
  }
  // Spec v2.3 P1-6: one row per variance type per bureau; complete values only.
  for (const { field, kind, ...g } of idGroups.values()) {
    // v2.4 #4: a unit mismatch on one street is ONE Round 1 row naming every bureau's unit.
    if (kind === "unit_mismatch") {
      for (const d of g.details) r1.push([L.personalInfo, L.unitMismatch, g.bureaus.join(", "), clip(d, 110), "FCRA §611"]);
      continue;
    }
    const tail = field === "address" ? ` - ${L.confirmPrior}` : "";
    if (g.bureaus.length > 1) {
      for (const b of g.bureaus) {
        const mine = (data.identityFlags ?? []).filter((x) => x.field === field && (x.kind ?? "") === kind && x.bureau === b).map((x) => completeValuesOnly(x.detail, es));
        r1.push([L.personalInfo, L.fieldName(field), b, `${clip([...new Set(mine)].join("; "), 110)}${tail}`, "FCRA §611"]);
      }
      continue;
    }
    const where = [...g.bureaus, ...(g.unlabeled ? [L.notItemized] : [])].join(", ");
    r1.push([L.personalInfo, L.fieldName(field), where, `${clip(g.details.map((d) => completeValuesOnly(d, es)).join("; "), 110)}${tail}`, "FCRA §611"]);
  }
  const exGroups = new Map<string, { q: (typeof data.inquiries)[number]; bureaus: string[] }>();
  for (const q of data.inquiries.filter((x) => x.action === "permissible")) {
    const key = `${q.creditor.toLowerCase()}|${q.date}`;
    const g = exGroups.get(key) ?? { q, bureaus: [] };
    if (q.bureau && !g.bureaus.includes(q.bureau)) g.bureaus.push(q.bureau);
    exGroups.set(key, g);
  }
  for (const { q, bureaus } of exGroups.values()) {
    const why = q.excludedReason === "active_loan" ? L.excludedLoan : L.excludedMatch(q.lowerOdds ?? "");
    r1.push([`${q.creditor} ${displayDate(q.date)}`, L.inquiry, bureaus.length ? bureaus.join(", ") : L.notItemized, why, "--"]);
  }
  if (r1.length) f.table(head, r1, widths, { size: T });
  else f.paragraph(L.noneOnFile, 8, OFG_PDF.muted);
  if (data.reportFormat === "merged") f.paragraph(L.lenderWindow, 7.2, OFG_PDF.muted);
  for (const r of [2, 3, 4] as const) {
    f.subhead(L.roundTitle(r));
    const rows = data.negatives
      .filter((n) => n.round === r && !n.hold)
      // v2.4 #5: Type = the account type from the source; the issue stays in Status / issue.
      .map((n) => [`${n.creditor}${n.mask ? ` ...${n.mask}` : ""}`, n.accountType ? L.acctType(n.accountType) : L.kind(n.kind), bureauLabel(n.bureaus, n.bureausNotItemized, L), clip(issueText(n, L), 120), n.legalBasis]);
    if (rows.length) f.table(head, rows, widths, { size: T });
    else f.paragraph(L.noneOnFile, 8, OFG_PDF.muted);
  }
  if ((data.informational ?? []).length) {
    f.subhead(L.informational);
    f.table(
      [L.creditor, L.bureaus, L.note],
      data.informational!.slice(0, compact ? 4 : 8).map((i) => [`${i.creditor}${i.mask ? ` ...${i.mask}` : ""}`, i.bureaus.join(", "), clip(i.note, 100)]),
      [0.3, 0.15, 0.55],
      { size: T },
    );
  }

  // ── Page 3: negatives (oldest first), active positives, utilization ──────
  startSectionPage(3);
  f.section(L.s3);
  f.subhead(L.negTable);
  const dTime = (n: AnalysisNegative) => parseReportDate(n.derogDate ?? n.opened)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const negs = [...data.negatives].sort((a, b) => dTime(a) - dTime(b));
  const anyProxy = negs.some((n) => n.derogDateIsProxy);
  if (negs.length) {
    f.table(
      [L.derogDate, L.creditor, L.type, L.bureaus, L.balance, L.round],
      negs.map((n) => [
        `${displayDate(n.derogDate, true)}${n.derogDateIsProxy ? "*" : ""}`,
        `${n.creditor}${n.mask ? ` ...${n.mask}` : ""}${n.joint ? ` ${L.joint}` : ""}`,
        n.accountType ? L.acctType(n.accountType) : L.kind(n.kind),
        bureauLabel(n.bureaus, n.bureausNotItemized, L),
        pdfMoney(n.balance),
        n.hold ? "--" : `R${n.round}`,
      ]),
      [0.14, 0.3, 0.15, 0.15, 0.13, 0.13],
      { size: T },
    );
    if (anyProxy) f.paragraph(L.niFootnote, 7, OFG_PDF.muted);
  } else f.paragraph(L.noneOnFile, 8, OFG_PDF.muted);
  f.subhead(L.posTable);
  // Spec v2.3 P1-8: real status per row; installments show the original amount, not a "limit".
  const isOpen = (p: (typeof data.positives)[number]) => p.open ?? !/closed|paid|refinanc|transferred/i.test(p.status ?? "");
  const posRows = [...data.positives].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)));
  const posCap = compact ? 8 : 12;
  if (posRows.length) {
    f.table(
      [L.creditor, L.type, L.opened, L.status, L.balLimit, L.bureaus],
      posRows.slice(0, posCap).map((p) => {
        const openType = /^open\b|utility/i.test(`${p.type ?? ""}`);
        const amount = openType
          ? `${pdfMoney(p.balance)} (${L.noLimit})`
          : p.amountKind === "original"
            ? `${pdfMoney(p.balance)}${p.limit ? ` (${L.origAmt} ${pdfMoney(p.limit)})` : ""}${p.monthlyPayment ? `, ${pdfMoney(p.monthlyPayment)}${L.perMonth}` : ""}`
            : `${pdfMoney(p.balance)}${p.limit ? ` / ${pdfMoney(p.limit)}` : ""}`;
        return [`${p.creditor}${p.mask ? ` ...${p.mask}` : ""}`, p.type ?? "--", displayDate(p.opened, true), p.statusLabel ?? (isOpen(p) ? "Open" : p.status ?? "--"), amount, p.bureaus.join(", ")];
      }),
      [0.24, 0.1, 0.11, 0.25, 0.18, 0.12],
      { size: T },
    );
  }
  if (posRows.length > posCap) f.paragraph(L.closedPositives(posRows.length - posCap), 7.6, OFG_PDF.muted);
  f.subhead(L.utilTable);
  // Spec v2.3 P0-3 / P0-7: reference figures only (never payoff advice); charge-offs show N/A.
  // Lender tri-merges list every card; v2.4 #3: the total counts open cards in good standing only.
  const utilAll = data.reportFormat === "merged" ? data.utilization : data.utilization.filter((u) => !u.closed);
  const goodCards = utilAll.filter(inGoodStanding);
  // Totals always cover every card; the rows shown are capped so the 5-page contract holds.
  const rank = (u: (typeof utilAll)[number]) =>
    u.status === "charged_off" ? 0 : u.status === "open" ? 1 : u.status === "inactive" ? 2 : u.status === "terminated" ? 3 : 4;
  const utilCap = compact ? 6 : 10;
  const utilRows = [...utilAll].sort((x, y) => rank(x) - rank(y) || y.balance - x.balance || y.limit - x.limit).slice(0, utilCap);
  if (utilRows.length) {
    const lim = goodCards.reduce((s, u) => s + u.limit, 0);
    const bal = goodCards.reduce((s, u) => s + u.balance, 0);
    const ref = (u: (typeof data.utilization)[number], pct: number) =>
      inGoodStanding(u)
        ? pdfMoney(Math.floor(u.limit * pct))
        : u.status === "closed"
          ? L.utilStatus("closed")
          : u.status === "terminated" || u.status === "inactive"
            ? L.notCounted
            : L.na;
    f.table(
      [L.creditor, L.status, L.limit, L.balance, L.used, L.to30, L.to10],
      [
        ...utilRows.map((u) => [
          `${u.account}${u.mask ? ` ...${u.mask}` : ""}${u.authorizedUser ? " (AU)" : ""}`,
          L.utilStatus(u.status ?? (u.closed ? "closed" : "open")),
          pdfMoney(u.limit),
          pdfMoney(u.balance),
          `${wholePct(u.balance, u.limit)}%`,
          ref(u, 0.3),
          ref(u, 0.1),
        ]),
        lim
          ? [L.totalOpen, "", pdfMoney(lim), pdfMoney(bal), `${wholePct(bal, lim)}%`, pdfMoney(Math.floor(lim * 0.3)), pdfMoney(Math.floor(lim * 0.1))]
          : [L.totalOpen, "", "$0", "$0", L.na, L.na, L.na],
      ],
      [0.24, 0.18, 0.1, 0.1, 0.08, 0.15, 0.15],
      { size: T },
    );
  } else f.paragraph(L.noneOnFile, 8, OFG_PDF.muted);
  if (utilAll.length > utilRows.length) f.paragraph(L.moreCards(utilAll.length - utilRows.length), 7.2, OFG_PDF.muted);
  const uo = data.utilizationOverall;
  if (uo.lenderUtilizationPct != null || uo.lenderUsedPct != null) f.paragraph(L.lenderUtil(uo.lenderUtilizationPct, uo.lenderUsedPct), 7.4, OFG_PDF.muted);
  if (uo.allFromDerogatory) {
    // R-6: name the real source.
    const src = [...new Set(data.utilization.filter((u) => u.balance > 0).map((u) => u.account))];
    f.paragraph(L.allDerogUtil(src.join(es ? " y " : " and "), src.length > 1), 7.4, OFG_PDF.muted);
  }
  if (uo.noOpenCardInGoodStanding && data.utilization.length) f.paragraph(L.utilNotApplicable, 7.4, OFG_PDF.muted);

  // ── Page 4: projections + tradelines ────────────────────────────────────
  startSectionPage(4);
  f.section(L.s4);
  f.subhead(L.projTitle);
  f.paragraph(L.projNote, 7.4, OFG_PDF.muted);
  f.table(
    [L.step, ...active.map((b) => BUREAU_NAME[b]), L.middleCol],
    data.projections.filter((p) => PROJECTION_KEYS_MAX.includes(p.key)).map((p, k, rows) => [
      L.milestone(p.key),
      ...active.map((b) => {
        const v = p.scores[b];
        if (v === null) return "--";
        if (p.key === "current") return String(v);
        const r = p.ranges?.[b];
        // R-8: nothing on this bureau in this round → same score, no "+" and no range.
        const prev = rows[k - 1];
        const prevRange = prev?.ranges?.[b] ?? (prev ? [prev.scores[b], prev.scores[b]] : null);
        if (prev && r && prevRange && r[0] === prevRange[0] && r[1] === prevRange[1]) return `${v} (${p.key === "round1" ? L.noBureauInquiries(b) : L.noBureauItems(b)})`;
        // A range collapsed by the +100 / 760 cap prints as one number, never "689-689".
        return r && r[0] !== r[1] ? `${v}+ (${r[0]}-${r[1]})` : `${v}+`;
      }),
      p.middle == null ? "--" : p.key === "current" ? String(p.middle) : `${p.middle}+`,
    ]),
    [0.34, ...active.map(() => 0.5 / Math.max(1, active.length)), 0.16],
    { size: T },
  );
  // Middle-score bars.
  // Compact (overflow) pass: the middle-score bars repeat the table above — dropped to keep 5 pages.
  if (!compact) for (const p of data.projections.filter((x) => PROJECTION_KEYS_MAX.includes(x.key))) if (p.middle != null) f.scoreBar(L.milestone(p.key), p.middle, p.key === "current" ? String(p.middle) : `${p.middle}+`);
  if (data.tradelines?.length) {
    f.subhead(L.tradelineTitle);
    f.table(
      [L.type, L.tlLevel, L.impact, L.bureaus, L.tlTiming],
      data.tradelines.map((t) => [
        L.tlType(t.code),
        t.code === "primary" ? "--" : `${t.code}${t.price ? ` (${pdfMoney(t.price)})` : ""}${t.optional ? (es ? " opcional" : " optional") : ""}`,
        t.note && t.code !== "primary" ? `${t.impact}. ${t.note}` : t.impact,
        t.bureaus.length ? t.bureaus.join(", ") : L.tlPerIssuer,
        t.timing === "hold" ? `${L.tlHold}${t.note ? `: ${t.note.replace(/^Hold:?\s*/i, "")}` : ""}` : t.timing === "after_closing" ? L.tlAfterClosing : L.tlNow,
      ]),
      [0.22, 0.15, 0.3, 0.11, 0.22],
      { size: T },
    );
    f.subhead(L.tlWhyTitle);
    f.paragraph(tradelineWhy(data, es), 8);
  }

  // ── Page 5: action plan, strength, program, CROA ────────────────────────
  startSectionPage(5);
  f.section(L.s5);
  f.subhead(L.actionTitle);
  actionPlan(data, es).forEach((step, i) => f.bullet(`${i + 1}. ${step}`));
  f.subhead(L.strengthTitle);
  f.table(
    [L.factor, L.current, L.projected],
    [
      ...data.fileStrength.factors.map((x) => [L.factorName(x.key), `${x.current} / 20`, `${x.postRepair} / 20`]),
      [L.total, `${data.fileStrength.current} / 100`, `${data.fileStrength.postRepair} / 100`],
    ],
    [0.5, 0.25, 0.25],
    { size: T },
  );
  const complex = data.programTier === "complex";
  f.callout(
    L.programTitle,
    `${L.programName(data.programTier, complex ? opts.program.complexPrice : opts.program.standardPrice)}. ${L.enroll}: ${complex ? opts.program.complexUrl : opts.program.standardUrl}  |  ${opts.program.phone}${opts.program.mfsnUrl ? `.  ${L.mfsn}: ${opts.program.mfsnUrl}` : ""}`,
  );
  f.callout(L.croaTitle, L.croa);

  return { buffer: Buffer.from(await pdf.save()), pages: pdf.getPageCount() };
}

/** "Why it works" tied to this file's numbers. */
export function tradelineWhy(data: CreditAnalysisData, es: boolean): string {
  const open = data.utilization.filter((u) => !u.closed);
  const util = printedUtilization(data);
  const limit = open.reduce((s, u) => s + u.limit, 0);
  const parts: string[] = [];
  if (data.utilizationOverall.noOpenCardInGoodStanding) {
    parts.push(
      es
        ? "No hay ninguna tarjeta abierta en buen estado reportando hoy; una linea AU antigua agrega una cuenta revolvente al dia con limite alto y saldo bajo, lo que le falta a este archivo."
        : "There is no open credit card in good standing reporting today. An aged AU line adds an on-time revolving account with a high limit and low balance - the piece this file is missing.",
    );
    const primary = data.tradelines?.find((t) => t.code === "primary");
    if (primary?.timing === "hold" && primary.note) {
      const why = primary.note.replace(/^Hold:?\s*/i, "");
      parts.push(es ? `Linea primaria en espera (${why}).` : `Primary line on hold (${why}).`);
    }
    return parts.join(" ");
  }
  parts.push(
    es
      ? `${open.length} ${open.length === 1 ? "tarjeta abierta" : "tarjetas abiertas"} con ${pdfMoney(limit)} de limite total${util !== null ? ` al ${util}% de utilizacion` : ""}.`
      : `${open.length} open ${open.length === 1 ? "card" : "cards"} with ${pdfMoney(limit)} in total limits${util !== null ? ` at ${util}% utilization` : ""}.`,
  );
  parts.push(
    es
      ? "Una linea AU antigua y de alto limite agrega limite disponible e historial limpio, lo que baja la utilizacion total."
      : "A seasoned, high-limit AU line adds available credit and clean history, which lowers total utilization.",
  );
  const primary = data.tradelines?.find((t) => t.code === "primary");
  if (primary?.timing === "hold" && primary.note) {
    const why = primary.note.replace(/^Hold:?\s*/i, "");
    parts.push(es ? `Linea primaria en espera (${why}).` : `Primary line on hold (${why}).`);
  }
  return parts.join(" ");
}

/** Facts only (P1-7): what reports where — never single-item score-driver claims. */
export function keyObservations(data: CreditAnalysisData, es: boolean): string[] {
  const out: string[] = [];
  if (data.escrow?.active) {
    const by = data.source?.requestedBy;
    const via = data.source?.company ?? data.escrow.lenderName ?? null;
    out.push(
      data.reportFormat === "merged" && (by || via)
        ? es
          ? `Archivo hipotecario consultado${by ? ` por ${by}` : ""}${via ? ` via ${via}` : ""}: esa consulta tiene proposito permitido y no es objetivo de disputa.`
          : `Mortgage file pulled${by ? ` by ${by}` : ""}${via ? ` via ${via}` : ""}: that pull is a permissible-purpose inquiry, not a dispute target.`
        : es
          ? `Prestamo activo: ${data.escrow.lenderName ?? "el prestamista"} consulto el reporte; su consulta no es objetivo de disputa.`
          : `Active loan: ${data.escrow.lenderName ?? "the lender"} pulled this report; its inquiry is not a dispute target.`,
    );
  }
  const coll = data.negatives.filter((n) => n.kind === "collection");
  // Spec v2.3 P1-3: paid collections stay negative — say so.
  const paidColl = coll.filter((n) => n.paidOn !== undefined && n.paidOn !== null);
  if (paidColl.length) {
    out.push(
      es
        ? `${paidColl.map((n) => n.creditor).join(" y ")}: cobranza pagada${paidColl[0].paidOn ? ` (${paidColl[0].paidOn})` : ""} pero sigue reportada; los modelos FICO 2/4/5 hipotecarios cuentan cobranzas pagadas.`
        : `${paidColl.map((n) => n.creditor).join(" and ")}: paid${paidColl[0].paidOn ? ` ${paidColl[0].paidOn}` : ""} but still reported; FICO 2/4/5 mortgage models still count paid collections.`,
    );
  }
  for (const n of coll.filter((x) => !paidColl.includes(x)).slice(0, 2)) {
    out.push(
      es
        ? `${n.creditor} (${pdfMoney(n.balance)}) se reporta en ${n.bureausNotItemized ? "buros no detallados" : n.bureaus.join(" y ")}.`
        : `${n.creditor} (${pdfMoney(n.balance)}) reports on ${n.bureausNotItemized ? "bureaus not itemized" : n.bureaus.join(" and ")}.`,
    );
  }
  const co = data.negatives.filter((n) => n.kind === "charge_off");
  if (co.length) {
    out.push(
      es
        ? `${co.length} ${co.length === 1 ? "cargo a perdida" : "cargos a perdida"}: ${co.map((n) => `${n.creditor} ${pdfMoney(n.balance)}`).join(", ")}.`
        : `${co.length} charge-off${co.length === 1 ? "" : "s"}: ${co.map((n) => `${n.creditor} ${pdfMoney(n.balance)}`).join(", ")}.`,
    );
  }
  const lates = data.negatives.filter((n) => n.kind === "late");
  if (lates.length) {
    out.push(
      es
        ? `${lates.length} ${lates.length === 1 ? "cuenta con pagos atrasados" : "cuentas con pagos atrasados"} (${lates.map((n) => n.creditor).join(", ")}).`
        : `${lates.length} account${lates.length === 1 ? "" : "s"} with late payments (${lates.map((n) => n.creditor).join(", ")}).`,
    );
  }
  const util = printedUtilization(data);
  // v2.4 #9: when the revolving balance sits on charged-off / closed cards, say so in the same line.
  const badBal = data.utilization.filter((u) => u.balance > 0 && !inGoodStanding(u));
  const noGood = !!data.utilizationOverall.noOpenCardInGoodStanding && data.utilization.length > 0;
  if (badBal.length && (noGood || data.utilizationOverall.allFromDerogatory)) {
    const total = pdfMoney(badBal.reduce((s, u) => s + u.balance, 0));
    const what = badBal
      .map((u) => `${es ? (u.status === "charged_off" ? "la tarjeta en cargo a perdida" : "la tarjeta cerrada") : `the ${u.status === "charged_off" ? "charged-off" : "closed"}`} ${u.account}${es || /\bcard$/i.test(u.account) ? "" : " card"}`)
      .join(es ? " y " : " and ");
    out.push(
      es
        ? `Todo el saldo revolvente (${total}) esta en ${what}${noGood ? "; ninguna tarjeta abierta en buen estado." : "."}`
        : `All revolving balance (${total}) is ${what}${noGood ? "; no open card in good standing." : "."}`,
    );
  } else {
    if (util !== null && util > 30) out.push(es ? `Utilizacion revolvente al ${util}%.` : `Revolving utilization is ${util}%.`);
    if (noGood) out.push(es ? "No hay ninguna tarjeta abierta en buen estado reportando." : "No open credit card in good standing is currently reporting.");
  }
  for (const c of data.inquiryClusters ?? []) out.push(es ? `${c.count} consultas el ${c.from}.` : `${c.count} inquiries on ${c.from}.`);
  if (!data.negatives.length) out.push(es ? "No se encontraron cuentas negativas." : "No derogatory tradelines found.");
  return out.slice(0, 6);
}

/** Max 6 steps, real items only, no positives, no new credit during an active loan (P0-7 / P0-9). */
export function actionPlan(data: CreditAnalysisData, es: boolean): string[] {
  const steps: string[] = [];
  const names = (rows: Array<{ creditor: string }>) => [...new Set(rows.map((r) => r.creditor))].join(", ");
  if (data.escrow?.active) {
    steps.push(es ? "Confirmar con el oficial de prestamos el momento de las disputas." : "Confirm dispute timing with the loan officer.");
  }
  if (data.reportFormat === "merged") {
    steps.push(
      es
        ? "Sacar el reporte completo de MyFreeScoreNow (historial de 12 meses por buro) para fechar los atrasos."
        : "Pull the full MyFreeScoreNow report (12-month history by bureau) to date the lates.",
    );
  }
  if (data.missingBureaus.length) {
    steps.push(
      es
        ? `Levantar cualquier congelamiento en ${data.missingBureaus.join(", ")} y sacar un reporte de 3 buros.`
        : `Lift any freeze on ${data.missingBureaus.join(", ")} and pull a fresh 3-bureau report.`,
    );
  }
  // Rounds (real items only), merged when they would exceed the 6-step limit.
  const rounds: Array<{ label: number[]; what: string[] }> = [];
  const r1 = data.inquiries.filter((q) => q.action === "dispute");
  if (r1.length || (data.identityFlags ?? []).length) {
    rounds.push({
      label: [1],
      what: [
        ...(r1.length ? [es ? `consultas (${names(r1)})` : `inquiries (${names(r1)})`] : []),
        ...((data.identityFlags ?? []).length ? [es ? "datos personales" : "personal-info variances"] : []),
      ],
    });
  }
  for (const r of [2, 3, 4] as const) {
    const items = data.negatives.filter((n) => n.round === r && !n.hold);
    if (items.length) rounds.push({ label: [r], what: [names(items)] });
  }
  // Spec v2.3 P0-7: no step tells the client to pay, pay down or pay off a balance — the last step is the AU line.
  const tl = data.tradelines?.find((t) => t.code === "IH-1");
  const utilStep = !!tl;
  const slots = Math.max(1, 6 - steps.length - (utilStep ? 1 : 0));
  while (rounds.length > slots) {
    const b = rounds.pop()!;
    const a = rounds.pop()!;
    rounds.push({ label: [...a.label, ...b.label], what: [...a.what, ...b.what] });
  }
  for (const r of rounds) {
    const lbl = r.label.length > 1 ? `${es ? "Rondas" : "Rounds"} ${r.label[0]}-${r.label[r.label.length - 1]}` : `${es ? "Ronda" : "Round"} ${r.label[0]}`;
    steps.push(`${lbl}: ${r.what.join(es ? " y " : "; ")}.`);
  }
  if (utilStep) {
    const after = tl?.timing === "after_closing";
    steps.push(
      es
        ? `Linea AU (IH-1)${after ? ": agregar despues del cierre o antes de la siguiente solicitud; sin linea primaria nueva mientras el prestamo este activo" : ""}.`
        : `AU tradeline (IH-1)${after ? ": add after closing or before the next application; no new primary line while the loan file is active" : ""}.`,
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
  const f = new PageFlow(pdf, font, bold, logo, P.title, sub, L, `Optimum Financial Group  |  ${opts.phone}  |  ${opts.site}  |  ${OFG_REPORT_CONTACT.address}`, P.detailPage);

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

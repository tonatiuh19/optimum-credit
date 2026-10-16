/**
 * OFG Progress Report v2 (Cesar spec, Oct 15 2026) — diff engine, formulas,
 * validation layer and the 3-page PDF.
 *
 *  - Account matching BEFORE↔AFTER: account number + open month (fallback:
 *    creditor fuzzy + open month + limit). Never creditor name alone.
 *  - Honest attribution: only deletions / corrected history are wins.
 *    Client payments, re-reports, aged-off inquiries are labeled separately.
 *  - Validation never stops generation; it raises review flags that gate
 *    delivery (language-owner approval).
 *
 * Pure (no I/O). Inlined into api/index.ts by scripts/inline-credit-file-engine.mjs.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { BUREAUS, type Bureau, type BureauTradeline, type CreditAccount, type CreditFile } from "./creditFile";
import {
  isClosedTradeline,
  isNegativeTradeline,
  negativeKind,
  negativeLiftEstimate,
  parseReportDate,
} from "./creditAnalysisFromFile";

// ── types ───────────────────────────────────────────────────────────────────

export type Pv2Priority = "HIGH" | "MEDIUM" | "LOW";

export interface Pv2Win {
  item: string;
  bureaus: Bureau[];
  impact: Pv2Priority;
  status: "REMOVED" | "PARTIAL";
  /** Bureaus where it still reports (PARTIAL). */
  remainsOn: Bureau[];
  kind: "account" | "history" | "inquiry";
}

export interface Pv2Target {
  item: string;
  bureaus: Bureau[];
  detail: string;
  priority: Pv2Priority;
  lift: number;
}

export interface Pv2UtilRow {
  account: string;
  /** Bureau the row's numbers come from (totals use the overall bureau only). */
  bureau: Bureau;
  limit: number;
  baseline: number | null;
  current: number;
  pct: number;
  payTo30: number;
  payTo10: number;
}

export interface Pv2Diff {
  beforeDate: string | null;
  afterDate: string | null;
  wins: Pv2Win[];
  /** Client actions (payments / cures) — not dispute results. */
  clientActions: string[];
  targets: Pv2Target[];
  utilization: Pv2UtilRow[];
  utilizationOverall: { before: number | null; after: number | null; bureau: Bureau | null };
  utilizationNotes: string[];
  positives: string[];
  positivesFlags: { history: boolean; noCollections: boolean };
  /** Internal only (case notes, never the client PDF). */
  internal: string[];
  counts: { beforeAccounts: number; afterAccounts: number; beforeInquiries: number; afterInquiries: number };
  /** Open derogatory on AFTER (for file strength / caps). */
  after: { openDerogatory: number; derogatory: number; lates24m: boolean; olderLates: boolean; publicRecord: boolean; openRevolving: number };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function pv2Alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pv2MaskDigits(mask: string | null): string {
  return String(mask || "").replace(/[^0-9]/g, "");
}

function pv2OpenedMonth(a: CreditAccount): string | null {
  for (const b of BUREAUS) {
    const d = parseReportDate(a.bureaus[b]?.dateOpened);
    if (d) return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
  }
  return null;
}

function pv2Limit(a: CreditAccount): number | null {
  for (const b of BUREAUS) {
    const v = a.bureaus[b]?.creditLimit ?? a.bureaus[b]?.highBalance;
    if (v) return v;
  }
  return null;
}

function pv2CreditorSimilar(x: string, y: string): boolean {
  const a = pv2Alnum(x).replace(/(llc|inc|corp|co|na|bank)$/g, "");
  const b = pv2Alnum(y).replace(/(llc|inc|corp|co|na|bank)$/g, "");
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
}

/** BEFORE↔AFTER account match: mask + open month; fallback creditor + month + limit. */
export function pv2MatchAccounts(before: CreditAccount[], after: CreditAccount[]): Map<CreditAccount, CreditAccount> {
  const out = new Map<CreditAccount, CreditAccount>();
  const used = new Set<CreditAccount>();
  const tryMatch = (pred: (b: CreditAccount, a: CreditAccount) => boolean) => {
    for (const b of before) {
      if (out.has(b)) continue;
      const a = after.find((x) => !used.has(x) && pred(b, x));
      if (a) {
        out.set(b, a);
        used.add(a);
      }
    }
  };
  // 1) account number (shared 4+ leading digits) + same open month.
  tryMatch((b, a) => {
    const mb = pv2MaskDigits(b.mask);
    const ma = pv2MaskDigits(a.mask);
    const n = Math.min(mb.length, ma.length);
    return n >= 4 && mb.slice(0, n) === ma.slice(0, n) && pv2OpenedMonth(b) === pv2OpenedMonth(a) && pv2OpenedMonth(b) !== null;
  });
  // 2) creditor fuzzy + open month + limit / high balance.
  tryMatch((b, a) => {
    const lb = pv2Limit(b);
    const la = pv2Limit(a);
    return (
      pv2CreditorSimilar(b.creditor, a.creditor) &&
      pv2OpenedMonth(b) !== null &&
      pv2OpenedMonth(b) === pv2OpenedMonth(a) &&
      (lb === null || la === null || Math.abs(lb - la) <= 1 || pv2Alnum(b.creditor) === pv2Alnum(a.creditor))
    );
  });
  return out;
}

const pv2Lates = (t: BureauTradeline | undefined) => (t ? (t.late30 ?? 0) + (t.late60 ?? 0) + (t.late90 ?? 0) + (t.gridMarks?.length ?? 0) : 0);

function pv2LateDetail(a: CreditAccount): string {
  const parts: string[] = [];
  for (const b of BUREAUS) {
    const t = a.bureaus[b];
    if (!t || !(t.late30 || t.late60 || t.late90)) continue;
    const seg = [t.late30 ? `${t.late30}x30` : "", t.late60 ? `${t.late60}x60` : "", t.late90 ? `${t.late90}x90` : ""].filter(Boolean).join(", ");
    parts.push(`${b} ${seg}`);
  }
  return parts.join("; ");
}

function pv2Priority(kind: string): Pv2Priority {
  return kind === "charge_off" || kind === "collection" || kind === "repossession" || kind === "public_record" ? "HIGH" : kind === "late" ? "MEDIUM" : "LOW";
}

const pv2Money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ── client-facing text (EN / ES) ────────────────────────────────────────────

export type Pv2Lang = "en" | "es";

function pv2T(lang: Pv2Lang) {
  const es = lang === "es";
  const kindName = (k: string) =>
    es
      ? ({ charge_off: "Cargo a perdida", collection: "Cobranza", late: "Pagos atrasados", repossession: "Reposesion", public_record: "Registro publico" } as Record<string, string>)[k] ?? "Negativa"
      : ({ charge_off: "Charge-off", collection: "Collection", late: "Late payments", repossession: "Repossession", public_record: "Public record" } as Record<string, string>)[k] ?? "Derogatory";
  return {
    winSuffix: (k: string) =>
      k === "late" ? (es ? " - pago atrasado" : " - late payment") : k === "charge_off" ? (es ? " - cargo a perdida" : " - charge-off") : k === "collection" ? (es ? " - cobranza" : " - collection") : "",
    inquiries: (names: string) => (es ? `Consultas de credito (${names})` : `Hard inquiries (${names})`),
    clientAction: (creditor: string, was: string | null, pd: string | null, closedPaid: boolean) =>
      es
        ? `${creditor} paso de ${was ? was.toLowerCase() : "pago vencido"}${pd ? ` (${pd} vencido)` : ""} a ${closedPaid ? "cerrada y pagada" : "al corriente"} con $0 vencido`
        : `${creditor} went from ${was ? was.toLowerCase() : "past due"}${pd ? ` (${pd} past due)` : ""} to ${closedPaid ? "closed paid" : "Current"} with $0 past due`,
    kindName,
    chargedOff: (m: string) => (es ? `${m} cargado a perdida` : `${m} charged off`),
    inCollection: (m: string) => (es ? `${m} en cobranza` : `${m} in collection`),
    pastDue: (m: string) => (es ? `${m} vencido` : `${m} past due`),
    nowCurrent: es ? "ya al corriente" : "now current",
    limitChanged: (acct: string, up: boolean, from: string, to: string) =>
      es ? `El limite de ${acct} ${up ? "subio" : "bajo"} de ${from} a ${to} desde la linea base.` : `${acct} limit ${up ? "increased" : "decreased"} from ${from} to ${to} since baseline.`,
    notReporting: (m: string, acct: string, bureaus: string) =>
      es ? `La linea de ${m} de ${acct} no se esta reportando en ${bureaus}.` : `The ${m} ${acct} line is not currently reporting on ${bureaus}.`,
    noCollections: es ? "Sin cobranzas, registros publicos ni bancarrotas en ningun buro." : "No collections, public records, or bankruptcies on any bureau.",
    historySince: (y: number, c: string) => (es ? `Historial de credito desde ${y} (${c}).` : `Credit history dating back to ${y} (${c}).`),
    paidLoans: (n: number) => (es ? `${n} ${n === 1 ? "prestamo cerrado y pagado" : "prestamos cerrados y pagados"} segun lo acordado.` : `${n} installment ${n === 1 ? "loan" : "loans"} closed paid as agreed.`),
    totalLimits: (m: string, zero: string) =>
      es ? `Cerca de ${m} en limites revolventes abiertos${zero ? `, incluyendo lineas en $0 en ${zero}` : ""}.` : `About ${m} in open revolving limits${zero ? `, including $0-balance lines at ${zero}` : ""}.`,
    allCurrent: es ? "Todas las cuentas abiertas se reportan al corriente." : "All open accounts are reporting Current.",
  };
}

// ── diff engine ─────────────────────────────────────────────────────────────

export function pv2Diff(before: CreditFile, after: CreditFile, lang: Pv2Lang = "en"): Pv2Diff {
  const T = pv2T(lang);
  const afterDate = parseReportDate(after.reportDate);
  const matches = pv2MatchAccounts(before.accounts, after.accounts);
  const matchedAfter = new Set(matches.values());
  const wins: Pv2Win[] = [];
  const clientActions: string[] = [];
  const internal: string[] = [];
  const negBureaus = (a: CreditAccount) => BUREAUS.filter((b) => a.bureaus[b] && isNegativeTradeline(a.bureaus[b]!, a));

  // Unmatched AFTER accounts (candidates for re-reports).
  const unmatchedAfter = after.accounts.filter((a) => !matchedAfter.has(a));

  for (const b of before.accounts) {
    const nb = negBureaus(b);
    if (!nb.length) continue;
    const a = matches.get(b);
    const kind = negativeKind(b, nb.map((x) => b.bureaus[x]!));
    const deletedOn = nb.filter((x) => !a?.bureaus[x]);
    const stillNeg = a ? nb.filter((x) => a.bureaus[x] && isNegativeTradeline(a.bureaus[x]!, a)) : [];
    const cleanedOn = a ? nb.filter((x) => a.bureaus[x] && !stillNeg.includes(x)) : [];

    // Re-report: "removed" here, but an unmatched AFTER account with the same
    // open month + limit appeared (new name / number). Not a win.
    if (deletedOn.length) {
      const re = unmatchedAfter.find((x) => pv2OpenedMonth(x) === pv2OpenedMonth(b) && pv2OpenedMonth(b) !== null && pv2Limit(x) !== null && pv2Limit(x) === pv2Limit(b) && deletedOn.some((d) => x.bureaus[d]));
      if (re) {
        internal.push(`Re-report (not a win): ${b.creditor} on ${deletedOn.filter((d) => re.bureaus[d]).join("/")} re-reported as ${re.creditor}`);
        deletedOn.splice(0, deletedOn.length, ...deletedOn.filter((d) => !re.bureaus[d]));
      }
    }

    // No longer negative on a bureau BECAUSE the late history was corrected
    // (a dispute result). Only a payment bringing it current is NOT a win.
    const historyCorrected = cleanedOn.filter(
      (x) =>
        pv2Lates(a!.bureaus[x]) < pv2Lates(b.bureaus[x]) ||
        (pv2Lates(b.bureaus[x]) === 0 && (b.bureaus[x]!.pastDue ?? 0) === 0 && !/past due|late/i.test(`${a!.bureaus[x]!.paymentStatus || ""}`)),
    );

    const removedOn = [...deletedOn, ...historyCorrected];
    if (removedOn.length) {
      const remainsOn = nb.filter((x) => !removedOn.includes(x));
      const label = b.creditor + T.winSuffix(kind);
      wins.push({
        item: label,
        bureaus: removedOn,
        impact: remainsOn.length ? "MEDIUM" : pv2Priority(kind) === "LOW" ? "MEDIUM" : "HIGH",
        status: remainsOn.length ? "PARTIAL" : "REMOVED",
        remainsOn,
        kind: deletedOn.length ? "account" : "history",
      });
    }
  }

  // Client-action cures (any matched account): past due → $0, late status →
  // Current, or closed paid. Labeled separately — never a dispute win.
  for (const [b, a] of matches) {
    const cureOn = BUREAUS.filter((x) => {
      const tb = b.bureaus[x];
      const ta = a.bureaus[x];
      if (!tb || !ta) return false;
      const wasPastDue = (tb.pastDue ?? 0) > 0 || /past due|late/i.test(tb.paymentStatus || "");
      const nowOk = (ta.pastDue ?? 0) === 0 && !/past due|late/i.test(ta.paymentStatus || "");
      return wasPastDue && nowOk;
    });
    if (!cureOn.length) continue;
    const pd = Math.max(...cureOn.map((x) => b.bureaus[x]!.pastDue ?? 0));
    const lateWas = cureOn.map((x) => b.bureaus[x]!.paymentStatus).find((s) => s && /late/i.test(s));
    const closedPaid = cureOn.some((x) => isClosedTradeline(a.bureaus[x]!, a));
    clientActions.push(T.clientAction(a.creditor, lateWas ?? null, pd > 0 ? pv2Money(pd) : null, closedPaid));
  }

  // Late counts that went UP on an existing account (internal flag).
  for (const [b, a] of matches) {
    for (const x of BUREAUS) {
      if (a.bureaus[x] && b.bureaus[x] && pv2Lates(a.bureaus[x]) > pv2Lates(b.bureaus[x])) {
        internal.push(`${x} late count +${pv2Lates(a.bureaus[x]) - pv2Lates(b.bureaus[x])} on ${a.creditor}`);
      }
    }
  }

  // Inquiries: removed (< 24 months before AFTER date) = win; older = aged off.
  const qKey = (q: { creditor: string; bureau: Bureau; date: string }) => `${pv2Alnum(q.creditor)}|${q.bureau}|${q.date}`;
  const afterQ = new Set(after.inquiries.map(qKey));
  const beforeQ = new Set(before.inquiries.map(qKey));
  const removedQ = before.inquiries.filter((q) => !afterQ.has(qKey(q)));
  const inquiryWins = removedQ.filter((q) => {
    const d = parseReportDate(q.date);
    return !d || !afterDate || afterDate.getTime() - d.getTime() < 730 * 86_400_000;
  });
  const agedOff = removedQ.filter((q) => !inquiryWins.includes(q));
  if (agedOff.length) internal.push(`Aged off (not a win): ${agedOff.map((q) => `${q.creditor} ${q.bureau}`).join(", ")}`);
  if (inquiryWins.length) {
    const per = BUREAUS.map((b) => [b, inquiryWins.filter((q) => q.bureau === b).length] as const).filter(([, n]) => n > 0);
    const names = [...new Set(inquiryWins.map((q) => q.creditor))];
    wins.push({
      item: T.inquiries(`${names.slice(0, 5).join(", ")}${names.length > 5 ? ", ..." : ""}`),
      bureaus: per.map(([b]) => b),
      impact: "LOW",
      status: "REMOVED",
      remainsOn: [],
      kind: "inquiry",
    });
    // Per-bureau counts kept in the item text for the client.
    wins[wins.length - 1].item += ` - ${per.map(([b, n]) => `${b} x${n}`).join(" / ")}`;
  }
  const newQ = after.inquiries.filter((q) => !beforeQ.has(qKey(q)));
  if (newQ.length) internal.push(`New inquiries: ${newQ.map((q) => `${q.creditor} ${q.bureau} ${q.date}`).join(", ")}`);

  // Targets: every remaining negative on AFTER.
  const targets: Pv2Target[] = [];
  for (const a of after.accounts) {
    const na = negBureaus(a);
    if (!na.length) continue;
    const tls = na.map((x) => a.bureaus[x]!);
    const kind = negativeKind(a, tls);
    const amount = Math.max(...tls.map((t) => (kind === "charge_off" || kind === "collection" ? t.balance ?? 0 : t.pastDue ?? 0)));
    const isNew = ![...matches.values()].includes(a);
    if (isNew) internal.push(`New negative: ${a.creditor} (${na.join("/")})`);
    const detail = [
      kind === "charge_off" && amount ? T.chargedOff(pv2Money(amount)) : kind === "collection" && amount ? T.inCollection(pv2Money(amount)) : "",
      pv2LateDetail(a),
      kind !== "charge_off" && kind !== "collection" && amount ? T.pastDue(pv2Money(amount)) : "",
      tls.some((t) => /current/i.test(t.paymentStatus || "")) && pv2LateDetail(a) ? T.nowCurrent : "",
    ]
      .filter(Boolean)
      .join("; ");
    targets.push({
      item: `${a.creditor} - ${T.kindName(kind)}`,
      bureaus: na,
      detail: detail || (tls[0].paymentStatus ?? ""),
      priority: pv2Priority(kind),
      lift: negativeLiftEstimate(kind, tls.map((t) => `${t.paymentStatus || ""} ${t.remarks || ""}`).join(" ")),
    });
  }
  targets.sort((x, y) => ["HIGH", "MEDIUM", "LOW"].indexOf(x.priority) - ["HIGH", "MEDIUM", "LOW"].indexOf(y.priority));

  // Utilization: every OPEN revolving AFTER account with a limit; one bureau
  // per row (TU, then EX, then EQ), baseline from the matched BEFORE account.
  const utilization: Pv2UtilRow[] = [];
  const utilizationNotes: string[] = [];
  const revOpen = after.accounts.filter((a) => a.section === "revolving" && BUREAUS.some((b) => a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a)));
  for (const a of revOpen) {
    const b = BUREAUS.find((x) => a.bureaus[x]?.creditLimit);
    if (!b) continue;
    const t = a.bureaus[b]!;
    const limit = t.creditLimit!;
    const cur = Math.max(0, t.balance ?? 0);
    const prior = [...matches.entries()].find(([, v]) => v === a)?.[0];
    const baseline = prior?.bureaus[b]?.balance ?? null;
    const priorLimit = prior?.bureaus[b]?.creditLimit ?? null;
    if (priorLimit && priorLimit !== limit) {
      utilizationNotes.push(T.limitChanged(a.creditor, limit > priorLimit, pv2Money(priorLimit), pv2Money(limit)));
    }
    const missing = BUREAUS.filter((x) => (after.scores[x] !== null) && !a.bureaus[x]);
    if (missing.length && limit >= 5000) {
      utilizationNotes.push(T.notReporting(pv2Money(limit), a.creditor, missing.join("/")));
    }
    utilization.push({
      account: a.creditor,
      bureau: b,
      limit,
      baseline,
      current: cur,
      pct: Math.round((cur / limit) * 100),
      payTo30: Math.floor(limit * 0.3),
      payTo10: Math.floor(limit * 0.1),
    });
  }
  utilization.sort((x, y) => y.pct - x.pct);
  const overallFor = (f: CreditFile, b: Bureau) => {
    const rev = f.accounts.filter((a) => a.section === "revolving" && a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a) && (a.bureaus[b]!.creditLimit ?? 0) > 0);
    const lim = rev.reduce((s, a) => s + a.bureaus[b]!.creditLimit!, 0);
    const bal = rev.reduce((s, a) => s + Math.max(0, a.bureaus[b]!.balance ?? 0), 0);
    return lim > 0 ? Math.round((bal / lim) * 100) : null;
  };
  const uBureau = BUREAUS.find((b) => overallFor(after, b) !== null) ?? null;
  const utilizationOverall = {
    bureau: uBureau,
    before: uBureau ? overallFor(before, uBureau) : null,
    after: uBureau ? overallFor(after, uBureau) : null,
  };

  // What is working in your favor (data-built bullets only).
  const positives: string[] = [];
  const afterNeg = after.accounts.filter((a) => negBureaus(a).length);
  const hasColl = afterNeg.some((a) => negativeKind(a, negBureaus(a).map((x) => a.bureaus[x]!)) === "collection");
  if (!hasColl && after.publicRecordsReported !== true) positives.push(T.noCollections);
  const opens = after.accounts
    .map((a) => ({ a, d: BUREAUS.map((b) => parseReportDate(a.bureaus[b]?.dateOpened)).find(Boolean) }))
    .filter((x): x is { a: CreditAccount; d: Date } => !!x.d)
    .sort((x, y) => x.d.getTime() - y.d.getTime());
  if (opens.length) positives.push(T.historySince(opens[0].d.getUTCFullYear(), opens[0].a.creditor));
  const paidLoans = after.accounts.filter(
    (a) => a.section === "installment" && !negBureaus(a).length && BUREAUS.some((b) => a.bureaus[b] && isClosedTradeline(a.bureaus[b]!, a)),
  );
  if (paidLoans.length) positives.push(T.paidLoans(paidLoans.length));
  const totalLimit = utilization.reduce((s, u) => s + u.limit, 0);
  const zeroLines = utilization.filter((u) => u.current === 0);
  if (totalLimit > 0) {
    positives.push(T.totalLimits(pv2Money(totalLimit), zeroLines.slice(0, 3).map((u) => `${u.account} (${pv2Money(u.limit)})`).join(", ")));
  }
  const openAccts = after.accounts.filter((a) => BUREAUS.some((b) => a.bureaus[b] && !isClosedTradeline(a.bureaus[b]!, a)));
  if (openAccts.length && openAccts.every((a) => !negBureaus(a).length)) positives.push(T.allCurrent);

  const now = afterDate ?? new Date();
  const lateWhen = (a: CreditAccount) =>
    BUREAUS.flatMap((b) => (a.bureaus[b]?.gridMarks ?? []).map((m) => parseReportDate(m.split(":")[0]))).filter((d): d is Date => !!d);
  const lateDates = afterNeg.flatMap(lateWhen);
  const recentCut = now.getTime() - 730 * 86_400_000;
  const anyLates = afterNeg.some((a) => negBureaus(a).some((b) => pv2Lates(a.bureaus[b]) > 0 || /late/i.test(a.bureaus[b]!.paymentStatus || "")));
  return {
    beforeDate: before.reportDate,
    afterDate: after.reportDate,
    wins,
    clientActions,
    targets,
    utilization,
    utilizationOverall,
    utilizationNotes: [...new Set(utilizationNotes)],
    positives: positives.slice(0, 5),
    positivesFlags: { history: opens.length > 0, noCollections: !hasColl && after.publicRecordsReported !== true },
    internal,
    counts: {
      beforeAccounts: before.accounts.length,
      afterAccounts: after.accounts.length,
      beforeInquiries: before.inquiries.length,
      afterInquiries: after.inquiries.length,
    },
    after: {
      openDerogatory: afterNeg.filter((a) => {
        const k = negativeKind(a, negBureaus(a).map((x) => a.bureaus[x]!));
        return (k === "charge_off" || k === "collection") && BUREAUS.some((b) => a.bureaus[b] && !/paid|settled/i.test(a.bureaus[b]!.accountStatus || ""));
      }).length,
      derogatory: afterNeg.length,
      lates24m: lateDates.some((d) => d.getTime() >= recentCut) || (anyLates && !lateDates.length),
      olderLates: lateDates.some((d) => d.getTime() < recentCut),
      publicRecord: after.publicRecordsReported === true,
      openRevolving: utilization.length,
    },
  };
}

// ── formulas ────────────────────────────────────────────────────────────────

export function pv2MiddleScore(s: Record<Bureau, number | null>): number | null {
  const v = BUREAUS.map((b) => s[b]).filter((n): n is number => n !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length === 3 ? v[1] : v.length === 2 ? Math.round((v[0] + v[1]) / 2) : v[0];
}

/** "[=========== ]" 20 chars, ASCII only. */
export function pv2AsciiBar(score: number | null): string {
  if (score === null) return `[${" ".repeat(20)}]`;
  const n = Math.max(0, Math.min(20, Math.round(((score - 300) / 550) * 20)));
  return `[${"=".repeat(n)}${" ".repeat(20 - n)}]`;
}

/**
 * File strength 0-100: start 100 and subtract; caps for open derogatories /
 * high utilization. Unknown utilization never adds points.
 */
export function pv2FileStrength(opts: {
  openChargeOffsOrCollections: number;
  lates24m: boolean;
  olderLates: boolean;
  overallUtil: number | null;
  publicRecord: boolean;
  openRevolving: number;
  anyDerogatory: boolean;
}): number {
  let s = 100;
  s -= Math.min(30, opts.openChargeOffsOrCollections * 15);
  if (opts.lates24m) s -= 10;
  else if (opts.olderLates) s -= 5;
  const u = opts.overallUtil;
  if (u !== null) s -= u > 80 ? 25 : u >= 50 ? 15 : u >= 30 ? 8 : 0;
  if (opts.publicRecord) s -= 20;
  if (opts.openRevolving < 3) s -= 10;
  if (opts.openChargeOffsOrCollections > 0 || (u !== null && u > 50)) s = Math.min(s, 70);
  if (opts.anyDerogatory) s = Math.min(s, 85);
  return Math.max(0, Math.min(100, s));
}

/** Projected goal RANGE (never one number; always > current; max 850). */
export function pv2GoalRange(current: number, remainingLift: number, overallUtil: number | null): { low: number; high: number } {
  const [uLow, uHigh] = overallUtil === null ? [0, 0] : overallUtil > 50 ? [15, 25] : overallUtil >= 30 ? [8, 15] : [0, 5];
  const low = Math.min(850, current + Math.max(5, Math.round(remainingLift * 0.35) + uLow));
  const high = Math.min(850, Math.max(low + 10, current + Math.round(remainingLift * 0.6) + uHigh));
  return { low: Math.min(low, 849), high: Math.max(Math.min(high, 850), Math.min(low, 849) + 1) };
}

// ── validation layer ────────────────────────────────────────────────────────

export interface Pv2Flag {
  code:
    | "parse_failure"
    | "same_pull"
    | "chronology_swapped"
    | "unverified_movement"
    | "round_mismatch"
    | "file_strength_cap"
    | "goal_not_above_current"
    | "pay_to_order"
    | "no_negatives_contradiction"
    | "text_hygiene"
    | "internal_note";
  message: string;
}

const UI_LABEL_JUNK = /current address|order an update now|currently using across|previous addresses|consumer statement/i;

export function pv2Validate(input: {
  diff: Pv2Diff | null;
  beforeHash?: string | null;
  afterHash?: string | null;
  scoresBefore: Record<Bureau, number | null>;
  scoresAfter: Record<Bureau, number | null>;
  clientText: string[];
  fileStrength: number;
  goal: { low: number; high: number } | null;
  utilization: Array<{ payTo30: number; payTo10: number }>;
}): Pv2Flag[] {
  const flags: Pv2Flag[] = [];
  const d = input.diff;
  if (!d) {
    flags.push({ code: "parse_failure", message: "Account-level read not available for both pulls — wins/targets come from text parsing; verify against the PDFs." });
  } else {
    if (!d.counts.beforeAccounts || !d.counts.afterAccounts) {
      flags.push({ code: "parse_failure", message: `Parse failure: ${d.counts.beforeAccounts} accounts BEFORE / ${d.counts.afterAccounts} AFTER.` });
    }
    if (d.beforeDate && d.beforeDate === d.afterDate) flags.push({ code: "same_pull", message: `BEFORE and AFTER have the same report date (${d.afterDate}).` });
    const bd = parseReportDate(d.beforeDate);
    const ad = parseReportDate(d.afterDate);
    if (bd && ad && bd.getTime() > ad.getTime()) flags.push({ code: "chronology_swapped", message: "BEFORE is newer than AFTER — swapped." });
    for (const n of d.internal) flags.push({ code: "internal_note", message: n });
    const mb = pv2MiddleScore(input.scoresBefore);
    const ma = pv2MiddleScore(input.scoresAfter);
    if (mb !== null && ma !== null && Math.abs(ma - mb) >= 10 && !d.wins.length && !d.clientActions.length && (d.utilizationOverall.before ?? 0) === (d.utilizationOverall.after ?? 0)) {
      flags.push({ code: "unverified_movement", message: `Middle score moved ${mb} -> ${ma} with no visible driver — verify before delivery.` });
    }
    if (d.targets.length && input.clientText.some((t) => /no negatives|no negative items|none detected/i.test(t))) {
      flags.push({ code: "no_negatives_contradiction", message: "Text says no negatives while the AFTER pull has negative accounts." });
    }
  }
  if (input.beforeHash && input.beforeHash === input.afterHash) flags.push({ code: "same_pull", message: "BEFORE and AFTER are the same file." });
  if (input.goal && input.goal.low <= (pv2MiddleScore(input.scoresAfter) ?? 0)) flags.push({ code: "goal_not_above_current", message: "Projected goal is not above the current middle score." });
  if (input.utilization.some((u) => u.payTo10 > u.payTo30)) flags.push({ code: "pay_to_order", message: "Pay to 10% target is above the 30% target." });
  if (input.clientText.some((t) => UI_LABEL_JUNK.test(t))) flags.push({ code: "text_hygiene", message: "Report-UI labels found in client text." });
  return flags;
}

/** PDF + plan labels (EN / ES). Spanish version is approved by the ES owner. */
function pv2L(lang: Pv2Lang) {
  const es = lang === "es";
  return {
    brand: "OPTIMUM FINANCIAL GROUP",
    title: es ? "INFORME DE PROGRESO DE CREDITO" : "CREDIT PROGRESS REPORT",
    preparedFor: (n: string, b: string, c: string) => (es ? `Preparado para: ${n}  |  Base ${b}  |  Actual ${c}` : `Prepared for: ${n}  |  Baseline ${b}  |  Current ${c}`),
    page: (n: number) => (es ? `Pagina ${n} de 3` : `Page ${n} of 3`),
    scoreProgress: es ? "Su progreso de puntaje" : "Your Score Progress",
    intro: (first: string, base: string, allUp: boolean, scoreText: string) =>
      es
        ? `${first}, asi esta su archivo desde su base del ${base}. ${allUp ? "Todos los buros subieron, y su" : "Su"} puntaje medio ${scoreText}.`
        : `${first}, here is where your file stands since your ${base} baseline. ${allUp ? "Every bureau moved up, and your" : "Your"} middle score ${scoreText}.`,
    climbed: (b: number, a: number) => (es ? `subio de ${b} a ${a}` : `climbed from ${b} to ${a}`),
    isNow: (a: number, b: number) => (es ? `es ${a} (base ${b})` : `is ${a} (baseline ${b})`),
    shownBelow: es ? "se muestra abajo" : "is shown below",
    bureau: es ? "Buro" : "Bureau",
    baseline: (d: string) => (es ? `Base (${d})` : `Baseline (${d})`),
    current: (d: string) => (es ? `Actual (${d})` : `Current (${d})`),
    gained: es ? "Puntos ganados" : "Points Gained",
    middle: es ? "Puntaje medio" : "Middle Score",
    pts: "pts",
    cameOff: es ? "Lo que salio de su reporte" : "What Came Off Your Report",
    itemRemoved: es ? "Elemento eliminado" : "Item Removed",
    bureaus: es ? "Buros" : "Bureaus",
    impact: es ? "Impacto" : "Impact",
    status: es ? "Estado" : "Status",
    impactText: (imp: string, kind: string, partialN: number) =>
      `${es ? ({ HIGH: "ALTO", MEDIUM: "MEDIO", LOW: "BAJO" } as Record<string, string>)[imp] : imp} - ${
        kind === "inquiry"
          ? es ? "consultas eliminadas" : "inquiries deleted"
          : partialN
            ? es ? `corregido en ${partialN} ${partialN === 1 ? "buro" : "buros"}` : `corrected on ${partialN} ${partialN === 1 ? "bureau" : "bureaus"}`
            : kind === "history"
              ? es ? "historial de atrasos corregido" : "late history corrected"
              : es ? "cuenta negativa eliminada" : "negative account removed"
      }`,
    removed: es ? "ELIMINADO" : "REMOVED",
    partial: (remains: string) => (es ? `GANANCIA PARCIAL (queda en ${remains})` : `PARTIAL WIN (${remains} remains)`),
    progressToo: es ? "Su progreso tambien" : "Your progress too",
    progressTooBody: (items: string) =>
      es
        ? `${items}. Estas fueron acciones suyas, no disputas, y son parte de este cambio de puntaje.`
        : `${items}. These were your actions, not disputes, and they are part of this score change.`,
    stillOn: (r: number) => (es ? `Lo que sigue en su reporte (objetivos de la Ronda ${r})` : `What Is Still On Your Report (Round ${r} Targets)`),
    item: es ? "Elemento" : "Item",
    detail: es ? "Detalle" : "Detail",
    priority: es ? "Prioridad" : "Priority",
    prio: (p: string) => (es ? ({ HIGH: "ALTA", MEDIUM: "MEDIA", LOW: "BAJA" } as Record<string, string>)[p] ?? p : p),
    noTargets: es ? "No quedan cuentas negativas en el reporte actual." : "No negative accounts remain on the current pull.",
    utilTitle: es ? "Utilizacion de credito" : "Credit Utilization",
    utilIntro: (b: number | null, a: number | null, bureau: string) =>
      `${es ? "La utilizacion es cuanto usa de sus limites de credito. Menos de 30% es bueno; menos de 10% da el mayor beneficio." : "Utilization is how much of your credit limits you are using. Under 30% is good; under 10% gives the maximum boost."}${
        b !== null && a !== null
          ? es
            ? ` Su utilizacion total ${a <= b ? "mejoro" : "cambio"} de ${b}% a ${a}% (${bureau}).`
            : ` Your overall utilization ${a <= b ? "improved" : "moved"} from ${b}% to ${a}% (${bureau}).`
          : ""
      }`,
    account: es ? "Cuenta" : "Account",
    limit: es ? "Limite" : "Limit",
    baseBal: es ? "Saldo base" : "Baseline Bal.",
    curBal: es ? "Saldo actual" : "Current Bal.",
    used: es ? "% usado" : "% Used",
    payTo30h: es ? "Pagar a 30%" : "Pay to 30%",
    payTo10h: es ? "Pagar a 10%" : "Pay to 10%",
    band: (p: number) => (p > 50 ? (es ? "ALTO" : "HIGH") : p >= 30 ? (es ? "REGULAR" : "FAIR") : es ? "BIEN" : "GOOD"),
    payTo: (m: string) => (es ? `Pagar a ${m}` : `Pay to ${m}`),
    alreadyOk: es ? "Ya esta bien" : "Already OK",
    totalRevolving: (b: string) => (es ? `Total revolvente${b ? ` (${b})` : ""}` : `Total revolving${b ? ` (${b})` : ""}`),
    noUtil: es ? "No hay cuentas revolventes abiertas con limite en el reporte actual." : "No open revolving accounts with a credit limit on the current pull.",
    working: es ? "Lo que trabaja a su favor" : "What Is Working in Your Favor",
    actionNeeded: es ? "Accion necesaria" : "Action Needed",
    roadmap: es ? "Su ruta" : "Your Roadmap",
    roundsDone: (r: number) => (r > 1 ? (es ? `RONDAS 1-${r - 1} COMPLETAS` : `ROUNDS 1-${r - 1} COMPLETE`) : es ? "INSCRIPCION COMPLETA" : "ENROLLMENT COMPLETE"),
    removedCount: (n: number) => (n ? (es ? `${n} ${n === 1 ? "elemento eliminado o corregido" : "elementos eliminados o corregidos"}` : `${n} ${n === 1 ? "item" : "items"} removed or corrected`) : es ? "Base establecida" : "Baseline set"),
    roundActive: (r: number) => (es ? `RONDA ${r} ACTIVA` : `ROUND ${r} ACTIVE`),
    nextTargets: es ? "Siguientes objetivos" : "Next targets",
    utilization: es ? "UTILIZACION" : "UTILIZATION",
    bringUnder: (names: string) => (es ? `Bajar ${names} a < 30%` : `Bring ${names} < 30%`),
    keepUnder: es ? "Mantener saldos bajo 30%" : "Keep balances under 30%",
    scoreGoal: es ? "META DE PUNTAJE" : "SCORE GOAL",
    projected: (l: number, h: number) => (es ? `${l}-${h} proyectado` : `${l}-${h} projected`),
    done: es ? "HECHO" : "DONE",
    inProgress: es ? "EN PROCESO" : "IN PROGRESS",
    clientAction: es ? "ACCION DEL CLIENTE" : "CLIENT ACTION",
    target: es ? "META" : "TARGET",
    currentRow: es ? "Actual" : "Current",
    goalRow: es ? "Meta proyectada" : "Projected goal",
    goalVal: (l: number, h: number) => (es ? `${l}-${h} (proyectado)` : `${l}-${h} (projected)`),
    gapRow: es ? "Diferencia restante" : "Gap remaining",
    points: es ? "puntos" : "points",
    plan: es ? "Su plan de accion personalizado" : "Your Personalized Action Plan",
    step: (n: number) => (es ? `Paso ${n}` : `Step ${n}`),
    strength: es ? "Fortaleza del archivo" : "File Strength Score",
    strengthBar: es ? "FORTALEZA" : "FILE STRENGTH",
    questions: (ph: string, site: string) => (es ? `Preguntas? Llamenos al ${ph} o visite ${site}.` : `Questions? Call us at ${ph} or visit ${site}.`),
    croaTitle: es ? "DIVULGACION CROA" : "CROA DISCLOSURE",
    croa: es
      ? "Optimum Financial Group presta servicios de reparacion de credito conforme a la Ley de Organizaciones de Reparacion de Credito (CROA), 15 U.S.C. §1679 y ss. No garantizamos mejoras especificas de puntaje. Los resultados varian segun la persona. Los puntajes proyectados son estimaciones, no garantias."
      : "Optimum Financial Group provides credit repair services in compliance with the Credit Repair Organizations Act (CROA), 15 U.S.C. §1679 et seq. We do not guarantee specific score improvements. Results vary by individual. Projected scores are estimates, not guarantees.",
    actionUtil: (top: string, pct: number, cur: string, lim: string, more: string) =>
      es
        ? `La utilizacion es la palanca mas grande en sus manos. ${top} al ${pct}% (${cur} de ${lim}) es lo que mas baja su puntaje${more ? `, seguido de ${more}` : ""}. Bajar los saldos a menos de 30% en el proximo estado de cuenta puede sumar puntos proyectados ademas del trabajo de disputas.`
        : `Utilization is the biggest lever still in your hands. ${top} at ${pct}% (${cur} of ${lim}) is the largest score suppressor on your file${more ? `, followed by ${more}` : ""}. Bringing balances under 30% on the next statement cycle can add projected points on top of the dispute work.`,
    keepCurrent: es ? "Mantenga todas las cuentas al corriente: un nuevo atraso podria deshacer este progreso." : "Keep every account current - one new late payment could undo this progress.",
    planOfg: (r: number, names: string) => (es ? `Nuestro equipo (Ronda ${r}): estamos disputando ${names || "los elementos restantes de su archivo"}.` : `Our team (Round ${r}): we are actively disputing ${names || "the remaining items on your file"}.`),
    planClient: (names: string) =>
      names
        ? es ? `Su parte (utilizacion): baje ${names}, buscando menos de 30% en cada tarjeta.` : `Your part (utilization): lower ${names}, aiming for under 30% on each card.`
        : es ? "Su parte: mantenga los saldos de tarjetas bajo 30% (bajo 10% es mejor)." : "Your part: keep card balances under 30% (under 10% is best).",
    planProtect: (r: number) => (es ? `Proteja sus logros: mantenga todo al corriente y evite nuevas solicitudes de credito mientras la Ronda ${r} esta en proceso.` : `Protect your gains: keep every account current and avoid new credit applications while Round ${r} is in progress.`),
    planTimeline: (r: number) => (es ? `Tiempo: los resultados de la Ronda ${r} se esperan en 30-60 dias. Los cambios de utilizacion se ven en el siguiente estado de cuenta.` : `Timeline: Round ${r} results are expected within 30-60 days. Utilization changes show up on the next statement cycle.`),
    planNext: (r: number) => (es ? `Proxima revision: sacaremos un reporte nuevo de 3 buros al cerrar la Ronda ${r} y le enviaremos su siguiente informe.` : `Next check-in: we will pull a fresh 3-bureau report when Round ${r} closes and send your next progress report.`),
    then: es ? ", luego " : ", then ",
    strengthNote: (strengths: string, growth: string) =>
      `${strengths ? (es ? `Su archivo tiene una base solida: ${strengths}. ` : `Your file has a solid foundation: ${strengths}. `) : ""}${
        growth ? (es ? `El espacio restante para crecer esta en ${growth}.` : `The remaining room to grow is in ${growth}.`) : es ? "Mantenga saldos bajos y pagos a tiempo para seguir creciendo." : "Keep balances low and payments on time to build on it."
      }`,
    sHistory: es ? "historial de credito" : "credit history",
    sNoColl: es ? "sin cobranzas ni registros publicos" : "no collections or public records",
    sLimits: es ? "limites altos" : "high limits",
    gUtil: es ? "la utilizacion revolvente" : "revolving utilization",
  };
}

// ── PDF (exactly 3 pages, letter) ───────────────────────────────────────────

export interface Pv2PdfData {
  lang: Pv2Lang;
  clientFirstName: string;
  clientName: string;
  baselineDate: string;
  currentDate: string;
  round: number;
  scores: Record<Bureau, { before: number | null; after: number | null }>;
  wins: Pv2Win[];
  clientActions: string[];
  targets: Pv2Target[];
  utilization: Pv2UtilRow[];
  utilizationOverall: { before: number | null; after: number | null; bureau: Bureau | null };
  utilizationNotes: string[];
  positives: string[];
  actionNeeded: string[];
  goal: { low: number; high: number };
  fileStrength: number;
  fileStrengthNote: string;
  plan: string[];
  phone: string;
  site: string;
}

const PV2 = {
  navy: rgb(0.051, 0.122, 0.235),
  gold: rgb(0.788, 0.659, 0.298),
  text: rgb(0.16, 0.18, 0.22),
  muted: rgb(0.42, 0.45, 0.5),
  light: rgb(0.965, 0.97, 0.978),
  white: rgb(1, 1, 1),
  green: rgb(0.09, 0.55, 0.3),
  goldTint: rgb(0.99, 0.97, 0.9),
};

const BUREAU_FULL: Record<Bureau, string> = { TU: "TransUnion", EX: "Experian", EQ: "Equifax" };

function pv2Safe(s: string): string {
  return String(s ?? "")
    .replace(/[–—―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[•·]/g, "-")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

class Pv2Page {
  y: number;
  readonly M = 40;
  readonly W = 612;
  readonly CW = 612 - 80;
  constructor(
    readonly page: PDFPage,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    readonly mono: PDFFont,
  ) {
    this.y = 792 - 104;
  }
  text(s: string, x: number, y: number, size: number, f: PDFFont = this.font, color = PV2.text, maxW?: number) {
    let t = pv2Safe(s);
    if (maxW) while (t.length > 1 && f.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + ".";
    this.page.drawText(t, { x, y, size, font: f, color });
  }
  wrap(s: string, size: number, maxW: number, f: PDFFont = this.font): string[] {
    const out: string[] = [];
    let cur = "";
    for (const w of pv2Safe(s).split(" ").filter(Boolean)) {
      const t = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > maxW && cur) {
        out.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  }
  heading(s: string) {
    this.y -= 4;
    this.text(s, this.M, this.y, 13, this.bold, PV2.navy);
    this.page.drawRectangle({ x: this.M, y: this.y - 6, width: 46, height: 2, color: PV2.gold });
    this.y -= 22;
  }
  para(s: string, size = 9, color = PV2.text, f: PDFFont = this.font) {
    for (const l of this.wrap(s, size, this.CW, f)) {
      this.text(l, this.M, this.y, size, f, color);
      this.y -= size + 3.5;
    }
    this.y -= 4;
  }
  table(headers: string[], rows: string[][], widths: number[], size = 8, boldLast = false) {
    const colW = widths.map((w) => w * this.CW);
    this.page.drawRectangle({ x: this.M, y: this.y - 5, width: this.CW, height: 16, color: PV2.navy });
    let x = this.M + 4;
    headers.forEach((h, i) => {
      this.text(h, x, this.y, size, this.bold, PV2.white, colW[i] - 6);
      x += colW[i];
    });
    this.y -= 16;
    rows.forEach((row, ri) => {
      const cells = row.map((c, i) => this.wrap(c, size, colW[i] - 8));
      const h = Math.max(...cells.map((c) => c.length)) * (size + 3) + 6;
      if (ri % 2 === 1) this.page.drawRectangle({ x: this.M, y: this.y - h + size + 1, width: this.CW, height: h, color: PV2.light });
      let xx = this.M + 4;
      cells.forEach((lines, i) => {
        let yy = this.y;
        for (const l of lines) {
          this.text(l, xx, yy, size, boldLast && ri === rows.length - 1 ? this.bold : this.font);
          yy -= size + 3;
        }
        xx += colW[i];
      });
      this.y -= h;
    });
    this.y -= 8;
  }
  callout(title: string, body: string) {
    const lines = this.wrap(body, 8.8, this.CW - 20);
    const h = 22 + lines.length * 12;
    const top = this.y + 8;
    this.page.drawRectangle({ x: this.M, y: top - h, width: this.CW, height: h, color: PV2.goldTint, borderColor: PV2.gold, borderWidth: 0.8 });
    this.text(title, this.M + 10, top - 14, 9, this.bold, PV2.navy);
    let yy = top - 27;
    for (const l of lines) {
      this.text(l, this.M + 10, yy, 8.8);
      yy -= 12;
    }
    this.y = top - h - 10;
  }
}

/** Rows that fit the remaining page height (keeps the report at 3 pages). */
function pv2Fit<T>(rows: T[], perRow: number, room: number): T[] {
  return rows.slice(0, Math.max(1, Math.floor(room / perRow)));
}

export async function generateProgressReportV2Pdf(d: Pv2PdfData, logoPng?: Uint8Array | null): Promise<Buffer> {
  const L = pv2L(d.lang);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  let logo: PDFImage | null = null;
  if (logoPng) {
    try {
      logo = await pdf.embedPng(logoPng);
    } catch {
      logo = null;
    }
  }
  const pages: Pv2Page[] = [1, 2, 3].map((n) => {
    const page = pdf.addPage([612, 792]);
    page.drawRectangle({ x: 0, y: 792 - 76, width: 612, height: 76, color: PV2.navy });
    page.drawRectangle({ x: 0, y: 792 - 79, width: 612, height: 3, color: PV2.gold });
    let tx = 40;
    if (logo) {
      const h = 38;
      const w = (logo.width / logo.height) * h;
      page.drawImage(logo, { x: 40, y: 792 - 76 + 19, width: w, height: h });
      tx = 40 + w + 14;
    }
    const p = new Pv2Page(page, font, bold, mono);
    p.text(L.brand, tx, 792 - 28, 9, bold, PV2.gold);
    p.text(L.title, tx, 792 - 44, 13, bold, PV2.white);
    p.text(L.preparedFor(d.clientName, d.baselineDate, d.currentDate), tx, 792 - 60, 8.5, font, rgb(0.85, 0.87, 0.92));
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 36, color: PV2.light });
    p.text(`Optimum Financial Group  |  ${d.phone}  |  ${d.site}`, 40, 15, 7.5, font, PV2.muted);
    p.text(L.page(n), 612 - 40 - font.widthOfTextAtSize(L.page(n), 7.5), 15, 7.5, font, PV2.muted);
    return p;
  });

  const mid = (k: "before" | "after") => pv2MiddleScore({ TU: d.scores.TU[k], EX: d.scores.EX[k], EQ: d.scores.EQ[k] });
  const mb = mid("before");
  const ma = mid("after");

  // ── Page 1: score progress + wins + targets ───────────────────────────────
  const p1 = pages[0];
  p1.heading(L.scoreProgress);
  const moved = BUREAUS.filter((b) => d.scores[b].before !== null && d.scores[b].after !== null);
  const allUp = moved.length > 0 && moved.every((b) => d.scores[b].after! > d.scores[b].before!);
  p1.para(L.intro(d.clientFirstName, d.baselineDate, allUp, mb !== null && ma !== null ? (ma >= mb ? L.climbed(mb, ma) : L.isNow(ma, mb)) : L.shownBelow));
  const delta = (b: number | null, a: number | null) => (b === null || a === null ? "--" : `${a - b >= 0 ? "+" : ""}${a - b}`);
  p1.table(
    [L.bureau, L.baseline(d.baselineDate), L.current(d.currentDate), L.gained],
    [
      ...BUREAUS.map((b) => [BUREAU_FULL[b], String(d.scores[b].before ?? "--"), String(d.scores[b].after ?? "--"), delta(d.scores[b].before, d.scores[b].after)]),
      [L.middle, String(mb ?? "--"), String(ma ?? "--"), `${delta(mb, ma)} ${L.pts}`],
    ],
    [0.28, 0.25, 0.25, 0.22],
    8.5,
    true,
  );
  for (const b of BUREAUS) {
    const s = d.scores[b];
    const line = `${(BUREAU_FULL[b] + ":").padEnd(12)} ${pv2AsciiBar(s.after)} ${s.before ?? "--"} -> ${s.after ?? "--"} (${delta(s.before, s.after)} ${L.pts})`;
    p1.text(line, p1.M, p1.y, 8.5, mono, PV2.navy);
    p1.y -= 12;
  }
  p1.y -= 8;
  p1.heading(L.cameOff);
  const winRows = d.wins.map((w) => [
    w.item,
    w.bureaus.join(" / "),
    L.impactText(w.impact, w.kind, w.status === "PARTIAL" ? w.bureaus.length : 0),
    w.status === "PARTIAL" ? L.partial(w.remainsOn.join("/")) : L.removed,
  ]);
  if (winRows.length) p1.table([L.itemRemoved, L.bureaus, L.impact, L.status], pv2Fit(winRows, 24, 150), [0.4, 0.14, 0.26, 0.2]);
  if (d.clientActions.length) p1.callout(L.progressToo, L.progressTooBody(d.clientActions.join("; ")));
  p1.heading(L.stillOn(d.round));
  const targetRows = d.targets.map((t) => [t.item, t.bureaus.join(" / "), t.detail || "--", L.prio(t.priority)]);
  if (targetRows.length) p1.table([L.item, L.bureaus, L.detail, L.priority], pv2Fit(targetRows, 24, Math.max(48, p1.y - 60)), [0.32, 0.14, 0.42, 0.12]);
  else p1.para(L.noTargets, 9, PV2.muted);

  // ── Page 2: utilization + what's working ──────────────────────────────────
  const p2 = pages[1];
  p2.heading(L.utilTitle);
  const uo = d.utilizationOverall;
  p2.para(L.utilIntro(uo.before, uo.after, uo.bureau ? BUREAU_FULL[uo.bureau] : ""));
  const payTo = (bal: number, target: number) => (bal <= target ? L.alreadyOk : L.payTo(pv2Money(target)));
  const uRows = d.utilization.map((u) => [u.account, pv2Money(u.limit), u.baseline === null ? "--" : pv2Money(u.baseline), pv2Money(u.current), `${u.pct}% ${L.band(u.pct)}`, payTo(u.current, u.payTo30), payTo(u.current, u.payTo10)]);
  if (uRows.length) {
    // Total row = the overall bureau's own accounts (label says which bureau).
    const totalRows = uo.bureau ? d.utilization.filter((u) => u.bureau === uo.bureau) : d.utilization;
    const lim = totalRows.reduce((s, u) => s + u.limit, 0);
    const base = totalRows.reduce((s, u) => s + (u.baseline ?? 0), 0);
    const cur = totalRows.reduce((s, u) => s + u.current, 0);
    const fitted = pv2Fit(uRows, 18, 300);
    fitted.push([L.totalRevolving(uo.bureau ?? ""), pv2Money(lim), pv2Money(base), pv2Money(cur), lim > 0 ? `${Math.round((cur / lim) * 100)}%` : "--", "", ""]);
    p2.table([L.account, L.limit, L.baseBal, L.curBal, L.used, L.payTo30h, L.payTo10h], fitted, [0.22, 0.11, 0.13, 0.13, 0.13, 0.14, 0.14], 7.8, true);
  } else p2.para(L.noUtil, 9, PV2.muted);
  for (const n of d.utilizationNotes.slice(0, 3)) p2.para(n, 7.5, PV2.muted);
  p2.heading(L.working);
  for (const s of d.positives.slice(0, 5)) {
    for (const [i, l] of p2.wrap(s, 9, p2.CW - 14).entries()) {
      if (i === 0) p2.page.drawCircle({ x: p2.M + 3, y: p2.y + 3, size: 1.6, color: PV2.gold });
      p2.text(l, p2.M + 12, p2.y, 9);
      p2.y -= 12.5;
    }
  }
  p2.y -= 6;
  p2.heading(L.actionNeeded);
  for (const s of d.actionNeeded.slice(0, 3)) p2.para(s);

  // ── Page 3: roadmap + goal + plan + file strength + CROA ──────────────────
  const p3 = pages[2];
  p3.heading(L.roadmap);
  const highUtil = d.utilization.filter((u) => u.pct > 30).slice(0, 3).map((u) => u.account).join(", ");
  const roadmap: Array<[string, string, string]> = [
    [L.roundsDone(d.round), L.removedCount(d.wins.length), L.done],
    [L.roundActive(d.round), d.targets.slice(0, 3).map((t) => t.item.split(" - ")[0]).join(", ") || L.nextTargets, L.inProgress],
    [L.utilization, highUtil ? L.bringUnder(highUtil) : L.keepUnder, L.clientAction],
    [L.scoreGoal, L.projected(d.goal.low, d.goal.high), L.target],
  ];
  for (const [a, b, c] of roadmap) {
    p3.text(`${a.padEnd(24)} -> `, p3.M, p3.y, 8.5, mono, PV2.navy);
    p3.text(b, p3.M + 200, p3.y, 8.5, font, PV2.text, 230);
    p3.text(c, p3.M + p3.CW - bold.widthOfTextAtSize(c, 8), p3.y, 8, bold, c === L.done ? PV2.green : PV2.navy);
    p3.y -= 14;
  }
  p3.y -= 6;
  p3.table(
    [L.middle, ""],
    [
      [L.currentRow, String(ma ?? "--")],
      [L.goalRow, L.goalVal(d.goal.low, d.goal.high)],
      [L.gapRow, ma === null ? "--" : `${Math.max(0, d.goal.low - ma)}-${Math.max(0, d.goal.high - ma)} ${L.points}`],
    ],
    [0.5, 0.5],
    8.5,
  );
  p3.heading(L.plan);
  d.plan.slice(0, 5).forEach((s, i) => p3.para(`${L.step(i + 1)} - ${s}`, 8.8));
  p3.heading(L.strength);
  const fsN = Math.round((d.fileStrength / 100) * 20);
  p3.text(`${L.strengthBar}: [${"=".repeat(fsN)}${" ".repeat(20 - fsN)}] ${d.fileStrength} / 100`, p3.M, p3.y, 9, mono, PV2.navy);
  p3.y -= 15;
  p3.para(d.fileStrengthNote, 8.8);
  p3.para(L.questions(d.phone, d.site), 8.8, PV2.muted);
  p3.y = Math.max(p3.y, 120);
  p3.callout(L.croaTitle, L.croa);

  return Buffer.from(await pdf.save());
}

// ── assemble report content from the diff ──────────────────────────────────

export function pv2BuildPdfData(opts: {
  diff: Pv2Diff;
  clientFirstName: string;
  clientName: string;
  round: number;
  scores: Record<Bureau, { before: number | null; after: number | null }>;
  phone: string;
  site: string;
  lang?: Pv2Lang;
}): Pv2PdfData {
  const lang = opts.lang ?? "en";
  const L = pv2L(lang);
  const { diff } = opts;
  const ma = pv2MiddleScore({ TU: opts.scores.TU.after, EX: opts.scores.EX.after, EQ: opts.scores.EQ.after }) ?? 0;
  const remainingLift = diff.targets.reduce((s, t) => s + t.lift, 0);
  const goal = pv2GoalRange(ma, remainingLift, diff.utilizationOverall.after);
  const fileStrength = pv2FileStrength({
    openChargeOffsOrCollections: diff.after.openDerogatory,
    lates24m: diff.after.lates24m,
    olderLates: diff.after.olderLates,
    overallUtil: diff.utilizationOverall.after,
    publicRecord: diff.after.publicRecord,
    openRevolving: diff.after.openRevolving,
    anyDerogatory: diff.after.derogatory > 0,
  });
  const high = diff.utilization.filter((u) => u.pct > 30);
  const actionNeeded: string[] = [];
  if (high.length) {
    actionNeeded.push(
      L.actionUtil(high[0].account, high[0].pct, pv2Money(high[0].current), pv2Money(high[0].limit), high.slice(1, 4).map((u) => `${u.account} (${u.pct}%)`).join(", ")),
    );
  }
  actionNeeded.push(L.keepCurrent);
  const targetNames = diff.targets.slice(0, 4).map((t) => t.item.split(" - ")[0]).join(", ");
  const plan = [
    L.planOfg(opts.round, targetNames),
    L.planClient(high.slice(0, 4).map((u) => u.account).join(L.then)),
    L.planProtect(opts.round),
    L.planTimeline(opts.round),
    L.planNext(opts.round),
  ];
  const strengths: string[] = [];
  if (diff.positivesFlags.history) strengths.push(L.sHistory);
  if (diff.positivesFlags.noCollections) strengths.push(L.sNoColl);
  if (diff.utilization.reduce((s, u) => s + u.limit, 0) >= 20000) strengths.push(L.sLimits);
  const growth = [...diff.targets.slice(0, 2).map((t) => t.item.split(" - ")[0]), ...(high.length ? [L.gUtil] : [])];
  return {
    lang,
    clientFirstName: opts.clientFirstName,
    clientName: opts.clientName,
    baselineDate: diff.beforeDate ?? "--",
    currentDate: diff.afterDate ?? "--",
    round: opts.round,
    scores: opts.scores,
    wins: diff.wins,
    clientActions: diff.clientActions,
    targets: diff.targets,
    utilization: diff.utilization,
    utilizationOverall: diff.utilizationOverall,
    utilizationNotes: diff.utilizationNotes,
    positives: diff.positives,
    actionNeeded,
    goal,
    fileStrength,
    fileStrengthNote: L.strengthNote(strengths.join(", "), growth.join(", ")),
    plan,
    phone: opts.phone,
    site: opts.site,
  };
}

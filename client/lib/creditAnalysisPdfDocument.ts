import type { CreditAnalysisResult } from "@shared/api";
import {
  creditAnalysisReportLabels,
  resolveCreditAnalysisReportLang,
} from "@/lib/creditAnalysisReportLabels";
import { parseCreditAnalysisView } from "@/lib/creditAnalysisResultModel";

const LOGO_URL =
  "https://disruptinglabs.com/data/optimum/assets/images/logos/logo_with_title_white.png";
const NAVY = "#121829";
const GOLD = "#C0A06A";
const BORDER = "#e2e8f0";
const MUTED = "#64748b";
const CARD = "#f8fafc";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreColor(score: number | null | undefined): string {
  if (score == null || score <= 0) return MUTED;
  if (score >= 720) return "#16a34a";
  if (score >= 640) return "#2563eb";
  return "#dc2626";
}

function priorityColor(p: string): string {
  const u = p.toUpperCase();
  if (u === "CRITICAL") return "#dc2626";
  if (u === "HIGH") return "#ea580c";
  if (u === "MEDIUM") return "#ca8a04";
  return "#2563eb";
}

function scoreGaugeHtml(
  label: string,
  score: number | null | undefined,
  band: string,
): string {
  const has = typeof score === "number" && score > 0;
  const pct = has ? Math.min(Math.max((score - 300) / 550, 0), 1) : 0;
  const color = scoreColor(score);
  return `
    <td style="width:33%;padding:8px;vertical-align:top;">
      <div style="border:1px solid ${BORDER};border-radius:14px;padding:16px 12px;text-align:center;background:#fff;">
        <div style="width:72px;height:72px;margin:0 auto 10px;border-radius:50%;border:4px solid ${color};display:flex;align-items:center;justify-content:center;">
          <span style="font-size:22px;font-weight:800;color:${color};">${has ? score : "—"}</span>
        </div>
        <div style="font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.06em;">${esc(label)}</div>
        ${band ? `<div style="font-size:10px;font-weight:800;color:${GOLD};margin-top:4px;text-transform:uppercase;">${esc(band)}</div>` : ""}
        <div style="margin-top:10px;height:4px;border-radius:999px;background:#e2e8f0;overflow:hidden;">
          <div style="height:100%;width:${Math.round(pct * 100)}%;background:${color};border-radius:999px;"></div>
        </div>
      </div>
    </td>`;
}

function sectionTitle(title: string): string {
  return `<h2 style="margin:0 0 14px;font-size:12px;font-weight:800;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em;">${esc(title)}</h2>`;
}

function cardWrap(inner: string): string {
  return `<div style="border:1px solid ${BORDER};border-radius:14px;padding:18px 20px;margin-bottom:18px;background:#fff;">${inner}</div>`;
}

export function buildCreditAnalysisPrintDocument(opts: {
  result: CreditAnalysisResult;
  clientName?: string;
  fileName: string;
}): string {
  const lang = resolveCreditAnalysisReportLang(opts.result);
  const L = creditAnalysisReportLabels(lang);
  const view = parseCreditAnalysisView(opts.result, {
    today: L.timelineToday,
    d30: L.timeline30,
    d60: L.timeline60,
    d90: L.timeline90,
    target: L.timelineTarget,
  });
  const scores = opts.result.scores;
  const generated = opts.result.generated_at
    ? new Date(opts.result.generated_at).toLocaleDateString(
        lang === "es" ? "es-US" : "en-US",
        { year: "numeric", month: "long", day: "numeric" },
      )
    : "";
  const clientLine = opts.clientName ? esc(opts.clientName) : "";
  const goalLabel = analystGoal(opts.result);

  let body = "";

  if (view.weakExtraction) {
    body += cardWrap(`
      <p style="margin:0;font-size:15px;font-weight:700;color:#dc2626;">${esc(L.resultHeading)}</p>
      <p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:#334155;">${esc(view.utilNote || L.resultSubheading)}</p>
    `);
  } else {
    body += `<p style="margin:0 0 6px;font-size:22px;font-weight:800;color:${NAVY};">${esc(L.resultHeading)}</p>`;
    body += `<p style="margin:0 0 20px;font-size:14px;color:${MUTED};">${esc(L.resultSubheading)}</p>`;
    if (goalLabel) {
      body += `<p style="margin:-12px 0 20px;font-size:13px;color:#334155;"><strong>${lang === "es" ? "Meta" : "Goal"}:</strong> ${esc(goalLabel)}</p>`;
    }

    if (scores) {
      body += cardWrap(`
        ${sectionTitle(L.scoresHeading)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${scoreGaugeHtml(L.transunion, scores.transunion, view.scoreBands.tu)}
          ${scoreGaugeHtml(L.experian, scores.experian, view.scoreBands.ex)}
          ${scoreGaugeHtml(L.equifax, scores.equifax, view.scoreBands.eq)}
        </tr></table>
        ${
          view.mid != null || view.goal != null || view.fhaStatus
            ? `<div style="margin-top:16px;padding:14px;border-radius:12px;background:${CARD};border:1px solid ${BORDER};text-align:center;">
                <table role="presentation" width="100%"><tr>
                  ${
                    view.mid != null
                      ? `<td style="text-align:center;padding:8px;"><div style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;">${esc(L.midScore)}</div><div style="font-size:26px;font-weight:800;color:${NAVY};">${view.mid}</div></td>`
                      : ""
                  }
                  ${
                    view.goal != null
                      ? `<td style="text-align:center;padding:8px;"><div style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;">${esc(L.goalScore)}</div><div style="font-size:26px;font-weight:800;color:${GOLD};">${view.goal}</div></td>`
                      : ""
                  }
                </tr></table>
                ${
                  view.fhaStatus
                    ? `<p style="margin:8px 0 0;font-size:13px;color:#334155;"><span style="font-weight:700;color:${MUTED};text-transform:uppercase;font-size:10px;letter-spacing:0.06em;">${esc(L.lendingStatus)}</span> ${esc(view.fhaStatus)}</p>`
                    : ""
                }
                ${
                  view.programTierLabel
                    ? `<p style="margin:6px 0 0;font-size:13px;color:#334155;"><span style="font-weight:700;color:${MUTED};text-transform:uppercase;font-size:10px;letter-spacing:0.06em;">${esc(L.programTierHeading)}</span> ${esc(view.programTierLabel)}</p>`
                    : ""
                }
              </div>`
            : ""
        }
      `);
    }

    if (view.timeline.some((x) => x.v != null)) {
      body += cardWrap(`
        ${sectionTitle(L.timelineHeading)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${view.timeline
            .map(
              (x) => `
            <td style="padding:4px;width:20%;vertical-align:top;">
              <div style="border:1px solid ${BORDER};border-radius:10px;padding:12px 8px;text-align:center;background:${CARD};">
                <div style="font-size:9px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.05em;">${esc(x.label)}</div>
                <div style="font-size:20px;font-weight:800;margin-top:6px;color:${x.key === "target" ? GOLD : NAVY};">${x.v ?? "—"}</div>
              </div>
            </td>`,
            )
            .join("")}
        </tr></table>
      `);
    }
  }

  body += cardWrap(`
    ${sectionTitle(L.negativesHeading)}
    ${
      view.negRows.length > 0
        ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px;">
            <tr style="background:${NAVY};color:${GOLD};">
              <th style="padding:10px;text-align:left;">${esc(L.account)}</th>
              <th style="padding:10px;text-align:left;">${esc(L.type)}</th>
              <th style="padding:10px;text-align:center;">${esc(L.bureaus)}</th>
              <th style="padding:10px;text-align:center;">${esc(L.round)}</th>
              <th style="padding:10px;text-align:center;">${esc(L.priority)}</th>
            </tr>
            ${view.negRows
              .map(
                (n, i) => `
              <tr style="background:${i % 2 ? CARD : "#fff"};">
                <td style="padding:10px;border-top:1px solid ${BORDER};font-weight:600;color:${NAVY};">${esc(n.account)}</td>
                <td style="padding:10px;border-top:1px solid ${BORDER};color:#334155;">${esc(n.type)}</td>
                <td style="padding:10px;border-top:1px solid ${BORDER};text-align:center;color:#334155;">${esc(n.bureaus)}</td>
                <td style="padding:10px;border-top:1px solid ${BORDER};text-align:center;font-weight:700;color:${NAVY};">${esc(n.round ? `${L.round} ${n.round}` : "—")}</td>
                <td style="padding:10px;border-top:1px solid ${BORDER};text-align:center;font-weight:800;color:${priorityColor(n.priority)};">${esc(n.priority)}</td>
              </tr>
              <tr><td colspan="5" style="padding:0 10px 10px;font-size:11px;line-height:1.5;color:${MUTED};border-bottom:1px solid ${BORDER};">${esc(n.basis)}</td></tr>`,
              )
              .join("")}
          </table>`
        : view.fallbackNegatives.length > 0
          ? `<ul style="margin:0;padding-left:18px;color:#334155;">${view.fallbackNegatives
              .map(
                (n) =>
                  `<li style="margin-bottom:8px;"><strong>${esc(n.creditor || n.type)}</strong>${n.detail ? ` — ${esc(n.detail)}` : ""}</li>`,
              )
              .join("")}</ul>`
          : `<p style="margin:0;color:#16a34a;font-weight:600;">${esc(L.noNegatives)}</p>`
    }
  `);

  if (!view.weakExtraction && view.utilRows.length > 0) {
    body += cardWrap(`
      ${sectionTitle(L.utilizationHeading)}
      ${view.utilNote ? `<p style="margin:0 0 12px;font-size:12px;color:${MUTED};">${esc(view.utilNote)}</p>` : ""}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px;">
        <tr style="background:${CARD};">
          <th style="padding:8px;text-align:left;">${esc(L.utilAccount)}</th>
          <th style="padding:8px;text-align:right;">${esc(L.utilLimit)}</th>
          <th style="padding:8px;text-align:right;">${esc(L.utilBalance)}</th>
          <th style="padding:8px;text-align:right;">${esc(L.utilPercent)}</th>
          <th style="padding:8px;text-align:right;">${esc(L.utilPay30)}</th>
          <th style="padding:8px;text-align:right;">${esc(L.utilPay10)}</th>
        </tr>
        ${view.utilRows
          .map(
            (u, i) => `
          <tr style="background:${i % 2 ? "#fff" : CARD};">
            <td style="padding:8px;border-top:1px solid ${BORDER};">${esc(u.account)}</td>
            <td style="padding:8px;border-top:1px solid ${BORDER};text-align:right;">${esc(u.limit)}</td>
            <td style="padding:8px;border-top:1px solid ${BORDER};text-align:right;">${esc(u.balance)}</td>
            <td style="padding:8px;border-top:1px solid ${BORDER};text-align:right;font-weight:700;">${esc(u.percent)}</td>
            <td style="padding:8px;border-top:1px solid ${BORDER};text-align:right;">${esc(u.pay30)}</td>
            <td style="padding:8px;border-top:1px solid ${BORDER};text-align:right;">${esc(u.pay10)}</td>
          </tr>`,
          )
          .join("")}
      </table>
    `);
  }

  if (!view.weakExtraction && view.fsRows.length > 0) {
    body += cardWrap(`
      ${sectionTitle(L.fileStrengthHeading)}
      <p style="margin:-8px 0 14px;font-size:15px;font-weight:800;color:${NAVY};">${view.fileStrengthScore ?? 0}/100${view.fileStrengthRating ? ` · ${esc(view.fileStrengthRating)}` : ""}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;border-collapse:collapse;">
        ${view.fsRows
          .map(
            ([label, value], i) => `
          <tr style="background:${i % 2 ? CARD : "#fff"};">
            <td style="padding:10px;border:1px solid ${BORDER};font-weight:600;width:45%;">${esc(label)}</td>
            <td style="padding:10px;border:1px solid ${BORDER};color:${MUTED};">${esc(value)}</td>
          </tr>`,
          )
          .join("")}
      </table>
    `);
  }

  if (!view.weakExtraction && view.actions.length > 0) {
    body += cardWrap(`
      ${sectionTitle(L.actionPlanHeading)}
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 10px;font-size:12px;">
        ${view.actions
          .map(
            (a) => `
          <tr>
            <td style="padding:0;vertical-align:top;">
              <div style="border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">
                <div style="background:${NAVY};color:${GOLD};padding:8px 12px;font-size:10px;font-weight:800;letter-spacing:0.06em;">${esc(a.time)}</div>
                <div style="padding:12px;background:#fff;">
                  <div style="font-weight:700;color:${NAVY};margin-bottom:4px;">${esc(a.action)}</div>
                  <div style="color:${MUTED};line-height:1.5;">${esc(a.reason)}</div>
                </div>
              </div>
            </td>
          </tr>`,
          )
          .join("")}
      </table>
    `);
  }

  if (!view.weakExtraction && view.clientMessage) {
    body += cardWrap(`
      ${sectionTitle(L.clientMessageHeading)}
      <div style="border-left:3px solid ${GOLD};padding:12px 14px;background:${CARD};border-radius:0 10px 10px 0;">
        <p style="margin:0;font-size:13px;line-height:1.65;color:#334155;white-space:pre-wrap;">${esc(view.clientMessage)}</p>
      </div>
    `);
  }

  if (opts.result.suggested_labels?.length) {
    body += cardWrap(`
      ${sectionTitle(L.labelsHeading)}
      <p style="margin:0;font-size:12px;color:#334155;">${opts.result.suggested_labels.map((s) => esc(s.replace(/_/g, " "))).join(" · ")}</p>
    `);
  }

  const title = esc(opts.fileName.replace(/\.pdf$/i, "") || L.documentTitle);

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { margin: 12mm; size: letter; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .oc-page { box-shadow: none !important; }
    }
    body { margin: 0; padding: 24px 16px 32px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #eef1f6; color: ${NAVY}; }
    .oc-page { max-width: 880px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 12px 40px rgba(15,23,42,0.08); }
    .oc-body { padding: 28px 28px 8px; }
    .oc-footer { padding: 20px 28px 24px; background: ${CARD}; border-top: 1px solid ${BORDER}; font-size: 11px; line-height: 1.55; color: ${MUTED}; text-align: center; }
  </style>
</head>
<body>
  <div class="oc-page">
    <div style="background:${NAVY};padding:22px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><img src="${LOGO_URL}" alt="Optimum Credit" height="44" style="display:block;height:44px;width:auto;border:0;" /></td>
        <td align="right" style="vertical-align:middle;">
          <div style="font-size:11px;font-weight:700;color:${GOLD};letter-spacing:0.05em;text-transform:uppercase;">${esc(L.tagline)}</div>
          ${clientLine ? `<div style="font-size:13px;color:#fff;margin-top:4px;font-weight:600;">${clientLine}</div>` : ""}
          ${generated ? `<div style="font-size:11px;color:rgba(255,255,255,0.75);margin-top:2px;">${esc(L.generatedOn)} ${esc(generated)}</div>` : ""}
        </td>
      </tr></table>
    </div>
    <div class="oc-body">${body}</div>
    <div class="oc-footer">${esc(L.croaDisclaimer)}</div>
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print();},400);};</script>
</body>
</html>`;
}

function analystGoal(result: CreditAnalysisResult): string {
  const g = result.analyst?.analysis_goal;
  return typeof g === "string" ? g : "";
}

export function printCreditAnalysisResult(opts: {
  result: CreditAnalysisResult;
  clientName?: string;
  fileName: string;
}): void {
  const html = buildCreditAnalysisPrintDocument(opts);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) {
    URL.revokeObjectURL(url);
    throw new Error("popup_blocked");
  }
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

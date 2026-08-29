/**
 * Weekday morning admin digest — pure helpers (Claude parse, HTML, Denver window).
 * Runtime gather/send stays in api/index.ts (Vercel serverless + includeFiles).
 */

export type MorningDigestLang = "en" | "es";

export type MorningDigestPriority = {
  title: string;
  why: string;
  href?: string | null;
};

export type MorningDigestClaudeBrief = {
  headline: string;
  quote: string;
  quote_attribution?: string | null;
  energy_note: string;
  priorities: MorningDigestPriority[];
  conversation_resumes: Array<{ who: string; resume: string }>;
  risks: string[];
  wins_or_quiet_note: string;
};

export type MorningDigestSnapshot = {
  admin: {
    id: number;
    first_name: string;
    preferred_language: MorningDigestLang;
  };
  date_label: string;
  counts: {
    prospects: number;
    active_clients: number;
    onboarding: number;
    pending_payment: number;
    open_tasks: number;
    overdue_tasks: number;
    open_conversations: number;
    unread_messages: number;
  };
  pipeline_stages: Array<{ stage: string; count: number }>;
  prospects: Array<{
    id: number;
    name: string;
    phone?: string | null;
    stage?: string | null;
  }>;
  clients: Array<{
    id: number;
    name: string;
    status: string;
    stage: string;
  }>;
  tasks: Array<{
    id: number;
    title: string;
    status: string;
    priority?: string | null;
    due_at?: string | null;
    overdue: boolean;
  }>;
  conversations: Array<{
    id: number;
    client_id?: number | null;
    who: string;
    unread: number;
    preview?: string | null;
    status: string;
  }>;
  app_url: string;
};

const FALLBACK_QUOTES: Record<
  MorningDigestLang,
  Array<{ quote: string; attribution: string }>
> = {
  en: [
    {
      quote:
        "Small, consistent actions compound into extraordinary client outcomes.",
      attribution: "OFG morning brief",
    },
    {
      quote:
        "Clarity first. Then courage. Then the next right conversation.",
      attribution: "OFG morning brief",
    },
    {
      quote:
        "You don’t have to do everything today — just the work that unlocks today.",
      attribution: "OFG morning brief",
    },
  ],
  es: [
    {
      quote:
        "Acciones pequeñas y constantes se convierten en resultados extraordinarios para el cliente.",
      attribution: "Resumen matutino OFG",
    },
    {
      quote:
        "Primero claridad. Luego valor. Luego la siguiente conversación correcta.",
      attribution: "Resumen matutino OFG",
    },
    {
      quote:
        "No tienes que hacerlo todo hoy — solo el trabajo que desbloquea el día.",
      attribution: "Resumen matutino OFG",
    },
  ],
};

export const ADMIN_MORNING_DIGEST_SYSTEM = `You are the Optimum Financial Group (OFG) morning coach for credit-repair admins.
Given a factual JSON snapshot of ONE admin's book of business, return ONLY valid JSON (no markdown) with:
{
  "headline": "short energizing subject-line style headline",
  "quote": "original empowering quote (1–2 sentences, no clichés about grind/hustle)",
  "quote_attribution": "short label e.g. OFG Morning",
  "energy_note": "1 warm sentence greeting them by first name energy — use the name from snapshot",
  "priorities": [{"title":"...","why":"...","href":"/admin/..."}]  // max 5, grounded, grounded ONLY in snapshot
  "conversation_resumes": [{"who":"...","resume":"..."}]  // max 5, only for conversations in snapshot; paraphrase preview, never invent facts
  "risks": ["..."]  // max 4 overdue / unread / stuck prospects; empty array if none
  "wins_or_quiet_note": "1 sentence — celebrate quiet day or steady pipeline"
}
Rules:
- Match preferred_language (en or es) for ALL text fields.
- NEVER invent clients, tasks, phones, or statuses not in the snapshot.
- href must be paths under /admin (my-tasks, conversations, pipeline, clients) when useful.
- Keep tone professional, warm, high-agency — start-the-day energy without hype.`;

export function denverParts(now = new Date()): {
  weekday: string;
  hour: number;
  ymd: string;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hourRaw = Number(parts.hour);
  // Intl may emit "24" for midnight in some engines
  const hour = hourRaw === 24 ? 0 : hourRaw;
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  return { weekday: String(parts.weekday || ""), hour, ymd };
}

/** True Mon–Fri when local Denver hour is in [startHour, startHour+1). */
export function isDenverWeekdayMorningWindow(
  now = new Date(),
  startHour = 7,
): boolean {
  const { weekday, hour } = denverParts(now);
  if (["Sat", "Sun"].includes(weekday)) return false;
  return hour === startHour;
}

export function pickFallbackQuote(
  lang: MorningDigestLang,
  seed: string,
): { quote: string; attribution: string } {
  const list = FALLBACK_QUOTES[lang] || FALLBACK_QUOTES.en;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

export function buildDeterministicMorningBrief(
  snapshot: MorningDigestSnapshot,
): MorningDigestClaudeBrief {
  const lang = snapshot.admin.preferred_language;
  const isEs = lang === "es";
  const name = snapshot.admin.first_name || (isEs ? "equipo" : "team");
  const q = pickFallbackQuote(lang, `${snapshot.date_label}:${snapshot.admin.id}`);
  const priorities: MorningDigestPriority[] = [];
  if (snapshot.counts.overdue_tasks > 0) {
    priorities.push({
      title: isEs
        ? `${snapshot.counts.overdue_tasks} tarea(s) vencida(s)`
        : `${snapshot.counts.overdue_tasks} overdue task(s)`,
      why: isEs
        ? "Límpialas primero para liberar el día."
        : "Clear these first to free the day.",
      href: "/admin/my-tasks",
    });
  }
  if (snapshot.counts.unread_messages > 0) {
    priorities.push({
      title: isEs
        ? `${snapshot.counts.unread_messages} mensaje(s) sin leer`
        : `${snapshot.counts.unread_messages} unread message(s)`,
      why: isEs
        ? "Los clientes y socios esperan respuesta."
        : "Clients and partners are waiting on a reply.",
      href: "/admin/conversations",
    });
  }
  if (snapshot.counts.prospects > 0) {
    priorities.push({
      title: isEs
        ? `${snapshot.counts.prospects} prospecto(s) activos`
        : `${snapshot.counts.prospects} active prospect(s)`,
      why: isEs
        ? "Un seguimiento hoy mueve el pipeline."
        : "One follow-up today moves the pipeline.",
      href: "/admin/pipeline",
    });
  }
  if (snapshot.counts.open_tasks > 0 && priorities.length < 5) {
    priorities.push({
      title: isEs
        ? `${snapshot.counts.open_tasks} tarea(s) abiertas`
        : `${snapshot.counts.open_tasks} open task(s)`,
      why: isEs
        ? "Revisa My Tasks y marca lo que puedas cerrar."
        : "Scan My Tasks and close what you can.",
      href: "/admin/my-tasks",
    });
  }
  if (!priorities.length) {
    priorities.push({
      title: isEs ? "Día despejado" : "Clear runway",
      why: isEs
        ? "Pipeline estable — buen momento para prospectar o pulir reportes."
        : "Steady pipeline — good day to prospect or polish reports.",
      href: "/admin/pipeline",
    });
  }

  const conversation_resumes = snapshot.conversations.slice(0, 5).map((c) => ({
    who: c.who,
    resume: isEs
      ? `${c.unread > 0 ? `${c.unread} sin leer · ` : ""}${c.preview || "Conversación abierta"}`
      : `${c.unread > 0 ? `${c.unread} unread · ` : ""}${c.preview || "Open thread"}`,
  }));

  const risks: string[] = [];
  for (const t of snapshot.tasks.filter((x) => x.overdue).slice(0, 3)) {
    risks.push(
      isEs ? `Tarea vencida: ${t.title}` : `Overdue task: ${t.title}`,
    );
  }
  for (const c of snapshot.conversations.filter((x) => x.unread > 0).slice(0, 2)) {
    risks.push(
      isEs
        ? `Sin leer con ${c.who}`
        : `Unread with ${c.who}`,
    );
  }

  return {
    headline: isEs
      ? `Tu mañana OFG · ${snapshot.date_label}`
      : `Your OFG morning · ${snapshot.date_label}`,
    quote: q.quote,
    quote_attribution: q.attribution,
    energy_note: isEs
      ? `Buenos días, ${name}. Aquí tienes tu resumen para arrancar con claridad.`
      : `Good morning, ${name}. Here’s your brief so you can start with clarity.`,
    priorities,
    conversation_resumes,
    risks,
    wins_or_quiet_note:
      snapshot.counts.open_tasks + snapshot.counts.unread_messages === 0
        ? isEs
          ? "Todo en calma — aprovecha para avanzar un prospecto clave."
          : "All quiet — use the space to advance one key prospect."
        : isEs
          ? "Enfócate en lo vencido y lo sin leer; el resto espera."
          : "Hit overdue and unread first; the rest can wait.",
  };
}

export function parseClaudeMorningDigestJson(
  text: string,
): MorningDigestClaudeBrief | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const headline = String(o.headline || "").trim();
  const quote = String(o.quote || "").trim();
  const energy_note = String(o.energy_note || "").trim();
  if (!headline || !quote || !energy_note) return null;

  const prioritiesRaw = Array.isArray(o.priorities) ? o.priorities : [];
  const priorities: MorningDigestPriority[] = prioritiesRaw
    .slice(0, 5)
    .map((p) => {
      const row = (p || {}) as Record<string, unknown>;
      return {
        title: String(row.title || "").trim(),
        why: String(row.why || "").trim(),
        href: row.href != null ? String(row.href) : null,
      };
    })
    .filter((p) => p.title);

  const conversation_resumes = (
    Array.isArray(o.conversation_resumes) ? o.conversation_resumes : []
  )
    .slice(0, 5)
    .map((c) => {
      const row = (c || {}) as Record<string, unknown>;
      return {
        who: String(row.who || "").trim(),
        resume: String(row.resume || "").trim(),
      };
    })
    .filter((c) => c.who && c.resume);

  const risks = (Array.isArray(o.risks) ? o.risks : [])
    .map((r) => String(r || "").trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    headline,
    quote,
    quote_attribution: o.quote_attribution
      ? String(o.quote_attribution).trim()
      : null,
    energy_note,
    priorities,
    conversation_resumes,
    risks,
    wins_or_quiet_note: String(o.wins_or_quiet_note || "").trim(),
  };
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function absHref(appUrl: string, href?: string | null): string | null {
  if (!href) return null;
  const h = String(href).trim();
  if (!h) return null;
  if (h.startsWith("http")) return h;
  const base = appUrl.replace(/\/$/, "");
  return h.startsWith("/") ? `${base}${h}` : `${base}/${h}`;
}

/** Body HTML (inside emailLayout). */
export function renderMorningDigestBodyHtml(opts: {
  snapshot: MorningDigestSnapshot;
  brief: MorningDigestClaudeBrief;
  escapeHtmlFn?: (s: string) => string;
}): string {
  const esc = opts.escapeHtmlFn || escapeHtml;
  const { snapshot, brief } = opts;
  const isEs = snapshot.admin.preferred_language === "es";
  const app = snapshot.app_url.replace(/\/$/, "");
  const c = snapshot.counts;

  const tile = (label: string, value: number, accent = false) => `
    <td style="padding:8px;width:25%;">
      <div style="background:${accent ? "#fef3e2" : "#f8fafc"};border:1px solid ${accent ? "#e8d4a8" : "#e2e8f0"};border-radius:12px;padding:12px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#121829;">${value}</div>
        <div style="font-size:11px;color:#64748b;margin-top:4px;font-weight:600;">${esc(label)}</div>
      </div>
    </td>`;

  const priorityRows = brief.priorities
    .map((p, i) => {
      const url = absHref(app, p.href);
      const title = url
        ? `<a href="${esc(url)}" style="color:#121829;text-decoration:none;font-weight:700;">${esc(p.title)}</a>`
        : `<strong>${esc(p.title)}</strong>`;
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;vertical-align:top;width:28px;font-weight:800;color:#C0A06A;">${i + 1}.</td>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:14px;color:#0f172a;">${title}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">${esc(p.why)}</div>
        </td>
      </tr>`;
    })
    .join("");

  const convRows = brief.conversation_resumes.length
    ? brief.conversation_resumes
        .map(
          (r) => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-weight:700;color:#0f172a;width:34%;vertical-align:top;">${esc(r.who)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#475569;">${esc(r.resume)}</td>
    </tr>`,
        )
        .join("")
    : `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;">${
        isEs ? "Sin hilos urgentes." : "No urgent threads."
      }</td></tr>`;

  const riskHtml = brief.risks.length
    ? `<ul style="margin:0;padding-left:18px;color:#b45309;font-size:13px;line-height:1.5;">${brief.risks
        .map((r) => `<li style="margin-bottom:4px;">${esc(r)}</li>`)
        .join("")}</ul>`
    : `<p style="margin:0;font-size:13px;color:#64748b;">${
        isEs ? "Sin riesgos críticos detectados." : "No critical risks flagged."
      }</p>`;

  const btn = (href: string, label: string) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;background:#121829;color:#fff;text-decoration:none;border-radius:10px;font-size:13px;font-weight:700;">${esc(label)}</a>`;

  return `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">${esc(brief.headline)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#334155;">${esc(brief.energy_note)}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:linear-gradient(135deg,#121829 0%,#1e293b 100%);border-radius:14px;">
      <tr><td style="padding:20px 22px;">
        <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#C0A06A;font-weight:700;margin-bottom:8px;">${
          isEs ? "Frase del día" : "Quote of the day"
        }</div>
        <div style="font-size:16px;line-height:1.5;color:#f8fafc;font-style:italic;">“${esc(brief.quote)}”</div>
        ${
          brief.quote_attribution
            ? `<div style="margin-top:10px;font-size:12px;color:#94a3b8;">— ${esc(brief.quote_attribution)}</div>`
            : ""
        }
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        ${tile(isEs ? "Prospectos" : "Prospects", c.prospects)}
        ${tile(isEs ? "Activos" : "Active", c.active_clients)}
        ${tile(isEs ? "Tareas" : "Tasks", c.open_tasks, c.overdue_tasks > 0)}
        ${tile(isEs ? "Sin leer" : "Unread", c.unread_messages, c.unread_messages > 0)}
      </tr>
    </table>

    <h2 style="margin:0 0 10px;font-size:15px;font-weight:800;color:#0f172a;">${
      isEs ? "Prioridades de hoy" : "Today’s priorities"
    }</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      ${priorityRows}
    </table>

    <h2 style="margin:0 0 10px;font-size:15px;font-weight:800;color:#0f172a;">${
      isEs ? "Conversaciones" : "Conversations"
    }</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
      ${convRows}
    </table>

    <h2 style="margin:0 0 10px;font-size:15px;font-weight:800;color:#0f172a;">${
      isEs ? "Riesgos / seguimiento" : "Risks / follow-ups"
    }</h2>
    <div style="margin:0 0 18px;">${riskHtml}</div>

    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#334155;">${esc(
      brief.wins_or_quiet_note,
    )}</p>

    <div style="margin:8px 0 4px;">
      ${btn(`${app}/admin/my-tasks`, isEs ? "Mis tareas" : "My Tasks")}
      ${btn(`${app}/admin/conversations`, isEs ? "Conversaciones" : "Conversations")}
      ${btn(`${app}/admin/pipeline`, isEs ? "Pipeline" : "Pipeline")}
    </div>
  `;
}

export function morningDigestSubject(
  brief: MorningDigestClaudeBrief,
  lang: MorningDigestLang,
): string {
  const prefix = lang === "es" ? "IMPORTANTE 🚨" : "IMPORTANT 🚨";
  const base =
    brief.headline.slice(0, 80) ||
    (lang === "es" ? "Tu resumen matutino OFG" : "Your OFG morning brief");
  if (base.startsWith("IMPORTANT") || base.startsWith("IMPORTANTE")) {
    return base;
  }
  return `${prefix} ${base}`;
}

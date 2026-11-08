/**
 * Replays real inbound texts that the SMS AI escalated through the CURRENT AI
 * (rules + live read-only lookups) in dry-run: nothing is sent, nothing is
 * written (callbacks are simulated). Prints what it would do now.
 *
 *   npm run replay:inbound-ai -- [--days 30] [--limit 60] [--show]
 *
 * --show prints each inbound + new reply (local terminal only; contains client text).
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2/promise";
import {
  callInboundAiClaude,
  checkInboundAiReply,
  countClientsByPhone,
  inboundAiIdentityFor,
  loadInboundAiFaqContext,
  loadInboundAiRoundContext,
  pool,
  replayInboundAiRules,
  type InboundAiToolCtx,
} from "../api/index";

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? Number(process.argv[i + 1]) || d : d;
};
const DAYS = arg("days", 30);
const LIMIT = arg("limit", 60);
const SHOW = process.argv.includes("--show");

async function main() {
  const [notes] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.conversation_id, m.created_at,
            JSON_UNQUOTE(JSON_EXTRACT(m.metadata_json,'$.reason')) AS old_reason
     FROM conversation_messages m
     JOIN conversations c ON c.id = m.conversation_id AND c.channel = 'sms'
     WHERE m.direction = 'system'
       AND JSON_EXTRACT(m.metadata_json,'$.inbound_ai') = true
       AND JSON_UNQUOTE(JSON_EXTRACT(m.metadata_json,'$.mode')) = 'escalated'
       AND m.created_at > NOW() - INTERVAL ? DAY
     ORDER BY m.id DESC LIMIT ?`,
    [DAYS, LIMIT],
  );
  const tally: Record<string, number> = {};
  const bump = (k: string) => (tally[k] = (tally[k] || 0) + 1);
  let n = 0;
  for (const note of notes) {
    const [conv] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.client_id, c.contact_id, c.unknown_contact_id, cl.phone AS client_phone,
              u.phone_e164 AS unknown_phone, cl.first_name, cl.last_name, cl.preferred_language
       FROM conversations c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN conversation_unknown_contacts u ON u.id = c.unknown_contact_id
       WHERE c.id = ? LIMIT 1`,
      [note.conversation_id],
    );
    const c = conv[0];
    if (!c) continue;
    // Thread as it was when the AI escalated (newest first).
    const [recent] = await pool.query<RowDataPacket[]>(
      `SELECT direction, body, metadata_json, provider_status, created_at FROM conversation_messages
       WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT 16`,
      [c.id, note.id],
    );
    const inbound = recent.find((r) => r.direction === "inbound");
    if (!inbound) continue;
    n += 1;
    const body = String(inbound.body || "");
    const rules = replayInboundAiRules(recent, body, Date.parse(String(note.created_at)), !!c.unknown_contact_id);
    if (rules.skip) {
      bump(`now: ${rules.skip}`);
      if (SHOW) console.log(`\n#${n} [${note.old_reason}] → ${rules.skip}\n  IN: ${body.slice(0, 160)}`);
      continue;
    }
    const clientsOnPhone = c.client_id && c.client_phone ? await countClientsByPhone(String(c.client_phone)) : 0;
    const identity = inboundAiIdentityFor({ clientId: c.client_id, clientsOnPhone, crmContactId: c.contact_id });
    let crm = identity === "client" ? "" : c.client_id ? "kind=shared_phone" : c.contact_id ? "kind=crm_contact" : "kind=unknown_contact";
    let allowed: string[] = [];
    if (identity === "client") {
      const r = await loadInboundAiRoundContext(Number(c.client_id));
      crm = r.text;
      allowed = r.allowedUrls;
    }
    const lang = c.preferred_language === "es" ? "es" : "en";
    const ctx: InboundAiToolCtx = {
      identity,
      clientId: identity === "client" ? Number(c.client_id) : null,
      conversationId: Number(c.id),
      displayName: identity === "client" ? `${c.first_name} ${c.last_name}` : "sender",
      lang,
      assigneeAdminId: 0,
      allowedUrls: [...allowed],
      grounding: [],
      toolsUsed: [],
      callbackRequested: false,
      dryRun: true,
    };
    const faq = await loadInboundAiFaqContext(8);
    const threadLines = [...recent]
      .reverse()
      .filter((m) => String(m.body || "").trim() && !String(m.body).startsWith("[Shared phone]"))
      .slice(-8)
      .map((m) => `${m.direction === "inbound" ? "Contact" : m.direction === "outbound" ? "OFG" : "System"}: ${String(m.body).slice(0, 280)}`)
      .join("\n");
    const d = await callInboundAiClaude({
      lang,
      channel: "sms",
      displayName: ctx.displayName,
      inboundText: body.slice(0, 800),
      crmContext: crm,
      faqContext: faq,
      threadLines,
      aiTurnCount: rules.aiTurns,
      timeoutMs: 20_000,
      toolCtx: ctx,
    });
    let outcome: string = d.action;
    if (d.action !== "escalate") {
      const blocked = checkInboundAiReply(d.reply, {
        allowedUrls: ctx.allowedUrls,
        groundingText: [crm, faq, threadLines, body, ...ctx.grounding].join("\n"),
      });
      if (blocked) outcome = `blocked:${blocked}`;
    } else outcome = `escalate:${d.escalate_reason}`;
    if (ctx.callbackRequested) outcome += "+callback";
    bump(`now: ${outcome}`);
    if (SHOW) {
      console.log(`\n#${n} [${note.old_reason}] ${identity} → ${outcome} (tools: ${ctx.toolsUsed.join(",") || "—"})`);
      console.log(`  IN:  ${body.slice(0, 200)}`);
      console.log(`  OUT: ${(d.reply || d.summary).slice(0, 300)}`);
    }
  }
  console.log(`\nReplayed ${n} escalated texts (last ${DAYS} days):`);
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => null);
  process.exit(1);
});

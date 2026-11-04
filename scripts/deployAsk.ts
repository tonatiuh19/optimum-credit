/**
 * Deploy questions answered from the terminal OR Telegram, whichever comes first.
 *
 * Telegram is optional: set TELEGRAM_BOT_TOKEN in .env (bot from @BotFather). The first time, send the
 * bot any message; the script saves that chat as TELEGRAM_CHAT_ID and from then on only accepts answers
 * from it. Without a token everything works in the terminal only.
 */
import dns from "node:dns";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";

/**
 * Project name on every Telegram message, so one bot can serve several repos:
 * DEPLOY_NAME in .env, else package.json "name" ("the-mortgage-professionals" → "The Mortgage Professionals").
 */
export const projectName = (() => {
  const set = process.env.DEPLOY_NAME?.trim();
  if (set) return set;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as { name?: string };
    const raw = String(pkg.name || "").replace(/^@[^/]+\//, "");
    if (raw) return raw.split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  } catch {
    /* fall through */
  }
  return path.basename(process.cwd());
})();

export type Choice = { key: string; label: string; /** Ask for typed text after picking this one. */ text?: string };
export type Answer = { key: string; text?: string; via: "terminal" | "telegram" };

// Many home / office networks have no working IPv6 route: Node would try Telegram's IPv6 address and
// time out (ETIMEDOUT, "fetch failed"). IPv4 first, with a plain connect, makes it reliable.
dns.setDefaultResultOrder("ipv4first");
// Node's address racing gives up on a connection after 250ms, which drops slower (but fine) IPv4 handshakes.
net.setDefaultAutoSelectFamily(false);

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
let chatId = process.env.TELEGRAM_CHAT_ID?.trim() || "";
let offset = 0;
let telegramOff = false;

async function tg<T = any>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const j = (await r.json()) as { ok: boolean; result: T; description?: string };
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || r.status}`);
  return j.result;
}

/** Saves TELEGRAM_CHAT_ID into .env so the next deploy knows who to ask. */
function rememberChat(id: string) {
  chatId = id;
  const file = path.resolve(process.cwd(), ".env");
  try {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    // Fills an empty `TELEGRAM_CHAT_ID=` line, or adds one; never overwrites a chat that is already set.
    if (/^TELEGRAM_CHAT_ID=[ \t]*$/m.test(cur)) fs.writeFileSync(file, cur.replace(/^TELEGRAM_CHAT_ID=[ \t]*$/m, `TELEGRAM_CHAT_ID=${id}`));
    else if (!/^TELEGRAM_CHAT_ID=/m.test(cur)) fs.appendFileSync(file, `${cur.endsWith("\n") || !cur ? "" : "\n"}TELEGRAM_CHAT_ID=${id}\n`);
  } catch {
    /* the chat still works for this run */
  }
}

/** True when the bot can reach you. Finds the chat from the newest message to the bot on first use. */
let linked = false;

export async function telegramReady(): Promise<boolean> {
  if (!TOKEN() || telegramOff) return false;
  if (linked) return true;
  try {
    // Wi-Fi / DNS blips are common: three tries before falling back to the terminal.
    let updates: any[] = [];
    for (let attempt = 1; ; attempt++) {
      try {
        updates = await tg<any[]>("getUpdates", { timeout: 0 }, AbortSignal.timeout(8000));
        break;
      } catch (e) {
        if (attempt >= 3 || /Telegram getUpdates:/.test(String((e as Error)?.message))) throw e;
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    }
    if (updates.length) offset = updates[updates.length - 1].update_id + 1;
    if (!chatId) {
      const last = [...updates].reverse().find((u) => u.message?.chat?.type === "private");
      if (!last) {
        console.log("📱 Telegram: send any message to your deploy bot once, then run the deploy again to link it. Using the terminal for now.");
        telegramOff = true;
        return false;
      }
      rememberChat(String(last.message.chat.id));
      console.log("📱 Telegram linked: deploy questions will also come to your chat.");
    }
    linked = true;
    return true;
  } catch (e) {
    const cause = (e as { cause?: { code?: string } })?.cause?.code;
    console.log(`📱 Telegram unavailable (${cause ? `network: ${cause}` : e instanceof Error ? e.message : e}). Using the terminal.`);
    // A bad token stays off for the run; a network blip is retried at the next question (e.g. the version, after the tests).
    if (!cause && /Telegram getUpdates:/.test(String((e as Error)?.message))) telegramOff = true;
    return false;
  }
}

/** Plain message (deploy started, live, failed). Never throws. */
export async function notify(text: string): Promise<void> {
  if (!(await telegramReady())) return;
  await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }).catch(() => undefined);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Waits for a button tap (or typed text when `wantText`) from the linked chat only. */
async function telegramAnswer(question: string, choices: Choice[], signal: AbortSignal): Promise<Answer> {
  const msg = await tg<any>(
    "sendMessage",
    {
      chat_id: chatId,
      text: `🚀 <b>${escapeHtml(projectName)} deploy</b>\n${escapeHtml(question)}`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: choices.map((c) => [{ text: c.label, callback_data: c.key }]) },
    },
    signal,
  );
  const done = (note: string) =>
    tg("editMessageText", { chat_id: chatId, message_id: msg.message_id, text: `🚀 <b>${escapeHtml(projectName)} deploy</b>\n${escapeHtml(question)}\n\n${note}`, parse_mode: "HTML" }).catch(() => undefined);
  signal.addEventListener("abort", () => void done("⌨️ Answered in the terminal."), { once: true });

  let picked: Choice | null = null;
  while (!signal.aborted) {
    let updates: any[] = [];
    try {
      updates = await tg<any[]>("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, signal);
    } catch (e) {
      if (signal.aborted) break;
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      const cb = u.callback_query;
      if (cb && String(cb.message?.chat?.id) === chatId && cb.message?.message_id === msg.message_id) {
        await tg("answerCallbackQuery", { callback_query_id: cb.id }).catch(() => undefined);
        const c = choices.find((x) => x.key === cb.data);
        if (!c) continue;
        if (!c.text) {
          await done(`✅ ${escapeHtml(c.label)}`);
          return { key: c.key, via: "telegram" };
        }
        picked = c;
        await tg("sendMessage", { chat_id: chatId, text: `✏️ ${escapeHtml(c.text)}`, parse_mode: "HTML", reply_markup: { force_reply: true } });
      }
      const m = u.message;
      if (picked && m && String(m.chat?.id) === chatId && typeof m.text === "string" && m.text.trim()) {
        await done(`✅ ${escapeHtml(picked.label)}: ${escapeHtml(m.text.trim())}`);
        return { key: picked.key, text: m.text.trim(), via: "telegram" };
      }
    }
  }
  throw new Error("aborted");
}

async function terminalAnswer(question: string, choices: Choice[], signal: AbortSignal): Promise<Answer> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\n❓ ${question}`);
    choices.forEach((c, i) => console.log(`   ${i + 1}) ${c.label}`));
    while (true) {
      const raw = (await rl.question(`   Pick 1-${choices.length}: `, { signal })).trim();
      const c = choices[Number(raw) - 1];
      if (!c) continue;
      if (!c.text) return { key: c.key, via: "terminal" };
      const text = (await rl.question(`   ✏️  ${c.text} `, { signal })).trim();
      if (text) return { key: c.key, text, via: "terminal" };
    }
  } finally {
    rl.close();
  }
}

/** Asks in the terminal and on Telegram at once; the first answer wins and closes the other. */
export async function ask(question: string, choices: Choice[]): Promise<Answer> {
  const stop = new AbortController();
  // Connect first, so a Telegram notice never lands in the middle of the terminal prompt.
  const useTelegram = await telegramReady();
  const racers = [terminalAnswer(question, choices, stop.signal)];
  if (useTelegram) {
    racers.push(
      telegramAnswer(question, choices, stop.signal).catch((e) => {
        if (stop.signal.aborted) throw e;
        console.log(`📱 Telegram stopped answering (${e instanceof Error ? e.message : e}); use the terminal.`);
        return new Promise<Answer>(() => undefined); // let the terminal win
      }),
    );
  }
  try {
    const a = await Promise.race(racers);
    if (a.via === "telegram") console.log(`\n   📱 Answered on Telegram: ${choices.find((c) => c.key === a.key)?.label}${a.text ? ` → ${a.text}` : ""}`);
    return a;
  } finally {
    stop.abort();
    racers.forEach((p) => p.catch(() => undefined));
  }
}

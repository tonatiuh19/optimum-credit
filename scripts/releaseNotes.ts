/**
 * "What's new" release notes posted to Slack after a successful production
 * deploy (scripts/deploy-prod.ts). Only what changed SINCE THE LAST
 * ANNOUNCEMENT: each announcement records a snapshot commit of the deployed
 * working tree (committed + uncommitted + new files, built with a temporary
 * index — the real index/working tree are never touched), kept alive by the
 * local ref refs/ofg/release-notes. The next deploy diffs snapshot → snapshot,
 * so uncommitted work is never announced twice. Claude writes staff-facing
 * notes from that diff (English). Never throws — Slack/AI problems never fail
 * a deploy.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const RELEASE_NOTES_REF = "refs/ofg/release-notes";

export type ReleaseChanges = {
  /** Snapshot commit of what is being deployed now. */
  snapshot: string;
  commits: string[];
  files: string[];
  /** Unified diff (meaningful files only, truncated). */
  diff: string;
  /** False when there was no previous snapshot (first run → baseline only). */
  hasBaseline: boolean;
};

function git(args: string[], env?: NodeJS.ProcessEnv): string {
  const r = spawnSync("git", args, { encoding: "utf8", env: env ? { ...process.env, ...env } : process.env, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? String(r.stdout || "").trim() : "";
}

/** Commit object for the current working tree (incl. uncommitted + untracked, honoring .gitignore). */
export function snapshotWorkingTree(): string {
  const head = git(["rev-parse", "HEAD"]);
  const tmpIndex = path.join(os.tmpdir(), `ofg-release-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    if (!head) return "";
    git(["read-tree", head], env);
    // samples/ can hold real client reports — never snapshot it.
    git(["add", "-A", "--", ".", ":(exclude)samples"], env);
    const tree = git(["write-tree"], env);
    if (!tree) return head;
    return git(["commit-tree", tree, "-p", head, "-m", "release-notes snapshot"]) || head;
  } finally {
    fs.rmSync(tmpIndex, { force: true });
  }
}

const isCommit = (sha: string | null | undefined) => !!sha && git(["cat-file", "-t", sha]) === "commit";

/** Files that say something to staff (skip tests, lockfiles, samples, migrations, docs, scripts). */
export function meaningfulFiles(files: string[]): string[] {
  return [...new Set(files)]
    .filter((f) => !/(\.test\.|\.spec\.|package-lock|^samples\/|^database\/|\.md$|^scripts\/|\.ya?ml$|\.(pdf|png|jpe?g|webp|heic|svg)$)/i.test(f))
    .slice(0, 80);
}

const MAX_DIFF_CHARS = 60_000;

export function collectReleaseChanges(lastSnapshot: string | null): ReleaseChanges {
  const snapshot = snapshotWorkingTree();
  const base = isCommit(lastSnapshot) ? lastSnapshot! : isCommit(git(["rev-parse", "--verify", "-q", RELEASE_NOTES_REF])) ? git(["rev-parse", RELEASE_NOTES_REF]) : "";
  if (!snapshot || !base) return { snapshot, commits: [], files: [], diff: "", hasBaseline: false };
  const files = meaningfulFiles(git(["diff", "--name-only", base, snapshot]).split("\n").filter(Boolean));
  const commits = git(["log", "--no-merges", "--pretty=%s", `${base}..${snapshot}`])
    .split("\n")
    .filter((m) => m && m !== "release-notes snapshot")
    .slice(0, 40);
  let diff = files.length ? git(["diff", "--unified=1", "--no-color", base, snapshot, "--", ...files]) : "";
  if (diff.length > MAX_DIFF_CHARS) diff = diff.slice(0, MAX_DIFF_CHARS) + "\n…(diff truncated)";
  return { snapshot, commits, files, diff, hasBaseline: true };
}

/** Remember what was announced (local ref keeps the snapshot from git gc). */
export function markSnapshotAnnounced(snapshot: string): void {
  if (snapshot) git(["update-ref", RELEASE_NOTES_REF, snapshot]);
}

/** Drop anything the model adds above/around the bullets (titles, dates, separators). */
export function sanitizeReleaseNotes(text: string): string {
  return text
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      if (/^[-–—_*]{3,}$/.test(t)) return false;
      if (/(release notes|platform update|what'?s new|is live)/i.test(t) && !/^[•\-*]\s/.test(t)) return false;
      if (!/^[•\-*]\s/.test(t) && /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/i.test(t)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function fallbackReleaseNotes(version: string, c: Pick<ReleaseChanges, "commits">): string {
  const items = c.commits.length ? c.commits.map((s) => `• ${s}`).join("\n") : "• Behind-the-scenes improvements and fixes.";
  return `*:rocket: Version ${version} is live*\n${items}`;
}

const SYSTEM = `You write short "What's new" release notes for the internal staff of Optimum Financial Group (a credit-repair company) after a production deploy of their platform (admin CRM, client portal, credit analysis, progress reports, messaging, funding, payments).
You receive ONLY the code diff since the previous announcement. Describe ONLY what this diff changes — never features that merely appear in surrounding context lines, never things from earlier releases.
Audience: non-technical staff (sales, processors, managers). English only.
Rules: 1–8 bullets total, each one plain-language benefit or fix ("Credit Analysis: charge cards no longer count toward utilization"). Group by area with a bold area name. No file names, no code, no commit hashes, no internal jargon, no client names or personal data. Bug fixes staff or clients would notice ARE news (e.g. "Progress reports: clients now get every round when several rounds are published back-to-back"). Skip only truly invisible refactors/tests/tooling. If nothing user-visible changed, write exactly one bullet: "• Behind-the-scenes improvements and fixes."
Never invent features, dates or numbers; when unsure, leave it out.
Output ONLY the grouped bullets in Slack mrkdwn: no title, no heading line, no date, no "---" separators, no preamble or sign-off.`;

export async function writeReleaseNotes(version: string, c: ReleaseChanges): Promise<string> {
  const header = `*:rocket: Version ${version} is live — what's new*`;
  if (!c.diff && !c.commits.length) return `${header}\n• Behind-the-scenes improvements and fixes.`;
  const apiKey = String(process.env.ANTHROPIC_SMS_API_KEY || process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return fallbackReleaseNotes(version, c);
  const ws = String(process.env.ANTHROPIC_SMS_WORKSPACE_ID || "").trim();
  const input = [`Commit messages:\n${c.commits.join("\n") || "(none)"}`, `Diff since last announcement:\n${c.diff || "(none)"}`].join("\n\n");
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        ...(ws && apiKey === String(process.env.ANTHROPIC_SMS_API_KEY || "").trim() ? { "anthropic-workspace-id": ws } : {}),
      },
      body: JSON.stringify({
        model: String(process.env.ANTHROPIC_MODEL || "").trim() || "claude-sonnet-4-6",
        max_tokens: 800,
        system: SYSTEM,
        messages: [{ role: "user", content: input }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`Anthropic ${resp.status}`);
    const data: any = await resp.json();
    const text = sanitizeReleaseNotes((data?.content || []).filter((x: any) => x?.type === "text").map((x: any) => x.text).join(""));
    return text ? `${header}\n${text}` : fallbackReleaseNotes(version, c);
  } catch (e) {
    console.warn(`⚠️  Release notes AI skipped: ${e instanceof Error ? e.message : String(e)}`);
    return fallbackReleaseNotes(version, c);
  }
}

/** Post to the releases channel. Returns false (never throws) when not configured / failed. */
export async function postReleaseNotesToSlack(text: string): Promise<boolean> {
  const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
  const channel = String(process.env.SLACK_RELEASES_CHANNEL_ID || "").trim();
  if (!token || !channel) {
    console.log("ℹ️  Slack release notes skipped (SLACK_BOT_TOKEN / SLACK_RELEASES_CHANNEL_ID not set).");
    return false;
  }
  try {
    const resp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel, text, unfurl_links: false }),
      signal: AbortSignal.timeout(10_000),
    });
    const data: any = await resp.json();
    if (!data?.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
    return true;
  } catch (e) {
    console.warn(`⚠️  Slack release notes failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

// ── Resolved requests from the Slack "Bug or Feature Request" list ──────────

export type ResolvedRequest = { id: string; title: string; type: string; requestedBy: string | null };

/** Column schema → { id, name, choices(value→label) }, tolerant of Slack's shape. */
function listColumns(list: any): Array<{ id: string; name: string; choices: Map<string, string> }> {
  const schema: any[] = list?.list_metadata?.schema ?? list?.schema ?? list?.columns ?? [];
  return schema.map((c: any) => {
    const raw: any[] = c?.options?.choices ?? c?.choices ?? c?.options?.options ?? [];
    return {
      id: String(c?.id ?? c?.column_id ?? ""),
      name: String(c?.name ?? c?.key ?? ""),
      choices: new Map(raw.map((o: any) => [String(o?.value ?? o?.id ?? ""), String(o?.label ?? o?.name ?? o?.value ?? "")])),
    };
  });
}

/**
 * Rows whose Status is "Done" (and not announced before), from the list's
 * items + schema (slackLists.items.list with include_list=true).
 */
export function resolvedRequestsFromList(list: any, items: any[], announced: Set<string>): ResolvedRequest[] {
  const cols = listColumns(list);
  const col = (re: RegExp) => cols.find((c) => re.test(c.name));
  const status = col(/^status$/i);
  const title = col(/^(title|name)$/i);
  const type = col(/^type$/i);
  const reqBy = col(/requested by/i);
  if (!status) return [];
  const cell = (item: any, c?: { id: string }) => (c ? (item?.fields ?? []).find((f: any) => f?.column_id === c.id) : undefined);
  const label = (c: { choices: Map<string, string> } | undefined, f: any) => {
    const v = f?.select?.[0] ?? f?.value;
    return v == null ? "" : c?.choices.get(String(v)) || String(v);
  };
  const out: ResolvedRequest[] = [];
  for (const item of items) {
    const id = String(item?.id ?? "");
    if (!id || announced.has(id) || item?.archived) continue;
    if (!/^done$/i.test(label(status, cell(item, status)).trim())) continue;
    const t = cell(item, title);
    out.push({
      id,
      title: String(t?.text ?? t?.value ?? "Untitled request").trim().slice(0, 140),
      type: label(type, cell(item, type)),
      requestedBy: cell(item, reqBy)?.user?.[0] ?? null,
    });
  }
  return out.slice(0, 20);
}

export async function fetchResolvedRequests(announced: Set<string>): Promise<ResolvedRequest[]> {
  const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
  const listId = String(process.env.SLACK_REQUESTS_LIST_ID || "").trim();
  if (!token || !listId) return [];
  try {
    const resp = await fetch("https://slack.com/api/slackLists.items.list", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ list_id: listId, include_list: true, limit: 200 }),
      signal: AbortSignal.timeout(10_000),
    });
    const data: any = await resp.json();
    if (!data?.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
    return resolvedRequestsFromList(data.list, data.items ?? [], announced);
  } catch (e) {
    console.warn(`⚠️  Resolved requests skipped: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

export function resolvedRequestsSection(rows: ResolvedRequest[]): string {
  if (!rows.length) return "";
  const lines = rows.map(
    (r) => `• ${r.title}${r.type ? ` _(${r.type})_` : ""}${r.requestedBy ? ` — requested by <@${r.requestedBy}>` : ""}`,
  );
  return `\n\n*:white_check_mark: Resolved from #ofg-bug-features-requests*\n${lines.join("\n")}`;
}

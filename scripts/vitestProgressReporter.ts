/**
 * Deploy test dashboard (terminal): Disrupting Labs logo, then a live panel pinned to the bottom with the
 * overall bar, files / tests / speed, an ETA learned from previous runs, every file running now (its own bar,
 * test count, time and current test), the slowest tests, the last failure and a fun status line.
 * Test results stream above the panel. Used by `npm run deploy:prod` on a terminal; `npm test` keeps the default.
 */
import type { Reporter, SerializedError, TestCase, TestModule, TestRunEndReason, TestSpecification } from "vitest/node";
import fs from "node:fs";
import path from "node:path";
import { projectName } from "./deployAsk";

// ── colors ────────────────────────────────────────────────────────────────────
const esc = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
const rgb = (r: number, g: number, b: number) => esc(`38;2;${r};${g};${b}`);
const c = {
  gold: rgb(217, 164, 65),
  amber: rgb(255, 196, 87),
  cyan: rgb(80, 220, 255),
  violet: rgb(170, 120, 255),
  green: rgb(80, 220, 120),
  red: rgb(255, 90, 90),
  yellow: rgb(255, 210, 90),
  gray: rgb(120, 130, 150),
  bold: esc("1"),
};

/** Violet → cyan across a width (the Disrupting Labs gradient). */
const grad = (i: number, n: number) => {
  const t = n <= 1 ? 0 : i / (n - 1);
  return rgb(Math.round(170 + (80 - 170) * t), Math.round(120 + (220 - 120) * t), 255);
};

// ── logo ──────────────────────────────────────────────────────────────────────
const GLYPH: Record<string, string[]> = {
  D: ["████ ", "█   █", "█   █", "█   █", "████ "],
  I: ["███", " █ ", " █ ", " █ ", "███"],
  S: [" ████", "█    ", " ███ ", "    █", "████ "],
  R: ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
  U: ["█   █", "█   █", "█   █", "█   █", " ███ "],
  P: ["████ ", "█   █", "████ ", "█    ", "█    "],
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  G: [" ████", "█    ", "█  ██", "█   █", " ████"],
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  A: [" ███ ", "█   █", "█████", "█   █", "█   █"],
  B: ["████ ", "█   █", "████ ", "█   █", "████ "],
  " ": ["  ", "  ", "  ", "  ", "  "],
};

function logoLines(word: string): string[] {
  const rows = ["", "", "", "", ""];
  for (const ch of word) for (let r = 0; r < 5; r++) rows[r] += (GLYPH[ch] ?? GLYPH[" "])[r] + " ";
  const w = rows[0].length;
  return rows.map((row) => [...row].map((ch, i) => (ch === " " ? " " : grad(i, w)(ch))).join(""));
}

function printLogo(cols: number, subtitle: string) {
  const wide = cols >= 92;
  const blocks = wide ? [logoLines("DISRUPTING LABS")] : [logoLines("DISRUPTING"), logoLines("LABS")];
  process.stdout.write("\n");
  for (const b of blocks) process.stdout.write(b.map((l) => `  ${l}`).join("\n") + "\n\n");
  process.stdout.write(`  ${c.gray("─".repeat(Math.min(cols - 4, wide ? 88 : 60)))}\n  ${subtitle}\n\n`);
}

// ── helpers ───────────────────────────────────────────────────────────────────
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MOODS = [
  "🏗️  laying the foundation",
  "🧱 stacking bricks",
  "🔨 framing the walls",
  "🔌 wiring the house",
  "🪟 fitting the windows",
  "🎨 painting the trim",
  "🔑 handing over the keys",
];

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
};
const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const isEmoji = (ch: string) => /\p{Extended_Pictographic}/u.test(ch);
/** Width on screen: no color codes, emoji count double. */
const width = (s: string) => {
  const plain = s.replace(ANSI, "").replace(/️/g, "");
  let w = 0;
  for (const ch of plain) w += isEmoji(ch) ? 2 : 1;
  return w;
};
/** Cut a colored line to `max` columns (a wrapped line would break the in-place redraw). */
function fit(s: string, max: number): string {
  if (width(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const part of s.split(/(\x1b\[[0-9;?]*[A-Za-z])/)) {
    if (part.startsWith("\x1b[")) {
      out += part;
      continue;
    }
    for (const ch of part) {
      const cw = ch === "️" ? 0 : isEmoji(ch) ? 2 : 1;
      if (w + cw > max - 1) return `${out}…\x1b[0m`;
      out += ch;
      w += cw;
    }
  }
  return out;
}

function bar(ratio: number, size: number, frame: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const full = Math.floor(r * size);
  let s = "";
  for (let i = 0; i < full; i++) s += grad(i, size)("█");
  if (full < size) s += (frame % 6 < 3 ? c.amber : c.gold)("▓") + c.gray("░".repeat(size - full - 1));
  return s;
}

const shortName = (id: string) => path.basename(id).replace(/\.(integration\.)?(test|spec)\.tsx?$/, "");

// ── timing memory (ETA from previous runs) ────────────────────────────────────
const TIMES_FILE = path.resolve(process.cwd(), "node_modules/.cache/dl-test-times.json");
/** Failed tests of the last run, read by the deploy script for its Telegram abort message. */
const FAILURES_FILE = path.resolve(process.cwd(), "node_modules/.cache/dl-test-failures.json");
const writeFailures = (list: string[]) => {
  try {
    fs.mkdirSync(path.dirname(FAILURES_FILE), { recursive: true });
    fs.writeFileSync(FAILURES_FILE, JSON.stringify(list));
  } catch {
    /* the abort message just has no test list */
  }
};
function loadTimes(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(TIMES_FILE, "utf8"));
  } catch {
    return {};
  }
}

type Running = { id: string; started: number; current: string };
type Slow = { name: string; file: string; ms: number };

export default class DashboardReporter implements Reporter {
  private tty = Boolean(process.stdout.isTTY);
  private specs: string[] = [];
  private done = new Set<string>();
  private planned = new Map<string, number>();
  private finished = new Map<string, number>();
  private running = new Map<string, Running>();
  private passed = 0;
  private failed = 0;
  private skipped = 0;
  private started = Date.now();
  private frame = 0;
  private slowest: Slow[] = [];
  private lastFail: string | null = null;
  private failures: TestCase[] = [];
  private fileTimes: Record<string, number> = {};
  private history = loadTimes();
  private peakWorkers = 1;
  private panelHeight = 0;
  private timer: NodeJS.Timeout | null = null;

  private get cols() {
    return Math.max(50, (process.stdout.columns || 100) - 1);
  }

  onTestRunStart(specs: ReadonlyArray<TestSpecification>) {
    this.specs = specs.map((s) => s.moduleId);
    writeFailures([]);
    this.started = Date.now();
    printLogo(this.cols, `${c.bold(c.cyan("🧪 Test run"))} ${c.gray("·")} ${c.bold(projectName)} ${c.gray(`· ${specs.length} files · ${new Date().toLocaleTimeString()}`)}`);
    if (!this.tty) return;
    process.stdout.write("\x1b[?25l"); // hide the cursor while the panel animates
    this.timer = setInterval(() => {
      this.frame++;
      this.redraw();
    }, 100);
  }

  onTestModuleCollected(m: TestModule) {
    this.planned.set(m.moduleId, [...m.children.allTests()].length);
  }

  onTestModuleStart(m: TestModule) {
    this.running.set(m.moduleId, { id: m.moduleId, started: Date.now(), current: "" });
    this.peakWorkers = Math.max(this.peakWorkers, this.running.size);
  }

  onTestCaseReady(t: TestCase) {
    const r = this.running.get(t.module.moduleId);
    if (r) r.current = t.name;
  }

  onTestCaseResult(t: TestCase) {
    const id = t.module.moduleId;
    this.finished.set(id, (this.finished.get(id) || 0) + 1);
    const ms = t.diagnostic()?.duration ?? 0;
    const state = t.result().state;
    const time = ms >= 1000 ? c.yellow(` ${secs(ms)}`) : c.gray(` ${secs(ms)}`);
    if (state === "passed") {
      this.passed++;
      this.log(`   ${c.green("✓")} ${c.gray(`${shortName(id)} ›`)} ${t.name}${time}`);
    } else if (state === "failed") {
      this.failed++;
      this.failures.push(t);
      this.lastFail = `${shortName(id)} › ${t.name}`;
      writeFailures(this.failures.map((f) => `${shortName(f.module.moduleId)} › ${f.name}`));
      this.log(`   ${c.red("✗")} ${c.gray(`${shortName(id)} ›`)} ${c.red(t.name)}${time}`);
    } else this.skipped++;
    if (state !== "skipped" && ms > 0) {
      this.slowest.push({ name: t.name, file: shortName(id), ms });
      this.slowest.sort((a, b) => b.ms - a.ms);
      this.slowest.length = Math.min(this.slowest.length, 3);
    }
  }

  onTestModuleEnd(m: TestModule) {
    const r = this.running.get(m.moduleId);
    const ms = m.diagnostic().duration || (r ? Date.now() - r.started : 0);
    this.running.delete(m.moduleId);
    this.done.add(m.moduleId);
    this.fileTimes[path.relative(process.cwd(), m.moduleId)] = ms;
    const tests = this.planned.get(m.moduleId) ?? 0;
    this.log(
      `${m.ok() ? c.bold(c.green(" PASS ")) : c.bold(c.red(" FAIL "))} ${c.bold(path.relative(process.cwd(), m.moduleId))} ${c.gray(`· ${tests} tests · ${clock(ms)}`)}`,
    );
  }

  /**
   * Vitest also fails the run on errors outside a test: a file that cannot load, a failing
   * beforeAll / afterAll (e.g. the DB dropping during cleanup) or an unhandled rejection.
   * Those are not test results, so they are collected here; otherwise the run reads
   * "All tests passed" while vitest exits with code 1.
   */
  onTestRunEnd(modules: ReadonlyArray<TestModule> = [], unhandledErrors: ReadonlyArray<SerializedError> = [], reason?: TestRunEndReason) {
    const outside: Array<{ where: string; error: SerializedError }> = [];
    for (const m of modules) for (const e of m.errors()) outside.push({ where: shortName(m.moduleId), error: e });
    for (const e of unhandledErrors) outside.push({ where: "unhandled error", error: e });
    if (outside.length) {
      writeFailures([
        ...this.failures.map((f) => `${shortName(f.module.moduleId)} › ${f.name}`),
        ...outside.map((o) => `${o.where} › ${String(o.error.message || o.error.name || "error").split("\n")[0]}`),
      ]);
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clearPanel();
    if (this.tty) process.stdout.write("\x1b[?25h");
    try {
      // Only files that still exist (deleted tests drop out); temp file + rename so a kill never leaves half a file.
      const keep: Record<string, number> = {};
      for (const id of this.specs) {
        const rel = path.relative(process.cwd(), id);
        const ms = this.fileTimes[rel] ?? this.history[rel];
        if (ms) keep[rel] = ms;
      }
      fs.mkdirSync(path.dirname(TIMES_FILE), { recursive: true });
      fs.writeFileSync(`${TIMES_FILE}.tmp`, JSON.stringify(keep));
      fs.renameSync(`${TIMES_FILE}.tmp`, TIMES_FILE);
    } catch {
      /* the ETA just learns again next time */
    }
    for (const t of this.failures) {
      process.stdout.write(`\n${c.bold(c.red("FAIL"))} ${path.relative(process.cwd(), t.module.moduleId)} › ${t.fullName}\n`);
      for (const e of t.result().errors ?? []) {
        process.stdout.write(`${c.red(String(e.message || e))}\n`);
        if (e.stack) process.stdout.write(c.gray(e.stack.split("\n").slice(1, 6).join("\n")) + "\n");
      }
    }
    for (const o of outside) {
      process.stdout.write(`\n${c.bold(c.red("ERROR"))} ${o.where} ${c.gray("(outside a test)")}\n${c.red(String(o.error.message || o.error))}\n`);
      if (o.error.stack) process.stdout.write(c.gray(o.error.stack.split("\n").slice(1, 6).join("\n")) + "\n");
    }
    const total = this.passed + this.failed + this.skipped;
    const took = clock(Date.now() - this.started);
    const broken = this.failed || outside.length || (reason && reason !== "passed");
    const line = broken
      ? `${c.bold(c.red(`💥 ${[this.failed ? `${this.failed} failed` : "", outside.length ? `${outside.length} error(s) outside tests` : "", !this.failed && !outside.length ? `run ${reason}` : ""].filter(Boolean).join(" · ")}`))} ${c.gray("·")} ${c.green(`${this.passed} passed`)}`
      : `${c.bold(c.green("🎉 All tests passed"))} ${c.gray("·")} ${c.green(`${this.passed} passed`)}`;
    process.stdout.write(`\n${line} ${c.gray(`· ${this.skipped} skipped · ${total} total · ${this.done.size} files · ${took}`)}\n`);
    if (this.slowest.length) {
      process.stdout.write(`${c.gray("🐢 slowest:")} ${this.slowest.map((s) => `${s.file} › ${s.name} ${c.yellow(secs(s.ms))}`).join(c.gray("  ·  "))}\n`);
    }
  }

  // ── panel ─────────────────────────────────────────────────────────────────
  private log(line: string) {
    if (!this.tty) {
      process.stdout.write(line.replace(ANSI, "") + "\n");
      return;
    }
    this.clearPanel();
    process.stdout.write(fit(line, this.cols) + "\n");
    this.drawPanel();
  }

  private redraw() {
    this.clearPanel();
    this.drawPanel();
  }

  private clearPanel() {
    if (!this.tty || !this.panelHeight) return;
    process.stdout.write(`\x1b[${this.panelHeight}A\r\x1b[J`);
    this.panelHeight = 0;
  }

  /** Expected time for a file: last run's time, else the average of files done this run, else 20s. */
  private expected(id: string) {
    const rel = path.relative(process.cwd(), id);
    if (this.history[rel]) return this.history[rel];
    const doneTimes = Object.values(this.fileTimes);
    return doneTimes.length ? doneTimes.reduce((a, b) => a + b, 0) / doneTimes.length : 20_000;
  }

  private progress() {
    const total = this.specs.length || 1;
    let partial = 0;
    for (const r of this.running.values()) {
      const plan = this.planned.get(r.id);
      if (plan) partial += Math.min(1, (this.finished.get(r.id) || 0) / plan);
    }
    return Math.min(1, (this.done.size + partial) / total);
  }

  /** Remaining work (previous run times, else this run's average) spread over the workers in use. */
  private eta(): number | null {
    if (!this.done.size && !Object.keys(this.history).length) return null;
    const now = Date.now();
    let work = 0;
    for (const id of this.specs) {
      if (this.done.has(id)) continue;
      const r = this.running.get(id);
      work += r ? Math.max(0, this.expected(id) - (now - r.started)) : this.expected(id);
    }
    return work / Math.max(1, this.peakWorkers);
  }

  private drawPanel() {
    if (!this.tty || !this.timer) return;
    const cols = this.cols;
    const now = Date.now();
    const elapsed = now - this.started;
    const ratio = this.progress();
    const eta = this.eta();
    const spin = c.cyan(SPIN[this.frame % SPIN.length]);
    const testsDone = this.passed + this.failed + this.skipped;
    const rate = elapsed > 3000 ? (testsDone / (elapsed / 1000)).toFixed(1) : "–";
    const mood = !this.running.size && !this.done.size ? "🧹 preparing the test database" : MOODS[Math.min(MOODS.length - 1, Math.floor(ratio * MOODS.length))];
    const finishAt = eta != null ? new Date(now + eta).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
    const L = c.gray("│");

    const lines: string[] = [];
    const title = ` ${c.bold(c.cyan("DISRUPTING LABS"))} ${c.gray("·")} ${c.bold("test dashboard")} `;
    lines.push(c.gray("╭─") + title + c.gray("─".repeat(Math.max(2, cols - width(title) - 3))));
    const big = Math.max(16, Math.min(46, cols - 52));
    lines.push(`${L} ${spin} ${bar(ratio, big, this.frame)} ${c.bold(`${(ratio * 100).toFixed(1).padStart(5)}%`)}  ${c.gray(`${this.done.size}/${this.specs.length} files`)}`);
    lines.push(
      `${L}   ${c.green(`✓ ${this.passed} passed`)}  ${this.failed ? c.bold(c.red(`✗ ${this.failed} failed`)) : c.gray("✗ 0 failed")}  ${c.gray(`↷ ${this.skipped} skipped`)}  ${c.gray("·")} ${c.cyan(`⚡ ${rate} tests/s`)}  ${c.gray(`· ${this.running.size} running`)}`,
    );
    lines.push(
      `${L}   ${c.gray("⏱")} ${c.bold(clock(elapsed))} ${c.gray("elapsed")}  ${c.gray("·")} ${c.gray("⏳")} ${eta != null ? c.bold(c.amber(clock(eta))) : c.gray("learning…")} ${c.gray("left")}${finishAt ? `  ${c.gray("·")} ${c.gray("🏁 done ~")}${c.bold(finishAt)}` : ""}`,
    );
    lines.push(L);
    lines.push(`${L} ${c.bold(c.violet("▶ RUNNING NOW"))}`);
    if (!this.running.size) lines.push(`${L}   ${c.gray("waiting for the next file…")}`);
    const running = [...this.running.values()].sort((a, b) => a.started - b.started);
    const nameW = Math.min(30, Math.max(10, ...running.map((r) => shortName(r.id).length)));
    for (const r of running) {
      const plan = this.planned.get(r.id) || 0;
      const fin = this.finished.get(r.id) || 0;
      const exp = this.expected(r.id);
      const took = now - r.started;
      const fileRatio = plan ? fin / plan : Math.min(0.95, took / exp);
      const late = took > exp * 1.5 ? c.yellow(" ⚠ slow") : "";
      const name = shortName(r.id).slice(0, nameW).padEnd(nameW);
      lines.push(
        `${L}   ${c.cyan(SPIN[(this.frame + name.length) % SPIN.length])} ${c.bold(name)} ${bar(fileRatio, 12, this.frame)} ${c.gray(`${String(fin).padStart(2)}/${String(plan || "?").padEnd(2)}`)} ${c.amber(clock(took))}${late}  ${c.gray(r.current ? `› ${r.current}` : "")}`,
      );
    }
    lines.push(L);
    if (this.slowest.length) {
      lines.push(`${L} ${c.yellow("🐢 slowest")}  ${this.slowest.map((s) => `${c.gray(`${s.file} ›`)} ${s.name} ${c.yellow(secs(s.ms))}`).join(c.gray("  ·  "))}`);
    }
    lines.push(`${L} ${this.lastFail ? `${c.red("💥 last fail")}  ${c.red(this.lastFail)}` : c.green("🛡️  no failures so far")}`);
    lines.push(`${L} ${c.gold(mood)}`);
    lines.push(c.gray("╰" + "─".repeat(Math.max(2, cols - 1))));

    const out = lines.map((l) => fit(l, cols));
    process.stdout.write(out.join("\n") + "\n");
    this.panelHeight = out.length;
  }
}

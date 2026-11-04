/**
 * Deploy test progress: one live bar (files done, tests passed / failed / skipped, elapsed, ETA)
 * instead of thousands of lines. Failures print the moment they happen, with full errors at the end.
 * Used by `npm run deploy:prod` on a terminal; `npm test` keeps the default reporter.
 */
import type { Reporter, TestCase, TestModule, TestSpecification } from "vitest/node";
import path from "node:path";

const c = {
  gold: (s: string) => `\x1b[38;5;178m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default class ProgressReporter implements Reporter {
  private totalFiles = 0;
  private doneFiles = 0;
  private passed = 0;
  private failed = 0;
  private skipped = 0;
  private started = Date.now();
  private running = new Set<string>();
  private failures: TestCase[] = [];
  private timer: NodeJS.Timeout | null = null;

  onTestRunStart(specs: ReadonlyArray<TestSpecification>) {
    this.totalFiles = specs.length;
    this.started = Date.now();
    process.stdout.write(`\n${c.bold("🧪 Running tests")} ${c.dim(`(${specs.length} files)`)}\n\n`);
    this.timer = setInterval(() => this.draw(), 1000);
    this.draw();
  }

  onTestModuleStart(m: TestModule) {
    this.running.add(this.short(m.moduleId));
    this.draw();
  }

  onTestCaseResult(t: TestCase) {
    const state = t.result().state;
    if (state === "passed") this.passed++;
    else if (state === "failed") {
      this.failed++;
      this.failures.push(t);
      this.clearLine();
      process.stdout.write(`${c.red("✗")} ${this.short(t.module.moduleId)} ${c.dim("›")} ${t.fullName}\n`);
    } else this.skipped++;
    this.draw();
  }

  onTestModuleEnd(m: TestModule) {
    this.doneFiles++;
    this.running.delete(this.short(m.moduleId));
    this.draw();
  }

  onTestRunEnd() {
    if (this.timer) clearInterval(this.timer);
    this.draw();
    process.stdout.write("\n\n");
    for (const t of this.failures) {
      process.stdout.write(`${c.red(c.bold("FAIL"))} ${this.short(t.module.moduleId)} › ${t.fullName}\n`);
      for (const e of t.result().errors ?? []) {
        process.stdout.write(`${c.red(String(e.message || e))}\n`);
        if (e.stack) process.stdout.write(c.dim(e.stack.split("\n").slice(1, 6).join("\n")) + "\n");
      }
      process.stdout.write("\n");
    }
    const total = this.passed + this.failed + this.skipped;
    const verdict = this.failed ? c.red(`${this.failed} failed`) : c.green("all passed");
    process.stdout.write(
      `${c.bold("Tests")} ${verdict} ${c.dim("·")} ${c.green(`${this.passed} passed`)} ${c.dim(`· ${this.skipped} skipped · ${total} total · ${clock(Date.now() - this.started)}`)}\n`,
    );
  }

  private short(id: string) {
    return path.relative(process.cwd(), id);
  }

  private clearLine() {
    if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
  }

  private draw() {
    if (!process.stdout.isTTY) return;
    const width = Math.max(10, Math.min(30, (process.stdout.columns || 80) - 70));
    const ratio = this.totalFiles ? this.doneFiles / this.totalFiles : 0;
    const fill = Math.round(ratio * width);
    const bar = c.gold("█".repeat(fill)) + c.dim("░".repeat(width - fill));
    const elapsed = Date.now() - this.started;
    const eta = this.doneFiles > 0 && ratio < 1 ? ` · ETA ${clock((elapsed / this.doneFiles) * (this.totalFiles - this.doneFiles))}` : "";
    const now = [...this.running][0];
    const current = now ? ` ${c.dim(now.length > 34 ? `…${now.slice(-33)}` : now)}` : "";
    const counts = `${c.green(`✓${this.passed}`)}${this.failed ? ` ${c.red(`✗${this.failed}`)}` : ""}`;
    this.clearLine();
    process.stdout.write(
      `${bar} ${c.bold(`${Math.round(ratio * 100)}%`)} ${this.doneFiles}/${this.totalFiles} ${counts} ${c.dim(`${clock(elapsed)}${eta}`)}${current}`,
    );
  }
}

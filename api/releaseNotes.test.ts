/** Deploy "what's new" release notes helpers (scripts/releaseNotes.ts). */
import { describe, expect, it } from "vitest";
import { fallbackReleaseNotes, meaningfulFiles, sanitizeReleaseNotes } from "../scripts/releaseNotes";

describe("release notes helpers", () => {
  it("drops tests, migrations, samples, docs, scripts", () => {
    expect(
      meaningfulFiles(["api/index.ts", "api/x.test.ts", "client/a.spec.tsx", "database/migrations/1.sql", "samples/x.pdf", "README.md", "scripts/a.ts", "client/pages/A.tsx", "api/index.ts"]),
    ).toEqual(["api/index.ts", "client/pages/A.tsx"]);
  });
  it("fallback lists commits under the version header", () => {
    const t = fallbackReleaseNotes("1.2.3", { commits: ["feat: a"] });
    expect(t).toMatch(/Version 1\.2\.3 is live/);
    expect(t).toMatch(/• feat: a/);
  });
});

describe("sanitizeReleaseNotes", () => {
  it("strips model-added titles, dates and separators, keeps area headings and bullets", () => {
    const raw = [
      ":rocket: *Optimum Financial Group — Release Notes · September 30, 2026*",
      "---",
      "*:bar_chart: Credit Analysis*",
      "• Charge cards no longer count toward utilization",
      "",
      "",
      "",
      "*Funding*",
      "• Underwriters can request documents",
    ].join("\n");
    expect(sanitizeReleaseNotes(raw)).toBe(
      "*:bar_chart: Credit Analysis*\n• Charge cards no longer count toward utilization\n\n*Funding*\n• Underwriters can request documents",
    );
  });
});

describe("resolved requests from the Slack list", () => {
  const list = {
    list_metadata: {
      schema: [
        { id: "ColT", name: "Title" },
        { id: "ColTy", name: "Type", options: { choices: [{ value: "o1", label: "Bug" }] } },
        { id: "ColR", name: "Requested by" },
        { id: "ColS", name: "Status", options: { choices: [{ value: "s_new", label: "New" }, { value: "s_done", label: "Done" }] } },
      ],
    },
  };
  const row = (id: string, status: string) => ({
    id,
    fields: [
      { column_id: "ColT", text: `Fix ${id}` },
      { column_id: "ColTy", select: ["o1"] },
      { column_id: "ColR", user: ["U1"] },
      { column_id: "ColS", select: [status] },
    ],
  });

  it("returns only Done rows not announced before, with labels and requester", async () => {
    const { resolvedRequestsFromList, resolvedRequestsSection } = await import("../scripts/releaseNotes");
    const out = resolvedRequestsFromList(list, [row("R1", "s_done"), row("R2", "s_new"), row("R3", "s_done")], new Set(["R3"]));
    expect(out).toEqual([{ id: "R1", title: "Fix R1", type: "Bug", requestedBy: "U1" }]);
    expect(resolvedRequestsSection(out)).toMatch(/Fix R1 _\(Bug\)_ — requested by <@U1>/);
    expect(resolvedRequestsSection([])).toBe("");
  });

  it("no Status column → nothing (never guesses)", async () => {
    const { resolvedRequestsFromList } = await import("../scripts/releaseNotes");
    expect(resolvedRequestsFromList({ list_metadata: { schema: [] } }, [row("R1", "s_done")], new Set())).toEqual([]);
  });
});

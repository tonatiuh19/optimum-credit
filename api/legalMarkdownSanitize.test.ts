import { describe, expect, it } from "vitest";
import { sanitizeLegalMarkdown } from "../shared/sanitizeLegalMarkdown";

describe("sanitizeLegalMarkdown", () => {
  it("strips source / extracted meta blockquotes", () => {
    const md = `> Source: https://example.com
> Extracted for reference in the Optimum Credit app.

## Money-Back Guarantee

Body text here.`;
    const out = sanitizeLegalMarkdown(md);
    expect(out).not.toMatch(/Source:/);
    expect(out).not.toMatch(/Extracted for reference/);
    expect(out).toMatch(/Money-Back Guarantee/);
    expect(out).toMatch(/Body text here/);
  });

  it("strips leading H1 (page already shows title)", () => {
    const md = `# Terms of Service

Welcome to Optimum.`;
    expect(sanitizeLegalMarkdown(md)).toBe("Welcome to Optimum.");
  });

  it("strips Runtime source notes", () => {
    const md = `> **Note:** This page is SMS terms
> Runtime source of truth: legal_documents

### 1. Acceptance

Agree to terms.`;
    const out = sanitizeLegalMarkdown(md);
    expect(out).not.toMatch(/Runtime source/);
    expect(out).not.toMatch(/\*\*Note:\*\*/);
    expect(out).toMatch(/Acceptance/);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeLegalMarkdown("")).toBe("");
    expect(sanitizeLegalMarkdown("   \n")).toBe("");
  });
});

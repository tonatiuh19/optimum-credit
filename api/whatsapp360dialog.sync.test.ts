/**
 * Drift guard: api/index.ts inlines pure helpers from api/whatsapp360dialog.ts
 * (Vercel monolith forbids sibling runtime imports).
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  WHATSAPP_360_API_BASE,
  WHATSAPP_DEFAULT_ASSIGNEE_PHONE_LAST10,
  WHATSAPP_MAX_BODY_CHARS,
} from "./whatsapp360dialog";

const indexSrc = fs.readFileSync(path.join(__dirname, "index.ts"), "utf8");

describe("whatsapp360dialog ↔ api/index.ts sync", () => {
  it("keeps constants + gate env names aligned", () => {
    expect(indexSrc).toContain(
      `const WHATSAPP_360_API_BASE = "${WHATSAPP_360_API_BASE}"`,
    );
    expect(indexSrc).toMatch(
      new RegExp(
        `const WHATSAPP_MAX_BODY_CHARS\\s*=\\s*${WHATSAPP_MAX_BODY_CHARS}\\b`,
      ),
    );
    expect(indexSrc).toContain(
      `const WHATSAPP_DEFAULT_ASSIGNEE_PHONE_LAST10 = "${WHATSAPP_DEFAULT_ASSIGNEE_PHONE_LAST10}"`,
    );
    expect(indexSrc).toContain("WHATSAPP_360DIALOG_ENABLED");
    expect(indexSrc).toContain("D360_API_KEY");
    expect(indexSrc).toContain("/api/webhooks/360dialog/whatsapp");
    expect(indexSrc).toContain("parseWhatsapp360WebhookPayload");
    expect(indexSrc).toContain("sendWhatsapp360Text");
    expect(indexSrc).toContain('name: "send_whatsapp"');
    expect(indexSrc).toContain('name: "send_contact_whatsapp"');
    expect(indexSrc).toContain('name: "list_whatsapp"');
    expect(indexSrc).toContain('if (name === "send_wa") return "send_whatsapp"');
  });
});

import { describe, expect, it } from "vitest";
import {
  ensureBrandedEmailHtml,
  tplAdminWorkTaskAssigned,
  tplAdminWorkTaskOverdue,
  tplProgressReportAlerts,
} from "./index";

describe("ensureBrandedEmailHtml", () => {
  it("wraps body fragments in the Optimum emailLayout chrome", () => {
    const html = ensureBrandedEmailHtml({
      title: "Overdue task: Demo",
      html: "<p>Hi Lecca,</p><p>This work task is overdue.</p>",
    });
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain("logo_with_title_white.png");
    expect(html).toContain("Credit Repair, Done Right");
    expect(html).toContain("Optimum Financial Group");
    expect(html).not.toContain("Optimum Credit Repair");
    expect(html).toContain("Hi Lecca");
  });

  it("does not double-wrap full HTML documents", () => {
    const full = `<!DOCTYPE html><html><body><p>Already branded</p></body></html>`;
    const html = ensureBrandedEmailHtml({
      title: "Missed Call",
      html: full,
    });
    expect(html).toBe(full);
    expect(html.match(/<!DOCTYPE html>/gi)?.length).toBe(1);
  });

  it("does not double-wrap emailLayout output", () => {
    const once = ensureBrandedEmailHtml({
      title: "Task",
      html: "<p>body</p>",
    });
    const twice = ensureBrandedEmailHtml({
      title: "Task",
      html: once,
    });
    expect(twice).toBe(once);
    expect((twice.match(/logo_with_title_white\.png/g) || []).length).toBe(1);
  });

  it("uses Spanish chrome when lang=es", () => {
    const html = ensureBrandedEmailHtml({
      title: "Alerta",
      html: "<p>Hola</p>",
      lang: "es",
    });
    expect(html).toContain("Reparación de Crédito, Bien Hecha");
    expect(html).toContain("Optimum Financial Group");
    expect(html).toContain('lang="es"');
  });
});

describe("tplProgressReportAlerts", () => {
  it("renders human-readable alert cards without raw type codes", () => {
    const tpl = tplProgressReportAlerts({
      clientName: "Alex Gomez",
      round: 3,
      linkUrl: "https://example.test/admin/pipeline?client=1",
      alerts: [
        {
          type: "personal_info_mismatch",
          severity: "warning",
          title: "Name not found on report",
          detail:
            'Client name "Alex Gomez" was not found in the after report text.',
        },
      ],
    });
    expect(tpl.subject).toContain("Alex Gomez");
    expect(tpl.html).toMatch(/<strong>1<\/strong> alert for/);
    expect(tpl.html).not.toContain("alert(s)");
    expect(tpl.html).not.toContain("[personal_info_mismatch]");
    expect(tpl.html).toContain("Personal info mismatch");
    expect(tpl.html).toContain("Name not found on report");
    expect(tpl.html).toContain("Open client");
    const branded = ensureBrandedEmailHtml({
      title: tpl.subject,
      html: tpl.html,
    });
    expect(branded).toContain("Optimum Financial Group");
    expect(branded).toContain("#C0A06A");
  });

  it("pluralizes and supports Spanish", () => {
    const tpl = tplProgressReportAlerts({
      clientName: "Maria",
      round: 1,
      lang: "es",
      linkUrl: "https://example.test/x",
      alerts: [
        {
          type: "utilization_increase",
          severity: "critical",
          title: "Utilizacion subio",
          detail: "+12pp",
        },
        {
          type: "hard_inquiry_open",
          severity: "warning",
          title: "Inquiry",
          detail: "Still open",
        },
      ],
    });
    expect(tpl.html).toMatch(/<strong>2<\/strong> alertas/);
    expect(tpl.html).toContain("Abrir cliente");
    expect(tpl.html).toContain("Aumento de utilización");
  });
});

describe("tplAdminWorkTask*", () => {
  it("overdue template is branded with CTA button", () => {
    const tpl = tplAdminWorkTaskOverdue({
      adminFirstName: "Lecca",
      title: "URGENT: use the OFG platform for everything going forward.",
      dueAt: "2026-08-31T12:00:00.000Z",
      linkUrl: "https://example.test/admin/my-tasks",
    });
    expect(tpl.subject).toMatch(/^Overdue task:/);
    expect(tpl.html).toContain("logo_with_title_white.png");
    expect(tpl.html).toContain("Open My Tasks");
    expect(tpl.html).toContain("URGENT: use the OFG platform");
  });

  it("escapes HTML in task titles", () => {
    const tpl = tplAdminWorkTaskOverdue({
      adminFirstName: "<b>X</b>",
      title: `<img src=x onerror=alert(1)>`,
      dueAt: new Date().toISOString(),
      linkUrl: "https://example.test/admin/my-tasks",
    });
    expect(tpl.html).not.toContain("<img src=x");
    expect(tpl.html).toContain("&lt;img");
    expect(tpl.html).toContain("&lt;b&gt;X&lt;/b&gt;");
  });

  it("assigned template supports Spanish", () => {
    const tpl = tplAdminWorkTaskAssigned({
      adminFirstName: "Angel",
      title: "Verificar onboarding",
      linkUrl: "https://example.test/admin/my-tasks",
      lang: "es",
    });
    expect(tpl.subject).toMatch(/^Tarea asignada:/);
    expect(tpl.html).toContain("Abrir Mis Tareas");
    expect(tpl.html).toContain("Reparación de Crédito, Bien Hecha");
  });
});

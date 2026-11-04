/**
 * Engine Spec v1 PR-P0-1: the wizard shows account-level read status and only
 * unlocks Preview / Publish when both reads are ready.
 */
import { describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import { Provider } from "react-redux";

vi.mock("@/lib/api", async (orig) => {
  const real: any = await orig();
  const pending = () => new Promise(() => {});
  return { ...real, default: { get: pending, post: pending, put: pending, patch: pending, delete: pending, interceptors: real.default.interceptors } };
});

import { renderWithProviders } from "@/test/renderWithProviders";
import { configureStore } from "@reduxjs/toolkit";
import reportWizard, { fetchWizardReads, type WizardReadsStatus } from "@/store/slices/reportWizardSlice";
import { ProgressReadsCard } from "@/components/admin/ProgressReadsCard";

const status = (o: Partial<WizardReadsStatus>): WizardReadsStatus => ({
  ready: false,
  reads: { before: { status: "ready", error: null, reused: true }, after: { status: "reading", error: null, reused: false } },
  blocked_data_integrity: null,
  report_dates: { before: "09/08/2026", after: null },
  ...o,
});

function setup(s: WizardReadsStatus) {
  const store = configureStore({ reducer: { reportWizard } });
  const view = renderWithProviders(
    <Provider store={store}>
      <ProgressReadsCard sessionId={7} />
    </Provider>,
  );
  act(() => {
    store.dispatch({ type: fetchWizardReads.fulfilled.type, payload: s, meta: { arg: 7 } });
  });
  return { store, ...view };
}

describe("ProgressReadsCard", () => {
  it("reading: shows both pulls, the reused Before and its report date", () => {
    setup(status({}));
    const card = screen.getByTestId("progress-reads-card");
    expect(card.textContent).toMatch(/Reading both reports/);
    expect(card.textContent).toMatch(/Before · ready · reused from the prior round · report date 09\/08\/2026/);
    expect(card.textContent).toMatch(/After · reading/);
  });

  it("failed read surfaces the reason (needs review)", () => {
    setup(status({ reads: { before: { status: "ready", error: null, reused: false }, after: { status: "failed", error: "Claude error: no message", reused: false } } }));
    expect(screen.getByTestId("progress-reads-card").textContent).toMatch(/failed — needs review.*Claude error: no message/);
  });

  it("identical pulls: blocked (data integrity)", () => {
    setup(status({ blocked_data_integrity: "Before and After have the same report date (08/06/2026)" }));
    const card = screen.getByTestId("progress-reads-card");
    expect(card.textContent).toMatch(/Blocked: data integrity/);
    expect(card.textContent).toMatch(/same report date \(08\/06\/2026\)\. Upload the correct After pull/);
  });

  it("ready: compact confirmation, Preview unlocks", () => {
    const { store } = setup(status({ ready: true, reads: { before: { status: "ready", error: null, reused: false }, after: { status: "ready", error: null, reused: false } } }));
    expect(screen.getByTestId("progress-reads-ready").textContent).toMatch(/ready to preview/);
    expect(store.getState().reportWizard.reads?.ready).toBe(true);
  });

  it("incomplete SmartCredit print: re-save steps + Start over", () => {
    const err = "This PDF was saved before SmartCredit finished loading the accounts (8 of 11 pages are empty).";
    setup(status({ reads: { before: { status: "ready", error: null, reused: false }, after: { status: "failed", error: err, reused: false, code: "incomplete_print" } } }));
    const card = screen.getByTestId("progress-reads-incomplete");
    expect(card.textContent).toMatch(/After PDF is incomplete — SmartCredit was still loading/);
    expect(card.textContent).toMatch(/wait until every account is visible/);
    expect(screen.queryByTestId("progress-reads-start-over")).toBeNull(); // no handler passed
  });

  it("one side failed while the other still reads: keeps polling (no frozen \"reading…\")", () => {
    const clear = vi.spyOn(window, "clearInterval");
    setup(status({ reads: { before: { status: "reading", error: null, reused: false }, after: { status: "failed", error: "x", reused: false, code: "incomplete_print" } } }));
    expect(clear).not.toHaveBeenCalled();
    clear.mockRestore();
  });

  // Score update (Oct 28, 2026)
  const incompleteAfter = { before: { status: "ready" as const, error: null, reused: false }, after: { status: "failed" as const, error: "8 of 11 pages are empty", reused: false, code: "incomplete_print" as const } };

  it("incomplete print: offers a Score update only when the server says it is available", () => {
    setup(status({ reads: incompleteAfter, score_update: false, score_update_available: true, incomplete_sides: ["after"] }));
    expect(screen.getByTestId("score-update-enable").textContent).toMatch(/Send a Score update instead/);
  });

  it("incomplete print without availability (other side still reading / failed): no Score update button", () => {
    setup(status({ reads: incompleteAfter, score_update: false, score_update_available: false }));
    expect(screen.queryByTestId("score-update-enable")).toBeNull();
    expect(screen.getByTestId("progress-reads-incomplete")).toBeTruthy();
  });

  it("Score update mode: explains it, never shows the re-save error card, offers the switch back", () => {
    setup(status({ ready: true, reads: incompleteAfter, score_update: true, score_update_available: true, incomplete_sides: ["after"] }));
    const card = screen.getByTestId("progress-reads-score-update");
    expect(card.textContent).toMatch(/Score update/);
    expect(card.textContent).toMatch(/No account results/);
    expect(card.textContent).toMatch(/never reused/);
    expect(screen.queryByTestId("progress-reads-incomplete")).toBeNull();
    expect(screen.getByTestId("score-update-switch-full")).toBeTruthy();
  });

  it("Score update mode but both reads complete: tells staff to switch back to the full report", () => {
    setup(status({ ready: false, reads: { before: { status: "ready", error: null, reused: false }, after: { status: "ready", error: null, reused: false } }, score_update: true, score_update_available: false }));
    expect(screen.getByTestId("progress-reads-score-update").textContent).toMatch(/Both reports are complete now/);
  });

  it("Spanish copy", async () => {
    const { i18n } = await import("react-i18next").then((m) => ({ i18n: (m as any).getI18n?.() }));
    if (!i18n) return;
    await act(async () => {
      await i18n.changeLanguage("es");
    });
    try {
      setup(status({ reads: incompleteAfter, score_update: false, score_update_available: true }));
      expect(screen.getByTestId("score-update-enable").textContent).toMatch(/actualización de puntaje/);
    } finally {
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    }
  });
});

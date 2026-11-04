/**
 * Score update (Oct 28, 2026) in the wizard slice: the upload offer appears only
 * when the server says an incomplete print can continue as a Score update, the
 * request carries score_update only when chosen, and switching clears a stale preview.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";

const { post, get } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/lib/api", async (orig) => {
  const real: any = await orig();
  return { ...real, default: { get, post, put: vi.fn(), patch: vi.fn(), delete: vi.fn(), interceptors: real.default.interceptors } };
});

import reportWizard, { createReportWizardSession, setReportWizardScoreUpdate, setScoreUpdateOffer } from "@/store/slices/reportWizardSlice";

const store = () => configureStore({ reducer: { reportWizard } });
const after = () => new File([new Uint8Array([37, 80, 68, 70])], "a.pdf", { type: "application/pdf" });
const reject = (status: number, data: Record<string, unknown>) => Object.assign(new Error("x"), { response: { status, data } });
const args = (scoreUpdate = false) => ({ caseId: 3, roundNumber: 2, afterPdf: after(), reuseBeforeSessionId: 11, options: scoreUpdate ? { score_update: true } : {} });

beforeEach(() => {
  post.mockReset();
});

describe("upload offer", () => {
  it("incomplete print (score_update_available) → offer shown with the server's message", async () => {
    post.mockRejectedValueOnce(reject(422, { code: "incomplete_print", error: "After PDF: 12 of 18 pages are empty", score_update_available: true }));
    const s = store();
    await s.dispatch(createReportWizardSession(args()));
    expect(s.getState().reportWizard.scoreUpdateOffer).toBe(true);
    expect(s.getState().reportWizard.error).toMatch(/12 of 18 pages/);
  });

  it.each([
    ["same file", { code: "same_file", error: "same", score_update_available: false }],
    ["round validation", { error: "Round 2 already has a published report" }],
  ])("%s → no offer", async (_n, data) => {
    post.mockRejectedValueOnce(reject(422, data));
    const s = store();
    await s.dispatch(createReportWizardSession(args()));
    expect(s.getState().reportWizard.scoreUpdateOffer).toBe(false);
  });

  it("a new attempt clears the offer; score_update is sent only when chosen", async () => {
    const s = store();
    s.dispatch(setScoreUpdateOffer(true));
    post.mockResolvedValueOnce({ data: { session: { id: 5, status: "review", options_json: { score_update: true } } } });
    await s.dispatch(createReportWizardSession(args(true)));
    expect(s.getState().reportWizard.scoreUpdateOffer).toBe(false);
    const fd = post.mock.calls[0][1] as FormData;
    expect(fd.get("score_update")).toBe("true");

    post.mockRejectedValueOnce(reject(400, { error: "x" }));
    await s.dispatch(createReportWizardSession(args(false)));
    expect((post.mock.calls[1][1] as FormData).get("score_update")).toBeNull();
  });
});

describe("switching a draft", () => {
  it("success replaces the session and drops the stale preview; failure surfaces the reason", async () => {
    const s = store();
    post.mockResolvedValueOnce({ data: { session: { id: 5, status: "review", options_json: { score_update: true } } } });
    await s.dispatch(setReportWizardScoreUpdate({ sessionId: 5, enabled: true }));
    expect(post).toHaveBeenCalledWith("/admin/report-wizard/sessions/5/score-update", { enabled: true });
    expect(s.getState().reportWizard.session?.options_json?.score_update).toBe(true);
    expect(s.getState().reportWizard.previewUrl).toBeNull();
    expect(s.getState().reportWizard.switchingScoreUpdate).toBe(false);

    post.mockRejectedValueOnce(reject(422, { code: "score_update_not_needed", error: "No report is flagged as incomplete" }));
    await s.dispatch(setReportWizardScoreUpdate({ sessionId: 5, enabled: true }));
    expect(s.getState().reportWizard.error).toMatch(/No report is flagged/);
  });
});

describe("review scores from the reads + starting point", () => {
  const scoresSession = { id: 5, status: "review", extraction_meta: {}, reviewed_json: null, extracted_json: { bureauScores: { transunion: { before: 0, after: 0 }, experian: { before: 0, after: 0 }, equifax: { before: 655, after: 694 } }, middleScore: { before: 655, after: 694 } } };
  const payload = (o = {}) => ({ ready: true, reads: {}, blocked_data_integrity: null, report_dates: {}, scores_from_reads: true, read_scores: { before: { TU: 655, EX: 670, EQ: null }, after: { TU: 694, EX: 673, EQ: null } }, ...o });
  const loaded = async (session: unknown) => {
    const s = store();
    post.mockResolvedValueOnce({ data: { session } });
    await s.dispatch(createReportWizardSession(args()));
    return s;
  };
  const reads = { type: "reportWizard/reads/fulfilled", meta: { arg: 5 } };

  it("an open draft gets the read scores once; a missing bureau is empty, not shifted", async () => {
    const s = await loaded(scoresSession);
    s.dispatch({ ...reads, payload: payload() });
    const d = s.getState().reportWizard.session!.extracted_json!;
    expect(d.bureauScores).toEqual({ transunion: { before: 655, after: 694 }, experian: { before: 670, after: 673 }, equifax: { before: 0, after: 0 } });
    expect(d.middleScore).toEqual({ before: 0, after: 0 }); // "--": a middle needs all three bureaus
  });

  it("a draft already synced keeps staff edits on later polls", async () => {
    const s = await loaded({ ...scoresSession, extraction_meta: { scores_from_reads: "x" } });
    s.dispatch({ ...reads, payload: payload() });
    expect(s.getState().reportWizard.session!.extracted_json!.bureauScores.equifax.after).toBe(694);
  });

  it("the upload sends starting_point only when chosen", async () => {
    post.mockRejectedValueOnce(reject(400, { error: "x" }));
    await store().dispatch(createReportWizardSession({ caseId: 3, roundNumber: 1, afterPdf: after(), options: { starting_point: true } }));
    expect((post.mock.calls[0][1] as FormData).get("starting_point")).toBe("true");
    expect((post.mock.calls[0][1] as FormData).get("before_pdf")).toBeNull();
  });
});


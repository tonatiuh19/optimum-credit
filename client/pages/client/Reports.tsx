import { useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Share2,
  FileText,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchDashboard } from "@/store/slices/portalSlice";
import api from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  canSharePdfFile,
  deliverPdfBlob,
  readBlobErrorMessage,
} from "@/lib/deliverPdfBlob";
import { parsePortalDualList } from "@/lib/reportCompareMode";
import { logger } from "@/utils/logger";
import { isAxiosError } from "axios";

export default function Reports() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const dispatch = useAppDispatch();
  const { reports, loading } = useAppSelector((s) => s.portal);
  const [pdfLoading, setPdfLoading] = useState<Record<number, boolean>>({});
  const shareCapable = canSharePdfFile();

  const handleDownloadPdf = async (pdfId: number, fileName: string) => {
    setPdfLoading((prev) => ({ ...prev, [pdfId]: true }));
    try {
      const resp = await api.get(`/portal/round-report-pdfs/${pdfId}`, {
        responseType: "blob",
      });
      const data = resp.data as Blob;
      // API errors with responseType:blob still return a Blob body.
      if (data.type && data.type.includes("json")) {
        const msg = await readBlobErrorMessage(
          data,
          t("reports.downloadPdfError"),
        );
        throw new Error(msg);
      }
      const result = await deliverPdfBlob({ blob: data, fileName });
      if (result === "shared") {
        toast({
          title: t("reports.downloadPdfShared"),
          description: fileName,
        });
      } else if (result === "opened") {
        toast({
          title: t("reports.downloadPdfOpened"),
          description: t("reports.downloadPdfOpenedHint"),
        });
      } else {
        toast({
          title: t("reports.downloadPdfSaved"),
          description: fileName,
        });
      }
    } catch (e: unknown) {
      logger.error("[portal:reports] pdf deliver", e);
      let msg = t("reports.downloadPdfError");
      if (isAxiosError(e) && e.response?.data) {
        msg = await readBlobErrorMessage(e.response.data, msg);
      } else if (e instanceof Error && e.message && e.message !== "pdf_deliver_failed") {
        msg = e.message;
      }
      toast({ title: msg, variant: "destructive" });
    } finally {
      setPdfLoading((prev) => ({ ...prev, [pdfId]: false }));
    }
  };

  useEffect(() => {
    dispatch(fetchDashboard());
  }, [dispatch]);

  const sortedReports = [...reports].sort(
    (a: any, b: any) => a.round_number - b.round_number,
  );
  const totalRemoved = reports.reduce(
    (acc: number, r: any) => acc + (r.items_removed || 0),
    0,
  );
  const latestScore =
    sortedReports.length > 0
      ? sortedReports[sortedReports.length - 1]?.score_after
      : null;
  const firstScore =
    sortedReports.length > 0 ? sortedReports[0]?.score_before : null;
  const scoreDelta =
    latestScore && firstScore ? latestScore - firstScore : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t("reports.heading")}</h1>
        <p className="text-muted-foreground mt-1">{t("reports.subheading")}</p>
      </div>

      {loading && reports.length === 0 ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="bg-card rounded-2xl border border-border h-40 animate-pulse"
            />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-7 h-7 text-primary" />
          </div>
          <h3 className="font-semibold text-lg mb-2">{t("reports.empty")}</h3>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            {t("reports.emptyNote")}
          </p>
        </div>
      ) : (
        <>
          {/* Summary bar — lifetime / since-start */}
          {reports.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("reports.lifetimeProgress")}
              </p>
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    {t("reports.totalRemoved")}
                  </div>
                  <div className="text-3xl font-bold text-accent">
                    {totalRemoved}
                  </div>
                </div>
                <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    {t("reports.roundsCompleted")}
                  </div>
                  <div className="text-3xl font-bold">{reports.length}</div>
                </div>
                <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                    {t("reports.scoreChange")}
                  </div>
                  <div className="text-3xl font-bold flex items-center gap-1.5">
                    {scoreDelta === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : scoreDelta > 0 ? (
                      <>
                        <TrendingUp className="w-6 h-6 text-accent" />
                        <span className="text-accent">+{scoreDelta}</span>
                      </>
                    ) : scoreDelta < 0 ? (
                      <>
                        <TrendingDown className="w-6 h-6 text-destructive" />
                        <span className="text-destructive">{scoreDelta}</span>
                      </>
                    ) : (
                      <>
                        <Minus className="w-6 h-6 text-muted-foreground" />
                        <span>0</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Score progression bar chart */}
          {sortedReports.some((r: any) => r.score_before || r.score_after) && (
            <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
              <h2 className="font-semibold mb-5">{t("reports.chartTitle")}</h2>
              <div className="flex items-end gap-3 h-28 overflow-x-auto pb-1">
                {sortedReports.map((r: any) => {
                  const max = Math.max(
                    ...sortedReports.flatMap((x: any) => [
                      x.score_before || 0,
                      x.score_after || 0,
                    ]),
                    850,
                  );
                  const min = Math.min(
                    ...sortedReports.flatMap((x: any) => [
                      x.score_before || 850,
                      x.score_after || 850,
                    ]),
                    300,
                  );
                  const range = max - min || 1;
                  const beforeH = r.score_before
                    ? Math.max(8, ((r.score_before - min) / range) * 100)
                    : 0;
                  const afterH = r.score_after
                    ? Math.max(8, ((r.score_after - min) / range) * 100)
                    : 0;
                  return (
                    <div
                      key={r.id}
                      className="flex-1 min-w-[56px] flex flex-col items-center gap-1.5"
                    >
                      <div className="flex items-end gap-1 h-24 w-full">
                        {r.score_before ? (
                          <div
                            className="flex-1 rounded-t-md bg-primary/30 transition-all"
                            style={{ height: `${beforeH}%` }}
                            title={`${t("reports.before")}: ${r.score_before}`}
                          />
                        ) : null}
                        {r.score_after ? (
                          <div
                            className="flex-1 rounded-t-md bg-accent transition-all"
                            style={{ height: `${afterH}%` }}
                            title={`${t("reports.after")}: ${r.score_after}`}
                          />
                        ) : null}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-medium whitespace-nowrap">
                        {t("reports.roundLabel", { n: r.round_number })}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-primary/30 inline-block" />
                  {t("reports.before")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-accent inline-block" />
                  {t("reports.after")}
                </span>
              </div>
            </div>
          )}

          {/* Round cards */}
          <div className="space-y-4">
            {[...reports]
              .sort((a: any, b: any) => b.round_number - a.round_number)
              .map((r: any) => {
                const dualWins = parsePortalDualList(r.wins_json);
                const dualTargets = parsePortalDualList(r.targets_json);
                const sinceWins = dualWins.sinceEnrollment;
                const thisWins = dualWins.thisRound;
                const sinceTargets = dualTargets.sinceEnrollment;
                const thisTargets = dualTargets.thisRound;
                const winsDual =
                  dualWins.compareMode != null &&
                  thisWins.length !== sinceWins.length;
                const targetsDual =
                  dualTargets.compareMode != null &&
                  thisTargets.length !== sinceTargets.length;
                const primaryWins =
                  sinceWins.length > 0 ? sinceWins : thisWins;
                const primaryTargets =
                  sinceTargets.length > 0 ? sinceTargets : thisTargets;

                return (
                <div
                  key={r.id}
                  className="bg-card rounded-2xl border border-border p-6 shadow-sm"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-bold text-primary">
                          R{r.round_number}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-semibold">
                          {t("reports.roundLabel", { n: r.round_number })}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleDateString(undefined, {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                        {(() => {
                          const m = String(r.summary_md || "").match(
                            /Report dates:\s*\*?\*?([0-9]{4}-[0-9]{2}-[0-9]{2})\*?\*?\s*→\s*\*?\*?([0-9]{4}-[0-9]{2}-[0-9]{2})/i,
                          );
                          if (!m) return null;
                          return (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {t("reports.reportPeriod")}: {m[1]} → {m[2]}
                            </p>
                          );
                        })()}
                      </div>
                    </div>
                    {r.score_before && r.score_after && (
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">
                          {t("reports.score")}
                        </div>
                        <div className="font-semibold text-sm">
                          <span className="text-muted-foreground">
                            {r.score_before}
                          </span>
                          {" → "}
                          <span className="text-accent">{r.score_after}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {r.report_kind === "score_update" && (
                    <div
                      className="mb-4 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-foreground"
                      data-testid="portal-score-update-note"
                    >
                      <span className="font-semibold text-primary">{t("reports.scoreUpdateTitle")}</span>{" "}
                      {t("reports.scoreUpdateBody")}
                    </div>
                  )}

                  {r.report_kind === "score_update" && (
                    <div
                      className="mb-4 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-foreground"
                      data-testid="portal-score-update-note"
                    >
                      <span className="font-semibold text-primary">{t("reports.scoreUpdateTitle")}</span>{" "}
                      {t("reports.scoreUpdateBody")}
                    </div>
                  )}

                  {parseBureauScores(r.bureau_scores_json) && (
                    <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
                      {(
                        [
                          ["TU", "transunion"],
                          ["EX", "experian"],
                          ["EQ", "equifax"],
                        ] as const
                      ).map(([label, key]) => {
                        const b = parseBureauScores(r.bureau_scores_json)![key];
                        return (
                          <div
                            key={key}
                            className="rounded-lg border border-border bg-muted/20 px-2 py-1.5"
                          >
                            <div className="font-semibold text-muted-foreground">
                              {label}
                            </div>
                            <div>
                              {b.before || t("reports.noScore")} →{" "}
                              <span className="text-accent font-medium">
                                {b.after || t("reports.noScore")}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {r.file_strength_score != null && (
                    <p className="text-xs text-muted-foreground mb-3">
                      {t("reports.fileStrength")}:{" "}
                      <span className="font-semibold text-foreground">
                        {r.file_strength_score}/100
                      </span>
                    </p>
                  )}

                  {primaryWins.length > 0 ? (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        {dualWins.compareMode != null
                          ? t("reports.sinceEnrollmentWins")
                          : t("reports.wins")}
                      </p>
                      <ul className="text-sm space-y-1.5">
                        {primaryWins.map((w, i) => (
                          <li
                            key={i}
                            className="flex flex-wrap items-center gap-2 text-accent"
                          >
                            <span>
                              ✓{" "}
                              {w.itemRemoved ||
                                w.item ||
                                t("reports.itemRemovedFallback")}
                            </span>
                            {Array.isArray(w.bureaus) && w.bureaus.length > 0 && (
                              <span className="inline-flex gap-0.5">
                                {w.bureaus.map((b) => (
                                  <span
                                    key={b}
                                    className="text-[9px] font-bold px-1 py-0.5 rounded bg-accent/15 text-accent"
                                  >
                                    {b}
                                  </span>
                                ))}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {winsDual && thisWins.length > 0 ? (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        {t("reports.thisRoundWins")}
                      </p>
                      <ul className="text-sm space-y-1.5">
                        {thisWins.map((w, i) => (
                          <li
                            key={i}
                            className="flex flex-wrap items-center gap-2 text-foreground"
                          >
                            <span>
                              ✓{" "}
                              {w.itemRemoved ||
                                w.item ||
                                t("reports.itemRemovedFallback")}
                            </span>
                            {Array.isArray(w.bureaus) && w.bureaus.length > 0 && (
                              <span className="inline-flex gap-0.5">
                                {w.bureaus.map((b) => (
                                  <span
                                    key={b}
                                    className="text-[9px] font-bold px-1 py-0.5 rounded bg-muted text-muted-foreground"
                                  >
                                    {b}
                                  </span>
                                ))}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {primaryTargets.length > 0 ? (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        {t("reports.stillWorking")}
                      </p>
                      <ul className="text-sm space-y-1 text-muted-foreground">
                        {primaryTargets.map((tgt, i) => (
                          <li key={i}>
                            • {tgt.item || t("reports.targetFallback")}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {targetsDual && thisTargets.length > 0 ? (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        {t("reports.thisRoundTargets")}
                      </p>
                      <ul className="text-sm space-y-1 text-muted-foreground">
                        {thisTargets.map((tgt, i) => (
                          <li key={i}>
                            • {tgt.item || t("reports.targetFallback")}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    <RoundStat
                      label={t("reports.itemsRemoved")}
                      value={
                        dualWins.compareMode != null
                          ? sinceWins.length || r.items_removed || 0
                          : r.items_removed || 0
                      }
                      accent
                    />
                    {winsDual ? (
                      <RoundStat
                        label={t("reports.thisRoundDelta")}
                        value={thisWins.length}
                      />
                    ) : (
                      <RoundStat
                        label={t("reports.itemsDisputed")}
                        value={r.items_disputed ?? "—"}
                      />
                    )}
                    <RoundStat
                      label={t("reports.scoreBefore")}
                      value={r.score_before || "—"}
                    />
                    <RoundStat
                      label={t("reports.scoreAfter")}
                      value={r.score_after || "—"}
                      accent
                    />
                  </div>

                  {r.summary_md && (
                    <div className="border-t border-border pt-4 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {r.summary_md}
                    </div>
                  )}

                  {/* PDF attachments list */}
                  {Array.isArray(r.pdfs) && r.pdfs.length > 0 && (
                    <div className="border-t border-border pt-4 space-y-2">
                      <div className="flex items-baseline justify-between gap-2 mb-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          {t("reports.downloadPdf")}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {shareCapable
                            ? t("reports.downloadPdfShareHint")
                            : t("reports.downloadPdfOpenHint")}
                        </p>
                      </div>
                      {r.pdfs.map((pdf: any) => (
                        <button
                          key={pdf.id}
                          type="button"
                          onClick={() =>
                            handleDownloadPdf(pdf.id, pdf.file_name)
                          }
                          disabled={pdfLoading[pdf.id]}
                          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-border bg-muted/30 hover:bg-primary/[0.05] hover:border-primary/25 active:scale-[0.99] transition-all group text-left disabled:opacity-60"
                        >
                          <div className="w-8 h-8 rounded-lg bg-destructive/10 border border-destructive/15 flex items-center justify-center shrink-0">
                            {pdfLoading[pdf.id] ? (
                              <Loader2 className="w-3.5 h-3.5 text-destructive animate-spin" />
                            ) : (
                              <FileText className="w-3.5 h-3.5 text-destructive" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                              {pdf.file_name}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {new Date(pdf.uploaded_at).toLocaleDateString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                },
                              )}
                              {" · "}
                              {shareCapable
                                ? t("reports.downloadPdfShareAction")
                                : t("reports.downloadPdfOpenAction")}
                            </p>
                          </div>
                          {shareCapable ? (
                            <Share2 className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                          ) : (
                            <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}

function parseBureauScores(raw: unknown) {
  if (!raw) return null;
  try {
    const data = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!data?.transunion) return null;
    return data as {
      transunion: { before: number; after: number };
      experian: { before: number; after: number };
      equifax: { before: number; after: number };
    };
  } catch {
    return null;
  }
}

function RoundStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground tracking-wide">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${accent ? "text-accent" : ""}`}>
        {value}
      </div>
    </div>
  );
}

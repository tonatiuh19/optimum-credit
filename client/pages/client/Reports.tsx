import { useEffect } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchDashboard } from "@/store/slices/portalSlice";

export default function Reports() {
  const dispatch = useAppDispatch();
  const { reports, loading } = useAppSelector((s) => s.portal);

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
        <h1 className="text-3xl font-bold">Progress Reports</h1>
        <p className="text-muted-foreground mt-1">
          Detailed breakdown of every dispute round.
        </p>
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
          <h3 className="font-semibold text-lg mb-2">No reports yet</h3>
          <p className="text-muted-foreground text-sm max-w-sm mx-auto">
            Your first round summary will appear here once we complete your
            initial dispute round.
          </p>
        </div>
      ) : (
        <>
          {/* Summary bar */}
          {reports.length > 0 && (
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Total Items Removed
                </div>
                <div className="text-3xl font-bold text-accent">
                  {totalRemoved}
                </div>
              </div>
              <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Rounds Completed
                </div>
                <div className="text-3xl font-bold">{reports.length}</div>
              </div>
              <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Score Change
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
          )}

          {/* Score progression bar chart */}
          {sortedReports.some((r: any) => r.score_before || r.score_after) && (
            <div className="bg-card rounded-2xl border border-border p-6 shadow-sm">
              <h2 className="font-semibold mb-5">Credit Score Progression</h2>
              <div className="flex items-end gap-3 h-28 overflow-x-auto pb-1">
                {sortedReports.map((r: any, i: number) => {
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
                            title={`Before: ${r.score_before}`}
                          />
                        ) : null}
                        {r.score_after ? (
                          <div
                            className="flex-1 rounded-t-md bg-accent transition-all"
                            style={{ height: `${afterH}%` }}
                            title={`After: ${r.score_after}`}
                          />
                        ) : null}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-medium whitespace-nowrap">
                        Rd {r.round_number}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-primary/30 inline-block" />
                  Before
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-accent inline-block" />
                  After
                </span>
              </div>
            </div>
          )}

          {/* Round cards */}
          <div className="space-y-4">
            {[...reports]
              .sort((a: any, b: any) => b.round_number - a.round_number)
              .map((r: any) => (
                <div
                  key={r.id}
                  className="bg-card rounded-2xl border border-border p-6 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                        <span className="text-sm font-bold text-primary">
                          R{r.round_number}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-semibold">
                          Round {r.round_number}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                    </div>
                    {r.score_before && r.score_after && (
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">
                          Score
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

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    <RoundStat
                      label="Items Removed"
                      value={r.items_removed || 0}
                      accent
                    />
                    <RoundStat
                      label="Items Disputed"
                      value={r.items_disputed || 0}
                    />
                    <RoundStat
                      label="Score Before"
                      value={r.score_before || "—"}
                    />
                    <RoundStat
                      label="Score After"
                      value={r.score_after || "—"}
                      accent
                    />
                  </div>

                  {r.summary_md && (
                    <div className="border-t border-border pt-4 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {r.summary_md}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
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

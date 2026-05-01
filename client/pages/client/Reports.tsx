import { useEffect } from "react";
import { TrendingUp } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchDashboard } from "@/store/slices/portalSlice";

export default function Reports() {
  const dispatch = useAppDispatch();
  const { reports } = useAppSelector((s) => s.portal);

  useEffect(() => {
    dispatch(fetchDashboard());
  }, [dispatch]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Progress Reports</h1>
        <p className="text-muted-foreground mt-1">
          Detailed breakdown of every dispute round.
        </p>
      </div>

      {reports.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-10 text-center">
          <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">
            No reports yet. Your first round summary will show here once we
            complete it.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map((r: any) => (
            <div
              key={r.id}
              className="bg-card rounded-2xl border border-border p-6 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xl font-bold">Round {r.round_number}</h3>
                <span className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
                <Stat
                  label="Items Removed"
                  value={r.items_removed || 0}
                  accent
                />
                <Stat label="Items Disputed" value={r.items_disputed || 0} />
                <Stat label="Score Before" value={r.score_before || "—"} />
                <Stat label="Score After" value={r.score_after || "—"} accent />
              </div>
              {r.summary_md && (
                <div className="prose prose-sm max-w-none border-t border-border pt-4 whitespace-pre-wrap">
                  {r.summary_md}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: any;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent ? "text-accent" : ""}`}>
        {value}
      </div>
    </div>
  );
}

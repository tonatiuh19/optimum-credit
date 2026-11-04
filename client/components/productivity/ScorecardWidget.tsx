import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, Flame, Gauge } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchProductivityAccess, fetchProductivityScorecard, fetchProductivityTeam } from "@/store/slices/productivitySlice";
import { GradeRing } from "@/components/productivity/GradeRing";
import { LEVEL_META, gradeTone } from "@/lib/productivity";

/** Dashboard tile: own live grade (scored staff) or the team's grades (managers). */
export function ScorecardWidget() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { access, card, cardAdminId, team } = useAppSelector((s) => s.productivity);

  useEffect(() => {
    if (!access) void dispatch(fetchProductivityAccess());
  }, [dispatch, access]);
  useEffect(() => {
    if (access?.scored) void dispatch(fetchProductivityScorecard(undefined));
    else if (access?.isManager) void dispatch(fetchProductivityTeam());
  }, [dispatch, access]);

  if (!access?.canView) return null;
  const own = access.scored && cardAdminId == null ? card : null;

  return (
    <Link
      to="/admin/productivity"
      className="group card-base p-4 flex items-center gap-4 transition-all hover:shadow-md hover:-translate-y-0.5 animate-in fade-in"
      data-testid="scorecard-widget"
    >
      {own ? (
        <>
          <GradeRing total={own.today.total} grade={own.today.grade} size={72} label={t("productivity.ringLabel", { grade: own.today.grade ?? "—" })} sublabel="—" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("productivity.widget.title")}</p>
            <p className="text-sm font-semibold text-foreground">
              {own.today.status === "graded" ? t(`productivity.cheer.${own.today.grade}`) : t(`productivity.status.${own.today.status}`)}
            </p>
            <p className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Flame className={`w-3.5 h-3.5 ${own.streak ? "text-accent" : ""}`} /> {own.streak}
              </span>
              <span className={`inline-flex items-center gap-1 ${LEVEL_META[own.level.level].tone}`}>
                {t(`productivity.levels.${own.level.level}`)}
              </span>
            </p>
          </div>
        </>
      ) : (
        <>
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary shrink-0">
            <Gauge className="w-6 h-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("productivity.widget.team")}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {team.map((m) => {
                const tone = gradeTone(m.today.grade);
                return (
                  <span key={m.admin_id} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tone.bg} ${tone.text}`}>
                    {m.name.split(" ")[0]} · {m.today.grade ?? "—"}
                  </span>
                );
              })}
            </div>
          </div>
        </>
      )}
      <ChevronRight className="w-4 h-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

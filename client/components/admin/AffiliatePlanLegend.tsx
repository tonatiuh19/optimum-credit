import { useTranslation } from "react-i18next";
import { Crown, User, Users } from "lucide-react";
import type { AffiliatePlan } from "@shared/api";
import FieldHint from "@/components/admin/FieldHint";
import { cn } from "@/lib/utils";

const PLAN_META: {
  plan: AffiliatePlan;
  icon: typeof User;
  labelKey: string;
  bodyKey: string;
}[] = [
  {
    plan: "standard",
    icon: User,
    labelKey: "affiliates.admin.planStandard",
    bodyKey: "affiliates.plans.standardHelp",
  },
  {
    plan: "master",
    icon: Crown,
    labelKey: "affiliates.admin.planMaster",
    bodyKey: "affiliates.plans.masterHelp",
  },
  {
    plan: "sub_affiliate",
    icon: Users,
    labelKey: "affiliates.admin.planSubAffiliate",
    bodyKey: "affiliates.plans.subHelp",
  },
];

/** Compact legend explaining affiliate plans — free-for-now callout. */
export default function AffiliatePlanLegend({
  highlight,
  className,
  showFreeNote = true,
  /** When set, only these plans are listed (e.g. standard-only rollout). */
  plans,
}: {
  highlight?: AffiliatePlan;
  className?: string;
  showFreeNote?: boolean;
  plans?: AffiliatePlan[];
}) {
  const { t } = useTranslation();
  const rows = plans
    ? PLAN_META.filter((p) => plans.includes(p.plan))
    : PLAN_META;

  return (
    <div className={cn("space-y-2", className)}>
      {showFreeNote && (
        <FieldHint tone="accent">{t("affiliates.plans.freeNowNote")}</FieldHint>
      )}
      <ul className="rounded-xl border border-border bg-card divide-y divide-border/70 overflow-hidden">
        {rows.map(({ plan, icon: Icon, labelKey, bodyKey }) => {
          const active = highlight === plan;
          return (
            <li
              key={plan}
              className={cn(
                "flex items-start gap-2.5 px-3 py-2.5 text-[12px] leading-snug",
                active && "bg-primary/[0.06]",
              )}
            >
              <Icon
                className={cn(
                  "w-3.5 h-3.5 shrink-0 mt-0.5",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              />
              <div className="min-w-0">
                <div
                  className={cn(
                    "font-semibold",
                    active ? "text-foreground" : "text-foreground/90",
                  )}
                >
                  {t(labelKey)}
                  {active && (
                    <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                      {t("affiliates.plans.selected")}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mt-0.5">{t(bodyKey)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

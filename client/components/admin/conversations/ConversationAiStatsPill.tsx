import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bot, PhoneCall, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchConversationsAiStats } from "@/store/slices/conversationsSlice";
import { cn } from "@/lib/utils";

/**
 * How the SMS AI handled texts (last 30 days): share answered on its own,
 * live lookups, callbacks created, and why the rest went to staff.
 */
export function ConversationAiStatsPill() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const stats = useAppSelector((s) => s.conversations.aiStats);

  useEffect(() => {
    void dispatch(fetchConversationsAiStats(30));
  }, [dispatch]);

  if (!stats || stats.resolve_rate == null) return null;
  const rate = stats.resolve_rate;
  const total = stats.answered + stats.escalated;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-full border text-xs font-medium transition-all duration-200 whitespace-nowrap hover:scale-[1.02]",
            rate >= 50 ? "bg-accent/10 border-accent/40 text-accent" : "bg-primary/5 border-primary/30 text-primary",
          )}
          data-testid="conversations-ai-stats"
        >
          <Bot className="w-3.5 h-3.5" />
          {t("conversations.aiStats.pill", { rate })}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 animate-in fade-in zoom-in-95">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("conversations.aiStats.title")}</p>
          <p className="text-xs text-muted-foreground">{t("conversations.aiStats.subtitle", { days: stats.days, total })}</p>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-accent transition-all duration-500" style={{ width: `${rate}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-border px-2 py-1.5">
            <p className="text-muted-foreground">{t("conversations.aiStats.answered")}</p>
            <p className="font-semibold text-foreground">{stats.answered}</p>
          </div>
          <div className="rounded-lg border border-border px-2 py-1.5">
            <p className="text-muted-foreground">{t("conversations.aiStats.toStaff")}</p>
            <p className="font-semibold text-foreground">{stats.escalated}</p>
          </div>
          <div className="rounded-lg border border-border px-2 py-1.5 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-primary" />
            <span>{t("conversations.aiStats.lookups", { count: stats.lookups })}</span>
          </div>
          <div className="rounded-lg border border-border px-2 py-1.5 flex items-center gap-1.5">
            <PhoneCall className="w-3.5 h-3.5 text-primary" />
            <span>{t("conversations.aiStats.callbacks", { count: stats.callbacks })}</span>
          </div>
        </div>
        {stats.escalated_by_reason.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-foreground">{t("conversations.aiStats.whyStaff")}</p>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {stats.escalated_by_reason.slice(0, 6).map((r) => (
                <li key={r.reason} className="flex justify-between gap-2">
                  <span className="truncate">
                    {t(`conversations.aiStats.reason.${r.reason.split(":")[0]}`, { defaultValue: t("conversations.aiStats.reason.other") })}
                  </span>
                  <span className="font-medium text-foreground">{r.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

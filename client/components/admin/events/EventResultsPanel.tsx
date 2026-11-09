import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BellRing, CheckCircle2, DollarSign, Loader2, UserPlus, Users } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchEventResults } from "@/store/slices/eventMarketingSlice";
import { cn } from "@/lib/utils";
import type { EventSessionResult } from "@shared/api";

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function money(cents: number, lang: string): string {
  return (cents / 100).toLocaleString(lang === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Registered → attended → new contact → paying client, per session and in total. */
export function EventResultsPanel({ companyId }: { companyId: number }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { results, resultsLoading, resultsError } = useAppSelector((s) => s.eventMarketing);
  const es = i18n.language?.startsWith("es");

  useEffect(() => {
    void dispatch(fetchEventResults(companyId));
  }, [dispatch, companyId]);

  if (resultsLoading && !results) {
    return (
      <div className="py-10 flex justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (resultsError) {
    return <p className="text-sm text-destructive py-6">{resultsError}</p>;
  }
  if (!results || results.sessions.length === 0) {
    return <p className="text-sm text-muted-foreground py-6">{t("eventMarketing.admin.results.empty")}</p>;
  }

  const tot = results.totals;
  const showRate = pct(tot.attended, tot.attended + tot.no_show);
  const tiles = [
    { key: "registered", icon: Users, value: String(tot.registered) },
    { key: "attended", icon: CheckCircle2, value: String(tot.attended), sub: showRate != null ? `${showRate}% ${t("eventMarketing.admin.results.showRate").toLowerCase()}` : undefined },
    { key: "newContacts", icon: UserPlus, value: String(tot.new_contacts) },
    { key: "paidClients", icon: DollarSign, value: String(tot.paid_clients), sub: money(tot.revenue_cents, i18n.language) },
  ];

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-300" data-testid="event-results">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t("eventMarketing.admin.results.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("eventMarketing.admin.results.subtitle")}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {tiles.map(({ key, icon: Icon, value, sub }) => (
          <div key={key} className="rounded-xl border border-border bg-card p-3 transition-all duration-200 hover:border-primary/40">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className="w-3.5 h-3.5 text-primary" />
              {t(`eventMarketing.admin.results.${key}`)}
            </div>
            <div className="mt-1 text-2xl font-bold text-foreground tabular-nums">{value}</div>
            {sub && <div className="text-xs text-accent font-medium">{sub}</div>}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {results.sessions.map((s) => (
          <SessionResultRow key={String(s.session_id)} s={s} es={!!es} lang={i18n.language} />
        ))}
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground rounded-lg bg-muted/50 px-3 py-2">
        <BellRing className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
        {t("eventMarketing.admin.results.autoNote")}
      </p>
    </div>
  );
}

function SessionResultRow({ s, es, lang }: { s: EventSessionResult; es: boolean; lang: string }) {
  const { t } = useTranslation();
  const seated = s.attended + s.no_show;
  const rate = pct(s.attended, seated);
  const title = s.session_id == null ? t("eventMarketing.admin.results.noSession") : es ? s.title_es : s.title_en;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{title}</div>
          <div className="text-xs text-muted-foreground">
            {s.starts_at ? s.starts_at.replace("T", " ").slice(0, 16) : "—"}
            {s.status ? ` · ${t(`eventMarketing.status.${s.status}`)}` : ""}
          </div>
        </div>
        {s.revenue_cents > 0 && (
          <span className="text-xs font-semibold text-accent">{money(s.revenue_cents, lang)}</span>
        )}
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full transition-all duration-500", rate != null && rate >= 50 ? "bg-accent" : "bg-primary")}
          style={{ width: `${rate ?? 0}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span><b className="text-foreground">{s.registered}</b> {t("eventMarketing.admin.results.registered").toLowerCase()}</span>
        <span><b className="text-foreground">{s.attended}</b> {t("eventMarketing.admin.results.attended").toLowerCase()}{rate != null ? ` (${rate}%)` : ""}</span>
        {s.no_show > 0 && <span><b className="text-foreground">{s.no_show}</b> {t("eventMarketing.admin.results.noShow").toLowerCase()}</span>}
        {s.waitlisted > 0 && <span><b className="text-foreground">{s.waitlisted}</b> {t("eventMarketing.admin.results.waitlisted").toLowerCase()}</span>}
        <span><b className="text-foreground">{s.new_contacts}</b> {t("eventMarketing.admin.results.newContacts").toLowerCase()}</span>
        <span><b className="text-foreground">{s.paid_clients}</b> {t("eventMarketing.admin.results.paidClients").toLowerCase()}</span>
      </div>
    </div>
  );
}

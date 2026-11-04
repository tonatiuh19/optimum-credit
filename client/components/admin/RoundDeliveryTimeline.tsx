import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, ChevronDown, Eye, FileCheck2, Mail, MessageSquare, Repeat2, Send, Users } from "lucide-react";
import type { ReportDeliveryEvent, ReportDeliveryRound } from "@shared/api";

const SMS_OK = new Set(["delivered", "read"]);
const BAD = new Set(["failed", "undelivered"]);

function Chip({ tone, icon: Icon, children, testId }: { tone: "ok" | "info" | "bad" | "muted"; icon: typeof Send; children: React.ReactNode; testId?: string }) {
  const cls = {
    ok: "bg-accent/10 text-accent border-accent/25",
    info: "bg-primary/10 text-primary border-primary/20",
    bad: "bg-destructive/10 text-destructive border-destructive/25",
    muted: "bg-muted text-muted-foreground border-border",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`} data-testid={testId}>
      <Icon className="w-3 h-3" />
      {children}
    </span>
  );
}

/**
 * How a round's progress report reached people: status strip (sent ·
 * delivered/failed · opened) and an expandable timeline — generated, every
 * send to the client and partners (live SMS status), and PDF link opens.
 */
export function RoundDeliveryTimeline({ round }: { round: ReportDeliveryRound | undefined }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!round || round.events.length === 0) return null;
  const s = round.summary;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const describe = (e: ReportDeliveryEvent) => {
    if (e.type === "generated") return { icon: FileCheck2, tone: "info" as const, title: t("reportDelivery.generated"), sub: e.by ? t("reportDelivery.by", { name: e.by }) : null };
    if (e.type === "opened")
      return {
        icon: Eye,
        tone: "ok" as const,
        title: t("reportDelivery.opened", { count: e.open_count ?? 1 }),
        sub: e.first_at ? t("reportDelivery.linkIssued", { date: when(e.first_at) }) : null,
      };
    const who =
      e.recipient_type === "partner"
        ? `${e.recipient_name ?? t("reportDelivery.partner")}${e.recipient_role ? ` · ${t(`reportDelivery.role.${e.recipient_role}`, { defaultValue: e.recipient_role })}` : ""}`
        : t(`reportDelivery.recipient.${e.recipient_type ?? "client"}`, { defaultValue: e.recipient_type ?? "" });
    const bad = BAD.has(String(e.status));
    return {
      icon: e.channel === "sms" ? MessageSquare : Mail,
      tone: bad ? ("bad" as const) : e.channel === "sms" && SMS_OK.has(String(e.status)) ? ("ok" as const) : ("info" as const),
      title: t(`reportDelivery.channel.${e.channel ?? "email"}`, { who }),
      sub: [e.to, e.by ? t("reportDelivery.by", { name: e.by }) : null].filter(Boolean).join(" · "),
    };
  };

  const TONE_DOT = { ok: "bg-accent/15 text-accent border-accent/30", info: "bg-primary/10 text-primary border-primary/25", bad: "bg-destructive/10 text-destructive border-destructive/30" };

  return (
    <div className="rounded-xl border border-border/70 bg-card/60 overflow-hidden" data-testid="round-delivery">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
      >
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
          {s.sends > 0 ? (
            <Chip tone="info" icon={Send} testId="delivery-chip-sent">
              {t("reportDelivery.sentTo", { count: s.recipients })}
            </Chip>
          ) : (
            <Chip tone="muted" icon={Send}>
              {t("reportDelivery.notSent")}
            </Chip>
          )}
          {s.delivered > 0 && (
            <Chip tone="ok" icon={CheckCircle2}>
              {t("reportDelivery.smsDelivered", { count: s.delivered })}
            </Chip>
          )}
          {s.failed > 0 && (
            <Chip tone="bad" icon={AlertTriangle} testId="delivery-chip-failed">
              {t("reportDelivery.failed", { count: s.failed })}
            </Chip>
          )}
          {s.opened > 0 ? (
            <Chip tone="ok" icon={Eye} testId="delivery-chip-opened">
              {t("reportDelivery.openedChip", { count: s.opened })}
            </Chip>
          ) : s.sends > 0 ? (
            <Chip tone="muted" icon={Eye}>
              {t("reportDelivery.notOpened")}
            </Chip>
          ) : null}
        </div>
        <span className="hidden sm:inline text-[10px] text-muted-foreground shrink-0">
          {s.last_sent_at ? t("reportDelivery.lastSent", { date: when(s.last_sent_at) }) : null}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>

      <div className={`grid transition-all duration-300 ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden">
          <ol className="relative mx-3 mb-3 mt-1 space-y-2.5 before:absolute before:left-[0.8rem] before:top-1 before:bottom-1 before:w-px before:bg-border" data-testid="delivery-timeline">
            {round.events.map((e, i) => {
              const d = describe(e);
              return (
                <li key={`${e.type}-${e.at}-${i}`} className="relative flex items-start gap-2.5">
                  <span className={`relative z-10 grid place-items-center w-[1.6rem] h-[1.6rem] rounded-full border shrink-0 ${TONE_DOT[d.tone]}`}>
                    <d.icon className="w-3 h-3" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <span className="text-[11px] font-semibold text-foreground">{d.title}</span>
                      {e.type === "send" && (
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wide ${
                            BAD.has(String(e.status)) ? "text-destructive" : SMS_OK.has(String(e.status)) ? "text-accent" : "text-muted-foreground"
                          }`}
                        >
                          {t(`reportDelivery.status.${e.status}`, { defaultValue: e.status })}
                        </span>
                      )}
                      {e.resend && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-primary">
                          <Repeat2 className="w-2.5 h-2.5" /> {t("reportDelivery.resend")}
                        </span>
                      )}
                      {e.recipient_type === "partner" && <Users className="w-3 h-3 text-muted-foreground" aria-hidden />}
                    </div>
                    {d.sub && <p className="text-[10px] text-muted-foreground truncate">{d.sub}</p>}
                    {e.error && <p className="text-[10px] text-destructive">{e.error}</p>}
                  </div>
                  <time className="text-[10px] text-muted-foreground tabular-nums shrink-0 pt-0.5" dateTime={e.at}>
                    {when(e.at)}
                  </time>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

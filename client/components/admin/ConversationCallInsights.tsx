import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, RefreshCw, Sparkles } from "lucide-react";
import type { ConversationMessage } from "@shared/api";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { retryCallInsights } from "@/store/slices/conversationsSlice";

type Props = {
  message: ConversationMessage;
};

function teaserText(message: ConversationMessage): string {
  const bullets = message.call_insights_json?.summary_bullets;
  if (bullets && bullets.length > 0) {
    return String(bullets[0] || "").trim();
  }
  const transcript = String(message.call_transcript || "").trim();
  if (!transcript) return "";
  return transcript.length > 140 ? `${transcript.slice(0, 140).trim()}…` : transcript;
}

function errorKey(raw: string | null | undefined): string {
  const e = String(raw || "").trim();
  if (!e) return "unknown";
  if (e === "too_short") return "too_short";
  if (e === "missing_openai_stt") return "missing_openai_stt";
  if (e === "stt_empty") return "stt_empty";
  if (e === "awaiting_twilio_transcript") return "awaiting_twilio_transcript";
  if (e === "claude_unavailable" || e === "claude_parse_failed") {
    return "claude_optional";
  }
  if (e.startsWith("anthropic_")) return "claude_optional";
  return "unknown";
}

export default function ConversationCallInsights({ message }: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const retryingId = useAppSelector((s) => s.conversations.retryCallInsightsId);
  const [open, setOpen] = useState(true);
  const status = message.call_insights_status;
  const insights = message.call_insights_json;
  const isVoicemail = !!(
    message.metadata_json &&
    (message.metadata_json as { is_voicemail?: boolean }).is_voicemail
  );
  const teaser = teaserText(message);
  const errCode = message.call_insights_error
    ? errorKey(message.call_insights_error)
    : null;
  const canRetry =
    status === "failed" ||
    status === "skipped" ||
    (status === "ready" &&
      !!message.call_transcript &&
      (!insights || !!message.call_insights_error));
  const retrying = retryingId === message.id;

  if (!status && !insights && !message.call_transcript) return null;

  const sentimentLabel = insights?.sentiment?.label
    ? t(`conversations.callInsights.sentiment.${insights.sentiment.label}`, {
        defaultValue: insights.sentiment.label,
      })
    : null;

  return (
    <div
      className="mt-2 rounded-xl border border-border/70 bg-background/70 text-foreground overflow-hidden"
      data-testid="call-insights"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs font-semibold"
      >
        <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block truncate">
            {t("conversations.callInsights.title")}
            {isVoicemail ? ` · ${t("conversations.callInsights.voicemail")}` : ""}
          </span>
          {!open && teaser ? (
            <span className="block mt-0.5 font-normal text-[11px] text-muted-foreground truncate">
              {teaser}
            </span>
          ) : null}
        </span>
        {status && status !== "ready" && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
            {t(`conversations.callInsights.status.${status}`)}
          </span>
        )}
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 space-y-2 text-xs">
          {status === "pending" || status === "processing" ? (
            <p className="text-muted-foreground leading-relaxed">
              {t("conversations.callInsights.pendingBody")}
            </p>
          ) : null}

          {(status === "failed" || status === "skipped") && (
            <div className="space-y-1.5">
              <p className="text-muted-foreground leading-relaxed">
                {t(
                  `conversations.callInsights.errors.${errCode || "unknown"}`,
                  {
                    defaultValue: t(
                      "conversations.callInsights.unavailableBody",
                    ),
                  },
                )}
              </p>
              {canRetry ? (
                <button
                  type="button"
                  disabled={retrying}
                  onClick={() =>
                    void dispatch(retryCallInsights({ messageId: message.id }))
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-semibold text-foreground",
                    "hover:bg-muted disabled:opacity-60",
                  )}
                >
                  <RefreshCw
                    className={cn("w-3 h-3", retrying && "animate-spin")}
                  />
                  {t("conversations.callInsights.retry")}
                </button>
              ) : null}
            </div>
          )}

          {status === "ready" &&
            message.call_insights_error &&
            !insights?.summary_bullets?.length && (
              <p className="text-muted-foreground leading-relaxed">
                {t("conversations.callInsights.errors.claude_optional")}
              </p>
            )}

          {status === "ready" &&
            message.call_insights_error &&
            canRetry &&
            !insights?.summary_bullets?.length && (
              <button
                type="button"
                disabled={retrying}
                onClick={() =>
                  void dispatch(retryCallInsights({ messageId: message.id }))
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-semibold text-foreground",
                  "hover:bg-muted disabled:opacity-60",
                )}
              >
                <RefreshCw
                  className={cn("w-3 h-3", retrying && "animate-spin")}
                />
                {t("conversations.callInsights.retry")}
              </button>
            )}

          {insights?.summary_bullets && insights.summary_bullets.length > 0 && (
            <ul className="list-disc pl-4 space-y-0.5 text-foreground/90">
              {insights.summary_bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}

          {(sentimentLabel ||
            (insights?.sentiment?.feelings &&
              insights.sentiment.feelings.length > 0)) && (
            <div className="flex flex-wrap gap-1.5 items-center">
              {sentimentLabel && (
                <span className="inline-flex px-1.5 py-0.5 rounded-md bg-accent/15 text-accent-foreground text-[10px] font-semibold uppercase">
                  {sentimentLabel}
                </span>
              )}
              {(insights?.sentiment?.feelings || []).map((f) => (
                <span
                  key={f}
                  className="inline-flex px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px]"
                >
                  {f}
                </span>
              ))}
            </div>
          )}

          {insights?.topics && insights.topics.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">
                {t("conversations.callInsights.topics")}
              </div>
              <p className="text-foreground/90">{insights.topics.join(" · ")}</p>
            </div>
          )}

          {insights?.action_items && insights.action_items.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">
                {t("conversations.callInsights.actions")}
              </div>
              <ul className="list-disc pl-4 space-y-0.5">
                {insights.action_items.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {insights?.risk_flags && insights.risk_flags.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase text-destructive mb-0.5">
                {t("conversations.callInsights.risks")}
              </div>
              <div className="flex flex-wrap gap-1">
                {insights.risk_flags.map((r) => (
                  <span
                    key={r}
                    className="inline-flex px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive text-[10px] font-medium"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {insights?.interesting && insights.interesting.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-0.5">
                {t("conversations.callInsights.interesting")}
              </div>
              <ul className="list-disc pl-4 space-y-0.5">
                {insights.interesting.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}

          {message.call_transcript ? (
            <details className="rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5">
              <summary
                className={cn(
                  "cursor-pointer text-[10px] font-semibold uppercase text-muted-foreground",
                )}
              >
                {t("conversations.callInsights.fullTranscript")}
              </summary>
              <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/90 max-h-40 overflow-y-auto">
                {message.call_transcript}
              </p>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}

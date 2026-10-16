import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, FileText, RefreshCw } from "lucide-react";
import type { ConversationMessage } from "@shared/api";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { retryCallInsights } from "@/store/slices/conversationsSlice";

type Props = {
  message: ConversationMessage;
};

function errorKey(raw: string | null | undefined): string {
  const e = String(raw || "").trim();
  if (!e) return "unknown";
  if (e === "too_short") return "too_short";
  if (e === "missing_openai_stt" || e === "twilio_ai_addendum") {
    return "twilio_ai_addendum";
  }
  if (e === "invalid_recording") return "invalid_recording";
  if (e === "twilio_stt_failed" || e === "twilio_auth_missing") {
    return "twilio_stt_failed";
  }
  if (e === "stt_empty") return "stt_empty";
  if (e === "awaiting_twilio_transcript") return "awaiting_twilio_transcript";
  return "unknown";
}

/**
 * Collapsed transcript for a call row. Insights (summary, sentiment, flags)
 * are not shown — staff open this panel to read the transcript only.
 */
export default function ConversationCallInsights({ message }: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const retryingId = useAppSelector((s) => s.conversations.retryCallInsightsId);
  const [open, setOpen] = useState(false);
  const status = message.call_insights_status;
  const transcript = String(message.call_transcript || "").trim();
  const isVoicemail = !!(
    message.metadata_json &&
    (message.metadata_json as { is_voicemail?: boolean }).is_voicemail
  );
  const errCode = message.call_insights_error
    ? errorKey(message.call_insights_error)
    : null;
  const retrying = retryingId === message.id;
  const canRetry =
    !transcript && (status === "failed" || status === "skipped");

  if (!status && !transcript) return null;

  return (
    <div
      className="mt-2 rounded-xl border border-border/70 bg-background/70 text-foreground overflow-hidden"
      data-testid="call-transcript"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs font-semibold"
        aria-expanded={open}
      >
        <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="flex-1 min-w-0 truncate">
          {t("conversations.callTranscript.title")}
          {isVoicemail
            ? ` · ${t("conversations.callTranscript.voicemail")}`
            : ""}
        </span>
        {!transcript && status && status !== "ready" ? (
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
            {t(`conversations.callTranscript.status.${status}`, {
              defaultValue: status,
            })}
          </span>
        ) : null}
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {open ? (
        <div className="px-2.5 pb-2.5 text-xs">
          {transcript ? (
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/90 max-h-48 overflow-y-auto">
              {transcript}
            </p>
          ) : status === "pending" || status === "processing" ? (
            <p className="text-muted-foreground leading-relaxed">
              {t("conversations.callTranscript.pending")}
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-muted-foreground leading-relaxed">
                {t(`conversations.callTranscript.errors.${errCode || "unknown"}`, {
                  defaultValue: t("conversations.callTranscript.errors.unknown"),
                })}
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
                  {t("conversations.callTranscript.retry")}
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  ImagePlus,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import {
  applyConversationTemplate,
  applyConversationTemplateVars,
  buildConversationMergeVars,
  CONVERSATION_COMPOSER_QUICK_VARS,
  CONVERSATION_TEMPLATE_VARS,
  getOpenVariableToken,
  type ConversationMergeContext,
} from "@/lib/conversationTemplateVars";
import type { ConversationTemplate } from "@shared/api";
import type { ConversationSuggestion } from "@/lib/conversationSuggestedReplies";
import { SMS_MAX_BODY_CHARS, smsSegmentInfo } from "@/lib/smsSegments";
import { cn } from "@/lib/utils";

type Channel = "sms" | "internal";

export interface ConversationMediaAttachment {
  /** Public URL Twilio + timeline use after upload. */
  url: string;
  content_type: string;
  filename: string;
  /** Local blob: URL for instant composer preview (real-state pattern). */
  preview_url?: string;
}

interface Props {
  channel: Channel;
  onChannelChange: (ch: Channel) => void;
  body: string;
  onBodyChange: (v: string) => void;
  templates: ConversationTemplate[];
  mergeContext: ConversationMergeContext;
  attachment?: ConversationMediaAttachment | null;
  onAttachmentChange?: (a: ConversationMediaAttachment | null) => void;
  onPickMedia?: (file: File) => Promise<void>;
  uploadingMedia?: boolean;
  sending?: boolean;
  sendError?: string | null;
  onSend: () => void;
  disabled?: boolean;
  /** Static + AI quick-reply chips above the textarea. */
  suggestedReplies?: ConversationSuggestion[];
  onSuggestAi?: () => void;
  aiSuggestionsLoading?: boolean;
  /** Optional left-side action (e.g. Cancel in the New message dialog). */
  footerStart?: ReactNode;
  /** When set, only these channel tabs are shown (default SMS + Note). */
  allowedChannels?: Channel[];
  /**
   * Thread mode: start fully collapsed so the timeline stays readable.
   * Click the dock (or expand) to open tools. New-message dialog should pass false.
   */
  collapsible?: boolean;
  /** Bumps when the open thread changes — resets to collapsed. */
  collapseResetKey?: string | number;
}

export function ConversationMessageComposer({
  channel,
  onChannelChange,
  body,
  onBodyChange,
  templates,
  mergeContext,
  attachment,
  onAttachmentChange,
  onPickMedia,
  uploadingMedia,
  sending,
  sendError,
  onSend,
  disabled,
  suggestedReplies = [],
  onSuggestAi,
  aiSuggestionsLoading,
  footerStart,
  allowedChannels = ["sms", "internal"],
  collapsible = false,
  collapseResetKey,
}: Props) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevSendingRef = useRef(false);
  const [cursor, setCursor] = useState(0);
  const [showTpl, setShowTpl] = useState(false);
  const [expanded, setExpanded] = useState(!collapsible);

  const vars = useMemo(
    () => buildConversationMergeVars(mergeContext),
    [mergeContext],
  );

  const openToken = getOpenVariableToken(body, cursor);
  const varSuggestions = useMemo(() => {
    if (!openToken) return [];
    const q = openToken.query.toLowerCase();
    return CONVERSATION_TEMPLATE_VARS.filter(
      (v) => !q || v.key.startsWith(q) || v.label.toLowerCase().includes(q),
    );
  }, [openToken]);

  const channelTemplates = templates.filter(
    (tpl) => tpl.is_active && tpl.channel === channel,
  );

  const insertVariable = (key: string) => {
    const el = textareaRef.current;
    const pos = el?.selectionStart ?? cursor;
    const token = getOpenVariableToken(body, pos);
    if (token) {
      const next =
        body.slice(0, token.start) + `{{${key}}}` + body.slice(pos);
      onBodyChange(next);
      requestAnimationFrame(() => {
        const caret = token.start + key.length + 4;
        el?.setSelectionRange(caret, caret);
        setCursor(caret);
      });
      return;
    }
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? start;
    const next = body.slice(0, start) + `{{${key}}}` + body.slice(end);
    onBodyChange(next);
  };

  const applyTemplate = (tpl: ConversationTemplate) => {
    const filled = applyConversationTemplate(tpl, vars);
    onBodyChange(filled.body);
    setShowTpl(false);
  };

  const previewFilled = applyConversationTemplateVars(body, vars);
  const smsInfo = useMemo(
    () => (channel === "sms" ? smsSegmentInfo(previewFilled) : null),
    [channel, previewFilled],
  );
  const smsOverLimit =
    channel === "sms" && (smsInfo?.length ?? 0) > SMS_MAX_BODY_CHARS;
  const canSend = Boolean(
    (body.trim() && !smsOverLimit) ||
      (channel === "sms" && attachment?.url),
  );
  const hasDraft = Boolean(body.trim() || attachment?.url);

  const expandAndFocus = useCallback(() => {
    setExpanded(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const tryCollapse = useCallback(() => {
    if (!collapsible) return;
    if (hasDraft || sending || uploadingMedia) return;
    setShowTpl(false);
    setExpanded(false);
  }, [collapsible, hasDraft, sending, uploadingMedia]);

  useEffect(() => {
    setShowTpl(false);
  }, [channel]);

  useEffect(() => {
    if (!collapsible) {
      setExpanded(true);
      return;
    }
    setExpanded(false);
    setShowTpl(false);
  }, [collapsible, collapseResetKey]);

  // Collapse after a successful send (parent clears body when sending ends).
  useEffect(() => {
    const wasSending = prevSendingRef.current;
    prevSendingRef.current = !!sending;
    if (!collapsible) return;
    if (wasSending && !sending && !body.trim() && !attachment?.url) {
      setShowTpl(false);
      setExpanded(false);
    }
  }, [sending, body, attachment?.url, collapsible]);

  useEffect(() => {
    if (channel !== "sms" && attachment) {
      if (attachment.preview_url) {
        URL.revokeObjectURL(attachment.preview_url);
      }
      onAttachmentChange?.(null);
    }
  }, [channel, attachment, onAttachmentChange]);

  const clearAttachment = () => {
    if (attachment?.preview_url) {
      URL.revokeObjectURL(attachment.preview_url);
    }
    onAttachmentChange?.(null);
  };

  const onRootBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!collapsible || !expanded) return;
    const next = e.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    // Defer so click-to-expand / template mousedown can win.
    requestAnimationFrame(() => {
      if (!rootRef.current?.contains(document.activeElement)) {
        tryCollapse();
      }
    });
  };

  const dockPreview = body.trim()
    ? body.trim()
    : attachment
      ? t("conversations.mmsAttached")
      : t("conversations.composerCollapsedHint");

  return (
    <div
      ref={rootRef}
      className="border-t border-border shrink-0"
      onBlur={onRootBlur}
      data-testid="conversation-composer"
      data-expanded={expanded ? "true" : "false"}
    >
      {collapsible && !expanded ? (
        <button
          type="button"
          onClick={expandAndFocus}
          disabled={disabled}
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-2.5 text-left",
            "hover:bg-muted/50 transition-colors duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            "disabled:opacity-50",
          )}
          aria-expanded={false}
          data-testid="conversation-composer-dock"
        >
          <span className="h-9 w-9 rounded-xl bg-primary/10 text-primary inline-flex items-center justify-center shrink-0">
            <MessageSquare className="w-4 h-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`conversations.channels.${channel}`)}
              </span>
              {hasDraft && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                  {t("conversations.composerDraftBadge")}
                </span>
              )}
            </span>
            <span
              className={cn(
                "block text-sm truncate mt-0.5",
                hasDraft ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {dockPreview}
            </span>
          </span>
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      ) : null}

      <div
        className={cn(
          "grid motion-safe:transition-[grid-template-rows] motion-safe:duration-200 motion-safe:ease-out",
          collapsible && !expanded ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
        )}
        aria-hidden={collapsible && !expanded}
      >
        <div className="overflow-hidden min-h-0">
          <div
            className={cn(
              "p-3 space-y-2 max-h-[min(40vh,22rem)] overflow-y-auto overscroll-contain",
              "motion-safe:transition-opacity motion-safe:duration-200",
              collapsible && !expanded
                ? "opacity-0 pointer-events-none"
                : "opacity-100",
            )}
          >
            <div className="flex flex-wrap items-center gap-1 justify-between">
              <div className="flex gap-1">
                {allowedChannels.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => onChannelChange(ch)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold uppercase ${
                      channel === ch
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {t(`conversations.channels.${ch}`)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowTpl((v) => !v)}
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-medium border border-border hover:bg-muted"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    {t("conversations.templates")}
                  </button>
                  {showTpl && (
                    <div className="absolute right-0 bottom-full mb-1 z-20 w-72 max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-lg p-1">
                      {channelTemplates.length === 0 ? (
                        <p className="text-xs text-muted-foreground p-3">
                          {t("conversations.noTemplatesForChannel")}
                        </p>
                      ) : (
                        channelTemplates.map((tpl) => (
                          <button
                            key={tpl.id}
                            type="button"
                            onClick={() => applyTemplate(tpl)}
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted text-sm"
                          >
                            <div className="font-medium truncate">{tpl.name}</div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {tpl.body.slice(0, 80)}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {collapsible && (
                  <button
                    type="button"
                    onClick={() => {
                      if (hasDraft) {
                        setExpanded(false);
                        setShowTpl(false);
                        return;
                      }
                      tryCollapse();
                    }}
                    className="h-8 w-8 rounded-lg border border-border hover:bg-muted inline-flex items-center justify-center"
                    aria-label={t("conversations.composerCollapse")}
                    title={t("conversations.composerCollapse")}
                    data-testid="conversation-composer-collapse"
                  >
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>

            {(suggestedReplies.length > 0 || onSuggestAi) && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("conversations.suggestedReplies")}
                  </span>
                  {onSuggestAi && (
                    <button
                      type="button"
                      onClick={onSuggestAi}
                      disabled={aiSuggestionsLoading || disabled}
                      className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline disabled:opacity-50"
                    >
                      {aiSuggestionsLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      {t("conversations.suggestWithAi")}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestedReplies.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onBodyChange(s.body)}
                      className="text-left text-[11px] px-2.5 py-1.5 rounded-lg border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 max-w-full line-clamp-2"
                      title={s.body}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="relative">
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => {
                  let next = e.target.value;
                  if (
                    channel === "sms" &&
                    [...next].length > SMS_MAX_BODY_CHARS
                  ) {
                    next = [...next].slice(0, SMS_MAX_BODY_CHARS).join("");
                  }
                  onBodyChange(next);
                  setCursor(e.target.selectionStart);
                }}
                onSelect={(e) =>
                  setCursor((e.target as HTMLTextAreaElement).selectionStart)
                }
                onKeyUp={(e) =>
                  setCursor((e.target as HTMLTextAreaElement).selectionStart)
                }
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    if (!hasDraft) tryCollapse();
                    else {
                      setShowTpl(false);
                      (e.target as HTMLTextAreaElement).blur();
                    }
                  }
                }}
                rows={3}
                placeholder={t("conversations.composerPlaceholder")}
                className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm resize-none"
                disabled={disabled}
                tabIndex={collapsible && !expanded ? -1 : undefined}
              />
              {openToken && varSuggestions.length > 0 && (
                <div className="absolute left-2 bottom-full mb-1 z-20 w-64 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
                  <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
                    {t("conversations.variableSuggestions")}
                  </div>
                  {varSuggestions.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertVariable(v.key);
                      }}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted text-left"
                    >
                      <code className="text-xs text-primary">{`{{${v.key}}}`}</code>
                      <span className="text-xs text-muted-foreground">
                        {v.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {channel === "sms" && attachment && (
              <div className="flex items-center gap-2 p-2 rounded-xl border border-border bg-muted/40">
                {attachment.content_type.startsWith("image/") ? (
                  <img
                    src={attachment.preview_url || attachment.url}
                    alt={attachment.filename}
                    className="h-14 w-14 rounded-lg object-cover border border-border bg-muted"
                  />
                ) : attachment.content_type.startsWith("video/") ? (
                  <video
                    src={attachment.preview_url || attachment.url}
                    className="h-14 w-14 rounded-lg object-cover border border-border bg-muted"
                    muted
                    playsInline
                  />
                ) : (
                  <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center text-[10px] text-muted-foreground px-1 text-center">
                    {attachment.content_type.split("/")[1] || "file"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">
                    {attachment.filename}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {t("conversations.mmsAttached")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearAttachment}
                  className="h-8 w-8 rounded-lg hover:bg-muted inline-flex items-center justify-center"
                  aria-label={t("conversations.removeAttachment")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {body.includes("{{") && previewFilled !== body && (
              <p className="text-[11px] text-muted-foreground line-clamp-2">
                {t("conversations.preview")}: {previewFilled}
              </p>
            )}

            {sendError && (
              <div className="text-xs text-destructive">{sendError}</div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                {channel === "sms" && onPickMedia && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,audio/mpeg,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void onPickMedia(f);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={disabled || uploadingMedia}
                      className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-xs font-medium border border-border hover:bg-muted disabled:opacity-50 shrink-0"
                    >
                      {uploadingMedia ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <ImagePlus className="w-3.5 h-3.5" />
                      )}
                      {t("conversations.attach")}
                    </button>
                  </>
                )}
                {CONVERSATION_COMPOSER_QUICK_VARS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => insertVariable(key)}
                    className="text-[10px] px-1.5 py-1 rounded-md border border-primary/20 bg-primary/5 text-primary font-mono shrink-0"
                  >
                    {`{{${key}}}`}
                  </button>
                ))}
                {channel === "sms" && smsInfo && (
                  <span
                    className={cn(
                      "text-[10px] tabular-nums shrink-0",
                      smsOverLimit
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {smsInfo.length === 0
                      ? t("conversations.smsMeterEmpty", {
                          max: SMS_MAX_BODY_CHARS,
                        })
                      : t("conversations.smsMeter", {
                          length: smsInfo.length,
                          max: SMS_MAX_BODY_CHARS,
                          segments: smsInfo.segments,
                        })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 sm:justify-end">
                {footerStart}
                <button
                  type="button"
                  onClick={onSend}
                  disabled={disabled || sending || uploadingMedia || !canSend}
                  className="h-10 px-4 rounded-xl bg-primary text-primary-foreground disabled:opacity-50 inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <Send className="w-4 h-4 shrink-0" />
                  )}
                  <span>{t("conversations.send")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

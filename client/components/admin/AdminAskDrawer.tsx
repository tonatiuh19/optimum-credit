import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Loader2, Sparkles, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import AdminAskMarkdown from "@/components/admin/AdminAskMarkdown";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminAsk,
  closeAdminAsk,
  openAdminAsk,
  sendAdminAiChat,
} from "@/store/slices/adminAiSlice";
import { logger } from "@/utils/logger";

export default function AdminAskDrawer() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.adminAuth?.user);
  const { open, context, messages, sending, error } = useAppSelector(
    (s) =>
      s.adminAi ?? {
        open: false,
        context: null,
        messages: [],
        sending: false,
        error: null,
      },
  );
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const enabled = !!user?.ai_ask_enabled;

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [open, messages, sending]);

  if (!enabled) return null;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setDraft("");
    dispatch(sendAdminAiChat({ content })).catch((err) =>
      logger.warn("admin ask failed", err),
    );
  };

  const contextLabel = context?.case_number
    ? context.case_number
    : context?.case_id
      ? `#${context.case_id}`
      : context?.client_id
        ? t("adminAsk.clientContext", { id: context.client_id })
        : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) dispatch(closeAdminAsk());
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-md h-full flex flex-col p-0 gap-0"
      >
        <SheetHeader className="px-4 py-3 border-b border-border text-left space-y-1">
          <div className="flex items-center justify-between gap-2 pr-6">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4 text-primary" />
              {t("adminAsk.title")}
            </SheetTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => dispatch(clearAdminAsk())}
              title={t("adminAsk.clear")}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          <SheetDescription className="text-xs">
            {t("adminAsk.subtitle")}
          </SheetDescription>
          {contextLabel && (
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md bg-primary/10 text-primary w-fit">
              {t("adminAsk.contextChip", { label: contextLabel })}
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">
                {t("adminAsk.emptyTitle")}
              </p>
              <p className="text-xs leading-relaxed">{t("adminAsk.emptyBody")}</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={`${m.role}-${i}`}
              className={[
                "rounded-xl px-3 py-2.5 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-primary text-primary-foreground ml-6 whitespace-pre-wrap"
                  : "bg-muted text-foreground mr-4",
              ].join(" ")}
            >
              {m.role === "assistant" ? (
                <AdminAskMarkdown
                  content={m.content}
                  onInternalLinkClick={() => dispatch(closeAdminAsk())}
                />
              ) : (
                m.content
              )}
              {m.role === "assistant" &&
                m.citations &&
                m.citations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.citations.map((c) => (
                      <Link
                        key={c.href}
                        to={c.href}
                        className="text-[11px] font-semibold underline underline-offset-2 opacity-90 hover:opacity-100"
                        onClick={() => dispatch(closeAdminAsk())}
                      >
                        {c.label || c.href}
                      </Link>
                    ))}
                  </div>
                )}
            </div>
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground mr-4">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t("adminAsk.thinking")}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2">
              {error.startsWith("adminAsk.") ? t(error) : error}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={onSubmit}
          className="border-t border-border p-3 flex gap-2 items-end"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={t("adminAsk.placeholder")}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={sending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e);
              }
            }}
          />
          <Button type="submit" disabled={sending || !draft.trim()} size="sm">
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              t("adminAsk.send")
            )}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Right-edge pull tab (Mortgi-style) — mid-screen so it never covers composers/Send. */
export function AdminAskFab() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.adminAuth?.user);
  const open = useAppSelector((s) => s.adminAi?.open);
  const messageCount = useAppSelector((s) => s.adminAi?.messages?.length ?? 0);
  if (!user?.ai_ask_enabled || open) return null;

  return (
    <AnimatePresence>
      <motion.button
        key="admin-ask-tab"
        type="button"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
        whileHover={{ x: -6 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => dispatch(openAdminAsk(null))}
        aria-label={t("adminAsk.openAria")}
        title={t("adminAsk.title")}
        className={[
          "fixed right-0 top-1/2 -translate-y-1/2 z-[60]",
          "flex flex-col items-center gap-2",
          "bg-primary px-2 pt-4 pb-3 rounded-l-2xl",
          "shadow-xl shadow-primary/30 cursor-pointer select-none",
          "text-primary-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        ].join(" ")}
      >
        {messageCount > 0 && (
          <span className="absolute -top-1 -left-1 h-3.5 w-3.5 rounded-full bg-accent border-2 border-background" />
        )}
        <ChevronLeft className="h-4 w-4 text-primary-foreground/80" />
        <Sparkles className="h-5 w-5" />
        <span
          className="text-[9px] font-bold text-primary-foreground/90 uppercase tracking-widest"
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
          }}
        >
          {t("adminAsk.title")}
        </span>
      </motion.button>
    </AnimatePresence>
  );
}

export function AdminAskCaseButton({
  caseId,
  caseNumber,
  clientId,
}: {
  caseId?: number | null;
  caseNumber?: string | null;
  clientId?: number | null;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.adminAuth?.user);
  if (!user?.ai_ask_enabled) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() =>
        dispatch(
          openAdminAsk({
            case_id: caseId ?? null,
            case_number: caseNumber ?? null,
            client_id: clientId ?? null,
          }),
        )
      }
    >
      <Sparkles className="w-3.5 h-3.5" />
      {t("adminAsk.askAboutCase")}
    </Button>
  );
}

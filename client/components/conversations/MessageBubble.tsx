import { forwardRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type MessageBubbleVariant = "out" | "in" | "note";

export interface MessageBubbleProps {
  variant: MessageBubbleVariant;
  /** First bubble of a group: shows the header and a little extra top spacing. */
  first?: boolean;
  /** Last bubble of a group: shows the tail and the footer. */
  last?: boolean;
  /** Spring in (only for messages that arrived while the thread was open). */
  animateIn?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

const SPRING = { type: "spring", stiffness: 520, damping: 34, mass: 0.7 } as const;

/** Tail curve drawn in the bubble's own color (currentColor), tucked under the bottom corner. */
function BubbleTail({ side }: { side: "out" | "in" }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 18"
      className={cn(
        "pointer-events-none absolute bottom-0 h-[18px] w-4",
        side === "out" ? "-right-[6px] text-primary" : "-left-[6px] -scale-x-100 text-muted",
      )}
    >
      <path fill="currentColor" d="M0 0v12c0 3.3 2.7 6 6 6h10C9 18 4.5 14 4 6V0H0Z" />
    </svg>
  );
}

/**
 * Chat bubble shared by every thread UI: iMessage-style grouping (tail only on the
 * last bubble of a stack, tightened inner corners) in OFG tokens, with a spring entry.
 */
export const MessageBubble = forwardRef<HTMLDivElement, MessageBubbleProps>(function MessageBubble(
  { variant, first = true, last = true, animateIn = false, header, footer, children, className, ...rest },
  ref,
) {
  const isOut = variant === "out";
  const isNote = variant === "note";

  const corners = isNote
    ? "rounded-2xl"
    : isOut
      ? cn("rounded-[20px]", !first && "rounded-tr-md", !last && "rounded-br-md")
      : cn("rounded-[20px]", !first && "rounded-tl-md", !last && "rounded-bl-md");

  return (
    <div
      className={cn(
        "flex w-full",
        isNote ? "justify-center" : isOut ? "justify-end" : "justify-start",
        first ? "mt-3 first:mt-0" : "mt-0.5",
      )}
    >
      <motion.div
        ref={ref}
        data-testid={rest["data-testid"]}
        initial={animateIn ? { opacity: 0, scale: 0.85, y: 14, x: isNote ? 0 : isOut ? 18 : -18 } : false}
        animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
        transition={SPRING}
        style={{ transformOrigin: isNote ? "50% 100%" : isOut ? "100% 100%" : "0% 100%" }}
        className={cn(
          "relative max-w-[85%] sm:max-w-[75%] px-3.5 py-2 text-sm leading-relaxed",
          "transition-shadow duration-200 hover:shadow-md",
          corners,
          isNote
            ? "w-full max-w-xl border border-dashed border-border bg-secondary text-secondary-foreground"
            : isOut
              ? "bg-gradient-to-t from-primary to-primary/85 text-primary-foreground shadow-sm"
              : "bg-muted text-foreground shadow-sm",
          className,
        )}
      >
        {first && header ? <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-75">{header}</div> : null}
        {children}
        {last && footer ? <div className="mt-1 flex flex-wrap items-center justify-end gap-x-1 text-[10px] opacity-70">{footer}</div> : null}
        {last && !isNote ? <BubbleTail side={isOut ? "out" : "in"} /> : null}
      </motion.div>
    </div>
  );
});

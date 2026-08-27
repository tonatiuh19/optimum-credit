import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

function buildComponents(onInternalLinkClick?: () => void): Components {
  return {
    p: ({ children }) => (
      <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
    ),
    ul: ({ children }) => (
      <ul className="mb-2 last:mb-0 list-disc space-y-1 pl-4">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-2 last:mb-0 list-decimal space-y-1 pl-4">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="leading-relaxed [&_p]:mb-0">{children}</li>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    a: ({ href, children }) => {
      const to = typeof href === "string" ? href : "";
      if (to.startsWith("/")) {
        return (
          <Link
            to={to}
            onClick={onInternalLinkClick}
            className="font-medium text-primary underline underline-offset-2"
          >
            {children}
          </Link>
        );
      }
      return (
        <a
          href={to || undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2"
        >
          {children}
        </a>
      );
    },
    code: ({ children, className }) => {
      const block =
        typeof className === "string" && className.includes("language-");
      if (block) {
        return (
          <code className="block my-2 overflow-x-auto rounded-md bg-background/80 px-2 py-1.5 text-[12px] font-mono">
            {children}
          </code>
        );
      }
      return (
        <code className="rounded bg-background/80 px-1 py-0.5 text-[12px] font-mono">
          {children}
        </code>
      );
    },
    h1: ({ children }) => (
      <p className="mb-2 font-semibold text-foreground">{children}</p>
    ),
    h2: ({ children }) => (
      <p className="mb-2 font-semibold text-foreground">{children}</p>
    ),
    h3: ({ children }) => (
      <p className="mb-1.5 font-semibold text-foreground">{children}</p>
    ),
  };
}

type AdminAskMarkdownProps = {
  content: string;
  className?: string;
  onInternalLinkClick?: () => void;
};

/** Compact Markdown for Admin Ask chat bubbles (no raw HTML). */
export default function AdminAskMarkdown({
  content,
  className,
  onInternalLinkClick,
}: AdminAskMarkdownProps) {
  return (
    <div className={cn("admin-ask-md text-sm", className)}>
      <ReactMarkdown components={buildComponents(onInternalLinkClick)}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

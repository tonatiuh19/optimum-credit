import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { sanitizeLegalMarkdown } from "@shared/sanitizeLegalMarkdown";

export { sanitizeLegalMarkdown };

const components: Components = {
  h1: ({ children }) => (
    <h2 className="mt-0 mb-5 text-xl sm:text-2xl font-bold tracking-tight text-foreground">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h2 className="legal-md-h2 relative mt-10 mb-4 pt-8 border-t border-border/70 text-lg sm:text-xl font-bold tracking-tight text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-7 mb-2.5 text-[15px] sm:text-base font-semibold text-foreground">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-5 mb-2 text-sm font-semibold text-foreground/90">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="mb-4 text-[15px] sm:text-base leading-[1.75] text-foreground/80 last:mb-0">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="legal-md-ul mb-5 mt-1 space-y-2.5 pl-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="legal-md-ol mb-5 mt-1 space-y-2.5 pl-0">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="legal-md-li relative text-[15px] sm:text-base leading-[1.75] text-foreground/80 pl-7 [&_p]:mb-0 [&_p]:leading-[1.75]">
      {children}
    </li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-foreground/75">{children}</em>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      className="font-medium text-primary underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-6 rounded-xl border border-primary/15 bg-primary/[0.04] px-4 py-3.5 sm:px-5 text-sm leading-relaxed text-muted-foreground [&>p]:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-10 border-0 border-t border-border/80" />,
  code: ({ children }) => (
    <code className="rounded-md bg-muted px-1.5 py-0.5 text-[13px] font-mono text-foreground">
      {children}
    </code>
  ),
};

type LegalMarkdownProps = {
  content: string;
  className?: string;
};

/**
 * Polished markdown renderer for legal / policy documents.
 */
export default function LegalMarkdown({
  content,
  className,
}: LegalMarkdownProps) {
  return (
    <div className={cn("legal-md", className)}>
      <ReactMarkdown components={components}>
        {sanitizeLegalMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}

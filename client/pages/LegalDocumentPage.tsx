import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Scale } from "lucide-react";
import PageMeta from "@/components/PageMeta";
import ThemeToggle from "@/components/ThemeToggle";
import LegalLinks from "@/components/LegalLinks";
import LegalMarkdown from "@/components/LegalMarkdown";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLegalDocument } from "@/store/slices/legalSlice";

function LegalDocumentSkeleton() {
  return (
    <div className="space-y-8" aria-hidden>
      <div className="space-y-3">
        <Skeleton className="h-4 w-24 rounded-full" />
        <Skeleton className="h-10 w-3/4 max-w-md rounded-xl" />
        <Skeleton className="h-4 w-44 rounded-lg" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-full rounded-lg" />
        <Skeleton className="h-4 w-[94%] rounded-lg" />
        <Skeleton className="h-4 w-[88%] rounded-lg" />
      </div>
      <div className="space-y-4 pt-2">
        <Skeleton className="h-7 w-1/2 max-w-xs rounded-lg" />
        <Skeleton className="h-4 w-full rounded-lg" />
        <Skeleton className="h-4 w-[91%] rounded-lg" />
        <div className="space-y-2 pl-2">
          <Skeleton className="h-4 w-[85%] rounded-lg" />
          <Skeleton className="h-4 w-[78%] rounded-lg" />
          <Skeleton className="h-4 w-[82%] rounded-lg" />
        </div>
      </div>
      <div className="space-y-4 pt-2">
        <Skeleton className="h-7 w-2/5 max-w-sm rounded-lg" />
        <Skeleton className="h-4 w-full rounded-lg" />
        <Skeleton className="h-4 w-[90%] rounded-lg" />
        <Skeleton className="h-4 w-[70%] rounded-lg" />
      </div>
    </div>
  );
}

export default function LegalDocumentPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const doc = useAppSelector((s) => s.legal.bySlug[slug]);
  const loading = useAppSelector((s) => s.legal.loadingSlug === slug);
  const error = useAppSelector((s) => s.legal.error);

  useEffect(() => {
    if (!slug) return;
    if (doc?.slug === slug && doc.content_md) return;
    dispatch(fetchLegalDocument(slug));
  }, [dispatch, slug, doc?.slug, doc?.content_md]);

  const title = doc?.title || t("legal.documentFallbackTitle");
  const updated =
    doc?.updated_at &&
    new Date(doc.updated_at).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-primary/[0.06] via-background to-accent/[0.06] flex flex-col">
      <PageMeta
        title={title}
        description={t("legal.documentMetaDescription")}
        canonical={`/legal/${slug}`}
        noIndex={false}
      />

      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="container max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("legal.backHome")}
          </Link>
          <ThemeToggle zone="portal" compact />
        </div>
      </header>

      <main className="flex-1 container max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <article className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-sm backdrop-blur-sm">
          {/* Brand accent rail */}
          <div
            className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary via-primary/70 to-accent"
            aria-hidden
          />

          <div className="p-6 sm:p-10 sm:pl-12">
            {loading && !doc ? (
              <LegalDocumentSkeleton />
            ) : error && !doc ? (
              <div className="space-y-3 text-center py-10">
                <p className="text-destructive font-medium">{error}</p>
                <button
                  type="button"
                  onClick={() => dispatch(fetchLegalDocument(slug))}
                  className="btn-secondary text-sm"
                >
                  {t("legal.retry")}
                </button>
              </div>
            ) : (
              <>
                <header className="mb-8 sm:mb-10">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/5 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-primary mb-4">
                    <Scale className="w-3 h-3" />
                    {t("legal.badge")}
                  </div>
                  <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground leading-tight">
                    {title}
                  </h1>
                  {updated && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {t("legal.lastUpdated", { date: updated })}
                    </p>
                  )}
                  <div className="mt-6 h-px bg-gradient-to-r from-border via-border/60 to-transparent" />
                </header>

                <LegalMarkdown content={doc?.content_md || ""} />
              </>
            )}
          </div>
        </article>
      </main>

      <footer className="border-t border-border/60 py-5">
        <div className="container max-w-3xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Optimum Credit
          </p>
          <LegalLinks className="text-xs text-muted-foreground" />
        </div>
      </footer>
    </div>
  );
}

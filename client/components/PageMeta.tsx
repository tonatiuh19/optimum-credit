import { Helmet } from "react-helmet-async";

const SITE_NAME = "Optimum Credit";
const BASE_URL = "https://optimumcredit.com";
const DEFAULT_IMAGE = `${BASE_URL}/og-image.jpg`;

interface PageMetaProps {
  /** Browser tab + OG title. Appended with " | Optimum Credit" unless `titleFull` is true */
  title: string;
  /** Plain-text description (120–160 chars for best SEO) */
  description: string;
  /** Canonical path, e.g. "/register". Defaults to current path if omitted */
  canonical?: string;
  /** Absolute URL for OG/Twitter image. Falls back to default OG image */
  image?: string;
  /** Set true to suppress site-name suffix in <title> */
  titleFull?: boolean;
  /** "website" | "article" | "product". Defaults to "website" */
  ogType?: "website" | "article" | "product";
  /** Noindex pages (auth, portal, admin) */
  noIndex?: boolean;
  /** Structured data JSON-LD object(s). Pass an array for multiple */
  jsonLd?: object | object[];
}

export default function PageMeta({
  title,
  description,
  canonical,
  image = DEFAULT_IMAGE,
  titleFull = false,
  ogType = "website",
  noIndex = false,
  jsonLd,
}: PageMetaProps) {
  const fullTitle = titleFull ? title : `${title} | ${SITE_NAME}`;
  const canonicalUrl = canonical
    ? `${BASE_URL}${canonical}`
    : typeof window !== "undefined"
      ? window.location.href
      : BASE_URL;

  const schemas = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      {/* ── Primary ── */}
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />

      {/* ── Robots ── */}
      <meta
        name="robots"
        content={
          noIndex
            ? "noindex,nofollow"
            : "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1"
        }
      />

      {/* ── Open Graph ── */}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={`${SITE_NAME} – ${title}`} />
      <meta property="og:locale" content="en_US" />

      {/* ── Twitter / X Card ── */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content="@OptimumCredit" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {/* ── Structured Data ── */}
      {schemas.map((schema, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      ))}
    </Helmet>
  );
}

/* ── Pre-built JSON-LD helpers ─────────────────────────────────────────── */

export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: BASE_URL,
  logo: "https://disruptinglabs.com/data/optimum/assets/images/logo_horizontal_gold_121829_text.png",
  sameAs: [
    "https://www.facebook.com/OptimumCredit",
    "https://twitter.com/OptimumCredit",
    "https://www.linkedin.com/company/optimum-credit",
  ],
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    availableLanguage: "English",
  },
};

export const localBusinessSchema = {
  "@context": "https://schema.org",
  "@type": "FinancialService",
  name: SITE_NAME,
  description:
    "Credit repair service helping clients improve their credit scores through expert dispute management and personalized strategies.",
  url: BASE_URL,
  logo: "https://disruptinglabs.com/data/optimum/assets/images/logo_horizontal_gold_121829_text.png",
  priceRange: "$$",
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "4.9",
    reviewCount: "15000",
    bestRating: "5",
    worstRating: "1",
  },
};

export const faqSchema = (items: { question: string; answer: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: { "@type": "Answer", text: answer },
  })),
});

export const serviceSchema = (opts: {
  name: string;
  description: string;
  price: string;
}) => ({
  "@context": "https://schema.org",
  "@type": "Service",
  serviceType: "Credit Repair",
  name: opts.name,
  description: opts.description,
  provider: { "@type": "Organization", name: SITE_NAME, url: BASE_URL },
  offers: {
    "@type": "Offer",
    price: opts.price,
    priceCurrency: "USD",
  },
});

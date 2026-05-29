import {
  ArrowRight,
  Star,
  CheckCircle,
  Shield,
  Zap,
  TrendingUp,
  MessageSquare,
  Lock,
  Loader2,
} from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import CreditImprovementCard from "@/components/CreditImprovementCard";
import PageMeta, {
  organizationSchema,
  localBusinessSchema,
} from "@/components/PageMeta";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchPackages } from "@/store/slices/packagesSlice";
import PackagesPlanGrid from "@/components/PackagesPlanGrid";

export default function Index() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { packages, loading: packagesLoading } = useAppSelector(
    (s) => s.packages,
  );

  useEffect(() => {
    dispatch(fetchPackages());
  }, [dispatch]);

  return (
    <div className="w-full max-w-[100vw] overflow-x-hidden">
      <PageMeta
        title="Professional Credit Repair"
        description="Optimum Credit removes negative items, resolves disputes, and improves your credit score. Trusted by 15,000+ clients with a 98% success rate and average 140-point increase."
        canonical="/"
        ogType="website"
        jsonLd={[organizationSchema, localBusinessSchema]}
      />
      {/* Hero Section */}
      {/* ── MOBILE hero (hidden on md+) ──────────────────────────────── */}
      <section className="md:hidden relative overflow-hidden bg-background">
        {/* Full-bleed gradient top band */}
        <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/[0.08] to-transparent pointer-events-none" />
        <div className="absolute -top-16 -right-16 w-56 h-56 bg-accent/10 rounded-full blur-3xl pointer-events-none animate-float" />
        <div
          className="absolute top-32 -left-12 w-48 h-48 bg-primary/10 rounded-full blur-3xl pointer-events-none animate-float"
          style={{ animationDelay: "1.1s" }}
        />

        <div className="relative z-10 px-5 pt-10 pb-8 flex flex-col gap-7">
          {/* Headline */}
          <div
            className="text-center animate-fade-up"
            style={{ animationDelay: "0.05s" }}
          >
            <h1 className="text-[2.6rem] font-extrabold tracking-tight text-foreground leading-[1.1] mb-3">
              {t("hero.headline1")}
              <br />
              <span className="gradient-text">{t("hero.headline2")}</span>
            </h1>
            <p className="text-[0.95rem] text-muted-foreground leading-relaxed max-w-xs mx-auto">
              {t("hero.body")}
            </p>
          </div>

          {/* Score card */}
          <div
            className="mx-auto w-full max-w-sm animate-fade-up"
            style={{ animationDelay: "0.12s" }}
          >
            <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
              {/* Card header */}
              <div className="bg-gradient-to-r from-primary to-primary/80 px-5 py-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-primary-foreground/80 uppercase tracking-widest">
                  {t("hero.creditJourney")}
                </span>
                <span className="text-[10px] bg-accent text-accent-foreground font-bold px-2 py-0.5 rounded-full">
                  {t("hero.avgResult")}
                </span>
              </div>
              {/* Score comparison row */}
              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <div className="flex flex-col items-center">
                  <span className="text-[11px] text-muted-foreground font-medium mb-1">
                    {t("hero.before")}
                  </span>
                  <div className="w-16 h-16 rounded-full border-4 border-destructive/30 flex items-center justify-center bg-destructive/5">
                    <span className="text-xl font-extrabold text-destructive">
                      580
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1">
                    {t("hero.poor")}
                  </span>
                </div>
                {/* Arrow / improvement */}
                <div className="flex-1 flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1">
                    <div
                      className="h-0.5 flex-1 bg-gradient-to-r from-destructive/40 to-accent/60 rounded-full"
                      style={{ width: 48 }}
                    />
                    <TrendingUp className="w-5 h-5 text-accent" />
                    <div
                      className="h-0.5 flex-1 bg-gradient-to-r from-accent/60 to-accent rounded-full"
                      style={{ width: 48 }}
                    />
                  </div>
                  <span className="text-accent font-extrabold text-sm">
                    +140 pts
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {t("hero.months")}
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[11px] text-muted-foreground font-medium mb-1">
                    {t("hero.after")}
                  </span>
                  <div className="w-16 h-16 rounded-full border-4 border-accent/50 flex items-center justify-center bg-accent/10 shadow-md shadow-accent/20">
                    <span className="text-xl font-extrabold text-accent">
                      720
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1">
                    {t("hero.good")}
                  </span>
                </div>
              </div>
              {/* Stat strip */}
              <div className="border-t border-border grid grid-cols-3 divide-x divide-border">
                {[
                  { value: "98%", label: t("hero.success") },
                  { value: "15K+", label: t("hero.clients") },
                  { value: "~6mo", label: t("hero.avgTime") },
                ].map(({ value, label }) => (
                  <div
                    key={label}
                    className="flex flex-col items-center py-2.5"
                  >
                    <span className="text-sm font-extrabold text-foreground">
                      {value}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* CTAs */}
          <div
            className="flex flex-col gap-3 animate-fade-up"
            style={{ animationDelay: "0.2s" }}
          >
            <Link
              to="/register"
              className="btn-primary w-full flex items-center justify-center gap-2 h-13 text-base shadow-lg shadow-primary/20 hover:shadow-primary/30 group"
            >
              {t("hero.ctaMain")}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <a
              href="#how-it-works"
              className="btn-secondary w-full flex items-center justify-center h-12 text-sm"
            >
              {t("hero.ctaSeeHow")}
            </a>
          </div>

          {/* Social proof strip */}
          <div
            className="flex items-center justify-center gap-3 animate-fade-up"
            style={{ animationDelay: "0.28s" }}
          >
            <div className="flex items-center gap-0.5">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400"
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground font-medium">
              {t("hero.trustBadge1")}
            </span>
          </div>
        </div>
      </section>

      {/* ── DESKTOP hero (hidden on mobile) ─────────────────────────── */}
      <section className="hidden md:block section-container relative overflow-hidden pt-32">
        {/* Background orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-10 right-20 w-72 h-72 bg-primary/5 rounded-full blur-3xl animate-float" />
          <div
            className="absolute bottom-10 left-10 w-80 h-80 bg-accent/5 rounded-full blur-3xl animate-float"
            style={{ animationDelay: "1s" }}
          />
        </div>

        <div className="section-inner relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12 items-center">
            {/* Left Content */}
            <div className="space-y-8">
              <div
                className="space-y-4 animate-fade-up"
                style={{ animationDelay: "0s" }}
              >
                <h1 className="text-5xl lg:text-6xl font-bold tracking-tight text-foreground leading-tight">
                  {t("hero.headline1")}{" "}
                  <span className="gradient-text inline-block">
                    {t("hero.headline2")}
                  </span>
                </h1>
                <p className="text-xl text-muted-foreground leading-relaxed max-w-lg">
                  {t("hero.bodyDesktop")}
                </p>
              </div>

              {/* CTAs */}
              <div
                className="flex flex-row gap-4 animate-fade-up"
                style={{ animationDelay: "0.2s" }}
              >
                <Link
                  to="/register"
                  className="btn-primary flex items-center justify-center gap-2 h-12 px-8 group hover:gap-3 transition-all duration-300 shadow-md hover:shadow-lg"
                >
                  {t("hero.ctaGetStarted")}{" "}
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <a
                  href="#how-it-works"
                  className="btn-secondary flex items-center justify-center gap-2 h-12 px-8 hover:bg-muted transition-colors duration-300"
                >
                  {t("hero.ctaSeeHow")}
                </a>
              </div>

              {/* Trust Indicators */}
              <div
                className="pt-4 space-y-3 animate-fade-up"
                style={{ animationDelay: "0.4s" }}
              >
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1 text-yellow-500">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-current" />
                    ))}
                  </div>
                  <span className="text-muted-foreground font-medium">
                    {t("hero.trustBadge1")}
                  </span>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-accent" />
                    <span className="font-medium">{t("hero.trustBadge2")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-accent" />
                    <span className="font-medium">{t("hero.trustBadge3")}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Visual */}
            <div
              className="animate-slide-in-right"
              style={{ animationDelay: "0.3s" }}
            >
              <CreditImprovementCard
                currentScore={580}
                projectedScore={720}
                improvement={140}
                months={6}
              />
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="section-container bg-secondary/30">
        <div className="section-inner">
          <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              {t("howItWorks.heading")}
            </h2>
            <p className="text-lg text-muted-foreground">
              {t("howItWorks.subheading")}
            </p>
          </div>

          {/* Steps Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-4">
            {[
              {
                number: "01",
                title: t("howItWorks.step1Title"),
                description: t("howItWorks.step1Body"),
                icon: <Zap className="w-6 h-6" />,
              },
              {
                number: "02",
                title: t("howItWorks.step2Title"),
                description: t("howItWorks.step2Body"),
                icon: <Lock className="w-6 h-6" />,
              },
              {
                number: "03",
                title: t("howItWorks.step3Title"),
                description: t("howItWorks.step3Body"),
                icon: <TrendingUp className="w-6 h-6" />,
              },
              {
                number: "04",
                title: t("howItWorks.step4Title"),
                description: t("howItWorks.step4Body"),
                icon: <MessageSquare className="w-6 h-6" />,
              },
            ].map((step, index) => (
              <div key={index} className="relative">
                {/* Step Card */}
                <div className="card-hover p-6 md:p-5 h-full">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10 text-primary mb-4">
                    {step.icon}
                  </div>
                  <div className="text-xs font-semibold text-primary mb-2">
                    {step.number}
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>

                {/* Connection Arrow */}
                {index < 3 && (
                  <div className="hidden md:flex absolute -right-2 top-1/2 -translate-y-1/2 text-primary/20 z-10">
                    <ArrowRight className="w-5 h-5" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Packages Section */}
      <section id="packages" className="section-container">
        <div className="section-inner">
          <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              {t("packages.heading")}
            </h2>
            <p className="text-lg text-muted-foreground">
              {t("packages.subheading")}
            </p>
          </div>

          <PackagesPlanGrid
            packages={packages}
            loading={packagesLoading}
            mode="marketing"
            onSelectPlan={(slug) => navigate(`/register?plan=${slug}`)}
          />
        </div>
      </section>

      {/* Testimonials & Social Proof */}
      <section id="testimonials" className="section-container bg-secondary/30">
        <div className="section-inner">
          <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              {t("testimonials.heading")}
            </h2>
            <p className="text-lg text-muted-foreground">
              {t("testimonials.subheading")}
            </p>
          </div>

          {/* Testimonials Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {[
              {
                name: "Sarah Johnson",
                role: "Small Business Owner",
                image: "SJ",
                rating: 5,
                text: "My credit score jumped from 520 to 680 in just 6 months. The team was professional and kept me informed every step of the way.",
              },
              {
                name: "Michael Chen",
                role: "Freelancer",
                image: "MC",
                rating: 5,
                text: "I was skeptical at first, but the results speak for themselves. I got approved for a mortgage I never thought I'd qualify for.",
              },
              {
                name: "Jessica Martinez",
                role: "Marketing Manager",
                image: "JM",
                rating: 5,
                text: "Best decision I made for my financial future. The support team answered all my questions and made the process stress-free.",
              },
            ].map((testimonial, idx) => (
              <div key={idx} className="card-base p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                    {testimonial.image}
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground">
                      {testimonial.name}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {testimonial.role}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star
                      key={i}
                      className="w-4 h-4 fill-yellow-500 text-yellow-500"
                    />
                  ))}
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  "{testimonial.text}"
                </p>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 bg-card rounded-lg border border-border p-8">
            <div className="text-center">
              <div className="text-4xl font-bold text-primary mb-2">15K+</div>
              <p className="text-sm text-muted-foreground">Happy Clients</p>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-accent mb-2">98%</div>
              <p className="text-sm text-muted-foreground">Success Rate</p>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-primary mb-2">
                140 pts
              </div>
              <p className="text-sm text-muted-foreground">
                Avg Score Increase
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Process Transparency */}
      <section className="section-container">
        <div className="section-inner">
          <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              Complete Transparency
            </h2>
            <p className="text-lg text-muted-foreground">
              Understand exactly what happens at each stage of your repair
              journey.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Monthly Rounds */}
            <div className="card-base p-8">
              <div className="flex items-center gap-3 mb-4">
                <TrendingUp className="w-6 h-6 text-primary" />
                <h3 className="text-xl font-bold">Monthly Rounds</h3>
              </div>
              <p className="text-muted-foreground mb-4">
                Each month we file a new round of disputes with the three credit
                bureaus for inaccurate or outdated items on your report.
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <span className="text-primary font-bold">→</span>
                  <span className="text-muted-foreground">
                    Initial assessment and strategy
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-primary font-bold">→</span>
                  <span className="text-muted-foreground">
                    File disputes with bureaus
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-primary font-bold">→</span>
                  <span className="text-muted-foreground">
                    Monitor responses (30-45 days)
                  </span>
                </li>
              </ul>
            </div>

            {/* SMS & Portal */}
            <div className="card-base p-8">
              <div className="flex items-center gap-3 mb-4">
                <MessageSquare className="w-6 h-6 text-accent" />
                <h3 className="text-xl font-bold">SMS Updates & Portal</h3>
              </div>
              <p className="text-muted-foreground mb-4">
                Stay informed with regular updates. Access your personal client
                portal anytime to view your progress and upcoming actions.
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <span className="text-accent font-bold">→</span>
                  <span className="text-muted-foreground">
                    Real-time SMS notifications
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent font-bold">→</span>
                  <span className="text-muted-foreground">
                    24/7 portal access
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent font-bold">→</span>
                  <span className="text-muted-foreground">
                    Detailed progress reports
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* Security */}
          <div className="mt-8 bg-card border border-border rounded-lg p-8">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-6 h-6 text-primary" />
              <h3 className="text-xl font-bold">Bank-Level Security</h3>
            </div>
            <p className="text-muted-foreground">
              Your financial information is protected with 256-bit SSL
              encryption, FDIC-grade security protocols, and strict privacy
              compliance with CCPA and GDPR regulations.
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="section-container bg-gradient-to-br from-primary/5 to-accent/5 border-t border-b border-border">
        <div className="section-inner">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              Ready to Fix Your Credit?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Join thousands of people who've improved their financial lives.
              Start your free consultation today.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/register"
                className="btn-primary w-full sm:w-auto h-12 px-8 flex items-center justify-center gap-2"
              >
                Start Your Journey <ArrowRight className="w-5 h-5" />
              </Link>
              <a
                href="#packages"
                className="btn-secondary w-full sm:w-auto h-12 px-8 flex items-center justify-center"
              >
                Schedule a Call
              </a>
            </div>
            <p className="text-sm text-muted-foreground mt-6">
              No credit card required. Free 15-minute consultation.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

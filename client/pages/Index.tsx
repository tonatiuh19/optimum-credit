import { ArrowRight, Star, CheckCircle, Shield, Zap, TrendingUp, MessageSquare, Lock } from "lucide-react";
import { useState } from "react";
import CreditImprovementCard from "@/components/CreditImprovementCard";

export default function Index() {
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);

  return (
    <div className="w-full">
      {/* Hero Section */}
      <section className="section-container relative overflow-hidden pt-20 md:pt-32">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-10 right-20 w-72 h-72 bg-primary/5 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-10 left-10 w-80 h-80 bg-accent/5 rounded-full blur-3xl animate-float" style={{ animationDelay: "1s" }} />
        </div>

        <div className="section-inner relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
            {/* Left Content */}
            <div className="space-y-6 md:space-y-8">
              <div className="space-y-4 animate-fade-up" style={{ animationDelay: "0s" }}>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground leading-tight">
                  Fix Your Credit.{" "}
                  <span className="gradient-text inline-block">Start Today.</span>
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-lg">
                  Stop waiting for better credit. Our expert team removes negative items, improves your score, and opens doors to better rates and opportunities.
                </p>
              </div>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-4 pt-4 animate-fade-up" style={{ animationDelay: "0.2s" }}>
                <button className="btn-primary w-full sm:w-auto flex items-center justify-center gap-2 h-12 px-8 group hover:gap-3 transition-all duration-300 shadow-md hover:shadow-lg">
                  Get Started <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                </button>
                <button className="btn-secondary w-full sm:w-auto flex items-center justify-center gap-2 h-12 px-8 hover:bg-muted transition-colors duration-300">
                  See How It Works
                </button>
              </div>

              {/* Trust Indicators */}
              <div className="pt-4 space-y-3 animate-fade-up" style={{ animationDelay: "0.4s" }}>
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1 text-yellow-500">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-current" />
                    ))}
                  </div>
                  <span className="text-muted-foreground font-medium">
                    Trusted by 15,000+ clients
                  </span>
                </div>
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2 group cursor-pointer">
                    <CheckCircle className="w-4 h-4 text-accent group-hover:scale-110 transition-transform" />
                    <span className="group-hover:text-foreground transition-colors font-medium">98% Success Rate</span>
                  </div>
                  <div className="flex items-center gap-2 group cursor-pointer">
                    <CheckCircle className="w-4 h-4 text-accent group-hover:scale-110 transition-transform" />
                    <span className="group-hover:text-foreground transition-colors font-medium">Avg 140 Points Up</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Visual - Interactive Credit Improvement Card */}
            <div className="animate-slide-in-right" style={{ animationDelay: "0.3s" }}>
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
              How It Works
            </h2>
            <p className="text-lg text-muted-foreground">
              A simple, transparent process designed to fix your credit efficiently and effectively.
            </p>
          </div>

          {/* Steps Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-4">
            {[
              {
                number: "01",
                title: "Choose Your Plan",
                description: "Select the package that matches your credit situation and goals.",
                icon: <Zap className="w-6 h-6" />,
              },
              {
                number: "02",
                title: "Upload Documents",
                description: "Securely share your credit reports and financial documents.",
                icon: <Lock className="w-6 h-6" />,
              },
              {
                number: "03",
                title: "We Fix Your Credit",
                description: "Our experts challenge negative items and dispute inaccuracies.",
                icon: <TrendingUp className="w-6 h-6" />,
              },
              {
                number: "04",
                title: "Track Progress",
                description: "Monitor improvements in real-time via your personal dashboard.",
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
              Simple, Transparent Pricing
            </h2>
            <p className="text-lg text-muted-foreground">
              Choose the package that fits your needs. No hidden fees, no surprises.
            </p>
          </div>

          {/* Packages Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                id: "standard",
                name: "Standard",
                subtitle: "For First-Time Filers",
                price: "$599",
                duration: "6 months",
                description: "Perfect for those new to credit repair with a few negative items.",
                benefits: [
                  "Credit report analysis",
                  "Up to 10 dispute letters",
                  "Monthly progress reports",
                  "Email support",
                  "Client portal access",
                ],
                cta: "Select Plan",
                popular: false,
              },
              {
                id: "complex",
                name: "Complex",
                subtitle: "Most Popular",
                price: "$899",
                duration: "12 months",
                description: "Comprehensive repair for multiple negative items and complex situations.",
                benefits: [
                  "Everything in Standard",
                  "Unlimited dispute letters",
                  "Bi-weekly progress updates",
                  "Phone & email support",
                  "Specialized negotiation",
                  "Collections handling",
                ],
                cta: "Select Plan",
                popular: true,
              },
              {
                id: "tradeline",
                name: "Tradeline",
                subtitle: "Maximum Results",
                price: "$1,299",
                duration: "12 months",
                description: "Premium service with authorized user accounts to boost your score.",
                benefits: [
                  "Everything in Complex",
                  "Authorized user tradelines",
                  "Weekly priority calls",
                  "Personal credit coach",
                  "Hardship negotiations",
                  "Bankruptcy assistance",
                ],
                cta: "Select Plan",
                popular: false,
              },
            ].map((pkg) => (
              <div
                key={pkg.id}
                className={`card-base overflow-hidden transition-all duration-300 ${
                  pkg.popular ? "md:scale-105 border-primary shadow-lg" : ""
                } ${selectedPackage === pkg.id ? "ring-2 ring-primary" : ""}`}
                onClick={() => setSelectedPackage(pkg.id)}
              >
                {pkg.popular && (
                  <div className="bg-gradient-to-r from-primary to-primary-600 text-primary-foreground py-2 px-4 text-center text-sm font-semibold">
                    Most Popular
                  </div>
                )}

                <div className="p-6 md:p-8">
                  <h3 className="text-2xl font-bold mb-1">{pkg.name}</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {pkg.subtitle}
                  </p>

                  <div className="mb-6">
                    <div className="text-4xl font-bold text-foreground mb-1">
                      {pkg.price}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      per service • {pkg.duration}
                    </p>
                  </div>

                  <p className="text-sm text-muted-foreground mb-6">
                    {pkg.description}
                  </p>

                  <button
                    className={`w-full h-12 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${
                      pkg.popular
                        ? "btn-primary"
                        : "btn-secondary"
                    }`}
                  >
                    {pkg.cta}
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <div className="mt-8 space-y-3">
                    {pkg.benefits.map((benefit, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-muted-foreground">
                          {benefit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials & Social Proof */}
      <section id="testimonials" className="section-container bg-secondary/30">
        <div className="section-inner">
          <div className="max-w-3xl mx-auto text-center mb-12 md:mb-16">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
              Trusted by Thousands
            </h2>
            <p className="text-lg text-muted-foreground">
              Real results from real people. See how we've transformed credit profiles.
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
              <div className="text-4xl font-bold text-primary mb-2">140 pts</div>
              <p className="text-sm text-muted-foreground">Avg Score Increase</p>
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
              Understand exactly what happens at each stage of your repair journey.
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
                Each month we file a new round of disputes with the three credit bureaus for inaccurate or outdated items on your report.
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <span className="text-primary font-bold">→</span>
                  <span className="text-muted-foreground">Initial assessment and strategy</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-primary font-bold">→</span>
                  <span className="text-muted-foreground">File disputes with bureaus</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-primary font-bold">→</span>
                  <span className="text-muted-foreground">Monitor responses (30-45 days)</span>
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
                Stay informed with regular updates. Access your personal client portal anytime to view your progress and upcoming actions.
              </p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2">
                  <span className="text-accent font-bold">→</span>
                  <span className="text-muted-foreground">Real-time SMS notifications</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent font-bold">→</span>
                  <span className="text-muted-foreground">24/7 portal access</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent font-bold">→</span>
                  <span className="text-muted-foreground">Detailed progress reports</span>
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
              Your financial information is protected with 256-bit SSL encryption, FDIC-grade security protocols, and strict privacy compliance with CCPA and GDPR regulations.
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
              Join thousands of people who've improved their financial lives. Start your free consultation today.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="btn-primary w-full sm:w-auto h-12 px-8 flex items-center justify-center gap-2">
                Start Your Journey <ArrowRight className="w-5 h-5" />
              </button>
              <button className="btn-secondary w-full sm:w-auto h-12 px-8">
                Schedule a Call
              </button>
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

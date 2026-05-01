import type { ReactNode } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  FileText,
  BarChart3,
  CircleDot,
  Quote,
} from "lucide-react";

interface Props {
  variant: "client" | "admin";
}

// Stagger helper — applies fade-up animation with delay and fill-mode both
function Stagger({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={`animate-fade-up ${className}`}
      style={{ animationDelay: `${delay}s`, animationFillMode: "both" }}
    >
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const BRAND_CONTENT = {
  admin: {
    badge: "Staff Access · Optimum Credit",
    headline: "Welcome back,",
    headlineAccent: "good to see you.",
    description:
      "Your team's tools are ready. Sign in to manage clients, review disputes, and keep things moving.",
    features: [
      { icon: Users, text: "Your clients are waiting on you" },
      { icon: CircleDot, text: "Disputes in progress need attention" },
      { icon: BarChart3, text: "Today's pipeline is up to date" },
    ],
    testimonial: {
      quote:
        "Every sign-in is a chance to change someone's financial future. Thank you for the work you do.",
      author: "Optimum Credit Team",
      role: "Internal · Staff Message",
    },
  },
  client: {
    badge: "Trusted by 5,000+ Clients",
    headline: "Your credit score,",
    headlineAccent: "finally working for you.",
    description:
      "Expert-guided disputes, AI-powered strategies, and a dedicated team — all in one place.",
    features: [
      { icon: TrendingUp, text: "Average 87-point score increase" },
      { icon: FileText, text: "Real-time dispute tracking" },
      { icon: ShieldCheck, text: "Dedicated expert assigned to you" },
    ],
    testimonial: {
      quote:
        "My score went from 582 to 718 in just 4 months. This platform changed my life.",
      author: "Jennifer R.",
      role: "Verified Client · Dallas, TX",
    },
  },
};

const STATS = [
  { value: "5,000+", label: "Clients Helped" },
  { value: "+87pts", label: "Avg. Score Lift" },
  { value: "98%", label: "Satisfaction" },
];

export default function AuthBrandPanel({ variant }: Props) {
  const content = BRAND_CONTENT[variant];

  return (
    <div className="hidden lg:flex h-full relative overflow-hidden bg-[#040a18]">
      {/* ── Video background ── */}
      <video
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 0.2 }}
      >
        <source
          src="https://disruptinglabs.com/data/optimum/assets/videos/12894328-sd_540_960_24fps.mp4"
          type="video/mp4"
        />
        <source
          src="https://disruptinglabs.com/data/optimum/assets/videos/12894328-sd_540_960_24fps.mp4"
          type="video/mp4"
        />
      </video>

      {/* ── Gradient overlays ── */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#040a18]/98 via-[#040a18]/80 to-primary/[0.12]" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#040a18]/95 via-transparent to-[#040a18]/60" />

      {/* ── Subtle grid ── */}
      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(66,120,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(66,120,255,0.3) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* ── Glow orbs ── */}
      <div
        className="absolute -top-20 -right-20 w-96 h-96 rounded-full blur-3xl pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute bottom-0 -left-10 w-80 h-80 rounded-full blur-3xl pointer-events-none animate-pulse-glow"
        style={{
          background:
            "radial-gradient(circle, rgba(34,197,94,0.08) 0%, transparent 70%)",
          animationDelay: "1.5s",
        }}
      />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full blur-3xl pointer-events-none animate-pulse-glow"
        style={{
          background:
            "radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)",
          animationDelay: "3s",
        }}
      />

      {/* ── Content ── */}
      <div className="relative z-10 flex flex-col h-full w-full px-10 xl:px-14 py-10 xl:py-12">
        {/* Logo row — top right */}
        <Stagger delay={0} className="flex justify-end">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-gradient-to-br from-primary to-primary-600 rounded-xl flex items-center justify-center shadow-lg shadow-primary/30 flex-shrink-0">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-[14px] font-bold text-white leading-none tracking-tight">
                Optimum Credit
              </div>
              <div className="flex items-center gap-0.5 mt-1">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    className="w-2.5 h-2.5 fill-yellow-400 text-yellow-400"
                  />
                ))}
                <span className="text-[10px] text-slate-500 ml-1.5 tracking-wide">
                  5.0 · BBB Accredited
                </span>
              </div>
            </div>
          </div>
        </Stagger>

        {/* ── Middle: headline + mockup side by side ── */}
        <div className="flex-1 flex flex-col justify-center gap-6 py-8">
          {/* Badge */}
          <Stagger delay={0.08}>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-primary/10 border border-primary/20 rounded-full w-fit">
              <Sparkles className="w-3 h-3 text-primary-200" />
              <span className="text-[11px] text-primary-200 font-medium tracking-wide">
                {content.badge}
              </span>
            </div>
          </Stagger>

          {/* Headline */}
          <Stagger delay={0.14}>
            <h2 className="text-[2rem] xl:text-[2.4rem] font-bold text-white leading-[1.2] tracking-tight">
              {content.headline}
              <br />
              <span className="bg-gradient-to-r from-primary-100 via-primary-200 to-accent bg-clip-text text-transparent">
                {content.headlineAccent}
              </span>
            </h2>
            <p className="text-slate-400 text-[13px] xl:text-sm leading-relaxed mt-3 max-w-[320px]">
              {content.description}
            </p>
          </Stagger>

          {/* Features */}
          <div className="space-y-2.5">
            {content.features.map(({ icon: Icon, text }, i) => (
              <Stagger key={text} delay={0.22 + i * 0.08}>
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <span className="text-[13px] text-slate-300 font-medium">
                    {text}
                  </span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-accent/60 ml-auto flex-shrink-0" />
                </div>
              </Stagger>
            ))}
          </div>
        </div>

        {/* ── Bottom area ── */}
        <div className="space-y-4">
          {/* Testimonial */}
          <Stagger delay={0.5}>
            <div className="flex gap-3 bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
              <Quote className="w-4 h-4 text-primary-200/60 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[12px] text-slate-300 leading-relaxed italic">
                  "{content.testimonial.quote}"
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-5 h-5 rounded-full bg-primary/30 flex items-center justify-center text-[9px] font-bold text-white">
                    {content.testimonial.author[0]}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    <span className="text-slate-400 font-medium">
                      {content.testimonial.author}
                    </span>
                    {" · "}
                    {content.testimonial.role}
                  </p>
                </div>
              </div>
            </div>
          </Stagger>

          {/* Stats */}
          <Stagger delay={0.58}>
            <div className="grid grid-cols-3 gap-2">
              {STATS.map(({ value, label }, i) => (
                <div
                  key={label}
                  className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 text-center"
                >
                  <div
                    className={`text-xl font-bold leading-none mb-1 ${
                      i === 0
                        ? "text-white"
                        : i === 1
                          ? "text-primary-200"
                          : "text-accent"
                    }`}
                  >
                    {value}
                  </div>
                  <div className="text-[9px] text-slate-600 uppercase tracking-widest leading-tight">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </Stagger>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  ArrowLeft,
  ShieldCheck,
  Mail,
  Loader2,
  Sparkles,
  Star,
  CheckCircle,
  TrendingUp,
  Quote,
  BadgeCheck,
  PartyPopper,
  Clock,
} from "lucide-react";
import PageMeta from "@/components/PageMeta";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import OtpInput from "@/components/OtpInput";
import {
  requestClientOtp,
  verifyClientOtp,
} from "@/store/slices/clientAuthSlice";

const VIDEO_URL =
  "https://disruptinglabs.com/data/optimum/assets/videos/5159096-sd_338_640_25fps.mp4";

const STATS = [
  { value: "5,000+", label: "Families supported", icon: BadgeCheck },
  { value: "+87 pts", label: "Avg improvement", icon: TrendingUp },
  { value: "4.9 / 5", label: "Client satisfaction", icon: Star },
];

export default function ClientLogin() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state || {}) as {
    justRegistered?: boolean;
    expiredOnboarding?: boolean;
    email?: string;
  };
  const { requestingOtp, verifyingOtp, error, otpSentTo } = useAppSelector(
    (s) => s.clientAuth,
  );
  const [step, setStep] = useState<"email" | "code">("email");

  const emailForm = useFormik({
    initialValues: { email: locationState.email || "" },
    validationSchema: Yup.object({
      email: Yup.string().email("Invalid email").required("Required"),
    }),
    onSubmit: async (values) => {
      const result = await dispatch(requestClientOtp({ email: values.email }));
      if (requestClientOtp.fulfilled.match(result)) setStep("code");
    },
  });

  const codeForm = useFormik({
    initialValues: { code: "" },
    validationSchema: Yup.object({
      code: Yup.string()
        .matches(/^\d{6}$/, "6-digit code")
        .required("Required"),
    }),
    onSubmit: async (values) => {
      const email = otpSentTo || emailForm.values.email;
      const result = await dispatch(
        verifyClientOtp({ email, code: values.code }),
      );
      if (verifyClientOtp.fulfilled.match(result)) {
        navigate("/portal", { replace: true });
      }
    },
  });

  return (
    <div className="h-screen overflow-hidden flex">
      <PageMeta
        title="Client Portal Login"
        description="Log in to your Optimum Credit client portal to track your credit repair progress, view documents, and message your team."
        canonical="/portal/login"
        noIndex={true}
      />
      {/* ── Left: Form column ── */}
      <div className="flex-1 lg:max-w-[480px] bg-gradient-to-br from-primary/5 via-background to-accent/5 flex flex-col overflow-y-auto">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border/60 shrink-0">
          <div className="px-6 h-16 flex items-center justify-between">
            <Link
              to="/"
              className="flex items-center transition-opacity hover:opacity-80"
            >
              <img
                src="https://disruptinglabs.com/data/optimum/assets/images/logo_horizontal_gold_121829_text.png"
                alt="Optimum Credit"
                className="h-8 w-auto"
              />
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </Link>
          </div>
        </header>

        {/* Form body */}
        <div className="flex-1 flex flex-col justify-center px-5 sm:px-8 py-8 sm:py-10">
          <div className="w-full max-w-sm mx-auto animate-fade-up">
            {/* Icon + heading */}
            <div className="flex flex-col items-center text-center mb-8">
              {locationState.justRegistered && step === "email" && (
                <div className="w-full mb-5 flex items-start gap-3 bg-accent/10 border border-accent/30 rounded-xl px-4 py-3 text-left">
                  <PartyPopper className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                  <p className="text-sm text-foreground">
                    <strong>Payment confirmed!</strong> Your account is ready.
                    Enter your email below and we'll send you a sign-in code.
                  </p>
                </div>
              )}
              {locationState.expiredOnboarding && step === "email" && (
                <div className="w-full mb-5 flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-left">
                  <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-foreground">
                    <strong>Your link has expired.</strong> No worries — sign in
                    below with your email and we'll send you a secure code so
                    you can upload your documents.
                  </p>
                </div>
              )}
              <div className="w-14 h-14 bg-gradient-to-br from-primary to-primary-600 rounded-2xl flex items-center justify-center mb-5 shadow-lg shadow-primary/30">
                <ShieldCheck className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-foreground leading-tight mb-1.5">
                {step === "email" ? (
                  <>
                    Welcome <span className="gradient-text">back</span>
                  </>
                ) : (
                  "Check your email"
                )}
              </h1>
              <p className="text-sm text-muted-foreground max-w-xs">
                {step === "email"
                  ? "Enter your email to receive a secure one-time sign-in code."
                  : `We sent a 6-digit code to ${otpSentTo || emailForm.values.email}`}
              </p>
            </div>

            {step === "email" ? (
              <form onSubmit={emailForm.handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <input
                      type="email"
                      {...emailForm.getFieldProps("email")}
                      className="w-full h-12 pl-10 pr-4 rounded-xl border border-input bg-background hover:border-primary/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground/60 transition-all"
                      placeholder="you@example.com"
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                  {emailForm.touched.email && emailForm.errors.email && (
                    <p className="text-xs text-destructive mt-1.5">
                      {emailForm.errors.email}
                    </p>
                  )}
                </div>

                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-4 py-3 rounded-xl">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={requestingOtp}
                  className="w-full btn-primary rounded-xl gap-2"
                >
                  {requestingOtp ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Sending code…
                    </>
                  ) : (
                    "Continue"
                  )}
                </button>

                <div className="relative my-2">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="px-3 bg-background text-muted-foreground">
                      New here?
                    </span>
                  </div>
                </div>

                <Link
                  to="/register"
                  className="w-full btn-secondary rounded-xl gap-2 flex items-center justify-center"
                >
                  <Sparkles className="w-4 h-4 text-primary" />
                  Start your credit journey
                </Link>
              </form>
            ) : (
              <form onSubmit={codeForm.handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3 text-center">
                    Verification code
                  </label>
                  <OtpInput
                    value={codeForm.values.code}
                    onChange={(val) => codeForm.setFieldValue("code", val)}
                    autoFocus
                    hasError={!!(codeForm.touched.code && codeForm.errors.code)}
                  />
                  {codeForm.touched.code && codeForm.errors.code && (
                    <p className="text-xs text-destructive mt-2 text-center">
                      {codeForm.errors.code}
                    </p>
                  )}
                </div>

                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-4 py-3 rounded-xl">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={verifyingOtp}
                  className="w-full btn-primary rounded-xl gap-2"
                >
                  {verifyingOtp ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
                    </>
                  ) : (
                    "Sign in to Portal"
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  ← Use a different email
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-8 pb-6 shrink-0">
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground mb-4">
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 text-accent" />
              <span>256-bit encrypted</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-accent" />
              <span>Avg +87 pts boost</span>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground/50">
            © {new Date().getFullYear()} Optimum Credit Repair
          </p>
        </div>
      </div>

      {/* ── Right: Video brand panel ── */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        {/* Fallback gradient — sits below the video, visible while loading */}
        <div
          className="absolute inset-0 bg-gradient-to-br from-[#0a1628] via-[#0f2444] to-[#051022]"
          style={{ zIndex: 0 }}
        />

        {/* Video background */}
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ zIndex: 1, filter: "brightness(0.55)" }}
        >
          <source src={VIDEO_URL} type="video/mp4" />
        </video>

        {/* Gradient overlays for depth */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/40"
          style={{ zIndex: 2 }}
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent"
          style={{ zIndex: 2 }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between h-full p-12 text-white">
          {/* Top: badge */}
          <div>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-xs font-medium text-white/90">
              <ShieldCheck className="w-3.5 h-3.5 text-accent" />
              Your dedicated team is here for you
            </span>
          </div>

          {/* Middle: headline */}
          <div className="space-y-8">
            <div className="space-y-4 max-w-lg">
              <h2 className="text-4xl xl:text-5xl font-bold leading-tight text-white drop-shadow-md">
                Welcome back —{" "}
                <span className="text-accent">we've been working</span> hard for
                you.
              </h2>
              <p className="text-base text-white/70 leading-relaxed max-w-md">
                Your progress is waiting. Log in to see everything we've been
                doing on your behalf, ask us anything, and stay in the loop —
                every step of the way.
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              {STATS.map(({ value, label, icon: Icon }) => (
                <div
                  key={label}
                  className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl px-4 py-4 text-center"
                >
                  <Icon className="w-5 h-5 text-accent mx-auto mb-2" />
                  <div className="text-xl font-bold text-white">{value}</div>
                  <div className="text-[11px] text-white/60 mt-0.5 leading-tight">
                    {label}
                  </div>
                </div>
              ))}
            </div>

            {/* Testimonial */}
            <div className="bg-white/8 backdrop-blur-sm border border-white/12 rounded-2xl p-6 max-w-lg">
              <Quote className="w-6 h-6 text-accent mb-3 opacity-80" />
              <p className="text-sm text-white/85 leading-relaxed italic">
                "I finally felt like someone was truly in my corner. They
                explained everything clearly, kept me updated, and never made me
                feel lost. My score went from 511 to 724 in 8 months."
              </p>
              <div className="flex items-center gap-3 mt-4">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center text-sm font-bold text-white shadow-md">
                  M
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">
                    Maria T.
                  </div>
                  <div className="flex items-center gap-0.5 mt-0.5">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className="w-3 h-3 fill-yellow-400 text-yellow-400"
                      />
                    ))}
                    <span className="text-[10px] text-white/50 ml-1">
                      Verified client
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom: privacy note */}
          <p className="text-[11px] text-white/35">
            Your information is 100% private and secure. We will never share or
            sell your data — ever.
          </p>
        </div>
      </div>
    </div>
  );
}

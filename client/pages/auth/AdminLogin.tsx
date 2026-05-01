import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  ArrowLeft,
  ShieldCheck,
  Mail,
  Loader2,
  Star,
  CheckCircle,
  TrendingUp,
  Quote,
  Users,
  FileText,
  Activity,
} from "lucide-react";
import PageMeta from "@/components/PageMeta";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { requestAdminOtp, verifyAdminOtp } from "@/store/slices/adminAuthSlice";
import OtpInput from "@/components/OtpInput";

const VIDEO_URL =
  "https://disruptinglabs.com/data/optimum/assets/videos/12894328-sd_540_960_24fps.mp4";

const STATS = [
  { value: "2,500+", label: "Clients served", icon: Users },
  { value: "10K+", label: "Disputes filed", icon: FileText },
  { value: "98%", label: "Satisfaction rate", icon: Activity },
];

export default function AdminLogin() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { requestingOtp, verifyingOtp, error, otpSentTo } = useAppSelector(
    (s) => s.adminAuth,
  );
  const [step, setStep] = useState<"email" | "code">("email");

  const emailForm = useFormik({
    initialValues: { email: "" },
    validationSchema: Yup.object({
      email: Yup.string().email("Invalid email").required("Required"),
    }),
    onSubmit: async (values) => {
      const result = await dispatch(requestAdminOtp({ email: values.email }));
      if (requestAdminOtp.fulfilled.match(result)) setStep("code");
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
        verifyAdminOtp({ email, code: values.code }),
      );
      if (verifyAdminOtp.fulfilled.match(result)) {
        navigate("/admin", { replace: true });
      }
    },
  });

  return (
    <div className="h-screen overflow-hidden flex">
      <PageMeta
        title="Staff Console"
        description="Secure admin login for Optimum Credit staff."
        canonical="/admin/login"
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
              <div className="w-14 h-14 bg-gradient-to-br from-primary to-primary-600 rounded-2xl flex items-center justify-center mb-5 shadow-lg shadow-primary/30">
                <ShieldCheck className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-foreground leading-tight mb-1.5">
                {step === "email" ? (
                  <>
                    Sign in to <span className="gradient-text">Console</span>
                  </>
                ) : (
                  "Check your inbox"
                )}
              </h1>
              <p className="text-sm text-muted-foreground max-w-xs">
                {step === "email"
                  ? "Enter your admin email to receive a secure one-time sign-in code."
                  : `We sent a 6-digit code to ${otpSentTo || emailForm.values.email}`}
              </p>
            </div>

            {step === "email" ? (
              <form onSubmit={emailForm.handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Admin email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <input
                      type="email"
                      {...emailForm.getFieldProps("email")}
                      className="w-full h-12 pl-10 pr-4 rounded-xl border border-input bg-background hover:border-primary/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground/60 transition-all"
                      placeholder="admin@optimumcreditrepair.com"
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
                    "Sign in to Console"
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
              <span>Staff access only</span>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground/50">
            © {new Date().getFullYear()} Optimum Credit Repair · Internal use
            only
          </p>
        </div>
      </div>

      {/* ── Right: Video brand panel ── */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        {/* Fallback gradient */}
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

        {/* Gradient overlays */}
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
              Optimum Credit — Staff Console
            </span>
          </div>

          {/* Middle: headline */}
          <div className="space-y-8">
            <div className="space-y-4 max-w-lg">
              <h2 className="text-4xl xl:text-5xl font-bold leading-tight text-white drop-shadow-md">
                Every client depends{" "}
                <span className="text-accent">on what you do</span> next.
              </h2>
              <p className="text-base text-white/70 leading-relaxed max-w-md">
                Manage pipelines, review documents, communicate with clients,
                and drive real results — all from one place built for your team.
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

            {/* Quote */}
            <div className="bg-white/8 backdrop-blur-sm border border-white/12 rounded-2xl p-6 max-w-lg">
              <Quote className="w-6 h-6 text-accent mb-3 opacity-80" />
              <p className="text-sm text-white/85 leading-relaxed italic">
                "The console gives us everything we need in one view — client
                status, documents, disputes, and messaging. It's transformed how
                our team operates day-to-day."
              </p>
              <div className="flex items-center gap-3 mt-4">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center text-sm font-bold text-white shadow-md">
                  J
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">
                    Jessica R.
                  </div>
                  <div className="flex items-center gap-0.5 mt-0.5">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className="w-3 h-3 fill-yellow-400 text-yellow-400"
                      />
                    ))}
                    <span className="text-[10px] text-white/50 ml-1">
                      Senior Credit Advisor
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom: note */}
          <p className="text-[11px] text-white/35">
            Secured with end-to-end encryption · Staff access only
          </p>
        </div>
      </div>
    </div>
  );
}

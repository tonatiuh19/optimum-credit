import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ShieldCheck,
  Sparkles,
  Lock,
  Star,
  BadgeCheck,
  Loader2,
  CheckCircle,
  Mail,
  PartyPopper,
} from "lucide-react";
import PageMeta from "@/components/PageMeta";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPackages,
  submitRegistration,
  resetRegistration,
} from "@/store/slices/packagesSlice";
import api from "@/lib/api";
import type { RegistrationPayload } from "@shared/api";

const PUBLISHABLE_KEY = (import.meta as any).env
  ?.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe() {
  if (!stripePromise && PUBLISHABLE_KEY) {
    stripePromise = loadStripe(PUBLISHABLE_KEY);
  }
  return stripePromise;
}

const REG_SCHEMA = Yup.object({
  firstName: Yup.string().required("Required"),
  lastName: Yup.string().required("Required"),
  email: Yup.string().email("Invalid").required("Required"),
  phone: Yup.string(),
  addressLine1: Yup.string().required("Required"),
  addressLine2: Yup.string(),
  city: Yup.string().required("Required"),
  state: Yup.string().length(2, "2 letters").required("Required"),
  zip: Yup.string()
    .matches(/^\d{5}$/, "5 digits")
    .required("Required"),
  ssnLast4: Yup.string()
    .matches(/^\d{4}$/, "Last 4 digits")
    .required("Required"),
  affiliateCode: Yup.string(),
});

export default function Register() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { packages, loading, registration, registering, error } =
    useAppSelector((s) => s.packages);
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [paidEmail, setPaidEmail] = useState("");

  useEffect(() => {
    dispatch(fetchPackages());
    return () => {
      dispatch(resetRegistration());
    };
  }, [dispatch]);

  useEffect(() => {
    if (packages.length && !selectedSlug) {
      setSelectedSlug(packages[0].slug);
    }
  }, [packages, selectedSlug]);

  const form = useFormik<Omit<RegistrationPayload, "packageSlug">>({
    initialValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      zip: "",
      ssnLast4: "",
      affiliateCode: "",
    },
    validationSchema: REG_SCHEMA,
    onSubmit: async (values) => {
      const result = await dispatch(
        submitRegistration({ ...values, packageSlug: selectedSlug }),
      );
      if (submitRegistration.fulfilled.match(result)) {
        setDirection("forward");
        setStep(3);
      }
    },
  });

  const stripeP = useMemo(() => getStripe(), []);

  const goTo = (n: number) => {
    setDirection(n > step ? "forward" : "back");
    setStep(n);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex flex-col">
      <PageMeta
        title="Start Your Credit Repair"
        description="Create your Optimum Credit account and begin your journey to a better credit score. Fast setup, expert support, and results in as little as 6 months."
        canonical="/register"
        noIndex={false}
      />
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-border/60">
        <div className="container max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo */}
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

          {/* Back */}
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to home
          </Link>
        </div>
      </header>

      <div className="flex-1 container max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
        {/* Progress — hide on success */}
        {step < 4 && (
          <div className="flex items-center justify-center mb-10">
            {[
              { n: 1, label: "Choose plan" },
              { n: 2, label: "Your info" },
              { n: 3, label: "Payment" },
            ].map((s, i) => (
              <div key={s.n} className="flex items-center">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm transition-all duration-300 ${
                    step === s.n
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/40 scale-110 ring-4 ring-primary/20"
                      : step > s.n
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {step > s.n ? <Check className="w-4 h-4" /> : s.n}
                </div>
                <div
                  className={`ml-2 mr-4 text-sm font-medium hidden sm:inline transition-colors duration-300 ${
                    step >= s.n ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {s.label}
                </div>
                {i < 2 && (
                  <div
                    className={`w-8 sm:w-16 h-0.5 mr-4 transition-all duration-500 rounded-full ${
                      step > s.n ? "bg-primary" : "bg-border"
                    }`}
                  />
                )}
              </div>
            ))}{" "}
          </div>
        )}

        <div
          key={step}
          className={
            direction === "forward"
              ? "animate-slide-in-right"
              : "animate-slide-in-left"
          }
          style={{ animationFillMode: "both" }}
        >
          {step === 1 && (
            <div>
              <h1 className="text-3xl md:text-4xl font-bold mb-2 text-center">
                Pick the plan that fits your goals
              </h1>
              <p className="text-muted-foreground text-center mb-8">
                All plans include unlimited disputes, 24/7 portal access, and
                free cancellation.
              </p>

              {loading ? (
                <div className="grid md:grid-cols-3 gap-4">
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className="p-6 rounded-2xl border-2 border-border bg-card animate-pulse"
                    >
                      <div className="h-3.5 bg-muted rounded-md w-1/2 mb-5" />
                      <div className="h-9 bg-muted rounded-md w-1/3 mb-6" />
                      <div className="space-y-2.5">
                        {[...Array(5)].map((_, j) => (
                          <div
                            key={j}
                            className="h-2.5 bg-muted rounded-md"
                            style={{ width: `${90 - j * 10}%` }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid md:grid-cols-3 gap-4">
                  {packages.map((p, idx) => {
                    const isSelected = selectedSlug === p.slug;
                    const features: string[] = Array.isArray(p.features_json)
                      ? p.features_json
                      : typeof p.features_json === "string"
                        ? safeParse(p.features_json)
                        : [];
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedSlug(p.slug)}
                        className={`animate-fade-up text-left p-6 rounded-2xl border-2 transition-all duration-200 ${
                          isSelected
                            ? "border-primary bg-primary/5 shadow-lg scale-[1.02]"
                            : "border-border bg-card hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5"
                        }`}
                        style={{
                          animationDelay: `${idx * 0.08}s`,
                          animationFillMode: "both",
                        }}
                      >
                        {p.slug === "complex" && (
                          <div className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide bg-primary text-primary-foreground px-2.5 py-1 rounded-full mb-3">
                            <Sparkles className="w-3 h-3" /> Most Popular
                          </div>
                        )}
                        <h3 className="text-xl font-bold">{p.name}</h3>
                        {p.subtitle && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {p.subtitle}
                          </p>
                        )}
                        <div className="mt-4 mb-4">
                          <span className="text-4xl font-bold">
                            ${(p.price_cents / 100).toFixed(0)}
                          </span>
                          <span className="text-muted-foreground ml-1">
                            one-time
                          </span>
                        </div>
                        <ul className="space-y-2 text-sm">
                          {features.slice(0, 6).map((f, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                              <span>{f}</span>
                            </li>
                          ))}
                        </ul>
                        <div
                          className={`mt-5 text-sm font-semibold flex items-center gap-1 ${
                            isSelected
                              ? "text-primary"
                              : "text-muted-foreground"
                          }`}
                        >
                          {isSelected ? "Selected" : "Select"}
                          <ArrowRight className="w-4 h-4" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="text-center mt-8">
                <button
                  disabled={!selectedSlug}
                  onClick={() => goTo(2)}
                  className="btn-primary"
                >
                  Continue <ArrowRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <form
              onSubmit={form.handleSubmit}
              className="max-w-2xl mx-auto bg-card border border-border rounded-2xl p-6 md:p-8 shadow-lg"
            >
              <div className="flex items-start justify-between mb-1 gap-4">
                <h2 className="text-2xl font-bold">Tell us about you</h2>
                {import.meta.env.DEV && (
                  <button
                    type="button"
                    onClick={() =>
                      form.setValues({
                        firstName: "Lionel",
                        lastName: "Messi",
                        email: `alex@disruptinglabs.com`,
                        phone: "3055550123",
                        addressLine1: "123 Main St",
                        addressLine2: "",
                        city: "Miami",
                        state: "FL",
                        zip: "33101",
                        ssnLast4: "1234",
                        affiliateCode: "",
                      })
                    }
                    className="shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200 transition-colors"
                  >
                    🧪 Fill test data
                  </button>
                )}
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                We use this to verify your identity with the bureaus. Your
                information is encrypted.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field
                  form={form}
                  name="firstName"
                  label="First name"
                  index={0}
                />
                <Field
                  form={form}
                  name="lastName"
                  label="Last name"
                  index={1}
                />
                <Field
                  form={form}
                  name="email"
                  label="Email"
                  type="email"
                  index={2}
                />
                <Field
                  form={form}
                  name="phone"
                  label="Phone (optional)"
                  index={3}
                />
                <div className="sm:col-span-2">
                  <Field
                    form={form}
                    name="addressLine1"
                    label="Address"
                    index={4}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Field
                    form={form}
                    name="addressLine2"
                    label="Apt/Suite (optional)"
                    index={5}
                  />
                </div>
                <Field form={form} name="city" label="City" index={6} />
                <Field
                  form={form}
                  name="state"
                  label="State"
                  placeholder="FL"
                  index={7}
                />
                <Field form={form} name="zip" label="ZIP" index={8} />
                <Field
                  form={form}
                  name="ssnLast4"
                  label="Last 4 of SSN"
                  index={9}
                />
                <div className="sm:col-span-2">
                  <Field
                    form={form}
                    name="affiliateCode"
                    label="Referral code (optional)"
                    index={10}
                  />
                </div>
              </div>
              {error && (
                <div className="mt-4 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                  {error}
                </div>
              )}
              <div className="flex justify-between mt-8">
                <button
                  type="button"
                  onClick={() => goTo(1)}
                  className="btn-secondary"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={registering}
                  className="btn-primary gap-2"
                >
                  {registering ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      Continue to payment
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {step === 3 && registration && (
            <div className="max-w-xl mx-auto">
              {registration.isMock ? (
                // Dev-only: Stripe not configured, show sandbox bypass
                <div className="bg-card border border-amber-300 rounded-2xl p-8 shadow-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
                      <span className="text-lg">🧪</span>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold">Sandbox mode</h2>
                      <p className="text-xs text-muted-foreground">
                        Stripe is not configured in this environment
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">
                    Simulating a successful payment of{" "}
                    <strong>
                      ${((registration.amountCents || 0) / 100).toFixed(2)}
                    </strong>{" "}
                    for <strong>{registration.packageName}</strong>.
                  </p>
                  <SandboxConfirm
                    clientId={registration.clientId}
                    paymentIntentId={
                      registration.paymentIntentClientSecret.split(
                        "_secret_",
                      )[0]
                    }
                    onSuccess={() => {
                      setPaidEmail(form.values.email);
                      setStep(4);
                    }}
                  />
                </div>
              ) : (
                <Elements
                  stripe={stripeP}
                  options={{
                    clientSecret: registration.paymentIntentClientSecret,
                  }}
                >
                  <RealPayment
                    email={form.values.email}
                    clientId={registration.clientId}
                    onSuccess={() => {
                      setPaidEmail(form.values.email);
                      setStep(4);
                    }}
                  />
                </Elements>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="max-w-lg mx-auto text-center animate-fade-up">
              <div className="bg-card border border-border rounded-2xl p-10 shadow-lg">
                <div className="w-20 h-20 bg-gradient-to-br from-accent/20 to-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <PartyPopper className="w-10 h-10 text-accent" />
                </div>
                <h2 className="text-3xl font-bold mb-2">You're all set!</h2>
                <p className="text-muted-foreground mb-2">
                  Welcome to Optimum Credit. Your account is active and our team
                  has already been notified.
                </p>

                <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 mb-8 text-left space-y-3">
                  <div className="flex items-start gap-3">
                    <Mail className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    <p className="text-sm text-muted-foreground">
                      A confirmation email with your onboarding link has been
                      sent to{" "}
                      <strong className="text-foreground">{paidEmail}</strong>.
                      Check your inbox (and spam folder) — you can use that link
                      to skip the code step below.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    <p className="text-sm text-muted-foreground">
                      You can also sign in right now using the button below —
                      we'll send a one-time code to your email.
                    </p>
                  </div>
                </div>

                <button
                  onClick={() =>
                    navigate("/portal/login", {
                      replace: true,
                      state: { justRegistered: true, email: paidEmail },
                    })
                  }
                  className="w-full btn-primary rounded-xl gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Sign in to my portal
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-border/60 bg-background/60 backdrop-blur-sm mt-auto">
        {/* Trust badges */}
        <div className="container max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mb-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="w-3.5 h-3.5 text-accent" />
              <span>256-bit SSL encryption</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5 text-accent" />
              <span>Bank-level data security</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <BadgeCheck className="w-3.5 h-3.5 text-primary" />
              <span>BBB Accredited Business</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="w-3.5 h-3.5 text-accent" />
              <span>Cancel anytime, no hidden fees</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground/70">
            <span>
              © {new Date().getFullYear()} Optimum Credit. All rights reserved.
            </span>
            <span className="hidden sm:inline text-border">·</span>
            <a href="#" className="hover:text-foreground transition-colors">
              Privacy Policy
            </a>
            <span className="text-border">·</span>
            <a href="#" className="hover:text-foreground transition-colors">
              Terms of Service
            </a>
            <span className="text-border">·</span>
            <a href="#" className="hover:text-foreground transition-colors">
              Dispute Resolution
            </a>
            <span className="hidden sm:inline text-border">·</span>
            <span className="hidden sm:inline">
              Your information is never sold to third parties.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

function Field({
  form,
  name,
  label,
  type = "text",
  placeholder,
  index = 0,
}: {
  form: any;
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  index?: number;
}) {
  const err = form.touched[name] && form.errors[name];
  return (
    <div
      className="animate-fade-up"
      style={{ animationDelay: `${0.04 * index}s`, animationFillMode: "both" }}
    >
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        {...form.getFieldProps(name)}
        className={`w-full h-11 px-3 rounded-lg border bg-input focus:outline-none focus:ring-2 focus:ring-primary ${
          err ? "border-destructive" : "border-border"
        }`}
      />
      {err && <p className="text-xs text-destructive mt-1">{String(err)}</p>}
    </div>
  );
}

function SandboxConfirm({
  clientId,
  paymentIntentId,
  onSuccess,
}: {
  clientId: number;
  paymentIntentId: string;
  onSuccess: () => void;
}) {
  const dispatch = useAppDispatch();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      await api.post("/registration/confirm-mock", {
        clientId,
        paymentIntentId,
      });
      onSuccess();
    } catch (e: any) {
      setErr(e?.response?.data?.error || "Failed to confirm payment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {err && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 px-4 py-3 rounded-xl mb-4">
          {err}
        </div>
      )}
      <button
        onClick={handleConfirm}
        disabled={submitting}
        className="w-full btn-primary rounded-xl gap-2"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Processing…
          </>
        ) : (
          "Simulate successful payment"
        )}
      </button>
    </>
  );
}

function RealPayment({
  email,
  clientId,
  onSuccess,
}: {
  email: string;
  clientId: number;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { registration } = useAppSelector((s) => s.packages);
  const [err, setErr] = useState<string | null>(null);
  const [errType, setErrType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || !registration) return;
    setBusy(true);
    setErr(null);
    setErrType(null);
    const card = elements.getElement(CardNumberElement);
    if (!card) {
      setErr("Card field not loaded. Please refresh the page.");
      setBusy(false);
      return;
    }
    const { error: stripeErr, paymentIntent } = await stripe.confirmCardPayment(
      registration.paymentIntentClientSecret,
      { payment_method: { card, billing_details: { email } } },
    );
    if (stripeErr) {
      setErr(stripeErr.message || "Payment failed");
      setErrType(stripeErr.code || stripeErr.type || null);
      setAttemptCount((c) => c + 1);
      setBusy(false);
      return;
    }
    if (paymentIntent?.status === "succeeded") {
      try {
        await api.post("/registration/confirm-payment", {
          clientId,
          paymentIntentId: paymentIntent.id,
        });
      } catch {
        // Non-fatal: webhook may still fire. Proceed to success screen.
      }
      onSuccess();
    } else {
      setErr(`Unexpected payment status: ${paymentIntent?.status}`);
      setAttemptCount((c) => c + 1);
    }
    setBusy(false);
  };

  // Derive a human-friendly hint based on Stripe error code
  const errHint = (() => {
    if (!errType) return null;
    if (errType.includes("insufficient_funds"))
      return "Your card has insufficient funds. Try a different card.";
    if (errType.includes("card_declined") || errType === "card_error")
      return "Your card was declined. Check your details or try a different card.";
    if (errType.includes("expired_card"))
      return "Your card is expired. Please use a different card.";
    if (errType.includes("incorrect_cvc") || errType.includes("invalid_cvc"))
      return "The CVC you entered is incorrect. Double-check the 3-digit code on the back of your card.";
    if (
      errType.includes("incorrect_number") ||
      errType.includes("invalid_number")
    )
      return "The card number is invalid. Please re-enter it carefully.";
    if (errType.includes("authentication_required") || errType.includes("3ds"))
      return "Your bank requires additional authentication. Please follow the prompt from your bank.";
    if (errType.includes("processing_error"))
      return "There was a temporary issue processing your card. Please try again in a moment.";
    return null;
  })();

  return (
    <form
      onSubmit={handlePay}
      className="bg-card border border-border rounded-2xl p-8 shadow-lg"
    >
      <h2 className="text-2xl font-bold mb-1">Secure payment</h2>
      <p className="text-sm text-muted-foreground mb-6">
        ${((registration?.amountCents || 0) / 100).toFixed(2)} ·{" "}
        {registration?.packageName}
      </p>

      {/* Card number */}
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Card number
          </label>
          <div
            className={`h-12 px-4 flex items-center border rounded-xl bg-background hover:border-primary/40 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all ${err ? "border-destructive" : "border-input"}`}
          >
            <CardNumberElement
              className="w-full"
              options={{
                showIcon: true,
                style: {
                  base: {
                    fontSize: "15px",
                    color: "#0f172a",
                    fontFamily: "inherit",
                    "::placeholder": { color: "#94a3b8" },
                  },
                  invalid: { color: "#dc2626" },
                },
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Expiry date
            </label>
            <div
              className={`h-12 px-4 flex items-center border rounded-xl bg-background hover:border-primary/40 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all ${err ? "border-destructive/60" : "border-input"}`}
            >
              <CardExpiryElement
                className="w-full"
                options={{
                  style: {
                    base: {
                      fontSize: "15px",
                      color: "#0f172a",
                      fontFamily: "inherit",
                      "::placeholder": { color: "#94a3b8" },
                    },
                    invalid: { color: "#dc2626" },
                  },
                }}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              CVC
            </label>
            <div
              className={`h-12 px-4 flex items-center border rounded-xl bg-background hover:border-primary/40 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all ${err ? "border-destructive/60" : "border-input"}`}
            >
              <CardCvcElement
                className="w-full"
                options={{
                  style: {
                    base: {
                      fontSize: "15px",
                      color: "#0f172a",
                      fontFamily: "inherit",
                      "::placeholder": { color: "#94a3b8" },
                    },
                    invalid: { color: "#dc2626" },
                  },
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Error state */}
      {err && (
        <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-destructive text-base">✕</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-destructive mb-0.5">
                Payment unsuccessful
              </p>
              <p className="text-sm text-destructive/80">{errHint || err}</p>
              {errHint && (
                <p className="text-xs text-muted-foreground mt-1">{err}</p>
              )}
            </div>
          </div>

          {/* Retry guidance */}
          <div className="mt-3 pt-3 border-t border-destructive/15 space-y-1.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground text-xs">
              What you can do:
            </p>
            <ul className="space-y-1 list-none">
              <li className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-accent shrink-0" />
                Fix the details above and click <strong>Try again</strong>
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-accent shrink-0" />
                Use a different card
              </li>
              <li className="flex items-center gap-1.5">
                <Check className="w-3 h-3 text-accent shrink-0" />
                Contact your bank if the problem persists
              </li>
            </ul>
          </div>

          {attemptCount >= 3 && (
            <div className="mt-3 pt-3 border-t border-destructive/15 text-xs text-muted-foreground">
              Having repeated trouble?{" "}
              <a
                href="mailto:support@optimumcreditrepair.com"
                className="text-primary underline underline-offset-2"
              >
                Contact support
              </a>{" "}
              and we'll help you complete your enrollment.
            </div>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || busy}
        className="w-full btn-primary mt-5 rounded-xl gap-2"
      >
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Processing…
          </>
        ) : err ? (
          "Try again"
        ) : (
          "Pay & start"
        )}
      </button>

      <p className="text-xs text-center text-muted-foreground mt-4 flex items-center gap-1 justify-center">
        <ShieldCheck className="w-3.5 h-3.5" /> Secured by Stripe · 256-bit TLS
      </p>
    </form>
  );
}

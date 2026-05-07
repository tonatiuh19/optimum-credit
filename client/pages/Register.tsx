import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ShieldCheck,
  Sparkles,
  Lock,
  BadgeCheck,
  Loader2,
  CheckCircle,
  Mail,
  PartyPopper,
  CreditCard,
} from "lucide-react";
import {
  SiVisa,
  SiMastercard,
  SiAmericanexpress,
  SiDiscover,
} from "react-icons/si";
import PageMeta from "@/components/PageMeta";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPackages,
  submitRegistration,
  resetRegistration,
} from "@/store/slices/packagesSlice";
import api from "@/lib/api";
import type { RegistrationResponse } from "@shared/api";

// Authorize.net Accept.js global type
declare global {
  interface Window {
    Accept?: {
      dispatchData: (
        secureData: {
          authData: { apiLoginID: string; clientKey: string };
          cardData: {
            cardNumber: string;
            month: string;
            year: string;
            cardCode: string;
            zip?: string;
            fullName?: string;
          };
        },
        callback: (response: {
          messages: {
            resultCode: "Ok" | "Error";
            message: Array<{ code: string; text: string }>;
          };
          opaqueData?: { dataDescriptor: string; dataValue: string };
        }) => void,
      ) => void;
    };
  }
}

const AUTHORIZENET_API_LOGIN_ID = (import.meta as any).env
  ?.VITE_AUTHORIZENET_API_LOGIN_ID as string | undefined;
const AUTHORIZENET_CLIENT_KEY = (import.meta as any).env
  ?.VITE_AUTHORIZENET_CLIENT_KEY as string | undefined;
const AUTHORIZENET_SANDBOX =
  (import.meta as any).env?.VITE_AUTHORIZENET_SANDBOX !== "false";

const REG_SCHEMA = Yup.object({
  firstName: Yup.string().required("Required"),
  lastName: Yup.string().required("Required"),
  email: Yup.string().email("Invalid email").required("Required"),
  phone: Yup.string().required("Required"),
});

export default function Register() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { packages, loading, registering, error } = useAppSelector(
    (s) => s.packages,
  );
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [paidEmail, setPaidEmail] = useState("");

  // Card fields (real payment mode only)
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [cardName, setCardName] = useState("");
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  useEffect(() => {
    dispatch(fetchPackages());
    return () => {
      dispatch(resetRegistration());
    };
  }, [dispatch]);

  useEffect(() => {
    if (!packages.length) return;
    // If a ?plan= param was passed from the home page pricing section, honour it
    const params = new URLSearchParams(location.search);
    const planParam = params.get("plan");
    const match = planParam && packages.find((p) => p.slug === planParam);
    if (match) {
      setSelectedSlug(match.slug);
    } else if (!selectedSlug) {
      setSelectedSlug(packages[0].slug);
    }
  }, [packages, location.search]);

  // Load Accept.js from Authorize.net CDN
  useEffect(() => {
    const src = AUTHORIZENET_SANDBOX
      ? "https://jstest.authorize.net/v1/Accept.js"
      : "https://js.authorize.net/v1/Accept.js";
    if (document.querySelector(`script[src="${src}"]`)) {
      setScriptLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.charset = "utf-8";
    script.async = true;
    script.onload = () => setScriptLoaded(true);
    script.onerror = () =>
      setPayError("Failed to load payment library. Please refresh the page.");
    document.head.appendChild(script);
  }, []);

  const form = useFormik({
    initialValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
    },
    validationSchema: REG_SCHEMA,
    onSubmit: () => {}, // handled via handlePaySubmit
  });

  const goTo = (n: number) => {
    setDirection(n > step ? "forward" : "back");
    setStep(n);
  };

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate info fields
    const errors = await form.validateForm();
    form.setTouched(
      { firstName: true, lastName: true, email: true, phone: true },
      false,
    );
    if (Object.keys(errors).length > 0) return;

    // Validate card fields
    const rawCardCheck = cardNumber.replace(/\s/g, "");
    const partsCheck = expiry.split("/");
    if (
      rawCardCheck.length < 13 ||
      !partsCheck[0]?.trim() ||
      !partsCheck[1]?.trim() ||
      cvv.length < 3
    ) {
      setPayError("Please fill in all card details correctly.");
      return;
    }

    if (!window.Accept) {
      setPayError("Payment library not loaded. Please refresh.");
      return;
    }

    setPaying(true);
    setPayError(null);

    const rawCard = cardNumber.replace(/\s/g, "");
    const parts = expiry.split("/");
    const month = (parts[0] || "").trim();
    const year2d = (parts[1] || "").trim();
    const year = year2d.length === 2 ? `20${year2d}` : year2d;
    const fullName = cardName.trim() || undefined;

    // Step 1: Tokenize card in the browser (never touches our server)
    window.Accept.dispatchData(
      {
        authData: {
          apiLoginID: AUTHORIZENET_API_LOGIN_ID!,
          clientKey: AUTHORIZENET_CLIENT_KEY!,
        },
        cardData: { cardNumber: rawCard, month, year, cardCode: cvv, fullName },
      },
      async (response) => {
        if (response.messages.resultCode !== "Ok") {
          setPayError(
            response.messages.message[0]?.text || "Card tokenization failed",
          );
          setPaying(false);
          return;
        }

        // Step 2: Single POST — register + charge atomically.
        // Client is only created in DB if the charge succeeds.
        const result = await dispatch(
          submitRegistration({
            ...form.values,
            packageSlug: selectedSlug,
            dataDescriptor: response.opaqueData!.dataDescriptor,
            dataValue: response.opaqueData!.dataValue,
          }),
        );

        if (!submitRegistration.fulfilled.match(result)) {
          setPayError(
            (result.payload as string) || "Payment failed. Please try again.",
          );
          setPaying(false);
          return;
        }

        setPaidEmail(form.values.email);
        setDirection("forward");
        setStep(3);
      },
    );
  };

  const inputCls = (hasErr?: boolean) =>
    `w-full h-12 px-4 rounded-xl border bg-background text-foreground placeholder:text-muted-foreground/60 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary hover:border-primary/40 transition-all ${
      hasErr ? "border-destructive" : "border-input"
    }`;

  const selectedPackage = packages.find((p) => p.slug === selectedSlug);
  const isBusy = paying || registering;

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
        {/* Progress — 2 steps, hidden on success */}
        {step < 3 && (
          <div className="flex items-center justify-center mb-10">
            {[
              { n: 1, label: "Choose plan" },
              { n: 2, label: "Your info & payment" },
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
                {i < 1 && (
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

          {/* ── Step 2: Info + Payment combined ── */}
          {step === 2 && (
            <form
              onSubmit={handlePaySubmit}
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
                        email: "alex@disruptinglabs.com",
                        phone: "3055550123",
                      })
                    }
                    className="shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-amber-100 text-amber-700 border border-amber-300 hover:bg-amber-200 transition-colors"
                  >
                    🧪 Fill test data
                  </button>
                )}
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                Just the basics to get started — we'll collect additional
                details during your secure onboarding.
              </p>

              {/* Contact info */}
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
                  label="Email address"
                  type="email"
                  index={2}
                />
                <Field form={form} name="phone" label="Phone" index={3} />
              </div>

              {/* Payment section */}
              <div className="mt-6 pt-6 border-t border-border">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <CreditCard className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base leading-tight">
                      Secure payment
                    </h3>
                    {selectedPackage && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {selectedPackage.name} —{" "}
                        <span className="font-medium text-foreground">
                          ${(selectedPackage.price_cents / 100).toFixed(2)}
                        </span>{" "}
                        one-time
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Cardholder name
                    </label>
                    <input
                      type="text"
                      autoComplete="cc-name"
                      placeholder="Full name on card"
                      value={cardName}
                      onChange={(e) => setCardName(e.target.value)}
                      className={inputCls()}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">
                      Card number
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="cc-number"
                        placeholder="1234 5678 9012 3456"
                        value={cardNumber}
                        onChange={(e) =>
                          setCardNumber(formatCardNumber(e.target.value))
                        }
                        className={`${inputCls(!!payError)} pr-16`}
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 transition-all duration-200">
                        {detectCardBrand(cardNumber.replace(/\s/g, "")) !==
                        "unknown" ? (
                          <CardBrandIcon
                            brand={detectCardBrand(
                              cardNumber.replace(/\s/g, ""),
                            )}
                          />
                        ) : (
                          <CreditCard className="w-6 h-6 text-muted-foreground/40" />
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        Expiry date
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="cc-exp"
                        placeholder="MM/YY"
                        value={expiry}
                        onChange={(e) =>
                          setExpiry(formatExpiry(e.target.value))
                        }
                        className={inputCls(!!payError)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        Security code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="cc-csc"
                        placeholder="CVV"
                        value={cvv}
                        onChange={(e) =>
                          setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))
                        }
                        className={inputCls(!!payError)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Error */}
              {(error || payError) && (
                <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-destructive text-sm font-bold">
                      ✕
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-destructive mb-0.5">
                      Payment unsuccessful
                    </p>
                    <p className="text-sm text-destructive/80">
                      {payError || error}
                    </p>
                  </div>
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
                  disabled={isBusy || !scriptLoaded}
                  className="btn-primary gap-2"
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing…
                    </>
                  ) : (
                    <>
                      Pay $
                      {((selectedPackage?.price_cents || 0) / 100).toFixed(2)}
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>

              <p className="text-xs text-center text-muted-foreground mt-5 flex items-center gap-1.5 justify-center">
                <Lock className="w-3 h-3" />
                256-bit SSL encryption · Your info is never sold to third
                parties
              </p>
            </form>
          )}

          {/* ── Step 3: Success ── */}
          {step === 3 && (
            <div className="max-w-lg mx-auto text-center animate-fade-up">
              <div className="bg-card border border-border rounded-2xl p-10 shadow-lg">
                <div className="w-20 h-20 bg-gradient-to-br from-accent/20 to-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <PartyPopper className="w-10 h-10 text-accent" />
                </div>
                <h2 className="text-3xl font-bold mb-2">You're all set!</h2>
                <p className="text-muted-foreground mb-6">
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
                      Check your inbox (and spam folder) — use that link to
                      complete your profile and upload your documents.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                    <p className="text-sm text-muted-foreground">
                      You can also sign in right now — we'll send a one-time
                      code to your email.
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

// ── Utilities ──────────────────────────────────────────────

type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "unknown";

function detectCardBrand(raw: string): CardBrand {
  if (/^4/.test(raw)) return "visa";
  if (/^5[1-5]/.test(raw) || /^2(2[2-9]|[3-6]|7[01])/.test(raw))
    return "mastercard";
  if (/^3[47]/.test(raw)) return "amex";
  if (/^6(011|5|4[4-9]|22)/.test(raw)) return "discover";
  return "unknown";
}

function CardBrandIcon({ brand }: { brand: CardBrand }) {
  const cls = "w-8 h-8";
  if (brand === "visa")
    return <SiVisa className={cls} style={{ color: "#1A1F71" }} />;
  if (brand === "mastercard")
    return <SiMastercard className={cls} style={{ color: "#EB001B" }} />;
  if (brand === "amex")
    return <SiAmericanexpress className={cls} style={{ color: "#2557D6" }} />;
  if (brand === "discover")
    return <SiDiscover className={cls} style={{ color: "#F76F20" }} />;
  return null;
}

function formatCardNumber(value: string) {
  return value
    .replace(/\D/g, "")
    .slice(0, 16)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

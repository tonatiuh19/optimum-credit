/**
 * Public payment page — /pay/:token
 * No auth required. Validates token via API then charges via stored card or new card.
 */
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  CreditCard,
  CheckCircle2,
  Lock,
  AlertCircle,
  Loader2,
  CalendarDays,
  Building,
} from "lucide-react";
import axios from "axios";

const AUTHORIZENET_API_LOGIN_ID = import.meta.env
  .VITE_AUTHORIZENET_API_LOGIN_ID;
const AUTHORIZENET_CLIENT_KEY = import.meta.env.VITE_AUTHORIZENET_CLIENT_KEY;
const ANET_ENV =
  import.meta.env.VITE_ANET_ENV === "production" ? "production" : "sandbox";
const ACCEPT_JS_URL =
  ANET_ENV === "production"
    ? "https://js.authorize.net/v1/Accept.js"
    : "https://jstest.authorize.net/v1/Accept.js";

function useAcceptJs() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (window.Accept) {
      setLoaded(true);
      return;
    }
    const s = document.createElement("script");
    s.src = ACCEPT_JS_URL;
    s.charset = "utf-8";
    s.async = true;
    s.onload = () => setLoaded(true);
    document.head.appendChild(s);
    return () => {
      document.head.removeChild(s);
    };
  }, []);
  return loaded;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatCard(v: string) {
  return v
    .replace(/\D/g, "")
    .slice(0, 16)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

function formatExpiry(v: string) {
  const digits = v.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + "/" + digits.slice(2);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface SplitInfo {
  id: number;
  case_number: string | null;
  label: string;
  amount_cents: number;
  currency: string;
  due_date: string;
  status: string;
  notes: string | null;
}

interface PaymentInfo {
  split: SplitInfo;
  client_first_name: string;
  client_last_name: string;
  has_stored_card: boolean;
  preferred_language: string;
}

export default function PaySplit() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const acceptLoaded = useAcceptJs();

  const [info, setInfo] = useState<PaymentInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [method, setMethod] = useState<"stored" | "new">("stored");

  // Card form state
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [cardName, setCardName] = useState("");

  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Load payment info
  useEffect(() => {
    if (!token) return;
    axios
      .get(`/api/pay/${token}`)
      .then((r) => {
        setInfo(r.data);
        setMethod(r.data.has_stored_card ? "stored" : "new");
      })
      .catch((err) => {
        const msg =
          err.response?.data?.error || "Payment link not found or expired.";
        setLoadError(msg);
      });
  }, [token]);

  const payWithStoredCard = useCallback(async () => {
    if (!token) return;
    setPaying(true);
    setPayError(null);
    try {
      await axios.post(`/api/pay/${token}`, { method: "stored_profile" });
      setSuccess(true);
    } catch (err: any) {
      setPayError(
        err.response?.data?.error || "Payment failed. Please try again.",
      );
    } finally {
      setPaying(false);
    }
  }, [token]);

  const payWithNewCard = useCallback(() => {
    if (!token) return;
    if (!acceptLoaded || !window.Accept) {
      setPayError("Payment library not loaded. Please refresh the page.");
      return;
    }

    // Basic validation
    const cleanCard = cardNumber.replace(/\s/g, "");
    if (cleanCard.length < 13 || cleanCard.length > 19) {
      setPayError("Please enter a valid card number.");
      return;
    }
    const parts = expiry.split("/");
    const month = (parts[0] || "").trim();
    const year2d = (parts[1] || "").trim();
    if (!month || !year2d) {
      setPayError("Please enter a valid expiry date (MM/YY).");
      return;
    }
    if (cvv.length < 3) {
      setPayError("Please enter a valid CVV.");
      return;
    }

    setPaying(true);
    setPayError(null);
    const year = year2d.length === 2 ? `20${year2d}` : year2d;

    window.Accept.dispatchData(
      {
        authData: {
          apiLoginID: AUTHORIZENET_API_LOGIN_ID,
          clientKey: AUTHORIZENET_CLIENT_KEY,
        },
        cardData: {
          cardNumber: cleanCard,
          month,
          year,
          cardCode: cvv,
          fullName: cardName.trim() || undefined,
        },
      },
      async (response: any) => {
        if (response.messages.resultCode !== "Ok") {
          setPayError(
            response.messages.message[0]?.text || "Card tokenization failed.",
          );
          setPaying(false);
          return;
        }
        try {
          await axios.post(`/api/pay/${token}`, {
            method: "new_card",
            data_descriptor: response.opaqueData.dataDescriptor,
            data_value: response.opaqueData.dataValue,
          });
          setSuccess(true);
        } catch (err: any) {
          setPayError(
            err.response?.data?.error || "Payment failed. Please try again.",
          );
        } finally {
          setPaying(false);
        }
      },
    );
  }, [token, acceptLoaded, cardNumber, expiry, cvv, cardName]);

  const inputCls = (err?: boolean) =>
    `w-full h-12 px-4 rounded-xl border bg-background text-foreground placeholder:text-muted-foreground/60 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary hover:border-primary/40 transition-all ${
      err ? "border-destructive" : "border-input"
    }`;

  // ── Success screen ────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-[100dvh] bg-background w-full max-w-[100vw] overflow-x-hidden flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-5">
          <div className="w-20 h-20 rounded-full bg-accent/15 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-accent" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Payment Successful!
          </h1>
          <p className="text-muted-foreground">
            Your payment of{" "}
            <strong>{info ? fmt(info.split.amount_cents) : ""}</strong> has been
            processed. You'll receive a confirmation shortly.
          </p>
          <div className="bg-card border border-border rounded-2xl p-5 text-left space-y-2">
            {info?.split.case_number && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Case</span>
                <span className="font-semibold">{info.split.case_number}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Description</span>
              <span className="font-semibold">{info?.split.label}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-bold text-accent">
                {info ? fmt(info.split.amount_cents) : ""}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Error / expired screen ─────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="min-h-[100dvh] bg-background w-full max-w-[100vw] overflow-x-hidden flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-xl font-bold text-foreground">
            Payment Link Unavailable
          </h1>
          <p className="text-muted-foreground text-sm">{loadError}</p>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!info) {
    return (
      <div className="min-h-[100dvh] bg-background w-full max-w-[100vw] overflow-x-hidden flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const { split, client_first_name, has_stored_card } = info;

  // ── Payment form ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-background w-full max-w-[100vw] overflow-x-hidden flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Brand header */}
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Building className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-foreground">
              Optimum Credit
            </span>
          </div>
          <p className="text-muted-foreground text-sm">
            Secure payment for {client_first_name}
          </p>
        </div>

        {/* Split summary card */}
        <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {split.label}
              </p>
              {split.case_number && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Case {split.case_number}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-foreground">
                {fmt(split.amount_cents)}
              </p>
              <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                <CalendarDays className="w-3 h-3" />
                Due {fmtDate(split.due_date)}
              </div>
            </div>
          </div>
          {split.notes && (
            <p className="text-xs text-muted-foreground border-t border-border pt-3">
              {split.notes}
            </p>
          )}
        </div>

        {/* Method selector if stored card available */}
        {has_stored_card && (
          <div className="flex rounded-xl overflow-hidden border border-border">
            <button
              onClick={() => setMethod("stored")}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                method === "stored"
                  ? "bg-primary text-white"
                  : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              Saved Card
            </button>
            <button
              onClick={() => setMethod("new")}
              className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                method === "new"
                  ? "bg-primary text-white"
                  : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              New Card
            </button>
          </div>
        )}

        {/* Stored card path */}
        {method === "stored" && has_stored_card && (
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Saved card on file
                </p>
                <p className="text-xs text-muted-foreground">
                  Your card will be charged securely
                </p>
              </div>
            </div>

            {payError && (
              <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                <p className="text-sm text-destructive">{payError}</p>
              </div>
            )}

            <button
              onClick={payWithStoredCard}
              disabled={paying}
              className="w-full h-12 rounded-xl bg-accent text-white font-semibold text-[15px] hover:bg-accent/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {paying ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  Pay {fmt(split.amount_cents)}
                </>
              )}
            </button>
          </div>
        )}

        {/* New card path */}
        {method === "new" && (
          <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-bold text-foreground">Card Details</h2>

            <div className="space-y-3">
              <input
                className={inputCls()}
                placeholder="Card number"
                value={cardNumber}
                onChange={(e) => setCardNumber(formatCard(e.target.value))}
                maxLength={19}
                inputMode="numeric"
                autoComplete="cc-number"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  className={inputCls()}
                  placeholder="MM / YY"
                  value={expiry}
                  onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                  maxLength={5}
                  inputMode="numeric"
                  autoComplete="cc-exp"
                />
                <input
                  className={inputCls()}
                  placeholder="CVV"
                  value={cvv}
                  onChange={(e) =>
                    setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                  maxLength={4}
                  inputMode="numeric"
                  autoComplete="cc-csc"
                />
              </div>
              <input
                className={inputCls()}
                placeholder="Name on card (optional)"
                value={cardName}
                onChange={(e) => setCardName(e.target.value)}
                autoComplete="cc-name"
              />
            </div>

            {payError && (
              <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-xl p-3">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                <p className="text-sm text-destructive">{payError}</p>
              </div>
            )}

            <button
              onClick={payWithNewCard}
              disabled={paying || !acceptLoaded}
              className="w-full h-12 rounded-xl bg-accent text-white font-semibold text-[15px] hover:bg-accent/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {paying ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  Pay {fmt(split.amount_cents)}
                </>
              )}
            </button>
          </div>
        )}

        {/* Security footer */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Lock className="w-3 h-3" />
          <span>Secured by Authorize.net — 256-bit TLS encryption</span>
        </div>
      </div>
    </div>
  );
}

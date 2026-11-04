import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { loadStripe, type Appearance, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CheckCircle2, CreditCard, Landmark, Loader2, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearBillingSetup,
  createBillingSetupIntent,
  fetchBillingPaymentMethod,
  saveBillingPaymentMethod,
  type BillingPaymentMethod,
} from "@/store/slices/billingSlice";
import { logger } from "@/utils/logger";

const stripeByKey = new Map<string, Promise<Stripe | null>>();
const getStripe = (key: string) => {
  if (!stripeByKey.has(key)) stripeByKey.set(key, loadStripe(key));
  return stripeByKey.get(key)!;
};

/** Payment Element themed from the design tokens in global.css (light + dark). */
function stripeAppearance(): Appearance {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => `hsl(${css.getPropertyValue(name).trim()})`;
  return {
    theme: document.documentElement.classList.contains("dark") ? "night" : "stripe",
    variables: {
      colorPrimary: v("--primary"),
      colorBackground: v("--card"),
      colorText: v("--foreground"),
      colorTextSecondary: v("--muted-foreground"),
      colorDanger: v("--destructive"),
      borderRadius: "10px",
      fontFamily: getComputedStyle(document.body).fontFamily,
      spacingUnit: "4px",
    },
    rules: {
      ".Input": { borderColor: v("--border"), boxShadow: "none" },
      ".Input:focus": { borderColor: v("--ring"), boxShadow: `0 0 0 3px ${v("--ring")}33` },
      ".Tab": { borderColor: v("--border") },
      ".Tab--selected": { borderColor: v("--primary") },
    },
  };
}

function SavedMethodVisual({ pm }: { pm: BillingPaymentMethod | null }) {
  const { t } = useTranslation();
  const isBank = pm?.type === "us_bank_account";
  const Icon = isBank ? Landmark : CreditCard;
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 w-full sm:max-w-sm aspect-[1.7/1] bg-gradient-to-br from-primary via-primary/85 to-accent text-primary-foreground shadow-lg transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-xl"
      data-testid="billing-card-visual"
    >
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-primary-foreground/10" />
      <div className="absolute -left-6 -bottom-12 w-36 h-36 rounded-full bg-primary-foreground/10" />
      <div className="relative h-full flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <div className="w-10 h-7 rounded-md bg-primary-foreground/30" />
          <Icon className="w-6 h-6 opacity-90" />
        </div>
        <p className="font-mono text-lg sm:text-xl tracking-[0.2em]">
          {pm ? `•••• •••• •••• ${pm.last4 ?? "••••"}` : "•••• •••• •••• ••••"}
        </p>
        <div className="flex items-end justify-between text-xs">
          <div>
            <p className="opacity-70 uppercase text-[10px]">{t("billing.pm.billedTo")}</p>
            <p className="font-semibold">Optimum Financial Group</p>
          </div>
          <div className="text-right">
            {pm ? (
              <>
                <p className="opacity-70 uppercase text-[10px]">{isBank ? pm.bank_name ?? t("billing.pm.bank") : pm.brand}</p>
                {!isBank && pm.exp_month && (
                  <p className="font-semibold">
                    {String(pm.exp_month).padStart(2, "0")}/{String(pm.exp_year).slice(-2)}
                  </p>
                )}
              </>
            ) : (
              <p className="opacity-80">{t("billing.pm.none")}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SetupForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const busy = useAppSelector((s) => s.billing.setupBusy);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setConfirming(true);
    setError(null);
    const { error: err, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}/admin/billing` },
    });
    setConfirming(false);
    if (err) {
      logger.warn("[Billing] confirmSetup failed", err.message);
      setError(err.message ?? t("billing.pm.error"));
      return;
    }
    const pmId = typeof setupIntent?.payment_method === "string" ? setupIntent.payment_method : setupIntent?.payment_method?.id;
    if (!pmId) {
      setError(t("billing.pm.error"));
      return;
    }
    const res = await dispatch(saveBillingPaymentMethod(pmId));
    if (saveBillingPaymentMethod.rejected.match(res)) {
      setError(String(res.payload || t("billing.pm.error")));
      return;
    }
    toast({ title: t("billing.pm.saved") });
    onDone();
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4 animate-in fade-in slide-in-from-top-2" data-testid="billing-setup-form">
      <PaymentElement
        options={{
          layout: "tabs",
          business: { name: "Optimum Financial Group" },
          // Card only: no wallet buttons (Link is excluded server-side: payment_method_types = card).
          wallets: { applePay: "never", googlePay: "never" },
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
        <Button type="button" variant="ghost" onClick={onDone} disabled={confirming || busy} className="gap-1.5">
          <X className="w-4 h-4" /> {t("billing.pm.cancel")}
        </Button>
        <Button type="submit" disabled={!stripe || confirming || busy} className="gap-1.5">
          {confirming || busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
          {t("billing.pm.save")}
        </Button>
      </div>
    </form>
  );
}

/** Saved card / bank account for platform invoices (Stripe Payment Element + SetupIntent). */
export function BillingPaymentMethodCard() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { paymentMethod, paymentMethodLoaded, publishableKey, stripeConfigured, setupClientSecret, setupBusy } = useAppSelector(
    (s) => s.billing,
  );

  useEffect(() => {
    dispatch(fetchBillingPaymentMethod());
    return () => {
      dispatch(clearBillingSetup());
    };
  }, [dispatch]);

  const stripePromise = useMemo(() => (publishableKey ? getStripe(publishableKey) : null), [publishableKey]);
  const appearance = useMemo(() => (setupClientSecret ? stripeAppearance() : undefined), [setupClientSecret]);
  const ready = stripeConfigured && !!publishableKey;

  const start = async () => {
    const res = await dispatch(createBillingSetupIntent());
    if (createBillingSetupIntent.rejected.match(res)) {
      toast({ title: String(res.payload || t("billing.pm.error")), variant: "destructive" });
    }
  };

  return (
    <div className="card-base p-4 sm:p-5 space-y-4" data-testid="billing-payment-method">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("billing.pm.title")}</p>
          <p className="text-xs text-muted-foreground">{paymentMethod ? t("billing.pm.autoHint") : t("billing.pm.emailHint")}</p>
        </div>
        {paymentMethod && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 text-accent px-2 py-0.5 text-[11px] font-semibold shrink-0">
            <CheckCircle2 className="w-3 h-3" /> {t("billing.pm.autopay")}
          </span>
        )}
      </div>

      {!paymentMethodLoaded ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
          <SavedMethodVisual pm={paymentMethod} />
          <div className="flex-1 min-w-0">
            {setupClientSecret && stripePromise ? (
              <Elements stripe={stripePromise} options={{ clientSecret: setupClientSecret, appearance }}>
                <SetupForm onDone={() => dispatch(clearBillingSetup())} />
              </Elements>
            ) : (
              <div className="space-y-3">
                <ul className="text-xs text-muted-foreground space-y-1.5">
                  <li className="flex gap-2"><Lock className="w-3.5 h-3.5 text-primary shrink-0" /> {t("billing.pm.secure")}</li>
                  <li className="flex gap-2"><CreditCard className="w-3.5 h-3.5 text-primary shrink-0" /> {t("billing.pm.methods")}</li>
                </ul>
                {ready ? (
                  <Button type="button" onClick={() => void start()} disabled={setupBusy} className="gap-1.5 w-full sm:w-auto" data-testid="billing-pm-start">
                    {setupBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                    {paymentMethod ? t("billing.pm.update") : t("billing.pm.add")}
                  </Button>
                ) : (
                  <p className="text-xs text-destructive">{t("billing.pm.notConfigured")}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

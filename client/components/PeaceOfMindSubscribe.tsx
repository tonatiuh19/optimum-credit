import { useEffect, useState } from "react";
import {
  Shield,
  Loader2,
  CheckCircle2,
  XCircle,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  cancelPeaceOfMind,
  fetchPeaceOfMind,
  subscribePeaceOfMind,
} from "@/store/slices/portalSlice";
import { formatPackageDollars } from "@/lib/packageDisplay";

const AUTHORIZENET_API_LOGIN_ID = (import.meta as any).env
  ?.VITE_AUTHORIZENET_API_LOGIN_ID as string | undefined;
const AUTHORIZENET_CLIENT_KEY = (import.meta as any).env
  ?.VITE_AUTHORIZENET_CLIENT_KEY as string | undefined;
const AUTHORIZENET_SANDBOX =
  (import.meta as any).env?.VITE_AUTHORIZENET_SANDBOX !== "false";

export default function PeaceOfMindSubscribe() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    peaceOfMind,
    peaceOfMindLoading,
    peaceOfMindSubscribing,
    peaceOfMindCancelling,
    peaceOfMindError,
  } = useAppSelector((s) => s.portal);

  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [cardName, setCardName] = useState("");
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    dispatch(fetchPeaceOfMind());
  }, [dispatch]);

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
    document.head.appendChild(script);
  }, []);

  const handleSubscribeWithStoredCard = async () => {
    setLocalError(null);
    const result = await dispatch(
      subscribePeaceOfMind({ use_stored_card: true }),
    );
    if (!subscribePeaceOfMind.fulfilled.match(result)) {
      setLocalError(
        (result.payload as string) || t("peaceOfMind.subscribeFailed"),
      );
    }
  };

  const handleSubscribe = () => {
    setLocalError(null);
    const rawCard = cardNumber.replace(/\s/g, "");
    const parts = expiry.split("/");
    const month = (parts[0] || "").trim();
    const year2d = (parts[1] || "").trim();
    const year = year2d.length === 2 ? `20${year2d}` : year2d;

    if (rawCard.length < 13 || !month || !year || cvv.length < 3) {
      setLocalError(t("peaceOfMind.cardError"));
      return;
    }
    if (!window.Accept || !scriptLoaded) {
      setLocalError(t("peaceOfMind.paymentLibraryError"));
      return;
    }

    window.Accept.dispatchData(
      {
        authData: {
          apiLoginID: AUTHORIZENET_API_LOGIN_ID!,
          clientKey: AUTHORIZENET_CLIENT_KEY!,
        },
        cardData: {
          cardNumber: rawCard,
          month,
          year,
          cardCode: cvv,
          fullName: cardName.trim() || undefined,
        },
      },
      async (response) => {
        if (response.messages.resultCode !== "Ok") {
          setLocalError(
            response.messages.message[0]?.text ||
              t("peaceOfMind.subscribeFailed"),
          );
          return;
        }
        const result = await dispatch(
          subscribePeaceOfMind({
            dataDescriptor: response.opaqueData!.dataDescriptor,
            dataValue: response.opaqueData!.dataValue,
          }),
        );
        if (!subscribePeaceOfMind.fulfilled.match(result)) {
          setLocalError(
            (result.payload as string) || t("peaceOfMind.subscribeFailed"),
          );
        } else {
          setCardNumber("");
          setExpiry("");
          setCvv("");
          setCardName("");
        }
      },
    );
  };

  const handleCancel = async () => {
    setLocalError(null);
    const result = await dispatch(cancelPeaceOfMind());
    if (!cancelPeaceOfMind.fulfilled.match(result)) {
      setLocalError(
        (result.payload as string) || t("peaceOfMind.cancelFailed"),
      );
    }
  };

  if (peaceOfMindLoading && !peaceOfMind) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!peaceOfMind?.package) return null;

  const {
    package: pkg,
    eligible,
    subscription,
    eligibility_reason,
    has_stored_card,
  } = peaceOfMind;
  const features: string[] = Array.isArray(pkg.features_json)
    ? pkg.features_json
    : [];

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <div className="bg-gradient-to-r from-primary/15 to-accent/10 px-6 py-4 border-b border-border flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <Shield className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="font-bold text-lg">{pkg.name}</h2>
          <p className="text-sm text-muted-foreground">{pkg.subtitle}</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">{pkg.description}</p>

        <ul className="space-y-2">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <div className="flex items-baseline gap-2">
          {pkg.compare_price_cents != null &&
            pkg.compare_price_cents > pkg.price_cents && (
              <span className="text-sm text-muted-foreground line-through">
                ${formatPackageDollars(pkg.compare_price_cents)}
              </span>
            )}
          <span className="text-2xl font-bold">
            ${formatPackageDollars(pkg.price_cents)}
          </span>
          <span className="text-muted-foreground">{t("packages.perMonth")}</span>
        </div>

        {!eligible && (
          <div className="rounded-lg bg-muted/50 border border-border px-4 py-3 text-sm text-muted-foreground">
            {eligibility_reason || t("peaceOfMind.notEligible")}
          </div>
        )}

        {subscription && (
          <div className="rounded-lg bg-accent/10 border border-accent/30 px-4 py-3 flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 text-accent shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-foreground">
                {t("peaceOfMind.active")}
              </p>
              <p className="text-muted-foreground mt-1">
                {t("peaceOfMind.activeSince", {
                  date: new Date(subscription.started_at).toLocaleDateString(),
                })}
              </p>
              <button
                type="button"
                onClick={handleCancel}
                disabled={peaceOfMindCancelling}
                className="mt-3 text-sm font-medium text-destructive hover:underline inline-flex items-center gap-1"
              >
                {peaceOfMindCancelling && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                {t("peaceOfMind.cancel")}
              </button>
            </div>
          </div>
        )}

        {eligible && !subscription && (
          <div className="space-y-3 pt-2 border-t border-border">
            {has_stored_card && (
              <button
                type="button"
                onClick={handleSubscribeWithStoredCard}
                disabled={peaceOfMindSubscribing}
                className="btn-primary w-full"
              >
                {peaceOfMindSubscribing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  t("peaceOfMind.subscribeWithCardOnFile")
                )}
              </button>
            )}
            {has_stored_card && (
              <p className="text-xs text-center text-muted-foreground">
                {t("peaceOfMind.orEnterNewCard")}
              </p>
            )}
            <p className="text-sm font-medium">{t("peaceOfMind.cardHeading")}</p>
            <input
              type="text"
              placeholder={t("peaceOfMind.cardName")}
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-border bg-input text-sm"
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder={t("register.cardNumber")}
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-border bg-input text-sm"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder={t("register.expiry")}
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="h-11 px-3 rounded-lg border border-border bg-input text-sm"
              />
              <input
                type="text"
                inputMode="numeric"
                placeholder="CVV"
                value={cvv}
                onChange={(e) => setCvv(e.target.value)}
                className="h-11 px-3 rounded-lg border border-border bg-input text-sm"
              />
            </div>
            <button
              type="button"
              onClick={handleSubscribe}
              disabled={peaceOfMindSubscribing}
              className="btn-primary w-full"
            >
              {peaceOfMindSubscribing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t("peaceOfMind.subscribe")
              )}
            </button>
          </div>
        )}

        {(localError || peaceOfMindError) && (
          <p className="text-sm text-destructive flex items-center gap-1.5">
            <XCircle className="w-4 h-4 shrink-0" />
            {localError || peaceOfMindError}
          </p>
        )}
      </div>
    </div>
  );
}

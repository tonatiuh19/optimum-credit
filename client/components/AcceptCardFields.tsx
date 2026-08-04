import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Loader2, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const AUTHORIZENET_API_LOGIN_ID = import.meta.env
  .VITE_AUTHORIZENET_API_LOGIN_ID as string | undefined;
const AUTHORIZENET_CLIENT_KEY = import.meta.env
  .VITE_AUTHORIZENET_CLIENT_KEY as string | undefined;
const AUTHORIZENET_SANDBOX =
  import.meta.env.VITE_AUTHORIZENET_SANDBOX !== "false";

export type AcceptCardHandle = {
  tokenize: () => Promise<{ dataDescriptor: string; dataValue: string }>;
};

type Props = {
  disabled?: boolean;
};

const AcceptCardFields = forwardRef<AcceptCardHandle, Props>(
  function AcceptCardFields({ disabled }, ref) {
    const { t } = useTranslation();
    const [scriptLoaded, setScriptLoaded] = useState(false);
    const [cardName, setCardName] = useState("");
    const [cardNumber, setCardNumber] = useState("");
    const [expiry, setExpiry] = useState("");
    const [cvv, setCvv] = useState("");
    const [tokenizing, setTokenizing] = useState(false);

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
      script.async = true;
      script.onload = () => setScriptLoaded(true);
      document.head.appendChild(script);
    }, []);

    useImperativeHandle(ref, () => ({
      tokenize: () =>
        new Promise((resolve, reject) => {
          const rawCard = cardNumber.replace(/\s/g, "");
          const parts = expiry.split("/");
          const month = (parts[0] || "").trim();
          const year = (parts[1] || "").trim();
          if (
            !cardName.trim() ||
            rawCard.length < 13 ||
            !month ||
            !year ||
            cvv.length < 3
          ) {
            reject(new Error(t("acceptCard.fillError")));
            return;
          }
          if (
            !window.Accept ||
            !AUTHORIZENET_API_LOGIN_ID ||
            !AUTHORIZENET_CLIENT_KEY
          ) {
            reject(new Error(t("acceptCard.notReady")));
            return;
          }
          setTokenizing(true);
          window.Accept.dispatchData(
            {
              authData: {
                apiLoginID: AUTHORIZENET_API_LOGIN_ID,
                clientKey: AUTHORIZENET_CLIENT_KEY,
              },
              cardData: {
                cardNumber: rawCard,
                month,
                year: year.length === 2 ? `20${year}` : year,
                cardCode: cvv,
                fullName: cardName.trim(),
              },
            },
            (response) => {
              setTokenizing(false);
              if (
                response.messages.resultCode !== "Ok" ||
                !response.opaqueData
              ) {
                reject(
                  new Error(
                    response.messages.message?.[0]?.text ||
                      "Card tokenization failed",
                  ),
                );
                return;
              }
              resolve({
                dataDescriptor: response.opaqueData.dataDescriptor,
                dataValue: response.opaqueData.dataValue,
              });
            },
          );
        }),
    }));

    return (
      <div className="space-y-3 rounded-xl border border-border bg-secondary/30 p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          {t("acceptCard.secured")}
          {!scriptLoaded && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>
        <div className="space-y-2">
          <Label className="text-xs">{t("acceptCard.name")}</Label>
          <Input
            value={cardName}
            onChange={(e) => setCardName(e.target.value)}
            disabled={disabled || tokenizing}
            autoComplete="cc-name"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-xs">{t("acceptCard.number")}</Label>
          <Input
            value={cardNumber}
            onChange={(e) =>
              setCardNumber(
                e.target.value
                  .replace(/[^\d]/g, "")
                  .replace(/(.{4})/g, "$1 ")
                  .trim(),
              )
            }
            disabled={disabled || tokenizing}
            inputMode="numeric"
            autoComplete="cc-number"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs">{t("acceptCard.expiry")}</Label>
            <Input
              value={expiry}
              onChange={(e) => {
                let v = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
                if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`;
                setExpiry(v);
              }}
              disabled={disabled || tokenizing}
              placeholder="MM/YY"
              autoComplete="cc-exp"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">{t("acceptCard.cvv")}</Label>
            <Input
              value={cvv}
              onChange={(e) =>
                setCvv(e.target.value.replace(/[^\d]/g, "").slice(0, 4))
              }
              disabled={disabled || tokenizing}
              inputMode="numeric"
              autoComplete="cc-csc"
            />
          </div>
        </div>
        {tokenizing && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("acceptCard.securing")}
          </p>
        )}
      </div>
    );
  },
);

export default AcceptCardFields;

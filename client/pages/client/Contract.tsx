import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ScrollText, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchDashboard, signContract } from "@/store/slices/portalSlice";
import api from "@/lib/api";

export default function Contract() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { dashboard } = useAppSelector((s) => s.portal);
  const { user } = useAppSelector((s) => s.clientAuth);
  const [contractHtml, setContractHtml] = useState<string>("");
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const signedAt =
    dashboard?.client?.contract_signed_at || user?.contract_signed_at;

  useEffect(() => {
    dispatch(fetchDashboard());
  }, [dispatch]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/portal/contract");
        setContractHtml(data.html || "");
      } catch {
        setContractHtml(
          "<p>Standard credit repair service agreement governing your engagement with Optimum Credit Repair.</p>",
        );
      }
    })();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = c.offsetWidth * (window.devicePixelRatio || 1);
    c.height = c.offsetHeight * (window.devicePixelRatio || 1);
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#0f172a";
    }
  }, [signedAt]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const point = "touches" in e ? e.touches[0] : (e as React.MouseEvent);
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  };

  const start = (e: any) => {
    drawing.current = true;
    const { x, y } = getPos(e);
    canvasRef.current?.getContext("2d")?.beginPath();
    canvasRef.current?.getContext("2d")?.moveTo(x, y);
  };
  const move = (e: any) => {
    if (!drawing.current) return;
    e.preventDefault();
    const { x, y } = getPos(e);
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.lineTo(x, y);
    ctx?.stroke();
  };
  const stop = () => (drawing.current = false);

  const clearSig = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
  };

  const submit = async () => {
    if (!agreed || !name.trim()) {
      setError(t("contract.signError"));
      return;
    }
    setSigning(true);
    setError(null);
    const dataUrl = canvasRef.current?.toDataURL("image/png");
    const result = await dispatch(
      signContract({ signature_name: name, signature_data_url: dataUrl }),
    );
    setSigning(false);
    if (signContract.rejected.match(result)) {
      setError(t("contract.saveError"));
    } else {
      await dispatch(fetchDashboard());
    }
  };

  if (signedAt) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">{t("contract.heading")}</h1>
        <div className="bg-card rounded-2xl border border-accent/30 p-8 shadow-sm">
          <div className="w-14 h-14 rounded-full bg-accent/15 text-accent flex items-center justify-center mb-4">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h2 className="text-2xl font-bold mb-1">{t("contract.signed")}</h2>
          <p className="text-muted-foreground">
            {t("contract.signedDate", {
              date: new Date(signedAt!).toLocaleString(undefined, {
                dateStyle: "long",
                timeStyle: "short",
              }),
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ScrollText className="w-7 h-7 text-primary" />{" "}
          {t("contract.heading")}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t("contract.unsignedSub")}
        </p>
      </div>

      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm max-h-[400px] overflow-y-auto">
        <div
          className="prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: contractHtml }}
        />
      </div>

      <div className="bg-card rounded-2xl border border-border p-6 shadow-sm space-y-5">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" /> {t("contract.signHere")}
        </h2>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            {t("contract.fullName")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("contract.fullNamePlaceholder")}
            className="w-full h-11 px-3 rounded-lg border border-border bg-input focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            {t("contract.drawSignature")}
          </label>
          <div className="border-2 border-dashed border-border rounded-lg bg-secondary/40">
            <canvas
              ref={canvasRef}
              className="w-full h-40 touch-none cursor-crosshair"
              onMouseDown={start}
              onMouseMove={move}
              onMouseUp={stop}
              onMouseLeave={stop}
              onTouchStart={start}
              onTouchMove={move}
              onTouchEnd={stop}
            />
          </div>
          <button
            onClick={clearSig}
            className="text-xs text-muted-foreground hover:text-foreground mt-1"
          >
            {t("contract.clearSignature")}
          </button>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5"
          />
          <span>{t("contract.agreeCheckbox")}</span>
        </label>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <button
          onClick={submit}
          disabled={signing}
          className="btn-primary w-full sm:w-auto"
        >
          {signing ? t("common.saving") : t("contract.signContinue")}
        </button>
      </div>
    </div>
  );
}

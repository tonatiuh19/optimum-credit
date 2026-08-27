import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Circle,
  FileUp,
  Landmark,
  Loader2,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPortalFunding,
  uploadPortalFundingDocument,
} from "@/store/slices/fundingSlice";
import type { FundingDocSlot } from "@shared/api";
import { FUNDING_REQUIRED_DOC_SLOTS } from "@shared/api";
import { logger } from "@/utils/logger";

const MAX_FILE_MB = 15;

function slotLabelKey(slot: FundingDocSlot) {
  return slot.replace("funding_", "");
}

export default function PortalFunding() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    portalApplication,
    portalLoading,
    portalUploading,
    portalError,
  } = useAppSelector((s) => s.funding);
  const [uploadSlot, setUploadSlot] = useState<FundingDocSlot | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void dispatch(fetchPortalFunding());
  }, [dispatch]);

  const uploaded = useMemo(
    () => new Set(portalApplication?.docs_uploaded || []),
    [portalApplication],
  );

  const remaining = useMemo(
    () => FUNDING_REQUIRED_DOC_SLOTS.filter((s) => !uploaded.has(s)),
    [uploaded],
  );

  const isTerminal =
    portalApplication &&
    (portalApplication.status === "submitted" ||
      portalApplication.status === "under_review" ||
      portalApplication.status === "complete" ||
      portalApplication.status === "converted" ||
      portalApplication.docs_complete);

  const pickFile = (slot: FundingDocSlot) => {
    setUploadSlot(slot);
    inputRef.current?.click();
  };

  const onFile = async (file: File | null) => {
    if (!file || !uploadSlot || !portalApplication) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      logger.warn("portalFunding file too large");
      setUploadSlot(null);
      return;
    }
    await dispatch(
      uploadPortalFundingDocument({
        id: portalApplication.id,
        doc_type: uploadSlot,
        file,
      }),
    );
    setUploadSlot(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  if (portalLoading && !portalApplication) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!portalApplication) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 space-y-3">
        <Landmark className="w-10 h-10 text-muted-foreground mx-auto" />
        <h1 className="text-xl font-bold">{t("portalFunding.noneTitle")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("portalFunding.noneBody")}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Landmark className="w-6 h-6 text-primary" />
          {t("portalFunding.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("portalFunding.subtitle")}
        </p>
      </div>

      {portalError ? (
        <p className="text-sm text-destructive">{portalError}</p>
      ) : null}

      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full bg-primary/10 text-primary">
            {t(`portalFunding.status.${portalApplication.status}`)}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full bg-secondary text-muted-foreground">
            {t(`portalFunding.types.${portalApplication.funding_type}`)}
          </span>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("portalFunding.fields.name")}
            </dt>
            <dd className="font-medium">
              {portalApplication.first_name} {portalApplication.last_name}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("portalFunding.fields.llcName")}
            </dt>
            <dd>{portalApplication.llc_name || "—"}</dd>
          </div>
        </dl>

        {isTerminal && remaining.length === 0 ? (
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 flex gap-3 items-start">
            <CheckCircle2 className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">
                {t("portalFunding.completeTitle")}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("portalFunding.completeBody")}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="text-sm font-semibold mb-2">
              {t("portalFunding.uploadsTitle")}
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              {t("portalFunding.uploadsHint")}
            </p>
            <ul className="space-y-2">
              {FUNDING_REQUIRED_DOC_SLOTS.map((slot) => {
                const ok = uploaded.has(slot);
                return (
                  <li
                    key={slot}
                    className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5"
                  >
                    {ok ? (
                      <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span
                      className={`flex-1 text-sm ${
                        ok ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {t(`portalFunding.docs.${slotLabelKey(slot)}`)}
                    </span>
                    {!ok ? (
                      <button
                        type="button"
                        disabled={portalUploading}
                        onClick={() => pickFile(slot)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                      >
                        {portalUploading && uploadSlot === slot ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FileUp className="w-3.5 h-3.5" />
                        )}
                        {t("portalFunding.upload")}
                      </button>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase text-accent">
                        {t("portalFunding.uploaded")}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0] ?? null);
        }}
      />
    </div>
  );
}

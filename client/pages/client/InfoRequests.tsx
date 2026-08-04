import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import ClientPageHeader from "@/components/ClientPageHeader";
import LegalConsent from "@/components/LegalConsent";
import AcceptCardFields, {
  type AcceptCardHandle,
} from "@/components/AcceptCardFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchPortalInfoRequests,
  submitPortalInfoRequest,
} from "@/store/slices/infoRequestsSlice";
import type {
  ClientInfoRequest,
  InfoRequestFieldDef,
} from "@shared/api";
import { useToast } from "@/hooks/use-toast";

function statusBadgeClass(status: string) {
  switch (status) {
    case "open":
      return "bg-primary/10 text-primary border-primary/20";
    case "submitted":
      return "bg-secondary text-foreground border-border";
    case "approved":
      return "bg-accent/10 text-accent border-accent/25";
    case "rejected":
      return "bg-destructive/10 text-destructive border-destructive/25";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export default function InfoRequests() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const lang = (i18n.language?.startsWith("es") ? "es" : "en") as "en" | "es";
  const {
    portalRequests,
    portalLoading,
    portalSubmitting,
    portalError,
  } = useAppSelector((s) => s.infoRequests);

  const [activeId, setActiveId] = useState<number | null>(null);
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedSms, setAgreedSms] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const cardRef = useRef<AcceptCardHandle>(null);

  useEffect(() => {
    dispatch(fetchPortalInfoRequests());
  }, [dispatch]);

  const active = useMemo(
    () => portalRequests.find((r) => r.id === activeId) ?? null,
    [portalRequests, activeId],
  );

  const openForm = (req: ClientInfoRequest) => {
    setActiveId(req.id);
    setResponses({});
    setFiles({});
    setAgreedTerms(false);
    setAgreedSms(false);
    setConsentError(null);
  };

  const labelFor = (f: InfoRequestFieldDef) =>
    lang === "es" ? f.label_es : f.label_en;
  const helpFor = (f: InfoRequestFieldDef) =>
    lang === "es" ? f.help_es : f.help_en;
  const titleFor = (r: ClientInfoRequest) =>
    lang === "es" ? r.title_es : r.title_en;
  const messageFor = (r: ClientInfoRequest) =>
    lang === "es" ? r.message_es : r.message_en;

  const setField = (key: string, value: unknown) =>
    setResponses((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (!active) return;
    if (!agreedTerms || !agreedSms) {
      setConsentError(t("legal.consentRequired"));
      return;
    }
    setConsentError(null);

    const fd = new FormData();
    fd.append("agreed_terms", "true");
    fd.append("agreed_sms", "true");
    fd.append("responses", JSON.stringify(responses));

    const hasCard = active.fields_json.some((f) => f.type === "payment_card");
    if (hasCard && cardRef.current) {
      try {
        const token = await cardRef.current.tokenize();
        fd.append("dataDescriptor", token.dataDescriptor);
        fd.append("dataValue", token.dataValue);
      } catch (e: any) {
        toast({
          title: t("infoRequests.submitFailed"),
          description: e?.message || t("infoRequests.cardFailed"),
          variant: "destructive",
        });
        return;
      }
    }

    for (const [key, file] of Object.entries(files)) {
      if (file) fd.append(`file_${key}`, file);
    }

    const result = await dispatch(
      submitPortalInfoRequest({ requestId: active.id, formData: fd }),
    );
    if (result.meta.requestStatus === "fulfilled") {
      toast({ title: t("infoRequests.submitSuccess") });
      setActiveId(null);
    } else {
      toast({
        title: t("infoRequests.submitFailed"),
        description: (result.payload as string) || portalError || undefined,
        variant: "destructive",
      });
    }
  };

  const canEdit =
    active && (active.status === "open" || active.status === "rejected");

  if (portalLoading && portalRequests.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ClientPageHeader
        title={t("infoRequests.title")}
        description={t("infoRequests.description")}
      />

      {active ? (
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => setActiveId(null)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("infoRequests.backToList")}
          </button>

          <div className="bg-card rounded-2xl border border-border p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{titleFor(active)}</h2>
                {messageFor(active) && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {messageFor(active)}
                  </p>
                )}
              </div>
              <span
                className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border ${statusBadgeClass(active.status)}`}
              >
                {t(`infoRequests.status.${active.status}`)}
              </span>
            </div>

            {active.status === "rejected" && active.rejection_reason && (
              <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive flex gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{t("infoRequests.rejectedTitle")}</p>
                  <p className="mt-0.5">{active.rejection_reason}</p>
                </div>
              </div>
            )}

            {!canEdit && (
              <div className="rounded-xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
                {active.status === "submitted"
                  ? t("infoRequests.awaitingReview")
                  : active.status === "approved"
                    ? t("infoRequests.approvedNote")
                    : t("infoRequests.closedNote")}
                {active.response_json && (
                  <pre className="mt-3 text-xs whitespace-pre-wrap font-mono bg-background/60 rounded-lg p-3 border border-border overflow-x-auto">
                    {JSON.stringify(active.response_json, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {canEdit && (
              <div className="space-y-5">
                {active.fields_json.map((field) => (
                  <div key={field.id || field.key} className="space-y-2">
                    <Label className="text-sm font-medium">
                      {labelFor(field)}
                      {field.required ? " *" : ""}
                    </Label>
                    {helpFor(field) && (
                      <p className="text-xs text-muted-foreground">
                        {helpFor(field)}
                      </p>
                    )}

                    {field.type === "textarea" && (
                      <Textarea
                        value={String(responses[field.key] ?? "")}
                        onChange={(e) => setField(field.key, e.target.value)}
                        rows={4}
                      />
                    )}
                    {(field.type === "text" ||
                      field.type === "email" ||
                      field.type === "password") && (
                      <Input
                        type={
                          field.type === "password"
                            ? "password"
                            : field.type === "email"
                              ? "email"
                              : "text"
                        }
                        value={String(responses[field.key] ?? "")}
                        onChange={(e) => setField(field.key, e.target.value)}
                      />
                    )}
                    {field.type === "select" && (
                      <select
                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={String(responses[field.key] ?? "")}
                        onChange={(e) => setField(field.key, e.target.value)}
                      >
                        <option value="">{t("infoRequests.selectOption")}</option>
                        {(field.options || []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {lang === "es" ? o.label_es : o.label_en}
                          </option>
                        ))}
                      </select>
                    )}
                    {field.type === "upload" && (
                      <Input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) =>
                          setFiles((prev) => ({
                            ...prev,
                            [field.key]: e.target.files?.[0] ?? null,
                          }))
                        }
                      />
                    )}
                    {field.type === "smart_credit_block" && (
                      <div className="grid sm:grid-cols-2 gap-3 rounded-xl border border-border p-4">
                        {(
                          [
                            ["email", "email", t("infoRequests.scEmail")],
                            ["password", "password", t("infoRequests.scPassword")],
                            [
                              "security_question",
                              "text",
                              t("infoRequests.scQuestion"),
                            ],
                            [
                              "security_answer",
                              "password",
                              t("infoRequests.scAnswer"),
                            ],
                          ] as const
                        ).map(([k, inputType, label]) => (
                          <div key={k} className="space-y-1.5 sm:col-span-1">
                            <Label className="text-xs">{label}</Label>
                            <Input
                              type={inputType}
                              value={String(
                                ((responses[field.key] as any) || {})[k] ?? "",
                              )}
                              onChange={(e) =>
                                setField(field.key, {
                                  ...((responses[field.key] as object) || {}),
                                  [k]: e.target.value,
                                })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {field.type === "billing_confirm" && (
                      <div className="grid sm:grid-cols-2 gap-3 rounded-xl border border-border p-4">
                        {(
                          [
                            ["address_line1", t("infoRequests.address1"), "sm:col-span-2"],
                            ["address_line2", t("infoRequests.address2"), "sm:col-span-2"],
                            ["city", t("infoRequests.city"), ""],
                            ["state", t("infoRequests.state"), ""],
                            ["postal_code", t("infoRequests.postal"), ""],
                            ["card_last4", t("infoRequests.cardLast4"), ""],
                          ] as const
                        ).map(([k, label, span]) => (
                          <div key={k} className={`space-y-1.5 ${span}`}>
                            <Label className="text-xs">{label}</Label>
                            <Input
                              value={String(
                                ((responses[field.key] as any) || {})[k] ?? "",
                              )}
                              onChange={(e) =>
                                setField(field.key, {
                                  ...((responses[field.key] as object) || {}),
                                  [k]: e.target.value,
                                })
                              }
                              maxLength={k === "card_last4" ? 4 : undefined}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {field.type === "payment_card" && (
                      <AcceptCardFields ref={cardRef} disabled={portalSubmitting} />
                    )}
                  </div>
                ))}

                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <p className="text-sm font-medium mb-3">
                    {t("infoRequests.consentBanner")}
                  </p>
                  <LegalConsent
                    agreedTerms={agreedTerms}
                    agreedSms={agreedSms}
                    onAgreedTermsChange={setAgreedTerms}
                    onAgreedSmsChange={setAgreedSms}
                    error={consentError}
                  />
                </div>

                <Button
                  onClick={handleSubmit}
                  disabled={portalSubmitting}
                  className="w-full sm:w-auto"
                >
                  {portalSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  {t("infoRequests.submit")}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {portalRequests.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border p-10 text-center">
              <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">{t("infoRequests.empty")}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t("infoRequests.emptyHint")}
              </p>
            </div>
          ) : (
            portalRequests.map((req) => (
              <button
                key={req.id}
                type="button"
                onClick={() => openForm(req)}
                className="w-full text-left bg-card rounded-2xl border border-border p-4 sm:p-5 hover:border-primary/30 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{titleFor(req)}</p>
                    {messageFor(req) && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {messageFor(req)}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-2">
                      {req.case_number || ""} ·{" "}
                      {new Date(req.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border ${statusBadgeClass(req.status)}`}
                  >
                    {t(`infoRequests.status.${req.status}`)}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

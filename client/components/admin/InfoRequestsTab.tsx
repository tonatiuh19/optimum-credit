import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Eye,
  Loader2,
  Plus,
  Trash2,
  XCircle,
  ClipboardList,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  cancelInfoRequest,
  createCaseInfoRequest,
  fetchAdminInfoRequestDetail,
  fetchCaseInfoRequests,
  reviewInfoRequest,
} from "@/store/slices/infoRequestsSlice";
import {
  buildInfoRequestPresetFields,
  defaultInfoRequestTitles,
} from "@shared/infoRequestPresets";
import type {
  ClientInfoRequest,
  InfoRequestFieldDef,
  InfoRequestFieldType,
  InfoRequestPresetKey,
} from "@shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import api from "@/lib/api";
import FieldHint from "@/components/admin/FieldHint";

const PRESETS: { key: InfoRequestPresetKey; label: string }[] = [
  { key: "smart_credit", label: "Smart Credit access" },
  // payment_card (Accept.js) deferred — re-enable when sandbox E2E is ready
  { key: "payment_billing", label: "Confirm billing info" },
  { key: "custom", label: "Custom / free-form" },
];

const FIELD_TYPES: { value: InfoRequestFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "password", label: "Password" },
  { value: "textarea", label: "Text area" },
  { value: "select", label: "Select" },
  { value: "upload", label: "Upload" },
  { value: "smart_credit_block", label: "Smart Credit block" },
  // payment_card deferred until Accept.js update-card flow is validated
  { value: "billing_confirm", label: "Billing confirm" },
];

function statusClass(status: string) {
  switch (status) {
    case "open":
      return "bg-primary/10 text-primary";
    case "submitted":
      return "bg-secondary text-foreground";
    case "approved":
      return "bg-accent/10 text-accent";
    case "rejected":
      return "bg-destructive/10 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function newField(partial?: Partial<InfoRequestFieldDef>): InfoRequestFieldDef {
  const key = partial?.key || `field_${Date.now()}`;
  return {
    id: key,
    key,
    type: partial?.type || "text",
    label_en: partial?.label_en || "New field",
    label_es: partial?.label_es || "Nuevo campo",
    required: partial?.required ?? true,
    help_en: partial?.help_en,
    help_es: partial?.help_es,
    options: partial?.options,
  };
}

function formatResponseValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => formatResponseValue(v)).join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatResponseValue(v)}`)
      .join("\n");
  }
  return String(value);
}

function LabeledKvList({
  fields,
  data,
  emptyLabel,
  sensitive,
}: {
  fields: InfoRequestFieldDef[];
  data: Record<string, unknown> | null | undefined;
  emptyLabel: string;
  sensitive?: boolean;
}) {
  const entries = Object.entries(data || {});
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return (
    <dl
      className={`space-y-2.5 rounded-lg border p-3 ${
        sensitive
          ? "bg-destructive/5 border-destructive/20"
          : "bg-secondary/40 border-border"
      }`}
    >
      {entries.map(([key, value]) => {
        const field = byKey.get(key);
        const label = field?.label_en || key;
        return (
          <div key={key} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
              {field && field.key !== field.label_en ? (
                <span className="font-mono normal-case opacity-60 ml-1.5">
                  {key}
                </span>
              ) : null}
            </dt>
            <dd className="text-sm whitespace-pre-wrap break-words mt-0.5">
              {formatResponseValue(value)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function InfoRequestsTab({
  caseId,
  onChanged,
}: {
  caseId: number;
  onChanged?: () => void;
}) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const { adminByCase, adminLoading, adminSaving } = useAppSelector(
    (s) => s.infoRequests,
  );
  const requests = adminByCase[caseId] || [];

  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preset, setPreset] = useState<InfoRequestPresetKey>("smart_credit");
  const [titleEn, setTitleEn] = useState("");
  const [titleEs, setTitleEs] = useState("");
  const [messageEn, setMessageEn] = useState("");
  const [messageEs, setMessageEs] = useState("");
  const [fields, setFields] = useState<InfoRequestFieldDef[]>([]);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detail, setDetail] = useState<ClientInfoRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    dispatch(fetchCaseInfoRequests(caseId));
  }, [caseId, dispatch]);

  const applyPreset = (key: InfoRequestPresetKey) => {
    setPreset(key);
    setPreviewing(false);
    const titles = defaultInfoRequestTitles(key);
    setTitleEn(titles.title_en);
    setTitleEs(titles.title_es);
    setMessageEn(titles.message_en);
    setMessageEs(titles.message_es);
    setFields(buildInfoRequestPresetFields(key));
  };

  useEffect(() => {
    if (creating && !titleEn) applyPreset(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating]);

  const pendingReview = useMemo(
    () => requests.filter((r) => r.status === "submitted").length,
    [requests],
  );

  const handleCreate = async () => {
    if (!titleEn.trim() || !titleEs.trim() || fields.length === 0) {
      toast({
        title: "Missing fields",
        description: "Titles and at least one field are required.",
        variant: "destructive",
      });
      return;
    }
    const res = await dispatch(
      createCaseInfoRequest({
        case_id: caseId,
        preset_key: preset,
        title_en: titleEn.trim(),
        title_es: titleEs.trim(),
        message_en: messageEn.trim() || null,
        message_es: messageEs.trim() || null,
        fields_json: fields,
      }),
    );
    if (res.meta.requestStatus === "fulfilled") {
      toast({ title: "Info request sent" });
      setCreating(false);
      setPreviewing(false);
      onChanged?.();
    } else {
      toast({
        title: "Failed to create",
        description: String(res.payload || ""),
        variant: "destructive",
      });
    }
  };

  const openDetail = async (id: number, withSecrets: boolean) => {
    setDetailLoading(true);
    const res = await dispatch(
      fetchAdminInfoRequestDetail({
        requestId: id,
        includeSecrets: withSecrets,
      }),
    );
    setDetailLoading(false);
    if (res.meta.requestStatus === "fulfilled") {
      setDetail(res.payload as ClientInfoRequest);
    }
  };

  const handleReview = async (
    requestId: number,
    status: "approved" | "rejected",
  ) => {
    if (status === "rejected" && !rejectReason.trim()) return;
    const res = await dispatch(
      reviewInfoRequest({
        requestId,
        caseId,
        status,
        rejection_reason: rejectReason,
      }),
    );
    if (res.meta.requestStatus === "fulfilled") {
      toast({
        title: status === "approved" ? "Approved" : "Rejected — client notified",
      });
      setRejectId(null);
      setRejectReason("");
      setDetail(null);
      onChanged?.();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] text-muted-foreground font-medium">
            Mid-pipeline information requests
          </p>
          {pendingReview > 0 && (
            <p className="text-xs text-primary font-semibold mt-0.5">
              {pendingReview} awaiting review
            </p>
          )}
        </div>
        {!creating && (
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
              setPreviewing(false);
              applyPreset("smart_credit");
            }}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Request info
          </Button>
        )}
      </div>

      {creating && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          {previewing ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("adminHelpers.infoPreviewTitle")}
              </p>
              <FieldHint>{t("adminHelpers.infoPreviewLangNote")}</FieldHint>
              <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  EN
                </p>
                <p className="text-sm font-semibold">{titleEn}</p>
                {messageEn.trim() ? (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {messageEn}
                  </p>
                ) : null}
                <ul className="space-y-1.5 pt-1">
                  {fields.map((f) => (
                    <li
                      key={f.key}
                      className="flex items-center justify-between gap-2 text-xs rounded-md border border-border/60 bg-background px-2.5 py-1.5"
                    >
                      <span className="font-medium truncate">
                        {f.label_en}
                        {f.required ? (
                          <span className="text-destructive ml-0.5">*</span>
                        ) : null}
                      </span>
                      <span className="text-[10px] uppercase text-muted-foreground shrink-0">
                        {f.type}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">
                  ES
                </p>
                <p className="text-sm font-semibold">{titleEs}</p>
                {messageEs.trim() ? (
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {messageEs}
                  </p>
                ) : null}
                <ul className="space-y-1.5 pt-1">
                  {fields.map((f) => (
                    <li
                      key={`${f.key}-es`}
                      className="flex items-center justify-between gap-2 text-xs rounded-md border border-border/60 bg-background px-2.5 py-1.5"
                    >
                      <span className="font-medium truncate">
                        {f.label_es}
                        {f.required ? (
                          <span className="text-destructive ml-0.5">*</span>
                        ) : null}
                      </span>
                      <span className="text-[10px] uppercase text-muted-foreground shrink-0">
                        {f.type}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <FieldHint tone="warning">
                {t("adminHelpers.infoPreviewWarn")}
              </FieldHint>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewing(false)}
                  disabled={adminSaving}
                >
                  {t("adminHelpers.infoBackEdit")}
                </Button>
                <Button size="sm" onClick={handleCreate} disabled={adminSaving}>
                  {adminSaving && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  )}
                  {t("adminHelpers.infoConfirmSend")}
                </Button>
              </div>
            </div>
          ) : (
            <>
          <div className="space-y-1.5">
            <Label className="text-xs">Preset</Label>
            <Select
              value={preset}
              onValueChange={(v) => applyPreset(v as InfoRequestPresetKey)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Title (EN)</Label>
              <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Title (ES)</Label>
              <Input value={titleEs} onChange={(e) => setTitleEs(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Message (EN) optional</Label>
              <Textarea
                rows={2}
                value={messageEn}
                onChange={(e) => setMessageEn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Message (ES) optional</Label>
              <Textarea
                rows={2}
                value={messageEs}
                onChange={(e) => setMessageEs(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Fields</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFields((f) => [...f, newField()])}
              >
                <Plus className="h-3 w-3 mr-1" /> Field
              </Button>
            </div>
            <FieldHint>{t("adminHelpers.infoFieldKeyHint")}</FieldHint>
            {fields.map((field, idx) => (
              <div
                key={field.id}
                className="rounded-lg border border-border p-3 space-y-2 bg-secondary/20"
              >
                <div className="flex gap-2">
                  <Select
                    value={field.type}
                    onValueChange={(v) =>
                      setFields((all) =>
                        all.map((f, i) =>
                          i === idx
                            ? { ...f, type: v as InfoRequestFieldType }
                            : f,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="flex-1"
                    placeholder="key"
                    value={field.key}
                    onChange={(e) =>
                      setFields((all) =>
                        all.map((f, i) =>
                          i === idx
                            ? {
                                ...f,
                                key: e.target.value,
                                id: e.target.value || f.id,
                              }
                            : f,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setFields((all) => all.filter((_, i) => i !== idx))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                {i18n.exists(`adminHelpers.infoFieldTypes.${field.type}`) && (
                  <FieldHint>
                    {t(`adminHelpers.infoFieldTypes.${field.type}`)}
                  </FieldHint>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Label EN"
                    value={field.label_en}
                    onChange={(e) =>
                      setFields((all) =>
                        all.map((f, i) =>
                          i === idx ? { ...f, label_en: e.target.value } : f,
                        ),
                      )
                    }
                  />
                  <Input
                    placeholder="Label ES"
                    value={field.label_es}
                    onChange={(e) =>
                      setFields((all) =>
                        all.map((f, i) =>
                          i === idx ? { ...f, label_es: e.target.value } : f,
                        ),
                      )
                    }
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!!field.required}
                    onChange={(e) =>
                      setFields((all) =>
                        all.map((f, i) =>
                          i === idx ? { ...f, required: e.target.checked } : f,
                        ),
                      )
                    }
                  />
                  Required
                </label>
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCreating(false);
                setPreviewing(false);
              }}
              disabled={adminSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!titleEn.trim() || !titleEs.trim() || fields.length === 0) {
                  toast({
                    title: "Missing fields",
                    description: "Titles and at least one field are required.",
                    variant: "destructive",
                  });
                  return;
                }
                setPreviewing(true);
              }}
              disabled={adminSaving}
            >
              <Eye className="h-3.5 w-3.5 mr-1" />
              {t("adminHelpers.infoSendPreview")}
            </Button>
          </div>
            </>
          )}
        </div>
      )}

      {adminLoading && requests.length === 0 ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 && !creating ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          <ClipboardList className="h-6 w-6 mx-auto mb-2 opacity-50" />
          No info requests yet.
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((req) => (
            <div
              key={req.id}
              className="rounded-xl border border-border p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{req.title_en}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(req.created_at).toLocaleString()}
                    {req.submitted_at
                      ? ` · submitted ${new Date(req.submitted_at).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusClass(req.status)}`}
                >
                  {req.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(req.status === "submitted" ||
                  req.status === "approved" ||
                  req.status === "rejected") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openDetail(req.id, !!req.has_secrets)}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    View
                  </Button>
                )}
                {req.status === "submitted" && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => handleReview(req.id, "approved")}
                      disabled={adminSaving}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRejectId(req.id);
                        setRejectReason("");
                      }}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" />
                      Reject
                    </Button>
                  </>
                )}
                {["open", "rejected", "submitted"].includes(req.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await dispatch(
                        cancelInfoRequest({ requestId: req.id, caseId }),
                      );
                      onChanged?.();
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>

              {rejectId === req.id && (
                <div className="space-y-2 pt-1">
                  <Textarea
                    rows={2}
                    placeholder="Rejection reason (required)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!rejectReason.trim() || adminSaving}
                      onClick={() => handleReview(req.id, "rejected")}
                    >
                      Confirm reject
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectId(null)}
                    >
                      Back
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-2xl border border-border shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{detail.title_en}</h3>
                <p className="text-xs text-muted-foreground">{detail.status}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDetail(null)}
              >
                Close
              </Button>
            </div>
            {detailLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                    {t("adminHelpers.infoResponseTitle")}
                  </p>
                  <LabeledKvList
                    fields={detail.fields_json || []}
                    data={detail.response_json}
                    emptyLabel={t("adminHelpers.infoPreviewEmpty")}
                  />
                </div>
                {detail.secrets_json && (
                  <div>
                    <p className="text-xs font-semibold uppercase text-destructive mb-1">
                      {t("adminHelpers.infoSensitiveTitle")}
                    </p>
                    <LabeledKvList
                      fields={detail.fields_json || []}
                      data={detail.secrets_json}
                      emptyLabel={t("adminHelpers.infoPreviewEmpty")}
                      sensitive
                    />
                  </div>
                )}
                {(detail.files || []).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      {t("adminHelpers.infoFilesTitle")}
                    </p>
                    {detail.files!.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="text-sm text-primary underline"
                        onClick={async () => {
                          const res = await api.get(
                            `/admin/info-requests/${detail.id}/files/${f.id}`,
                            { responseType: "blob" },
                          );
                          const url = URL.createObjectURL(res.data);
                          window.open(url, "_blank");
                        }}
                      >
                        {f.file_name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

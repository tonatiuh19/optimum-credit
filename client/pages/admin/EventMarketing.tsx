import { useEffect, useMemo, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";
import {
  CalendarDays,
  ClipboardList,
  Copy,
  DoorOpen,
  Download,
  Loader2,
  Plus,
  QrCode,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { EventResultsPanel } from "@/components/admin/events/EventResultsPanel";
import { EventImportDialog } from "@/components/admin/events/EventImportDialog";
import { EventDoorQrDialog } from "@/components/admin/events/EventDoorQrDialog";
import { EventRegistrationRow } from "@/components/admin/events/EventRegistrationRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createEventCompany,
  createEventFormField,
  createEventSeries,
  createEventSession,
  deleteEventFormField,
  fetchEventCompanies,
  fetchEventCompanyDetail,
  updateEventCompany,
  updateEventFormField,
  updateEventSeries,
  updateEventSession,
} from "@/store/slices/eventMarketingSlice";
import type {
  EventFormField,
  EventFormFieldType,
  EventRegistrationStatus,
  EventSeries,
  EventSession,
  EventSessionStatus,
} from "@shared/api";
import { logger } from "@/utils/logger";
import { cn } from "@/lib/utils";

function toDatetimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const s = String(value).trim().replace(" ", "T");
  return s.length >= 16 ? s.slice(0, 16) : s;
}

function fromDatetimeLocal(value: string): string {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.includes("T") ? s.replace("T", " ") + ":00" : s;
}

function absolutePublicUrl(path: string | undefined | null): string {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

async function downloadQrPng(url: string, filename: string) {
  const dataUrl = await QRCode.toDataURL(url, {
    width: 640,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  a.click();
}

const FIELD_TYPES: EventFormFieldType[] = [
  "text",
  "email",
  "phone",
  "textarea",
  "select",
  "checkbox",
  "language",
];

const SESSION_STATUSES: EventSessionStatus[] = [
  "scheduled",
  "cancelled",
  "completed",
];

export default function AdminEventMarketing() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const {
    companies,
    companiesLoading,
    companiesError,
    detail,
    detailLoading,
    detailError,
    saving,
    saveError,
  } = useAppSelector((s) => s.eventMarketing);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [panel, setPanel] = useState("copy");
  const [companyDialog, setCompanyDialog] = useState(false);
  const [seriesDialog, setSeriesDialog] = useState(false);
  const [sessionDialog, setSessionDialog] = useState(false);
  const [fieldDialog, setFieldDialog] = useState(false);
  const [editingSeries, setEditingSeries] = useState<EventSeries | null>(null);
  const [editingSession, setEditingSession] = useState<EventSession | null>(
    null,
  );
  const [editingField, setEditingField] = useState<EventFormField | null>(null);
  const [qrBusy, setQrBusy] = useState<string | null>(null);
  const [doorQrFor, setDoorQrFor] = useState<EventSession | null>(null);
  const [importFor, setImportFor] = useState<EventSession | null>(null);
  const [regFilter, setRegFilter] = useState<EventRegistrationStatus | "all">("all");
  const [regSearch, setRegSearch] = useState("");

  useEffect(() => {
    dispatch(fetchEventCompanies()).catch((e) =>
      logger.warn("event companies load failed", e),
    );
  }, [dispatch]);

  useEffect(() => {
    if (selectedId == null && companies.length) {
      setSelectedId(companies[0].id);
    }
  }, [companies, selectedId]);

  useEffect(() => {
    if (selectedId == null) return;
    dispatch(fetchEventCompanyDetail(selectedId)).catch((e) =>
      logger.warn("event company detail failed", e),
    );
  }, [dispatch, selectedId]);

  const company = detail?.company ?? null;
  const langEs = i18n.language?.startsWith("es");

  const companyForm = useFormik({
    enableReinitialize: true,
    initialValues: {
      slug: company?.slug ?? "",
      name: company?.name ?? "",
      name_es: company?.name_es ?? "",
      label_slug: company?.label_slug ?? "",
      is_active: company?.is_active ?? true,
      sort_order: company?.sort_order ?? 0,
      welcome_heading_en: company?.welcome_heading_en ?? "",
      welcome_heading_es: company?.welcome_heading_es ?? "",
      welcome_body_en: company?.welcome_body_en ?? "",
      welcome_body_es: company?.welcome_body_es ?? "",
      offer_free_report: company?.offer_free_report ?? true,
      offer_comic: company?.offer_comic ?? false,
      class_link_url: company?.class_link_url ?? "",
      class_schedule_note_en: company?.class_schedule_note_en ?? "",
      class_schedule_note_es: company?.class_schedule_note_es ?? "",
      email_subject_en: company?.email_subject_en ?? "",
      email_subject_es: company?.email_subject_es ?? "",
      email_body_en: company?.email_body_en ?? "",
      email_body_es: company?.email_body_es ?? "",
      sms_body_en: company?.sms_body_en ?? "",
      sms_body_es: company?.sms_body_es ?? "",
    },
    validationSchema: Yup.object({
      slug: Yup.string().trim().required(t("common.required")),
      name: Yup.string().trim().required(t("common.required")),
      label_slug: Yup.string().trim().required(t("common.required")),
      welcome_heading_en: Yup.string().required(t("common.required")),
      welcome_heading_es: Yup.string().required(t("common.required")),
      welcome_body_en: Yup.string().required(t("common.required")),
      welcome_body_es: Yup.string().required(t("common.required")),
      email_subject_en: Yup.string().required(t("common.required")),
      email_subject_es: Yup.string().required(t("common.required")),
      email_body_en: Yup.string().required(t("common.required")),
      email_body_es: Yup.string().required(t("common.required")),
      sms_body_en: Yup.string().required(t("common.required")),
      sms_body_es: Yup.string().required(t("common.required")),
    }),
    onSubmit: async (values) => {
      if (!company) return;
      const res = await dispatch(
        updateEventCompany({
          id: company.id,
          ...values,
          name_es: values.name_es || null,
          class_link_url: values.class_link_url || null,
          class_schedule_note_en: values.class_schedule_note_en || null,
          class_schedule_note_es: values.class_schedule_note_es || null,
        }),
      );
      if (updateEventCompany.fulfilled.match(res)) {
        dispatch(fetchEventCompanies());
      }
    },
  });

  const newCompanyForm = useFormik({
    initialValues: {
      slug: "",
      name: "",
      name_es: "",
      label_slug: "",
      welcome_heading_en: "Welcome!",
      welcome_heading_es: "¡Bienvenidos!",
      welcome_body_en: "Sign up for the upcoming event.",
      welcome_body_es: "Regístrate al próximo evento.",
      email_subject_en: "You're registered",
      email_subject_es: "Estás registrado",
      email_body_en:
        "Thanks {{first_name}}! You're signed up for {{session_title}} ({{session_when}}). Free report: {{report_url}}",
      email_body_es:
        "¡Gracias {{first_name}}! Te registraste para {{session_title}} ({{session_when}}). Reporte gratis: {{report_url}}",
      sms_body_en:
        "Hi {{first_name}}, you're in for {{session_title}} {{session_when}}. Free report: {{report_url}}",
      sms_body_es:
        "Hola {{first_name}}, estás registrado/a en {{session_title}} {{session_when}}. Reporte gratis: {{report_url}}",
    },
    validationSchema: Yup.object({
      slug: Yup.string().trim().required(t("common.required")),
      name: Yup.string().trim().required(t("common.required")),
      label_slug: Yup.string().trim().required(t("common.required")),
    }),
    onSubmit: async (values, { resetForm }) => {
      const res = await dispatch(
        createEventCompany({
          ...values,
          name_es: values.name_es || null,
          is_active: true,
          sort_order: companies.length * 10 + 10,
          offer_free_report: true,
          offer_comic: false,
        }),
      );
      if (createEventCompany.fulfilled.match(res)) {
        setSelectedId(res.payload.company.id);
        setCompanyDialog(false);
        resetForm();
      }
    },
  });

  const seriesForm = useFormik({
    enableReinitialize: true,
    initialValues: {
      slug: editingSeries?.slug ?? "",
      name_en: editingSeries?.name_en ?? "",
      name_es: editingSeries?.name_es ?? "",
      kind: (editingSeries?.kind ?? "in_person") as EventSeries["kind"],
      is_active: editingSeries?.is_active ?? true,
      sort_order: editingSeries?.sort_order ?? 10,
    },
    validationSchema: Yup.object({
      slug: Yup.string().trim().required(t("common.required")),
      name_en: Yup.string().trim().required(t("common.required")),
      name_es: Yup.string().trim().required(t("common.required")),
    }),
    onSubmit: async (values, { resetForm }) => {
      if (!company) return;
      if (editingSeries) {
        const res = await dispatch(
          updateEventSeries({ id: editingSeries.id, ...values }),
        );
        if (updateEventSeries.fulfilled.match(res)) {
          setSeriesDialog(false);
          setEditingSeries(null);
          resetForm();
        }
      } else {
        const res = await dispatch(
          createEventSeries({ companyId: company.id, ...values }),
        );
        if (createEventSeries.fulfilled.match(res)) {
          setSeriesDialog(false);
          resetForm();
        }
      }
    },
  });

  const sessionForm = useFormik({
    enableReinitialize: true,
    initialValues: {
      series_id: editingSession?.series_id
        ? String(editingSession.series_id)
        : detail?.series[0]
          ? String(detail.series[0].id)
          : "",
      short_code: editingSession?.short_code ?? "",
      title_en: editingSession?.title_en ?? "",
      title_es: editingSession?.title_es ?? "",
      starts_at: toDatetimeLocal(editingSession?.starts_at),
      ends_at: toDatetimeLocal(editingSession?.ends_at),
      location_en: editingSession?.location_en ?? "",
      location_es: editingSession?.location_es ?? "",
      capacity: editingSession?.capacity != null ? String(editingSession.capacity) : "",
      status: (editingSession?.status ?? "scheduled") as EventSessionStatus,
    },
    validationSchema: Yup.object({
      series_id: Yup.string().required(t("common.required")),
      short_code: Yup.string().trim().required(t("common.required")),
      title_en: Yup.string().trim().required(t("common.required")),
      title_es: Yup.string().trim().required(t("common.required")),
      starts_at: Yup.string().required(t("common.required")),
    }),
    onSubmit: async (values, { resetForm }) => {
      if (!company) return;
      const payload = {
        series_id: Number(values.series_id),
        short_code: values.short_code.trim(),
        title_en: values.title_en.trim(),
        title_es: values.title_es.trim(),
        starts_at: fromDatetimeLocal(values.starts_at),
        ends_at: values.ends_at ? fromDatetimeLocal(values.ends_at) : null,
        location_en: values.location_en || null,
        location_es: values.location_es || null,
        capacity: values.capacity ? Number(values.capacity) : null,
        status: values.status,
      };
      if (editingSession) {
        const res = await dispatch(
          updateEventSession({ id: editingSession.id, ...payload }),
        );
        if (updateEventSession.fulfilled.match(res)) {
          setSessionDialog(false);
          setEditingSession(null);
          resetForm();
          // Cancel / new date / more seats change registrations: refresh counts.
          void dispatch(fetchEventCompanyDetail(company.id));
        }
      } else {
        const res = await dispatch(
          createEventSession({ companyId: company.id, ...payload }),
        );
        if (createEventSession.fulfilled.match(res)) {
          setSessionDialog(false);
          resetForm();
        }
      }
    },
  });

  const fieldForm = useFormik({
    enableReinitialize: true,
    initialValues: {
      field_key: editingField?.field_key ?? "",
      label_en: editingField?.label_en ?? "",
      label_es: editingField?.label_es ?? "",
      field_type: (editingField?.field_type ?? "text") as EventFormFieldType,
      options_text: (editingField?.options_json || []).join("\n"),
      is_required: editingField?.is_required ?? false,
      is_active: editingField?.is_active ?? true,
      sort_order: editingField?.sort_order ?? 100,
    },
    validationSchema: Yup.object({
      field_key: Yup.string().trim().required(t("common.required")),
      label_en: Yup.string().trim().required(t("common.required")),
      label_es: Yup.string().trim().required(t("common.required")),
    }),
    onSubmit: async (values, { resetForm }) => {
      if (!company) return;
      const options =
        values.field_type === "select"
          ? values.options_text
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : null;
      const payload = {
        field_key: values.field_key.trim(),
        label_en: values.label_en.trim(),
        label_es: values.label_es.trim(),
        field_type: values.field_type,
        options_json: options,
        is_required: values.is_required,
        is_active: values.is_active,
        sort_order: Number(values.sort_order) || 0,
      };
      if (editingField) {
        const res = await dispatch(
          updateEventFormField({ id: editingField.id, ...payload }),
        );
        if (updateEventFormField.fulfilled.match(res)) {
          setFieldDialog(false);
          setEditingField(null);
          resetForm();
        }
      } else {
        const res = await dispatch(
          createEventFormField({ companyId: company.id, ...payload }),
        );
        if (createEventFormField.fulfilled.match(res)) {
          setFieldDialog(false);
          resetForm();
        }
      }
    },
  });

  const seriesById = useMemo(() => {
    const map = new Map<number, EventSeries>();
    for (const s of detail?.series || []) map.set(s.id, s);
    return map;
  }, [detail?.series]);

  const visibleRegs = useMemo(() => {
    const q = regSearch.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return (detail?.registrations || []).filter((r) => {
      if (regFilter !== "all" && r.status !== regFilter) return false;
      if (!q) return true;
      const hay = [r.first_name, r.last_name, r.email].filter(Boolean).join(" ").toLowerCase();
      if (hay.includes(q)) return true;
      return qDigits.length >= 3 && String(r.phone || "").replace(/\D/g, "").includes(qDigits);
    });
  }, [detail?.registrations, regFilter, regSearch]);

  const handleDownloadQr = async (
    pathOrUrl: string | undefined | null,
    filename: string,
    key: string,
  ) => {
    const url = absolutePublicUrl(pathOrUrl);
    if (!url) return;
    setQrBusy(key);
    try {
      await downloadQrPng(url, filename);
    } catch (err) {
      logger.error("QR download failed", err);
    } finally {
      setQrBusy(null);
    }
  };

  const copyLink = async (pathOrUrl: string | undefined | null) => {
    const url = absolutePublicUrl(pathOrUrl);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      logger.warn("clipboard failed", err);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={CalendarDays}
        title={t("eventMarketing.admin.title")}
        description={t("eventMarketing.admin.description")}
        actions={
          <Button
            size="sm"
            onClick={() => {
              newCompanyForm.resetForm();
              setCompanyDialog(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {t("eventMarketing.admin.addCompany")}
          </Button>
        }
      />

      {(companiesError || detailError || saveError) && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {saveError || detailError || companiesError}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-card p-2 space-y-1 max-h-[70vh] overflow-y-auto">
          {companiesLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : companies.length === 0 ? (
            <p className="text-sm text-muted-foreground p-3">
              {t("eventMarketing.admin.emptyCompanies")}
            </p>
          ) : (
            companies.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "w-full text-left rounded-lg px-3 py-2.5 transition-colors",
                  selectedId === c.id
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted/60 text-muted-foreground",
                )}
              >
                <div className="text-sm font-medium text-foreground truncate">
                  {langEs && c.name_es ? c.name_es : c.name}
                </div>
                <div className="text-xs mt-0.5 flex items-center gap-2">
                  <span className="font-mono">/{c.slug}</span>
                  {!c.is_active && (
                    <span className="text-destructive">
                      {t("eventMarketing.admin.inactive")}
                    </span>
                  )}
                  {typeof c.registration_count === "number" && (
                    <span className="inline-flex items-center gap-0.5">
                      <Users className="w-3 h-3" />
                      {c.registration_count}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </aside>

        <div className="min-w-0 space-y-4">
          {detailLoading && !company ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : !company ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center text-sm text-muted-foreground">
              {t("eventMarketing.admin.selectCompany")}
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-4 sm:p-5 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h2 className="text-lg font-semibold text-foreground">
                    {langEs && company.name_es ? company.name_es : company.name}
                  </h2>
                  <p className="text-sm text-muted-foreground font-mono">
                    {absolutePublicUrl(company.public_url || `/e/${company.slug}`)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      copyLink(company.public_url || `/e/${company.slug}`)
                    }
                  >
                    <Copy className="w-4 h-4 mr-1.5" />
                    {t("eventMarketing.admin.copyLink")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={qrBusy === "company"}
                    onClick={() =>
                      handleDownloadQr(
                        company.public_url || `/e/${company.slug}`,
                        `event-qr-${company.slug}`,
                        "company",
                      )
                    }
                  >
                    {qrBusy === "company" ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <QrCode className="w-4 h-4 mr-1.5" />
                    )}
                    {t("eventMarketing.admin.downloadQr")}
                  </Button>
                </div>
              </div>

              <Tabs value={panel} onValueChange={setPanel}>
                <TabsList className="flex flex-wrap h-auto gap-1">
                  <TabsTrigger value="copy">
                    {t("eventMarketing.admin.tabs.copy")}
                  </TabsTrigger>
                  <TabsTrigger value="sessions">
                    {t("eventMarketing.admin.tabs.sessions")}
                  </TabsTrigger>
                  <TabsTrigger value="fields">
                    {t("eventMarketing.admin.tabs.fields")}
                  </TabsTrigger>
                  <TabsTrigger value="regs">
                    {t("eventMarketing.admin.tabs.registrations")}
                  </TabsTrigger>
                  <TabsTrigger value="results">
                    {t("eventMarketing.admin.tabs.results")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="copy" className="mt-4">
                  <form
                    onSubmit={companyForm.handleSubmit}
                    className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label={t("eventMarketing.admin.fields.slug")}
                        name="slug"
                        form={companyForm}
                      />
                      <Field
                        label={t("eventMarketing.admin.fields.labelSlug")}
                        name="label_slug"
                        form={companyForm}
                      />
                      <Field
                        label={t("eventMarketing.admin.fields.name")}
                        name="name"
                        form={companyForm}
                      />
                      <Field
                        label={t("eventMarketing.admin.fields.nameEs")}
                        name="name_es"
                        form={companyForm}
                      />
                    </div>
                    <div className="flex flex-wrap gap-6">
                      <SwitchRow
                        label={t("eventMarketing.admin.fields.active")}
                        checked={companyForm.values.is_active}
                        onChange={(v) =>
                          companyForm.setFieldValue("is_active", v)
                        }
                      />
                      <SwitchRow
                        label={t("eventMarketing.admin.fields.offerReport")}
                        checked={companyForm.values.offer_free_report}
                        onChange={(v) =>
                          companyForm.setFieldValue("offer_free_report", v)
                        }
                      />
                      <SwitchRow
                        label={t("eventMarketing.admin.fields.offerComic")}
                        checked={companyForm.values.offer_comic}
                        onChange={(v) =>
                          companyForm.setFieldValue("offer_comic", v)
                        }
                      />
                    </div>
                    <TextAreaField
                      label={t("eventMarketing.admin.fields.headingEn")}
                      name="welcome_heading_en"
                      form={companyForm}
                      rows={2}
                    />
                    <TextAreaField
                      label={t("eventMarketing.admin.fields.headingEs")}
                      name="welcome_heading_es"
                      form={companyForm}
                      rows={2}
                    />
                    <TextAreaField
                      label={t("eventMarketing.admin.fields.bodyEn")}
                      name="welcome_body_en"
                      form={companyForm}
                      rows={3}
                    />
                    <TextAreaField
                      label={t("eventMarketing.admin.fields.bodyEs")}
                      name="welcome_body_es"
                      form={companyForm}
                      rows={3}
                    />
                    <Field
                      label={t("eventMarketing.admin.fields.classLink")}
                      name="class_link_url"
                      form={companyForm}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label={t("eventMarketing.admin.fields.scheduleNoteEn")}
                        name="class_schedule_note_en"
                        form={companyForm}
                      />
                      <Field
                        label={t("eventMarketing.admin.fields.scheduleNoteEs")}
                        name="class_schedule_note_es"
                        form={companyForm}
                      />
                    </div>
                    <div className="border-t border-border pt-4 space-y-3">
                      <p className="text-sm font-medium text-foreground">
                        {t("eventMarketing.admin.welcomeTemplates")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("eventMarketing.admin.templateTokens")}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label={t("eventMarketing.admin.fields.emailSubjectEn")}
                          name="email_subject_en"
                          form={companyForm}
                        />
                        <Field
                          label={t("eventMarketing.admin.fields.emailSubjectEs")}
                          name="email_subject_es"
                          form={companyForm}
                        />
                      </div>
                      <TextAreaField
                        label={t("eventMarketing.admin.fields.emailBodyEn")}
                        name="email_body_en"
                        form={companyForm}
                        rows={4}
                      />
                      <TextAreaField
                        label={t("eventMarketing.admin.fields.emailBodyEs")}
                        name="email_body_es"
                        form={companyForm}
                        rows={4}
                      />
                      <TextAreaField
                        label={t("eventMarketing.admin.fields.smsBodyEn")}
                        name="sms_body_en"
                        form={companyForm}
                        rows={2}
                      />
                      <TextAreaField
                        label={t("eventMarketing.admin.fields.smsBodyEs")}
                        name="sms_body_es"
                        form={companyForm}
                        rows={2}
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={saving}>
                        {saving && (
                          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                        )}
                        {t("eventMarketing.admin.save")}
                      </Button>
                    </div>
                  </form>
                </TabsContent>

                <TabsContent value="sessions" className="mt-4 space-y-4">
                  <SectionHeader
                    title={t("eventMarketing.admin.seriesTitle")}
                    action={
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingSeries(null);
                          seriesForm.resetForm();
                          setSeriesDialog(true);
                        }}
                      >
                        <Plus className="w-4 h-4 mr-1.5" />
                        {t("eventMarketing.admin.addSeries")}
                      </Button>
                    }
                  />
                  <div className="space-y-2">
                    {(detail?.series || []).map((s) => (
                      <div
                        key={s.id}
                        className="rounded-lg border border-border bg-card px-3 py-2.5 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {langEs ? s.name_es : s.name_en}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {s.slug} · {t(`eventMarketing.kind.${s.kind}`)}
                            {!s.is_active
                              ? ` · ${t("eventMarketing.admin.inactive")}`
                              : ""}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingSeries(s);
                            setSeriesDialog(true);
                          }}
                        >
                          {t("eventMarketing.admin.edit")}
                        </Button>
                      </div>
                    ))}
                    {!detail?.series?.length && (
                      <p className="text-sm text-muted-foreground">
                        {t("eventMarketing.admin.emptySeries")}
                      </p>
                    )}
                  </div>

                  <SectionHeader
                    title={t("eventMarketing.admin.sessionsTitle")}
                    action={
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditingSession(null);
                          sessionForm.resetForm();
                          setSessionDialog(true);
                        }}
                        disabled={!detail?.series?.length}
                      >
                        <Plus className="w-4 h-4 mr-1.5" />
                        {t("eventMarketing.admin.addSession")}
                      </Button>
                    }
                  />
                  <div className="space-y-2">
                    {(detail?.sessions || []).map((s) => {
                      const series = seriesById.get(s.series_id);
                      return (
                        <div
                          key={s.id}
                          className="rounded-lg border border-border bg-card px-3 py-3 space-y-2"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium">
                                {langEs ? s.title_es : s.title_en}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {s.short_code}
                                {series
                                  ? ` · ${langEs ? series.name_es : series.name_en}`
                                  : ""}
                                {" · "}
                                {toDatetimeLocal(s.starts_at).replace("T", " ")}
                                {" · "}
                                {t(`eventMarketing.status.${s.status}`)}
                                {typeof s.registration_count === "number"
                                  ? ` · ${
                                      s.capacity
                                        ? t("eventMarketing.admin.capacityOf", { count: s.registration_count, capacity: s.capacity })
                                        : `${s.registration_count} ${t("eventMarketing.admin.regsShort")}`
                                    }`
                                  : ""}
                                {s.waitlist_count
                                  ? ` · ${s.waitlist_count} ${t("eventMarketing.admin.waitlistShort")}`
                                  : ""}
                                {s.attended_count
                                  ? ` · ${s.attended_count} ${t("eventMarketing.admin.attendedShort")}`
                                  : ""}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {s.status !== "cancelled" && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setDoorQrFor(s)}
                                    title={t("eventMarketing.admin.doorQr")}
                                  >
                                    <DoorOpen className="w-3.5 h-3.5 sm:mr-1" />
                                    <span className="hidden sm:inline">{t("eventMarketing.admin.doorQr")}</span>
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setImportFor(s)}
                                    title={t("eventMarketing.admin.import.button")}
                                  >
                                    <ClipboardList className="w-3.5 h-3.5 sm:mr-1" />
                                    <span className="hidden sm:inline">{t("eventMarketing.admin.import.button")}</span>
                                  </Button>
                                </>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={qrBusy === `s-${s.id}`}
                                onClick={() =>
                                  handleDownloadQr(
                                    s.public_url ||
                                      `/e/${company.slug}/s/${s.short_code}`,
                                    `event-qr-${s.short_code}`,
                                    `s-${s.id}`,
                                  )
                                }
                              >
                                {qrBusy === `s-${s.id}` ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingSession(s);
                                  setSessionDialog(true);
                                }}
                              >
                                {t("eventMarketing.admin.edit")}
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {!detail?.sessions?.length && (
                      <p className="text-sm text-muted-foreground">
                        {t("eventMarketing.admin.emptySessions")}
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="fields" className="mt-4 space-y-3">
                  <SectionHeader
                    title={t("eventMarketing.admin.fieldsTitle")}
                    action={
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditingField(null);
                          fieldForm.resetForm();
                          setFieldDialog(true);
                        }}
                      >
                        <Plus className="w-4 h-4 mr-1.5" />
                        {t("eventMarketing.admin.addField")}
                      </Button>
                    }
                  />
                  {(detail?.form_fields || []).map((f) => (
                    <div
                      key={f.id}
                      className="rounded-lg border border-border bg-card px-3 py-2.5 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {langEs ? f.label_es : f.label_en}
                          {f.is_required ? " *" : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {f.field_key} · {f.field_type}
                          {f.is_system
                            ? ` · ${t("eventMarketing.admin.systemField")}`
                            : ""}
                          {!f.is_active
                            ? ` · ${t("eventMarketing.admin.inactive")}`
                            : ""}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingField(f);
                            setFieldDialog(true);
                          }}
                        >
                          {t("eventMarketing.admin.edit")}
                        </Button>
                        {!f.is_system && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={saving}
                            onClick={() =>
                              dispatch(deleteEventFormField(f.id))
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="regs" className="mt-4 space-y-2">
                  {(detail?.registrations || []).length > 0 && (
                    <div className="flex flex-col sm:flex-row gap-2 pb-1">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={regSearch}
                          onChange={(e) => setRegSearch(e.target.value)}
                          placeholder={t("eventMarketing.admin.searchRegs")}
                          className="pl-8"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(["all", "registered", "waitlisted", "cancelled"] as const).map((f) => (
                          <Button
                            key={f}
                            size="sm"
                            variant={regFilter === f ? "default" : "outline"}
                            onClick={() => setRegFilter(f)}
                          >
                            {f === "all"
                              ? t("eventMarketing.admin.filterAll")
                              : t(`eventMarketing.admin.regStatus.${f}`)}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {visibleRegs.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6">
                      {t("eventMarketing.admin.emptyRegs")}
                    </p>
                  ) : (
                    visibleRegs.map((r) => (
                      <EventRegistrationRow key={r.id} r={r} saving={saving} />
                    ))
                  )}
                </TabsContent>

                <TabsContent value="results" className="mt-4">
                  {panel === "results" && <EventResultsPanel companyId={company.id} />}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>

      {/* New company */}
      <Dialog open={companyDialog} onOpenChange={setCompanyDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("eventMarketing.admin.addCompany")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={newCompanyForm.handleSubmit} className="space-y-3">
            <Field
              label={t("eventMarketing.admin.fields.slug")}
              name="slug"
              form={newCompanyForm}
            />
            <Field
              label={t("eventMarketing.admin.fields.labelSlug")}
              name="label_slug"
              form={newCompanyForm}
            />
            <Field
              label={t("eventMarketing.admin.fields.name")}
              name="name"
              form={newCompanyForm}
            />
            <Field
              label={t("eventMarketing.admin.fields.nameEs")}
              name="name_es"
              form={newCompanyForm}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCompanyDialog(false)}
              >
                {t("eventMarketing.admin.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                {t("eventMarketing.admin.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Series dialog */}
      <Dialog
        open={seriesDialog}
        onOpenChange={(open) => {
          setSeriesDialog(open);
          if (!open) setEditingSeries(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingSeries
                ? t("eventMarketing.admin.editSeries")
                : t("eventMarketing.admin.addSeries")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={seriesForm.handleSubmit} className="space-y-3">
            <Field
              label={t("eventMarketing.admin.fields.slug")}
              name="slug"
              form={seriesForm}
            />
            <Field
              label={t("eventMarketing.admin.fields.nameEn")}
              name="name_en"
              form={seriesForm}
            />
            <Field
              label={t("eventMarketing.admin.fields.nameEs")}
              name="name_es"
              form={seriesForm}
            />
            <div className="space-y-1.5">
              <Label>{t("eventMarketing.admin.fields.kind")}</Label>
              <Select
                value={seriesForm.values.kind}
                onValueChange={(v) => seriesForm.setFieldValue("kind", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_person">
                    {t("eventMarketing.kind.in_person")}
                  </SelectItem>
                  <SelectItem value="online">
                    {t("eventMarketing.kind.online")}
                  </SelectItem>
                  <SelectItem value="hybrid">
                    {t("eventMarketing.kind.hybrid")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SwitchRow
              label={t("eventMarketing.admin.fields.active")}
              checked={seriesForm.values.is_active}
              onChange={(v) => seriesForm.setFieldValue("is_active", v)}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSeriesDialog(false)}
              >
                {t("eventMarketing.admin.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                {t("eventMarketing.admin.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Session dialog */}
      <Dialog
        open={sessionDialog}
        onOpenChange={(open) => {
          setSessionDialog(open);
          if (!open) setEditingSession(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingSession
                ? t("eventMarketing.admin.editSession")
                : t("eventMarketing.admin.addSession")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={sessionForm.handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("eventMarketing.admin.fields.series")}</Label>
              <Select
                value={sessionForm.values.series_id}
                onValueChange={(v) =>
                  sessionForm.setFieldValue("series_id", v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(detail?.series || []).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {langEs ? s.name_es : s.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field
              label={t("eventMarketing.admin.fields.shortCode")}
              name="short_code"
              form={sessionForm}
            />
            <Field
              label={t("eventMarketing.admin.fields.titleEn")}
              name="title_en"
              form={sessionForm}
            />
            <Field
              label={t("eventMarketing.admin.fields.titleEs")}
              name="title_es"
              form={sessionForm}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("eventMarketing.admin.fields.startsAt")}</Label>
                <Input
                  type="datetime-local"
                  name="starts_at"
                  value={sessionForm.values.starts_at}
                  onChange={sessionForm.handleChange}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("eventMarketing.admin.fields.endsAt")}</Label>
                <Input
                  type="datetime-local"
                  name="ends_at"
                  value={sessionForm.values.ends_at}
                  onChange={sessionForm.handleChange}
                />
              </div>
            </div>
            <Field
              label={t("eventMarketing.admin.fields.locationEn")}
              name="location_en"
              form={sessionForm}
            />
            <Field
              label={t("eventMarketing.admin.fields.locationEs")}
              name="location_es"
              form={sessionForm}
            />
            <Field
              label={t("eventMarketing.admin.fields.capacity")}
              name="capacity"
              form={sessionForm}
            />
            <div className="space-y-1.5">
              <Label>{t("eventMarketing.admin.fields.status")}</Label>
              <Select
                value={sessionForm.values.status}
                onValueChange={(v) =>
                  sessionForm.setFieldValue("status", v as EventSessionStatus)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SESSION_STATUSES.map((st) => (
                    <SelectItem key={st} value={st}>
                      {t(`eventMarketing.status.${st}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editingSession && (
              <p className="text-xs text-muted-foreground rounded-lg bg-muted/50 px-3 py-2">
                {t("eventMarketing.admin.notifyOnSave")}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSessionDialog(false)}
              >
                {t("eventMarketing.admin.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                {t("eventMarketing.admin.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Field dialog */}
      <Dialog
        open={fieldDialog}
        onOpenChange={(open) => {
          setFieldDialog(open);
          if (!open) setEditingField(null);
        }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingField
                ? t("eventMarketing.admin.editField")
                : t("eventMarketing.admin.addField")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={fieldForm.handleSubmit} className="space-y-3">
            <Field
              label={t("eventMarketing.admin.fields.fieldKey")}
              name="field_key"
              form={fieldForm}
              disabled={!!editingField?.is_system}
            />
            <Field
              label={t("eventMarketing.admin.fields.labelEn")}
              name="label_en"
              form={fieldForm}
            />
            <Field
              label={t("eventMarketing.admin.fields.labelEs")}
              name="label_es"
              form={fieldForm}
            />
            <div className="space-y-1.5">
              <Label>{t("eventMarketing.admin.fields.fieldType")}</Label>
              <Select
                value={fieldForm.values.field_type}
                onValueChange={(v) =>
                  fieldForm.setFieldValue("field_type", v as EventFormFieldType)
                }
                disabled={!!editingField?.is_system}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((ft) => (
                    <SelectItem key={ft} value={ft}>
                      {ft}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {fieldForm.values.field_type === "select" && (
              <TextAreaField
                label={t("eventMarketing.admin.fields.options")}
                name="options_text"
                form={fieldForm}
                rows={4}
              />
            )}
            <Field
              label={t("eventMarketing.admin.fields.sortOrder")}
              name="sort_order"
              form={fieldForm}
              type="number"
            />
            <SwitchRow
              label={t("eventMarketing.admin.fields.required")}
              checked={fieldForm.values.is_required}
              onChange={(v) => fieldForm.setFieldValue("is_required", v)}
            />
            <SwitchRow
              label={t("eventMarketing.admin.fields.active")}
              checked={fieldForm.values.is_active}
              onChange={(v) => fieldForm.setFieldValue("is_active", v)}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFieldDialog(false)}
              >
                {t("eventMarketing.admin.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                {t("eventMarketing.admin.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {doorQrFor && (
        <EventDoorQrDialog
          sessionId={doorQrFor.id}
          sessionTitle={langEs ? doorQrFor.title_es : doorQrFor.title_en}
          shortCode={doorQrFor.short_code}
          open={!!doorQrFor}
          onOpenChange={(o) => !o && setDoorQrFor(null)}
        />
      )}
      {importFor && (
        <EventImportDialog
          sessionId={importFor.id}
          sessionTitle={langEs ? importFor.title_es : importFor.title_en}
          open={!!importFor}
          onOpenChange={(o) => !o && setImportFor(null)}
        />
      )}
    </div>
  );
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {action}
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}

function Field({
  label,
  name,
  form,
  type = "text",
  disabled,
}: {
  label: string;
  name: string;
  form: { values: Record<string, unknown>; handleChange: (e: React.ChangeEvent<HTMLInputElement>) => void; errors: Record<string, unknown>; touched: Record<string, unknown> };
  type?: string;
  disabled?: boolean;
}) {
  const err =
    form.touched[name] && form.errors[name]
      ? String(form.errors[name])
      : null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        disabled={disabled}
        value={String(form.values[name] ?? "")}
        onChange={form.handleChange}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function TextAreaField({
  label,
  name,
  form,
  rows = 3,
}: {
  label: string;
  name: string;
  form: {
    values: Record<string, unknown>;
    handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    errors: Record<string, unknown>;
    touched: Record<string, unknown>;
  };
  rows?: number;
}) {
  const err =
    form.touched[name] && form.errors[name]
      ? String(form.errors[name])
      : null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Textarea
        id={name}
        name={name}
        rows={rows}
        value={String(form.values[name] ?? "")}
        onChange={form.handleChange}
      />
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

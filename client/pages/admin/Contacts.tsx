import { useCallback, useEffect, useMemo, useState } from "react";
import { useFormik } from "formik";
import { useTranslation } from "react-i18next";
import { BookUser, Filter, Plus, Search, X } from "lucide-react";
import AdminPageHeader from "@/components/AdminPageHeader";
import { ContactPanelSheet } from "@/components/admin/ContactPanelSheet";
import FieldHint from "@/components/admin/FieldHint";
import { DataGrid, type DataGridColumn } from "@/components/ui/data-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createAdminContact,
  deleteAdminContact,
  fetchAdminContacts,
} from "@/store/slices/contactsSlice";
import { useDebounce } from "@/hooks/use-debounce";
import { useToast } from "@/hooks/use-toast";
import type { AdminCrmContact } from "@shared/api";
import { useNavigate } from "react-router-dom";
import {
  buildCrmContactFormSchema,
  normalizeCrmContactPhone,
} from "@/lib/crmContactForm";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive mt-1">{message}</p>;
}

function RequiredMark() {
  const { t } = useTranslation();
  return (
    <span className="text-destructive" aria-hidden="true">
      {t("adminContacts.requiredMark")}
    </span>
  );
}

function OptionalMark() {
  const { t } = useTranslation();
  return (
    <span className="text-muted-foreground font-normal normal-case">
      ({t("common.optional")})
    </span>
  );
}

function ContactFormDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const mutating = useAppSelector((s) => s.contacts.mutating);
  const [confirmDup, setConfirmDup] = useState(false);
  const schema = useMemo(
    () => buildCrmContactFormSchema({ t: (key) => t(key) }),
    [t],
  );

  const form = useFormik({
    enableReinitialize: true,
    initialValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      preferred_language: "en" as "en" | "es",
      admin_notes: "",
    },
    validationSchema: schema,
    onSubmit: async (values) => {
      const normalizedPhone = normalizeCrmContactPhone(values.phone);
      const email = String(values.email || "")
        .trim()
        .toLowerCase();
      const result = await dispatch(
        createAdminContact({
          first_name: values.first_name.trim(),
          last_name: values.last_name.trim(),
          email: email || null,
          phone: normalizedPhone,
          preferred_language: values.preferred_language,
          admin_notes: values.admin_notes.trim() || null,
          confirm_duplicate: confirmDup || undefined,
        }),
      );
      if (createAdminContact.fulfilled.match(result)) {
        toast({ title: t("adminContacts.createSuccess") });
        setConfirmDup(false);
        form.resetForm();
        onSaved();
        onClose();
        return;
      }
      const payload = result.payload;
      if (
        typeof payload === "object" &&
        payload &&
        "error" in payload &&
        payload.error === "duplicate"
      ) {
        setConfirmDup(true);
        toast({
          title: t("adminContacts.duplicateWarnTitle"),
          description: t("adminContacts.duplicateWarnBody"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: t("adminContacts.createFailed"),
        description: typeof payload === "string" ? payload : undefined,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!open) {
      form.resetForm();
      setConfirmDup(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open change
  }, [open]);

  const showErr = (field: keyof typeof form.values) =>
    form.touched[field] && form.errors[field]
      ? String(form.errors[field])
      : undefined;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("adminContacts.addContact")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-contact-first">
                {t("adminContacts.firstName")} <RequiredMark />
              </Label>
              <Input
                id="add-contact-first"
                autoComplete="given-name"
                placeholder={t("adminContacts.firstNamePlaceholder")}
                {...form.getFieldProps("first_name")}
              />
              <FieldError message={showErr("first_name")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-contact-last">
                {t("adminContacts.lastName")} <RequiredMark />
              </Label>
              <Input
                id="add-contact-last"
                autoComplete="family-name"
                placeholder={t("adminContacts.lastNamePlaceholder")}
                {...form.getFieldProps("last_name")}
              />
              <FieldError message={showErr("last_name")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-contact-email">
              {t("adminContacts.email")} <OptionalMark />
            </Label>
            <Input
              id="add-contact-email"
              type="email"
              autoComplete="email"
              placeholder={t("adminContacts.emailPlaceholder")}
              {...form.getFieldProps("email")}
            />
            <FieldError message={showErr("email")} />
            <FieldHint>{t("adminContacts.emailHint")}</FieldHint>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-contact-phone">
              {t("adminContacts.phone")} <OptionalMark />
            </Label>
            <Input
              id="add-contact-phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder={t("adminContacts.phonePlaceholder")}
              {...form.getFieldProps("phone")}
            />
            <FieldError message={showErr("phone")} />
            <FieldHint>{t("adminContacts.phoneHint")}</FieldHint>
          </div>

          <FieldHint tone="accent">{t("adminContacts.emailOrPhoneHint")}</FieldHint>

          <div className="space-y-1.5">
            <Label>
              {t("adminContacts.language")} <RequiredMark />
            </Label>
            <Select
              value={form.values.preferred_language}
              onValueChange={(v) => form.setFieldValue("preferred_language", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Español</SelectItem>
              </SelectContent>
            </Select>
            <FieldError message={showErr("preferred_language")} />
            <FieldHint>{t("adminContacts.languageHint")}</FieldHint>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-contact-notes">
              {t("adminContacts.notes")} <OptionalMark />
            </Label>
            <Textarea
              id="add-contact-notes"
              rows={3}
              placeholder={t("adminContacts.notesPlaceholder")}
              {...form.getFieldProps("admin_notes")}
            />
            <FieldHint>{t("adminContacts.notesHint")}</FieldHint>
          </div>

          {confirmDup ? (
            <p className="text-xs text-destructive">
              {t("adminContacts.duplicateConfirmHint")}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("adminContacts.cancel")}
            </Button>
            <Button type="submit" disabled={mutating || form.isSubmitting}>
              {confirmDup
                ? t("adminContacts.saveAnyway")
                : t("adminContacts.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminContacts() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { contacts, contactsPagination, contactsLoading } = useAppSelector(
    (s) => s.contacts,
  );

  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    language: "all",
    has_notes: "all",
  });
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"ASC" | "DESC">("DESC");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelContactId, setPanelContactId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<{
    id: number;
    first_name: string;
    last_name: string;
  } | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");

  const debouncedSearch = useDebounce(search, 300);

  const loadContacts = useCallback(
    (targetPage: number) => {
      dispatch(
        fetchAdminContacts({
          search: debouncedSearch || undefined,
          language: filters.language === "all" ? undefined : filters.language,
          has_notes:
            filters.has_notes === "all" ? undefined : filters.has_notes,
          page: targetPage,
          limit: 50,
          sort_by: sortBy,
          sort_dir: sortDir,
        }),
      );
    },
    [dispatch, debouncedSearch, filters, sortBy, sortDir],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters, sortBy, sortDir]);

  useEffect(() => {
    loadContacts(page);
  }, [loadContacts, page]);

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortBy(key);
      setSortDir("ASC");
    }
  };

  const activeFilterCount = [
    filters.language !== "all",
    filters.has_notes !== "all",
  ].filter(Boolean).length;

  const columns: DataGridColumn<AdminCrmContact>[] = useMemo(
    () => [
      {
        key: "first_name",
        label: t("adminContacts.colName"),
        sortable: true,
        render: (c) => (
          <span className="font-medium">
            {c.first_name} {c.last_name}
          </span>
        ),
      },
      {
        key: "email",
        label: t("adminContacts.colEmail"),
        sortable: true,
        render: (c) => c.email || "—",
      },
      {
        key: "phone",
        label: t("adminContacts.colPhone"),
        sortable: true,
        render: (c) => c.phone || "—",
      },
      {
        key: "preferred_language",
        label: t("adminContacts.colLanguage"),
        sortable: true,
        render: (c) =>
          c.preferred_language === "es" ? "ES" : "EN",
      },
      {
        key: "created_at",
        label: t("adminContacts.colCreated"),
        sortable: true,
        render: (c) =>
          c.created_at
            ? new Date(c.created_at).toLocaleDateString()
            : "—",
      },
    ],
    [t],
  );

  const handleDelete = async () => {
    if (!deleting) return;
    const result = await dispatch(deleteAdminContact({ id: deleting.id }));
    if (deleteAdminContact.fulfilled.match(result)) {
      toast({ title: t("adminContacts.deleteSuccess") });
      setDeleting(null);
      setDeleteConfirmInput("");
      setPanelOpen(false);
      setPanelContactId(null);
      loadContacts(page);
    } else {
      toast({
        title: t("adminContacts.deleteFailed"),
        description:
          typeof result.payload === "string" ? result.payload : undefined,
        variant: "destructive",
      });
    }
  };

  const expectedDeleteName = deleting
    ? `${deleting.first_name} ${deleting.last_name}`
    : "";

  return (
    <div className="space-y-4">
      <AdminPageHeader
        icon={BookUser}
        title={t("adminContacts.title")}
        description={t("adminContacts.description")}
        actions={
          <Button className="gap-1.5" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" />
            {t("adminContacts.addContact")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("adminContacts.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setShowFilters((v) => !v)}
        >
          <Filter className="w-3.5 h-3.5" />
          {t("adminContacts.filters")}
          {activeFilterCount > 0 ? (
            <span className="ml-1 rounded-full bg-primary/15 text-primary text-[10px] font-bold px-1.5">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
      </div>

      {showFilters ? (
        <div className="rounded-xl border border-border bg-card p-4 grid sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>{t("adminContacts.language")}</Label>
            <Select
              value={filters.language}
              onValueChange={(v) => setFilters((f) => ({ ...f, language: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("adminContacts.filterAll")}</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Español</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("adminContacts.notes")}</Label>
            <Select
              value={filters.has_notes}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, has_notes: v }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("adminContacts.filterAll")}</SelectItem>
                <SelectItem value="yes">{t("adminContacts.filterHasNotes")}</SelectItem>
                <SelectItem value="no">{t("adminContacts.filterNoNotes")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {activeFilterCount > 0 ? (
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() =>
                  setFilters({ language: "all", has_notes: "all" })
                }
              >
                <X className="w-3.5 h-3.5" />
                {t("adminContacts.clearFilters")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="bg-card rounded-2xl border border-border px-6 py-4">
        <DataGrid
          data={contacts}
          columns={columns}
          rowKey={(c) => c.id}
          isLoading={contactsLoading}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          pagination={contactsPagination}
          onPageChange={setPage}
          onRowClick={(c) => {
            setPanelContactId(c.id);
            setPanelOpen(true);
          }}
          emptyMessage={t("adminContacts.empty")}
        />
      </div>

      <ContactFormDialog
        open={showForm}
        onClose={() => setShowForm(false)}
        onSaved={() => {
          setPage(1);
          loadContacts(1);
        }}
      />

      <ContactPanelSheet
        open={panelOpen}
        contactId={panelContactId}
        onClose={() => {
          setPanelOpen(false);
          setPanelContactId(null);
        }}
        onRequestDelete={(c) => setDeleting(c)}
        onConverted={(clientId) => {
          loadContacts(page);
          navigate(`/admin/pipeline?client=${clientId}`);
        }}
      />

      <AlertDialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) {
            setDeleting(null);
            setDeleteConfirmInput("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("adminContacts.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  {t("adminContacts.deleteBody", {
                    name: expectedDeleteName,
                  })}
                </p>
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive space-y-1">
                  <p className="font-semibold">
                    {t("adminContacts.deleteWarnTitle")}
                  </p>
                  <ul className="list-disc list-inside space-y-0.5 text-destructive/90">
                    <li>{t("adminContacts.deleteWarn1")}</li>
                    <li>{t("adminContacts.deleteWarn2")}</li>
                  </ul>
                </div>
                <div className="space-y-1.5">
                  <p className="text-muted-foreground">
                    {t("adminContacts.deleteTypePrompt")}{" "}
                    <strong className="text-foreground font-mono">
                      {expectedDeleteName}
                    </strong>
                  </p>
                  <input
                    type="text"
                    value={deleteConfirmInput}
                    onChange={(e) => setDeleteConfirmInput(e.target.value)}
                    placeholder={expectedDeleteName}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("adminContacts.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteConfirmInput.trim() !== expectedDeleteName}
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("adminContacts.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

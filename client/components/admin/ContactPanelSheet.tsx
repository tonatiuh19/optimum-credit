/**
 * Slim side panel for CRM contacts — identity, notes, call/text, convert, delete.
 */
import { useEffect, useMemo, useState } from "react";
import { useFormik } from "formik";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Mail,
  MapPin,
  NotebookPen,
  Phone,
  UserPlus,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContactPhoneActions } from "@/components/admin/ContactPhoneActions";
import FieldHint from "@/components/admin/FieldHint";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearPanelContact,
  convertAdminContact,
  fetchPanelContact,
  updateAdminContact,
} from "@/store/slices/contactsSlice";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
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

export type ContactPanelSheetProps = {
  open: boolean;
  contactId: number | null;
  onClose: () => void;
  onDeleted?: () => void;
  onConverted?: (clientId: number) => void;
  onRequestDelete?: (contact: {
    id: number;
    first_name: string;
    last_name: string;
  }) => void;
};

export function ContactPanelSheet({
  open,
  contactId,
  onClose,
  onConverted,
  onRequestDelete,
}: ContactPanelSheetProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { panelContact, panelLoading, mutating } = useAppSelector(
    (s) => s.contacts,
  );
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [confirmDup, setConfirmDup] = useState(false);
  const schema = useMemo(
    () => buildCrmContactFormSchema({ t: (key) => t(key) }),
    [t],
  );

  useEffect(() => {
    if (open && contactId != null && contactId > 0) {
      dispatch(fetchPanelContact({ id: contactId }));
    }
    if (!open) {
      dispatch(clearPanelContact());
      setConfirmConvert(false);
      setConfirmDup(false);
    }
  }, [open, contactId, dispatch]);

  const form = useFormik({
    enableReinitialize: true,
    initialValues: {
      first_name: panelContact?.first_name ?? "",
      last_name: panelContact?.last_name ?? "",
      email: panelContact?.email ?? "",
      phone: panelContact?.phone ?? "",
      preferred_language: (panelContact?.preferred_language ?? "en") as
        | "en"
        | "es",
      admin_notes: panelContact?.admin_notes ?? "",
      address_line1: panelContact?.address_line1 ?? "",
      address_line2: panelContact?.address_line2 ?? "",
      city: panelContact?.city ?? "",
      state: panelContact?.state ?? "",
      zip: panelContact?.zip ?? "",
    },
    validationSchema: schema,
    onSubmit: async (values) => {
      if (!panelContact) return;
      const normalizedPhone = normalizeCrmContactPhone(values.phone);
      const email = String(values.email || "")
        .trim()
        .toLowerCase();
      const result = await dispatch(
        updateAdminContact({
          id: panelContact.id,
          first_name: values.first_name.trim(),
          last_name: values.last_name.trim(),
          email: email || null,
          phone: normalizedPhone,
          preferred_language: values.preferred_language,
          admin_notes: values.admin_notes.trim() || null,
          address_line1: values.address_line1.trim() || null,
          address_line2: values.address_line2.trim() || null,
          city: values.city.trim() || null,
          state: values.state.trim() || null,
          zip: values.zip.trim() || null,
          confirm_duplicate: confirmDup || undefined,
        }),
      );
      if (updateAdminContact.fulfilled.match(result)) {
        setConfirmDup(false);
        toast({ title: t("adminContacts.saveSuccess") });
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
        title: t("adminContacts.saveFailed"),
        description: typeof payload === "string" ? payload : undefined,
        variant: "destructive",
      });
    },
  });

  const handleConvert = async () => {
    if (!panelContact) return;
    const result = await dispatch(
      convertAdminContact({
        id: panelContact.id,
        confirm_duplicate: confirmDup || undefined,
      }),
    );
    if (convertAdminContact.fulfilled.match(result)) {
      toast({ title: t("adminContacts.convertSuccess") });
      onConverted?.(result.payload.client_id);
      onClose();
      return;
    }
    const payload = result.payload;
    if (
      typeof payload === "object" &&
      payload &&
      "error" in payload &&
      (payload.error === "duplicate" || payload.error === "duplicate_phone")
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
      title: t("adminContacts.convertFailed"),
      description: typeof payload === "string" ? payload : undefined,
      variant: "destructive",
    });
  };

  const displayName = panelContact
    ? `${panelContact.first_name} ${panelContact.last_name}`.trim()
    : "";

  const showErr = (field: keyof typeof form.values) =>
    form.touched[field] && form.errors[field]
      ? String(form.errors[field])
      : undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg bg-background border-l border-border p-0 flex flex-col [&>button:first-of-type]:hidden"
      >
        <SheetTitle className="sr-only">{t("adminContacts.panelTitle")}</SheetTitle>
        {panelLoading || (!panelContact && open) ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : panelContact ? (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="px-5 pt-5 pb-4 bg-card border-b border-border shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold truncate">{displayName}</h2>
                  <p className="text-sm text-muted-foreground truncate">
                    {panelContact.email || t("adminHelpers.noEmailShort")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label={t("adminContacts.closePanel")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {panelContact.phone ? (
                <div className="mt-3">
                  <ContactPhoneActions
                    phone={panelContact.phone}
                    contactId={panelContact.id}
                    contactName={displayName}
                  />
                </div>
              ) : null}
            </div>

            <div className="mx-5 mt-4 rounded-xl border border-accent/30 bg-accent/10 p-3">
              <p className="text-sm font-semibold text-foreground">
                {t("adminContacts.convertBannerTitle")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("adminContacts.convertBannerBody")}
              </p>
              {!confirmConvert ? (
                <Button
                  type="button"
                  size="sm"
                  className="mt-2 gap-1.5"
                  onClick={() => setConfirmConvert(true)}
                  disabled={mutating || !!panelContact.converted_client_id}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {t("adminContacts.convertCta")}
                </Button>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleConvert}
                    disabled={mutating}
                  >
                    {mutating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      t("adminContacts.convertConfirm")
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirmConvert(false)}
                    disabled={mutating}
                  >
                    {t("adminContacts.cancel")}
                  </Button>
                </div>
              )}
            </div>

            <form
              onSubmit={form.handleSubmit}
              className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="contact-first">
                    {t("adminContacts.firstName")} <RequiredMark />
                  </Label>
                  <Input
                    id="contact-first"
                    autoComplete="given-name"
                    placeholder={t("adminContacts.firstNamePlaceholder")}
                    {...form.getFieldProps("first_name")}
                  />
                  <FieldError message={showErr("first_name")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contact-last">
                    {t("adminContacts.lastName")} <RequiredMark />
                  </Label>
                  <Input
                    id="contact-last"
                    autoComplete="family-name"
                    placeholder={t("adminContacts.lastNamePlaceholder")}
                    {...form.getFieldProps("last_name")}
                  />
                  <FieldError message={showErr("last_name")} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="contact-email"
                  className="flex items-center gap-1.5 flex-wrap"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {t("adminContacts.email")} <OptionalMark />
                </Label>
                <Input
                  id="contact-email"
                  type="email"
                  autoComplete="email"
                  placeholder={t("adminContacts.emailPlaceholder")}
                  {...form.getFieldProps("email")}
                />
                <FieldError message={showErr("email")} />
                <FieldHint>{t("adminContacts.emailHint")}</FieldHint>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="contact-phone"
                  className="flex items-center gap-1.5 flex-wrap"
                >
                  <Phone className="w-3.5 h-3.5" />
                  {t("adminContacts.phone")} <OptionalMark />
                </Label>
                <Input
                  id="contact-phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder={t("adminContacts.phonePlaceholder")}
                  {...form.getFieldProps("phone")}
                />
                <FieldError message={showErr("phone")} />
                <FieldHint>{t("adminContacts.phoneHint")}</FieldHint>
              </div>

              <FieldHint tone="accent">
                {t("adminContacts.emailOrPhoneHint")}
              </FieldHint>

              <div className="space-y-1.5">
                <Label>
                  {t("adminContacts.language")} <RequiredMark />
                </Label>
                <Select
                  value={form.values.preferred_language}
                  onValueChange={(v) =>
                    form.setFieldValue("preferred_language", v)
                  }
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
                <Label className="flex items-center gap-1.5 flex-wrap">
                  <MapPin className="w-3.5 h-3.5" />
                  {t("adminContacts.address")} <OptionalMark />
                </Label>
                <Input
                  placeholder={t("adminContacts.addressLine1")}
                  {...form.getFieldProps("address_line1")}
                />
                <Input
                  placeholder={t("adminContacts.addressLine2")}
                  {...form.getFieldProps("address_line2")}
                />
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    placeholder={t("adminContacts.city")}
                    {...form.getFieldProps("city")}
                  />
                  <Input
                    placeholder={t("adminContacts.state")}
                    {...form.getFieldProps("state")}
                  />
                  <Input
                    placeholder={t("adminContacts.zip")}
                    {...form.getFieldProps("zip")}
                  />
                </div>
                <FieldHint>{t("adminContacts.addressHint")}</FieldHint>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="contact-notes"
                  className="flex items-center gap-1.5 flex-wrap"
                >
                  <NotebookPen className="w-3.5 h-3.5" />
                  {t("adminContacts.notes")} <OptionalMark />
                </Label>
                <Textarea
                  id="contact-notes"
                  rows={4}
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

              <div className="flex flex-wrap gap-2 pt-2 pb-6">
                <Button type="submit" disabled={mutating || !form.dirty}>
                  {mutating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : confirmDup ? (
                    t("adminContacts.saveAnyway")
                  ) : (
                    t("adminContacts.save")
                  )}
                </Button>
                {onRequestDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className={cn("ml-auto")}
                    disabled={mutating}
                    onClick={() =>
                      onRequestDelete({
                        id: panelContact.id,
                        first_name: panelContact.first_name,
                        last_name: panelContact.last_name,
                      })
                    }
                  >
                    {t("adminContacts.delete")}
                  </Button>
                ) : null}
              </div>
            </form>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFormik } from "formik";
import * as Yup from "yup";
import {
  Check,
  Copy,
  Link2,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchPackages } from "@/store/slices/packagesSlice";
import {
  clearPrepaidMintState,
  createPrepaidOnboardInvite,
} from "@/store/slices/prepaidOnboardSlice";
import type {
  PrepaidOnboardPaymentMethod,
  PrepaidOnboardRemainingSplit,
} from "@shared/api";
import { toast } from "sonner";
import { logger } from "@/utils/logger";

const METHODS: PrepaidOnboardPaymentMethod[] = [
  "cash",
  "zelle",
  "venmo",
  "card_offline",
  "other",
];

type RemainingRow = PrepaidOnboardRemainingSplit & { key: string };

function dollarsToCents(raw: string): number {
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
      {children}
    </p>
  );
}

export default function PrepaidOnboardInviteModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { packages } = useAppSelector((s) => s.packages);
  const { minting, mintError, lastCreated } = useAppSelector(
    (s) => s.prepaidOnboard,
  );
  const [remaining, setRemaining] = useState<RemainingRow[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && packages.length === 0) dispatch(fetchPackages());
  }, [open, packages.length, dispatch]);

  useEffect(() => {
    if (!open) {
      dispatch(clearPrepaidMintState());
      setRemaining([]);
      setCopied(false);
    }
  }, [open, dispatch]);

  const validationSchema = useMemo(
    () =>
      Yup.object({
        package_id: Yup.number().required().min(1),
        paid_amount: Yup.string().required(
          t("prepaidOnboard.paidAmountRequired"),
        ),
        paid_label: Yup.string().required(),
        payment_method: Yup.string().required(),
        payment_note: Yup.string().max(500),
        preferred_language: Yup.string().nullable(),
        staff_notes: Yup.string().max(4000),
      }),
    [t],
  );

  const formik = useFormik({
    initialValues: {
      package_id: 0,
      paid_amount: "",
      paid_label: "Enrollment (prepaid)",
      payment_method: "zelle" as PrepaidOnboardPaymentMethod,
      payment_note: "",
      preferred_language: "" as "" | "en" | "es",
      staff_notes: "",
    },
    validationSchema,
    enableReinitialize: true,
    onSubmit: async (values) => {
      const paidCents = dollarsToCents(values.paid_amount);
      if (paidCents <= 0) {
        formik.setFieldError(
          "paid_amount",
          t("prepaidOnboard.paidAmountRequired"),
        );
        return;
      }
      for (const row of remaining) {
        if (!row.label.trim() || row.amount_cents <= 0 || !row.due_date) {
          toast.error(t("prepaidOnboard.remainingIncomplete"));
          return;
        }
      }
      try {
        await dispatch(
          createPrepaidOnboardInvite({
            package_id: Number(values.package_id),
            paid_amount_cents: paidCents,
            paid_label: values.paid_label.trim(),
            payment_method: values.payment_method,
            payment_note: values.payment_note.trim() || null,
            preferred_language: values.preferred_language || null,
            staff_notes: values.staff_notes.trim() || null,
            remaining_splits: remaining.map(({ label, amount_cents, due_date, send_payment_link }) => ({
              label,
              amount_cents,
              due_date,
              send_payment_link: !!send_payment_link,
            })),
            expires_in_hours: 168,
          }),
        ).unwrap();
      } catch (e) {
        logger.error("prepaidOnboard", "mint failed", e);
      }
    },
  });

  const handleCopy = async () => {
    const url = lastCreated?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("prepaidOnboard.linkCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("prepaidOnboard.copyFailed"));
    }
  };

  const activePackages = packages.filter((p: any) => p.is_active !== false);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent
        className="max-w-lg w-full bg-card border-border p-0 gap-0 overflow-hidden [&>button:last-child]:hidden"
        data-testid="prepaid-onboard-modal"
      >
        <DialogTitle className="px-6 pt-6 pb-4 text-base font-bold text-foreground border-b border-border">
          {t("prepaidOnboard.mintTitle")}
        </DialogTitle>

        {lastCreated?.url ? (
          <div className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("prepaidOnboard.mintSuccess")}
            </p>
            <div className="rounded-lg border border-border bg-muted/40 p-3 break-all text-xs font-mono text-foreground">
              {lastCreated.url}
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                {t("prepaidOnboard.done")}
              </Button>
              <Button type="button" onClick={handleCopy}>
                {copied ? (
                  <Check className="w-4 h-4 mr-1.5" />
                ) : (
                  <Copy className="w-4 h-4 mr-1.5" />
                )}
                {t("prepaidOnboard.copyLink")}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={formik.handleSubmit}>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              <p className="text-sm text-muted-foreground">
                {t("prepaidOnboard.mintHint")}
              </p>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("prepaidOnboard.package")}
                </label>
                <Select
                  value={
                    formik.values.package_id
                      ? String(formik.values.package_id)
                      : undefined
                  }
                  onValueChange={(v) =>
                    formik.setFieldValue("package_id", Number(v))
                  }
                >
                  <SelectTrigger data-testid="prepaid-package">
                    <SelectValue
                      placeholder={t("prepaidOnboard.packagePlaceholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {activePackages.map((p: any) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t("prepaidOnboard.paidAmount")}
                  </label>
                  <Input
                    name="paid_amount"
                    placeholder="499.00"
                    value={formik.values.paid_amount}
                    onChange={formik.handleChange}
                    data-testid="prepaid-paid-amount"
                  />
                  {formik.touched.paid_amount && formik.errors.paid_amount ? (
                    <p className="text-xs text-destructive">
                      {formik.errors.paid_amount}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t("prepaidOnboard.paymentMethod")}
                  </label>
                  <Select
                    value={formik.values.payment_method}
                    onValueChange={(v) =>
                      formik.setFieldValue(
                        "payment_method",
                        v as PrepaidOnboardPaymentMethod,
                      )
                    }
                  >
                    <SelectTrigger data-testid="prepaid-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {t(`prepaidOnboard.method.${m}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("prepaidOnboard.paidLabel")}
                </label>
                <Input
                  name="paid_label"
                  value={formik.values.paid_label}
                  onChange={formik.handleChange}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("prepaidOnboard.paymentNote")}
                </label>
                <Input
                  name="payment_note"
                  placeholder={t("prepaidOnboard.paymentNotePlaceholder")}
                  value={formik.values.payment_note}
                  onChange={formik.handleChange}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("prepaidOnboard.lockLanguage")}
                </label>
                <Select
                  value={formik.values.preferred_language || "client"}
                  onValueChange={(v) =>
                    formik.setFieldValue(
                      "preferred_language",
                      v === "client" ? "" : v,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client">
                      {t("prepaidOnboard.languageClientChoice")}
                    </SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
                <FieldHint>{t("prepaidOnboard.lockLanguageHint")}</FieldHint>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t("prepaidOnboard.remainingOptional")}
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                    onClick={() =>
                      setRemaining((rows) => [
                        ...rows,
                        {
                          key: `r-${Date.now()}`,
                          label: "",
                          amount_cents: 0,
                          due_date: "",
                          send_payment_link: false,
                        },
                      ])
                    }
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t("prepaidOnboard.addRemaining")}
                  </button>
                </div>
                <FieldHint>{t("prepaidOnboard.remainingHint")}</FieldHint>
                {remaining.map((row, idx) => (
                  <div
                    key={row.key}
                    className="rounded-lg border border-border p-3 space-y-2"
                  >
                    <div className="flex justify-between gap-2">
                      <Input
                        placeholder={t("prepaidOnboard.remainingLabel")}
                        value={row.label}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRemaining((rows) =>
                            rows.map((r, i) =>
                              i === idx ? { ...r, label: v } : r,
                            ),
                          );
                        }}
                      />
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setRemaining((rows) =>
                            rows.filter((_, i) => i !== idx),
                          )
                        }
                        aria-label={t("prepaidOnboard.removeRemaining")}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder="100.00"
                        onChange={(e) => {
                          const cents = dollarsToCents(e.target.value);
                          setRemaining((rows) =>
                            rows.map((r, i) =>
                              i === idx ? { ...r, amount_cents: cents } : r,
                            ),
                          );
                        }}
                      />
                      <Input
                        type="date"
                        value={row.due_date}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRemaining((rows) =>
                            rows.map((r, i) =>
                              i === idx ? { ...r, due_date: v } : r,
                            ),
                          );
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("prepaidOnboard.staffNotes")}
                </label>
                <Input
                  name="staff_notes"
                  value={formik.values.staff_notes}
                  onChange={formik.handleChange}
                />
              </div>

              {mintError ? (
                <p className="text-sm text-destructive">{mintError}</p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
              <Button type="button" variant="outline" onClick={onClose}>
                {t("prepaidOnboard.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={minting || !formik.values.package_id}
                data-testid="prepaid-mint-submit"
              >
                {minting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Link2 className="w-4 h-4 mr-2" />
                )}
                {t("prepaidOnboard.createLink")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

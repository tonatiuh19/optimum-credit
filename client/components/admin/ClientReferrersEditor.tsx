import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchReferrers,
  type ClientReferrerWriteItem,
} from "@/store/slices/adminSlice";
import type {
  AdminReferrer,
  ClientReferrerLink,
  ReferralCategory,
} from "@shared/api";
import { Checkbox } from "@/components/ui/checkbox";
import FieldHint from "@/components/admin/FieldHint";
import { Button } from "@/components/ui/button";

const MAX_SLOTS = 3;
const REFERRAL_CATEGORIES: ReferralCategory[] = [
  "realtor_broker",
  "one_off",
  "affiliate_partner",
];

export type ClientReferrerSlotDraft = {
  /** Pick an existing partner by id, or leave empty for inline create. */
  referrer_id: number | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  notify_on_round: boolean;
};

export function emptyReferrerSlot(): ClientReferrerSlotDraft {
  return {
    referrer_id: null,
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    notify_on_round: true,
  };
}

export function emptyReferrerSlots(
  count = 1,
): ClientReferrerSlotDraft[] {
  return Array.from({ length: Math.min(count, MAX_SLOTS) }, () =>
    emptyReferrerSlot(),
  );
}

export function linksToReferrerSlots(
  links: ClientReferrerLink[],
): ClientReferrerSlotDraft[] {
  if (!links.length) return emptyReferrerSlots(1);
  return links.slice(0, MAX_SLOTS).map((link) => ({
    referrer_id: link.referrer_id,
    first_name: link.referrer?.first_name ?? "",
    last_name: link.referrer?.last_name ?? "",
    email: link.referrer?.email ?? "",
    phone: link.referrer?.phone ?? "",
    notify_on_round: link.notify_on_round !== false,
  }));
}

function slotHasContent(slot: ClientReferrerSlotDraft): boolean {
  if (slot.referrer_id) return true;
  return Boolean(
    slot.first_name.trim() ||
      slot.last_name.trim() ||
      slot.email.trim() ||
      slot.phone.trim(),
  );
}

/** Build API `referrers[]` from editor slots (skips empty). */
export function referrerSlotsToApiPayload(
  slots: ClientReferrerSlotDraft[],
  category: ReferralCategory | "" | null,
): ClientReferrerWriteItem[] {
  return slots.filter(slotHasContent).map((slot) => {
    if (slot.referrer_id) {
      return {
        referrer_id: slot.referrer_id,
        notify_on_round: slot.notify_on_round,
      };
    }
    return {
      category: category || undefined,
      first_name: slot.first_name.trim(),
      last_name: slot.last_name.trim(),
      email: slot.email.trim() || null,
      phone: slot.phone.trim() || null,
      notify_on_round: slot.notify_on_round,
    };
  });
}

function categoryLabel(
  t: (key: string) => string,
  cat: ReferralCategory,
): string {
  if (cat === "realtor_broker") return t("adminHelpers.referralCategoryRealtor");
  if (cat === "one_off") return t("adminHelpers.referralCategoryOneOff");
  return t("adminHelpers.referralCategoryAffiliate");
}

function PartnerSlot({
  index,
  slot,
  referrers,
  category,
  disabled,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  slot: ClientReferrerSlotDraft;
  referrers: AdminReferrer[];
  category: ReferralCategory | "";
  disabled?: boolean;
  onChange: (next: ClientReferrerSlotDraft) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { t } = useTranslation();
  const isCreate = !slot.referrer_id;
  const filtered = useMemo(() => {
    if (!category) return referrers;
    return referrers.filter((r) => r.category === category);
  }, [referrers, category]);

  return (
    <div
      className="rounded-xl border border-border bg-muted/30 p-3 space-y-3"
      data-testid={`referrer-slot-${index}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("adminHelpers.partnerSlotLabel", { n: index + 1 })}
        </span>
        {canRemove && (
          <button
            type="button"
            disabled={disabled}
            onClick={onRemove}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
            aria-label={t("adminHelpers.partnerRemove")}
          >
            <Trash2 className="w-3 h-3" />
            {t("adminHelpers.partnerRemove")}
          </button>
        )}
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">
          {t("adminHelpers.partnerPickExisting")}
        </label>
        <select
          value={slot.referrer_id ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            if (!id) {
              onChange({ ...emptyReferrerSlot(), notify_on_round: slot.notify_on_round });
              return;
            }
            const found = referrers.find((r) => r.id === id);
            onChange({
              referrer_id: id,
              first_name: found?.first_name ?? "",
              last_name: found?.last_name ?? "",
              email: found?.email ?? "",
              phone: found?.phone ?? "",
              notify_on_round: slot.notify_on_round,
            });
          }}
          className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        >
          <option value="">{t("adminHelpers.partnerCreateNew")}</option>
          {filtered.map((r) => (
            <option key={r.id} value={r.id}>
              {r.first_name} {r.last_name}
              {r.company ? ` · ${r.company}` : ""}
              {r.email ? ` · ${r.email}` : ""}
            </option>
          ))}
        </select>
      </div>

      {isCreate && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              {t("adminHelpers.partnerFirstName")}
            </label>
            <input
              value={slot.first_name}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...slot, first_name: e.target.value })
              }
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              {t("adminHelpers.partnerLastName")}
            </label>
            <input
              value={slot.last_name}
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...slot, last_name: e.target.value })
              }
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              {t("adminHelpers.partnerEmail")}
            </label>
            <input
              type="email"
              value={slot.email}
              disabled={disabled}
              onChange={(e) => onChange({ ...slot, email: e.target.value })}
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              {t("adminHelpers.partnerPhone")}
            </label>
            <input
              type="tel"
              value={slot.phone}
              disabled={disabled}
              onChange={(e) => onChange({ ...slot, phone: e.target.value })}
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            />
          </div>
        </div>
      )}

      {!isCreate && (slot.email || slot.phone) && (
        <p className="text-[11px] text-muted-foreground">
          {[slot.email, slot.phone].filter(Boolean).join(" · ")}
        </p>
      )}

      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
        <Checkbox
          checked={slot.notify_on_round}
          disabled={disabled}
          onCheckedChange={(v) =>
            onChange({ ...slot, notify_on_round: v === true })
          }
        />
        {t("adminHelpers.partnerNotifyOnRound")}
      </label>
    </div>
  );
}

export interface ClientReferrersEditorProps {
  value: ClientReferrerSlotDraft[];
  onChange: (next: ClientReferrerSlotDraft[]) => void;
  referralCategory: ReferralCategory | "" | null;
  onCategoryChange: (next: ReferralCategory | "") => void;
  disabled?: boolean;
}

export default function ClientReferrersEditor({
  value,
  onChange,
  referralCategory,
  onCategoryChange,
  disabled,
}: ClientReferrersEditorProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { referrers, referrersLoading } = useAppSelector((s) => s.admin);
  const category = (referralCategory ?? "") as ReferralCategory | "";
  const isReferred = Boolean(category);

  useEffect(() => {
    dispatch(
      fetchReferrers(category ? { category } : undefined),
    );
  }, [dispatch, category]);

  const slots =
    value.length > 0 ? value.slice(0, MAX_SLOTS) : emptyReferrerSlots(1);

  const setSlot = (i: number, next: ClientReferrerSlotDraft) => {
    const copy = [...slots];
    copy[i] = next;
    onChange(copy);
  };

  const removeSlot = (i: number) => {
    const copy = slots.filter((_, idx) => idx !== i);
    onChange(copy.length ? copy : emptyReferrerSlots(1));
  };

  const addSlot = () => {
    if (slots.length >= MAX_SLOTS) return;
    onChange([...slots, emptyReferrerSlot()]);
  };

  return (
    <div className="space-y-3" data-testid="client-referrers-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("adminHelpers.referralSectionTitle")}
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
          <Checkbox
            checked={isReferred}
            disabled={disabled}
            onCheckedChange={(v) => {
              if (v === true) {
                onCategoryChange(
                  category || "realtor_broker",
                );
                if (!value.length) onChange(emptyReferrerSlots(1));
              } else {
                onCategoryChange("");
                onChange(emptyReferrerSlots(1));
              }
            }}
          />
          {t("adminHelpers.referredToggle")}
        </label>
      </div>

      {isReferred && (
        <>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              {t("adminHelpers.referralCategoryLabel")}
            </label>
            <select
              value={category}
              disabled={disabled}
              onChange={(e) => {
                const next = e.target.value as ReferralCategory | "";
                onCategoryChange(next);
                // Clear picked existing partners when category changes (may not match).
                onChange(
                  slots.map((s) =>
                    s.referrer_id
                      ? { ...emptyReferrerSlot(), notify_on_round: s.notify_on_round }
                      : s,
                  ),
                );
              }}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            >
              {REFERRAL_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {categoryLabel(t, cat)}
                </option>
              ))}
            </select>
            <FieldHint>{t("adminHelpers.partnerRequiredHint")}</FieldHint>
          </div>

          <div className="space-y-2">
            {slots.map((slot, i) => (
              <PartnerSlot
                key={i}
                index={i}
                slot={slot}
                referrers={referrers}
                category={category}
                disabled={disabled || referrersLoading}
                onChange={(next) => setSlot(i, next)}
                onRemove={() => removeSlot(i)}
                canRemove={slots.length > 1}
              />
            ))}
          </div>

          {slots.length < MAX_SLOTS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={addSlot}
              className="h-8 text-xs gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("adminHelpers.partnerAddSlot")}
            </Button>
          )}

          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <UserPlus className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {t("adminHelpers.partnerMaxHint")}
          </p>
        </>
      )}

      {!isReferred && (
        <FieldHint>{t("adminHelpers.referralCategoryNone")}</FieldHint>
      )}
    </div>
  );
}

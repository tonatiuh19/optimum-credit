import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Plus, Users, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { ClientReferrerLink } from "@shared/api";
import {
  parseComposePhoneInput,
  type ConversationComposeTarget,
} from "@/components/admin/ConversationComposeTargetPicker";
import {
  phoneDedupeKey,
  type AlsoRecipient,
} from "@/lib/conversationAlsoSend";
import { cn } from "@/lib/utils";

export type ComposeAlsoRecipient = AlsoRecipient;

interface Props {
  composeTarget: ConversationComposeTarget;
  referrers: ClientReferrerLink[];
  referrersLoading?: boolean;
  selected: ComposeAlsoRecipient[];
  onChange: (next: ComposeAlsoRecipient[]) => void;
  disabled?: boolean;
  /** Thread composer should stay collapsed so the timeline stays readable. */
  defaultExpanded?: boolean;
}

export function ConversationComposeAlsoSend({
  composeTarget,
  referrers,
  referrersLoading,
  selected,
  onChange,
  disabled,
  defaultExpanded = false,
}: Props) {
  const { t } = useTranslation();
  const [extraPhone, setExtraPhone] = useState("");
  const [expanded, setExpanded] = useState(defaultExpanded);

  const primaryPhone =
    composeTarget.kind === "client"
      ? composeTarget.client.phone
      : composeTarget.kind === "contact"
        ? composeTarget.contact.phone
        : composeTarget.phone;

  const referrerOptions = useMemo(() => {
    const primaryKey = primaryPhone ? phoneDedupeKey(primaryPhone) : "";
    return referrers
      .filter((link) => link.referrer?.phone)
      .map((link) => {
        const ref = link.referrer!;
        const phone = String(ref.phone || "").trim();
        const label = `${ref.first_name || ""} ${ref.last_name || ""}`.trim();
        return {
          key: `ref-${link.referrer_id}`,
          phone,
          label: label || t("conversations.composeAlsoReferrer"),
          role: link.role,
        };
      })
      .filter((r) => {
        if (!r.phone) return false;
        if (!primaryKey) return true;
        return phoneDedupeKey(r.phone) !== primaryKey;
      });
  }, [referrers, primaryPhone, t]);

  const selectedKeys = new Set(selected.map((s) => s.key));

  const toggleReferrer = (opt: {
    key: string;
    phone: string;
    label: string;
  }) => {
    if (selectedKeys.has(opt.key)) {
      onChange(selected.filter((s) => s.key !== opt.key));
      return;
    }
    onChange([
      ...selected,
      { key: opt.key, phone: opt.phone, label: opt.label },
    ]);
  };

  const addExtraPhone = () => {
    const parsed = parseComposePhoneInput(extraPhone);
    if (!parsed) return;
    const key = `phone-${phoneDedupeKey(parsed.phone)}`;
    if (selectedKeys.has(key)) {
      setExtraPhone("");
      return;
    }
    if (
      primaryPhone &&
      phoneDedupeKey(parsed.phone) === phoneDedupeKey(primaryPhone)
    ) {
      setExtraPhone("");
      return;
    }
    onChange([
      ...selected,
      { key, phone: parsed.phone, label: parsed.label },
    ]);
    setExtraPhone("");
  };

  const removeRecipient = (key: string) => {
    onChange(selected.filter((s) => s.key !== key));
  };

  if (composeTarget.kind !== "client") return null;

  const summaryLabel =
    selected.length === 0
      ? t("conversations.composeAlsoCollapsedEmpty")
      : selected.length === 1
        ? t("conversations.composeAlsoCollapsedOne", {
            name: selected[0].label,
          })
        : t("conversations.composeAlsoCollapsedMany", {
            count: selected.length,
          });

  return (
    <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left",
          "hover:bg-muted/40 transition-colors",
        )}
        aria-expanded={expanded}
        data-testid="compose-also-toggle"
      >
        <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
          {t("conversations.composeAlsoTitle")}
        </span>
        {selected.length > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
            {selected.length}
          </span>
        )}
        <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
          {summaryLabel}
        </span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {!expanded && selected.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {selected.map((r) => (
            <span
              key={r.key}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-primary/20 bg-primary/5 text-primary"
            >
              <span className="truncate max-w-[120px]">{r.label}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRecipient(r.key);
                  }}
                  className="hover:text-foreground"
                  aria-label={t("conversations.composeAlsoRemove", {
                    name: r.label,
                  })}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-border/60 pt-2.5">
          <p className="text-[11px] text-muted-foreground leading-snug">
            {t("conversations.composeAlsoHint")}
          </p>

          {referrersLoading ? (
            <p className="text-xs text-muted-foreground">
              {t("conversations.composeAlsoLoading")}
            </p>
          ) : referrerOptions.length > 0 ? (
            <div className="space-y-2 max-h-28 overflow-y-auto overscroll-contain">
              {referrerOptions.map((opt) => (
                <label
                  key={opt.key}
                  className="flex items-start gap-2.5 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={selectedKeys.has(opt.key)}
                    disabled={disabled}
                    onCheckedChange={() => toggleReferrer(opt)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-foreground block truncate">
                      {opt.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {opt.phone}
                      {opt.role
                        ? ` · ${t(`conversations.referrerRoles.${opt.role}`, {
                            defaultValue: opt.role,
                          })}`
                        : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("conversations.composeAlsoNoReferrers")}
            </p>
          )}

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((r) => (
                <span
                  key={r.key}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-primary/20 bg-primary/5 text-primary"
                >
                  <span className="truncate max-w-[140px]">{r.label}</span>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => removeRecipient(r.key)}
                      className="hover:text-foreground"
                      aria-label={t("conversations.composeAlsoRemove", {
                        name: r.label,
                      })}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              value={extraPhone}
              onChange={(e) => setExtraPhone(e.target.value)}
              placeholder={t("conversations.composeAlsoPhonePlaceholder")}
              disabled={disabled}
              className="h-9 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addExtraPhone();
                }
              }}
            />
            <button
              type="button"
              onClick={addExtraPhone}
              disabled={disabled || !parseComposePhoneInput(extraPhone)}
              className="h-9 px-2.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50 shrink-0 inline-flex items-center gap-1 text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("conversations.composeAlsoAdd")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

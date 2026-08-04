import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Car,
  ChevronDown,
  CreditCard,
  Home,
  KeyRound,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Preset client goals — value stored is the localized label at pick time. */
export const CLIENT_GOAL_PRESET_IDS = [
  "conventional_mortgage",
  "fha_loan",
  "business_funding",
  "auto_financing",
  "jumbo_loan",
  "general_improvement",
] as const;

export type ClientGoalPresetId = (typeof CLIENT_GOAL_PRESET_IDS)[number];

const PRESET_ICONS: Record<ClientGoalPresetId, LucideIcon> = {
  conventional_mortgage: Home,
  fha_loan: KeyRound,
  business_funding: CreditCard,
  auto_financing: Car,
  jumbo_loan: Building2,
  general_improvement: TrendingUp,
};

interface ClientGoalComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
}

/**
 * Combobox: pick a preset goal or type a custom one freely.
 * Matches marketing credit-analysis UX (presets + free entrance).
 */
export default function ClientGoalCombobox({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  id,
  name,
  disabled,
}: ClientGoalComboboxProps) {
  const { t } = useTranslation();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const presets = CLIENT_GOAL_PRESET_IDS.map((presetId) => ({
    id: presetId,
    label: t(`creditAnalysis.goals.${presetId}`),
    Icon: PRESET_ICONS[presetId],
  }));

  const filtered = value.trim()
    ? presets.filter((p) =>
        p.label.toLowerCase().includes(value.trim().toLowerCase()),
      )
    : presets;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative">
        <input
          id={id}
          name={name}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          className="w-full h-11 px-3.5 pr-10 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") setOpen(true);
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={t("creditAnalysis.goalToggle")}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            className={cn(
              "w-4 h-4 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1.5 w-full max-h-64 overflow-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-lg py-1.5 animate-in fade-in-0 zoom-in-95"
        >
          {filtered.length === 0 ? (
            <li className="px-3.5 py-2.5 text-sm text-muted-foreground">
              {t("creditAnalysis.goalCustomHint", { goal: value.trim() })}
            </li>
          ) : (
            filtered.map(({ id: presetId, label, Icon }) => (
              <li key={presetId} role="option">
                <button
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors",
                    "hover:bg-primary/10 hover:text-foreground",
                    value === label && "bg-primary/10 text-foreground font-medium",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(label);
                    setOpen(false);
                  }}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span>{label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

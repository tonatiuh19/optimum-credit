/**
 * Unified recipient picker for Conversations "New message":
 * search existing clients OR enter a new phone number in one field.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Phone, Search, User, X } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { searchClients } from "@/store/slices/adminSlice";
import { searchAdminContacts } from "@/store/slices/contactsSlice";
import { useDebounce } from "@/hooks/use-debounce";
import { isProspectLead } from "@/lib/pipelineFilters";
import { parseComposePhoneInput } from "@/lib/parseComposePhone";
import type { AdminClientListItem, AdminCrmContact } from "@shared/api";

export { parseComposePhoneInput } from "@/lib/parseComposePhone";

export type ConversationComposeTarget =
  | { kind: "client"; client: AdminClientListItem }
  | { kind: "contact"; contact: AdminCrmContact }
  | { kind: "phone"; phone: string; label: string };

interface Props {
  value: ConversationComposeTarget | null;
  onChange: (target: ConversationComposeTarget | null) => void;
  disabled?: boolean;
}

function Initials({ first, last }: { first: string; last: string }) {
  return (
    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 select-none">
      {(first[0] ?? "").toUpperCase()}
      {(last[0] ?? "").toUpperCase()}
    </div>
  );
}

function looksLikePhoneQuery(q: string): boolean {
  const digits = q.replace(/\D/g, "");
  if (digits.length < 7) return false;
  const nonDigit = q.replace(/[\d\s().+\-]/g, "");
  return nonDigit.length <= 2;
}

export function ConversationComposeTargetPicker({
  value,
  onChange,
  disabled = false,
}: Props) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { clientSearchResults, clientSearchLoading } = useAppSelector(
    (s) => s.admin,
  );
  const { contactSearchResults, contactSearchLoading } = useAppSelector(
    (s) => s.contacts,
  );

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const debouncedQuery = useDebounce(query, 280);

  useEffect(() => {
    if (debouncedQuery.trim().length >= 1) {
      dispatch(searchClients(debouncedQuery.trim()));
      dispatch(searchAdminContacts(debouncedQuery.trim()));
    }
  }, [debouncedQuery, dispatch]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setActiveIdx(-1);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const phoneOption = useMemo(() => {
    if (!looksLikePhoneQuery(query)) return null;
    return parseComposePhoneInput(query);
  }, [query]);

  const clientRows = clientSearchResults;
  const contactRows = contactSearchResults;
  const searching = clientSearchLoading || contactSearchLoading;

  type Row =
    | { type: "phone"; phone: string; label: string }
    | { type: "client"; client: AdminClientListItem }
    | { type: "contact"; contact: AdminCrmContact };

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (phoneOption) {
      out.push({
        type: "phone",
        phone: phoneOption.phone,
        label: phoneOption.label,
      });
    }
    for (const c of contactRows) {
      out.push({ type: "contact", contact: c });
    }
    for (const c of clientRows) {
      out.push({ type: "client", client: c });
    }
    return out;
  }, [phoneOption, clientRows, contactRows]);

  const selectRow = useCallback(
    (row: Row) => {
      if (row.type === "phone") {
        onChange({ kind: "phone", phone: row.phone, label: row.label });
      } else if (row.type === "contact") {
        onChange({ kind: "contact", contact: row.contact });
      } else {
        onChange({ kind: "client", client: row.client });
      }
      setQuery("");
      setOpen(false);
      setActiveIdx(-1);
    },
    [onChange],
  );

  const clearSelection = useCallback(() => {
    onChange(null);
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && e.key !== "Enter") return;
    const count = rows.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, count - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && rows[activeIdx]) {
        selectRow(rows[activeIdx]);
        return;
      }
      if (phoneOption && rows[0]?.type === "phone") {
        selectRow(rows[0]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const item = listRef.current.children[activeIdx] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  const showDropdown = open && query.trim().length >= 1;

  if (value) {
    return (
      <div className="flex items-center gap-2 h-10 px-3 rounded-xl border border-input bg-background">
        {value.kind === "client" ? (
          <>
            <Initials
              first={value.client.first_name}
              last={value.client.last_name}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {value.client.first_name} {value.client.last_name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {value.client.phone || value.client.email}
              </p>
            </div>
            {isProspectLead(value.client) && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-accent/30 text-accent bg-accent/10 shrink-0">
                {t("conversations.prospectBadge")}
              </span>
            )}
          </>
        ) : value.kind === "contact" ? (
          <>
            <Initials
              first={value.contact.first_name}
              last={value.contact.last_name}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {value.contact.first_name} {value.contact.last_name}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {value.contact.phone || value.contact.email}
              </p>
            </div>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-primary/30 text-primary bg-primary/10 shrink-0">
              {t("conversations.contactBadge")}
            </span>
          </>
        ) : (
          <>
            <div className="w-7 h-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0">
              <Phone className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {value.label}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {t("conversations.composeNewNumberHint")}
              </p>
            </div>
          </>
        )}
        {!disabled && (
          <button
            type="button"
            onClick={clearSelection}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label={t("conversations.clearRecipient")}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex items-center gap-2 h-10 px-3 rounded-xl border bg-background transition-colors ${
          open
            ? "border-primary ring-2 ring-primary/20"
            : "border-input hover:border-input/80"
        } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      >
        {clientSearchLoading || contactSearchLoading ? (
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
        ) : (
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          value={query}
          disabled={disabled}
          placeholder={t("conversations.composeUnifiedPlaceholder")}
          className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => {
            if (query.trim().length >= 1) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-xl shadow-lg overflow-hidden">
          {rows.length === 0 && !searching ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <User className="w-4 h-4 shrink-0" />
              {t("conversations.composeNoMatch")}
            </div>
          ) : (
            <ul ref={listRef} className="max-h-56 overflow-y-auto py-1">
              {rows.map((row, i) => {
                if (row.type === "phone") {
                  return (
                    <li key={`phone-${row.phone}`}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectRow(row);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                          i === activeIdx
                            ? "bg-primary text-white"
                            : "hover:bg-muted"
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                            i === activeIdx
                              ? "bg-white/20 text-white"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm font-medium truncate ${
                              i === activeIdx ? "text-white" : "text-foreground"
                            }`}
                          >
                            {t("conversations.composeMessagePhone", {
                              phone: row.label,
                            })}
                          </p>
                          <p
                            className={`text-xs truncate ${
                              i === activeIdx
                                ? "text-white/70"
                                : "text-muted-foreground"
                            }`}
                          >
                            {t("conversations.composeNewNumberHint")}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                }
                if (row.type === "contact") {
                  const c = row.contact;
                  return (
                    <li key={`contact-${c.id}`}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectRow(row);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                          i === activeIdx
                            ? "bg-primary text-white"
                            : "hover:bg-muted"
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                            i === activeIdx
                              ? "bg-white/20 text-white"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          {(c.first_name[0] ?? "").toUpperCase()}
                          {(c.last_name[0] ?? "").toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm font-medium truncate ${
                              i === activeIdx ? "text-white" : "text-foreground"
                            }`}
                          >
                            {c.first_name} {c.last_name}
                          </p>
                          <p
                            className={`text-xs truncate ${
                              i === activeIdx
                                ? "text-white/70"
                                : "text-muted-foreground"
                            }`}
                          >
                            {c.phone || c.email}
                          </p>
                        </div>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                            i === activeIdx
                              ? "bg-white/20 text-white"
                              : "border border-primary/30 text-primary bg-primary/10"
                          }`}
                        >
                          {t("conversations.contactBadge")}
                        </span>
                      </button>
                    </li>
                  );
                }
                const c = row.client;
                return (
                  <li key={`client-${c.id}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectRow(row);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        i === activeIdx
                          ? "bg-primary text-white"
                          : "hover:bg-muted"
                      }`}
                    >
                      <div
                        className={`w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                          i === activeIdx
                            ? "bg-white/20 text-white"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {(c.first_name[0] ?? "").toUpperCase()}
                        {(c.last_name[0] ?? "").toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            i === activeIdx ? "text-white" : "text-foreground"
                          }`}
                        >
                          {c.first_name} {c.last_name}
                        </p>
                        <p
                          className={`text-xs truncate ${
                            i === activeIdx
                              ? "text-white/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          {c.phone || c.email}
                        </p>
                      </div>
                      {c.status && (
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${
                            i === activeIdx
                              ? "border-white/30 text-white/80 bg-white/10"
                              : "border-border text-muted-foreground bg-muted"
                          }`}
                        >
                          {c.status.replace(/_/g, " ")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

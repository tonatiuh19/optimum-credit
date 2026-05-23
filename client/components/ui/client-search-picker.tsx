/**
 * ClientSearchPicker — server-side search combobox for selecting a client.
 * Scales to 10k+ clients by querying on-demand (debounced, limit 10).
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Search, X, Loader2, User } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { searchClients } from "@/store/slices/adminSlice";
import { useDebounce } from "@/hooks/use-debounce";
import type { AdminClientListItem } from "@shared/api";

interface ClientSearchPickerProps {
  value: AdminClientListItem | null;
  onChange: (client: AdminClientListItem | null) => void;
  placeholder?: string;
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

export function ClientSearchPicker({
  value,
  onChange,
  placeholder = "Search by name or email…",
  disabled = false,
}: ClientSearchPickerProps) {
  const dispatch = useAppDispatch();
  const { clientSearchResults, clientSearchLoading } = useAppSelector(
    (s) => s.admin,
  );

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const debouncedQuery = useDebounce(query, 280);

  // Fetch whenever debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim().length >= 1) {
      dispatch(searchClients(debouncedQuery.trim()));
    }
  }, [debouncedQuery, dispatch]);

  // Close on outside click
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

  const selectClient = useCallback(
    (client: AdminClientListItem) => {
      onChange(client);
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
    if (!open) return;
    const count = clientSearchResults.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, count - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && clientSearchResults[activeIdx]) {
        selectClient(clientSearchResults[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const item = listRef.current.children[activeIdx] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  const showDropdown = open && query.trim().length >= 1;

  // ── Selected state ─────────────────────────────────────────────────────────
  if (value) {
    return (
      <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-input bg-background">
        <Initials first={value.first_name} last={value.last_name} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {value.first_name} {value.last_name}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {value.email}
          </p>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={clearSelection}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  // ── Search input + dropdown ────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative">
      <div
        className={`flex items-center gap-2 h-10 px-3 rounded-lg border bg-background transition-colors ${
          open
            ? "border-primary ring-2 ring-primary/20"
            : "border-input hover:border-input/80"
        } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      >
        {clientSearchLoading ? (
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
        ) : (
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
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
          {clientSearchResults.length === 0 && !clientSearchLoading ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <User className="w-4 h-4" />
              No clients found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <ul ref={listRef} className="max-h-56 overflow-y-auto py-1">
              {clientSearchResults.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault(); // prevent input blur before click
                      selectClient(c);
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
                        {c.email}
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
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

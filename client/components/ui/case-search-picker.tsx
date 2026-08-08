/**
 * CaseSearchPicker — server-side search for linking a Work Hub task to a case.
 */
import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2, Briefcase } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { searchWorkTaskCases } from "@/store/slices/workTasksSlice";
import { useDebounce } from "@/hooks/use-debounce";
import type { WorkTaskCaseOption } from "@shared/api";
import { useTranslation } from "react-i18next";

interface CaseSearchPickerProps {
  value: WorkTaskCaseOption | null;
  onChange: (caseOpt: WorkTaskCaseOption | null) => void;
  disabled?: boolean;
}

export function CaseSearchPicker({
  value,
  onChange,
  disabled = false,
}: CaseSearchPickerProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { caseSearchResults, caseSearchLoading } = useAppSelector(
    (s) => s.workTasks,
  );

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 280);

  useEffect(() => {
    if (debouncedQuery.trim().length >= 1) {
      dispatch(searchWorkTaskCases(debouncedQuery.trim()));
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

  const results = caseSearchResults;

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
        <Briefcase className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">
            {value.case_number ??
              t("myTasks.linkedCaseFallback") + ` #${value.case_id}`}
            {value.case_status && value.case_status !== "active" && (
              <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`myTasks.caseStatus.${value.case_status}`, {
                  defaultValue: value.case_status,
                })}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {value.client_first_name} {value.client_last_name}
            {value.client_email ? ` · ${value.client_email}` : ""}
          </p>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            aria-label={t("myTasks.form.clearCase")}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={query}
          placeholder={t("myTasks.form.linkCasePlaceholder")}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && activeIdx >= 0) {
              e.preventDefault();
              onChange(results[activeIdx]);
              setQuery("");
              setOpen(false);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="w-full h-10 pl-9 pr-9 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {caseSearchLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && query.trim().length >= 1 && (
        <ul className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-xl border border-border bg-card shadow-lg py-1">
          {results.length === 0 && !caseSearchLoading ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {t("myTasks.form.noCasesFound")}
            </li>
          ) : (
            results.map((c, idx) => (
              <li key={c.case_id}>
                <button
                  type="button"
                  className={[
                    "w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-muted/60",
                    idx === activeIdx ? "bg-muted/60" : "",
                  ].join(" ")}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => {
                    onChange(c);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <Briefcase className="w-3.5 h-3.5 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {c.case_number ??
                        t("myTasks.linkedCaseFallback") + ` #${c.case_id}`}
                      {c.case_status && c.case_status !== "active" && (
                        <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {t(`myTasks.caseStatus.${c.case_status}`, {
                            defaultValue: c.case_status,
                          })}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.client_first_name} {c.client_last_name}
                    </p>
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

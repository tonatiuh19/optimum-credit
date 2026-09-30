/**
 * Admin Calendar page — /admin/calendar
 * Month-view: payment installments + planned round-completion targets + work tasks.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  AlertCircle,
  Ban,
  Target,
  CheckSquare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminCalendar } from "@/store/slices/adminSlice";
import type {
  CalendarRoundEvent,
  CalendarSplit,
  CalendarWorkTaskEvent,
  PaymentSplitStatus,
} from "@shared/api";
import AdminPageHeader from "@/components/AdminPageHeader";
import AdminSplitActions from "@/components/admin/AdminSplitActions";
import {
  calendarPipelineHref,
  calendarTaskHref,
} from "@/lib/adminCalendarNav";

function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

const STATUS_STYLE: Record<PaymentSplitStatus, { badge: string }> = {
  pending: {
    badge: "bg-secondary text-secondary-foreground border-border",
  },
  paid: {
    badge: "bg-accent/10 text-accent border-accent/30",
  },
  overdue: {
    badge: "bg-destructive/10 text-destructive border-destructive/30",
  },
  cancelled: {
    badge: "bg-muted text-muted-foreground border-border",
  },
};

const STATUS_ICON: Record<PaymentSplitStatus, React.ElementType> = {
  pending: Clock,
  paid: CheckCircle2,
  overdue: AlertCircle,
  cancelled: Ban,
};

const ROUND_CHIP =
  "bg-primary/10 text-primary border-primary/25 ring-1 ring-primary/10";
/** next_dispute_target_date for special/extended max_rounds cases */
const EXTENDED_ROUND_CHIP =
  "bg-accent/10 text-accent border-accent/30 ring-1 ring-accent/15";
const TASK_CHIP =
  "bg-secondary text-secondary-foreground border-border ring-1 ring-border/60";

function isExtendedRoundEvent(r: CalendarRoundEvent): boolean {
  return r.kind === "extended";
}

function buildMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);
  return cells;
}

type DaySelection = {
  date: string;
  splits: CalendarSplit[];
  rounds: CalendarRoundEvent[];
  tasks: CalendarWorkTaskEvent[];
};

export default function AdminCalendar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const {
    calendarSplits,
    calendarRoundEvents,
    calendarWorkTasks,
    calendarLoading,
  } = useAppSelector((s) => s.admin);
  const adminId = useAppSelector((s) => s.adminAuth.user?.id ?? null);

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState<DaySelection | null>(null);
  /** Default on: HubSpot sync can flood the month with unassigned team tasks. */
  const [mineTasksOnly, setMineTasksOnly] = useState(true);
  const detailRef = useRef<HTMLDivElement>(null);
  const scrollNonceRef = useRef(0);
  const [scrollNonce, setScrollNonce] = useState(0);

  const visibleWorkTasks = useMemo(() => {
    if (!mineTasksOnly || adminId == null) return calendarWorkTasks;
    return calendarWorkTasks.filter((task) => task.assignee_admin_id === adminId);
  }, [calendarWorkTasks, mineTasksOnly, adminId]);

  useEffect(() => {
    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    dispatch(fetchAdminCalendar({ from, to }));
  }, [year, month, dispatch]);

  // Scroll the day panel into view inside AdminLayout's <main> scroller.
  useEffect(() => {
    if (!selected || scrollNonce === 0) return;
    const id = window.requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [selected, scrollNonce]);

  const prevMonth = () => {
    if (month === 0) {
      setYear((y) => y - 1);
      setMonth(11);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setYear((y) => y + 1);
      setMonth(0);
    } else setMonth((m) => m + 1);
  };

  const splitsByDay = useMemo(() => {
    const map = new Map<number, CalendarSplit[]>();
    for (const s of calendarSplits) {
      const d = parseInt(String(s.due_date).slice(8, 10), 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(s);
    }
    return map;
  }, [calendarSplits]);

  const roundsByDay = useMemo(() => {
    const map = new Map<number, CalendarRoundEvent[]>();
    for (const r of calendarRoundEvents) {
      const d = parseInt(String(r.target_date).slice(8, 10), 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(r);
    }
    return map;
  }, [calendarRoundEvents]);

  const tasksByDay = useMemo(() => {
    const map = new Map<number, CalendarWorkTaskEvent[]>();
    for (const task of visibleWorkTasks) {
      const d = parseInt(String(task.due_date).slice(8, 10), 10);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(task);
    }
    return map;
  }, [visibleWorkTasks]);

  const cells = buildMonthDays(year, month);
  const monthLabel = new Date(year, month, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const dateForDay = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const handleDayClick = (day: number) => {
    const splits = splitsByDay.get(day) ?? [];
    const rounds = roundsByDay.get(day) ?? [];
    const tasks = tasksByDay.get(day) ?? [];
    if (splits.length === 0 && rounds.length === 0 && tasks.length === 0)
      return;
    setSelected({ date: dateForDay(day), splits, rounds, tasks });
    scrollNonceRef.current += 1;
    setScrollNonce(scrollNonceRef.current);
  };

  const refreshCalendar = () => {
    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    dispatch(fetchAdminCalendar({ from, to }));
  };

  useEffect(() => {
    if (!selected) return;
    const selectedYear = parseInt(selected.date.slice(0, 4), 10);
    const selectedMonth = parseInt(selected.date.slice(5, 7), 10) - 1;
    if (selectedYear !== year || selectedMonth !== month) {
      setSelected(null);
      return;
    }
    const day = parseInt(selected.date.slice(8, 10), 10);
    const splits = splitsByDay.get(day) ?? [];
    const rounds = roundsByDay.get(day) ?? [];
    const tasks = tasksByDay.get(day) ?? [];
    if (splits.length === 0 && rounds.length === 0 && tasks.length === 0) {
      setSelected(null);
    } else {
      setSelected({ date: selected.date, splits, rounds, tasks });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarSplits, calendarRoundEvents, visibleWorkTasks, year, month]);

  const todayDay =
    today.getFullYear() === year && today.getMonth() === month
      ? today.getDate()
      : null;

  const roundCountThisMonth = calendarRoundEvents.length;
  const extendedCountThisMonth = calendarRoundEvents.filter(
    isExtendedRoundEvent,
  ).length;
  const taskCountThisMonth = visibleWorkTasks.length;
  const selectedDayNum = selected
    ? parseInt(selected.date.slice(8, 10), 10)
    : null;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={CalendarDays}
        title={t("adminCalendar.title")}
        description={t("adminCalendar.description")}
      />

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary" />
          {t("adminCalendar.legendRounds")}
          {roundCountThisMonth > 0 && (
            <span className="font-semibold text-primary tabular-nums">
              ({roundCountThisMonth})
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full border-2 border-accent bg-accent/25" />
          {t("adminCalendar.legendExtended")}
          {extendedCountThisMonth > 0 && (
            <span className="font-semibold text-accent tabular-nums">
              ({extendedCountThisMonth})
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" />
          {t("adminCalendar.legendPayments")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-secondary-foreground/50" />
          {t("adminCalendar.legendTasks")}
          {taskCountThisMonth > 0 && (
            <span className="font-semibold text-foreground tabular-nums">
              ({taskCountThisMonth})
            </span>
          )}
        </span>
        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none ml-auto sm:ml-2">
          <input
            type="checkbox"
            className="rounded border-border text-primary focus:ring-ring"
            checked={mineTasksOnly}
            onChange={(e) => setMineTasksOnly(e.target.checked)}
          />
          <span>{t("adminCalendar.mineTasksOnly")}</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-4 w-full min-w-0">
        <button
          type="button"
          onClick={prevMonth}
          className="w-9 h-9 rounded-xl border border-border bg-card flex items-center justify-center hover:bg-muted transition-colors shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h2 className="text-base font-bold text-foreground min-w-0 flex-1 sm:flex-none sm:min-w-[10rem] text-center order-first sm:order-none w-full sm:w-auto basis-full sm:basis-auto">
          {monthLabel}
        </h2>
        <button
          type="button"
          onClick={nextMonth}
          className="w-9 h-9 rounded-xl border border-border bg-card flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {calendarLoading && (
          <div className="ml-2 text-xs text-muted-foreground animate-pulse">
            {t("adminCalendar.loading")}
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="grid grid-cols-7 border-b border-border bg-muted/30">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              className="py-2 text-center text-xs font-semibold text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const daySplits = day ? (splitsByDay.get(day) ?? []) : [];
            const dayRounds = day ? (roundsByDay.get(day) ?? []) : [];
            const dayTasks = day ? (tasksByDay.get(day) ?? []) : [];
            const isToday = day === todayDay;
            const isSelected = day != null && day === selectedDayNum;
            const total =
              daySplits.length + dayRounds.length + dayTasks.length;
            const hasItems = total > 0;
            const chips = [
              ...dayRounds.map((r) => ({ kind: "round" as const, r })),
              ...dayTasks.map((task) => ({ kind: "task" as const, task })),
              ...daySplits.map((s) => ({ kind: "split" as const, s })),
            ].slice(0, 3);
            const extra = total - chips.length;

            return (
              <div
                key={i}
                role={day && hasItems ? "button" : undefined}
                tabIndex={day && hasItems ? 0 : undefined}
                onClick={() => day && hasItems && handleDayClick(day)}
                onKeyDown={(e) => {
                  if (!day || !hasItems) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleDayClick(day);
                  }
                }}
                className={`min-h-[90px] sm:min-h-[110px] p-2 border-b border-r border-border/60 last:border-r-0 transition-colors ${
                  day
                    ? hasItems
                      ? "cursor-pointer hover:bg-muted/50"
                      : ""
                    : "bg-muted/20"
                } ${isToday ? "bg-primary/5" : ""} ${
                  isSelected ? "ring-2 ring-inset ring-primary/40 bg-primary/5" : ""
                } ${dayRounds.length > 0 ? "relative" : ""}`}
              >
                {dayRounds.length > 0 && (
                  <div className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                )}
                {day && (
                  <>
                    <div
                      className={`text-xs font-semibold mb-1.5 w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday || isSelected
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground"
                      }`}
                    >
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {chips.map((chip) =>
                        chip.kind === "round" ? (
                          <div
                            key={chip.r.id}
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border truncate flex items-center gap-1 ${
                              isExtendedRoundEvent(chip.r)
                                ? EXTENDED_ROUND_CHIP
                                : ROUND_CHIP
                            }`}
                            title={`${chip.r.client_first_name} ${chip.r.client_last_name} — ${
                              isExtendedRoundEvent(chip.r)
                                ? t("adminCalendar.extendedRoundN", {
                                    n: chip.r.round_number,
                                  })
                                : t("adminCalendar.roundN", {
                                    n: chip.r.round_number,
                                  })
                            }`}
                          >
                            <Target className="w-2.5 h-2.5 shrink-0" />
                            {isExtendedRoundEvent(chip.r)
                              ? t("adminCalendar.chipExtended", {
                                  n: chip.r.round_number,
                                  name: chip.r.client_first_name,
                                })
                              : `R${chip.r.round_number} ${chip.r.client_first_name}`}
                          </div>
                        ) : chip.kind === "task" ? (
                          <div
                            key={`task-${chip.task.id}`}
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border truncate flex items-center gap-1 ${TASK_CHIP}`}
                            title={chip.task.title}
                          >
                            <CheckSquare className="w-2.5 h-2.5 shrink-0" />
                            {chip.task.title}
                          </div>
                        ) : (
                          (() => {
                            const s = chip.s;
                            const effective =
                              s.status === "pending" &&
                              new Date(s.due_date) < new Date()
                                ? "overdue"
                                : s.status;
                            const ss =
                              STATUS_STYLE[effective as PaymentSplitStatus] ??
                              STATUS_STYLE.pending;
                            return (
                              <div
                                key={s.id}
                                className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border truncate ${ss.badge}`}
                                title={`${s.client_first_name} ${s.client_last_name} — ${fmt(s.amount_cents)}`}
                              >
                                {s.client_first_name} {fmt(s.amount_cents)}
                              </div>
                            );
                          })()
                        ),
                      )}
                      {extra > 0 && (
                        <div className="text-[10px] text-muted-foreground px-1">
                          +{extra} more
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <div
          ref={detailRef}
          className="bg-card border border-border rounded-2xl p-5 space-y-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 scroll-mt-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-foreground">
              {new Date(selected.date + "T12:00:00").toLocaleDateString(
                "en-US",
                {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                },
              )}
            </h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("common.close", { defaultValue: "Close" })}
            </button>
          </div>

          {selected.rounds.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-primary">
                {t("adminCalendar.roundTargets")}
              </p>
              {selected.rounds.map((r) => {
                const href = calendarPipelineHref(r.client_id, r.case_id);
                const extended = isExtendedRoundEvent(r);
                return (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(href)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(href);
                      }
                    }}
                    className={
                      extended
                        ? "flex items-center justify-between gap-3 rounded-xl border border-accent/25 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent px-4 py-3 cursor-pointer hover:border-accent/40 transition-colors"
                        : "flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-3 cursor-pointer hover:border-primary/40 transition-colors"
                    }
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={
                          extended
                            ? "h-9 w-9 rounded-full bg-accent/15 border border-accent/25 flex items-center justify-center shrink-0"
                            : "h-9 w-9 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0"
                        }
                      >
                        <Target
                          className={
                            extended
                              ? "w-4 h-4 text-accent"
                              : "w-4 h-4 text-primary"
                          }
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {r.client_first_name} {r.client_last_name}
                          {extended ? (
                            <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                              {t("adminCalendar.specialBadge")}
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {r.case_number ?? "—"} ·{" "}
                          {extended
                            ? t("adminCalendar.extendedRoundN", {
                                n: r.round_number,
                              })
                            : t("adminCalendar.roundN", {
                                n: r.round_number,
                              })}
                        </p>
                      </div>
                    </div>
                    <Link
                      to={href}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs font-semibold text-primary hover:underline shrink-0"
                    >
                      {t("adminCalendar.openCase")}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}

          {selected.tasks.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t("adminCalendar.workTasks")}
              </p>
              {selected.tasks.map((task) => {
                const href = calendarTaskHref(task);
                const myTasksHref = `/admin/my-tasks?task=${task.id}`;
                return (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(href)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(href);
                      }
                    }}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 cursor-pointer hover:border-primary/40 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0">
                        <CheckSquare className="w-4 h-4 text-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {task.title}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {task.case_number
                            ? `${task.case_number} · `
                            : ""}
                          {task.assignee_name ||
                            t("myTasks.unassigned")}
                          {task.client_first_name
                            ? ` · ${task.client_first_name} ${task.client_last_name || ""}`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {task.client_id || task.case_id ? (
                        <Link
                          to={calendarPipelineHref(task.client_id ?? 0, task.case_id)}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          {t("adminCalendar.openCase")}
                        </Link>
                      ) : null}
                      <Link
                        to={myTasksHref}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-semibold text-muted-foreground hover:text-foreground"
                      >
                        {t("adminCalendar.openTasks")}
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selected.splits.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t("adminCalendar.payments")}
              </p>
              {selected.splits.map((s) => {
                const effective =
                  s.status === "pending" && new Date(s.due_date) < new Date()
                    ? "overdue"
                    : s.status;
                const ss =
                  STATUS_STYLE[effective as PaymentSplitStatus] ??
                  STATUS_STYLE.pending;
                const Icon =
                  STATUS_ICON[effective as PaymentSplitStatus] ?? Clock;
                const href = calendarPipelineHref(s.client_id, s.case_id);
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(href)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(href);
                      }
                    }}
                    className="flex items-center justify-between gap-3 bg-muted/40 rounded-xl px-4 py-3 cursor-pointer hover:bg-muted/60 hover:ring-1 hover:ring-border transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {s.client_first_name} {s.client_last_name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {s.case_number ?? "—"} · {s.label}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-bold">{fmt(s.amount_cents)}</p>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ss.badge}`}
                        >
                          {effective.charAt(0).toUpperCase() +
                            effective.slice(1)}
                        </span>
                      </div>
                      <Link
                        to={href}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-semibold text-primary hover:underline hidden sm:inline"
                      >
                        {t("adminCalendar.openCase")}
                      </Link>
                      <div onClick={(e) => e.stopPropagation()}>
                        <AdminSplitActions split={s} onDone={refreshCalendar} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

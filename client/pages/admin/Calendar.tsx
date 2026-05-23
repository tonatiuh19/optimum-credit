/**
 * Admin Calendar page — /admin/calendar
 * Month-view grid for scheduling — payments, tasks, and future features.
 */
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  AlertCircle,
  Ban,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminCalendar } from "@/store/slices/adminSlice";
import type { CalendarSplit, PaymentSplitStatus } from "@shared/api";
import AdminPageHeader from "@/components/AdminPageHeader";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

const STATUS_STYLE: Record<PaymentSplitStatus, { dot: string; badge: string }> =
  {
    pending: {
      dot: "bg-yellow-400",
      badge: "bg-yellow-500/10 text-yellow-700 border-yellow-300",
    },
    paid: {
      dot: "bg-accent",
      badge: "bg-accent/10 text-accent border-accent/30",
    },
    overdue: {
      dot: "bg-destructive",
      badge: "bg-destructive/10 text-destructive border-destructive/30",
    },
    cancelled: {
      dot: "bg-muted-foreground",
      badge: "bg-muted text-muted-foreground border-border",
    },
  };

const STATUS_ICON: Record<PaymentSplitStatus, React.ElementType> = {
  pending: Clock,
  paid: CheckCircle2,
  overdue: AlertCircle,
  cancelled: Ban,
};

// ─── Calendar grid ────────────────────────────────────────────────────────────
function buildMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Pad to 6 rows
  while (cells.length < 42) cells.push(null);
  return cells;
}

export default function AdminCalendar() {
  const dispatch = useAppDispatch();
  const { calendarSplits, calendarLoading } = useAppSelector((s) => s.admin);

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [selected, setSelected] = useState<CalendarSplit[] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Fetch whenever month/year changes
  useEffect(() => {
    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    dispatch(fetchAdminCalendar({ from, to }));
  }, [year, month, dispatch]);

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

  // Group splits by day
  const splitsByDay = new Map<number, CalendarSplit[]>();
  for (const s of calendarSplits) {
    const d = parseInt(s.due_date.slice(8, 10), 10);
    if (!splitsByDay.has(d)) splitsByDay.set(d, []);
    splitsByDay.get(d)!.push(s);
  }

  const cells = buildMonthDays(year, month);
  const monthLabel = new Date(year, month, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const handleDayClick = (day: number) => {
    const daySplits = splitsByDay.get(day);
    if (daySplits && daySplits.length > 0) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      setSelected(daySplits);
      setSelectedDate(dateStr);
    }
  };

  const todayDay =
    today.getFullYear() === year && today.getMonth() === month
      ? today.getDate()
      : null;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={CalendarDays}
        title="Calendar"
        description="Track scheduled events — payment installments and upcoming milestones"
      />

      <div className="flex items-center gap-4">
        <button
          onClick={prevMonth}
          className="w-9 h-9 rounded-xl border border-border bg-card flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <h2 className="text-base font-bold text-foreground min-w-[180px] text-center">
          {monthLabel}
        </h2>
        <button
          onClick={nextMonth}
          className="w-9 h-9 rounded-xl border border-border bg-card flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {calendarLoading && (
          <div className="ml-2 text-xs text-muted-foreground animate-pulse">
            Loading…
          </div>
        )}
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Day labels */}
        <div className="grid grid-cols-7 border-b border-border">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              className="py-2 text-center text-xs font-semibold text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Cells */}
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const daySplits = day ? (splitsByDay.get(day) ?? []) : [];
            const isToday = day === todayDay;
            const hasSplits = daySplits.length > 0;

            return (
              <div
                key={i}
                onClick={() => day && hasSplits && handleDayClick(day)}
                className={`min-h-[90px] sm:min-h-[110px] p-2 border-b border-r border-border/60 last:border-r-0 transition-colors ${
                  day
                    ? hasSplits
                      ? "cursor-pointer hover:bg-muted/50"
                      : ""
                    : "bg-muted/20"
                } ${isToday ? "bg-primary/5" : ""}`}
              >
                {day && (
                  <>
                    <div
                      className={`text-xs font-semibold mb-1.5 w-6 h-6 flex items-center justify-center rounded-full ${
                        isToday ? "bg-primary text-white" : "text-foreground"
                      }`}
                    >
                      {day}
                    </div>
                    <div className="space-y-0.5">
                      {daySplits.slice(0, 3).map((s) => {
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
                      })}
                      {daySplits.length > 3 && (
                        <div className="text-[10px] text-muted-foreground px-1">
                          +{daySplits.length - 3} more
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

      {/* Day detail panel */}
      {selected && selectedDate && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-foreground">
              {new Date(selectedDate + "T12:00:00").toLocaleDateString(
                "en-US",
                {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                },
              )}
            </h3>
            <button
              onClick={() => {
                setSelected(null);
                setSelectedDate(null);
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          <div className="space-y-2">
            {selected.map((s) => {
              const effective =
                s.status === "pending" && new Date(s.due_date) < new Date()
                  ? "overdue"
                  : s.status;
              const ss =
                STATUS_STYLE[effective as PaymentSplitStatus] ??
                STATUS_STYLE.pending;
              const Icon =
                STATUS_ICON[effective as PaymentSplitStatus] ?? Clock;
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between bg-muted/40 rounded-xl px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {s.client_first_name} {s.client_last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.case_number ?? "—"} · {s.label}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">{fmt(s.amount_cents)}</p>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ss.badge}`}
                    >
                      {effective.charAt(0).toUpperCase() + effective.slice(1)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

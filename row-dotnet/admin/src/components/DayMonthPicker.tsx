"use client";

import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, ChevronDown, X } from "lucide-react";

// Project rule: birthday and anniversary collect ONLY day + month. Year is never
// asked from the user; backend always stores year=1900 (placeholder). On display
// the year is hidden everywhere. This picker presents a small calendar UI inside
// a popover — month nav arrows + day grid, no year selector. Emits "1900-MM-DD"
// (matches the existing DTO field shape) or null.
//
// Existing values flow in as ISO date strings ("2026-06-15", "1900-06-15") or
// short "DD-MM" strings (mobile API pre-formatted). We parse out day+month only.
interface DayMonthPickerProps {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function parseDayMonth(v: string | null | undefined): { day: number | null; month: number | null } {
  if (!v) return { day: null, month: null };
  // "DD-MM" short form (mobile API may pre-format)
  const m = String(v).trim().match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) return { day: Number(m[1]), month: Number(m[2]) };
  const d = new Date(v);
  if (isNaN(d.getTime())) return { day: null, month: null };
  return { day: d.getDate(), month: d.getMonth() + 1 };
}

function daysInMonth(month1to12: number): number {
  // Use 1904 — a leap year — so Feb shows 29 cells and the user can pick Feb 29.
  // Backend stores year=1900 placeholder regardless; the display year here only
  // controls the calendar grid layout.
  return new Date(1904, month1to12, 0).getDate();
}

// Day-of-week (0=Sun…6=Sat) for the 1st of the chosen month in the leap year
// 1904 so Feb 29 is reachable.
function firstWeekdayOfMonth(month1to12: number): number {
  return new Date(1904, month1to12 - 1, 1).getDay();
}

export function DayMonthPicker({ value, onChange, disabled = false }: DayMonthPickerProps) {
  const { day: initialDay, month: initialMonth } = parseDayMonth(value);
  const [open, setOpen] = useState(false);
  // The month the day grid is currently showing — defaults to the value's
  // month, then today's month if no value, then January as last resort.
  const [viewMonth, setViewMonth] = useState<number>(
    initialMonth ?? new Date().getMonth() + 1
  );
  // Toggles between the day grid (false) and the month-picker grid (true).
  // Clicking the month label flips to the month picker; picking a month flips
  // back to the day grid for that month.
  const [showMonthList, setShowMonthList] = useState(false);

  // Keep the visible month in sync when an external value change happens
  // (e.g. parent re-fetched the member and re-populated the form).
  useEffect(() => {
    const { month } = parseDayMonth(value);
    if (month) setViewMonth(month);
  }, [value]);

  // When the popover closes, reset back to the day-grid view so the next open
  // doesn't land the user on the month list unexpectedly.
  useEffect(() => {
    if (!open) setShowMonthList(false);
  }, [open]);

  const { day: selectedDay, month: selectedMonth } = parseDayMonth(value);

  const display = selectedDay && selectedMonth
    ? `${String(selectedDay).padStart(2, "0")} ${MONTH_NAMES[selectedMonth - 1]}`
    : "Day & Month";

  const handlePickDay = (d: number) => {
    const mm = String(viewMonth).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    onChange(`1900-${mm}-${dd}`);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  // Build the day grid: leading blanks for the days before the 1st, then 1..N.
  const startBlanks = firstWeekdayOfMonth(viewMonth);
  const totalDays = daysInMonth(viewMonth);
  const cells: (number | null)[] = [
    ...Array.from({ length: startBlanks }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full justify-start text-left font-normal"
        >
          <CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />
          <span className={selectedDay ? "" : "text-muted-foreground"}>{display}</span>
          {selectedDay && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(null);
                }
              }}
              className="ml-auto opacity-60 hover:opacity-100"
              aria-label="Clear date"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-3" align="start">
        {/* Header: clickable month label that toggles between the day grid
            and the month list. The YEAR is intentionally NOT rendered —
            it's not collected and not meaningful (backend stores 1900). */}
        <div className="flex items-center justify-center mb-2">
          <button
            type="button"
            onClick={() => setShowMonthList((s) => !s)}
            className="flex items-center gap-1.5 px-3 py-1 rounded hover:bg-slate-100 text-sm font-semibold text-slate-700 transition-colors"
            aria-label="Pick a month"
          >
            {MONTH_NAMES[viewMonth - 1]}
            <ChevronDown
              className={`h-3.5 w-3.5 opacity-60 transition-transform ${
                showMonthList ? "rotate-180" : ""
              }`}
            />
          </button>
        </div>

        {showMonthList ? (
          // Month picker view — 4×3 grid of month names. Selecting a month
          // returns us to the day-grid view focused on that month.
          <div className="grid grid-cols-3 gap-1.5">
            {MONTH_NAMES.map((name, idx) => {
              const monthNum = idx + 1;
              const isCurrent = viewMonth === monthNum;
              const isSelectedValue = selectedMonth === monthNum;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setViewMonth(monthNum);
                    setShowMonthList(false);
                  }}
                  className={
                    "py-2 rounded text-xs font-medium transition-colors " +
                    (isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isSelectedValue
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-slate-100 text-slate-700")
                  }
                >
                  {name.slice(0, 3)}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            {/* Weekday labels */}
            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {WEEKDAY_LABELS.map((d, i) => (
                <div key={i} className="text-[10px] font-semibold text-slate-400 text-center py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((d, i) => {
                if (d == null) return <div key={i} className="h-8" />;
                const isSelected = selectedMonth === viewMonth && selectedDay === d;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handlePickDay(d)}
                    className={
                      "h-8 rounded text-xs font-medium transition-colors " +
                      (isSelected
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-slate-100 text-slate-700")
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

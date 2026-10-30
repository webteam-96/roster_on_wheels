"use client";

// A date box that always reads and writes dd/mm/yyyy, on every computer.
//
// The browser's own <input type="date"> shows whatever format the user's Windows/browser language
// is set to. On a machine set to United States, typing 01/09/2026 for 1 September is read as
// 9 January — and since an entry is filed under the Rotary year of its date, the record then lands
// in the wrong year and vanishes from the list the club is looking at (user 2026-09-23). No setting
// or stylesheet can change a native date box's format, so the typed part is ours: a plain text box
// that is always dd/mm/yyyy, plus a calendar to pick from.
//
// Drop-in for the native input: `value` and `onChange` speak ISO ("2026-09-01"), same as before, so
// nothing else in a form — or on the server — changes. `min` / `max` are ISO too.

import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "@/components/icons";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

// ── ISO ⇄ dd/mm/yyyy ────────────────────────────────────────────────────────────────────────────

function isoToTyped(iso: string | null | undefined): string {
  const m = String(iso ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function isRealDate(d: number, m: number, y: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1000 || y > 9999) return false;
  return d <= new Date(y, m, 0).getDate();
}

// Accepts what people actually type: 1/9/2026, 01-09-2026, 01.09.2026, 01092026.
// Always day first — that is the whole point of this control.
function typedToIso(typed: string): string | null {
  const digits = typed.replace(/\D/g, "");
  let d: number, m: number, y: number;
  if (digits.length === 8) {
    d = Number(digits.slice(0, 2)); m = Number(digits.slice(2, 4)); y = Number(digits.slice(4));
  } else {
    const parts = typed.split(/[^\d]+/).filter(Boolean);
    if (parts.length !== 3) return null;
    d = Number(parts[0]); m = Number(parts[1]); y = Number(parts[2]);
    if (parts[2].length === 2) y += y <= 79 ? 2000 : 1900;   // 26 → 2026, 99 → 1999
  }
  if (!isRealDate(d, m, y)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isoToLongWords(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]} ${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

function todayIso(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export interface DateFieldProps {
  value: string | null | undefined;
  /** Receives the ISO date ("2026-09-01"), or "" once the box is cleared. */
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  /** Shown but not editable — the calendar button is hidden too. */
  readOnly?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  name?: string;
  /** Hides the "01 September 2026" line under the box. */
  hideHint?: boolean;
}

export default function DateField({
  value, onChange, min, max, disabled = false, readOnly = false, required = false,
  className = "", id, name, hideHint = false,
}: DateFieldProps) {
  const [typed, setTyped] = useState(() => isoToTyped(value));
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const iso = String(value ?? "").match(/^(\d{4})-(\d{2})/);
    const t = new Date();
    return iso ? { y: Number(iso[1]), m: Number(iso[2]) } : { y: t.getFullYear(), m: t.getMonth() + 1 };
  });
  const [showMonthList, setShowMonthList] = useState(false);
  // While the box has focus the half-typed text is the user's; a value arriving from the form
  // (a reset, or a record finishing loading) must not overwrite it mid-keystroke.
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setTyped(isoToTyped(value));
    const iso = String(value ?? "").match(/^(\d{4})-(\d{2})/);
    if (iso) setView({ y: Number(iso[1]), m: Number(iso[2]) });
  }, [value]);

  useEffect(() => { if (!open) setShowMonthList(false); }, [open]);

  const iso = typedToIso(typed);
  const outOfRange = iso != null && ((min && iso < min) || (max && iso > max));
  const invalid = typed.trim() !== "" && (iso == null || outOfRange);

  const commit = (next: string) => {
    setTyped(next);
    const parsed = typedToIso(next);
    if (next.trim() === "") onChange("");
    else if (parsed && !((min && parsed < min) || (max && parsed > max))) onChange(parsed);
  };

  const handleType = (raw: string) => {
    // Keep it to digits and separators, and add the slashes as they type.
    let s = raw.replace(/[^\d/\-.]/g, "");
    const digits = s.replace(/\D/g, "").slice(0, 8);
    if (/^\d+$/.test(s) && digits.length > 2) {
      s = digits.length <= 4
        ? `${digits.slice(0, 2)}/${digits.slice(2)}`
        : `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    }
    commit(s);
  };

  const pickDay = (day: number) => {
    const picked = `${view.y}-${String(view.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if ((min && picked < min) || (max && picked > max)) return;
    setTyped(isoToTyped(picked));
    onChange(picked);
    setOpen(false);
  };

  const stepMonth = (by: number) => {
    setView((v) => {
      const next = new Date(v.y, v.m - 1 + by, 1);
      return { y: next.getFullYear(), m: next.getMonth() + 1 };
    });
  };

  const startBlanks = new Date(view.y, view.m - 1, 1).getDay();
  const totalDays = new Date(view.y, view.m, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startBlanks }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  const selectedIso = typedToIso(typed);
  const today = todayIso();

  return (
    <div className="w-full">
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          id={id}
          name={name}
          value={typed}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          placeholder={readOnly ? "" : "dd/mm/yyyy"}
          aria-invalid={invalid || undefined}
          onFocus={() => { focused.current = true; }}
          onBlur={() => {
            focused.current = false;
            // Tidy 1/9/26 into 01/09/2026 once they leave the box.
            const parsed = typedToIso(typed);
            if (parsed) setTyped(isoToTyped(parsed));
          }}
          onChange={(e) => handleType(e.target.value)}
          // Same base as the shadcn Input this replaces, so a converted field looks unchanged;
          // anything the page passes wins (tailwind-merge), and pr-10 keeps text clear of the icon.
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className,
            "pr-10",
          )}
        />
        <Popover open={open && !readOnly} onOpenChange={(o) => !disabled && !readOnly && setOpen(o)}>
          <PopoverTrigger asChild>
            <button
              type="button"
              hidden={readOnly}
              disabled={disabled || readOnly}
              aria-label="Open calendar"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 disabled:opacity-50"
            >
              <CalendarIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-3" align="start">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => stepMonth(-1)} className="rounded p-1 hover:bg-muted" aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setShowMonthList((s) => !s)} className="rounded px-2 py-1 text-sm font-medium hover:bg-muted">
                {MONTH_NAMES[view.m - 1]} {view.y}
              </button>
              <button type="button" onClick={() => stepMonth(1)} className="rounded p-1 hover:bg-muted" aria-label="Next month">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {showMonthList ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={() => setView((v) => ({ ...v, y: v.y - 1 }))} className="rounded p-1 hover:bg-muted" aria-label="Previous year">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm font-medium">{view.y}</span>
                  <button type="button" onClick={() => setView((v) => ({ ...v, y: v.y + 1 }))} className="rounded p-1 hover:bg-muted" aria-label="Next year">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {MONTH_NAMES.map((mn, i) => (
                    <button
                      key={mn}
                      type="button"
                      onClick={() => { setView((v) => ({ ...v, m: i + 1 })); setShowMonthList(false); }}
                      className={`rounded px-1 py-1.5 text-xs hover:bg-muted ${view.m === i + 1 ? "bg-primary text-primary-foreground hover:bg-primary" : ""}`}
                    >
                      {mn.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="mb-1 grid grid-cols-7 gap-0.5">
                  {WEEKDAY_LABELS.map((w, i) => (
                    <div key={i} className="text-center text-[11px] font-medium text-muted-foreground">{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {cells.map((day, i) => {
                    if (day == null) return <div key={`b${i}`} />;
                    const dayIso = `${view.y}-${String(view.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const blocked = (min && dayIso < min) || (max && dayIso > max);
                    const isSelected = selectedIso === dayIso;
                    return (
                      <button
                        key={dayIso}
                        type="button"
                        disabled={!!blocked}
                        onClick={() => pickDay(day)}
                        className={`h-8 rounded text-xs ${
                          isSelected ? "bg-primary text-primary-foreground"
                          : blocked ? "cursor-not-allowed text-muted-foreground/40"
                          : dayIso === today ? "border border-primary/40 hover:bg-muted"
                          : "hover:bg-muted"}`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => { if (!((min && today < min) || (max && today > max))) { setTyped(isoToTyped(today)); onChange(today); setOpen(false); } }}
                  className="mt-2 w-full rounded border px-2 py-1 text-xs hover:bg-muted"
                >
                  Today
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* The date spelled out, so a wrong entry is obvious before it is saved. */}
      {!hideHint && (
        invalid ? (
          <p className="mt-0.5 text-xs text-destructive">
            {outOfRange ? "Date is outside the allowed range." : "Enter the date as dd/mm/yyyy."}
          </p>
        ) : selectedIso ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{isoToLongWords(selectedIso)}</p>
        ) : null
      )}
    </div>
  );
}

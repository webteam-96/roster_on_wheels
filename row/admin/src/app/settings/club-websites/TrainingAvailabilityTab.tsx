"use client";

/**
 * SuperAdmin — when the training team is available for website training
 * (Settings → Club Websites → Training Availability). User request 2026-09-29.
 *
 * Two halves, same idea as the Cal.com screen the user sent:
 *   1. Working hours — the repeating weekly pattern. A day switched off is closed every week.
 *   2. Blocked dates — one specific date: either closed all day, or ONLY the hours given here
 *      (so "not available today 3pm-6pm" = keep 11:30-15:00 and drop the rest).
 *
 * Whatever is blocked here still APPEARS in the club's "Request a Training Date" popup, greyed
 * out with the reason — it is never hidden, so the club admin can see why a time is gone.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarX2, Clock, Loader2, Plus, Save, Trash2, X, AlertTriangle } from "@/components/icons";
import ErrorAlert from "@/components/ErrorAlert";
import SuccessAlert from "@/components/SuccessAlert";
import {
  getTrainingAvailabilitySettings, saveTrainingWeek, saveTrainingDateOverride, deleteTrainingDateOverride,
  type TrainingAvailabilitySettings, type TrainingWeekday, type TrainingHourRange,
} from "@/services/api";

import { appLocale, appTimeZone } from "@/lib/appFormat";
// "14:30" → "2:30 PM", for the read-back lines only; the inputs stay 24-hour so they are typable.
function to12h(hhmm: string) {
  const [h, m] = (hhmm || "").split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

const BLANK_RANGE: TrainingHourRange = { start: "11:30", end: "12:30" };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// The cells of one month: leading blanks so the 1st lands under its weekday, then the days.
function monthCells(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  return cells;
}

export default function TrainingAvailabilityTab() {
  const [data, setData] = useState<TrainingAvailabilitySettings | null>(null);
  const [week, setWeek] = useState<TrainingWeekday[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // "Block a date" form
  const [blockOpen, setBlockOpen] = useState(false);
  // Several dates at once (user 2026-09-29): a team away for a week blocks the whole run in one save.
  const [blockDates, setBlockDates] = useState<string[]>([]);
  // The month on screen. The picker is an inline calendar (user 2026-09-29) - a typed date box made
  // you work out which day of the week a date fell on; blocking is always "that Tuesday", not a number.
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());
  const [allDay, setAllDay] = useState(true);
  const [blockRanges, setBlockRanges] = useState<TrainingHourRange[]>([{ ...BLANK_RANGE }]);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const d = await getTrainingAvailabilitySettings();
      setData(d);
      setWeek(d.week);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Could not load the training availability.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function setDay(dow: number, patch: Partial<TrainingWeekday>) {
    setWeek((prev) => prev.map((d) => (d.dayOfWeek === dow ? { ...d, ...patch } : d)));
    setSuccess(null);
  }
  function setRange(dow: number, i: number, patch: Partial<TrainingHourRange>) {
    setWeek((prev) => prev.map((d) =>
      d.dayOfWeek === dow ? { ...d, ranges: d.ranges.map((r, ix) => (ix === i ? { ...r, ...patch } : r)) } : d));
    setSuccess(null);
  }

  async function saveWeek() {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const fresh = await saveTrainingWeek(week);
      setData(fresh); setWeek(fresh.week);
      setSuccess("Working hours saved.");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Could not save the working hours.");
    } finally { setSaving(false); }
  }

  async function saveBlock() {
    if (blockDates.length === 0) { setError("Pick at least one date on the calendar."); return; }
    setSaving(true); setError(null); setSuccess(null);
    try {
      const fresh = await saveTrainingDateOverride({
        dates: [...blockDates].sort(),
        isUnavailableAllDay: allDay,
        ranges: allDay ? [] : blockRanges,
        reason: reason.trim() || null,
      });
      setData(fresh);
      setBlockOpen(false); setBlockDates([]); setAllDay(true); setReason("");
      setBlockRanges([{ ...BLANK_RANGE }]);
      setSuccess(blockDates.length === 1
        ? "Date saved. Clubs will see it greyed out on the booking screen."
        : `${blockDates.length} dates saved. Clubs will see them greyed out on the booking screen.`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Could not save that date.");
    } finally { setSaving(false); }
  }

  async function removeBlock(id: number, label: string) {
    if (!window.confirm(`Remove the block on ${label}? That date goes back to the normal weekly hours.`)) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      setData(await deleteTrainingDateOverride(id));
      setSuccess("Block removed.");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err?.response?.data?.message || "Could not remove that block.");
    } finally { setSaving(false); }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-5">
      <ErrorAlert open={!!error} title="Error" description={error || ""} onOk={() => setError(null)} />
      <SuccessAlert open={!!success} title="Success" description={success || ""} onOk={() => setSuccess(null)} />

      <p className="text-xs text-slate-500">
        Slots are {data?.slotMinutes ?? 30} minutes, maximum {data?.maxPerDay ?? 3} trainings a day, times in {appTimeZone()}.
        Anything closed here still shows on the club&apos;s booking screen: greyed out with the reason, never hidden.
      </p>

      {/* ── 1. the repeating week ── */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-blue-50 flex flex-wrap items-center gap-2">
          <Clock size={16} className="text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">Working hours</h3>
          <span className="text-xs text-slate-400">the normal week</span>
          <button
            onClick={saveWeek}
            disabled={saving}
            className="ml-auto inline-flex items-center gap-1.5 h-8 rounded-lg bg-azure px-3 text-xs font-semibold text-white hover:bg-mint-ink disabled:opacity-40"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save hours
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {week.map((d) => (
            <div key={d.dayOfWeek} className="px-3 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
              <label className="flex items-center gap-2 w-full sm:w-44 shrink-0 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={d.isAvailable}
                  onChange={(e) => setDay(d.dayOfWeek, {
                    isAvailable: e.target.checked,
                    ranges: e.target.checked && d.ranges.length === 0 ? [{ ...BLANK_RANGE }] : d.ranges,
                  })}
                  className="h-4 w-4 accent-blue-600 cursor-pointer"
                />
                <span className={`text-sm ${d.isAvailable ? "font-semibold text-slate-800" : "text-slate-400"}`}>{d.dayName}</span>
              </label>

              {!d.isAvailable ? (
                <span className="text-sm text-slate-400">Unavailable</span>
              ) : (
                <div className="flex-1 space-y-2">
                  {d.ranges.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 flex-wrap">
                      <input
                        type="time"
                        value={r.start}
                        onChange={(e) => setRange(d.dayOfWeek, i, { start: e.target.value })}
                        className="h-8 w-28 rounded-md border border-slate-300 px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-slate-400 text-sm">–</span>
                      <input
                        type="time"
                        value={r.end}
                        onChange={(e) => setRange(d.dayOfWeek, i, { end: e.target.value })}
                        className="h-8 w-28 rounded-md border border-slate-300 px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => setDay(d.dayOfWeek, { ranges: d.ranges.filter((_, ix) => ix !== i) })}
                        title="Remove this time range"
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <X size={15} />
                      </button>
                      {i === d.ranges.length - 1 && (
                        <button
                          onClick={() => setDay(d.dayOfWeek, { ranges: [...d.ranges, { ...BLANK_RANGE }] })}
                          title="Add another time range on this day"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <Plus size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                  {d.ranges.length === 0 && (
                    <button
                      onClick={() => setDay(d.dayOfWeek, { ranges: [{ ...BLANK_RANGE }] })}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
                    >
                      <Plus size={13} /> Add a time range
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 2. one-off blocked dates ── */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-amber-50 flex flex-wrap items-center gap-2">
          <CalendarX2 size={16} className="text-amber-600" />
          <h3 className="text-sm font-semibold text-slate-800">Blocked dates</h3>
          <span className="text-xs text-slate-400">days the team is away, or free only part of the day</span>
          <button
            onClick={() => { setBlockOpen((v) => !v); setSuccess(null); }}
            className="ml-auto inline-flex items-center gap-1.5 h-8 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            <Plus size={13} /> Block a date
          </button>
        </div>

        {blockOpen && (
          <div className="px-3 sm:px-5 py-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
            <div className="flex flex-col md:flex-row gap-4 md:gap-6">
              {/* ── the month ── */}
              <div className="w-full md:w-96 shrink-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Select the dates to block</p>
                  {blockDates.length > 0 && (
                    <>
                      <span className="text-[11px] font-semibold text-ink">{blockDates.length} selected</span>
                      <button type="button" onClick={() => setBlockDates([])} className="text-[11px] text-slate-500 hover:text-rose-600 underline">
                        clear
                      </button>
                    </>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-2">
                    <button
                      type="button"
                      onClick={() => { const m = viewMonth - 1; if (m < 0) { setViewMonth(11); setViewYear((y) => y - 1); } else setViewMonth(m); }}
                      className="h-7 w-7 rounded-md text-slate-500 hover:bg-slate-100"
                      aria-label="Previous month"
                    >&#8249;</button>
                    <span className="text-sm font-semibold text-slate-800">{MONTHS[viewMonth]} {viewYear}</span>
                    <button
                      type="button"
                      onClick={() => { const m = viewMonth + 1; if (m > 11) { setViewMonth(0); setViewYear((y) => y + 1); } else setViewMonth(m); }}
                      className="h-7 w-7 rounded-md text-slate-500 hover:bg-slate-100"
                      aria-label="Next month"
                    >&#8250;</button>
                  </div>

                  <div className="grid grid-cols-7 gap-0.5 mb-1">
                    {WEEKDAYS.map((w) => (
                      <span key={w} className="text-xs font-medium text-center text-slate-400 py-1.5">{w}</span>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-0.5">
                    {monthCells(viewYear, viewMonth).map((d, i) => {
                      if (d === null) return <span key={`b${i}`} />;
                      const cell = iso(viewYear, viewMonth, d);
                      const past = cell < todayIso;
                      const picked = blockDates.includes(cell);
                      // A date already blocked is marked, so you can see the month at a glance.
                      const blocked = (data?.overrides ?? []).some((o) => o.date === cell);
                      return (
                        <button
                          key={cell}
                          type="button"
                          disabled={past}
                          onClick={() => {
                            // Click to add, click again to drop - no modifier key to discover.
                            setBlockDates((prev) => prev.includes(cell) ? prev.filter((x) => x !== cell) : [...prev, cell]);
                            setSuccess(null);
                          }}
                          title={blocked ? "Already blocked" : past ? "Past date" : "Click to select, click again to remove"}
                          className={`relative h-11 rounded-lg text-sm ${
                            picked
                              ? "bg-azure text-white font-semibold"
                              : past
                              ? "text-slate-300 cursor-not-allowed"
                              : blocked
                              ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
                              : "text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {d}
                          {blocked && !picked && (
                            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-amber-500" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  Click any number of dates. Click again to unselect.
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500 align-middle mx-1" />
                  already blocked · past dates cannot be picked
                </p>
              </div>

              {/* ── what to block on that date ── */}
              <div className="flex-1 min-w-0 space-y-3">
                {blockDates.length === 0 ? (
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pick one or more dates on the left</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {[...blockDates].sort().map((d) => (
                      <span key={d} className="inline-flex items-center gap-1 rounded-full bg-azure text-white text-[11px] px-2 py-0.5">
                        {new Date(d + "T00:00:00").toLocaleDateString(appLocale(), { weekday: "short", day: "2-digit", month: "short" })}
                        <button type="button" onClick={() => setBlockDates((p) => p.filter((x) => x !== d))} className="hover:text-rose-300" aria-label="Remove">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-slate-400">The same rule below is applied to every date selected.</p>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                  <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 accent-amber-600 cursor-pointer" />
                  Not available all day
                </label>

            {!allDay && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">Hours the team IS free that day: everything outside these is blocked:</p>
                {blockRanges.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <input
                      type="time" value={r.start}
                      onChange={(e) => setBlockRanges((p) => p.map((x, ix) => (ix === i ? { ...x, start: e.target.value } : x)))}
                      className="h-8 w-28 rounded-md border border-slate-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-slate-400 text-sm">–</span>
                    <input
                      type="time" value={r.end}
                      onChange={(e) => setBlockRanges((p) => p.map((x, ix) => (ix === i ? { ...x, end: e.target.value } : x)))}
                      className="h-8 w-28 rounded-md border border-slate-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {blockRanges.length > 1 && (
                      <button onClick={() => setBlockRanges((p) => p.filter((_, ix) => ix !== i))} className="text-slate-400 hover:text-rose-600"><X size={15} /></button>
                    )}
                    {i === blockRanges.length - 1 && (
                      <button onClick={() => setBlockRanges((p) => [...p, { ...BLANK_RANGE }])} className="text-blue-600 hover:text-blue-800"><Plus size={15} /></button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <label className="flex flex-col gap-1 text-xs text-slate-500 max-w-md">
              Reason (shown to clubs on the blocked slot)
              <input
                type="text" value={reason} maxLength={200}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Team training day"
                className="h-9 rounded-md border border-slate-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={saveBlock} disabled={saving || blockDates.length === 0}
                title={blockDates.length > 0 ? undefined : "Pick at least one date on the calendar"}
                className="inline-flex items-center gap-1.5 h-9 rounded-lg bg-azure px-4 text-xs font-semibold text-white hover:bg-mint-ink disabled:opacity-40"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {blockDates.length > 1 ? `Save ${blockDates.length} dates` : "Save date"}
              </button>
              <button
                onClick={() => setBlockOpen(false)}
                className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
              </div>
            </div>
          </div>
        )}

        {(data?.overrides?.length ?? 0) === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">No blocked dates. The weekly hours above apply every day.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {data!.overrides.map((o) => (
              <div key={o.id} className="px-3 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <span className="text-sm font-semibold text-slate-800 w-full sm:w-52 shrink-0">{o.dateLabel}</span>
                <span className="flex-1 text-sm text-slate-600">
                  {o.isUnavailableAllDay
                    ? <span className="text-rose-600 font-medium">Not available all day</span>
                    : <>Free only {o.ranges.map((r) => `${to12h(r.start)} – ${to12h(r.end)}`).join(", ")}</>}
                  {o.reason && <span className="text-slate-400"> · {o.reason}</span>}
                </span>
                {o.bookedCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"
                    title="These were booked before the block. They are NOT cancelled: move them by hand if they clash."
                  >
                    <AlertTriangle size={12} /> {o.bookedCount} already booked
                  </span>
                )}
                <button
                  onClick={() => removeBlock(o.id, o.dateLabel)}
                  disabled={saving}
                  title="Remove this block"
                  className="text-slate-400 hover:text-rose-600 disabled:opacity-40 self-end sm:self-auto"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

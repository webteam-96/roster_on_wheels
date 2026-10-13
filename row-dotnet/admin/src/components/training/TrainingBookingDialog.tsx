"use client";

/**
 * Calendly-style training slot picker. Left = the days in the booking window (with open-slot
 * counts); right = the 30-minute slots of the selected day. Books (or reschedules) and shows the
 * generated Zoom link. Reused by the club-admin My Club Website card and the SuperAdmin
 * Website Training Appointments tab (reschedule).
 *
 * A day or time the training team has blocked is still SHOWN, greyed out with the reason
 * ("Not available" / "Already booked"), instead of quietly disappearing (user 2026-09-29).
 */

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getTrainingAvailability, bookTrainingAppointment, rescheduleTrainingAppointment } from "@/services/api";

import { appLocale, appTimeZone } from "@/lib/appFormat";
type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clubId: number;
  mode?: "book" | "reschedule";
  appointmentId?: number;
  onDone?: () => void;
};

function to12h(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function TrainingBookingDialog({ open, onOpenChange, clubId, mode = "book", appointmentId, onDone }: Props) {
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);

  const load = useCallback(async () => {
    if (!clubId) return;
    setLoading(true); setError(null); setDone(null); setSelectedDate(null); setSelectedSlot(null);
    try {
      const a = await getTrainingAvailability(clubId);
      const d = a?.days || [];
      setDays(d);
      if (d.length) setSelectedDate(d[0].date);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Could not load available slots.");
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const currentDay = days.find((d) => d.date === selectedDate);
  // `allSlots` carries every slot with its status; older responses only had the open `slots`.
  const slotsForDay: { time: string; isOpen: boolean; status: string; reason?: string }[] =
    currentDay?.allSlots?.length
      ? currentDay.allSlots
      : (currentDay?.slots || []).map((t: string) => ({ time: t, isOpen: true, status: "open" }));

  async function confirm() {
    if (!selectedDate || !selectedSlot) return;
    setBusy(true); setError(null);
    const slotStart = `${selectedDate}T${selectedSlot}`;
    try {
      const res = mode === "reschedule" && appointmentId
        ? await rescheduleTrainingAppointment(appointmentId, { slotStart })
        : await bookTrainingAppointment({ clubId, slotStart });
      if (res.isSuccess) { setDone(res.appointment || {}); onDone?.(); }
      else setError(res.message || "Could not complete the booking.");
    } catch (e: any) {
      setError(e?.response?.data?.message || "Could not complete the booking.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "reschedule" ? "Reschedule Training" : "Request a Training Date"}</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="py-4 text-center space-y-3">
            <div className="text-3xl">📅</div>
            <div className="font-semibold text-slate-800">{mode === "reschedule" ? "Training rescheduled" : "Training booked!"}</div>
            {done.slotStart && (
              <p className="text-sm text-slate-600">{new Date(done.slotStart).toLocaleString(appLocale(), { dateStyle: "full", timeStyle: "short", timeZone: appTimeZone() })} ({appTimeZone()})</p>
            )}
            {done.zoomJoinUrl ? (
              <a href={done.zoomJoinUrl} target="_blank" rel="noreferrer" className="inline-block text-[#003DA5] font-semibold hover:underline break-all">Join Zoom meeting →</a>
            ) : (
              <p className="text-xs text-slate-500">Your Zoom link will be shared shortly by email.</p>
            )}
            <div>
              <button onClick={() => onOpenChange(false)} className="mt-2 px-5 py-2 rounded-lg bg-[#003DA5] text-white text-sm font-medium">Done</button>
            </div>
          </div>
        ) : loading ? (
          <div className="py-10 text-center text-sm text-slate-500">Loading available slots…</div>
        ) : error && days.length === 0 ? (
          <div className="py-8 text-center text-sm text-red-600">{error}</div>
        ) : days.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">No open slots in the next few weeks. Please check back later.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4 py-2">
            <div className="max-h-80 overflow-y-auto pr-1 space-y-1">
              {days.map((d) => {
                const closed = d.isClosed || (d.slots?.length ?? 0) === 0;
                return (
                  <button
                    key={d.date}
                    disabled={closed}
                    title={closed ? (d.closedReason || "Not available") : undefined}
                    onClick={() => { setSelectedDate(d.date); setSelectedSlot(null); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm border ${
                      selectedDate === d.date
                        ? "bg-[#003DA5] text-white border-[#003DA5]"
                        : closed
                        ? "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed line-through decoration-slate-300"
                        : "bg-white border-slate-200 hover:border-[#003DA5]/40"
                    }`}
                  >
                    {d.dayLabel}
                    {closed ? (
                      <span className={`ml-1 text-xs ${selectedDate === d.date ? "text-white/70" : "text-slate-400"}`}>
                        ({d.closedReason || "Not available"})
                      </span>
                    ) : (
                      <span className={`ml-1 text-xs ${selectedDate === d.date ? "text-white/70" : "text-slate-400"}`}>({d.slots.length})</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-2">
                Select a 30-minute slot ({appTimeZone()}). Greyed-out times are already booked or blocked by the training team.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {slotsForDay.map((sl) => (
                  <button
                    key={sl.time}
                    disabled={!sl.isOpen}
                    title={sl.isOpen ? undefined : sl.reason || "Not available"}
                    onClick={() => setSelectedSlot(sl.time)}
                    className={`px-2 py-2 rounded-lg text-sm border ${
                      selectedSlot === sl.time
                        ? "bg-[#003DA5] text-white border-[#003DA5]"
                        : !sl.isOpen
                        ? "bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed"
                        : "bg-white border-slate-200 hover:border-[#003DA5]/40"
                    }`}
                  >
                    <span className={sl.isOpen ? "" : "line-through decoration-slate-300"}>{to12h(sl.time)}</span>
                    {!sl.isOpen && (
                      <span className="block text-[10px] leading-tight text-slate-400">
                        {sl.status === "booked" ? "Booked" : sl.status === "dayFull" ? "Day full" : "Not available"}
                      </span>
                    )}
                  </button>
                ))}
                {slotsForDay.length === 0 && (
                  <p className="col-span-full text-sm text-slate-400 py-4">
                    {currentDay?.closedReason || "The training team is not available on this day."}
                  </p>
                )}
              </div>
              {error && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-2">{error}</div>}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => onOpenChange(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm">Cancel</button>
                <button disabled={!selectedSlot || busy} onClick={confirm}
                  className="px-5 py-2 rounded-lg bg-[#003DA5] text-white text-sm font-medium disabled:opacity-50">
                  {busy ? "Please wait…" : mode === "reschedule" ? "Reschedule" : "Confirm booking"}
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

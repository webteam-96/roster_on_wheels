"use client";

/**
 * "Website Training" card for the club-admin My Club Website tab. Shown only when the club has an
 * active subscription. Lets the admin request a training date (Calendly-style dialog) and shows
 * the next upcoming session with its Zoom link + a reschedule option.
 */

import { useCallback, useEffect, useState } from "react";
import { Calendar, Video } from "lucide-react";
import { getClubTrainingAppointments } from "@/services/api";
import TrainingBookingDialog from "./TrainingBookingDialog";

export default function ClubTrainingSection({ clubId, active }: { clubId: number; active: boolean }) {
  const [appts, setAppts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [rescheduleId, setRescheduleId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!clubId || !active) return;
    try { setAppts((await getClubTrainingAppointments(clubId)) || []); } catch { setAppts([]); }
  }, [clubId, active]);

  useEffect(() => { load(); }, [load]);

  if (!active) return null;

  const upcoming = appts[0]; // service returns upcoming sessions ascending

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#003DA5]/10 text-[#003DA5]"><Calendar size={20} /></div>
          <div>
            <h2 className="text-base font-semibold text-slate-800">Website Training</h2>
            <p className="text-xs text-slate-500 mt-0.5">Book a free 30-minute session with our team to learn to manage your website.</p>
          </div>
        </div>
        <button
          onClick={() => { setRescheduleId(null); setOpen(true); }}
          className="inline-flex items-center gap-2 rounded-lg bg-[#003DA5] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#00308a]"
        >
          <Calendar size={16} /> Request a Training Date
        </button>
      </div>

      {upcoming && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 flex items-start justify-between gap-4 flex-wrap">
          <div className="text-sm">
            <div className="font-semibold text-slate-800">Upcoming session</div>
            <div className="text-slate-600 mt-0.5">{new Date(upcoming.slotStart).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })} (IST)</div>
            {upcoming.zoomJoinUrl && (
              <a href={upcoming.zoomJoinUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[#003DA5] font-medium hover:underline">
                <Video size={14} /> Join Zoom
              </a>
            )}
          </div>
          <button
            onClick={() => { setRescheduleId(upcoming.id); setOpen(true); }}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-white"
          >
            Reschedule
          </button>
        </div>
      )}

      <TrainingBookingDialog
        open={open}
        onOpenChange={setOpen}
        clubId={clubId}
        mode={rescheduleId ? "reschedule" : "book"}
        appointmentId={rescheduleId ?? undefined}
        onDone={load}
      />
    </div>
  );
}

"use client";

/**
 * SuperAdmin view of all website-training appointments (Settings → Club Websites tab).
 * Lists every appointment with its Zoom link + reschedule action (reuses the booking dialog).
 */

import { useCallback, useEffect, useState } from "react";
import { Video, RefreshCw } from "lucide-react";
import { getAllTrainingAppointments } from "@/services/api";
import TrainingBookingDialog from "@/components/training/TrainingBookingDialog";

import { appLocale, appTimeZone } from "@/lib/appFormat";
export default function WebsiteTrainingAppointmentsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [resc, setResc] = useState<{ id: number; clubId: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await getAllTrainingAppointments()) || []); }
    catch { setRows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = (s?: string) => (s ? new Date(s).toLocaleString(appLocale(), { dateStyle: "medium", timeStyle: "short" }) : "—");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Website Training Appointments</h2>
          <p className="text-sm text-slate-500">All booked training sessions with their Zoom links.</p>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Club</th>
              <th className="text-left px-4 py-2.5 font-medium">Date &amp; time ({appTimeZone()})</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 font-medium">Booked by</th>
              <th className="text-left px-4 py-2.5 font-medium">Zoom</th>
              <th className="text-right px-4 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No training appointments yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/50">
                <td className="px-4 py-2.5 font-medium text-slate-800">{r.clubName}</td>
                <td className="px-4 py-2.5 text-slate-600">{fmt(r.slotStart)}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${r.status === "Cancelled" ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>{r.status}</span>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{r.bookedByName || "—"}</td>
                <td className="px-4 py-2.5">
                  {r.zoomJoinUrl ? (
                    <a href={r.zoomJoinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#003DA5] hover:underline">
                      <Video size={14} /> Join
                    </a>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => setResc({ id: r.id, clubId: r.clubId })}
                    className="rounded-lg border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">Reschedule</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resc && (
        <TrainingBookingDialog
          open={!!resc}
          onOpenChange={(o) => { if (!o) setResc(null); }}
          clubId={resc.clubId}
          mode="reschedule"
          appointmentId={resc.id}
          onDone={load}
        />
      )}
    </div>
  );
}

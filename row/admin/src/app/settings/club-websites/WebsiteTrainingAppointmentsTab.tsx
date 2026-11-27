"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/**
 * SuperAdmin view of all website-training appointments (Settings → Club Websites tab).
 * Lists every appointment with its Zoom link + reschedule action (reuses the booking dialog).
 */

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useState } from "react";
import { Video, RefreshCw } from "@/components/icons";
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

  const fmt = (s?: string) => (s ? new Date(s).toLocaleString(appLocale(), { dateStyle: "medium", timeStyle: "short" }) : "–");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="row-h2">Website Training Appointments</h2>
          <p className="text-sm text-slate-500">All booked training sessions with their Zoom links.</p>
        </div>
        <Button onClick={load} variant="outline" size="sm">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      <Card className="overflow-x-auto">
        <Table className="w-full text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="text-left px-4">Club</TableHead>
              <TableHead className="text-left px-4">Date &amp; time ({appTimeZone()})</TableHead>
              <TableHead className="text-left px-4">Status</TableHead>
              <TableHead className="text-left px-4">Booked by</TableHead>
              <TableHead className="text-left px-4">Zoom</TableHead>
              <TableHead className="text-right px-4">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-100">
            {loading ? (
              <TableRow><TableCell colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="px-4 py-8 text-center text-slate-400">No training appointments yet.</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id} className="hover:bg-slate-50/50">
                <TableCell className="px-4 py-2.5 font-medium text-slate-800">{r.clubName}</TableCell>
                <TableCell className="px-4 py-2.5 text-slate-600">{fmt(r.slotStart)}</TableCell>
                <TableCell className="px-4 py-2.5">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${r.status === "Cancelled" ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-emerald-700"}`}>{r.status}</span>
                </TableCell>
                <TableCell className="px-4 py-2.5 text-slate-600">{r.bookedByName || "–"}</TableCell>
                <TableCell className="px-4 py-2.5">
                  {r.zoomJoinUrl ? (
                    <a href={r.zoomJoinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-azure hover:underline">
                      <Video size={14} /> Join
                    </a>
                  ) : <span className="text-slate-400">–</span>}
                </TableCell>
                <TableCell className="px-4 py-2.5 text-right">
                  <Button onClick={() => setResc({ id: r.id, clubId: r.clubId })}
                    variant="outline" size="sm">Reschedule</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

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

"use client";

/**
 * Read-only attendance detail, in a dialog.
 *
 * The V2 attendance route has an /edit page but no detail page, so before this
 * a row could only be opened by editing it. Once Edit is hidden for a year the
 * member does not administer, the row had no way in at all.
 *
 * A dialog rather than a page because attendance is reached from the
 * E-Governance tab shell, and navigating away loses the year selector and the
 * tab you were on.
 */

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAttendance } from "@/services/api";
import type { AttendanceDetail } from "@/types/attendance";
import { formatDMY } from "@/lib/dateUtils";
import { Loader2 } from "@/components/icons";

interface Props {
  open: boolean;
  clubId: number;
  attendanceId: number | null;
  /** Shown in the header until the record loads. */
  fallbackTitle?: string;
  onClose: () => void;
}

export default function AttendanceViewDialog({
  open, clubId, attendanceId, fallbackTitle, onClose,
}: Props) {
  const [data, setData] = useState<AttendanceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !attendanceId) return;
    let cancelled = false;
    setLoading(true); setError(null); setData(null);

    getAttendance(clubId, attendanceId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e as { response?: { data?: { message?: string } | string } };
        const msg = typeof err?.response?.data === "string"
          ? err.response.data
          : err?.response?.data?.message;
        setError(msg || "Could not load this attendance record.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [open, clubId, attendanceId]);

  // Each attendee group is its own list on the DTO. Only non-empty ones render —
  // six empty headings would bury the one group that has people in it.
  const groups: [string, string[]][] = data
    ? ([
        ["Members",   data.members.map((m) => m.memberName)],
        ["Anns",      data.anns.map((a) => a.annName)],
        ["Annets",    data.annets.map((a) => a.annetName)],
        ["Visitors",  data.visitors.map((v) => v.invitedBy ? `${v.visitorName} (by ${v.invitedBy})` : v.visitorName)],
        // Both of these carry the name on `rotarianName`; a delegate is a
        // visiting Rotarian with a district designation, not a separate field.
        ["Rotarians", data.rotarians.map((r) => r.clubName ? `${r.rotarianName} (${r.clubName})` : r.rotarianName)],
        ["Delegates", data.delegates.map((d) => d.districtDesignation ? `${d.rotarianName}, ${d.districtDesignation}` : d.rotarianName)],
      ] as [string, string[]][]).filter(([, list]) => list.length > 0)
    : [];

  const total = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{data?.eventName || fallbackTitle || "Attendance"}</DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {data && (
          <div className="space-y-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <div className="flex flex-col">
                <dt className="text-xs uppercase tracking-wide text-slate-400">Date</dt>
                <dd className="text-sm text-slate-800">
                  {data.eventDateTime ? formatDMY(data.eventDateTime) : "-"}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs uppercase tracking-wide text-slate-400">Total present</dt>
                <dd className="text-sm text-slate-800">{total.toLocaleString("en-IN")}</dd>
              </div>
            </dl>

            {data.description && (
              <p className="whitespace-pre-wrap text-sm text-slate-700">{data.description}</p>
            )}

            {groups.map(([label, list]) => (
              <div key={label}>
                <p className="mb-1.5 text-xs uppercase tracking-wide text-slate-400">
                  {label} ({list.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((name, i) => (
                    <span
                      key={`${label}-${i}`}
                      className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ))}

            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground">No attendees were recorded.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

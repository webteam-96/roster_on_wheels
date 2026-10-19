"use client";

/**
 * PphCampDetailModal — read-only detail popup for a PPH Camp.
 *
 * A camp is NOT a project: it lives in its own table with its own fields (date, address, logo,
 * attendance count, active flag) and has no cost, beneficiaries, photos or approval. Sending a camp
 * id to the project detail endpoint is what produced "Project not found" (user 2026-10-05), so the
 * camp gets its own popup, fed by the club's camp list.
 */

import { useEffect, useState } from "react";
import { getPphCamps, getPhotoUrl } from "@/services/api";
import type { PphCamp } from "@/types/pphCamp";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import RotaryLoader from "@/components/RotaryLoader";
import { CalendarDays, MapPin, Users } from "@/components/icons";

import { appLocale } from "@/lib/appFormat";
function fmtDate(d?: string | null) {
  if (!d) return "–";
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? "–"
    : dt.toLocaleDateString(appLocale(), { day: "2-digit", month: "short", year: "numeric" });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "" || value === "–") return null;
  return (
    <div className="text-sm">
      <span className="text-slate-500">{label}: </span>
      <span className="text-slate-800 font-medium">{value}</span>
    </div>
  );
}

export default function PphCampDetailModal({
  clubId,
  campId,
  onClose,
}: {
  clubId: number;
  campId: number | null;
  onClose: () => void;
}) {
  const [camp, setCamp] = useState<PphCamp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campId) { setCamp(null); return; }
    let cancelled = false;
    setLoading(true); setError(null); setCamp(null);
    // There is no single-camp endpoint; the club's list is small and already cached by the browser.
    getPphCamps(clubId)
      .then((all) => {
        if (cancelled) return;
        const found = all.find((c) => c.id === campId) ?? null;
        if (!found) setError("Camp not found.");
        setCamp(found);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e as { response?: { data?: { message?: string } } };
        setError(err?.response?.data?.message || "Failed to load camp details.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clubId, campId]);

  return (
    <Dialog open={!!campId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{camp?.title || "Camp Details"}</DialogTitle>
          <DialogDescription className="sr-only">PPH camp detail</DialogDescription>
        </DialogHeader>

        {loading && <div className="flex justify-center py-16"><RotaryLoader size="lg" /></div>}
        {error && !loading && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        {camp && !loading && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${camp.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {camp.isActive ? "Active" : "Inactive"}
              </span>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">PPH Camp</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              <div className="flex items-center gap-1.5 text-sm">
                <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                <Row label="Date" value={fmtDate(camp.campDate)} />
              </div>
              {camp.address && (
                <div className="flex items-center gap-1.5 text-sm">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  <Row label="Address" value={camp.address} />
                </div>
              )}
            </div>

            {camp.description && (
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Description</div>
                <p className="text-sm text-slate-700 whitespace-pre-line">{camp.description}</p>
              </div>
            )}

            {/* Date and address are already in the two rows above - only the attendee count is new,
                so there is one tile and no repetition (user 2026-10-05). */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                <Users className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">Attendees</div>
                  <div className="text-sm font-semibold text-slate-800">{camp.attendanceCount}</div>
                </div>
              </div>
            </div>

            {camp.campLogoPath && (
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Camp Image</div>
                <div className="rounded-lg overflow-hidden border border-slate-200 inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={getPhotoUrl(camp.campLogoPath)} alt={camp.title} className="max-h-40 max-w-full object-contain" />
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

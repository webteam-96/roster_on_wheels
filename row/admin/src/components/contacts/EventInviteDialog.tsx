"use client";

// Event invite list: turns an upcoming event into a mass email draft addressed to contact groups. The admin reviews
// and sends it from Mass Email, where credits and delivery are handled.

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getDistrictUpcomingEvents, getUpcomingEvents, inviteContactsToEvent,
  type ContactGroup, type ContactScope,
} from "@/services/api";
import { errorText } from "@/lib/contacts";
import { fmtDate } from "@/components/dashboard/formatters";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "@/components/icons";

interface EventOption { id: number; title: string; eventDate: string }

interface Props {
  open: boolean;
  onClose: () => void;
  scope: ContactScope;
  ownerId: number;
  groups: ContactGroup[];
  onDone: (message: string) => void;
}

export default function EventInviteDialog({ open, onClose, scope, ownerId, groups, onDone }: Props) {
  const [events, setEvents] = useState<EventOption[] | null>(null);
  const [eventId, setEventId] = useState(0);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setEvents(null); setEventId(0); setPicked([]); setError(null); setDraftId(null);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    (scope === "clubs" ? getUpcomingEvents(ownerId, 1, 100) : getDistrictUpcomingEvents(ownerId, 1, 100))
      .then((r: { items?: EventOption[] }) => setEvents((r.items ?? [])
        .filter((e) => new Date(e.eventDate) >= today)
        .sort((a, b) => a.eventDate.localeCompare(b.eventDate))))
      .catch(() => setEvents([]));
  }, [open, scope, ownerId]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try { setDraftId((await inviteContactsToEvent(scope, ownerId, eventId, picked)).massEmailId); }
    catch (e) { setError(errorText(e, "Could not create the invitation.")); }
    finally { setBusy(false); }
  };

  const massEmailHref = scope === "clubs" ? "/club-admin-dashboard/communication?tab=massemail" : "/district-admin-dashboard/quick-links/mass-email";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Invite contacts to an event</DialogTitle></DialogHeader>
        {draftId ? (
          <div className="space-y-3 text-sm text-slate-700">
            <p>The invitation is saved as a mass email draft. Check it and send it from Mass Email.</p>
            <Link href={massEmailHref} className="inline-flex h-9 items-center rounded-md bg-azure px-4 font-medium text-white hover:bg-mint-ink">
              Open Mass Email
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-700">Event</p>
              {events === null ? <Skeleton className="h-9 w-full" /> : events.length === 0 ? (
                <p className="text-sm text-slate-500">No upcoming events. Add one under Communication, Upcoming Events.</p>
              ) : (
                <select aria-label="Event" value={eventId} onChange={(e) => setEventId(Number(e.target.value))}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value={0}>Pick an event</option>
                  {events.map((e) => <option key={e.id} value={e.id}>{e.title} ({fmtDate(e.eventDate)})</option>)}
                </select>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-700">Contact groups</p>
              {groups.length === 0 ? <p className="text-sm text-slate-500">Add a contact group first.</p> : (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={picked.includes(g.id)}
                        onCheckedChange={(on) => setPicked((p) => (on ? [...p, g.id] : p.filter((x) => x !== g.id)))} />
                      {g.name} <span className="text-xs text-slate-400">({g.contactCount})</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {error && <p className="text-sm text-rose-700">{error}</p>}
          </div>
        )}
        <DialogFooter>
          {draftId ? (
            <Button variant="outline" onClick={() => onDone("The invitation draft is in Mass Email.")}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button className="bg-azure text-white hover:bg-mint-ink" disabled={!eventId || picked.length === 0 || busy} onClick={create}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create invitation
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

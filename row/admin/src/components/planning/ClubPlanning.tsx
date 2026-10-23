"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import { eventDateTime, inYear } from "@/lib/planning";
import {
  createBoardDirector, createUpcomingEvent, deleteBoardDirector, deleteUpcomingEvent, getBoardOfDirectors, getDesignations,
  getUpcomingEvents, searchBoardMembers,
} from "@/services/api";
import type { BoardDirector, Designation } from "@/types/boardDirector";
import type { UpcomingEventListItem } from "@/types/upcomingEvent";
import MemberPicker, { type MemberOption } from "./MemberPicker";
import type { PlanningYear } from "./NextYearDistrict";
import { errorMessage, Section } from "./PlanningParts";

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

/** A club's next year for its president-elect and secretary-elect: officers (committee chairs are officers too) and
 *  the club calendar, on the existing endpoints. The API allows the planning year only. */
export default function ClubPlanning({ clubId, year, onError }: { clubId: number; year: PlanningYear; onError: (m: string) => void }) {
  return (
    <>
      <Officers clubId={clubId} year={year} onError={onError} />
      <ClubCalendar clubId={clubId} year={year} onError={onError} />
    </>
  );
}

function Officers({ clubId, year, onError }: { clubId: number; year: PlanningYear; onError: (m: string) => void }) {
  const [officers, setOfficers] = useState<BoardDirector[] | null>(null);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [member, setMember] = useState<MemberOption | null>(null);
  const [designationId, setDesignationId] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getBoardOfDirectors(clubId, year.id).then(setOfficers).catch(() => setOfficers([]));
  }, [clubId, year.id]);
  useEffect(load, [load]);
  useEffect(() => { getDesignations().then(setDesignations).catch(() => setDesignations([])); }, []);

  const search = useCallback(async (q: string): Promise<MemberOption[]> =>
    (await searchBoardMembers(clubId, q)).map((m) => ({ id: m.id, name: m.memberName })), [clubId]);

  async function add() {
    if (!member || !designationId) return;
    setBusy(true);
    try {
      await createBoardDirector(clubId, {
        memberId: member.id, nonMemberName: null, nonMemberMobile: null, nonMemberEmail: null,
        designationId, customDesignation: null, yearId: year.id,
      });
      setMember(null);
      setDesignationId(0);
      load();
    } catch (err) {
      onError(errorMessage(err, "Could not add the officer."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    try {
      await deleteBoardDirector(clubId, id);
      load();
    } catch (err) {
      onError(errorMessage(err, "Could not remove the officer."));
    }
  }

  return (
    <Section title={`Officers ${year.label}`} hint="Next year's board and committee chairs. President, secretary, treasurer, executive secretary, membership and foundation chairs go to RI at cut-over.">
      {officers === null ? <Skeleton className="h-20 w-full" /> : officers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No officers for {year.label} yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {officers.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 py-2">
              <span>{o.designationName}: {o.memberName}</span>
              <Button size="sm" variant="ghost" aria-label={`Remove ${o.memberName}`} onClick={() => remove(o.id)}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="officer-member">Member</Label>
          <MemberPicker id="officer-member" search={search} value={member} onChange={setMember} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="officer-designation">Role</Label>
          <select id="officer-designation" className={SELECT} value={designationId} onChange={(e) => setDesignationId(Number(e.target.value))}>
            <option value={0}>Choose a role</option>
            {designations.map((d) => <option key={d.id} value={d.id}>{d.designationName}</option>)}
          </select>
        </div>
        <Button onClick={add} disabled={!member || !designationId || busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add officer</Button>
      </div>
    </Section>
  );
}

function ClubCalendar({ clubId, year, onError }: { clubId: number; year: PlanningYear; onError: (m: string) => void }) {
  const fmt = useFormat();
  const [events, setEvents] = useState<UpcomingEventListItem[] | null>(null);
  const [form, setForm] = useState({ title: "", day: "", venue: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    // shortcut: the 100 latest club events, filtered to the planning year
    getUpcomingEvents(clubId, 1, 100)
      .then((r) => setEvents(r.items.filter((e) => inYear(e.eventDate, year.start, year.end))))
      .catch(() => setEvents([]));
  }, [clubId, year.start, year.end]);
  useEffect(load, [load]);

  async function add() {
    setBusy(true);
    try {
      await createUpcomingEvent(clubId, {
        title: form.title.trim(), description: null, imagePath: null, eventDate: eventDateTime(form.day),
        publishDate: eventDateTime((year.start ?? form.day).slice(0, 10), "00:00"), expiryDate: eventDateTime(form.day, "23:59"),
        eventVenue: form.venue.trim() || null, registrationLink: null, isSendEmail: false, isRepeatNotification: false, reminders: null,
      });
      setForm({ title: "", day: "", venue: "" });
      load();
    } catch (err) {
      onError(errorMessage(err, "Could not add the event."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    try {
      await deleteUpcomingEvent(clubId, id);
      load();
    } catch (err) {
      onError(errorMessage(err, "Could not delete the event."));
    }
  }

  const valid = form.title.trim() && inYear(form.day, year.start, year.end);
  return (
    <Section title={`Club calendar ${year.label}`} hint="Next year's club events. They show to members from the start of the year.">
      {events === null ? <Skeleton className="h-16 w-full" /> : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No club events in {year.label} yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 py-2">
              <span>{fmt.date(e.eventDate, "long")}: {e.title}{e.eventVenue ? <span className="text-muted-foreground">, {e.eventVenue}</span> : null}</span>
              <Button size="sm" variant="ghost" aria-label={`Delete ${e.title}`} onClick={() => remove(e.id)}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="c-event-title">Event</Label>
          <Input id="c-event-title" maxLength={50} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Installation" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="c-event-day">Date</Label>
          <Input id="c-event-day" type="date" min={year.start?.slice(0, 10)} max={year.end?.slice(0, 10)} value={form.day}
            onChange={(e) => setForm({ ...form, day: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="c-event-venue">Venue</Label>
          <Input id="c-event-venue" maxLength={255} value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
        </div>
        <Button onClick={add} disabled={!valid || busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add event</Button>
      </div>
    </Section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import { eventDateTime, inYear } from "@/lib/planning";
import {
  createCommitteeGroup, createDistrictUpcomingEvent, createGroupMember, deleteCommitteeGroup, deleteDistrictUpcomingEvent,
  getAGs, getCommitteeGroups, getDistrictUpcomingEvents, saveAG, saveDistrictMembershipGoal,
} from "@/services/api";
import type { PlanningClub } from "@/types/planning";
import MemberPicker, { type MemberOption } from "./MemberPicker";
import { errorMessage, Section } from "./PlanningParts";

export interface PlanningYear { id: number; label: string; start: string | null; end: string | null }

interface Props {
  districtId: number;
  year: PlanningYear;
  clubs: PlanningClub[];
  search: (q: string) => Promise<MemberOption[]>;
  onChanged: () => void;
  onError: (message: string) => void;
}

/** Next year's district records on the existing endpoints: committees and their chairs, AGs, calendar, goal. Everyone
 *  who may open the district's planning may plan next year; the API's planning rules decide each write. */
export default function NextYearDistrict(props: Props) {
  return (
    <>
      <Committees {...props} />
      <Ags {...props} />
      <Calendar {...props} />
      <Goal {...props} />
    </>
  );
}

interface Group { id: number; groupName: string; memberCount: number }

function Committees({ districtId, year, search, onChanged, onError }: Props) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [name, setName] = useState("");
  const [chairFor, setChairFor] = useState<number | null>(null);
  const [chair, setChair] = useState<MemberOption | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    // shortcut: the first 100 committees of the year, enough for one district
    getCommitteeGroups(districtId, year.id, 1, 100).then((r) => setGroups(r.items ?? [])).catch(() => setGroups([]));
  }, [districtId, year.id]);
  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    try {
      await action();
      load();
      onChanged();
    } catch (err) {
      onError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={`Committees ${year.label}`} hint="Next year's district committees and their chairs.">
      {groups === null ? <Skeleton className="h-20 w-full" /> : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No committees for {year.label} yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {groups.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{g.groupName} <span className="text-muted-foreground">({g.memberCount} members)</span></span>
              <span className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setChairFor(g.id); setChair(null); }}>Add chair</Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${g.groupName}`} disabled={busy}
                  onClick={() => run(() => deleteCommitteeGroup(districtId, g.id), "Could not delete the committee.")}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {chairFor && (
        <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="chair">Chair of {groups?.find((g) => g.id === chairFor)?.groupName}</Label>
            <MemberPicker id="chair" search={search} value={chair} onChange={setChair} />
          </div>
          <Button disabled={!chair || busy} onClick={() => run(async () => {
            await createGroupMember(districtId, chairFor, { memberId: chair!.id, isMember: true, name: chair!.name, clubId: chair!.clubId, districtDesignation: "Chair" });
            setChairFor(null);
          }, "Could not add the chair.")}>Add chair</Button>
          <Button variant="outline" onClick={() => setChairFor(null)}>Cancel</Button>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1 space-y-2">
          <Label htmlFor="committee-name">New committee</Label>
          <Input id="committee-name" maxLength={300} value={name} onChange={(e) => setName(e.target.value)} placeholder="Membership committee" />
        </div>
        <Button disabled={!name.trim() || busy} onClick={() => run(async () => {
          await createCommitteeGroup(districtId, { yearId: year.id, groupName: name.trim() });
          setName("");
        }, "Could not add the committee.")}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add committee</Button>
      </div>
    </Section>
  );
}

interface Ag { id: number; memberId: number; memberName: string; clubName: string }

function Ags({ districtId, year, clubs, search, onChanged, onError }: Props) {
  const [ags, setAgs] = useState<Ag[] | null>(null);
  const [member, setMember] = useState<MemberOption | null>(null);
  const [clubIds, setClubIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getAGs(districtId, year.id).then((r) => setAgs(r ?? [])).catch(() => setAgs([]));
  }, [districtId, year.id]);
  useEffect(load, [load]);

  async function appoint() {
    if (!member || clubIds.length === 0) return;
    setBusy(true);
    try {
      await saveAG(districtId, { memberId: member.id, clubIds, yearId: year.id });
      setMember(null);
      setClubIds([]);
      load();
      onChanged();
    } catch (err) {
      onError(errorMessage(err, "Could not appoint the AG."));
    } finally {
      setBusy(false);
    }
  }

  const taken = new Set((ags ?? []).map((a) => a.clubName));
  return (
    <Section title={`Assistant governors ${year.label}`} hint="Each AG looks after a group of clubs. A next-year AG works on those clubs from 1 July.">
      {ags === null ? <Skeleton className="h-16 w-full" /> : ags.length === 0 ? (
        <p className="text-sm text-muted-foreground">No AGs for {year.label} yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {ags.map((a) => <li key={a.id} className="py-2">{a.memberName} <span className="text-muted-foreground">{a.clubName}</span></li>)}
        </ul>
      )}
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="ag-member">New AG</Label>
          <MemberPicker id="ag-member" search={search} value={member} onChange={setMember} />
        </div>
        {member && (
          <fieldset className="grid max-h-56 gap-2 overflow-y-auto rounded-md border p-3 text-sm sm:grid-cols-2">
            <legend className="px-1 text-muted-foreground">Clubs</legend>
            {clubs.filter((c) => !taken.has(c.clubName)).map((c) => (
              <label key={c.clubId} className="flex items-center gap-2">
                <Checkbox checked={clubIds.includes(c.clubId)}
                  onCheckedChange={(v) => setClubIds((ids) => v === true ? [...ids, c.clubId] : ids.filter((x) => x !== c.clubId))} />
                {c.clubName}
              </label>
            ))}
          </fieldset>
        )}
        <Button onClick={appoint} disabled={!member || clubIds.length === 0 || busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Appoint AG</Button>
      </div>
    </Section>
  );
}

interface CalendarEvent { id: number; title: string; eventDate: string; eventVenue: string | null }

function Calendar({ districtId, year, onChanged, onError }: Props) {
  const fmt = useFormat();
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [form, setForm] = useState({ title: "", day: "", venue: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    // shortcut: the 100 latest district events, filtered to the planning year
    getDistrictUpcomingEvents(districtId, 1, 100)
      .then((r) => setEvents(((r.items ?? []) as CalendarEvent[]).filter((e) => inYear(e.eventDate, year.start, year.end))))
      .catch(() => setEvents([]));
  }, [districtId, year.start, year.end]);
  useEffect(load, [load]);

  async function add() {
    setBusy(true);
    try {
      const when = eventDateTime(form.day);
      // published from the start of the planning year; no email: members are told when the year opens
      await createDistrictUpcomingEvent(districtId, {
        title: form.title.trim(), description: null, imagePath: null, eventDate: when,
        publishDate: eventDateTime((year.start ?? form.day).slice(0, 10), "00:00"), expiryDate: eventDateTime(form.day, "23:59"),
        eventVenue: form.venue.trim() || null, registrationLink: null, isSendEmail: false, isRepeatNotification: false, reminders: null,
      });
      setForm({ title: "", day: "", venue: "" });
      load();
      onChanged();
    } catch (err) {
      onError(errorMessage(err, "Could not add the event."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    try {
      await deleteDistrictUpcomingEvent(districtId, id);
      load();
      onChanged();
    } catch (err) {
      onError(errorMessage(err, "Could not delete the event."));
    }
  }

  const valid = form.title.trim() && inYear(form.day, year.start, year.end);
  return (
    <Section title={`District calendar ${year.label}`} hint="Name the training seminars PETS and SETS so the launchpad finds them.">
      {events === null ? <Skeleton className="h-16 w-full" /> : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No district events in {year.label} yet.</p>
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
          <Label htmlFor="d-event-title">Event</Label>
          <Input id="d-event-title" maxLength={50} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="PETS" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-event-day">Date</Label>
          <Input id="d-event-day" type="date" min={year.start?.slice(0, 10)} max={year.end?.slice(0, 10)} value={form.day}
            onChange={(e) => setForm({ ...form, day: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="d-event-venue">Venue</Label>
          <Input id="d-event-venue" maxLength={255} value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
        </div>
        <Button onClick={add} disabled={!valid || busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add event</Button>
      </div>
    </Section>
  );
}

// shortcut: the form does not show the saved goal (reading it is for district admins); the launchpad says whether
// one is saved. Prefill it when elect roles get read access to the goal endpoint.
function Goal({ districtId, year, onChanged, onError }: Props) {
  const [goal, setGoal] = useState({ targetTotal: "", targetNewMembers: "", targetRetentionPercent: "" });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await saveDistrictMembershipGoal({
        fkDistrictId: districtId, fkYearId: year.id, targetTotal: Number(goal.targetTotal),
        targetNewMembers: Number(goal.targetNewMembers), targetRetentionPercent: Number(goal.targetRetentionPercent),
      });
      onChanged();
    } catch (err) {
      onError(errorMessage(err, "Could not save the goal."));
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof typeof goal, label: string, max?: number) => (
    <div className="space-y-2">
      <Label htmlFor={`goal-${k}`}>{label}</Label>
      <Input id={`goal-${k}`} type="number" min={0} max={max} value={goal[k]} onChange={(e) => setGoal({ ...goal, [k]: e.target.value })} />
    </div>
  );
  return (
    <Section title={`Membership goal ${year.label}`} hint="The district's membership target for next year. Saving it again replaces it.">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        {field("targetTotal", "Members at year end")}
        {field("targetNewMembers", "New members")}
        {field("targetRetentionPercent", "Retention (%)", 100)}
        <Button onClick={save} disabled={busy || goal.targetTotal === ""}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save goal</Button>
      </div>
    </Section>
  );
}

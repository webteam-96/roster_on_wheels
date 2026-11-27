"use client";

/**
 * Club Admin Dashboard › Speakers and meeting duties (flagged module "volunteers"). Speakers are scheduled to a
 * meeting date: the coming ones marked for the website show on the club website, and the bulletin reads the list.
 * Meeting duties go to members, who get a reminder two days before the meeting.
 */

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/row/AppKit";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Plus, Save, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ErrorAlert from "@/components/ErrorAlert";
import { TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useFormat, useToday } from "@/hooks/useFormat";
import {
  addMeetingDuty, deleteMeetingDuty, deleteSpeaker, getClubMembersForAttendance, getMeetingDuties, getSpeakers, saveSpeaker,
  shareSpeakerToBureau, uploadSpeakerPhoto,
} from "@/services/api";
import type { ClubMemberSimple } from "@/types/attendance";
import type { MeetingDuty, SaveSpeaker, Speaker } from "@/types/volunteers";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const SELECT = "row-field w-full";
const DUTIES = ["Greeter", "Sergeant at arms", "Grace", "Thought for the day", "Vote of thanks", "Introducing the speaker"];
const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;
const orNull = (v: string | null) => v?.trim() || null;
const blank = (): SaveSpeaker => ({ meetingDate: "", name: "", topic: null, bio: null, email: null, phone: null, showOnWebsite: true });

export default function SpeakersPage() {
  const { selectedClubId: clubId } = useAuth();
  const [error, setError] = useState<string | null>(null);

  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  return (
    <div className="space-y-8">
      <PageHeader title="Speakers and meeting duties" description="Schedule the speakers for your meetings and give members their meeting duties. Coming speakers marked for the website show on your club website; members get a reminder of their duty two days before the meeting." />
      <SpeakersSection clubId={clubId} onError={setError} />
      <DutiesSection clubId={clubId} onError={setError} />
      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

function SpeakersSection({ clubId, onError }: { clubId: number; onError: (m: string) => void }) {
  const fmt = useFormat();
  const today = useToday();
  const [list, setList] = useState<Speaker[] | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<SaveSpeaker>(blank);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setList(null);
    getSpeakers(clubId, showPast ? {} : { from: today })
      .then(setList)
      .catch((err) => onError(message(err, "Could not load the speakers.")));
  }, [clubId, showPast, today, onError]);
  useEffect(() => { load(); }, [load]);

  const reset = () => {
    setEditing(null);
    setForm(blank());
    setPhoto(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const body = { ...form, name: form.name.trim(), topic: orNull(form.topic), bio: orNull(form.bio), email: orNull(form.email), phone: orNull(form.phone) };
      const saved = await saveSpeaker(clubId, body, editing ?? undefined);
      if (photo) await uploadSpeakerPhoto(clubId, saved.id, photo);
      reset();
      setNotice("Speaker saved.");
      load();
    } catch (err) {
      onError(message(err, "Could not save the speaker."));
    } finally {
      setBusy(false);
    }
  };

  const edit = (s: Speaker) => {
    setEditing(s.id);
    setForm({ meetingDate: s.meetingDate.slice(0, 10), name: s.name, topic: s.topic, bio: s.bio, email: s.email, phone: s.phone, showOnWebsite: s.showOnWebsite });
    setPhoto(null);
  };

  const remove = async (s: Speaker) => {
    if (!window.confirm(`Remove ${s.name} from the speakers?`)) return;
    try {
      await deleteSpeaker(clubId, s.id);
      if (editing === s.id) reset();
      load();
    } catch (err) {
      onError(message(err, "Could not remove the speaker."));
    }
  };

  const share = async (s: Speaker) => {
    if (!window.confirm(`Propose ${s.name} to your district's speaker bureau?`)) return;
    try {
      await shareSpeakerToBureau(clubId, s.id);
      setNotice(`${s.name} is proposed to the district's speaker bureau.`);
    } catch (err) {
      onError(message(err, "Could not share the speaker."));
    }
  };

  const set = (patch: Partial<SaveSpeaker>) => setForm({ ...form, ...patch });

  return (
    <section className="space-y-3">
      <h3 className="row-h2">Speakers</h3>
      <Card>
        <CardContent className="p-5">
          <form className="grid gap-4 md:grid-cols-2" onSubmit={save}>
            <div className="space-y-1.5">
              <Label htmlFor="sp-date">Meeting date</Label>
              <Input id="sp-date" type="date" required value={form.meetingDate} onChange={(e) => set({ meetingDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-name">Name</Label>
              <Input id="sp-name" required maxLength={150} value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="sp-topic">Topic</Label>
              <Input id="sp-topic" maxLength={250} value={form.topic ?? ""} onChange={(e) => set({ topic: e.target.value })} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="sp-bio">Bio</Label>
              <Textarea id="sp-bio" rows={3} maxLength={4000} value={form.bio ?? ""} onChange={(e) => set({ bio: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-email">Email (not shown on the website)</Label>
              <Input id="sp-email" type="email" maxLength={254} value={form.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-phone">Phone (not shown on the website)</Label>
              <Input id="sp-phone" type="tel" maxLength={40} value={form.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-photo">Photo (JPG, PNG or WebP, up to 5 MB)</Label>
              <Input id="sp-photo" ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <Checkbox checked={form.showOnWebsite} onCheckedChange={(v) => set({ showOnWebsite: v === true })} />
              Show on the club website
            </label>
            <div className="flex flex-wrap items-center gap-2 md:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editing ? "Save speaker" : "Add speaker"}
              </Button>
              {editing && <Button type="button" variant="outline" onClick={reset}>Cancel</Button>}
              {notice && <span className="text-sm text-emerald-700" role="status">{notice}</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={showPast} onCheckedChange={(v) => setShowPast(v === true)} /> Show past speakers too
      </label>
      {!list ? (
        <div aria-busy="true"><TableSkeleton rows={3} /></div>
      ) : list.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No speakers scheduled.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table className="w-full min-w-[720px] text-sm">
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className="p-3">Meeting</TableHead>
                  <TableHead className="p-3">Speaker</TableHead>
                  <TableHead className="p-3">Contact</TableHead>
                  <TableHead className="p-3">Website</TableHead>
                  <TableHead className="p-3"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((s) => (
                  <TableRow key={s.id} className="border-b last:border-0 align-top">
                    <TableCell className="p-3 whitespace-nowrap">{fmt.date(s.meetingDate.slice(0, 10))}</TableCell>
                    <TableCell className="p-3">
                      <div className="flex items-start gap-3">
                        {s.photoPath && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`${API}${s.photoPath}`} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                        )}
                        <div>
                          <p className="font-medium">{s.name}</p>
                          {s.topic && <p className="text-muted-foreground">{s.topic}</p>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="p-3">{[s.email, s.phone].filter(Boolean).join(", ")}</TableCell>
                    <TableCell className="p-3">{s.showOnWebsite ? "Shown" : "Hidden"}</TableCell>
                    <TableCell className="p-3 whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => share(s)}>Share to bureau</Button>
                      <Button variant="ghost" size="sm" aria-label={`Edit ${s.name}`} onClick={() => edit(s)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" aria-label={`Remove ${s.name}`} onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function DutiesSection({ clubId, onError }: { clubId: number; onError: (m: string) => void }) {
  const fmt = useFormat();
  const today = useToday();
  const [list, setList] = useState<MeetingDuty[] | null>(null);
  const [members, setMembers] = useState<ClubMemberSimple[]>([]);
  const [form, setForm] = useState({ meetingDate: "", duty: "", memberId: "", note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getMeetingDuties(clubId, { from: today })
      .then(setList)
      .catch((err) => onError(message(err, "Could not load the meeting duties.")));
  }, [clubId, today, onError]);
  useEffect(() => { setList(null); load(); }, [load]);
  useEffect(() => {
    getClubMembersForAttendance(clubId).then(setMembers).catch(() => onError("Could not load the club's members."));
  }, [clubId, onError]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await addMeetingDuty(clubId, { meetingDate: form.meetingDate, duty: form.duty.trim(), memberId: Number(form.memberId), note: orNull(form.note) });
      setForm({ ...form, duty: "", memberId: "", note: "" });
      load();
    } catch (err) {
      onError(message(err, "Could not add the duty."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: MeetingDuty) => {
    if (!window.confirm(`Remove ${d.memberName ?? "this member"} as ${d.duty}?`)) return;
    try {
      await deleteMeetingDuty(clubId, d.id);
      load();
    } catch (err) {
      onError(message(err, "Could not remove the duty."));
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="row-h2">Meeting duties</h3>
      <Card>
        <CardContent className="p-5">
          <form className="grid gap-4 md:grid-cols-4" onSubmit={add}>
            <div className="space-y-1.5">
              <Label htmlFor="du-date">Meeting date</Label>
              <Input id="du-date" type="date" required min={today} value={form.meetingDate} onChange={(e) => setForm({ ...form, meetingDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="du-duty">Duty</Label>
              <Input id="du-duty" required maxLength={100} list="du-suggestions" value={form.duty} onChange={(e) => setForm({ ...form, duty: e.target.value })} />
              <datalist id="du-suggestions">{DUTIES.map((d) => <option key={d} value={d} />)}</datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="du-member">Member</Label>
              <NativeSelect id="du-member" required  value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })}>
                <option value="">Choose a member</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.memberName}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="du-note">Note (optional)</Label>
              <Input id="du-note" maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <div className="md:col-span-4">
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Assign duty
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {!list ? (
        <div aria-busy="true"><TableSkeleton rows={3} /></div>
      ) : list.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No duties assigned for coming meetings.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table className="w-full min-w-[640px] text-sm">
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className="p-3">Meeting</TableHead>
                  <TableHead className="p-3">Duty</TableHead>
                  <TableHead className="p-3">Member</TableHead>
                  <TableHead className="p-3">Reminder</TableHead>
                  <TableHead className="p-3"><span className="sr-only">Remove</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((d) => (
                  <TableRow key={d.id} className="border-b last:border-0">
                    <TableCell className="p-3 whitespace-nowrap">{fmt.date(d.meetingDate.slice(0, 10))}</TableCell>
                    <TableCell className="p-3">{d.duty}{d.note && <span className="block text-muted-foreground">{d.note}</span>}</TableCell>
                    <TableCell className="p-3">{d.memberName}</TableCell>
                    <TableCell className="p-3">{d.reminderSentAt ? fmt.dateTime(d.reminderSentAt) : "Not yet"}</TableCell>
                    <TableCell className="p-3">
                      <Button variant="ghost" size="sm" aria-label={`Remove ${d.duty}`} onClick={() => remove(d)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

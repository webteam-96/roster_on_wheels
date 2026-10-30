"use client";

/**
 * Club Admin Dashboard › Volunteers › one sign-up sheet ("new" starts one): the sheet and its slots, the public link,
 * each slot's sign-ups and the hours recorded afterwards. Flagged module "volunteers".
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Copy, Loader2, Plus, Save, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ErrorAlert from "@/components/ErrorAlert";
import { Skeleton, TableSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useFormat } from "@/hooks/useFormat";
import {
  createVolunteerSheet, deleteVolunteerSheet, getRotaryYears, getVolunteerSheet, getVolunteerTargets, removeVolunteerSignup,
  saveVolunteerHours, updateVolunteerSheet,
} from "@/services/api";
import { hoursEntries, toRows, toSlots, typedTotal, type SlotRow } from "@/lib/volunteers";
import type { SheetStatus, VolunteerSheet, VolunteerTargets } from "@/types/volunteers";
import type { RotaryYear } from "@/types/rotaryYear";

const SELECT = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const message = (err: any, fallback: string) => err?.response?.data?.message || fallback;
const emptySlot = (): SlotRow => ({ id: null, task: "", startsAt: "", endsAt: "", capacity: "1", filled: 0 });

interface Form {
  title: string;
  description: string;
  eventId: string;
  yearId: string;
  projectId: string;
  isPublic: boolean;
  status: SheetStatus;
  slots: SlotRow[];
}

const toForm = (s: VolunteerSheet | null): Form => ({
  title: s?.title ?? "",
  description: s?.description ?? "",
  eventId: s?.eventId ? String(s.eventId) : "",
  yearId: s?.yearId ? String(s.yearId) : "",
  projectId: s?.projectId ? String(s.projectId) : "",
  isPublic: s?.isPublic ?? true,
  status: s?.status ?? "open",
  slots: s ? toRows(s.slots) : [emptySlot()],
});

export default function VolunteerSheetPage() {
  const { selectedClubId: clubId } = useAuth();
  const fmt = useFormat();
  const router = useRouter();
  const param = String(useParams().sheetId);
  const isNew = param === "new";
  const id = isNew ? 0 : Number(param);
  const [sheet, setSheet] = useState<VolunteerSheet | null>(null);
  const [form, setForm] = useState<Form | null>(isNew ? toForm(null) : null);
  const [hours, setHours] = useState<Record<number, string>>({});
  const [years, setYears] = useState<RotaryYear[]>([]);
  const [targets, setTargets] = useState<VolunteerTargets | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = (s: VolunteerSheet) => {
    setSheet(s);
    setForm(toForm(s));
    setHours(Object.fromEntries(s.slots.flatMap((sl) => sl.signups.map((su) => [su.id, su.hours == null ? "" : String(su.hours)]))));
  };

  useEffect(() => {
    getRotaryYears()
      .then((ys) => setYears([...ys].sort((a, b) => b.startDate.localeCompare(a.startDate))))
      .catch(() => setError("Could not load the Rotary years."));
  }, []);

  useEffect(() => {
    if (!clubId || isNew) return;
    setSheet(null);
    getVolunteerSheet(clubId, id).then(show).catch(() => setMissing(true));
  }, [clubId, id, isNew]);

  const yearId = form?.yearId ?? "";
  useEffect(() => {
    if (!clubId) return;
    getVolunteerTargets(clubId, yearId ? Number(yearId) : null)
      .then(setTargets)
      .catch(() => setError("Could not load the club's events and projects."));
  }, [clubId, yearId]);

  if (!clubId) return <p className="p-6 text-sm text-muted-foreground">Choose a club first.</p>;
  if (missing) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm">This sign-up sheet was not found for your club.</p>
        <Link href="/club-admin-dashboard/volunteers" className="text-sm text-primary underline">Back to the sign-up sheets</Link>
      </div>
    );
  }
  if (!form) {
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
        <TableSkeleton rows={4} />
      </div>
    );
  }

  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const setSlot = (i: number, patch: Partial<SlotRow>) => set({ slots: form.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const run = async (work: () => Promise<VolunteerSheet>, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      show(await work());
      setNotice(done);
    } catch (err) {
      setError(message(err, "Something went wrong."));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const body = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      eventId: form.eventId ? Number(form.eventId) : null,
      yearId: form.projectId ? Number(form.yearId) : null,
      projectId: form.projectId ? Number(form.projectId) : null,
      isPublic: form.isPublic,
      status: form.status,
      slots: toSlots(form.slots),
    };
    if (!isNew) return run(() => updateVolunteerSheet(clubId, id, body), "Sheet saved.");
    setBusy(true);
    try {
      const created = await createVolunteerSheet(clubId, body);
      router.replace(`/club-admin-dashboard/volunteers/${created.id}`);
    } catch (err) {
      setError(message(err, "Could not create the sheet."));
      setBusy(false);
    }
  };

  const removeSignup = (signupId: number) => {
    if (!window.confirm("Remove this sign-up? The place frees up and any hours come off the totals.")) return;
    run(() => removeVolunteerSignup(clubId, id, signupId), "Sign-up removed.");
  };

  const removeSheet = async () => {
    if (!window.confirm("Delete this sheet with its slots and sign-ups? Its hours come off the project's man-hours.")) return;
    setBusy(true);
    try {
      await deleteVolunteerSheet(clubId, id);
      router.push("/club-admin-dashboard/volunteers");
    } catch (err) {
      setError(message(err, "Could not delete the sheet."));
      setBusy(false);
    }
  };

  const link = sheet ? `${window.location.origin}/public/volunteer/${sheet.publicToken}` : "";

  return (
    <div className="space-y-5 p-6">
      <Button variant="outline" size="sm" asChild className="gap-1.5">
        <Link href="/club-admin-dashboard/volunteers"><ArrowLeft className="h-4 w-4" /> All sign-up sheets</Link>
      </Button>
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-primary">{isNew ? "New sign-up sheet" : sheet?.title}</h2>
        <p className="text-base text-muted-foreground">
          Slots with a task, a time and a number of places. Each person gets an email reminder in the 24 hours before
          their slot; members also see it in the app.
        </p>
      </div>
      {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" maxLength={200} value={form.title} onChange={(e) => set({ title: e.target.value })} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="description">What volunteers should know</Label>
              <Textarea id="description" maxLength={4000} rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event">Event</Label>
              <select id="event" className={SELECT} value={form.eventId} onChange={(e) => set({ eventId: e.target.value })}>
                <option value="">No event</option>
                {targets?.events.map((e) => <option key={e.id} value={e.id}>{e.title}{e.date ? `, ${fmt.date(e.date)}` : ""}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <select id="status" className={SELECT} value={form.status} onChange={(e) => set({ status: e.target.value as SheetStatus })}>
                <option value="open">Open for sign-ups</option>
                <option value="closed">Closed to new sign-ups (reminders still go out)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="year">Service project: Rotary year</Label>
              <select id="year" className={SELECT} value={form.yearId} onChange={(e) => set({ yearId: e.target.value, projectId: "" })}>
                <option value="">No project</option>
                {years.map((y) => <option key={y.id} value={y.id}>{y.yearLabel}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project">Service project</Label>
              <select id="project" className={SELECT} value={form.projectId} disabled={!form.yearId}
                onChange={(e) => set({ projectId: e.target.value })}>
                <option value="">{form.yearId ? "Choose a project" : "Choose the year first"}</option>
                {form.yearId && targets?.projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}{p.date ? `, ${fmt.date(p.date)}` : ""}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Hours recorded on this sheet are added to the project&apos;s man-hours.</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.isPublic} onCheckedChange={(v) => set({ isPublic: v === true })} />
            Public link: anyone with the link can sign up with their name and email
          </label>

          <div className="space-y-2">
            <h3 className="text-base font-semibold">Slots</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-2 pr-2 font-medium">Task</th>
                    <th className="pb-2 pr-2 font-medium">Starts</th>
                    <th className="pb-2 pr-2 font-medium">Ends (optional)</th>
                    <th className="pb-2 pr-2 font-medium">Places</th>
                    <th className="pb-2 pr-2 font-medium">Taken</th>
                    <th className="pb-2"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {form.slots.map((s, i) => (
                    <tr key={s.id ?? `new-${i}`}>
                      <td className="py-1 pr-2"><Input aria-label="Task" maxLength={200} value={s.task} onChange={(e) => setSlot(i, { task: e.target.value })} /></td>
                      <td className="py-1 pr-2"><Input aria-label="Starts" type="datetime-local" value={s.startsAt} onChange={(e) => setSlot(i, { startsAt: e.target.value })} /></td>
                      <td className="py-1 pr-2"><Input aria-label="Ends" type="datetime-local" value={s.endsAt} onChange={(e) => setSlot(i, { endsAt: e.target.value })} /></td>
                      <td className="py-1 pr-2 w-24">
                        <Input aria-label="Places" type="number" min={Math.max(1, s.filled)} max={1000} value={s.capacity}
                          onChange={(e) => setSlot(i, { capacity: e.target.value })} />
                      </td>
                      <td className="py-1 pr-2 tabular-nums">{s.filled}</td>
                      <td className="py-1">
                        <Button type="button" variant="ghost" size="sm" aria-label="Remove slot" disabled={s.filled > 0 || form.slots.length === 1}
                          title={s.filled > 0 ? "Remove its sign-ups first" : undefined}
                          onClick={() => set({ slots: form.slots.filter((_, j) => j !== i) })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={form.slots.length >= 50}
              onClick={() => set({ slots: [...form.slots, emptySlot()] })}>
              <Plus className="h-3.5 w-3.5" /> Add a slot
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy || !form.title.trim()} className="gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {isNew ? "Create sheet" : "Save sheet"}
            </Button>
            {!isNew && (
              <Button variant="outline" onClick={removeSheet} disabled={busy} className="gap-1.5 text-destructive">
                <Trash2 className="h-4 w-4" /> Delete sheet
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {sheet && sheet.isPublic && sheet.status === "open" && (
        <Card>
          <CardContent className="space-y-2 p-5">
            <h3 className="text-base font-semibold">Public sign-up link</h3>
            <p className="text-sm text-muted-foreground">
              Share it by email or on your website. People give their name and email and agree to the club keeping them
              for this sign-up.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input readOnly value={link} className="max-w-xl" aria-label="Public sign-up link" onFocus={(e) => e.target.select()} />
              <Button variant="outline" size="sm" className="gap-1.5"
                onClick={() => navigator.clipboard.writeText(link).then(() => setNotice("Link copied."), () => setError("Could not copy the link."))}>
                <Copy className="h-3.5 w-3.5" /> Copy link
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {sheet && (
        <Card>
          <CardContent className="space-y-5 p-5">
            <div>
              <h3 className="text-base font-semibold">Sign-ups and hours</h3>
              <p className="text-sm text-muted-foreground">After the event, record each person&apos;s hours and save.</p>
            </div>
            {sheet.slots.map((slot) => (
              <div key={slot.id} className="space-y-2">
                <p className="text-sm">
                  <span className="font-medium">{slot.task}</span>{" "}
                  <span className="text-muted-foreground">{fmt.dateTime(slot.startsAt)}, {slot.filled} of {slot.capacity} places taken</span>
                </p>
                {slot.signups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sign-ups yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="bg-[#EDF4FB] text-[13px] text-[#64748B]">
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="p-2 font-medium">Name</th>
                          <th className="p-2 font-medium">Signed up as</th>
                          <th className="p-2 font-medium">Reminder</th>
                          <th className="p-2 font-medium">Hours</th>
                          <th className="p-2"><span className="sr-only">Remove</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {slot.signups.map((su) => (
                          <tr key={su.id} className="border-b last:border-0">
                            <td className="p-2">{su.name}</td>
                            <td className="p-2">{su.memberId ? "Member" : su.email}</td>
                            <td className="p-2">{su.reminderSentAt ? fmt.dateTime(su.reminderSentAt) : "Not yet"}</td>
                            <td className="w-28 p-2">
                              <Input aria-label={`Hours for ${su.name}`} type="number" min={0} max={999} step={0.25} value={hours[su.id] ?? ""}
                                onChange={(e) => setHours({ ...hours, [su.id]: e.target.value })} />
                            </td>
                            <td className="p-2">
                              <Button variant="ghost" size="sm" aria-label={`Remove ${su.name}`} disabled={busy} onClick={() => removeSignup(su.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
            <div className="space-y-2 border-t pt-4 text-sm">
              <p>Hours on this sheet: <span className="font-medium tabular-nums">{fmt.number(typedTotal(hours))}</span></p>
              <p className="text-muted-foreground">
                {sheet.projectTitle
                  ? `${fmt.number(sheet.hoursApplied)} of them are in the man-hours of "${sheet.projectTitle}", which now records ${fmt.number(sheet.projectManHours ?? 0)} man-hours.`
                  : "Link a service project above to add these hours to its man-hours."}
              </p>
              <Button onClick={() => run(() => saveVolunteerHours(clubId, id, hoursEntries(hours)), "Hours saved.")}
                disabled={busy || Object.keys(hours).length === 0} className="gap-1.5">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save hours
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ErrorAlert open={!!error} title="Could not do that" description={error || ""} onOk={() => setError(null)} />
    </div>
  );
}

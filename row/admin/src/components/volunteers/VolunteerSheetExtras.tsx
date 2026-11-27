"use client";

/**
 * Volunteer sheet extras on the sheet page (api/Controllers/VolunteerExtrasController.cs): the confirmation email
 * text, follow-up emails the background job sends once to each volunteer, the sheet's coordinators and emailing them
 * the volunteer list, archiving, and copying the sheet as a new one.
 */

import { NativeSelect } from "@/components/ui/native-select";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Copy, Loader2, Mail, Plus, RotateCcw, Save, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/dashboard/DashboardSkeleton";
import { useFormat } from "@/hooks/useFormat";
import {
  archiveVolunteerSheet, copyVolunteerSheet, emailVolunteerCoordinators, getVolunteerSheetExtras, saveVolunteerSheetExtras,
} from "@/services/api";
import { emptyFollowup, followupWhen, toExtrasBody, toFollowupRows, type FollowupRow } from "@/lib/volunteerExtras";
import type { FollowupKind, VolunteerSheetExtras as Extras } from "@/types/volunteers";

const SELECT = "row-field w-full";
const message = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

interface Props {
  clubId: number;
  sheetId: number;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
  /** After archive or unarchive: the page reloads the sheet (its status changes). */
  onChanged: () => void;
}

export default function VolunteerSheetExtras({ clubId, sheetId, onNotice, onError, onChanged }: Props) {
  const fmt = useFormat();
  const router = useRouter();
  const [extras, setExtras] = useState<Extras | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [coordinators, setCoordinators] = useState<number[]>([]);
  const [filter, setFilter] = useState("");
  const [shiftDays, setShiftDays] = useState("7");
  const [busy, setBusy] = useState(false);

  const show = (x: Extras) => {
    setExtras(x);
    setText(x.confirmationText ?? "");
    setRows(toFollowupRows(x.followups));
    setCoordinators(x.coordinatorIds);
  };

  useEffect(() => {
    setExtras(null);
    setFailed(false);
    getVolunteerSheetExtras(clubId, sheetId).then(show).catch(() => setFailed(true));
  }, [clubId, sheetId]);

  if (failed) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground" role="alert">
          Could not load the emails, coordinators and archive settings for this sheet. Reload the page to try again.
        </CardContent>
      </Card>
    );
  }
  if (!extras) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const act = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      onError(message(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const setRow = (i: number, patch: Partial<FollowupRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = (kind: FollowupKind) => setRows([...rows, emptyFollowup(kind)]);
  const toggle = (id: number, on: boolean) => setCoordinators(on ? [...coordinators, id] : coordinators.filter((x) => x !== id));
  const named = new Map(extras.members.map((m) => [m.memberId, m]));
  const shown = extras.members.filter((m) => !filter.trim() || m.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const savedCoordinators = extras.coordinatorIds.length;

  const save = () => act(async () => {
    show(await saveVolunteerSheetExtras(clubId, sheetId, toExtrasBody(text, rows, coordinators)));
    onNotice("Emails and coordinators saved.");
  }, "Could not save the emails and coordinators.");

  const emailList = () => act(async () => {
    const r = await emailVolunteerCoordinators(clubId, sheetId);
    onNotice(`The volunteer list went to ${r.sent} coordinator${r.sent === 1 ? "" : "s"}.`);
  }, "Could not email the list.");

  const archive = (archived: boolean) => {
    if (archived && !window.confirm("Archive this sheet? It closes to new sign-ups and moves to the archived list.")) return;
    act(async () => {
      await archiveVolunteerSheet(clubId, sheetId, archived);
      setExtras({ ...extras, archivedAt: archived ? new Date().toISOString() : null });
      onNotice(archived ? "Sheet archived." : "Sheet back in the list. It stays closed until you open it.");
      onChanged();
    }, "Could not change the archive state.");
  };

  const copy = () => act(async () => {
    const days = /^\d+$/.test(shiftDays.trim()) ? Number(shiftDays.trim()) : -1;
    const r = await copyVolunteerSheet(clubId, sheetId, days);
    router.push(`/club-admin-dashboard/volunteers/${r.id}`);
  }, "Could not copy the sheet.");

  return (
    <>
      <Card>
        <CardContent className="space-y-5 p-5">
          <div>
            <h3 className="row-h2">Emails to volunteers</h3>
            <p className="text-sm text-muted-foreground">
              Each email adds the person&apos;s slot, date and time below your text. Follow-ups go once to each volunteer.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmation">Confirmation email (sent when someone signs up; leave empty to send none)</Label>
            <Textarea id="confirmation" rows={4} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
          </div>

          <div className="space-y-3">
            <h4 className="row-h3">Follow-up emails</h4>
            {rows.length === 0 && <p className="text-sm text-muted-foreground">No follow-ups. Add a reminder before the slot or a thank-you after it.</p>}
            {rows.map((r, i) => (
              <div key={r.id ?? `new-${i}`} className="space-y-2 rounded-md border p-3">
                <div className="grid gap-2 md:grid-cols-[160px_110px_1fr_auto]">
                  <NativeSelect aria-label="When"  value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as FollowupKind })}>
                    <option value="before">Reminder before</option>
                    <option value="after">Thank-you after</option>
                  </NativeSelect>
                  <Input aria-label="Days" type="number" min={r.kind === "before" ? 1 : 0} max={90} value={r.days}
                    onChange={(e) => setRow(i, { days: e.target.value })} />
                  <Input aria-label="Subject" placeholder="Subject" maxLength={200} value={r.subject} onChange={(e) => setRow(i, { subject: e.target.value })} />
                  <Button type="button" variant="ghost" size="sm" aria-label="Remove follow-up" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea aria-label="Text" placeholder="Text" rows={3} maxLength={4000} value={r.body} onChange={(e) => setRow(i, { body: e.target.value })} />
                <p className="text-xs text-muted-foreground">
                  {/^\d+$/.test(r.days.trim()) ? `Goes ${followupWhen(r.kind, Number(r.days))}.` : "Days is a whole number."}
                  {r.id != null && ` Sent to ${r.sentCount} so far.`}
                </p>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={rows.length >= 5} onClick={() => add("before")}>
                <Plus className="h-3.5 w-3.5" /> Add a reminder
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={rows.length >= 5} onClick={() => add("after")}>
                <Plus className="h-3.5 w-3.5" /> Add a thank-you
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="row-h3">Coordinators</h4>
            <p className="text-sm text-muted-foreground">
              Members who run this sheet. They can be sent the volunteer list by email (up to 10).
              {coordinators.length > 0 && ` Chosen: ${coordinators.map((id) => named.get(id)?.name ?? id).join(", ")}.`}
            </p>
            <Input aria-label="Find a member" placeholder="Find a member" className="max-w-sm" value={filter} onChange={(e) => setFilter(e.target.value)} />
            {extras.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">The club has no active members to choose.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-md border p-2">
                {shown.length === 0 && <p className="p-1 text-sm text-muted-foreground">No member matches.</p>}
                {shown.map((m) => (
                  <label key={m.memberId} className="flex items-center gap-2 p-1 text-sm">
                    <Checkbox checked={coordinators.includes(m.memberId)} disabled={!coordinators.includes(m.memberId) && coordinators.length >= 10}
                      onCheckedChange={(v) => toggle(m.memberId, v === true)} />
                    {m.name}{!m.hasEmail && <span className="text-muted-foreground">(no email address)</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save emails and coordinators
            </Button>
            <Button variant="outline" onClick={emailList} disabled={busy || savedCoordinators === 0}
              title={savedCoordinators === 0 ? "Save at least one coordinator first" : undefined}>
              <Mail className="h-4 w-4" /> Email the volunteer list to coordinators
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h3 className="row-h2">Archive or reuse</h3>
            <p className="text-sm text-muted-foreground">
              {extras.archivedAt
                ? `Archived on ${fmt.dateTime(extras.archivedAt)}. It takes no sign-ups and is listed under archived sheets.`
                : "When the event is over, archive the sheet: it closes to sign-ups and leaves the main list. Its hours stay."}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {extras.archivedAt ? (
              <Button variant="outline" onClick={() => archive(false)} disabled={busy}>
                <RotateCcw className="h-4 w-4" /> Bring back from the archive
              </Button>
            ) : (
              <Button variant="outline" onClick={() => archive(true)} disabled={busy}>
                <Archive className="h-4 w-4" /> Archive sheet
              </Button>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="shift">Move the copy&apos;s slots by (days)</Label>
              <Input id="shift" type="number" min={0} max={730} className="w-32" value={shiftDays} onChange={(e) => setShiftDays(e.target.value)} />
            </div>
            <Button variant="outline" onClick={copy} disabled={busy}>
              <Copy className="h-4 w-4" /> Copy as a new sheet
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The copy keeps the text, slots, emails and coordinators, without sign-ups, and gets a new public link. Link its
            event and project again.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
